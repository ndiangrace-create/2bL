import fs from 'node:fs';

let worker=fs.readFileSync('worker.js','utf8');

function replaceOnce(src,from,to,label){
  const i=src.indexOf(from);
  if(i<0) throw new Error('missing marker: '+label);
  if(src.indexOf(from,i+from.length)>=0) throw new Error('marker not unique: '+label);
  return src.slice(0,i)+to+src.slice(i+from.length);
}

const oldProfile=`function _memberProfileStatus(m){
  m=m||{};
  const has=function(v){ return String(v==null?'':v).trim()!==''; };
  const brand = m.brand_name||m.brand;
  const socialOrWebsite = has(m.fb_url)||has(m.ig_url)||has(m.collab_url);
  const checks=[['聯絡人姓名',has(m.name)],['手機',has(m.phone)],['攤位／品牌名稱',has(brand)],['FB、IG 或官網（至少一項）',socialOrWebsite]];
  const missingFields=checks.filter(function(c){return !c[1];}).map(function(c){return c[0];});
  return { profileComplete: missingFields.length===0, missingFields: missingFields };
}`;
const newProfile=`function _memberProfileStatus(m){
  m=m||{};
  const has=function(v){ return String(v==null?'':v).trim()!==''; };
  const brand = m.brand_name||m.brand;
  const socialOrWebsite = has(m.fb_url)||has(m.ig_url)||has(m.collab_url);
  const checks=[['聯絡人姓名',has(m.name)],['手機',has(m.phone)],['攤位／品牌名稱',has(brand)]];
  const missingFields=checks.filter(function(c){return !c[1];}).map(function(c){return c[0];});
  return { profileComplete: missingFields.length===0, missingFields: missingFields, socialComplete:socialOrWebsite };
}`;
worker=replaceOnce(worker,oldProfile,newProfile,'profile completeness');

const oldAuth=`  const authPhone = normPhone(b && b.authPhone);
  if (!email || !authPhone) return jsonErr('請先以 Email 與手機完成身份驗證');
  const verified = await findVerifiedMemberByEmailPhone(env, TENANT, email, authPhone);
  if (!verified || normEmail(verified.email) !== email) return jsonErr('身份驗證失敗，無權限修改此會員資料');
  b.email = email;
  const memberBeforeAudit=memberProfileAuditSnapshot(verified);
  await upsertMember(env, b);
  const memberAfterRows=await dbGet(env,'members',\`tenant_id=eq.\${TENANT}&email=ilike.\${encodeURIComponent(email)}&select=*\`).catch(()=>[]);
  const memberAfterAudit=memberProfileAuditSnapshot(memberAfterRows[0]||{});
  const memberChangedFields=Object.keys(memberAfterAudit).filter(k=>String(memberBeforeAudit[k]??'')!==String(memberAfterAudit[k]??''));
  if(memberChangedFields.length){await writeAuditLog(env,TENANT,email,'member','member_profile_self_update','members',email,memberBeforeAudit,memberAfterAudit,{changed_fields:memberChangedFields,source:'member_profile'});}`;

const newAuth=`  const authPhone = normPhone(b && b.authPhone);
  if (!email || !authPhone) return jsonErr('請先提供 Email 與手機');
  const requestedPhone = normPhone(b && b.phone);
  const existingMembers = await dbGet(env,'members',\`tenant_id=eq.\${TENANT}&email=ilike.\${encodeURIComponent(email)}&select=*\`).catch(()=>[]);
  let verified = null;
  let isFirstCreate = false;
  if (existingMembers.length) {
    const current = existingMembers[0];
    if (!phoneMatches(current.phone, authPhone)) return jsonErr('身份驗證失敗，無權限修改此會員資料');
    verified = {...current,_source:'members'};
  } else {
    const legacyRegs = await dbGet(env,'registrations',\`tenant_id=eq.\${TENANT}&email=ilike.\${encodeURIComponent(email)}&select=email,phone&order=created_at.desc&limit=100\`).catch(()=>[]);
    if (legacyRegs.length) {
      const legacy = legacyRegs.find(r=>phoneMatches(r.phone,authPhone));
      if (!legacy) return jsonErr('此 Email 已有歷史報名，但手機不一致。請使用原報名手機，或聯繫主辦協助。');
      verified = {...legacy,_source:'registrations'};
    } else {
      if (!requestedPhone || !phoneMatches(requestedPhone,authPhone)) return jsonErr('首次建立會員時，手機資料不一致');
      isFirstCreate = true;
      verified = {email,phone:requestedPhone,_source:'new_member'};
    }
  }
  b.email = email;
  const memberBeforeAudit=isFirstCreate?{}:memberProfileAuditSnapshot(verified);
  await upsertMember(env, b);
  const memberAfterRows=await dbGet(env,'members',\`tenant_id=eq.\${TENANT}&email=ilike.\${encodeURIComponent(email)}&select=*\`).catch(()=>[]);
  const memberAfterAudit=memberProfileAuditSnapshot(memberAfterRows[0]||{});
  const memberChangedFields=Object.keys(memberAfterAudit).filter(k=>String(memberBeforeAudit[k]??'')!==String(memberAfterAudit[k]??''));
  if(memberChangedFields.length){await writeAuditLog(env,TENANT,email,'member',isFirstCreate?'member_profile_self_create':'member_profile_self_update','members',email,memberBeforeAudit,memberAfterAudit,{changed_fields:memberChangedFields,source:'member_profile'});}`;
worker=replaceOnce(worker,oldAuth,newAuth,'saveMember first create auth');

fs.writeFileSync('worker.js',worker);
console.log('first-member registration patch applied');
