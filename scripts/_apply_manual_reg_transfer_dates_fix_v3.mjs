import fs from 'node:fs';

let admin=fs.readFileSync('admin.html','utf8');
let worker=fs.readFileSync('worker.js','utf8');

function replaceBetween(src,startMarker,endMarker,replacement,label){
  const start=src.indexOf(startMarker);
  const end=src.indexOf(endMarker,start+startMarker.length);
  if(start<0||end<0||end<=start) throw new Error('missing block: '+label);
  return src.slice(0,start)+replacement+src.slice(end);
}

const dateStart='    const dateHtml=dates.length?dates.map(d=>{';
const dateEnd='    const equip=s.equip&&typeof s.equip===\'object\'?s.equip:{};';
const dateBlock=`    const dateHtml=dates.length?dates.map(d=>{
      const day=String((d&&typeof d==='object')?(d.date||d.day||''):d);
      const fee=(d&&typeof d==='object')?Number(d.fee||0):0;
      return \`<label class="amr-date-option" style="display:grid!important;grid-template-columns:28px minmax(0,1fr) auto!important;align-items:center!important;gap:10px!important;width:100%!important;padding:12px 14px!important;margin:7px 0!important;border:1px solid var(--line)!important;border-radius:14px!important;background:#fff!important;cursor:pointer!important"><input type="checkbox" class="amrDate" value="\${attr(day)}" style="width:20px!important;height:20px!important;margin:0!important;justify-self:start!important"><span style="min-width:0;font-weight:900;color:var(--ink)">\${safe(day)}</span><strong style="white-space:nowrap;color:var(--main2)">\${fee?money(fee):'依場次費用'}</strong></label>\`;
    }).join(''):'<div class="sub">此場次沒有多日選項，使用場次單場費用。</div>';

`;
admin=replaceBetween(admin,dateStart,dateEnd,dateBlock,'manual date UI');

