import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin = fs.readFileSync('admin.html', 'utf8');
const worker = fs.readFileSync('worker.js', 'utf8');

assert.match(admin, /openPhotoActivitySettings\(\)/, '後台缺少互動拍照活動入口');
assert.match(admin, /ownerOnly=\[[^\]]*'openPhotoActivitySettings'/, '互動拍照活動未限制為租戶總管理者入口');
assert.match(admin, /action:'getPhotoActivityConfig'/, '後台未讀取正式活動設定');
assert.match(admin, /action:'savePhotoActivityConfig'/, '後台未保存正式活動設定');
assert.match(admin, /activityUrl:get\('pa_activity_url'\)/, '活動網址未納入同一筆設定保存');
assert.match(admin, /galleryUrl:get\('pa_gallery_url'\)/, '公開相簿網址未納入同一筆設定保存');
assert.match(admin, /adminUrl:get\('pa_admin_url'\)/, '相簿管理入口未納入同一筆設定保存');

assert.match(worker, /id=eq\.\$\{TENANT\}&select=config_json/, '設定讀取未鎖定 tenant');
assert.match(worker, /id=eq\.\$\{TENANT\}`\s*,\s*\{config_json:/, '設定寫入未鎖定 tenant');
assert.match(worker, /verifyStaff\(env,b\.email,b\.token,TENANT,'superadmin'\)/, '設定寫入未限制最高租戶管理權限');
assert.match(worker, /case 'getPhotoActivityConfig': return hGetPhotoActivityConfig/, '公開讀取 action 未接線');
assert.match(worker, /case 'savePhotoActivityConfig': return hSavePhotoActivityConfig/, '管理寫入 action 未接線');
assert.doesNotMatch(worker, /DEFAULT_PHOTO_ACTIVITY_CONFIG[\s\S]{0,5000}(?:adminPin|staffPin|downloadToken|password)/i, '公開活動設定含敏感欄位');
assert.doesNotMatch(worker, /tobeloved-api|thecorner|gracegift|playevent/, '互動拍照整合混入 DOING 環境');

console.log(JSON.stringify({ok:true, feature:'photo-activity-settings', tenant:'tuibile'}));
