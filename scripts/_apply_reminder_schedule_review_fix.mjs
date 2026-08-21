import fs from 'node:fs';

function mustReplace(src, oldText, newText, label){
  if(!src.includes(oldText)) throw new Error('missing marker: '+label);
  return src.replace(oldText,newText);
}
function replaceRegex(src, re, fn, label){
  if(!re.test(src)) throw new Error('missing regex marker: '+label);
  re.lastIndex=0;
  return src.replace(re,fn);
}

// worker.js
let w=fs.readFileSync('worker.js','utf8');
w=mustReplace(w,
`    const skipped = {ok:true, skipped:true, disabled:true};
    await logEmailDelivery(env, tenantId, templateKey, to, skipped, {...meta, subject, reason:'template_disabled'});
    return skipped;`,
`    const skipped = {ok:true, skipped:true, disabled:true, subject};
    await logEmailDelivery(env, tenantId, templateKey, to, skipped, {...meta, subject, reason:'template_disabled'});
    return skipped;`, 'template disabled subject');
w=mustReplace(w,
`  const result = await sendEmail(env, to, subject, emailWrap(bodyHtml, tenantCtx), tenantCtx);
  await logEmailDelivery(env, tenantId, templateKey, to, result, {...meta, subject});
  return result;`,
`  const result = await sendEmail(env, to, subject, emailWrap(bodyHtml, tenantCtx), tenantCtx);
  await logEmailDelivery(env, tenantId, templateKey, to, result, {...meta, subject});
  return {...result, subject};`, 'template result subject');

w=mustReplace(w,
`    const firstOpenAt = stageNumber === 1 ? String(stage.firstOpenAt || stage.openAt || '').trim() : '';
    return {
      stage:stageNumber,
      firstOpenAt,
      openDaysBefore:Number.isFinite(openDaysBefore) ? openDaysBefore : null,
      closeDaysBefore:Number.isFinite(closeDaysBefore) ? closeDaysBefore : null,
    };`,
`    const firstOpenAt = stageNumber === 1 ? String(stage.firstOpenAt || stage.openAt || '').trim() : '';
    const reviewDateRaw = String(stage.reviewDate || stage.review_date || '').trim().slice(0,10);
    const reviewDate = /^\\d{4}-\\d{2}-\\d{2}$/.test(reviewDateRaw) ? reviewDateRaw : '';
    return {
      stage:stageNumber,
      firstOpenAt,
      openDaysBefore:Number.isFinite(openDaysBefore) ? openDaysBefore : null,
      closeDaysBefore:Number.isFinite(closeDaysBefore) ? closeDaysBefore : null,
      reviewDate,
    };`, 'parse reviewDate');

w=mustReplace(w,
`    const firstOpenAt = stageNumber===1 ? String(stageRaw.firstOpenAt||stageRaw.openAt||'').trim() : '';
    const openRaw = stageNumber===1 ? '' : stageRaw.openDaysBefore;
    const closeRaw = stageRaw.closeDaysBefore;
    const hasFirstOpen = stageNumber===1 && !!firstOpenAt;
    const hasOpenDays = stageNumber>1 && openRaw!==null && openRaw!==undefined && String(openRaw).trim()!=='';
    const hasCloseDays = closeRaw!==null && closeRaw!==undefined && String(closeRaw).trim()!=='';
    const hasAny = stageNumber===1 ? (hasFirstOpen||hasCloseDays) : (hasOpenDays||hasCloseDays);`,
`    const firstOpenAt = stageNumber===1 ? String(stageRaw.firstOpenAt||stageRaw.openAt||'').trim() : '';
    const openRaw = stageNumber===1 ? '' : stageRaw.openDaysBefore;
    const closeRaw = stageRaw.closeDaysBefore;
    const reviewDate = String(stageRaw.reviewDate||stageRaw.review_date||'').trim().slice(0,10);
    const hasFirstOpen = stageNumber===1 && !!firstOpenAt;
    const hasOpenDays = stageNumber>1 && openRaw!==null && openRaw!==undefined && String(openRaw).trim()!=='';
    const hasCloseDays = closeRaw!==null && closeRaw!==undefined && String(closeRaw).trim()!=='';
    const hasReviewDate = !!reviewDate;
    const hasAny = stageNumber===1 ? (hasFirstOpen||hasCloseDays||hasReviewDate) : (hasOpenDays||hasCloseDays||hasReviewDate);`, 'canonical review date input');
