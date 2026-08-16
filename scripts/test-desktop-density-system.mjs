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
ok(admin.includes('FINANCE_PANEL_SINGLE_COLUMN_20260816'),'財報缺少獨立單欄排列防呆');
ok(admin.includes('.finance-detail-grid{')&&admin.includes('grid-template-columns:minmax(0,1fr)'),'財報仍切成左右兩欄並壓縮內容');
ok(admin.includes('.finance-detail-grid .finance-side{\n  position:static;'),'財報右側區塊仍使用黏附定位');
ok(admin.includes('function financeInvoiceTableHtml'),'財報缺少金流與發票合併邏輯');
ok(admin.includes('報名金流與發票資料'),'財報未將同一筆報名的金流與發票合併');
ok(!admin.includes('<h3>報名金流項目</h3>')&&!admin.includes('<h3>發票資料</h3>'),'財報仍把同一份報名拆成兩張表');
ok(admin.includes('finance-combined-table'),'合併後的完整報名財務表缺少獨立寬版樣式');
ok(admin.includes("countStat('有效報名品牌',r.activePaidBrands,'個'")&&admin.includes("countStat('租用攤位數總計',r.contractedStalls,'攤'"),'品牌數與租用攤位數未放入下方左側統計方塊');
ok(admin.includes("const countSummary='<div class=\"info-line\"><span>每日使用量")&&!admin.includes("const countSummary='<div class=\"info-line\"><span>有效報名品牌"),'品牌數與租用攤位數仍被拉成橫跨整頁的長列');
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
