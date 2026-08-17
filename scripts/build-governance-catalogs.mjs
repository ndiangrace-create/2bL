import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  DESTRUCTIVE_ADMIN_ACTIONS,
  PLATFORM_ADMIN_ACTIONS,
  TENANT_OWNER_ACTIONS,
  SERIES_MANAGER_ACTIONS,
  SESSION_TARGET_ACTIONS,
  REGISTRATION_TARGET_ACTIONS,
} from '../lib/admin-authorization.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = path.join(root, 'docs');
const checkOnly = process.argv.includes('--check');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const audit = JSON.parse(read('.automation/world-tree-source-audit.json'));
const contract = JSON.parse(read('.automation/data-contract-report.json'));
const worker = read('worker.js');

const pageFiles = ['index.html','about.html','admin.html','onsite.html','manage.html','apply.html','consignment.html','pos.html'];
const legacyCandidates = ['index .html','admin .html'];
const sourceFiles = [
  ...pageFiles,
  ...legacyCandidates,
  'worker.js','lib/admin-authorization.js','AUTOMATION.md','DATA_CONTRACT.md','wrangler.jsonc',
  ...fs.readdirSync(path.join(root,'scripts')).filter(x=>x.endsWith('.mjs')).map(x=>'scripts/'+x),
  ...fs.readdirSync(path.join(root,'supabase')).filter(x=>x.endsWith('.sql')).map(x=>'supabase/'+x),
].sort();

function sectionBetween(start, end='') {
  const a = worker.indexOf(start);
  if (a < 0) throw new Error(`找不到 Worker 區段：${start}`);
  const b = end ? worker.indexOf(end, a + start.length) : worker.length;
  return worker.slice(a, b < 0 ? worker.length : b);
}