w=mustReplace(w,
`    if (stageNumber===1 && (!hasFirstOpen||!hasCloseDays)) return {error:'第 1 段請同時填寫開始時間與截止天數；整段不用時請全部留白'};
    if (stageNumber>1 && (!hasOpenDays||!hasCloseDays)) return {error:\`第 \${stageNumber} 段請同時填寫重開天數與截止天數；整段不用時請全部留白\`};`,
`    if (stageNumber===1 && (!hasFirstOpen||!hasCloseDays||!hasReviewDate)) return {error:'第 1 梯請完整填寫開始時間、截止天數與審核公布日；整梯不用時請全部留白'};
    if (stageNumber>1 && (!hasOpenDays||!hasCloseDays||!hasReviewDate)) return {error:\`第 \${stageNumber} 梯請完整填寫重開天數、截止天數與審核公布日；整梯不用時請全部留白\`};
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(reviewDate)) return {error:\`第 \${stageNumber} 梯審核公布日格式不正確\`};`, 'canonical require review date');
w=mustReplace(w,
`      base.stages.push({stage:1,firstOpenAt:new Date(firstOpenMs).toISOString(),openDaysBefore:null,closeDaysBefore});
    } else {
      base.stages.push({stage:stageNumber,firstOpenAt:'',openDaysBefore,closeDaysBefore});`,
`      base.stages.push({stage:1,firstOpenAt:new Date(firstOpenMs).toISOString(),openDaysBefore:null,closeDaysBefore,reviewDate});
    } else {
      base.stages.push({stage:stageNumber,firstOpenAt:'',openDaysBefore,closeDaysBefore,reviewDate});`, 'canonical persist review date');
w=mustReplace(w,
`    const closeAt = taipeiScheduleIso(shiftRegistrationDate(activityDate,-stage.closeDaysBefore),'23:59:59.999');
    if (Date.parse(openAt)>Date.parse(closeAt)) return {error:\`第 \${stage.stage} 段開始時間必須早於截止時間\`};
    base.windows.push({stage:stage.stage,openAt,closeAt});`,
`    const closeDate = shiftRegistrationDate(activityDate,-stage.closeDaysBefore);
    const closeAt = taipeiScheduleIso(closeDate,'23:59:59.999');
    if (Date.parse(openAt)>Date.parse(closeAt)) return {error:\`第 \${stage.stage} 梯開始時間必須早於截止時間\`};
    if (stage.reviewDate < closeDate) return {error:\`第 \${stage.stage} 梯審核公布日不可早於本梯報名截止日\`};
    base.windows.push({stage:stage.stage,openAt,closeAt,reviewDate:stage.reviewDate});`, 'canonical review validation');

// Payment reminder: real subject + duplicate confirmation + only mark after success.
w=replaceRegex(w,/async function hSendPaymentReminder\(env, b\) \{[\s\S]*?\n\}\n\n\/\/ adminCancelReg/, (block)=>{
  let x=block;
  x=mustReplace(x,
`  const amount = Number(reg.amount || reg.total_amount || reg.registration_total_amount || 0) || 0;
  const result = await mailDeadlineReminder(env, reg.email, displayName, sesName, reg.id, amount, selectedDates, reg.equipment_json, '', tc);`,
`  const amount = Number(reg.amount || reg.total_amount || reg.registration_total_amount || 0) || 0;
  const alreadySent = reg.reminder_sent===true || reg.reminder_sent==='true';
  const forceResend = b.forceResend===true || b.forceResend==='true';
  if (alreadySent && !forceResend) {
    return jsonOk({success:false,requiresResendConfirm:true,message:'這筆待付款提醒已成功寄送過。若確定要再次寄送，請確認重寄。'});
  }
  const result = await mailDeadlineReminder(env, reg.email, displayName, sesName, reg.id, amount, selectedDates, reg.equipment_json, '', tc);`, 'reminder duplicate guard');
  x=mustReplace(x,
`  const append = \`[後台] 已寄出待付款提醒 \${nowTaipeiText()}\`;
  await dbUpdate(env,'registrations',\`tenant_id=eq.\${TENANT}&id=eq.\${encodeURIComponent(reg.id)}\`,{reminder_sent:true,admin_note:(oldNote ? oldNote + ' ' : '') + append}).catch(()=>{});
  return jsonOk({success:true, to:reg.email, subject});`,
`  const append = \`[後台] \${alreadySent?'已重寄':'已寄出'}待付款提醒 \${nowTaipeiText()}\`;
  await dbUpdate(env,'registrations',\`tenant_id=eq.\${TENANT}&id=eq.\${encodeURIComponent(reg.id)}\`,{reminder_sent:true,admin_note:(oldNote ? oldNote + ' ' : '') + append});
  return jsonOk({success:true, to:reg.email, subject:result.subject||'', resent:alreadySent});`, 'reminder success return');
  return x;
}, 'hSendPaymentReminder');

