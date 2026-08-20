import fs from 'node:fs';
const admin=fs.readFileSync('admin.html','utf8'),index=fs.readFileSync('index.html','utf8'),worker=fs.readFileSync('worker.js','utf8'),auth=fs.readFileSync('lib/admin-authorization.js','utf8');
function ok(v,m){if(!v){console.error('FAIL:',m);process.exit(1)}}
ok(admin.includes('saveAdminMemberProfile'),'admin member edit UI missing');ok(admin.includes("action:'adminUpdateMemberProfile'"),'admin edit action not wired');ok(admin.includes('查看修改紀錄'),'history entry missing');ok(admin.includes('Email（唯讀）'),'email must remain readonly');
ok(worker.includes('async function hAdminUpdateMemberProfile'),'worker admin handler missing');ok(worker.includes("'admin_member_profile_update'"),'admin audit missing');ok(worker.includes("'member_profile_self_update'"),'self audit missing');ok(worker.includes('getMemberEditHistory'),'history API missing');ok(worker.includes('sell_category:String(b.category'),'category must use formal sell_category');
ok(auth.includes("'adminUpdateMemberProfile'"),'central authorization missing');ok(index.includes('背景儲存只能沿用已驗證手機'),'background phone guard missing');ok(index.includes('你正在修改登入用手機'),'explicit phone confirm missing');
console.log('PASS member-admin-edit closed loop');