function actionNames(source) {
  const out = new Set();
  for (const re of [/case\s+['\"]([^'\"]+)['\"]\s*:/g, /action\s*===\s*['\"]([^'\"]+)['\"]/g]) {
    for (const m of source.matchAll(re)) out.add(m[1]);
  }
  return [...out].sort();
}

const getActions = actionNames(sectionBetween('async function routeGet', 'async function routePost'));
const postActions = actionNames(sectionBetween('async function routePost', '// ── SECTION 16'));

const publicActions = new Set([
  'frontBootstrap','getEvents','getSessions','getBundlesPublic','getSession','getSessionAgreement',
  'getMember','getMyRegs','getRegLookup','getAnnouncements','getSeatMap','getSessionShortLink',
  'adminLogin','adminLogout','adminMe','ping','ecpayReturn','linePayConfirm','linePayCancel',
  'register','registerBundle','saveMember','cancelReg','selectStall','claimPaidSeat','submitPayment',
  'submitPaymentBatch','createLinePayOrder','createEcpayOrder','checkMemberEmailPhone',
  'listActivePhotoFrames','getPhotoFrameById','submitPhotoLead','getSiteConfig','getAgreementTemplate',
  'publicFinanceShare','memberNotifications','markMemberNotificationRead','onsitePasscodeVerify',
  'onsiteRegs','onsiteDaySummary','onsiteMark','agreeTransfer','applyRefund','applyForceRefund',
  'applyForceRefundFM','confirmRefund','confirmForceRefund','getRefundSuggestion',
]);

function actionModule(action) {
  if (/Seat|Stall|seat|stall/.test(action)) return '排位與攤位';
  if (/Finance|finance|Payment|payment|Invoice|invoice|Refund|refund|Credit|credit|Settlement/.test(action)) return '金流、退款與財報';
  if (/Member|member/.test(action)) return '會員';
  if (/Staff|staff|Tenant|tenant|Company|SiteConfig|Agreement|EmailTemplate/.test(action)) return '帳號、權限與租戶設定';
  if (/Photo|Visual|VenueMap|uploadCover/.test(action)) return '圖片、相框與場地圖';
  if (/onsite|Onsite|checkin|Checkin|markClear/.test(action)) return '現場與報到';
  if (/Session|session|Event|event|Bundle|bundle|Announcement/.test(action)) return '活動與場次';
  if (/Reg|reg|register|Notify|notify|Invite|Apply|apply/.test(action)) return '報名、審核與通知';
  return '共用與診斷';
}

function accessClass(action) {
  if (PLATFORM_ADMIN_ACTIONS.has(action)) return '平台總管';
  if (TENANT_OWNER_ACTIONS.has(action)) return '租戶擁有者／平台總管';
  if (SERIES_MANAGER_ACTIONS.has(action)) return '指定系列管理者以上';
  if (publicActions.has(action)) return '前台／會員或通行碼流程';
  return '處理器內另行驗證（待逐項收斂）';
}

const purposeMap = {
  tenants:'租戶主資料與整體設定', events:'活動系列', sessions:'活動場次、日期、費用、設備與報名排程',
  registrations:'報名主資料、審核、付款摘要、設備與跨日狀態', members:'會員與品牌資料',
  payments:'付款紀錄', staff:'租戶與平台管理帳號的正式授權來源', platform_staff:'平台總管相容來源',
  staff_session_permissions:'管理者可操作場次範圍', staff_action_logs:'管理者操作紀錄', audit_logs:'全系統操作稽核',
  error_logs:'系統錯誤紀錄', stalls:'攤位版面與占用狀態', seat_maps:'場次排位底圖與設定',
  seat_assignments:'排位指派相容資料', seat_operation_logs:'排位操作紀錄', registration_day_seats:'逐日排位結果',
  registration_day_ops:'逐日報到、撤場與押金狀態', onsite_passcodes:'現場工讀通行碼',
  finance_items:'場次支出與調整項目', finance_item_audit:'財務項目稽核', finance_audit_logs:'財務操作紀錄',
  refund_transactions:'退款與押金退款交易', operation_share_settings:'場次分潤設定', operation_settlements:'場次結算快照',
  finance_share_links:'財報短網址與唯讀分享', short_links:'一般短網址', invoices:'發票資料',
  member_credit_ledger:'會員活動金帳本', member_invoice_profiles:'會員發票抬頭資料', member_notifications:'會員通知',
  registration_items:'報名金流明細相容表', registration_resolutions:'報名取消、退款與保留決議',
  session_bundles:'多場次組合方案', payment_profiles:'收款方式設定', payment_provider_configs:'第三方金流設定預留',
  system_settings:'正式系統設定', tenant_settings:'租戶擴充設定', tenant_agreement_templates:'合約模板',
  announcements:'公告', email_templates:'信件模板', report_templates:'報表模板', report_exports:'報表輸出紀錄',
  report_download_logs:'報表下載紀錄', report_permissions:'報表讀取權限',
  photo_frames:'活動拍照框', photo_leads:'拍照活動聯絡資料', ai_visual_jobs:'AI 視覺產生工作',
  session_visual_assets:'場次視覺素材', venue_map_templates:'場地圖模板',
  consignment_settings:'寄賣場次設定', consignment_slots:'寄賣檔期', consignment_registrations:'寄賣申請',
  consignment_products:'寄賣商品', consignment_product_variants:'寄賣商品規格與條碼',
  consignment_inventory_movements:'寄賣庫存異動', consignment_sales:'寄賣銷售', consignment_sale_items:'寄賣銷售明細',
};

function tableModule(name) {
  if (name.startsWith('consignment_')) return '寄賣與 POS';
  if (/finance|payment|refund|invoice|settlement|credit/.test(name)) return '金流、退款與財報';
  if (/seat|stall/.test(name)) return '排位與攤位';
  if (/onsite|registration_day/.test(name)) return '現場與逐日營運';
  if (/staff|tenant|system_settings|audit_logs|error_logs/.test(name)) return '身分、權限與平台設定';
  if (/photo|visual|venue_map/.test(name)) return '視覺、相框與場地圖';
  if (/report/.test(name)) return '報表';
  if (/member/.test(name)) return '會員';
  if (/registration|event|session|announcement|email_template|agreement/.test(name)) return '活動、場次與報名';
  return '其他正式資料';
}

function tableKeys(table) {
  const pk = audit.primary_keys.filter(x=>x.table===table.name).flatMap(x=>x.columns||[]);
  const fks = audit.foreign_keys.filter(x=>x.table===table.name)
    .map(x=>`${x.column} → ${x.references_table}.${x.references_column}`);
  return {pk,fks};
}

function sha256(rel) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root,rel))).digest('hex');
}

