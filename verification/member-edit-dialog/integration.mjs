import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import worker from '../../worker.js';

// Isolated contract tests only: no production network or business writes.
const require=createRequire('/tmp/2bl-verification-deps/package.json');
const {JSDOM}=require('jsdom');
const {parse}=require('acorn');
const {PGlite}=require('@electric-sql/pglite');
const base=new URL('../../',import.meta.url);
const current=fs.readFileSync(new URL('index.html',base),'utf8');
const original=execFileSync('git',['show','5d4bc3f2a23cc9d4350032c07321bca79f66052e:index.html'],{cwd:base,encoding:'utf8'});
const schema=JSON.parse(fs.readFileSync(new URL('schema.json',import.meta.url),'utf8'));
const db=new PGlite();
const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
for(const table of ['members','audit_logs']){
  const columns=schema.filter(c=>c.table_name===table).map(c=>quote(c.column_name)+' '+c.udt_name+(c.column_default?' DEFAULT '+c.column_default:'')+(c.is_nullable==='NO'?' NOT NULL':''));
  await db.exec('CREATE TABLE '+quote(table)+' ('+columns.join(',')+')');
}
const member={tenant_id:'tuibile',email:'vendor@example.com',member_id:'MB_ISOLATED',name:'測試會員',phone:'0912345678',brand_name:'舊品牌',brand_intro:'保留介紹',sell_category:'保留類別',fb_url:'https://example.com/vendor',ig_url:'https://example.com/ig',collab_url:'https://example.com',city:'高雄市',invoice_carrier:'/ABC1234',invoice_email:'vendor@example.com',joined_at:'2026-01-01T00:00:00Z'};
async function insert(table,row){
  const keys=Object.keys(row),values=keys.map(k=>row[k]);
  return db.query('INSERT INTO '+quote(table)+' ('+keys.map(quote).join(',')+') VALUES ('+values.map((_,i)=>'$'+(i+1)).join(',')+') RETURNING *',values);
}
await insert('members',member);
await insert('members',{...member,tenant_id:'isolated_other_tenant',member_id:'MB_ISOLATED_OTHER',brand_name:'隔離品牌'});
const env={SUPABASE_URL:'https://db.isolated.invalid',SUPABASE_SERVICE_ROLE_KEY:'isolated-only',JWT_SECRET:'isolated-test-secret',AUTH_SECRET:'isolated-only'};
const events=[],results=[];
let failWrite=false;
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,init={})=>{
  const url=new URL(String(input));
  assert.equal(url.origin,env.SUPABASE_URL,'external network forbidden');
  const table=url.pathname.split('/').pop(),method=init.method||'GET';
  if(!['members','audit_logs'].includes(table)){
    assert.equal(method,'GET','unapproved table mutation');
    return Response.json([]);
  }
  const params=[],filters=[];
  for(const [key,value] of url.searchParams){
    if(['select','order','limit','offset','on_conflict'].includes(key))continue;
    const match=value.match(/^(eq|ilike)\.(.*)$/s);
    assert.ok(match,'unsupported test filter');
    params.push(match[2]);filters.push(quote(key)+(match[1]==='eq'?' = ':' ILIKE ')+'$'+params.length);
  }
  const where=filters.length?' WHERE '+filters.join(' AND '):'';
  if(method!=='GET')events.push({table,method,tenant:url.searchParams.get('tenant_id')});
  if(method==='GET')return Response.json((await db.query('SELECT * FROM '+quote(table)+where,params)).rows);
  if(failWrite&&table==='members')return Response.json({error:'isolated database failure'},{status:503});
  const row=JSON.parse(init.body),keys=Object.keys(row);
  if(method==='POST')return Response.json((await insert(table,row)).rows,{status:201});
  assert.equal(method,'PATCH');assert.ok(filters.some(x=>x.startsWith('"tenant_id"')),'tenant filter required');
  const assignments=keys.map(k=>{params.push(row[k]);return quote(k)+'=$'+params.length;});
  await db.query('UPDATE '+quote(table)+' SET '+assignments.join(',')+where,params);
  return new Response(null,{status:204});
};
async function post(body){return (await worker.fetch(new Request('https://worker.isolated.invalid/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenant:'tuibile',...body})}),env,{waitUntil(){}})).json();}
function functions(html){
  const functions=new Map();
  for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)){
    assert.doesNotThrow(()=>new vm.Script(m[1]));
    for(const node of parse(m[1],{ecmaVersion:'latest'}).body)if(node.type==='FunctionDeclaration')functions.set(node.id.name,m[1].slice(node.start,node.end));
  }
  return functions;
}
const before=functions(original),after=functions(current);
function setup(html){
  const dom=new JSDOM(html,{url:'https://front.isolated.invalid/',runScripts:'outside-only'}),w=dom.window;
  w.ST={member:{email:member.email,name:member.name,phone:member.phone,brand:member.brand_name,fb:member.fb_url},memberEmail:member.email,memberToken:'',_verifiedMemberPhone:member.phone,currentSession:{id:'SES_ISOLATED'}};
  w.API_BASE='https://worker.isolated.invalid/';w.TENANT_ID='tuibile';
  w.fetch=(input,init={})=>worker.fetch(new Request(input,init),env,{waitUntil(){}});
  w.AbortController=AbortController;
  w.scrollTo=()=>{};
  const timers=new Map();let nextTimer=0;
  w.setTimeout=(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,delay});return id;};
  w.clearTimeout=id=>timers.delete(id);
  const scrolls=[];
  w.HTMLElement.prototype.scrollIntoView=function(){scrolls.push(this);};
  w.eval([...functions(html).values()].join('\n')+"\nconst MEMBER_TOKEN_KEY='2bl_member_token';");
  const toasts=[];w.toast=msg=>toasts.push(String(msg));
  // Only unrelated fee/contract/hero rendering is omitted from this dialog unit fixture.
  const reg=w.document.getElementById('regFormModal');
  const region=w.document.createElement('div');region.id='isolatedRegValues';
  for(const id of ['f_brand','f_name','f_phone','f_fb','f_ig','f_brandIntro','f_sellItem','f_taxId','f_company','f_invoiceTitle','f_invoiceCarrier','f_invoiceEmail']){
    const el=w.document.createElement('input');el.id=id;region.appendChild(el);
  }
  for(const id of ['disp_brand','disp_name','disp_phone']){const el=w.document.createElement('span');el.id=id;region.appendChild(el);}
  reg.appendChild(region);
  function switchPage(id){w.document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===id));}
  function hiddenByAncestor(el){for(let p=el;p;p=p.parentElement)if(w.getComputedStyle(p).display==='none')return true;return false;}
  function flushClose(){for(const [id,t] of timers)if(t.delay===500){timers.delete(id);t.callback();}}
  return {dom,w,toasts,scrolls,switchPage,hiddenByAncestor,flushClose};
}
async function test(name,fn){await fn();results.push({name,pass:true});}
try{
  await test('old bug reproduced with hidden member page',async()=>{const t=setup(original);t.switchPage('regFormModal');await t.w.openMemberEditModal();assert.equal(t.hiddenByAncestor(t.w.document.getElementById('memberEditModal')),true);t.dom.window.close();});
  const t=setup(current),{w}=t,modal=w.document.getElementById('memberEditModal');
  await test('registration page opens the existing visible dialog',async()=>{t.switchPage('regFormModal');await w.openMemberEditModal();assert.equal(modal.parentElement,w.document.body);assert.equal(t.hiddenByAncestor(modal),false);assert.equal(w.document.getElementById('regFormModal').classList.contains('active'),true);});
  await test('repeated open uses one dialog and preserves fields',async()=>{const first=modal;await w.openMemberEditModal();assert.equal(w.document.querySelectorAll('#memberEditModal').length,1);assert.equal(w.document.getElementById('memberEditModal'),first);assert.equal(w.document.getElementById('editBrand').value,'舊品牌');});
  await test('background closes without losing registration page',async()=>{modal.click();assert.equal(modal.classList.contains('show'),false);assert.equal(w.document.getElementById('regFormModal').classList.contains('active'),true);});
  await test('member hero edit still opens',async()=>{t.switchPage('pageMember');await w.openMemberEditModal();assert.equal(t.hiddenByAncestor(modal),false);w.closeMemberEditModal();});
  await test('invoice edit reaches the existing invoice card',async()=>{t.switchPage('regFormModal');await w.openInvoiceEditModal();assert.equal(t.hiddenByAncestor(modal),false);assert.equal(t.scrolls.at(-1).classList.contains('invoice'),true);});
  await test('required profile hint and close protection retained',async()=>{await w.openMemberEditModal('請補齊資料');modal.click();assert.equal(modal.classList.contains('show'),true);assert.equal(w.document.getElementById('memberEditHint').textContent,'請補齊資料');assert.ok(t.toasts.at(-1).includes('請先填寫'));await w.openMemberEditModal();assert.equal(w.document.getElementById('memberEditHint').style.display,'none');});
  await test('edit saves through original Worker to isolated SQL database and reads back',async()=>{w.document.getElementById('editBrand').value='Ej手作';await w.saveMemberEdit();assert.ok(t.toasts.includes('✅ 會員資料已更新'));const row=(await db.query('SELECT * FROM members WHERE tenant_id=$1 AND email=$2',['tuibile',member.email])).rows[0];assert.equal(row.brand_name,'Ej手作');assert.equal(row.member_id,'MB_ISOLATED');assert.equal(row.city,'高雄市');assert.equal(row.sell_category,'保留類別');assert.equal(row.phone,member.phone);assert.equal(w.ST.member.brand,'Ej手作');assert.equal(w.document.getElementById('disp_brand').textContent,'Ej手作');assert.equal(w.document.getElementById('f_brand').value,'Ej手作');t.flushClose();assert.equal(modal.classList.contains('show'),false);});
  await test('save audit records only original member fields',async()=>{const rows=(await db.query('SELECT * FROM audit_logs WHERE tenant_id=$1',['tuibile'])).rows;assert.equal(rows.length,1);assert.equal(rows[0].action,'member_profile_self_update');assert.equal(rows[0].before_json.brand_name,'舊品牌');assert.equal(rows[0].after_json.brand_name,'Ej手作');assert.deepEqual([...new Set(events.map(e=>e.table))].sort(),['audit_logs','members']);});
  await test('fresh page reads persisted updated member',async()=>{const fresh=setup(current);fresh.switchPage('pageMember');await fresh.w.openMemberEditModal();assert.equal(fresh.w.document.getElementById('editBrand').value,'Ej手作');fresh.dom.window.close();});
  await test('same email from another tenant untouched',async()=>{const row=(await db.query('SELECT * FROM members WHERE tenant_id=$1',['isolated_other_tenant'])).rows[0];assert.equal(row.brand_name,'隔離品牌');assert.equal(row.member_id,'MB_ISOLATED_OTHER');});
  await test('wrong verified phone cannot alter member',async()=>{const result=await post({action:'saveMember',email:member.email,authPhone:'0999999999',phone:member.phone,brand:'不得保存'});assert.ok(result.error);assert.equal((await db.query('SELECT brand_name FROM members WHERE tenant_id=$1',['tuibile'])).rows[0].brand_name,'Ej手作');});
  await test('database failure shows error without success or changing displayed brand',async()=>{await w.openMemberEditModal();t.toasts.length=0;w.document.getElementById('editBrand').value='不得保存';failWrite=true;await w.saveMemberEdit();failWrite=false;assert.equal(w.ST.member.brand,'Ej手作');assert.equal(w.document.getElementById('disp_brand').textContent,'Ej手作');assert.equal(t.toasts.some(s=>s.includes('會員資料已更新')),false);assert.equal(w.document.getElementById('saveMemberBtn').disabled,false);});
  await test('phone edit cancellation keeps verified phone and database',async()=>{w.document.getElementById('editPhone').value='0987654321';w.uiConfirm=async()=>false;const count=events.length;await w.saveMemberEdit();assert.equal(events.length,count);assert.equal(w.ST.member.phone,member.phone);assert.equal(w.document.getElementById('saveMemberBtn').disabled,false);});
  await test('missing login stops before dialog or API',async()=>{w.closeMemberEditModal();w.ST.memberEmail='';w.localStorage.clear();const count=events.length;await w.openMemberEditModal();assert.equal(modal.classList.contains('show'),false);assert.equal(events.length,count);assert.equal(t.toasts.at(-1),'請先登入會員');});
  await test('only dialog opening and invoice navigation functions changed',async()=>{const changed=[...after].filter(([name,body])=>body!==before.get(name)).map(([name])=>name).sort();assert.deepEqual(changed,['openInvoiceEditModal','openMemberEditModal']);assert.equal(after.size,before.size);assert.equal(after.get('saveMemberEdit'),before.get('saveMemberEdit'));assert.equal(after.get('submitReg'),before.get('submitReg'));assert.equal(after.get('updateFee'),before.get('updateFee'));});
  t.dom.window.close();
  fs.writeFileSync(new URL('results.json',import.meta.url),JSON.stringify({ok:true,cases:results.length,kind:'isolated DOM + repository Worker + Postgres contract; not real-browser or production E2E',results},null,2)+'\n');
  console.log(JSON.stringify({ok:true,cases:results.length}));
}finally{globalThis.fetch=nativeFetch;await db.close();}