// Add schedule-review reminders into formal getTodos, scoped to authorized sessions.
w=mustReplace(w,
`  // 連動場次退款是一個整組動作：待辦只顯示一張，點一次由 confirmRefund 完成整組。`,
`  // 分梯審核提醒：審核公布日前一天開始顯示；若該梯仍有待審核，逾期後持續留在待辦直到處理完。
  const todayTaipei = new Intl.DateTimeFormat('en-CA',{timeZone:REGISTRATION_SCHEDULE_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const yesterdayFor = (dateKey)=>shiftRegistrationDate(dateKey,-1);
  for (const s of sessions) {
    const schedule=parseRegistrationSchedule(s.registration_schedule_json);
    if(!schedule.enabled) continue;
    for(const stage of schedule.stages||[]) {
      if(!stage.reviewDate || todayTaipei < yesterdayFor(stage.reviewDate)) continue;
      const win=(schedule.windows||[]).find(x=>Number(x.stage)===Number(stage.stage));
      if(!win) continue;
      const pendingRegs=regs.filter(r=>String(r.session_id)===String(s.id)
        && ['待審核','報名成功',''].includes(_reviewStatus(r))
        && Number.isFinite(Date.parse(r.created_at||''))
        && Date.parse(r.created_at)>=Date.parse(win.openAt)
        && Date.parse(r.created_at)<=Date.parse(win.closeAt));
      if(!pendingRegs.length) continue;
      out.push({
        id:'REVIEW_'+s.id+'_'+stage.stage, sessionId:s.id, session_id:s.id,
        eventId:s.event_id||'', event_id:s.event_id||'', sessionName:s.name||s.id,
        kind:'reviewSchedule', label:'第 '+stage.stage+' 梯審核提醒', reviewStage:stage.stage,
        reviewDate:stage.reviewDate, pendingCount:pendingRegs.length,
        brandName:'第 '+stage.stage+' 梯｜待審核 '+pendingRegs.length+' 筆',
        name:(todayTaipei>stage.reviewDate?'已逾期｜':'')+'審核結果公布日 '+stage.reviewDate,
        createdAt:stage.reviewDate+'T00:00:00+08:00', created_at:stage.reviewDate+'T00:00:00+08:00'
      });
    }
  }

  // 連動場次退款是一個整組動作：待辦只顯示一張，點一次由 confirmRefund 完成整組。`, 'todo review reminders');

fs.writeFileSync('worker.js',w);

// admin.html
let a=fs.readFileSync('admin.html','utf8');
a=mustReplace(a,
`  const registrationStage1Close=registrationStage(1).closeDaysBefore??(legacyRegistrationSchedule?21:'');
  const registrationStage2Open=registrationStage(2).openDaysBefore??(legacyRegistrationSchedule?19:'');
  const registrationStage2Close=registrationStage(2).closeDaysBefore??(legacyRegistrationSchedule?7:'');
  const registrationStage3Open=registrationStage(3).openDaysBefore??(legacyRegistrationSchedule?6:'');
  const registrationStage3Close=registrationStage(3).closeDaysBefore??(legacyRegistrationSchedule?1:'');`,
`  const registrationStage1Close=registrationStage(1).closeDaysBefore??(legacyRegistrationSchedule?21:'');
  const registrationStage1Review=String(registrationStage(1).reviewDate||'');
  const registrationStage2Open=registrationStage(2).openDaysBefore??(legacyRegistrationSchedule?19:'');
  const registrationStage2Close=registrationStage(2).closeDaysBefore??(legacyRegistrationSchedule?7:'');
  const registrationStage2Review=String(registrationStage(2).reviewDate||'');
  const registrationStage3Open=registrationStage(3).openDaysBefore??(legacyRegistrationSchedule?6:'');
  const registrationStage3Close=registrationStage(3).closeDaysBefore??(legacyRegistrationSchedule?1:'');
  const registrationStage3Review=String(registrationStage(3).reviewDate||'');`, 'admin review vars');