const transferStart='async function openRegistrationTransferPanel(regId,sid){';
const transferEnd='async function confirmRegistrationCredit(regId,sid){';
const transferBlock=`async function openRegistrationTransferPanel(regId,sid){
  try{
    const p=normalizedResolutionPreview(await apiPost({action:'previewRegistrationResolution',regId,sessionId:sid}),regId);
    const opts=(p.targetSessions||[]).map(s=>'<option value="'+attr(s.id)+'">'+safe(s.name)+'｜'+safe(s.dateText||'')+'</option>').join('');
    if(!opts){toast('目前沒有可轉入的有效場次',6000);return;}
    const html='<div class="readable-detail"><div class="report-card"><div class="report-title">原報名款項</div><div class="kv">'
      +'<div class="k">已確認現金</div><div>'+money(p.paidAmount||0)+'</div><div class="k">已使用活動金</div><div>'+money(p.activityCreditApplied||0)+'</div><div class="k">可轉資金總額</div><div>'+money(p.fundedAmount||0)+'</div><div class="k">可轉活動費</div><div>'+money(p.activityPaid||0)+'</div><div class="k">押金（獨立處理）</div><div>'+money(p.depositPaid||0)+'</div><div class="k">攤位數</div><div>'+num(p.stallCount||1)+' 攤</div></div></div>'
      +'<div class="report-card"><div class="form-grid"><div class="form-field full"><label>轉入場次</label><select id="resolutionTarget" onchange="refreshTransferPreview(\\''+attr(regId)+'\\',\\''+attr(sid)+'\\',true)"><option value="">請選擇</option>'+opts+'</select></div>'
      +'<div class="form-field full"><label>轉入日期</label><div id="resolutionTargetDates" class="notice" style="margin:0">請先選擇轉入場次。</div></div></div>'
      +'<div id="resolutionCalc" class="notice">選擇場次與日期後，由系統依正式場次費用計算差額、活動金及押金。</div>'
      +'<div class="form-field full" style="margin-top:12px"><label>處理備註</label><textarea id="resolutionNote" placeholder="例如：攤商來訊希望延期"></textarea></div>'
      +'<div class="card-actions"><button id="resolutionSubmit" class="btn" disabled onclick="confirmRegistrationTransfer(\\''+attr(regId)+'\\',\\''+attr(sid)+'\\')">確認轉移場次</button><button class="btn secondary" onclick="panelBack()">返回</button></div></div></div>';
    openPanel('延期／轉移場次','原報名保留，新場另建報名；多日場次可選實際轉入日期，設備須於新場重新確認',html);
  }catch(e){toast('轉場資料載入失敗：'+(e.message||e),7000);}
}
function selectedResolutionTargetDates(){
  return [...document.querySelectorAll('.resolution-target-date:checked')].map(x=>String(x.value||'').slice(0,10)).filter(Boolean);
}
async function refreshTransferPreview(regId,sid,resetDates=false){
  const targetSessionId=$('resolutionTarget')?.value||'';
  const dateBox=$('resolutionTargetDates'),calc=$('resolutionCalc'),submit=$('resolutionSubmit');
  if(submit)submit.disabled=true;
  if(!targetSessionId){if(dateBox)dateBox.innerHTML='請先選擇轉入場次。';return;}
  const selected=resetDates?[]:selectedResolutionTargetDates();
  if(resetDates&&dateBox)dateBox.innerHTML='讀取日期中…';
  try{
    const raw=await apiPost({action:'previewRegistrationResolution',regId,sessionId:sid,targetSessionId,targetDates:selected});
    const options=Array.isArray(raw.availableTargetDates)?raw.availableTargetDates:[];
    let effective=selected.slice();
    if(options.length===1&&!effective.length)effective=[String(options[0].date||'').slice(0,10)];
    if(dateBox)dateBox.innerHTML=options.length?options.map(o=>{
      const day=String(o.date||'').slice(0,10),checked=effective.includes(day);
      return '<label style="display:grid!important;grid-template-columns:28px minmax(0,1fr) auto!important;align-items:center!important;gap:10px!important;padding:11px 12px!important;margin:6px 0!important;border:1px solid var(--line)!important;border-radius:13px!important;background:#fff!important;cursor:pointer!important"><input type="checkbox" class="resolution-target-date" value="'+attr(day)+'" '+(checked?'checked':'')+' onchange="refreshTransferPreview(\\''+attr(regId)+'\\',\\''+attr(sid)+'\\')" style="width:20px!important;height:20px!important;margin:0!important"><span style="font-weight:900">'+safe(day)+(o.label&&o.label!==day?'｜'+safe(o.label):'')+'</span><strong style="white-space:nowrap;color:var(--main2)">'+(Number(o.fee)>0?money(o.fee):'依場次費用')+'</strong></label>';
    }).join(''):'<span class="sub">這個場次沒有可用日期，無法轉入。</span>';
    if(options.length>1&&!effective.length){if(calc)calc.innerHTML='<b>請勾選要轉入的日期。</b><br><span class="sub">可以選一天或多天；未勾選不會建立轉場報名。</span>';return;}
    if(!effective.length){if(calc)calc.textContent='這個場次沒有可用日期，無法計算。';return;}
    const finalRaw=(selected.length||options.length!==1)?raw:await apiPost({action:'previewRegistrationResolution',regId,sessionId:sid,targetSessionId,targetDates:effective});
    const p=normalizedResolutionPreview(finalRaw,regId);
    if(calc)calc.innerHTML='<b>選擇日期：</b>'+effective.map(safe).join('、')+'<br><b>新場應繳：</b>'+money(p.targetTotal||0)+'（活動費 '+money(p.targetActivityFee||0)+'＋押金 '+money(p.targetDeposit||0)+'）<br><b>已轉入：</b>'+money(p.appliedTotal||0)+'｜<b>應補差額：</b>'+money(p.dueAmount||0)+'<br><b>轉後活動金：</b>'+money(p.creditCreated||0)+'｜<b>待退押金：</b>'+money(p.depositRefundDue||0)+'<br><span class="sub">設備不沿用；新報名只保存本次勾選日期。</span>';
    if(submit)submit.disabled=false;
  }catch(e){if(calc)calc.textContent='計算失敗：'+(e.message||e);toast('計算失敗：'+(e.message||e),7000);}
}
async function confirmRegistrationTransfer(regId,sid){
  const targetSessionId=$('resolutionTarget')?.value||'';if(!targetSessionId){toast('請選擇轉入場次');return;}
  const targetDates=selectedResolutionTargetDates();if(!targetDates.length){toast('請至少選擇一個轉入日期');return;}
  if(!await uiConfirm('確定轉移到所選場次？\\n\\n轉入日期：'+targetDates.join('、')+'\\n原場名額與排位會釋出，新場設備需重新確認。'))return;
  try{const r=await apiPost({action:'resolveRegistration',mode:'transfer',regId,sessionId:sid,targetSessionId,targetDates,note:$('resolutionNote')?.value||''});toast('已完成轉場；應補 '+money(r.dueAmount||0)+'，活動金 '+money(r.creditCreated||0),7000);closeAllPanels();await refreshSessionsOverview();if(AdminState.currentPage==='todos')await loadTodos();}catch(e){toast('轉場失敗：'+(e.message||e),8000);}
}
`;
admin=replaceBetween(admin,transferStart,transferEnd,transferBlock,'transfer UI');

