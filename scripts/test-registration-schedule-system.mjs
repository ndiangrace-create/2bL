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

const adminStart=admin.indexOf('function adminShiftDateKey');
const adminEnd=admin.indexOf('function sessionModules',adminStart);
assert.ok(adminStart>0&&adminEnd>adminStart,'admin schedule module must be present');
const adminElements={};
const adminContext={
  Date,Intl,Number,String,Array,Object,Error,
  $:id=>adminElements[id]||null,
  collectSessionDates:()=>[{date:'2026-10-31'}],
  safe:value=>String(value??''),
};
vm.createContext(adminContext);
vm.runInContext(admin.slice(adminStart,adminEnd)+'\nthis.collectRegistrationSchedule=collectRegistrationSchedule;',adminContext);

const dates=[{date:'2026-10-31'}];
const built=context.canonicalRegistrationSchedule({
  enabled:true,
  stages:[
    {stage:1,firstOpenAt:'2026-08-31T16:00:00.000Z',closeDaysBefore:30},
    {stage:2,openDaysBefore:25,closeDaysBefore:10},
    {stage:3,openDaysBefore:8,closeDaysBefore:2},
  ],
},dates);
assert.equal(built.error,undefined);
assert.equal(built.schedule.version,2);
assert.equal(built.schedule.preset,'custom_stages');
assert.equal(built.schedule.windows.length,3);
assert.deepEqual(JSON.parse(JSON.stringify(built.schedule.windows)),[
  {stage:1,openAt:'2026-08-31T16:00:00.000Z',closeAt:'2026-10-01T15:59:59.999Z'},
  {stage:2,openAt:'2026-10-05T16:00:00.000Z',closeAt:'2026-10-21T15:59:59.999Z'},
  {stage:3,openAt:'2026-10-22T16:00:00.000Z',closeAt:'2026-10-29T15:59:59.999Z'},
]);

Object.assign(adminElements,{
  set_registrationScheduleEnabled:{checked:true},
  set_registrationFirstOpen:{value:'2026-09-01T00:00'},
  set_registrationStage1CloseDays:{value:'30'},
  set_registrationStage2OpenDays:{value:'25'},
  set_registrationStage2CloseDays:{value:'10'},
  set_registrationStage3OpenDays:{value:'8'},
  set_registrationStage3CloseDays:{value:'2'},
});
const adminBuilt=adminContext.collectRegistrationSchedule([{date:'2026-10-31'}],true);
assert.equal(adminBuilt.enabled,true);
assert.deepEqual(JSON.parse(JSON.stringify(adminBuilt.windows)),JSON.parse(JSON.stringify(built.schedule.windows)),'admin preview and backend canonical windows must agree');

const row={status:'報名中',registration_schedule_json:built.schedule};
const at=iso=>context.registrationAvailability(row,Date.parse(iso));
assert.equal(at('2026-08-30T00:00:00Z').state,'upcoming');
assert.equal(at('2026-09-10T00:00:00Z').open,true);
assert.equal(at('2026-10-03T00:00:00Z').state,'paused');
assert.equal(at('2026-10-06T00:00:00Z').open,true);
assert.equal(at('2026-10-22T00:00:00Z').state,'paused');
assert.equal(at('2026-10-23T00:00:00Z').open,true);
assert.equal(at('2026-10-31T00:00:00Z').state,'ended');
assert.equal(context.registrationAvailability({...row,status:'關閉'},Date.parse('2026-09-10T00:00:00Z')).state,'manual_closed');
assert.equal(context.registrationAvailability({status:'報名中'},Date.parse('2026-09-10T00:00:00Z')).open,true,'old sessions remain open when schedule is absent');

