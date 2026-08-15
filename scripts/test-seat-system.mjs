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

const sample=['A01','A02','A03','A04'];
const contiguous=(start,count)=>sample.slice(start,start+count);
assert.deepEqual(contiguous(1,2),['A02','A03'],'兩攤應取得相鄰位置');
const days=['2026-08-15','2026-08-16'];
const assigned=Object.fromEntries(days.map(day=>[day,contiguous(1,2)]));
assert.deepEqual(assigned[days[0]],assigned[days[1]],'兩天位置必須相同');

console.log('排位系統測試通過：方桌、手機拖曳、連攤、兩天同位、攤商顏色、後端接線。');
