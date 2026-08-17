import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');

assert.match(html, /const MEMBER_TOKEN_KEY='2bl_member_token'/,
  '我的紀錄缺少正式的 30 天登入憑證鍵');
assert.match(html, /localStorage\.setItem\(MEMBER_TOKEN_KEY,value\)/,
  '登入成功後沒有把安全憑證保存在目前裝置');
assert.match(html, /apiPost\(\{action:'memberEmailPhoneLogin',email,phone\}\)/,
  'Email＋手機登入沒有改走安全憑證簽發');
assert.match(html, /apiPost\(\{action:'memberSession',memberToken:savedToken\}\)/,
  '重新整理後沒有向後端驗證並恢復會員登入');
assert.match(html, /apiPost\(\{action:'getMyRegs',memberToken:token\}\)/,
  '已登入會員查詢紀錄時仍可能重送手機');
assert.match(html, /if\(token\|\|\(email&&phone\)\)/,
  '我的紀錄入口沒有優先使用已保存的安全憑證');
assert.match(html, /localStorage\.removeItem\('2bl_member_token'\)/,
  '登出沒有清除安全憑證');
assert.doesNotMatch(html, /sessionStorage\.setItem\([^\n]*phone/i,
  '手機不可保存於 sessionStorage');
assert.doesNotMatch(html, /localStorage\.setItem\([^\n]*phone/i,
  '手機不可保存於 localStorage');

const storage = () => {
  const data = new Map();
  return {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    has: key => data.has(key),
  };
};
const localStorage = storage();
const context = vm.createContext({
  ST: {memberEmail:'vendor@example.com', member:null, memberToken:''},
  localStorage,
  String,
});
const helperStart = html.indexOf("const MEMBER_TOKEN_KEY='2bl_member_token'");
const helperEnd = html.indexOf('function memberShowLogin()', helperStart);
assert.ok(helperStart > 0 && helperEnd > helperStart, '無法取得會員憑證函式');
vm.runInContext(html.slice(helperStart, helperEnd), context);

vm.runInContext("memberSaveToken('signed.jwt.token'); memberSavePhone('0912345678','vendor@example.com')", context);
assert.equal(localStorage.getItem('2bl_member_token'), 'signed.jwt.token', '安全憑證應保留在目前裝置');
assert.equal(vm.runInContext('memberSafeToken()', context), 'signed.jwt.token', '重新整理後應能讀回安全憑證');
assert.equal(context.ST.member.phone, '0912345678', '本次頁面仍需在記憶體使用已驗證手機');
assert.equal(localStorage.has('tb_member_phone'), false, '手機不可長期保存在瀏覽器');
vm.runInContext('memberClearToken()', context);
assert.equal(localStorage.has('2bl_member_token'), false, '主動登出時應移除安全憑證');

console.log(JSON.stringify({ok:true, feature:'member-record-30-day-token'}));