const noFilledStages=context.canonicalRegistrationSchedule({enabled:true,stages:[]},dates);
assert.equal(noFilledStages.schedule.enabled,false,'a checked switch without a completed stage must remain inactive');
for(const element of Object.values(adminElements))if('value' in element)element.value='';
assert.equal(adminContext.collectRegistrationSchedule(dates,true).enabled,false,'admin must not activate a schedule without completed fields');
adminElements.set_registrationStage2OpenDays.value='12';
assert.throws(()=>adminContext.collectRegistrationSchedule(dates,true),/第 2 段/,'admin must reject a half-filled stage');
const oneStage=context.canonicalRegistrationSchedule({enabled:true,stages:[{stage:2,openDaysBefore:12,closeDaysBefore:5}]},dates);
assert.equal(oneStage.error,undefined,'each completed stage can be enabled independently');
assert.deepEqual(JSON.parse(JSON.stringify(oneStage.schedule.windows)),[
  {stage:2,openAt:'2026-10-18T16:00:00.000Z',closeAt:'2026-10-26T15:59:59.999Z'},
]);
assert.ok(context.canonicalRegistrationSchedule({enabled:true,stages:[{stage:2,openDaysBefore:12}]},dates).error,'half-filled stages must be rejected');
assert.ok(context.canonicalRegistrationSchedule({enabled:true,stages:[{stage:2,openDaysBefore:5,closeDaysBefore:12}]},dates).error,'a stage cannot close before it opens');
assert.ok(context.canonicalRegistrationSchedule({enabled:true,stages:[{stage:2,openDaysBefore:12,closeDaysBefore:5},{stage:3,openDaysBefore:7,closeDaysBefore:2}]},dates).error,'stages cannot overlap');
assert.ok(context.canonicalRegistrationSchedule({enabled:true,stages:[{stage:2,openDaysBefore:-1,closeDaysBefore:1}]},dates).error,'day offsets must be positive integers');

const legacy=context.canonicalRegistrationSchedule({enabled:true,firstOpenAt:'2026-08-31T16:00:00.000Z'},dates);
assert.equal(legacy.error,undefined,'previous fixed schedules remain compatible');
assert.deepEqual(JSON.parse(JSON.stringify(legacy.schedule.windows)),[
  {stage:1,openAt:'2026-08-31T16:00:00.000Z',closeAt:'2026-10-10T15:59:59.999Z'},
  {stage:2,openAt:'2026-10-11T16:00:00.000Z',closeAt:'2026-10-24T15:59:59.999Z'},
  {stage:3,openAt:'2026-10-24T16:00:00.000Z',closeAt:'2026-10-30T15:59:59.999Z'},
]);

const prepare=worker.slice(worker.indexOf('async function prepareRegistration'),worker.indexOf('async function finalizeRegistration'));
assert.ok(prepare.includes('registrationAvailability(ses)'),'public registration must be enforced by backend');
assert.ok(prepare.indexOf('registrationAvailability(ses)')<prepare.indexOf('agreementRequiredOn'),'schedule must be checked before registration processing');
const manualStart=worker.indexOf('async function hAdminCreateRegistration');
assert.ok(manualStart>0,'authorized admin manual-registration path must remain present');
const manualEnd=worker.indexOf('\nasync function ',manualStart+20);
assert.ok(!worker.slice(manualStart,manualEnd).includes('registrationAvailability('),'admin manual-registration path must remain separate from public schedule');

assert.ok(admin.includes('id="set_registrationScheduleEnabled"'));
assert.ok(admin.includes('id="set_registrationStage1CloseDays"'));
assert.ok(admin.includes('id="set_registrationStage2OpenDays"'));
assert.ok(admin.includes('id="set_registrationStage2CloseDays"'));
assert.ok(admin.includes('id="set_registrationStage3OpenDays"'));
assert.ok(admin.includes('id="set_registrationStage3CloseDays"'));
assert.ok(admin.includes('整段留白就不啟動'));
assert.ok(admin.includes('registrationSchedule,modules'));
assert.ok(admin.includes('toggleRegistrationScheduleBox()'));
assert.ok(front.includes('function showRegistrationUnavailable(s)'));
assert.ok(front.includes("if(s.registrationOpen===false)"));
assert.ok(front.includes("if(fresh.registrationOpen===false)"));
assert.ok(migration.includes('registration_schedule_json jsonb'));
assert.ok(migration.includes('jsonb_typeof(registration_schedule_json)'));

console.log('registration schedule system: PASS');
