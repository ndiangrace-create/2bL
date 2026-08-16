import fs from 'node:fs';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const worker=read('worker.js'),admin=read('admin.html');
const ok=(value,message)=>{if(!value)throw new Error(message)};

ok(worker.includes('const FINANCE_SHARE_CODE_LEN=10'),'財報短碼不是固定 10 碼');
ok(worker.includes("url.searchParams.set('fs',code)")&&!worker.includes("url.searchParams.set('financeShare',token)"),'新財報分享仍產生完整 JWT 長網址');
ok(worker.includes("dbInsert(env,'finance_share_links'")&&worker.includes("tenant_id:T,session_id:sid,expires_at:expiresAt,is_active:true"),'財報短碼未綁定租戶、場次與期限');
ok(worker.includes("is_active=eq.true&expires_at=gt."),'未優先沿用仍有效的財報短碼');
ok(worker.includes("new RegExp(`^[a-z2-9]{${FINANCE_SHARE_CODE_LEN}}$`)"),'公開財報未嚴格驗證短碼格式');
ok(worker.includes("if(row.is_active===false)return jsonErr('財報分享連結已停用')"),'公開財報未阻擋停用短碼');
ok(worker.includes("分享連結已過期，請向主辦取得新的連結"),'公開財報未阻擋過期短碼');
ok(worker.includes("payload.iss!=='2BL-FINANCE-SHARE'")&&worker.includes("payload.type!=='finance_share'"),'舊版長網址相容驗證不完整');
ok(admin.includes("financeShareCode=q.get('fs')||''")&&admin.includes("renderPublicFinanceShare({token:financeShare,code:financeShareCode})"),'管理頁未在登入前切換至獨立唯讀短碼頁');
ok(admin.includes("const isFinanceShare=urlParams.has('financeShare')||urlParams.has('fs')")&&admin.includes("if((t||tok||err)&&!isFinanceShare) history.replaceState"),'頁面初始化會先清除財報短碼');
ok(admin.includes('財報短網址已複製｜14天有效｜唯讀'),'後台沒有明確提示已複製短網址');

console.log('財報專用短碼、14 天期限、唯讀頁與舊連結相容測試通過。');
