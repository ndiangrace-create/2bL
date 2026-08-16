import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  capabilitiesForRole,
  DESTRUCTIVE_ADMIN_ACTIONS,
  PLATFORM_ADMIN_ACTIONS,
  TENANT_OWNER_ACTIONS,
  SERIES_MANAGER_ACTIONS,
  SESSION_TARGET_ACTIONS,
  REGISTRATION_TARGET_ACTIONS,
} from '../lib/admin-authorization.js';

const manager = capabilitiesForRole('organizer_admin');
for (const key of [
  'canOperateSeries','canManageRegistrations','canManageSessions','canManageSeating',
  'canManageFinance','canManageOnsite','canManageCommunications','canManageMembers',
]) assert.equal(manager[key], true, `organizer_admin 應具備 ${key}`);
for (const key of ['canManageTenantSettings','canManageStaff','canDelete','canPlatform']) {
  assert.equal(manager[key], false, `organizer_admin 不得具備 ${key}`);
}

assert.equal(capabilitiesForRole('platform_super_admin').canPlatform, true);
assert.equal(capabilitiesForRole('platform_super_admin').canDelete, true);
assert.equal(capabilitiesForRole('organizer_owner').canDelete, false);

for (const action of ['deleteEvent','deleteSession','deleteFinanceItem','deletePhotoFrame','deleteVenueMap','removeStaff']) {
  assert.ok(DESTRUCTIVE_ADMIN_ACTIONS.has(action), `${action} 必須集中列為刪除操作`);
}
for (const action of ['generateSessionVisual','deleteSession','unlockFinanceSettlement','saveFinanceShare']) {
  assert.ok(PLATFORM_ADMIN_ACTIONS.has(action), `${action} 必須鎖在平台層`);
}
for (const action of ['getStaff','savePaymentSettings','saveCompanySettings','createEvent']) {
  assert.ok(TENANT_OWNER_ACTIONS.has(action), `${action} 必須鎖在租戶層`);
}
for (const action of ['getDashboard','getSessionsAdmin','getRegs','confirmPayment','runBatchAssign','getFinance']) {
  assert.ok(SERIES_MANAGER_ACTIONS.has(action), `${action} 應屬系列營運模組`);
}
for (const action of ['updateSession','runBatchAssign','getInvoiceList','lockFinanceSettlement']) {
  assert.ok(SESSION_TARGET_ACTIONS.has(action), `${action} 必須檢查場次範圍`);
}
for (const action of ['updateRegStatus','confirmPayment','confirmRefund','sendNotify']) {
  assert.ok(REGISTRATION_TARGET_ACTIONS.has(action), `${action} 必須檢查報名範圍`);
}

for (const action of SERIES_MANAGER_ACTIONS) {
  assert.ok(!TENANT_OWNER_ACTIONS.has(action), `${action} 不可同時屬於系列與租戶設定`);
  assert.ok(!PLATFORM_ADMIN_ACTIONS.has(action), `${action} 不可同時屬於系列與平台功能`);
  assert.ok(!DESTRUCTIVE_ADMIN_ACTIONS.has(action), `${action} 不可同時是系列可用與刪除功能`);
}

const worker = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const front = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const protectedActions = new Set([...SERIES_MANAGER_ACTIONS,...TENANT_OWNER_ACTIONS,...PLATFORM_ADMIN_ACTIONS,...DESTRUCTIVE_ADMIN_ACTIONS]);
const frontActions = [...front.matchAll(/action\s*[:=]\s*['\"]([A-Za-z0-9_]+)['\"]/g)].map(m=>m[1]);
assert.deepEqual([...new Set(frontActions.filter(a=>protectedActions.has(a)))], [], '前台 action 不可被後台中央權限誤擋');
assert.match(worker, /loadFreshAdminAuthorization/);
assert.match(worker, /scopeType !== 'event' \|\| !scopeEventId/);
assert.match(worker, /authorizeAdminAction\(env, action, p\)/);
assert.match(worker, /authorizeAdminAction\(env, action, b\)/);
assert.match(worker, /input\.passcode && \['onsiteRegs','onsiteDaySummary','onsiteMark'\]\.includes\(action\)/);
assert.ok(!SERIES_MANAGER_ACTIONS.has('onsitePasscodeVerify'), '現場通行碼驗證必須維持公開入口');
assert.match(worker, /_registrationScopeRows/);
assert.match(worker, /_scopeRows\(p, regsRaw\)/);
assert.match(worker, /capabilities: auth\.capabilities/);
assert.match(admin, /authorization:j\.authorization\|\|null/);
assert.match(admin, /function applyAdminAuthorizationUI/);
assert.match(admin, /destructive&&!adminCan\('canDelete'\)/);

console.log('admin authorization module checks passed');
