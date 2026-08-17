import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin = fs.readFileSync('admin.html', 'utf8');
const worker = fs.readFileSync('worker.js', 'utf8');
const auth = fs.readFileSync('lib/admin-authorization.js', 'utf8');

const section = admin.match(/<section id="page-settings"[\s\S]*?<\/section>/)?.[0] || '';
const labels = [...section.matchAll(/<b>([^<]+)<\/b>/g)].map(m => m[1]);
assert.deepEqual(labels, [
  '信件模板','付款資訊','合約管理','權限管理','公司資料','首頁顯示','主題活動',
  '常用場地圖','活動拍照框','現場通行碼','場次組合','系統異常','互動拍照活動',
]);

assert.match(admin, /function openBundleSettings\(\)/, '場次組合入口沒有實際管理功能');
assert.match(admin, /action:'getBundles'/, '場次組合沒有讀取既有正式資料');
assert.match(admin, /action:'saveBundle'/, '場次組合沒有沿用既有儲存流程');
assert.match(admin, /function sendTestEmail\(btn\)/, '信件模板缺少寄信測試');
assert.match(admin, /action:'testEmail',to/, '寄信測試沒有使用既有正式寄信服務');

assert.match(admin, /el\.style\.display=shouldHide\?'none':''/, '權限載入後必須能恢復被誤隱藏的設定入口');
assert.match(admin, /function adminCanManageBundles\(\)/, '場次組合缺少角色顯示限制');
assert.match(admin, /function updateAdminVersion\(\)/, '後台缺少真正更新頁面版本的功能');
assert.match(admin, /_admin_update/, '更新系統版本必須使用新網址避開舊頁快取');
assert.match(admin, /function checkAdminVersion\(\)/, '後台缺少版本自動檢查');
assert.doesNotMatch(admin, /whoText'\)\.textContent[^\n]+系列隔離版/, '正式畫面不得顯示內部版本文字');

assert.match(auth, /'getBundles', 'saveBundle'/, '場次組合讀寫未納入系列管理權限守門');
assert.match(worker, /\['platform_super_admin','organizer_owner','organizer_admin'\]\.includes\(auth\.role\)/, '場次組合未限制為正確管理角色');
assert.match(worker, /bundle\.sessionIds\.every\(id => allowed\.has\(String\(id\)\)\)/, '指定系列管理者可能讀到其他系列組合');
assert.match(worker, /sids\.some\(id => !allowed\.has\(String\(id\)\)\)/, '指定系列管理者可能寫入其他系列組合');

console.log(JSON.stringify({ok:true, feature:'settings-restoration', settings:labels.length}));
