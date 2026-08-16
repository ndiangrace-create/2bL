import fs from 'node:fs';
import assert from 'node:assert/strict';

const read=file=>fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
const admin=read('admin.html'),member=read('index.html'),onsite=read('onsite.html'),worker=read('worker.js'),sql=read('supabase/seat_assignment_mobile_first.sql');

for(const [name,html] of [['admin.html',admin],['index.html',member],['onsite.html',onsite]]){
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(x=>x[1]);
  for(const source of scripts)assert.doesNotThrow(()=>new Function(source),`${name} 內嵌程式語法錯誤`);
}

const seatActions=['adminSeatBoard','syncSeatRoster','saveSeatMarkerPosition','saveSeatMarkerPositions','saveSeatBoardConfig','saveSeatCustomMarker','deleteSeatCustomMarker','publishSeatLayout'];
for(const action of seatActions){
  assert.match(admin,new RegExp(`action:['"]${action}['"]`),`後台缺少 ${action}`);
  assert.match(worker,new RegExp(`case ['"]${action}['"]`),`Worker 缺少 ${action}`);
}
assert.match(admin,/apiPost\(\{action:['"]adminSeatBoard['"]/, '排位看板必須用 POST 載入，避免管理員憑證進入網址');
assert.doesNotMatch(admin,/api\(\{action:['"]adminSeatBoard['"]/, '排位看板不可用 GET 載入');
assert.match(admin,/regs\.filter\(r=>r\.participatesToday\)\.filter\(seatOpsCardMatches\)/,'每日名單不可顯示未參加當日的攤商');
assert.match(admin,/onclick="seatOpsChooseReg/,'手機攤商資料卡必須可以直接選取排位');
assert.match(admin,/async function seatOpsChooseReg[\s\S]*syncSeatRoster[\s\S]*SeatOps\.selectedCode=waiting\?'':String\(own\[0\]\.code\)/,'新攤商必須能安全補排，且選取時要取代舊的 A15／A16 狀態');

assert.match(admin,/\.seatops-map-stage \.seatops-marker\{width:58px;height:42px/,'後台必須顯示長方形方桌');
assert.doesNotMatch(admin,/\.seatops-map-stage \.seatops-marker\{[^}]*border-radius:50%/,'排位圖不可再使用圓點');
assert.match(admin,/function seatOpsGroupForCode/,'缺少連攤群組');
assert.match(admin,/saveSeatMarkerPositions[^\n]+positions/,'連攤拖曳必須批次儲存');
assert.match(admin,/pendingGroup\.length>1/,'多攤第一次放置必須自動連在一起');
assert.match(member,/mine\?'#ffcb3d':'#c8c2b9'/,'攤商自己的方桌必須使用不同顏色');
assert.match(member,/您的方桌/,'攤商位置必須有清楚標示');
assert.match(onsite,/onsite-map-marker[^\n]+border-radius:4px/,'現場位置也必須是方桌');

assert.match(sql,/existingPositionsLocked',true/,'補排結果必須明確標示既有位置已鎖住');
assert.match(sql,/not exists\([\s\S]*seat_mobile_previous/,'只能撤回本次同步暫時新增的排位');
assert.doesNotMatch(sql,/delete from public\.registration_day_seats\s*where tenant_id=p_tenant_id and session_id=p_session_id\s*and assigned_type='auto' and assigned_by='system_batch';/,'不可整批刪除既有自動排位');
assert.match(admin,/補排新攤商/,'後台需要直覺的補排按鈕');
assert.match(admin,/已排好的位置全部鎖住不動/,'補排前必須清楚告知舊位置不動');
assert.match(sql,/ds\.activity_date=any\(v_days\)/,'跨日必須共同檢查同一組位置');
assert.match(sql,/foreach v_day in array v_days[\s\S]*unnest\(v_codes\)/,'同一組位置必須寫入每個活動日');
assert.match(sql,/between v_start\.rn and v_start\.rn\+v_need-1/,'多攤必須使用連續位置');
assert.match(sql,/pg_advisory_xact_lock/,'排位重建必須防止同時操作');
assert.match(worker,/singleSource:'registration_day_seats'/,'排位看板必須標示每日排位為唯一來源');
assert.doesNotMatch(worker,/assignedByCode\[String\(code\)\]\|\|String\(seatRegId\(s\)\|\|''\)/,'排位看板不可混入舊 stalls 佔位資料');
assert.match(worker,/stallNumber:currentAssignments\.filter/,'看板名單必須使用所選日期的位置');
assert.match(admin,/dayPositions[\s\S]*SeatOps\.activityDate/,'操作畫面必須依目前日期讀取位置');
assert.doesNotMatch(admin,/function seatOpsPositionNosForReg\(r\)\{return String\(\(r&&r\.stallNumber\)/,'操作畫面不可退回舊的整場位置');
assert.match(worker,/autoAssignSeatForPaidReg[\s\S]*sync_seat_roster_mobile_atomic/,'臨時付款攤商必須走安全補位');
assert.match(worker,/batchAssignSeatsForSession[\s\S]*sync_seat_roster_mobile_atomic/,'批次排位必須走安全補位');
assert.match(worker,/releaseRegistrationSeats[\s\S]*dbDelete\(env,'registration_day_seats'/,'取消或退費必須只釋放該攤商的每日位置');
assert.match(worker,/舊的指定位置功能已停用/,'會分裂資料的舊指定位置功能必須封鎖');
assert.match(worker,/participatesToday:_registrationDates\(r\)\.includes\(activityDate\)/,'每日需求數只能計算當天有參加的攤商');

const sample=['A01','A02','A03','A04'];
const contiguous=(start,count)=>sample.slice(start,start+count);
assert.deepEqual(contiguous(1,2),['A02','A03'],'兩攤應取得相鄰位置');
const days=['2026-08-15','2026-08-16'];
const assigned=Object.fromEntries(days.map(day=>[day,contiguous(1,2)]));
assert.deepEqual(assigned[days[0]],assigned[days[1]],'兩天位置必須相同');

// 端對端操作模擬：補一筆臨時新攤商後，所有既有位置逐字不變。
const original=[
  {day:days[0],code:'A01',reg:'old-1'},{day:days[1],code:'A01',reg:'old-1'},
  {day:days[0],code:'A02',reg:'old-2'},{day:days[0],code:'A03',reg:'old-2'},
  {day:days[1],code:'A02',reg:'old-2'},{day:days[1],code:'A03',reg:'old-2'},
];
const fingerprint=rows=>rows.map(x=>x.day+'|'+x.code+'|'+x.reg).sort().join('\n');
const before=fingerprint(original);
const occupied=new Set(original.map(x=>x.day+'|'+x.code));
const freePair=['A04','A05'].every(code=>days.every(day=>!occupied.has(day+'|'+code)));
assert.equal(freePair,true,'新攤商只能使用兩天都空著的連續位置');
const after=[...original,...days.flatMap(day=>['A04','A05'].map(code=>({day,code,reg:'late-2-stalls'})))];
assert.equal(fingerprint(after.filter(x=>x.reg!=='late-2-stalls')),before,'補排不得移動任何既有攤商');
assert.deepEqual(after.filter(x=>x.reg==='late-2-stalls'&&x.day===days[0]).map(x=>x.code),['A04','A05'],'租兩攤必須連攤');
assert.deepEqual(after.filter(x=>x.reg==='late-2-stalls'&&x.day===days[0]).map(x=>x.code),after.filter(x=>x.reg==='late-2-stalls'&&x.day===days[1]).map(x=>x.code),'兩日必須同位');
const coordinates={A01:[10,10],A02:[20,10],A03:[30,10],A04:[40,10],A05:[50,10]};
coordinates.A04=[42,18];
assert.equal(fingerprint(after),fingerprint(after),'拖曳只能改座標，不可改排位');
const released=after.filter(x=>x.reg!=='late-2-stalls');
assert.equal(fingerprint(released),before,'取消新攤商只能釋放自己的位置');

console.log('排位系統測試通過：單一來源、舊位鎖定、臨時補位、方桌拖曳、連攤、兩天同位。');
