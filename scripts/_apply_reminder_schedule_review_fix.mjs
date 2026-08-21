import fs from 'node:fs';

function must(src, oldText, newText, label){
  if(!src.includes(oldText)) throw new Error('missing marker: '+label);
  return src.replace(oldText,newText);
}
function re(src, pattern, replacement, label){
  if(!pattern.test(src)) throw new Error('missing regex marker: '+label);
  pattern.lastIndex=0;
  return src.replace(pattern,replacement);
}

let w=fs.readFileSync('worker.js','utf8');

// 1) Email template calls must return the real subject used for delivery.
w=must(w,
`    const skipped = {ok:true, skipped:true, disabled:true};
    await logEmailDelivery(env, tenantId, templateKey, to, skipped, {...meta, subject, reason:'template_disabled'});
    return skipped;`,
`    const skipped = {ok:true, skipped:true, disabled:true, subject};
    await logEmailDelivery(env, tenantId, templateKey, to, skipped, {...meta, subject, reason:'template_disabled'});
    return skipped;`, 'disabled template subject');
w=must(w,
`  const result = await sendEmail(env, to, subject, emailWrap(bodyHtml, tenantCtx), tenantCtx);
  await logEmailDelivery(env, tenantId, templateKey, to, result, {...meta, subject});
  return result;`,
`  const result = await sendEmail(env, to, subject, emailWrap(bodyHtml, tenantCtx), tenantCtx);
  await logEmailDelivery(env, tenantId, templateKey, to, result, {...meta, subject});
  return {...result, subject};`, 'email subject return');

// 2) Payment reminder: guard duplicate sends; mark reminder_sent only after real mail success.
w=re(w,/async function hSendPaymentReminder\(env, b\) \{[\s\S]*?\n\}\n\n\/\/ adminCancelReg/, block=>{
  let x=block;
  x=must(x,
`  const amount = Number(reg.amount || reg.total_amount || reg.registration_total_amount || 0) || 0;
  const result = await mailDeadlineReminder(env, reg.email, displayName, sesName, reg.id, amount, selectedDates, reg.equipment_json, '', tc);`,
`  const amount = Number(reg.amount || reg.total_amount || reg.registration_total_amount || 0) || 0;
  const alreadySent = reg.reminder_sent===true || reg.reminder_sent==='true';
  const forceResend = b.forceResend===true || b.forceResend==='true';
  if (alreadySent && !forceResend) {
    return jsonOk({success:false,requiresResendConfirm:true,message:'這筆待付款提醒已成功寄送過。若確定要再次寄送，請確認重寄。'});
  }
  const result = await mailDeadlineReminder(env, reg.email, displayName, sesName, reg.id, amount, selectedDates, reg.equipment_json, '', tc);`, 'payment duplicate guard');
  x=must(x,
`  const append = \`[後台] 已寄出待付款提醒 \${nowTaipeiText()}\`;
  await dbUpdate(env,'registrations',\`tenant_id=eq.\${TENANT}&id=eq.\${encodeURIComponent(reg.id)}\`,{reminder_sent:true,admin_note:(oldNote ? oldNote + ' ' : '') + append}).catch(()=>{});
  return jsonOk({success:true, to:reg.email, subject});`,
`  const append = \`[後台] \${alreadySent?'已重寄':'已寄出'}待付款提醒 \${nowTaipeiText()}\`;
  await dbUpdate(env,'registrations',\`tenant_id=eq.\${TENANT}&id=eq.\${encodeURIComponent(reg.id)}\`,{reminder_sent:true,admin_note:(oldNote ? oldNote + ' ' : '') + append});
  return jsonOk({success:true, to:reg.email, subject:result.subject||'', resent:alreadySent});`, 'payment success marker');
  return x;
}, 'payment reminder handler');

