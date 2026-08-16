import fs from 'node:fs';
import assert from 'node:assert/strict';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const index=read('index.html');
const admin=read('admin.html');
const worker=read('worker.js');

for(const [name,html] of [['index.html',index],['admin.html',admin]]){
  for(const source of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(x=>x[1])){
    assert.doesNotThrow(()=>new Function(source),name+' 內嵌程式語法錯誤');
  }
}
assert.doesNotThrow(()=>new Function(worker.replace(/^export\s+default\s*\{/m,'const __workerExport={')),'worker.js 語法錯誤');

assert.match(worker,/async function finalizeRegistrationSafely\(/,'報名主交易後必須有獨立的安全收尾層');
assert.match(worker,/await finalizeRegistrationSafely\(env, TENANT, b, ses, id, meta, ctx\)/,'單場報名必須走安全收尾層');
assert.match(worker,/await finalizeRegistrationSafely\(env, T, bb, prep\.ses, prep\.id, prep\.meta, ctx\)/,'組合報名必須走安全收尾層');
assert.doesNotMatch(worker,/await finalizeRegistration\(env, TENANT, b, ses, id, meta, ctx\);\s*return jsonOk/,'不得讓附帶工作推翻已成立的單場報名');
assert.match(worker,/MEMBER UPSERT FAILED reg=/,'會員同步失敗必須被記錄而非推翻報名');

assert.match(index,/function recoverCommittedRegistration\(/,'前台必須能在送出回覆遺失時回查正式報名');
assert.match(index,/isAmbiguousRegisterTransportError\(res\.error\)/,'只有不確定的網路錯誤才能啟動回查');
assert.match(index,/res=\{success:true,ok:true,id:committed\.id/,'回查到已入庫報名時必須恢復成功畫面');

assert.match(admin,/async function resumeAdminSession\(/,'後台恢復舊登入前必須先驗證 token');
assert.match(admin,/showAdminLogin\('登入已過期，請重新使用 Google 登入。'\)/,'過期登入必須回到可操作的登入頁');
assert.match(admin,/await resumeAdminSession\(s\)/,'開機不得直接信任手機留下的舊 token');
assert.match(admin,/scope_type.*event|scopeEventId|scope_event_id/,'後台仍須保留活動範圍權限，不可因修登入而打破租戶隔離');

console.log('報名／後台隔離測試通過：已入庫不誤報失敗、網路回查、過期登入自動復原。');
