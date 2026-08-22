import fs from 'node:fs';
import assert from 'node:assert/strict';

const admin=fs.readFileSync('admin.html','utf8');
const worker=fs.readFileSync('worker.js','utf8');
const migration=fs.readFileSync('supabase/migrations/20260822200500_transfer_selected_dates_day_ops.sql','utf8');

// 主辦代報名：既有正式 handler 不可被刪，選取日期仍進 selectedDates。
assert.match(admin,/async function openAdminManualRegistration\(/);
assert.match(admin,/class=\\?"amrDate/);
assert.match(admin,/selectedDates:\[\.\.\.document\.querySelectorAll\('\.amrDate:checked'\)\]/);
assert.match(admin,/amr-date-option/);
assert.match(admin,/grid-template-columns:28px minmax\(0,1fr\) auto/);
assert.match(worker,/async function _adminManualPreview\(/);
assert.match(worker,/calcFee\(ses,dates,stalls\)/);
assert.match(worker,/selected_dates_json:p\.dates/);

// 轉場：前端必須把目標日期送到 Worker，不能再強制整場全部日期。
assert.match(admin,/function selectedResolutionTargetDates\(/);
assert.match(admin,/targetDates:selected/);
assert.match(admin,/targetDates,note:/);
assert.match(admin,/請至少選擇一個轉入日期/);
assert.match(worker,/availableTargetDates/);
assert.match(worker,/Array\.isArray\(b\.targetDates\)/);
assert.match(worker,/requested\.some\(x=>!validDates\.includes\(x\)\)/);
assert.match(worker,/p_target_dates:targetDates/);
assert.doesNotMatch(worker,/const targetDates=target\?_sessionDates\(target\):\[\]/);

// 原轉場／活動金／退款入口必須仍存在。
assert.match(worker,/if\(!\['transfer','credit'\]\.includes\(mode\)\)/);
assert.match(admin,/async function confirmRegistrationCredit\(/);
assert.match(worker,/async function hPartialDayRefund\(/);

// 每日營運資料要與 RPC insert 同交易靠 DB trigger 建立；migration 不得回填／UPDATE 舊 registrations。
assert.match(migration,/after insert on public\.registrations/i);
assert.match(migration,/new\.transferred_from_registration_id is not null/i);
assert.match(migration,/registration_day_ops/);
assert.match(migration,/on conflict \(tenant_id,registration_id,activity_date\) do nothing/i);
assert.doesNotMatch(migration,/update\s+public\.registrations/i);
assert.doesNotMatch(migration,/delete\s+from\s+public\.registrations/i);

console.log('manual registration / transfer dates tests: PASS');
