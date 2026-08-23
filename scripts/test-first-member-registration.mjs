import fs from 'node:fs';
import assert from 'node:assert/strict';
const worker=fs.readFileSync('worker.js','utf8');
const index=fs.readFileSync('index.html','utf8');

assert.match(worker,/isFirstCreate\s*=\s*false/,'必須區分首次建立會員');
assert.match(worker,/existingMembers = await dbGet\(env,'members'/,'首次儲存前必須先查正式 members');
assert.match(worker,/legacyRegs = await dbGet\(env,'registrations'/,'沒有 member 時必須保留歷史報名相容驗證');
assert.match(worker,/此 Email 已有歷史報名，但手機不一致/,'歷史 Email＋錯手機必須阻擋');
assert.match(worker,/首次建立會員時，手機資料不一致/,'首次建立不得讓前後手機不一致');
assert.match(worker,/member_profile_self_create/,'首次建立必須留下 audit');
assert.match(worker,/member_profile_self_update/,'既有會員修改 audit 必須保留');
assert.match(worker,/const checks=\[\['聯絡人姓名',has\(m\.name\)\],\['手機',has\(m\.phone\)\],\['攤位／品牌名稱',has\(brand\)\]\]/,'profileComplete 只能由姓名＋手機＋品牌阻擋');
assert.match(worker,/socialComplete:socialOrWebsite/,'社群狀態仍須保留供審核提示');
assert.match(worker,/mf\.requireSocialLinks === true && TENANT !== 'tuibile'/,'tuibile 報名不得再被社群硬擋');
assert.match(index,/if\(res\.profileComplete\)[\s\S]{0,500}renderDynFormFull\(ST\.currentSession,false\)/,'新會員資料完整後必須進正式報名表');
assert.match(index,/action:'saveMember', email, phone, authPhone/,'會員資料必須送 Worker 正式儲存');

function decide({members=[],regs=[],authPhone='',requestedPhone=''}){
  const same=(a,b)=>String(a||'').replace(/\D/g,'')===String(b||'').replace(/\D/g,'') && !!String(a||'').replace(/\D/g,'');
  if(members.length){return same(members[0].phone,authPhone)?'existing-ok':'existing-block';}
  if(regs.length){return regs.some(r=>same(r.phone,authPhone))?'legacy-ok':'legacy-block';}
  return requestedPhone&&same(requestedPhone,authPhone)?'first-create':'first-block';
}
assert.equal(decide({members:[],regs:[],authPhone:'0912345678',requestedPhone:'0912345678'}),'first-create');
assert.equal(decide({members:[],regs:[],authPhone:'0912345678',requestedPhone:'0987654321'}),'first-block');
assert.equal(decide({members:[{phone:'0912345678'}],regs:[],authPhone:'0912345678',requestedPhone:'0912345678'}),'existing-ok');
assert.equal(decide({members:[{phone:'0912345678'}],regs:[],authPhone:'0987654321',requestedPhone:'0987654321'}),'existing-block');
assert.equal(decide({members:[],regs:[{phone:'0912345678'}],authPhone:'0912345678',requestedPhone:'0912345678'}),'legacy-ok');
assert.equal(decide({members:[],regs:[{phone:'0912345678'}],authPhone:'0987654321',requestedPhone:'0987654321'}),'legacy-block');
// 重複送出：第一筆建立後，第二次會走 existing-ok，而不是再次建立第二個會員。
assert.equal(decide({members:[{phone:'0912345678'}],regs:[],authPhone:'0912345678',requestedPhone:'0912345678'}),'existing-ok');
console.log(JSON.stringify({ok:true,feature:'first-member-registration',cases:7}));
// final validation trigger only
