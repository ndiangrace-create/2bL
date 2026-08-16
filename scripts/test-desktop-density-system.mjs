import fs from 'node:fs';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const admin=read('admin.html');
const onsite=read('onsite.html');
const consignment=read('consignment.html');
const index=read('index.html');
const pos=read('pos.html');
const about=read('about.html');
const ok=(value,message)=>{if(!value)throw new Error(message)};

ok(admin.includes('SYSTEM_DESKTOP_DENSITY_GUARD_20260816'),'後台缺少桌機密度防呆');
ok(admin.includes('#page-consignment > .cards{grid-template-columns:repeat(2'),'後台寄賣入口仍是一張占整排');
ok(admin.includes('> :is(.empty,.loading,.notice){grid-column:1/-1!important}'),'後台提示訊息仍可能占掉第一張卡的位置');
ok(admin.includes('FINANCE_PANEL_BALANCED_LAYOUT_20260816'),'財報缺少獨立的桌機左右比例');
ok(admin.includes('grid-template-columns:minmax(0,9fr) minmax(0,11fr)'),'財報右側發票資料仍被壓縮');
ok(admin.includes('<div class="finance-detail-grid">'),'財報仍誤用一般詳情頁 2:1 欄寬');
ok(admin.includes('@media (max-width:1380px)')&&admin.includes('.finance-detail-grid{grid-template-columns:1fr;}'),'較小螢幕的財報沒有自動改為上下排列');
ok(onsite.includes('#regsList>.empty,#regsList>.loading,#regsList>.notice{grid-column:1/-1'),'現場空白提示仍可能造成左右錯位');
ok(onsite.includes('#regsList{display:grid;grid-template-columns:repeat(2'),'現場電腦版攤商卡沒有兩張並排');
ok(onsite.includes('DESKTOP_REG_CARD_REFLOW_20260816'),'現場電腦版攤商卡缺少閱讀重排');
ok(onsite.includes('class="desktop-reg-header"'),'攤位號碼仍未移到卡片右上角');
ok(onsite.includes('class="desktop-reg-info"'),'攤商資料仍是凌亂文字列');
ok(onsite.includes('class="desktop-reg-note"'),'長備註仍未改為可展開內容');
ok(consignment.includes('CONSIGNMENT_DESKTOP_DENSITY_20260816'),'寄賣頁缺少桌機小卡排版');
ok(consignment.includes("$('sessionList').className='compact-card-list'"),'寄賣檔期未啟用並排小卡');
ok(consignment.includes("$('sessionList').className=''"),'寄賣申請表未恢復完整寬度');
ok(consignment.includes("$('myApps').className='compact-card-list'"),'我的寄賣申請仍是一張占整排');
ok(consignment.includes("$('myProducts').className='compact-card-list product-card-list'"),'寄賣商品仍是一張占整排');

ok(/#eventsList[^}]*grid-template-columns/s.test(index),'首頁活動清單沒有桌機並排格線');
ok(/m-record-grid[^}]*grid-template-columns/s.test(index),'會員紀錄沒有桌機並排格線');
ok(/\.grid\{display:grid;grid-template-columns/s.test(pos),'POS 主要工作區沒有桌機分欄');
ok(/\.grid\{display:grid;grid-template-columns/s.test(about),'介紹頁內容沒有桌機分欄');
ok(admin.includes('@media(max-width:860px)')&&onsite.includes('@media(max-width:680px)')&&consignment.includes('@media(max-width:900px)'),'手機版缺少獨立單欄規則');

console.log('全系統桌機密度、卡片排列、空白錯位與手機版隔離檢查通過。');