const workerStart='async function hPreviewRegistrationResolution(env,b){';
const workerEnd='async function hPartialDayRefund(env,b){';
const workerBlock=`async function hPreviewRegistrationResolution(env,b){
  const T=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,T,'finance',b.sessionId))return jsonErr('無權限');
  const rows=await dbGet(env,'registrations',\`tenant_id=eq.\${T}&id=eq.\${encodeURIComponent(b.regId||'')}&select=*\`);if(!rows.length)return jsonErr('找不到報名');
  const reg=rows[0],paidAmount=Math.max(await _formalPaidAmount(env,T,reg.id),safeNum(reg.paid_amount)),credit=safeNum(reg.activity_credit_applied),funded=paidAmount+credit,depositPaid=Math.min(funded,safeNum(reg.deposit)),activityPaid=Math.max(0,funded-depositPaid);
  const sessions=await dbGet(env,'sessions',\`tenant_id=eq.\${T}&select=*\`),targetSessions=sessions.filter(s=>String(s.id)!==String(reg.session_id)&&!['封存','已取消'].includes(String(s.status||''))).map(s=>({id:s.id,name:s.name||s.id,dateText:_sessionDateValue(s),dateCount:_sessionDates(s).length}));
  const out={regId:reg.id,stallCount:Math.max(1,safeNum(reg.stall_count)||1),paidAmount,activityCreditApplied:credit,fundedAmount:funded,activityPaid,depositPaid,creditCreated:funded,targetSessions};
  const target=sessions.find(s=>String(s.id)===String(b.targetSessionId||''));
  if(target){
    const rawDates=safeJson(target.dates_json,[])||[];
    const availableTargetDates=rawDates.map(d=>{const obj=(d&&typeof d==='object')?d:{date:d};const date=String(obj.date||obj.value||obj.key||'').slice(0,10);return date?{date,label:String(obj.label||obj.name||date),fee:safeNum(obj.fee)}:null;}).filter(Boolean).filter((x,i,a)=>a.findIndex(y=>y.date===x.date)===i).sort((a,b)=>a.date.localeCompare(b.date));
    const validDates=availableTargetDates.map(x=>x.date);
    const requested=Array.isArray(b.targetDates)?b.targetDates.map(x=>String((x&&typeof x==='object')?(x.date||x.value||x.key||''):x).slice(0,10)).filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i):[];
    if(requested.some(x=>!validDates.includes(x)))return jsonErr('轉入日期不屬於目標場次，請重新選擇');
    const dates=requested.length?requested:validDates;
    if(!dates.length)return jsonErr('轉入場次沒有可用日期');
    const activityFee=calcFee(target,dates,out.stallCount),targetDeposit=safeNum(target.deposit),targetTotal=activityFee+targetDeposit;
    Object.assign(out,{targetActivityFee:activityFee,targetDeposit,targetTotal,appliedTotal:Math.min(funded,targetTotal),creditCreated:Math.max(0,activityPaid-activityFee),depositRefundDue:Math.max(0,depositPaid-targetDeposit),dueAmount:Math.max(0,activityFee-activityPaid)+Math.max(0,targetDeposit-depositPaid),targetDates:dates,availableTargetDates});
  }
  return jsonOk(out);
}
async function hResolveRegistration(env,b){
  const T=b._tenantId,mode=String(b.mode||'');
  if(!await verifyStaff(env,b.email,b.token,T,'finance',b.sessionId))return jsonErr('無權限');
  const previewResponse=await hPreviewRegistrationResolution(env,b),previewBody=await previewResponse.clone().json();
  if(previewBody.ok===false)return previewResponse;const p=previewBody.data||previewBody;
  let target=null;if(mode==='transfer'){const rows=await dbGet(env,'sessions',\`tenant_id=eq.\${T}&id=eq.\${encodeURIComponent(b.targetSessionId||'')}&select=*\`);target=rows[0];if(!target)return jsonErr('找不到轉入場次');}
  if(!['transfer','credit'].includes(mode))return jsonErr('請選擇轉場或轉活動金');
  const targetDates=target?(Array.isArray(p.targetDates)?p.targetDates:[]):[];
  if(target&&!targetDates.length)return jsonErr('請至少選擇一個轉入日期');
  const result=await dbRpc(env,'resolve_registration_atomic',{
    p_tenant_id:T,p_registration_id:String(b.regId),p_mode:mode,p_target_session_id:target?target.id:null,p_new_registration_id:target?genId('REG'):null,p_target_event_id:target?target.event_id:null,p_target_dates:targetDates,
    p_target_activity_fee:target?calcFee(target,targetDates,p.stallCount):0,p_target_deposit:target?safeNum(target.deposit):0,p_paid_amount:p.paidAmount,p_activity_paid:p.activityPaid,p_deposit_paid:p.depositPaid,p_credit_created:p.creditCreated,p_deposit_refund_due:p.depositRefundDue||0,p_due_amount:p.dueAmount||0,p_note:String(b.note||''),p_actor_email:String(b.email||'')
  });
  return jsonOk(result||{success:true});
}
`;
worker=replaceBetween(worker,workerStart,workerEnd,workerBlock,'worker resolution');

