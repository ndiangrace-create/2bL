import fs from 'node:fs';

const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const worker=read('worker.js'),admin=read('admin.html'),onsite=read('onsite.html'),index=read('index.html');
const migration=read('supabase/onsite_daily_finance_integrity.sql');
const backfill=read('supabase/backfill_daily_checkins_safe.sql');
const depositNormalize=read('supabase/normalize_daily_deposit_status_safe.sql');
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
ok(onsite.includes('.reg-actions button,\n.mobile-reg-buttons button,\n.reg-more-actions button'),'電腦與手機按鈕未共用相同配色');
ok(onsite.includes('background:#eef4f1!important;\n  color:#334640!important;'),'操作按鈕未使用統一的質感淺色系');
ok(onsite.includes('button:disabled{opacity:1'),'停用按鈕仍可能呈現混濁疊色');
ok(worker.includes("兩天／多天報名只能在最後一個參加日退押金"),'缺少最後一天退押金阻擋');
ok(worker.includes("請先完成當日撤場，再退押金"),'缺少撤場後才能退押金阻擋');
ok(worker.includes("complete_deposit_refund_atomic"),'退押金未使用正式原子金流');
ok(worker.includes("activityCreditTotal"),'財務未拆出活動金');
ok(worker.includes("revenueTotal: invoiceTotal"),'營收未排除押金');
ok(worker.includes("summary?.finance?.revenueTotal"),'分潤仍可能使用含押金金額');
ok(!onsite.includes("'depositUnrefund'"),'現場仍提供直接取消正式押金金流');
ok(admin.includes("filter==='notDeposit')rows=rows.filter(r=>r.depositEligible")&&onsite.includes("onsiteQuickFilter==='notDeposit')return r.depositEligible"),'第一天仍可能誤列為待退押金');
ok(migration.includes('guard_deposit_refund_transaction'),'資料庫缺少退押金保護');
ok(migration.includes('member_notifications'),'會員通知資料表 migration 缺失');
ok(backfill.includes("r.checkin_status='已報到'")&&backfill.includes('on conflict(tenant_id,registration_id,activity_date)'),'既有報到資料缺少安全保留回填');
ok(!/\bdelete\b|\btruncate\b/i.test(backfill.replace(/^--.*$/gm,'')),'既有報到安全回填不可刪除資料');
ok(depositNormalize.includes("o.activity_date<>r.last_day")&&depositNormalize.includes("set deposit_status='不適用'"),'舊押金狀態未限制為非最後參加日校正');
ok(!/refund_transactions|update\s+public\.registrations/i.test(depositNormalize.replace(/^--.*$/gm,'')),'每日押金校正不可改正式退款交易或全域押金結果');

console.log('每日報到、撤場、押金、活動金、正式金流與按鈕接線測試通過。');
