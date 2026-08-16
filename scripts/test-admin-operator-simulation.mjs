import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  capabilitiesForRole,
  DESTRUCTIVE_ADMIN_ACTIONS,
  PLATFORM_ADMIN_ACTIONS,
  TENANT_OWNER_ACTIONS,
  SERIES_MANAGER_ACTIONS,
} from '../lib/admin-authorization.js';

function canOperate(role, action) {
  const c = capabilitiesForRole(role);
  if (PLATFORM_ADMIN_ACTIONS.has(action) && !c.canPlatform) return false;
  if (TENANT_OWNER_ACTIONS.has(action) && !c.canManageTenantSettings) return false;
  if (DESTRUCTIVE_ADMIN_ACTIONS.has(action) && !c.canDelete) return false;
  if (role === 'organizer_admin' && !SERIES_MANAGER_ACTIONS.has(action)) return false;
  return Object.keys(c).length > 0;
}

const simulations = [
  {
    operator:'平台總管理者', role:'platform_super_admin',
    allowed:['getDashboard','getStaff','getTenantsAdmin','deleteEvent'], denied:[],
  },
  {
    operator:'指定系列管理者', role:'organizer_admin',
    allowed:['getDashboard','getRegs','confirmPayment','adminSeatBoard','onsiteRegs'],
    denied:['getTenantsAdmin','getStaff','deleteEvent'],
  },
  {
    operator:'場次管理者', role:'session_admin',
    allowed:['getDashboard','getRegs','adminSeatBoard','onsiteRegs'],
    denied:['getTenantsAdmin','getStaff','deleteEvent'],
  },
  {
    operator:'財務管理者', role:'finance_admin',
    allowed:['getFinance'], denied:['getTenantsAdmin','getStaff','deleteFinanceItem'],
  },
  {
    operator:'現場人員', role:'onsite_staff',
    allowed:['onsiteRegs'], denied:['getTenantsAdmin','getStaff','deleteEvent'],
  },
];

for (const scenario of simulations) {
  for (const action of scenario.allowed) {
    assert.equal(canOperate(scenario.role, action), true, `${scenario.operator} 應可執行 ${action}`);
  }
  for (const action of scenario.denied) {
    assert.equal(canOperate(scenario.role, action), false, `${scenario.operator} 不得執行 ${action}`);
  }
}

const front = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const protectedActions = new Set([
  ...SERIES_MANAGER_ACTIONS,
  ...TENANT_OWNER_ACTIONS,
  ...PLATFORM_ADMIN_ACTIONS,
  ...DESTRUCTIVE_ADMIN_ACTIONS,
]);
const publicFrontActions = [...new Set(
  [...front.matchAll(/action\s*[:=]\s*['\"]([A-Za-z0-9_]+)['\"]/g)].map(match => match[1])
)];
assert.equal(publicFrontActions.filter(action => protectedActions.has(action)).length, 0,
  '民眾前台操作不可被管理者中央權限守門攔截');

console.log('admin operator simulations passed: platform, series, session, finance, onsite, public front');