fs.writeFileSync('admin.html',admin);
fs.writeFileSync('worker.js',worker);

fs.mkdirSync('supabase/migrations',{recursive:true});
const migration=`-- Future transfers only; no historical data update.\ncreate or replace function public.ensure_transfer_registration_day_ops() returns trigger language plpgsql security definer set search_path=public as $$\ndeclare v_item jsonb; v_date date; v_last date;\nbegin\n  if new.tenant_id <> 'tuibile' then return new; end if;\n  if new.transferred_from_registration_id is null then return new; end if;\n  select max((case when jsonb_typeof(x)='object' then coalesce(x->>'date',x->>'value',x->>'key') else trim(both '\"' from x::text) end)::date) into v_last\n  from jsonb_array_elements(coalesce(new.selected_dates_json,'[]'::jsonb)) x\n  where (case when jsonb_typeof(x)='object' then coalesce(x->>'date',x->>'value',x->>'key') else trim(both '\"' from x::text) end) ~ '^\\d{4}-\\d{2}-\\d{2}$';\n  for v_item in select value from jsonb_array_elements(coalesce(new.selected_dates_json,'[]'::jsonb)) loop\n    begin v_date := (case when jsonb_typeof(v_item)='object' then coalesce(v_item->>'date',v_item->>'value',v_item->>'key') else trim(both '\"' from v_item::text) end)::date; exception when others then continue; end;\n    insert into public.registration_day_ops(tenant_id,session_id,registration_id,activity_date,participation_status,checkin_status,teardown_status,deposit_status,equipment_json,created_at,updated_at)\n    values(new.tenant_id,new.session_id,new.id,v_date,'參加','未報到','未撤場',case when v_date=v_last and coalesce(new.deposit,0)>0 then '未退押金' else '不適用' end,'{}'::jsonb,coalesce(new.created_at,now()),now())\n    on conflict (tenant_id,registration_id,activity_date) do nothing;\n  end loop; return new;\nend;$$;\ndrop trigger if exists trg_transfer_registration_day_ops on public.registrations;\ncreate trigger trg_transfer_registration_day_ops after insert on public.registrations for each row when (new.transferred_from_registration_id is not null) execute function public.ensure_transfer_registration_day_ops();\nrevoke all on function public.ensure_transfer_registration_day_ops() from public, anon, authenticated;\ngrant execute on function public.ensure_transfer_registration_day_ops() to service_role;\n`;
fs.writeFileSync('supabase/migrations/20260822200500_transfer_selected_dates_day_ops.sql',migration);
console.log('manual registration / multi-day transfer patch v3 applied');