// 3) Registration schedule v3: one continuous open window + rolling review dates.
const parseFn=`function parseRegistrationSchedule(value) {
  const raw = safeJson(value, null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { enabled:false, windows:[], stages:[] };
  const enabled = raw.enabled===true || raw.enabled==='true';
  const isRolling = Number(raw.version)>=3 || String(raw.preset||'')==='rolling_review';
  if (isRolling) {
    const openAt=String(raw.openAt||raw.firstOpenAt||'').trim();
    const closeAt=String(raw.closeAt||raw.registrationCloseAt||'').trim();
    const openMs=Date.parse(openAt), closeMs=Date.parse(closeAt);
    const stages=(Array.isArray(raw.stages)?raw.stages:[]).map((st,index)=>{
      const stage=Number((st&&st.stage)||index+1);
      const reviewDate=String((st&&(st.reviewDate||st.review_date))||'').trim().slice(0,10);
      if(![1,2,3].includes(stage)||!/^\\d{4}-\\d{2}-\\d{2}$/.test(reviewDate)) return null;
      return {stage,reviewDate};
    }).filter(Boolean).sort((a,b)=>a.stage-b.stage);
    const windows=(Number.isFinite(openMs)&&Number.isFinite(closeMs)&&openMs<=closeMs)
      ? [{stage:0,openAt,closeAt,openMs,closeMs}] : [];
    return {version:3,enabled,preset:'rolling_review',timezone:String(raw.timezone||REGISTRATION_SCHEDULE_TIME_ZONE),openAt,closeAt,stages,windows};
  }
  // Legacy v1/v2 remains readable so old sessions do not disappear.
  const windows=(Array.isArray(raw.windows)?raw.windows:[]).map((win,index)=>{
    const openAt=String((win&&win.openAt)||'').trim(), closeAt=String((win&&win.closeAt)||'').trim();
    const openMs=Date.parse(openAt), closeMs=Date.parse(closeAt);
    if(!Number.isFinite(openMs)||!Number.isFinite(closeMs)||openMs>closeMs) return null;
    return {stage:Number((win&&win.stage)||index+1),openAt,closeAt,openMs,closeMs};
  }).filter(Boolean).sort((a,b)=>a.openMs-b.openMs);
  const stages=(Array.isArray(raw.stages)?raw.stages:[]).map((st,index)=>({
    stage:Number((st&&st.stage)||index+1),
    reviewDate:String((st&&(st.reviewDate||st.review_date))||'').trim().slice(0,10)
  })).filter(st=>[1,2,3].includes(st.stage)&&/^\\d{4}-\\d{2}-\\d{2}$/.test(st.reviewDate));
  return {version:Number(raw.version)||1,enabled,preset:String(raw.preset||'legacy'),timezone:String(raw.timezone||REGISTRATION_SCHEDULE_TIME_ZONE),openAt:windows[0]?.openAt||String(raw.firstOpenAt||''),closeAt:windows[windows.length-1]?.closeAt||'',stages,windows};
}`;
w=re(w,/function parseRegistrationSchedule\(value\) \{[\s\S]*?\n\}\nfunction shiftRegistrationDate/, parseFn+'\nfunction shiftRegistrationDate', 'parse schedule');

