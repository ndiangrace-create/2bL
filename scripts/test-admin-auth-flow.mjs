import assert from 'node:assert/strict';
import worker, { issueAdminToken } from '../worker.js';

const tenantId = 'tuibile';
const eventId = 'EVT_TEST_SERIES';
const env = {
  JWT_SECRET:'test-jwt-secret',
  AUTH_SECRET:'test-auth-secret',
  SUPABASE_URL:'https://mock.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY:'test-service-role',
};
const platformAdmin = {
  id:'platform-admin-1', email:'platform@example.com', name:'平台總管',
  role:'platform_super_admin', normalized_role:'platform_super_admin',
  tenant_id:tenantId, is_active:true, active:true,
};
const seriesAdmin = {
  id:'series-admin-1', email:'series@example.com', name:'系列管理者',
  role:'organizer_admin', normalized_role:'organizer_admin',
  tenant_id:tenantId, scope_type:'event', scope_event_id:eventId,
  is_active:true, active:true,
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async input => {
  const url = new URL(String(input));
  const table = url.pathname.split('/').pop();
  if (table === 'platform_staff') return Response.json([]);
  if (table === 'staff') {
    const emailFilter = String(url.searchParams.get('email') || '');
    if (emailFilter.includes('platform%40example.com') || emailFilter.includes('platform@example.com')) {
      return Response.json([platformAdmin]);
    }
    if (emailFilter.includes('series%40example.com') || emailFilter.includes('series@example.com')) {
      return Response.json([seriesAdmin]);
    }
    return Response.json([platformAdmin, seriesAdmin]);
  }
  if (table === 'events') return Response.json([{id:eventId, tenant_id:tenantId}]);
  if (table === 'sessions') {
    const scoped = [
      {id:'SES_SERIES_1', event_id:eventId, tenant_id:tenantId, status:'報名中', dates_json:[]},
      {id:'SES_SERIES_2', event_id:eventId, tenant_id:tenantId, status:'報名中', dates_json:[]},
    ];
    const eventFilter = String(url.searchParams.get('event_id') || '');
    if (eventFilter.includes(eventId)) return Response.json(scoped);
    return Response.json([
      ...scoped,
      {id:'SES_OTHER_SERIES', event_id:'EVT_OTHER', tenant_id:tenantId, status:'報名中', dates_json:[]},
    ]);
  }
  if (table === 'tenants') return Response.json([{id:tenantId,name:'兔彼樂'}]);
  return Response.json([]);
};

try {
  const platformToken = await issueAdminToken(platformAdmin, tenantId, env);
  const platformResponse = await worker.fetch(new Request(
    `https://worker.test/admin/me?email=_&tenant=${tenantId}&token=${encodeURIComponent(platformToken)}`
  ), env, {waitUntil(){}});
  const platformMe = await platformResponse.json();
  assert.equal(platformMe.error, undefined);
  assert.equal(platformMe.role, 'platform_super_admin');
  assert.equal(platformMe.authorization.capabilities.canPlatform, true);
  assert.equal(platformMe.authorization.allowedSessionIds, null);

  const platformTenantResponse = await worker.fetch(new Request(
    `https://worker.test/?action=getTenantsAdmin&token=${encodeURIComponent(platformToken)}`
  ), env, {waitUntil(){}});
  const platformTenants = await platformTenantResponse.json();
  assert.equal(platformTenants.error, undefined, '平台總管必須能通過平台功能的即時資料庫授權');

  const seriesToken = await issueAdminToken(seriesAdmin, tenantId, env);
  const seriesResponse = await worker.fetch(new Request(
    `https://worker.test/admin/me?email=_&tenant=${tenantId}&token=${encodeURIComponent(seriesToken)}`
  ), env, {waitUntil(){}});
  const seriesMe = await seriesResponse.json();
  assert.equal(seriesMe.error, undefined);
  assert.equal(seriesMe.role, 'organizer_admin');
  assert.equal(seriesMe.authorization.scopeEventId, eventId);
  assert.deepEqual(seriesMe.authorization.allowedSessionIds, ['SES_SERIES_1','SES_SERIES_2']);
  assert.equal(seriesMe.authorization.capabilities.canDelete, false);
  assert.equal(seriesMe.authorization.capabilities.canPlatform, false);

  const scopedSessionsResponse = await worker.fetch(new Request(
    `https://worker.test/?action=getSessionsAdmin&tenant=${tenantId}&email=${encodeURIComponent(seriesAdmin.email)}&token=${encodeURIComponent(seriesToken)}`
  ), env, {waitUntil(){}});
  const scopedSessions = await scopedSessionsResponse.json();
  assert.equal(scopedSessions.error, undefined);
  assert.deepEqual(scopedSessions.map(row => row.id), ['SES_SERIES_1','SES_SERIES_2'],
    '系列管理者不得讀到其他系列場次');

  const deniedPlatformResponse = await worker.fetch(new Request(
    `https://worker.test/?action=getTenantsAdmin&token=${encodeURIComponent(seriesToken)}`
  ), env, {waitUntil(){}});
  assert.equal((await deniedPlatformResponse.json()).error, '無權限');

  const frontResponse = await worker.fetch(new Request(
    `https://worker.test/?action=getSessions&tenant=${tenantId}`
  ), env, {waitUntil(){}});
  const frontPayload = await frontResponse.json();
  assert.equal(frontPayload.error, undefined, '民眾前台公開場次不得要求管理員權限');

  console.log('admin/member auth flow passed: platform fallback, series scope, public registration front');
} finally {
  globalThis.fetch = originalFetch;
}