function dataDictionary() {
  const out = ['# 2BL 正式資料字典','',`唯讀來源時間：${audit.generated_at}`,'',
    '本文件由正式 Supabase 結構快照產生，只記錄結構與用途，不含會員、管理者、金流或密鑰內容。',
    '欄位異動必須先更新世界樹、影響範圍與回復方案，經確認後才可執行。',''];
  for (const table of audit.tables) {
    const {pk,fks}=tableKeys(table);
    out.push(`## ${table.name}`,'',`- 模組：${tableModule(table.name)}`,
      `- 用途：${purposeMap[table.name]||'既有正式資料；用途須在後續逐筆驗證後收斂'}`,
      `- RLS：${table.rls_enabled?'已開啟':'未開啟（阻擋）'}`,
      `- 主鍵：${pk.length?pk.join('、'):'未盤出'}`,
      `- 關聯：${fks.length?fks.join('；'):'無正式外鍵或尚未建立'}`,
      `- Worker 使用：${(contract.worker_tables||[]).includes(table.name)?'是':'目前未直接引用或為資料庫內部／預留用途'}`,'',
      '| 欄位 | 型態 | 可空白 | 預設值 |','|---|---|---:|---|');
    for (const col of table.columns||[]) {
      const def=String(col.default??'').replaceAll('|','\\|').replaceAll('\n',' ');
      out.push(`| ${col.name} | ${col.type}${col.udt_name&&col.udt_name!==col.type?` (${col.udt_name})`:''} | ${col.nullable?'是':'否'} | ${def||'—'} |`);
    }
    out.push('');
  }
  out.push('## 正式資料處理程序','',
    '| 名稱 | 參數 | 回傳 | 權限模式 |','|---|---|---|---|');
  for (const r of audit.routines) out.push(`| ${r.name} | ${String(r.identity_arguments||'').replaceAll('|','\\|')} | ${String(r.result_type||'').replaceAll('|','\\|')} | ${r.security_definer?'特權執行；需維持封閉授權':'呼叫者權限'} |`);
  out.push(''); return out.join('\n');
}

function apiCatalog() {
  const rows=[...getActions.map(action=>({method:'GET',action})),...postActions.map(action=>({method:'POST',action}))]
    .sort((a,b)=>a.action.localeCompare(b.action)||a.method.localeCompare(b.method));
  const out=['# 2BL 正式 API 動作目錄','',
    '本目錄由 `worker.js` 的正式路由自動產生。權限欄記錄中央權限層級；標示「處理器內另行驗證」的動作，後續必須逐項確認，不得自行放寬。','',
    '| 方法 | 動作 | 模組 | 權限層級 | 場次範圍 | 報名範圍 | 可刪除／作廢 |','|---|---|---|---|---:|---:|---:|'];
  for(const r of rows) out.push(`| ${r.method} | ${r.action} | ${actionModule(r.action)} | ${accessClass(r.action)} | ${SESSION_TARGET_ACTIONS.has(r.action)?'是':'否'} | ${REGISTRATION_TARGET_ACTIONS.has(r.action)?'是':'否'} | ${DESTRUCTIVE_ADMIN_ACTIONS.has(r.action)?'是':'否'} |`);
  out.push('',`GET：${getActions.length} 個；POST：${postActions.length} 個；合計：${rows.length} 個路由動作。`,'');
  return out.join('\n');
}

function sourceCatalog() {
  const out=['# 2BL 正式檔案目錄','',
    '正式程式只以 GitHub `main` 為基準。工作分支內容未合併前不得視為正式。','',
    '| 檔案 | 狀態 | 大小 | SHA-256 | 用途 |','|---|---|---:|---|---|'];
  for(const rel of sourceFiles){
    const legacy=legacyCandidates.includes(rel);
    let use='正式來源或驗證檔';
    if(pageFiles.includes(rel)) use='正式頁面';
    if(rel==='worker.js') use='唯一正式 Worker 入口';
    if(rel.startsWith('supabase/')) use='資料庫變更腳本；不得自行執行';
    if(rel.startsWith('scripts/')) use='驗證與唯讀盤點';
    if(legacy) use='舊副本候選；引用未確認前禁止刪除';
    const st=fs.statSync(path.join(root,rel));
    out.push(`| ${rel} | ${legacy?'待確認／不可當正式入口':'正式名稱'} | ${st.size} | ${sha256(rel)} | ${use} |`);
  }
  out.push(''); return out.join('\n');
}

const outputs = new Map([
  ['docs/data-dictionary.md',dataDictionary()],
  ['docs/api-action-catalog.md',apiCatalog()],
  ['docs/source-file-catalog.md',sourceCatalog()],
]);

fs.mkdirSync(docsDir,{recursive:true});
let changed=false;
for(const [rel,body] of outputs){
  const file=path.join(root,rel); const next=body.trimEnd()+'\n';
  const current=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
  if(current!==next){changed=true;if(!checkOnly)fs.writeFileSync(file,next);}
}
if(checkOnly&&changed){console.error('治理目錄尚未更新，請執行 node scripts/build-governance-catalogs.mjs');process.exit(1);}
console.log(JSON.stringify({ok:true,checkOnly,changed,getActions:getActions.length,postActions:postActions.length,tables:audit.tables.length,routines:audit.routines.length,files:sourceFiles.length}));
