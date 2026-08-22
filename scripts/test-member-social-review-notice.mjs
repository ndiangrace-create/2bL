import fs from 'node:fs';
import assert from 'node:assert/strict';
const index=fs.readFileSync('index.html','utf8');
const worker=fs.readFileSync('worker.js','utf8');

assert.match(index,/function uiNotice\(/);
assert.match(index,/function showMemberSocialReviewNoticeOnce\(/);
assert.match(index,/FB、IG 或官網至少建議填寫一項/);
assert.match(index,/方便主辦審核品牌與商品內容。/);
assert.match(index,/若完全未填寫，審核將不會通過。/);
assert.match(index,/showMemberSocialReviewNoticeOnce\(\);/);
assert.match(index,/FB、IG 或官網（建議至少填寫一項）/);
assert.doesNotMatch(index,/showError\('FB、IG 或官網至少需要填寫一項'/);
assert.match(index,/ST\._profileIncomplete = !hasName \|\| !hasBrand;/);
assert.doesNotMatch(index,/missing\.push\('FB、IG 或官網（至少一項）'\)/);

assert.doesNotMatch(worker,/socialOrWebsite[\s\S]{0,220}FB、IG 或官網至少需要填寫一項/);
assert.match(worker,/mf\.requireSocialLinks === true && TENANT !== 'tuibile'/);
assert.match(worker,/findVerifiedMemberByEmailPhone/);
assert.match(worker,/prepareRegistration/);
assert.match(worker,/upsertMember/);

console.log('member social review notice tests: PASS');
// final validation trigger
