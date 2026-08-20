from pathlib import Path
p=Path('index.html'); s=p.read_text(encoding='utf-8')
old="""  const email=g('np_email'), phone=g('np_phone');\n  const verifiedPhone=String(ST._verifiedMemberPhone||ST.member?.phone||memberSafePhone()||'').trim();\n  if(!silent && verifiedPhone && phone && phone!==verifiedPhone){\n    if(!await uiConfirm('你正在修改登入用手機：\\n'+verifiedPhone+' → '+phone+'\\n\\n修改後，下次登入要使用新手機。確定要修改嗎？')){if(btn){btn.disabled=false;btn.textContent='儲存資料';}return;}\n  }"""
new="""  const email=g('np_email'), requestedPhone=g('np_phone');\n  const verifiedPhone=String(ST._verifiedMemberPhone||ST.member?.phone||memberSafePhone()||'').trim();\n  // 背景儲存不得改登入手機；只有使用者明確儲存並確認後才採用畫面中的新手機。\n  const phone=(silent&&verifiedPhone)?verifiedPhone:requestedPhone;\n  if(!silent && verifiedPhone && requestedPhone && requestedPhone!==verifiedPhone){\n    if(!await uiConfirm('你正在修改登入用手機：\\n'+verifiedPhone+' → '+requestedPhone+'\\n\\n修改後，下次登入要使用新手機。確定要修改嗎？')){if(btn){btn.disabled=false;btn.textContent='儲存資料';}return;}\n  }"""
if old not in s: raise SystemExit('missing silent-phone marker')
p.write_text(s.replace(old,new,1),encoding='utf-8')

t=Path('scripts/test-member-admin-edit.mjs'); x=t.read_text(encoding='utf-8')
needle="ok(auth.includes(\"'adminUpdateMemberProfile'\"),'central authorization missing');"
repl=needle+"ok(index.includes('const phone=(silent&&verifiedPhone)?verifiedPhone:requestedPhone;'),'silent save must preserve verified phone');"
if 'silent save must preserve verified phone' not in x:
    if needle not in x: raise SystemExit('missing test marker')
    t.write_text(x.replace(needle,repl,1),encoding='utf-8')