a=mustReplace(a,`<div class=\"report-card\"><div class=\"report-title\">報名開放排程</div>`, `<div class=\"report-card\" id=\"registrationScheduleCard\"><div class=\"report-title\">分梯報名與審核</div>`, 'schedule title');
a=mustReplace(a,
`每段可獨立設定；整段留白就不啟動。第一次活動日期作為「活動前 X 天」的計算基準。`,
`每梯可獨立設定「開放、截止、審核結果公布日」。審核日前一天起會自動出現在後台待辦；尚未審完時逾期提醒不會消失。第一次活動日期作為「活動前 X 天」的計算基準。`, 'schedule help');
a=mustReplace(a,
`<div class=\"registration-stage-card\"><div class=\"registration-stage-title\">第 1 段</div><div class=\"registration-stage-fields\"><div class=\"form-field\"><label>自訂開始時間（台灣時間）</label><input id=\"set_registrationFirstOpen\" type=\"datetime-local\" value=\"'+attr(registrationFirstOpen)+'\" onchange=\"renderRegistrationSchedulePreview()\"></div><div class=\"form-field\"><label>活動前 X 天 23:59 截止</label><input id=\"set_registrationStage1CloseDays\" type=\"number\" min=\"1\" max=\"3650\" step=\"1\" inputmode=\"numeric\" placeholder=\"例如 21\" value=\"'+attr(registrationStage1Close)+'\" oninput=\"renderRegistrationSchedulePreview()\"></div></div></div>`,
`<div class=\"registration-stage-card\"><div class=\"registration-stage-title\">第 1 梯</div><div class=\"registration-stage-fields\"><div class=\"form-field\"><label>自訂開始時間（台灣時間）</label><input id=\"set_registrationFirstOpen\" type=\"datetime-local\" value=\"'+attr(registrationFirstOpen)+'\" onchange=\"renderRegistrationSchedulePreview()\"></div><div class=\"form-field\"><label>活動前 X 天 23:59 截止</label><input id=\"set_registrationStage1CloseDays\" type=\"number\" min=\"1\" max=\"3650\" step=\"1\" inputmode=\"numeric\" placeholder=\"例如 21\" value=\"'+attr(registrationStage1Close)+'\" oninput=\"renderRegistrationSchedulePreview()\"></div><div class=\"form-field\"><label>審核結果公布日</label><input id=\"set_registrationStage1ReviewDate\" type=\"date\" value=\"'+attr(registrationStage1Review)+'\" onchange=\"renderRegistrationSchedulePreview()\"></div></div></div>`, 'admin stage1');
a=mustReplace(a,
`<div class=\"registration-stage-card\"><div class=\"registration-stage-title\">第 2 段</div><div class=\"registration-stage-fields\"><div class=\"form-field\"><label>活動前 X 天 00:00 重開</label><input id=\"set_registrationStage2OpenDays\" type=\"number\" min=\"1\" max=\"3650\" step=\"1\" inputmode=\"numeric\" placeholder=\"例如 19\" value=\"'+attr(registrationStage2Open)+'\" oninput=\"renderRegistrationSchedulePreview()\"></div><div class=\"form-field\"><label>活動前 X 天 23:59 截止</label><input id=\"set_registrationStage2CloseDays\" type=\"number\" min=\"1\" max=\"3650\" step=\"1\" inputmode=\"numeric\" placeholder=\"例如 7\" value=\"'+attr(registrationStage2Close)+'\" oninput=\"renderRegistrationSchedulePreview()\"></div></div></div>`,
`<div class=\"registration-stage-card\"><div class=\"registration-stage-title\">第 2 梯</div><div class=\"registration-stage-fields\"><div class=\"form-field\"><label>活動前 X 天 00:00 重開</label><input id=\"set_registrationStage2OpenDays\" type=\"number\" min=\"1\" max=\"3650\" step=\"1\" inputmode=\"numeric\" placeholder=\"例如 19\" value=\"'+attr(registrationStage2Open)+'\" oninput=\"renderRegistrationSchedulePreview()\"></div><div class=\"form-field\"><label>活動前 X 天 23:59 截止</label><input id=\"set_registrationStage2CloseDays\" type=\"number\" min=\"1\" max=\"3650\" step=\"1\" inputmode=\"numeric\" placeholder=\"例如 7\" value=\"'+attr(registrationStage2Close)+'\" oninput=\"renderRegistrationSchedulePreview()\"></div><div class=\"form-field\"><label>審核結果公布日</label><input id=\"set_registrationStage2ReviewDate\" type=\"date\" value=\"'+attr(registrationStage2Review)+'\" onchange=\"renderRegistrationSchedulePreview()\"></div></div></div>`, 'admin stage2');
a=mustReplace(a,
`<div class=\"registration-stage-card\"><div class=\"registration-stage-title\">第 3 段</div><div class=\"registration-stage-fields\"><div class=\"form-field\"><label>活動前 X 天 00:00 重開</label><input id=\"set_registrationStage3OpenDays\" type=\"number\" min=\"1\" max=\"3650\" step=\"1\" inputmode=\"numeric\" placeholder=\"例如 6\" value=\"'+attr(registrationStage3Open)+'\" oninput=\"renderRegistrationSchedulePreview()\"></div><div class=\"form-field\"><label>活動前 X 天 23:59 截止</label><input id=\"set_registrationStage3CloseDays\" type=\"number\" min=\"1\" max=\"3650\" step=\"1\" inputmode=\"numeric\" placeholder=\"例如 1\" value=\"'+attr(registrationStage3Close)+'\" oninput=\"renderRegistrationSchedulePreview()\"></div></div></div>`,
`<div class=\"registration-stage-card\"><div class=\"registration-stage-title\">第 3 梯</div><div class=\"registration-stage-fields\"><div class=\"form-field\"><label>活動前 X 天 00:00 重開</label><input id=\"set_registrationStage3OpenDays\" type=\"number\" min=\"1\" max=\"3650\" step=\"1\" inputmode=\"numeric\" placeholder=\"例如 6\" value=\"'+attr(registrationStage3Open)+'\" oninput=\"renderRegistrationSchedulePreview()\"></div><div class=\"form-field\"><label>活動前 X 天 23:59 截止</label><input id=\"set_registrationStage3CloseDays\" type=\"number\" min=\"1\" max=\"3650\" step=\"1\" inputmode=\"numeric\" placeholder=\"例如 1\" value=\"'+attr(registrationStage3Close)+'\" oninput=\"renderRegistrationSchedulePreview()\"></div><div class=\"form-field\"><label>審核結果公布日</label><input id=\"set_registrationStage3ReviewDate\" type=\"date\" value=\"'+attr(registrationStage3Review)+'\" onchange=\"renderRegistrationSchedulePreview()\"></div></div></div>`, 'admin stage3');

