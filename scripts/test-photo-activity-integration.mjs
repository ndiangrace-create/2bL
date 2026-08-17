import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin = fs.readFileSync('admin.html', 'utf8');
const worker = fs.readFileSync('worker.js', 'utf8');

const settingsSection = admin.match(/<section id="page-settings"[\s\S]*?<\/section>/)?.[0] || '';
const settingLabels = [...settingsSection.matchAll(/<b>([^<]+)<\/b>/g)].map(match => match[1]);
const settingHandlers = [...settingsSection.matchAll(/<button class="settings-tile" onclick="([^("]+)\(\)"/g)].map(match => match[1]);
const originalSettingLabels = [
  '信件模板',
  '付款資訊',
  '合約管理',
  '權限管理',
  '公司資料',
  '首頁顯示',
  '主題活動',
  '常用場地圖',
  '活動拍照框',
  '現場通行碼',
  '系統異常',
];
const originalSettingHandlers = [
  'openEmailTemplates',
  'openPaymentSettings',
  'openAgreementSettings',
  'openStaffSettings',
  'openCompanySettings',
  'openHomepageSettings',
  'openThemeEvents',
  'openVenueMaps',
  'openPhotoFrames',
  'openOnsitePasscodes',
  'openErrorLogs',
];

assert.deepEqual(
  settingLabels.slice(0, originalSettingLabels.length),
  originalSettingLabels,
  '原有系統設定的名稱、順序或數量遭到改動',
);
assert.equal(settingLabels.length, originalSettingLabels.length + 1, '活動頁面管理必須是唯一新增的設定入口');
assert.equal(settingLabels.at(-1), '互動拍照活動', '活動頁面管理必須獨立放在原有設定之後');
assert.deepEqual(
  settingHandlers,
  [...originalSettingHandlers, 'openPhotoActivitySettings'],
  '原有系統設定入口遭到替換，或新活動入口沒有獨立放在最後',
);
for (const handler of settingHandlers) {
  assert.match(admin, new RegExp(`function\\s+${handler}\\s*\\(`), `設定入口 ${handler} 沒有實際功能`);
}

