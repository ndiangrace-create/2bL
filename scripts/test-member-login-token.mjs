import assert from 'node:assert/strict';
import worker from '../worker.js';

const tenantId='tuibile';
const env={
  JWT_SECRET:'member-token-test-secret',
  AUTH_SECRET:'legacy-test-secret',
  SUPABASE_URL:'https://mock.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY:'test-service-role',
};
const originalPhone='0912345678';
const state={
  member:{
    email:'vendor@example.com', tenant_id:tenantId, name:'測試攤友', phone:originalPhone,
    brand_name:'測試品牌', fb_url:'https://example.com/vendor', joined_at:'2026-08-01T00:00:00Z',
  },
};
const registration={
  id:'REG_TOKEN_TEST', tenant_id:tenantId, member_id:'vendor@example.com', email:'vendor@example.com',
  phone:originalPhone, session_id:'SES_TOKEN_TEST', review_status:'已錄取', payment_status:'已繳費',
  amount:1500, total_amount:1500, paid_amount:1500, deposit:500, stall_count:1,
  selected_dates_json:['2026-08-30'], equipment_json:{}, payment_profile_snapshot:{
    payment_profile_id:'PAY_TEST', payment_profile_name:'測試收款', payment_owner_mode:'tenant',
    allowed_methods:{bank:true,linepay:false,card:false}, bank_account:{}, linepay:{}, card:{},
  }, created_at:'2026-08-01T00:00:00Z',
};
const session={
  id:'SES_TOKEN_TEST', tenant_id:tenantId, name:'測試場次', event_id:'EVT_TEST', venue:'測試場地',
  dates_json:['2026-08-30'], equip_json:{}, basic_equip:{}, payment_profile_id:'PAY_TEST',
  seat_pricing_enabled:false, seat_hold_hours:24, seat_layout_published_at:null, force_cancel:false,
};

const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init={})=>{
  const url=new URL(String(input));
  const table=url.pathname.split('/').pop();
  const method=String(init.method||'GET').toUpperCase();
  const tenantFilter=String(url.searchParams.get('tenant_id')||'');
  const emailFilter=decodeURIComponent(String(url.searchParams.get('email')||''));

  if(method==='PATCH'&&table==='members'){
    Object.assign(state.member,JSON.parse(init.body||'{}'));
    return new Response('',{status:204});
  }
  if(method==='POST'&&table==='members'){
    Object.assign(state.member,JSON.parse(init.body||'{}'));
    return Response.json([state.member],{status:201});
  }
  if(table==='members'){
    if(tenantFilter&&!tenantFilter.includes(state.member.tenant_id)) return Response.json([]);
    if(emailFilter&&!emailFilter.toLowerCase().includes(state.member.email)) return Response.json([]);
    return Response.json([{...state.member}]);
  }
  if(table==='registrations'){
    if(tenantFilter&&!tenantFilter.includes(registration.tenant_id)) return Response.json([]);
    if(emailFilter&&!emailFilter.toLowerCase().includes(registration.email)) return Response.json([]);
    return Response.json([{...registration}]);
  }
  if(table==='sessions') return Response.json([{...session}]);
  if(table==='registration_day_seats') return Response.json([]);
  if(table==='error_logs') return Response.json([]);
  return Response.json([]);
};

async function post(body){
  const response=await worker.fetch(new Request('https://worker.test/',{
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({tenant:tenantId,...body}),
  }),env,{waitUntil(){}});
  return response.json();
}

function decodePayload(token){
  const body=String(token).split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
  const padded=body+'='.repeat((4-body.length%4)%4);
  return JSON.parse(Buffer.from(padded,'base64').toString('utf8'));
}

try{
  const wrong=await post({action:'memberEmailPhoneLogin',email:state.member.email,phone:'0999999999'});
  assert.match(wrong.error,/手機與會員資料不一致/,'錯誤手機不得取得登入憑證');
  assert.equal(wrong.token,undefined);

  const loginStarted=Date.now();
  const login=await post({action:'memberEmailPhoneLogin',email:state.member.email,phone:originalPhone});
  assert.equal(login.error,undefined);
  assert.ok(login.token&&login.member,'正確 Email＋手機應簽發會員憑證');
  assert.equal(login.member.email,state.member.email);
  const claims=decodePayload(login.token);
  assert.equal(claims.type,'member');
  assert.equal(claims.tenant_id,tenantId);
  assert.equal(claims.email,state.member.email);
  assert.equal(claims.auth_method,'email_phone');
  assert.equal(Object.prototype.hasOwnProperty.call(claims,'phone'),false,'憑證內不得保存手機');
  assert.ok(claims.identity_sig,'憑證必須綁定目前會員身分');
  assert.ok(claims.expires_at>=loginStarted+30*24*60*60*1000-1000,'憑證有效期必須為 30 天');
  assert.ok(claims.expires_at<=loginStarted+30*24*60*60*1000+5000,'憑證不可超過 30 天');

  const restored=await post({action:'memberSession',memberToken:login.token});
  assert.equal(restored.error,undefined,'同一裝置重新整理後應能恢復登入');
  assert.equal(restored.member.phone,originalPhone);

  const records=await post({action:'getMyRegs',memberToken:login.token});
  assert.ok(Array.isArray(records),'安全憑證應能查詢自己的報名紀錄');
  assert.deepEqual(records.map(row=>row.id),[registration.id]);

  const crossTenantResponse=await worker.fetch(new Request('https://worker.test/',{
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({tenant:'another-tenant',action:'memberSession',memberToken:login.token}),
  }),env,{waitUntil(){}});
  assert.match((await crossTenantResponse.json()).error,/登入憑證已失效/,'憑證不得跨租戶使用');

  state.member.phone='0987654321';
  const changedIdentity=await post({action:'memberSession',memberToken:login.token});
  assert.match(changedIdentity.error,/登入憑證已失效/,'會員手機更新後舊憑證必須失效');
  state.member.phone=originalPhone;

  const realDateNow=Date.now;
  Date.now=()=>claims.expires_at+1;
  const expired=await post({action:'memberSession',memberToken:login.token});
  Date.now=realDateNow;
  assert.match(expired.error,/登入憑證已失效/,'超過 30 天的憑證必須失效');

  console.log(JSON.stringify({ok:true,feature:'member-login-token',cases:7}));
}finally{
  globalThis.fetch=originalFetch;
}