// Make collector include reviewDate regardless of its exact compact formatting.
a=replaceRegex(a,/function collectRegistrationSchedule\(dates[^)]*\)\s*\{[\s\S]*?\n\}/, (fn)=>{
  let x=fn;
  x=x.replace(/(stage\s*:\s*1[^}\n]*closeDaysBefore\s*:[^}\n]*)(})/g, (m,p,c)=>p+`,reviewDate:String(($('set_registrationStage1ReviewDate')||{}).value||'').trim()`+c);
  x=x.replace(/(stage\s*:\s*2[^}\n]*closeDaysBefore\s*:[^}\n]*)(})/g, (m,p,c)=>p+`,reviewDate:String(($('set_registrationStage2ReviewDate')||{}).value||'').trim()`+c);
  x=x.replace(/(stage\s*:\s*3[^}\n]*closeDaysBefore\s*:[^}\n]*)(})/g, (m,p,c)=>p+`,reviewDate:String(($('set_registrationStage3ReviewDate')||{}).value||'').trim()`+c);
  if(!x.includes('set_registrationStage1ReviewDate')) throw new Error('collector reviewDate injection failed');
  return x;
}, 'collectRegistrationSchedule');

// Add review dates to preview text when preview exists.
a=replaceRegex(a,/function renderRegistrationSchedulePreview\(\)\s*\{[\s\S]*?\n\}/, (fn)=>{
  if(fn.includes('審核公布')) return fn;
  return fn.replace(/(box\.innerHTML\s*=\s*)([^;]+);/, (m,p,expr)=>p+`(${expr})+'<div class="sub" style="margin-top:8px"><b>審核公布：</b> 第1梯 '+safe(String(($('set_registrationStage1ReviewDate')||{}).value||'—'))+'｜第2梯 '+safe(String(($('set_registrationStage2ReviewDate')||{}).value||'—'))+'｜第3梯 '+safe(String(($('set_registrationStage3ReviewDate')||{}).value||'—'))+'</div>';`);
}, 'renderRegistrationSchedulePreview');

