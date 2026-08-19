import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeOfficialGroupConfig,
  officialGroupForMemberRegistration,
  renderEmailTemplateBody,
} from '../worker.js';
import { TENANT_OWNER_ACTIONS } from '../lib/admin-authorization.js';

const expectedUrl = 'https://line.me/ti/g2/cp-K_Los4J2zBc6rGcRA14TJCx3e99v0i4p-hQ?utm_source=invitation&utm_medium=link_copy&utm_campaign=default';
const group = normalizeOfficialGroupConfig(null, 'tuibile');
assert.deepEqual(group, {
  enabled:true,
  name:'全台市集藝文資訊中心 大群組',
  inviteText:'您已被邀請加入「全台市集藝文資訊中心 大群組」！請點選以下連結加入社群！',
  url:expectedUrl,
  password:'8825',
});
assert.equal(normalizeOfficialGroupConfig({enabled:true,url:'javascript:alert(1)'}, 'x').url, '', '非 HTTPS 邀請網址必須被清除');

const tenantCtx = {officialGroup:group};
assert.equal(officialGroupForMemberRegistration({review_status:'已錄取',payment_status:'未繳費'}, tenantCtx), null, '未繳費不得取得邀請');
assert.equal(officialGroupForMemberRegistration({review_status:'已錄取',payment_status:'待確認'}, tenantCtx), null, '付款待確認不得取得邀請');
assert.equal(officialGroupForMemberRegistration({review_status:'已錄取',payment_status:'已繳費'}, tenantCtx)?.password, '8825', '已確認繳費應取得邀請');
assert.equal(officialGroupForMemberRegistration({review_status:'已錄取',payment_status:'免費',amount:0,total_amount:0}, tenantCtx)?.url, expectedUrl, '免費有效報名應取得邀請');
assert.equal(officialGroupForMemberRegistration({review_status:'已取消',payment_status:'已繳費'}, tenantCtx), null, '取消後不得取得邀請');
assert.equal(officialGroupForMemberRegistration({review_status:'已錄取',payment_status:'已繳費',transfer_status:'申請退費'}, tenantCtx), null, '退費流程不得取得邀請');

const emailHtml = renderEmailTemplateBody('[大群組邀請文字]\n大群組密碼：[大群組密碼]\n[按鈕:加入大群組]', {
  大群組邀請文字:group.inviteText,
  大群組密碼:group.password,
}, tenantCtx, 'REG_1');
assert.match(emailHtml, /8825/, '繳費確認信缺少大群組密碼');
assert.match(emailHtml, /加入「全台市集藝文資訊中心 大群組」/, '繳費確認信缺少加入按鈕');
assert.match(emailHtml, /href="https:\/\/line\.me\//, '邀請網址未藏在信件按鈕中');

const front = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
assert.match(front, /cp-K_Los4J2zBc6rGcRA14TJCx3e99v0i4p-hQ/, '既有 FAQ 大群組資訊不得因新增卡片而消失');
assert.match(front, /function officialGroupCardHtml\(reg\)/, '我的紀錄缺少已繳費社群卡片');
assert.match(front, /groupReg\?officialGroupCardHtml\(groupReg\)/, '社群卡片未接到我的紀錄卡片');
assert.match(front, /openPreEventNotice[\s\S]*officialGroupForReg\(r\)/, '行前通知原有大群組入口遭移除');
assert.match(front, /function officialGroupUrl\(regOrId\)/, '既有大群組網址函式不得因新增卡片而消失');
assert.match(front, /function officialGroupName\(regOrId\)/, '既有大群組名稱函式不得因新增卡片而消失');
assert.match(admin, /id="group_password"/, '後台缺少大群組密碼設定');
assert.match(admin, /action:'saveOfficialGroupSettings'/, '後台未接正式大群組儲存');
assert.ok(TENANT_OWNER_ACTIONS.has('getOfficialGroupSettings'), '大群組讀取未鎖租戶總管理者');
assert.ok(TENANT_OWNER_ACTIONS.has('saveOfficialGroupSettings'), '大群組儲存未鎖租戶總管理者');
assert.match(worker, /config\.officialGroup = next/, '大群組設定未使用獨立 config_json 區塊');
assert.match(worker, /const config = safeJson\(rows\[0\]\.config_json, \{\}\)/, '儲存前未保留既有租戶設定');

console.log(JSON.stringify({ok:true,feature:'paid-official-group',paid:true,unpaidHidden:true,cancelledHidden:true}));
