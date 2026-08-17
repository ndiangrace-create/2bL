import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const worker=fs.readFileSync(new URL('../worker.js',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');
const front=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../supabase/registration_schedule_safe.sql',import.meta.url),'utf8');

const start=worker.indexOf("const REGISTRATION_SCHEDULE_TIME_ZONE");
const end=worker.indexOf('function agreementRequiredOn',start);
assert.ok(start>0&&end>start,'worker schedule module must be present');
const context={
  Date,Intl,Number,String,Array,Object,
  safeJson(value,fallback){if(value===null||value===undefined)return fallback;if(typeof value!=='string')return value;try{return JSON.parse(value)}catch{return fallback}},
};
vm.createContext(context);
vm.runInContext(worker.slice(start,end)+'\nthis.canonicalRegistrationSchedule=canonicalRegistrationSchedule;this.registrationAvailability=registrationAvailability;',context);

const dates=[{date:'2026-10-31'}];
const built=context.canonicalRegistrationSchedule({enabled:true,firstOpenAt:'2026-08-31T16:00:00.000Z'},dates);
assert.equal(built.error,undefined);
assert.equal(built.schedule.windows.length,3);
assert.deepEqual(JSON.parse(JSON.stringify(built.schedule.windows)),[
  {stage:1,openAt:'2026-08-31T16:00:00.000Z',closeAt:'2026-10-10T15:59:59.999Z'},
  {stage:2,openAt:'2026-10-11T16:00:00.000Z',closeAt:'2026-10-24T15:59:59.999Z'},
  {stage:3,openAt:'2026-10-24T16:00:00.000Z',closeAt:'2026-10-30T15:59:59.999Z'},
]);

const row={status:'報名中',registration_schedule_json:built.schedule};
const at=iso=>context.registrationAvailability(row,Date.parse(iso));
assert.equal(at('2026-08-30T00:00:00Z').state,'upcoming');
assert.equal(at('2026-09-10T00:00:00Z').open,true);
assert.equal(at('2026-10-11T00:00:00Z').state,'paused');
assert.equal(at('2026-10-12T00:00:00Z').open,true);
assert.equal(at('2026-10-24T15:59:59.999Z').open,true);
assert.equal(at('2026-10-24T16:00:00Z').open,true);
assert.equal(at('2026-10-31T00:00:00Z').state,'ended');
assert.equal(context.registrationAvailability({...row,status:'關閉'},Date.parse('2026-09-10T00:00:00Z')).state,'manual_closed');
assert.equal(context.registrationAvailability({status:'報名中'},Date.parse('2026-09-10T00:00:00Z')).open,true,'old sessions remain open when schedule is absent');
assert.ok(context.canonicalRegistrationSchedule({enabled:true,firstOpenAt:'2026-10-11T00:00:00Z'},dates).error,'invalid first window must be rejected');

const prepare=worker.slice(worker.indexOf('async function prepareRegistration'),worker.indexOf('async function finalizeRegistration'));
assert.ok(prepare.includes('registrationAvailability(ses)'),'public registration must be enforced by backend');
assert.ok(prepare.indexOf('registrationAvailability(ses)')<prepare.indexOf('agreementRequiredOn'),'schedule must be checked before registration processing');
const manualStart=worker.indexOf('async function hAdminCreateRegistration');
assert.ok(manualStart>0,'authorized admin manual-registration path must remain present');
const manualEnd=worker.indexOf('\nasync function ',manualStart+20);
assert.ok(!worker.slice(manualStart,manualEnd).includes('registrationAvailability('),'admin manual-registration path must remain separate from public schedule');

assert.ok(admin.includes('id="set_registrationScheduleEnabled"'));
assert.ok(admin.includes('registrationSchedule,modules'));
assert.ok(admin.includes('toggleRegistrationScheduleBox()'));
assert.ok(front.includes('function showRegistrationUnavailable(s)'));
assert.ok(front.includes("if(s.registrationOpen===false)"));
assert.ok(front.includes("if(fresh.registrationOpen===false)"));
assert.ok(migration.includes('registration_schedule_json jsonb'));
assert.ok(migration.includes('jsonb_typeof(registration_schedule_json)'));

console.log('registration schedule system: PASS');