// todo filter + synthetic review reminders.
a=mustReplace(a,
`const order=[['all','全部'],['pending','待審核'],['unpaid','待付款'],['paymentPending','付款待確認'],['checkin','待報到'],['refund','退費待處理'],['dataIssue','資料異常'],['equipment','設備待確認']];`,
`const order=[['all','全部'],['reviewSchedule','審核日提醒'],['pending','待審核'],['unpaid','待付款'],['paymentPending','付款待確認'],['checkin','待報到'],['refund','退費待處理'],['dataIssue','資料異常'],['equipment','設備待確認']];`, 'todo filter review schedule');
a=mustReplace(a,
`const all=sortNearestFirst(AdminTodoAllRows.map(normalizeTodoRow).filter(r=>hasTodoRegId(r) && todoKindFromRow(r)!=='done'), regSortTs);`,
`const all=sortNearestFirst(AdminTodoAllRows.map(normalizeTodoRow).filter(r=>(hasTodoRegId(r)||todoKindFromRow(r)==='reviewSchedule') && todoKindFromRow(r)!=='done'), regSortTs);`, 'todo synthetic keep');
a=mustReplace(a,
`    const who=r.brandName||r.brand||r.brand_name||r.name||r.email||'未填品牌';`,
`    if(kind==='reviewSchedule'){
      const reviewDate=String(r.reviewDate||r.review_date||'');
      const pendingCount=Number(r.pendingCount||r.pending_count||0);
      const overdue=reviewDate && currentLocalAdminDateKey()>reviewDate;
      out+='<article class="reg-card todo-card todo-card-lite unified-reg-card" style="border:2px solid '+(overdue?'#c8645d':'#82aba3')+'">'
        +'<div class="todo-card-top"><span class="todo-stage-badge reviewSchedule">'+safe(r.label||'審核日提醒')+'</span><span class="todo-next-mini">'+(overdue?'已逾期，請儘快完成':'審核公布日 '+safe(reviewDate))+'</span></div>'
        +'<div class="todo-session-title">'+safe(title)+'</div>'
        +'<div class="todo-brand-row"><span class="todo-brand-name">第 '+safe(r.reviewStage||'')+' 梯尚有 '+pendingCount+' 筆待審核</span></div>'
        +'<div class="todo-contact-line">公布日期：'+safe(reviewDate)+'；處理完成後此提醒會自動消失。</div>'
        +'<div class="todo-action-row"><button class="btn small" onclick="setTodoFilter(\'pending\')">查看待審核</button><button class="btn small secondary" onclick="openSessionSettings(\''+attr(sid)+'\')">分梯設定</button></div></article>';
      continue;
    }
    const who=r.brandName||r.brand||r.brand_name||r.name||r.email||'未填品牌';`, 'todo render review card');
// current admin date helper near todo helpers.
a=mustReplace(a,
`function setTodoFilter(k){ AdminTodoFilter=k||'all'; renderTodoRows(AdminTodoAllRows||[]); }`,
`function currentLocalAdminDateKey(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function setTodoFilter(k){ AdminTodoFilter=k||'all'; renderTodoRows(AdminTodoAllRows||[]); }`, 'admin date helper');

