import fs from 'node:fs';

const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const worker=read('worker.js'),admin=read('admin.html'),onsite=read('onsite.html'),index=read('index.html');
const migration=read('supabase/onsite_daily_finance_integrity.sql');
const depositStatusMigration=read('supabase/deposit_return_status_only.sql');
const backfill=read('supabase/backfill_daily_checkins_safe.sql');
const depositNormalize=read('supabase/normalize_daily_deposit_status_safe.sql');
const financeDateRepair=read('supabase/repair_bundle_dates_finance_safe.sql');
function ok(value,message){if(!value)throw new Error(message);}

const routes=new Set([...worker.matchAll(/case\s+['"]([^'"]+)['"]\s*:/g)].map(x=>x[1]));
for(const [name,source] of [['admin.html',admin],['onsite.html',onsite],['index.html',index]]){
  const actions=new Set([
    ...[...source.matchAll(/action\s*:\s*['"]([^'"]+)['"]/g)].map(x=>x[1]),
    ...[...source.matchAll(/api(?:Get|Post)\(\s*['"]([^'"]+)['"]/g)].map(x=>x[1]),
  ]);
  const missing=[...actions].filter(x=>!routes.has(x));
  ok(!missing.length,`${name} 尚有未接後端操作：${missing.join('、')}`);
}

ok(worker.includes("registration_day_ops"),'現場操作未使用每日資料表');
ok(worker.includes("const dayPaid=paid.filter"),'現場場次卡片仍可能顯示跨日累計');
ok(worker.includes('dayStats: dates.map'),'工讀生入口未提供每一天獨立統計');
ok(worker.includes('teardownDone:rows.filter'),'場次入口未提供每日撤場進度');
ok(worker.includes('depositPendingCount:Math.max'),'場次入口未提供每日待退押金進度');
ok(onsite.includes('現在先處理：未報到'),'現場頁缺少下一步工作提醒');
ok(onsite.includes('押金：最後一天處理'),'第一天未提醒押金最後一天處理');
ok(onsite.includes("openSession('${esc(s.id)}','${esc(x.activityDate||'')}')"),'工讀生入口無法從日期按鈕直接進入當日名單');
ok(admin.includes('const sessionChanged=!!AdminState.onsite.sid'),'後台切換場次時仍可能沿用上一場日期狀態');
ok(admin.includes('不同場次絕不共用名單'),'後台未清楚標示場次隔離');
ok(onsite.includes('報到 ${x.checkedIn||0}/${x.payable||0}'),'手機現場入口未清楚標示每日報到數字');
ok(onsite.includes('grid-template-columns:repeat(6,minmax(0,1fr))'),'電腦版現場操作未改成整齊小格按鈕');
ok(onsite.includes('grid-template-columns:repeat(2,minmax(0,1fr))!important'),'手機現場操作未改成兩欄大按鈕');
ok(!onsite.includes('grid-template-columns:1fr 110px'),'現場卡片仍把操作塞在狹窄右欄');
ok(admin.includes('ACTION_LAYOUT_GUARD_20260816'),'後台缺少全系統操作按鈕防擠壓規則');
ok(onsite.includes('UNIFIED_ACTION_COLOR_20260816'),'現場操作按鈕尚未統一成單一色系');
ok(onsite.includes('COMPACT_DESKTOP_REG_CARDS_20260816'),'電腦版攤商卡仍未改成場次式並排小卡');
ok(onsite.includes('#regsList{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))'),'電腦版攤商卡未固定兩張並排');
ok(onsite.includes('#regsList>.onsite-refund-summary{grid-column:1/-1'),'退款摘要會占掉第一張卡的位置，導致首張卡從右邊開始');
ok(onsite.includes('#regsList .reg .kv{grid-template-columns:72px minmax(0,1fr) 72px minmax(0,1fr)'),'電腦版攤商資料仍是過長單欄');
ok(onsite.includes('.reg-actions button,\n.mobile-reg-buttons button,\n.reg-more-actions button'),'電腦與手機按鈕未共用相同配色');
ok(onsite.includes('background:#eef4f1!important;\n  color:#334640!important;'),'操作按鈕未使用統一的質感淺色系');
ok(onsite.includes('button:disabled{opacity:1'),'停用按鈕仍可能呈現混濁疊色');
ok(worker.includes("兩天／多天報名只能在最後一個參加日退押金"),'缺少最後一天退押金阻擋');
ok(worker.includes("請先完成當日撤場，再退押金"),'缺少撤場後才能退押金阻擋');
ok(worker.includes("set_deposit_return_status_atomic"),'退押金未使用獨立狀態原子操作');
ok(worker.includes("activityCreditTotal"),'財務未拆出活動金');
ok(worker.includes("revenueTotal: invoiceTotal"),'營收未排除押金');
ok(worker.includes("summary?.finance?.revenueTotal"),'分潤仍可能使用含押金金額');
ok(worker.includes('function _singleRegistrationDeposit'),'缺少每筆報名押金只計一次的共用規則');
ok(worker.includes('Math.min(raw, configured)'),'舊資料重複押金未封頂為場次押金');
ok(worker.includes('const distributableProfit=confirmedRevenue-expenseAmount;'),'分潤仍可能把已排除的退款再扣一次');
ok(worker.includes('refundAlreadyReflected:true'),'財報未明示退款已反映在目前營業收入');
ok(!worker.includes('const distributableProfit=confirmedRevenue-refundAmount-expenseAmount;'),'場次報表仍重複扣退款');
ok(admin.includes('已收總額（含押金）')&&admin.includes('營業收入（不含押金）'),'後台未分開顯示總收入、營業收入與押金');
ok(admin.includes('有效報名品牌')&&admin.includes('租用攤位數總計')&&admin.includes('單日最高使用量'),'後台仍混用品牌、租用攤位與單日使用量');
const currentFinance={totalIncome:41440,deposit:7500,businessRevenue:33940,refundHistory:9700,expense:18360};
ok(currentFinance.totalIncome-currentFinance.deposit===currentFinance.businessRevenue,'高火北總收入、押金與營業收入對帳失敗');
ok(currentFinance.businessRevenue-currentFinance.expense===15580,'高火北可分配盈餘不正確');
ok((currentFinance.businessRevenue-currentFinance.expense)/2===7790,'高火北 50/50 分潤不正確');
ok(onsite.includes("'depositUnrefund'"),'現場缺少撤銷誤按退押金');
ok(admin.includes("depositUnrefund:'確認撤銷")&&onsite.includes("depositUnrefund:'確認撤銷"),'撤銷退押金缺少二次確認');
ok(admin.includes("'撤銷已退押金 '+money(dep)")&&onsite.includes("'撤銷已退押金 '+money(r.deposit||0)"),'押金切換按鈕未顯示應退金額');
ok(depositStatusMigration.includes('set_deposit_return_status_atomic')&&depositStatusMigration.includes("tenant_id='tuibile' and refund_scope='deposit' and status='已退款'"),'資料庫未將兔彼樂押金狀態與正式退款切開');
ok(!/delete\s+from\s+public\.refund_transactions/i.test(depositStatusMigration),'押金狀態修正不可刪除歷史紀錄');
ok(!/payment_status|checkin_status|teardown_status\s*=|stall_number/i.test(depositStatusMigration.replace(/if coalesce\(v_op\.teardown_status[\s\S]*?end if;/,'')),'撤銷退押金不可改付款、報到、撤場或排位');
ok(admin.includes("filter==='notDeposit')rows=rows.filter(r=>r.depositEligible")&&onsite.includes("onsiteQuickFilter==='notDeposit')return r.depositEligible"),'第一天仍可能誤列為待退押金');
ok(migration.includes('guard_deposit_refund_transaction'),'資料庫缺少退押金保護');
ok(migration.includes('member_notifications'),'會員通知資料表 migration 缺失');
ok(backfill.includes("r.checkin_status='已報到'")&&backfill.includes('on conflict(tenant_id,registration_id,activity_date)'),'既有報到資料缺少安全保留回填');
ok(!/\bdelete\b|\btruncate\b/i.test(backfill.replace(/^--.*$/gm,'')),'既有報到安全回填不可刪除資料');
ok(depositNormalize.includes("o.activity_date<>r.last_day")&&depositNormalize.includes("set deposit_status='不適用'"),'舊押金狀態未限制為非最後參加日校正');
ok(!/refund_transactions|update\s+public\.registrations/i.test(depositNormalize.replace(/^--.*$/gm,'')),'每日押金校正不可改正式退款交易或全域押金結果');
ok(financeDateRepair.includes("id in ('RMRTDEII574','RMRTDVCI6LZ','RMRTJBMKV8B','RMRU1KJ3X9P','RMRVP28KRLP','RMRVP9BNQ3H')"),'舊組合報名日期修復範圍不完整');
ok(financeDateRepair.includes("id = 'RMRVP02KDAS'"),'美島舊組合子報名日期未納入修復');
ok(!/\bdelete\b|\btruncate\b/i.test(financeDateRepair.replace(/^--.*$/gm,'')),'舊場次財務修復不可刪除資料');

console.log('每日報到、撤場、押金、活動金、正式金流與按鈕接線測試通過。');
