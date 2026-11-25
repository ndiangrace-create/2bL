import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const admin=fs.readFileSync('admin.html','utf8');
const worker=fs.readFileSync('worker.js','utf8');
const migration=fs.readFileSync('supabase/migrations/20260822200500_transfer_selected_dates_day_ops.sql','utf8');

assert.match(admin,/async function openAdminManualRegistration\(/);
assert.match(admin,/class=\\?"amrDate/);
assert.match(admin,/selectedDates:\[\.\.\.document\.querySelectorAll\('\.amrDate:checked'\)\]/);
assert.match(admin,/amr-date-option/);
assert.match(admin,/grid-template-columns:28px minmax\(0,1fr\) auto/);
assert.match(worker,/async function _adminManualPreview\(/);
assert.match(worker,/_manualRegistrationFee\(ses,options,selected,stalls\)/);
assert.match(worker,/selected_dates_json:p\.dates/);

assert.match(admin,/function selectedResolutionTargetDates\(/);
assert.match(admin,/targetDates:selected/);
assert.match(admin,/targetDates,note:/);
assert.match(admin,/請至少選擇一個轉入日期/);
assert.match(worker,/availableTargetDates/);
assert.match(worker,/Array\.isArray\(b\.targetDates\)/);
assert.match(worker,/requested\.some\(x=>!validDates\.includes\(x\)\)/);
assert.match(worker,/p_target_dates:targetDates/);
assert.doesNotMatch(worker,/const targetDates=target\?_sessionDates\(target\):\[\]/);

assert.match(worker,/if\(!\['transfer','credit'\]\.includes\(mode\)\)/);
assert.match(admin,/async function confirmRegistrationCredit\(/);
assert.match(worker,/async function hPartialDayRefund\(/);

assert.match(migration,/after insert on public\.registrations/i);
assert.match(migration,/new\.tenant_id <> 'tuibile'/i);
assert.match(migration,/new\.transferred_from_registration_id is not null/i);
assert.match(migration,/registration_day_ops/);
assert.match(migration,/on conflict \(tenant_id,registration_id,activity_date\) do nothing/i);
assert.doesNotMatch(migration,/update\s+public\.registrations/i);
assert.doesNotMatch(migration,/delete\s+from\s+public\.registrations/i);

console.log('manual registration / transfer dates tests: PASS');


// Exercise the real admin handlers with in-memory fake database rows and no network.
const sessionId='test-session', now='2026-11-24T10:30:00.000Z';
let session, authorised=true, memberReads=0;
const writes=[];
const workerVM=vm.createContext({
  safeJson:(value,fallback)=>{try{return typeof value==='string'?JSON.parse(value):value??fallback;}catch{return fallback;}},
  safeNum:n=>Number(n)||0,
  formatSession:row=>({id:row.id,dates:row.dates_json}),
  jsonOk:data=>({ok:true,data}),jsonErr:error=>({ok:false,error}),
  verifyStaff:async (_env,_email,_token,tenant,permission,id)=>authorised&&tenant==='tuibile'&&permission==='review'&&id===sessionId,
  dbGet:async (_env,table,query)=>{
    assert.match(query,/^tenant_id=eq\.tuibile&/);
    if(table==='sessions'){assert.match(query,/id=eq\.test-session/);return [{id:sessionId,...session}];}
    assert.equal(table,'members');memberReads++;return [{email:'fixture@example.invalid',brand_name:'Synthetic'}];
  },
  calcEquipTotal:()=>0,
  normEmail:s=>String(s||'').trim().toLowerCase(),
  _dayDepositEligible:(row,d)=>row.selected_dates_json.at(-1)===d,
  dbRpc:async (_env,routine,data)=>writes.push({routine,data}),
  dbInsert:async (_env,table,row)=>writes.push({table,row}),
  dbUpsert:async (_env,table,row)=>writes.push({table,row}),
  nowIso:()=>now,genId:p=>p+'-test',
});
const from=worker.indexOf('function _manualCalendarDate('),to=worker.indexOf('async function hMemberNotifications(');
vm.runInContext(worker.slice(from,to),workerVM);
const args={_tenantId:'tuibile',sessionId,memberEmail:'fixture@example.invalid',stallCount:1,paymentMode:'unpaid'};
const quote=(selectedDates,extra={})=>workerVM.hAdminPreviewRegistration({}, {...args,selectedDates,...extra});
const create=(selectedDates,extra={})=>workerVM.hAdminCreateRegistration({}, {...args,selectedDates,...extra});
const uiOptions=async ()=> (await workerVM.hAdminManualSession({},args)).data.manualDateOptions;
const plain=value=>JSON.parse(JSON.stringify(value));

session={dates_json:[],event_date:'2026-10-23',fee:600,deposit:500,created_at:now};
assert.deepEqual(plain(await uiOptions()).map(x=>x.key),['2026-10-23']);
assert.equal((await quote(['2026-10-23'])).data.total,1100);
assert.equal((await quote(['2026-11-24'])).ok,false,'creation day is not a participation date');
session={dates_json:[],created_at:now};
assert.deepEqual(plain(await uiOptions()),[]);
assert.match((await quote(['2026-11-24'])).error,/沒有可用的參加日期/);

session={dates_json:[{startDate:'2026-11-01',endDate:'2026-11-04',optionId:'RNG_wide',fee:200},{date:'2026-11-01',optionId:'OPT_small',fee:100,label:'單日'}],fee:300};
assert.equal((await quote(['2026-11-01::RNG_wide'])).data.total,200,'same-start options are not both charged');
assert.equal((await quote(['2026-11-01::OPT_small'])).data.total,100);
assert.match((await quote(['2026-11-01'])).error,/同一天有多個報名方案/);
assert.equal((await quote(['2026-11-01::RNG_typo'])).ok,false);
assert.equal((await quote(['2026-11-01x'])).ok,false);
assert.deepEqual(plain((await quote(['2026-11-01::RNG_wide'])).data.selectedDateLabels),['2026-11-01～2026-11-04']);
assert.equal((await quote(['2026-11-01::RNG_wide','2026-11-01::RNG_wide'])).data.total,200);
assert.equal((await create(['2026-11-01::RNG_wide'],{expectedTotal:200,historicalBackfill:true})).ok,true);
const firstChoice=JSON.parse(JSON.stringify(writes.find(x=>x.table==='registrations').row));
const readOptionNote=row=>JSON.parse(row.admin_note.split('\n').at(-1).replace(/^\[參加選項\] /,''));
assert.deepEqual(firstChoice.selected_dates_json,['2026-11-01'],'persist a concrete date, not a UI option key');
assert.deepEqual(readOptionNote(firstChoice),[{key:'2026-11-01::RNG_wide',label:'2026-11-01～2026-11-04'}]);
assert.deepEqual(plain(writes.filter(x=>x.table==='registration_day_ops').map(x=>x.row.activity_date)),['2026-11-01'],'an entire-range choice remains a single unit');
writes.length=0;
assert.equal((await create(['2026-11-01::OPT_small'],{expectedTotal:100,historicalBackfill:true})).ok,true);
const secondChoice=JSON.parse(JSON.stringify(writes.find(x=>x.table==='registrations').row));
assert.deepEqual(secondChoice.selected_dates_json,firstChoice.selected_dates_json);
assert.deepEqual(readOptionNote(secondChoice),[{key:'2026-11-01::OPT_small',label:'2026-11-01｜單日'}]);
writes.length=0;

session={dates_json:[{date:'2026-11-01',fee:100},{date:'2026-11-02',fee:100},{startDate:'2026-11-01',endDate:'2026-11-04',optionId:'RNG_pack',fee:320}],fee:150};
const mixedOptions=plain(await uiOptions()), packageDays=mixedOptions.filter(d=>!d.range).map(d=>d.key);
assert.match(packageDays[0],/^2026-11-01::OPT_/);
assert.equal(packageDays[1],'2026-11-02');
assert.equal((await quote(packageDays)).data.total,150,'all single days without a range get the established package');
assert.equal((await quote([...packageDays,'2026-11-01::RNG_pack'])).data.total,520,'selecting a range charges it once and retains the separate singles');


session={dates_json:[{startDate:'2026-11-01',endDate:'2026-11-04',fee:2400}],deposit:500};
const [olderOption]=await uiOptions();
assert.match(olderOption.key,/^2026-11-01::RNG_/);
assert.equal((await quote([olderOption.key])).data.total,2900);
assert.equal((await quote(['2026-11-01'])).data.total,2900,'cached old UI still works for an unambiguous date');

const fourDays=['2026-10-23','2026-10-24','2026-10-25','2026-10-26'];
session={dates_json:fourDays.map(day=>({day,fee:800})),deposit:500};
session.dates_json[0].multiDayTiers=[{minDays:4,maxDays:0,dailyFee:600,enabled:true}];
const q=await quote(fourDays,{historicalBackfill:true,paymentMode:'paid',paidAt:'2026-10-18T00:05'});
assert.equal(q.data.fee,2400); assert.equal(q.data.deposit,500); assert.equal(q.data.total,2900);
assert.equal(q.data.stallCount,1); assert.deepEqual(plain(q.data.selectedDates),fourDays);
const historical={historicalBackfill:true,paymentMode:'paid',expectedTotal:q.data.total};
const readsBefore=memberReads;
assert.match((await create(fourDays,historical)).error,/實際收款時間/);
assert.match((await create(fourDays,{...historical,paidAt:'2026-02-30T00:05'})).error,/實際收款時間/);
assert.match((await create(fourDays,{...historical,paidAt:'2026-10-18T00:05',expectedTotal:2899})).error,/重新試算/);
assert.equal((await create(['2026-10-22'],{...historical,paidAt:'2026-10-18T00:05'})).ok,false);
assert.equal(memberReads,readsBefore,'reject before even fetching the member');
assert.equal(writes.length,0,'invalid requests never write, claim or release a stall');
assert.equal((await create(fourDays,{...historical,paidAt:'2026-10-18T00:05'})).ok,true);
assert.equal(writes.filter(x=>x.routine).length,0,'historical backfill does not claim current capacity');
const reg=writes.find(x=>x.table==='registrations').row,payment=writes.find(x=>x.table==='payments').row;
assert.deepEqual(plain(reg.selected_dates_json),fourDays);
assert.equal(reg.paid_at,'2026-10-17T16:05:00.000Z');
assert.equal(payment.paid_at,reg.paid_at); assert.equal(payment.amount,2900);
assert.deepEqual(plain(writes.filter(x=>x.table==='registration_day_ops').map(x=>x.row.activity_date)),fourDays);
assert.equal(writes.filter(x=>x.table==='registration_day_ops').at(-1).row.deposit_status,'未退押金');
assert.equal(writes.filter(x=>x.table==='registration_day_ops')[0].row.deposit_status,'不適用');

writes.length=0;
session={dates_json:[{date:'2026-02-30',fee:700}],created_at:now};
assert.match((await quote(['2026-02-30'])).error,/沒有可用的參加日期/);
authorised=false;
assert.equal((await quote(fourDays)).error,'無權限');
assert.equal((await create(fourDays,historical)).error,'無權限');
assert.equal(writes.length,0);
console.log('manual registration handler regressions: PASS');

// Exercise the rendered manual date control and submitted request with browser-shaped fixtures.
const fields={amrSessionBody:{innerHTML:''},amrSession:{value:sessionId},amrStalls:{value:1}};
let apiResponse, checkedKeys=[];
const adminVM=vm.createContext({
  AdminManualReg:{session:null,sessionSerial:0,lookupSerial:0},
  $:id=>fields[id],api:async req=>{assert.equal(req.action,'adminManualSession');return apiResponse;},
  invalidateAdminManualPreview:()=>{},
  adminManualUpdateIncludedEquip:()=>{}, adminManualPaymentModeChanged:()=>{},
  safe:v=>String(v),attr:v=>String(v),money:n=>'NT$'+n,
  document:{querySelectorAll:query=>query==='.amrDate:checked'?checkedKeys.map(value=>({value})):[]},
});
const renderStart=admin.indexOf('async function loadAdminManualSession('),renderEnd=admin.indexOf('function adminManualUpdateIncludedEquip(',renderStart);
const payloadStart=admin.indexOf('function adminManualPayload('),payloadEnd=admin.indexOf('function adminManualPaymentModeChanged(',payloadStart);
vm.runInContext(admin.slice(renderStart,renderEnd)+admin.slice(payloadStart,payloadEnd),adminVM);
apiResponse={id:sessionId,dates:[{date:'2026-10-23',fee:600}]};
await adminVM.loadAdminManualSession(sessionId);
assert.match(fields.amrSessionBody.innerHTML,/版本尚未同步/);
assert.equal(adminVM.AdminManualReg.session,null,'a new UI refuses to submit through an old Worker');

authorised=true;
session={dates_json:[{startDate:'2026-10-23',endDate:'2026-10-25',optionId:'RNG_full',fee:2900}]};
apiResponse=(await workerVM.hAdminManualSession({},args)).data;
await adminVM.loadAdminManualSession(sessionId);
assert.match(fields.amrSessionBody.innerHTML,/value="2026-10-23::RNG_full" checked/);
assert.match(fields.amrSessionBody.innerHTML,/歷史場次補登" selected/);
assert.match(fields.amrSessionBody.innerHTML,/實際收款時間（台灣時間，與參加日期分開）/);
checkedKeys=['2026-10-23::RNG_full'];
fields.amrPaidAt={value:'2026-10-18T00:05'};
assert.deepEqual(plain(adminVM.adminManualPayload().selectedDates),checkedKeys);
assert.equal(adminVM.adminManualPayload().paidAt,'2026-10-18T00:05');
assert.equal((await quote(adminVM.adminManualPayload().selectedDates)).data.total,2900);
console.log('manual registration form regressions: PASS');