const canonicalFn=`function canonicalRegistrationSchedule(input, dates) {
  const raw=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  const requestedEnabled=raw.enabled===true||raw.enabled==='true';
  const base={version:3,enabled:false,preset:'rolling_review',timezone:REGISTRATION_SCHEDULE_TIME_ZONE,openAt:'',closeAt:'',stages:[],windows:[]};
  if(!requestedEnabled) return {schedule:base};
  const openAt=String(raw.openAt||raw.firstOpenAt||'').trim();
  const closeAt=String(raw.closeAt||raw.registrationCloseAt||'').trim();
  const openMs=Date.parse(openAt), closeMs=Date.parse(closeAt);
  if(!Number.isFinite(openMs)) return {error:'請設定正確的報名開始日期與時間'};
  if(!Number.isFinite(closeMs)) return {error:'請設定正確的報名截止日期與時間'};
  if(openMs>closeMs) return {error:'報名開始時間必須早於報名截止時間'};
  const stageRows=(Array.isArray(raw.stages)?raw.stages:[]).map((st,index)=>({stage:Number((st&&st.stage)||index+1),reviewDate:String((st&&(st.reviewDate||st.review_date))||'').trim().slice(0,10)})).filter(st=>st.reviewDate);
  let last='';
  for(const st of stageRows){
    if(![1,2,3].includes(st.stage)) return {error:'錄取梯次只能設定第 1～3 波'};
    if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(st.reviewDate)) return {error:'第 '+st.stage+' 波錄取日格式不正確'};
    if(last && st.reviewDate<=last) return {error:'第 '+st.stage+' 波錄取日必須晚於前一波'};
    last=st.reviewDate;
    base.stages.push(st);
  }
  base.openAt=new Date(openMs).toISOString();
  base.closeAt=new Date(closeMs).toISOString();
  base.windows=[{stage:0,openAt:base.openAt,closeAt:base.closeAt}];
  base.enabled=true;
  return {schedule:base};
}`;
w=re(w,/function canonicalRegistrationSchedule\(input, dates\) \{[\s\S]*?\n\}\nfunction registrationTimeText/, canonicalFn+'\nfunction registrationTimeText', 'canonical schedule');

// formatSession must expose review dates as well as the continuous window.
w=must(w,
`  const registrationSchedule = {...parsedSchedule,windows:parsedSchedule.windows.map(w=>({stage:w.stage,openAt:w.openAt,closeAt:w.closeAt}))};`,
`  const registrationSchedule = {...parsedSchedule,stages:(parsedSchedule.stages||[]).map(st=>({stage:st.stage,reviewDate:st.reviewDate||''})),windows:parsedSchedule.windows.map(win=>({stage:win.stage,openAt:win.openAt,closeAt:win.closeAt}))};`, 'format schedule stages');

// 4) Admin todo reminder for each review wave. A wave covers submissions since the previous wave; first wave starts at registration open.
w=must(w,
`  // 連動場次退款是一個整組動作：待辦只顯示一張，點一次由 confirmRefund 完成整組。`,
`  // 分波錄取提醒：錄取日前一天開始顯示；到期仍未審完就持續提醒。
  const todayTaipei=new Intl.DateTimeFormat('en-CA',{timeZone:REGISTRATION_SCHEDULE_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  for(const s of sessions){
    const schedule=parseRegistrationSchedule(s.registration_schedule_json);
    if(!schedule.enabled||!schedule.stages?.length) continue;
    const openMs=Date.parse(schedule.openAt||schedule.windows?.[0]?.openAt||'');
    for(let idx=0;idx<schedule.stages.length;idx++){
      const st=schedule.stages[idx], reviewDate=st.reviewDate;
      const remindFrom=shiftRegistrationDate(reviewDate,-1);
      if(!reviewDate||todayTaipei<remindFrom) continue;
      const previousDate=idx>0?schedule.stages[idx-1].reviewDate:'';
      const lowerMs=previousDate?Date.parse(previousDate+'T00:00:00+08:00'):openMs;
      const upperMs=Date.parse(reviewDate+'T00:00:00+08:00');
      const pendingRegs=regs.filter(r=>String(r.session_id)===String(s.id)
        && ['待審核','報名成功',''].includes(_reviewStatus(r))
        && Number.isFinite(Date.parse(r.created_at||''))
        && (!Number.isFinite(lowerMs)||Date.parse(r.created_at)>=lowerMs)
        && Date.parse(r.created_at)<upperMs);
      if(!pendingRegs.length) continue;
      out.push({id:'REVIEW_'+s.id+'_'+st.stage,sessionId:s.id,session_id:s.id,eventId:s.event_id||'',event_id:s.event_id||'',sessionName:s.name||s.id,kind:'reviewSchedule',label:'第 '+st.stage+' 波錄取提醒',reviewStage:st.stage,reviewDate,pendingCount:pendingRegs.length,brandName:'第 '+st.stage+' 波｜待審核 '+pendingRegs.length+' 筆',name:(todayTaipei>reviewDate?'已逾期｜':'')+'錄取日 '+reviewDate,createdAt:reviewDate+'T00:00:00+08:00',created_at:reviewDate+'T00:00:00+08:00'});
    }
  }

  // 連動場次退款是一個整組動作：待辦只顯示一張，點一次由 confirmRefund 完成整組。`, 'review todos');