assert.match(admin, /openPhotoActivitySettings\(\)/, '後台缺少互動拍照活動入口');
assert.match(admin, /ownerOnly=\[[^\]]*'openPhotoActivitySettings'/, '互動拍照活動未限制為租戶總管理者入口');
assert.match(admin, /action:'getPhotoActivityAdminConfig'/, '後台未使用受保護的管理設定入口');
assert.doesNotMatch(admin, /api\(\{action:'getPhotoActivityConfig'\}\)/, '後台不得使用公開活動設定入口讀取管理網址');
assert.match(admin, /action:'savePhotoActivityConfig'/, '後台未保存正式活動設定');
assert.match(admin, /activityUrl:get\('pa_activity_url'\)/, '活動網址未納入同一筆設定保存');
assert.match(admin, /galleryUrl:get\('pa_gallery_url'\)/, '公開相簿網址未納入同一筆設定保存');
assert.match(admin, /adminUrl:get\('pa_admin_url'\)/, '相簿管理入口未納入同一筆設定保存');
assert.match(admin, /paOpen\(AdminPhotoActivity\.activityUrl\)/, '缺少活動網站入口');
assert.match(admin, /paShare\(AdminPhotoActivity\.activityUrl/, '缺少活動網站分享功能');
assert.match(admin, /paOpen\(AdminPhotoActivity\.galleryUrl\)/, '缺少公開相簿入口');
assert.match(admin, /paShare\(AdminPhotoActivity\.galleryUrl/, '缺少公開相簿分享功能');
assert.match(admin, /paOpen\(AdminPhotoActivity\.adminUrl\)/, '缺少相簿管理及整本下載入口');
assert.match(admin, /pa_hero_desktop/, '缺少電腦版活動底圖設定');
assert.match(admin, /pa_hero_mobile/, '缺少手機版活動底圖設定');
assert.match(admin, /pa_primary/, '缺少活動主色設定');
assert.match(admin, /pa_accent/, '缺少活動點綴色設定');
assert.match(admin, /pa_paper/, '缺少活動底色設定');
assert.match(admin, /pa_tasks/, '缺少隨機任務題庫設定');
assert.match(admin, /frames:\[0,1,2\]\.map/, '三款活動相框未完整保存');

const getHandler = worker.match(/async function hGetPhotoActivityConfig\(env,p\)\{[\s\S]*?\n\}/)?.[0] || '';
const getAdminHandler = worker.match(/async function hGetPhotoActivityAdminConfig\(env,p\)\{[\s\S]*?\n\}/)?.[0] || '';
const saveHandler = worker.match(/async function hSavePhotoActivityConfig\(env,b\)\{[\s\S]*?\n\}/)?.[0] || '';

assert.match(getHandler, /id=eq\.\$\{TENANT\}&select=config_json/, '設定讀取未鎖定 tenant');
assert.doesNotMatch(getHandler, /dbUpdate|dbInsert|dbDelete/, '讀取活動設定時禁止改寫任何原有設定');
assert.match(getHandler, /const \{adminUrl,\.\.\.publicConfig\}=full/, '公開活動設定未移除管理入口');
assert.match(getHandler, /return jsonOk\(publicConfig\)/, '公開活動設定未使用安全白名單結果');
assert.match(getAdminHandler, /verifyStaff\(env,p\.email,p\.token,TENANT,'superadmin'\)/, '活動管理設定未限制為總管理者');
assert.match(getAdminHandler, /return jsonOk\(_photoActivityConfig/, '總管理者無法讀取完整活動管理設定');
assert.match(worker, /cfg\.photoActivity\|\|DEFAULT_PHOTO_ACTIVITY_CONFIG/, '未儲存前應只讀取安全預設，不得改動既有主辦設定');
assert.match(saveHandler, /verifyStaff\(env,b\.email,b\.token,TENANT,'superadmin'\)/, '設定寫入未限制最高租戶管理權限');
assert.match(saveHandler, /select=config_json/, '儲存前未讀取既有設定');
assert.match(saveHandler, /config\.photoActivity=_photoActivityConfig\(b\.config\)/, '活動設定未限制在獨立 photoActivity 區塊');
assert.match(saveHandler, /dbUpdate\(env,'tenants',`id=eq\.\$\{TENANT\}`,\{config_json:JSON\.stringify\(config\)\}\)/, '設定寫入未鎖定 tenant 或未保留完整設定物件');
assert.doesNotMatch(saveHandler, /const\s+config\s*=\s*\{\s*photoActivity\s*:/, '禁止用新活動設定取代整份原有設定');
assert.match(worker, /case 'getPhotoActivityConfig': return hGetPhotoActivityConfig/, '公開讀取 action 未接線');
assert.match(worker, /case 'getPhotoActivityAdminConfig': return hGetPhotoActivityAdminConfig/, '管理讀取 action 未接線');
assert.match(worker, /case 'savePhotoActivityConfig': return hSavePhotoActivityConfig/, '管理寫入 action 未接線');
assert.match(fs.readFileSync('lib/admin-authorization.js', 'utf8'), /'getPhotoActivityAdminConfig'/, '管理讀取 action 未納入租戶設定權限保護');
assert.doesNotMatch(worker, /DEFAULT_PHOTO_ACTIVITY_CONFIG[\s\S]{0,5000}(?:adminPin|staffPin|downloadToken|password)/i, '公開活動設定含敏感欄位');
assert.doesNotMatch(worker, /tobeloved-api|thecorner|gracegift|playevent/, '互動拍照整合混入 DOING 環境');

console.log(JSON.stringify({ok:true, feature:'photo-activity-settings', tenant:'tuibile'}));
