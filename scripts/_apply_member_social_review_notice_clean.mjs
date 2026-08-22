import fs from 'node:fs';

let index=fs.readFileSync('index.html','utf8');
let worker=fs.readFileSync('worker.js','utf8');
function replaceOnce(src,from,to,label){const i=src.indexOf(from);if(i<0) throw new Error('missing marker: '+label);if(src.indexOf(from,i+from.length)>=0) throw new Error('marker not unique: '+label);return src.slice(0,i)+to+src.slice(i+from.length);}
const copyTitle='FB、IG 或官網至少建議填寫一項';
const copyBody='方便主辦審核品牌與商品內容。';
const copyWarn='若完全未填寫，審核將不會通過。';
const noticeHtml=`<div class="member-social-review-notice" style="margin:10px 0 12px;padding:10px 12px;border:1.5px solid #FAEEC7;border-radius:12px;background:#fffdf5;line-height:1.65;color:#555;font-size:16px"><strong style="display:block;color:#111;margin-bottom:2px">${copyTitle}</strong>${copyBody}<br><strong style="color:#8b1c1c">${copyWarn}</strong></div>`;
const confirmEnd=`function openSessionById(id){`;
const noticeHelper=`function uiNotice(message){\n  return new Promise(function(resolve){\n    var old=document.getElementById('uiNoticeOverlay'); if(old){ try{old.remove();}catch(e){} }\n    var ov=document.createElement('div'); ov.id='uiNoticeOverlay';\n    ov.style.cssText='position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:20px';\n    var box=document.createElement('div'); box.style.cssText='width:min(100%,420px);background:#fff;border-radius:18px;padding:20px;box-shadow:0 18px 48px rgba(0,0,0,.22)';\n    var msg=document.createElement('div'); msg.style.cssText='white-space:pre-wrap;margin-bottom:18px;font-weight:800;line-height:1.7;color:#222'; msg.textContent=String(message||'');\n    var ok=document.createElement('button'); ok.type='button'; ok.textContent='知道了'; ok.style.cssText='width:100%;padding:13px;border-radius:12px;border:none;background:#628E87;color:#fff;font-size:17px;font-weight:900;cursor:pointer;font-family:inherit';\n    var done=function(){ try{ov.remove();}catch(e){} resolve(true); }; ok.onclick=done; ov.onclick=function(e){ if(e.target===ov) done(); };\n    box.appendChild(msg); box.appendChild(ok); ov.appendChild(box); document.body.appendChild(ov);\n  });\n}\nfunction showMemberSocialReviewNoticeOnce(){\n  if(ST._memberSocialReviewNoticeShown) return Promise.resolve();\n  ST._memberSocialReviewNoticeShown=true;\n  return uiNotice('${copyTitle}\\n${copyBody}\\n${copyWarn}');\n}\n\n`;
index=replaceOnce(index,confirmEnd,noticeHelper+confirmEnd,'uiNotice insertion');
const profileLabel=`        <label style="margin-top:10px">FB、IG 或官網（至少填寫一項）*</label>`;
index=replaceOnce(index,profileLabel,`        ${noticeHtml}\n        <label style="margin-top:10px">FB、IG 或官網（建議至少填寫一項）</label>`,'profile social label');
const profileTail=`  if(btn) btn.addEventListener('click',()=>saveMemberProfileToDb({silent:false}));\n  try{ dynEl.scrollIntoView({behavior:'smooth',block:'start'}); }catch(e){}\n}`;
index=replaceOnce(index,profileTail,`  if(btn) btn.addEventListener('click',()=>saveMemberProfileToDb({silent:false}));\n  showMemberSocialReviewNoticeOnce();\n  try{ dynEl.scrollIntoView({behavior:'smooth',block:'start'}); }catch(e){}\n}`,'profile notice trigger');
const hardBlock=`  if(!g('np_fb')&&!g('np_ig')&&!g('np_web')){ showError('FB、IG 或官網至少需要填寫一項','np_fb'); return {success:false}; }`;
index=replaceOnce(index,hardBlock,`  if(!silent && !g('np_fb')&&!g('np_ig')&&!g('np_web')) await showMemberSocialReviewNoticeOnce();`,'profile hard block');
const regFb=`      <label>FB</label><input type="url" id="f_fb" value="\${esc(vFb)}" placeholder="https://facebook.com/...">`;
index=replaceOnce(index,regFb,`      ${noticeHtml}\n      <label>FB</label><input type="url" id="f_fb" value="\${esc(vFb)}" placeholder="https://facebook.com/...">`,'registration social notice');
index=replaceOnce(index,`      ST._profileIncomplete = !hasName || !hasBrand || !hasSocial;`,`      ST._profileIncomplete = !hasName || !hasBrand;`,'profile incomplete rule');
index=replaceOnce(index,`        if(!hasSocial) missing.push('FB、IG 或官網（至少一項）');\n`,'','missing social hard requirement');
const saveMemberBlock=`  const socialOrWebsite=String(b.fb||'').trim()||String(b.ig||'').trim()||String(b.collabUrl||b.website||b.web||'').trim();\n  if(!socialOrWebsite) return jsonErr('FB、IG 或官網至少需要填寫一項');\n`;
worker=replaceOnce(worker,saveMemberBlock,'','saveMember social hard block');
const prepareBlock=`    if (mf.requireSocialLinks === true) {\n      const hasSocial = String(b.fb || b.fb_url || '').trim() || String(b.ig || b.ig_url || '').trim() || String(b.collabUrl || b.collab_url || b.website || b.web || '').trim();\n      if (!hasSocial) return {error:'FB、IG 或官網至少需要填寫一項'};\n    }`;
const prepareReplacement=`    if (mf.requireSocialLinks === true && TENANT !== 'tuibile') {\n      const hasSocial = String(b.fb || b.fb_url || '').trim() || String(b.ig || b.ig_url || '').trim() || String(b.collabUrl || b.collab_url || b.website || b.web || '').trim();\n      if (!hasSocial) return {error:'FB、IG 或官網至少需要填寫一項'};\n    }`;
worker=replaceOnce(worker,prepareBlock,prepareReplacement,'prepareRegistration social rule');
fs.writeFileSync('index.html',index);fs.writeFileSync('worker.js',worker);console.log('member social review notice clean patch applied');