fs.writeFileSync('worker.js',w);

let a=fs.readFileSync('admin.html','utf8');

// Replace legacy day-offset collector and preview with explicit calendar dates.
const adminCollector=`function collectRegistrationSchedule(dates=collectSessionDates(),validate=true){
  const enabled=!!$('set_registrationScheduleEnabled')?.checked;
  const out={version:3,enabled:false,preset:'rolling_review',timezone:'Asia/Taipei',openAt:'',closeAt:'',stages:[],windows:[]};
  if(!enabled) return out;
  const openLocal=String($('set_registrationOpenAt')?.value||'').trim();
  const closeLocal=String($('set_registrationCloseAt')?.value||'').trim();
  const openMs=Date.parse(openLocal+':00+08:00'),closeMs=Date.parse(closeLocal+':00+08:00');
  if(!Number.isFinite(openMs)){if(validate)throw new Error('請設定報名開始日期與時間');return out;}
  if(!Number.isFinite(closeMs)){if(validate)throw new Error('請設定報名截止日期與時間');return out;}
  if(openMs>closeMs){if(validate)throw new Error('報名開始時間必須早於報名截止時間');return out;}
  for(let n=1;n<=3;n++){
    const reviewDate=String($('set_registrationReview'+n)?.value||'').trim();
    if(!reviewDate) continue;
    out.stages.push({stage:n,reviewDate});
  }
  for(let n=1;n<out.stages.length;n++) if(out.stages[n].reviewDate<=out.stages[n-1].reviewDate){if(validate)throw new Error('後一波錄取日必須晚於前一波');return out;}
  out.openAt=new Date(openMs).toISOString();out.closeAt=new Date(closeMs).toISOString();out.windows=[{stage:0,openAt:out.openAt,closeAt:out.closeAt}];out.enabled=true;return out;
}
function renderRegistrationSchedulePreview(){
  const box=$('registrationSchedulePreview');if(!box)return;
  const enabled=!!$('set_registrationScheduleEnabled')?.checked;
  $('registrationScheduleFields')?.classList.toggle('off',!enabled);
  if(!enabled){box.innerHTML='<div class="notice">未啟用排程時，仍沿用場次手動開放／關閉狀態。</div>';return;}
  try{
    const s=collectRegistrationSchedule(collectSessionDates(),true);
    const waves=s.stages.map(st=>'第 '+st.stage+' 波錄取：'+safe(st.reviewDate)).join('<br>')||'尚未設定分波錄取日';
    box.innerHTML='<div class="notice"><b>報名期間</b><br>'+safe(adminScheduleTimeText(s.openAt))+' ～ '+safe(adminScheduleTimeText(s.closeAt))+'<br><br><b>分波錄取</b><br>'+waves+'<br><span class="sub">第一波錄取不會關閉報名；報名會一路開放到上面的截止時間。</span></div>';
  }catch(e){box.innerHTML='<div class="notice warn">'+safe(e.message)+'</div>';}
}
function toggleRegistrationScheduleBox(){renderRegistrationSchedulePreview()}`;
a=re(a,/function collectRegistrationSchedule\(dates=collectSessionDates\(\),validate=true\)\{[\s\S]*?function toggleRegistrationScheduleBox\(\)\{renderRegistrationSchedulePreview\(\)\}/,adminCollector,'admin collector');

// session settings variables: derive explicit open/close from existing schedule; legacy sessions use first/last window.
a=must(a,
`  const registrationStages=Array.isArray(registrationSchedule.stages)?registrationSchedule.stages:[];
  const registrationStage=n=>registrationStages.find(stage=>Number(stage&&stage.stage)===n)||{};
  const legacyRegistrationSchedule=registrationScheduleEnabled&&!registrationStages.length;
  const registrationFirstOpen=taipeiIsoToLocalInput(registrationStage(1).firstOpenAt||registrationSchedule.firstOpenAt||registrationSchedule.windows?.find(w=>Number(w&&w.stage)===1)?.openAt||'');
  const registrationStage1Close=registrationStage(1).closeDaysBefore??(legacyRegistrationSchedule?21:'');
  const registrationStage2Open=registrationStage(2).openDaysBefore??(legacyRegistrationSchedule?19:'');
  const registrationStage2Close=registrationStage(2).closeDaysBefore??(legacyRegistrationSchedule?7:'');
  const registrationStage3Open=registrationStage(3).openDaysBefore??(legacyRegistrationSchedule?6:'');
  const registrationStage3Close=registrationStage(3).closeDaysBefore??(legacyRegistrationSchedule?1:'');`,
`  const registrationStages=Array.isArray(registrationSchedule.stages)?registrationSchedule.stages:[];
  const registrationStage=n=>registrationStages.find(stage=>Number(stage&&stage.stage)===n)||{};
  const registrationWindows=Array.isArray(registrationSchedule.windows)?registrationSchedule.windows:[];
  const registrationOpenAt=taipeiIsoToLocalInput(registrationSchedule.openAt||registrationSchedule.firstOpenAt||registrationWindows[0]?.openAt||'');
  const registrationCloseAt=taipeiIsoToLocalInput(registrationSchedule.closeAt||registrationWindows[registrationWindows.length-1]?.closeAt||'');
  const registrationReview1=String(registrationStage(1).reviewDate||'');
  const registrationReview2=String(registrationStage(2).reviewDate||'');
  const registrationReview3=String(registrationStage(3).reviewDate||'');`, 'admin schedule vars');

// Replace the old three-stage offset card with explicit dates.
a=re(a,/\+'<div class=\\"report-card\\"><div class=\\"report-title\\">報名開放排程<\/div>'[\s\S]*?\+'<div id=\\"registrationSchedulePreview\\" style=\\"margin-top:10px\\"><\/div><\/div>'/, 
`+'<div class="report-card" id="registrationScheduleCard"><div class="report-title">分波錄取與報名截止</div>'
  +'<label class="tight-check"><input type="checkbox" id="set_registrationScheduleEnabled" '+(registrationScheduleEnabled?'checked':'')+' onchange="toggleRegistrationScheduleBox()"> 啟用日期排程</label>'
  +'<div class="sub" style="margin-top:6px">不用再算「活動前幾天」。直接填實際日期；第一波錄取後報名仍持續開放，直到報名截止時間。</div>'
  +'<div id="registrationScheduleFields" class="feature-body '+(registrationScheduleEnabled?'':'off')+'" style="margin-top:10px"><div class="registration-schedule-grid">'
  +'<div class="registration-stage-card"><div class="registration-stage-title">報名期間</div><div class="registration-stage-fields"><div class="form-field"><label>報名開始</label><input id="set_registrationOpenAt" type="datetime-local" value="'+attr(registrationOpenAt)+'" onchange="renderRegistrationSchedulePreview()"></div><div class="form-field"><label>報名截止</label><input id="set_registrationCloseAt" type="datetime-local" value="'+attr(registrationCloseAt)+'" onchange="renderRegistrationSchedulePreview()"></div></div></div>'
  +'<div class="registration-stage-card"><div class="registration-stage-title">分波錄取</div><div class="registration-stage-fields"><div class="form-field"><label>第一波錄取日</label><input id="set_registrationReview1" type="date" value="'+attr(registrationReview1)+'" onchange="renderRegistrationSchedulePreview()"></div><div class="form-field"><label>第二波錄取日（可空白）</label><input id="set_registrationReview2" type="date" value="'+attr(registrationReview2)+'" onchange="renderRegistrationSchedulePreview()"></div><div class="form-field"><label>第三波錄取日（可空白）</label><input id="set_registrationReview3" type="date" value="'+attr(registrationReview3)+'" onchange="renderRegistrationSchedulePreview()"></div></div></div>'
  +'</div></div><div id="registrationSchedulePreview" style="margin-top:10px"></div></div>'`, 'admin schedule card');

// Admin todo filter/render supports synthetic review reminder rows.
a=must(a,`const order=[['all','全部'],['pending','待審核'],['unpaid','待付款'],['paymentPending','付款待確認'],['checkin','待報到'],['refund','退費待處理'],['dataIssue','資料異常'],['equipment','設備待確認']];`,`const order=[['all','全部'],['reviewSchedule','錄取日提醒'],['pending','待審核'],['unpaid','待付款'],['paymentPending','付款待確認'],['checkin','待報到'],['refund','退費待處理'],['dataIssue','資料異常'],['equipment','設備待確認']];`,'todo filter');
a=must(a,`const all=sortNearestFirst(AdminTodoAllRows.map(normalizeTodoRow).filter(r=>hasTodoRegId(r) && todoKindFromRow(r)!=='done'), regSortTs);`,`const all=sortNearestFirst(AdminTodoAllRows.map(normalizeTodoRow).filter(r=>(hasTodoRegId(r)||todoKindFromRow(r)==='reviewSchedule') && todoKindFromRow(r)!=='done'), regSortTs);`,'todo synthetic');
a=must(a,`function setTodoFilter(k){ AdminTodoFilter=k||'all'; renderTodoRows(AdminTodoAllRows||[]); }`,`function currentLocalAdminDateKey(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}\nfunction setTodoFilter(k){ AdminTodoFilter=k||'all'; renderTodoRows(AdminTodoAllRows||[]); }`,'todo date helper');
a=must(a,`    const who=r.brandName||r.brand||r.brand_name||r.name||r.email||'未填品牌';`,`    if(kind==='reviewSchedule'){
      const reviewDate=String(r.reviewDate||'');const pendingCount=Number(r.pendingCount||0);const overdue=reviewDate&&currentLocalAdminDateKey()>reviewDate;
      out+='<article class="reg-card todo-card todo-card-lite unified-reg-card" style="border:2px solid '+(overdue?'#c8645d':'#82aba3')+'"><div class="todo-card-top"><span class="todo-stage-badge reviewSchedule">'+safe(r.label||'錄取日提醒')+'</span><span class="todo-next-mini">'+(overdue?'已逾期，請儘快完成':'錄取日 '+safe(reviewDate))+'</span></div><div class="todo-session-title">'+safe(title)+'</div><div class="todo-brand-row"><span class="todo-brand-name">第 '+safe(r.reviewStage||'')+' 波尚有 '+pendingCount+' 筆待審核</span></div><div class="todo-contact-line">處理完本波待審核後提醒會自動消失；報名表仍維持開放到正式截止時間。</div><div class="todo-action-row"><button class="btn small" onclick="setTodoFilter(\\'pending\\')">查看待審核</button><button class="btn small secondary" onclick="openSessionSettings(\\''+attr(sid)+'\\')">分波設定</button></div></article>';continue;
    }
    const who=r.brandName||r.brand||r.brand_name||r.name||r.email||'未填品牌';`,'todo review card');

// Payment reminder duplicate confirmation in the admin action flow.
a=re(a,/if\(act==='remindPayment'\)[\s\S]{0,1400}?\n\s*\}/, chunk=>{
  if(chunk.includes('forceResend:true')) return chunk;
  const call=chunk.match(/await apiPost\(\{action:'sendPaymentReminder'[^;]+;/);
  if(!call) throw new Error('remindPayment call not found');
  const old=call[0];
  const expr=old.replace(/^await /,'').replace(/;$/,'');
  const neu=`const reminderResult=await ${expr};\n      if(reminderResult&&reminderResult.requiresResendConfirm){if(!await uiConfirm((reminderResult.message||'這筆提醒已寄過')+'\\n\\n確定再次寄送嗎？'))return;await apiPost({action:'sendPaymentReminder',regId:id,sessionId:sid,forceResend:true});}`;
  return chunk.replace(old,neu);
},'admin reminder resend');

fs.writeFileSync('admin.html',a);

let i=fs.readFileSync('index.html','utf8');
const frontHelper=`function frontRegistrationScheduleHtml(s){
  const schedule=s&&s.registrationSchedule;
  if(!schedule||schedule.enabled!==true) return '';
  const waves=Array.isArray(schedule.stages)?schedule.stages:[];
  const fmtDate=v=>{const m=String(v||'').slice(0,10).match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);return m?m[1]+'/'+m[2]+'/'+m[3]:String(v||'');};
  const fmtDateTime=v=>{try{return new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v));}catch(e){return String(v||'');}};
  let rows=waves.map(st=>'<div style="padding:7px 0;border-bottom:1px dashed #d8e3df"><b>第 '+esc(st.stage)+' 波錄取：</b>'+esc(fmtDate(st.reviewDate))+'</div>').join('');
  if(!rows) rows='<div style="padding:7px 0;color:#666">本場未設定分波錄取日</div>';
  return '<div class="form-card-new" style="border:2px solid #82ABA3;background:#f5faf8"><div class="form-card-title-new">📋 報名與分波錄取日期</div><div style="font-size:15.5px;line-height:1.8"><div><b>報名截止：</b>'+esc(fmtDateTime(schedule.closeAt||schedule.windows?.[0]?.closeAt||''))+'</div>'+rows+'<div style="margin-top:8px;color:#555">第一波錄取後報名仍會繼續開放；尚未報名的攤商仍可報名到截止時間。</div></div></div>';
}\n`;
i=must(i,`function renderDynFormFull(s, isNew=false){`,frontHelper+`function renderDynFormFull(s, isNew=false){`,'front helper');
i=must(i,`  // ── 多日選擇（如有）──\n  if(dates.length>1){`,`  html+=frontRegistrationScheduleHtml(s);\n\n  // ── 多日選擇（如有）──\n  if(dates.length>1){`,'front schedule placement');
fs.writeFileSync('index.html',i);

fs.writeFileSync('scripts/test-reminder-schedule-review.mjs',`import fs from 'node:fs';\nconst w=fs.readFileSync('worker.js','utf8'),a=fs.readFileSync('admin.html','utf8'),i=fs.readFileSync('index.html','utf8');\nconst ok=(v,m)=>{if(!v)throw new Error(m)};\nok(w.includes('return {...result, subject};'),'real email subject missing');\nok(w.includes('requiresResendConfirm:true'),'duplicate reminder guard missing');\nok(w.indexOf("if (!result || !result.ok)")<w.indexOf('reminder_sent:true'),'reminder success order wrong');\nok(w.includes("preset:'rolling_review'"),'rolling review schedule missing');\nok(w.includes("kind:'reviewSchedule'"),'admin review todo missing');\nok(a.includes('分波錄取與報名截止'),'admin explicit date UI missing');\nok(a.includes('第一波錄取日')&&a.includes('報名截止'),'admin review/deadline fields missing');\nok(!a.includes('第 2 段請同時填寫重開天數'),'legacy stage reopen semantics still active');\nok(a.includes("['reviewSchedule','錄取日提醒']"),'review reminder filter missing');\nok(a.includes('forceResend:true'),'admin resend confirmation missing');\nok(i.includes('frontRegistrationScheduleHtml'),'front schedule renderer missing');\nok(i.includes('第一波錄取後報名仍會繼續開放'),'front continuous-open message missing');\nconsole.log('PASS payment reminder + rolling review schedule');\n`);
console.log('patched formal files with rolling-review semantics');