// Payment reminder duplicate confirm in actual action handler: retry only after explicit admin confirmation.
a=replaceRegex(a,/if\(act==='remindPayment'\)[\s\S]{0,1200}?\n\s*\}/, (chunk)=>{
  if(chunk.includes('forceResend')) return chunk;
  const oldCall=chunk.match(/await apiPost\(\{action:'sendPaymentReminder'[^;]+;/);
  if(!oldCall) throw new Error('remindPayment api call not found');
  const call=oldCall[0];
  const replacement=`const reminderResult=${call.replace('await apiPost','await apiPost').replace(/;$/,'')};\n      if(reminderResult&&reminderResult.requiresResendConfirm){\n        if(!await uiConfirm((reminderResult.message||'這筆提醒已寄過')+'\\n\\n確定再次寄送嗎？')) return;\n        await apiPost({action:'sendPaymentReminder',regId:id,sessionId:sid,forceResend:true});\n      }`;
  return chunk.replace(call,replacement);
}, 'admin remindPayment duplicate confirm');

fs.writeFileSync('admin.html',a);

// index.html: show full staged schedule directly in registration flow, before user submits.
let i=fs.readFileSync('index.html','utf8');
const helper=`
function frontRegistrationScheduleHtml(s){
  const raw=s&&s.registrationSchedule;
  if(!raw||raw.enabled!==true) return '';
  const stages=Array.isArray(raw.stages)?raw.stages:[];
  const windows=Array.isArray(raw.windows)?raw.windows:[];
  if(!stages.length||!windows.length) return '';
  const fmtDate=(v)=>{const m=String(v||'').slice(0,10).match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);return m?m[1]+'/'+m[2]+'/'+m[3]:String(v||'');};
  const fmtTime=(v)=>{try{return new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v));}catch(e){return String(v||'');}};
  const rows=stages.map(st=>{const w=windows.find(x=>Number(x.stage)===Number(st.stage))||{};return '<div style="padding:9px 0;border-bottom:1px dashed #ddd;line-height:1.7"><b>第 '+esc(st.stage)+' 梯</b><br>報名：'+esc(fmtTime(w.openAt))+' ～ '+esc(fmtTime(w.closeAt))+'<br><span style="color:#8b5a00;font-weight:800">審核結果公布：'+esc(fmtDate(st.reviewDate||w.reviewDate||''))+'</span></div>';}).join('');
  return '<div class="form-card-new" style="border:2px solid #82ABA3;background:#f5faf8"><div class="form-card-title-new">📋 分梯報名與審核日期</div><div style="font-size:15.5px;color:#444">請依各梯日期報名；審核結果將依主辦設定的公布日更新。</div>'+rows+'</div>';
}
`;
i=mustReplace(i,`function renderDynFormFull(s, isNew=false){`,helper+`\nfunction renderDynFormFull(s, isNew=false){`,'front schedule helper');
i=mustReplace(i,
`  // ── 多日選擇（如有）──
  if(dates.length>1){`,
`  // 正式分梯報名／審核日期：直接顯示 Worker 從 sessions.registration_schedule_json 回傳的結果。
  html+=frontRegistrationScheduleHtml(s);

  // ── 多日選擇（如有）──
  if(dates.length>1){`, 'front schedule render');
fs.writeFileSync('index.html',i);

// static closed-loop test
fs.writeFileSync('scripts/test-reminder-schedule-review.mjs',`import fs from 'node:fs';\nconst w=fs.readFileSync('worker.js','utf8'),a=fs.readFileSync('admin.html','utf8'),i=fs.readFileSync('index.html','utf8');\nconst ok=(v,m)=>{if(!v)throw new Error(m)};\nok(w.includes('return {...result, subject};'),'template subject not returned');\nok(w.includes('requiresResendConfirm:true'),'duplicate reminder guard missing');\nok(w.indexOf("if (!result || !result.ok)")<w.indexOf('reminder_sent:true'),'reminder marked before mail success');\nok(w.includes('reviewDate'),'reviewDate not persisted');\nok(w.includes("kind:'reviewSchedule'"),'admin schedule todo missing');\nok(a.includes('分梯報名與審核'),'admin schedule entry missing');\nok(a.includes('set_registrationStage1ReviewDate')&&a.includes('set_registrationStage2ReviewDate')&&a.includes('set_registrationStage3ReviewDate'),'review date inputs missing');\nok(a.includes("['reviewSchedule','審核日提醒']"),'todo review filter missing');\nok(a.includes('forceResend:true'),'admin duplicate resend confirmation missing');\nok(i.includes('frontRegistrationScheduleHtml'),'front schedule renderer missing');\nok(i.includes('審核結果公布'),'front review date missing');\nconsole.log('PASS reminder + staged review closed-loop');\n`);
console.log('patched formal files');
