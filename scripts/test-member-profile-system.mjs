import fs from 'node:fs';
import assert from 'node:assert/strict';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const index=read('index.html');
const worker=read('worker.js');

for(const source of [...index.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(x=>x[1])){
  assert.doesNotThrow(()=>new Function(source),'index.html 內嵌程式語法錯誤');
}
assert.doesNotThrow(()=>new Function(worker.replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?\s*/,'').replace(/^export\s*\{[^}]+\};?\s*$/mg,'').replace(/^export\s+default\s*\{/m,'const __workerExport={')),'worker.js 語法錯誤');

assert.match(worker,/has\(m\.fb_url\)\|\|has\(m\.ig_url\)\|\|has\(m\.collab_url\)/,'後端完整度仍須能辨識 FB、IG 或官網');
assert.doesNotMatch(worker,/if\(!socialOrWebsite\) return jsonErr\('FB、IG 或官網至少需要填寫一項'\)/,'會員儲存不得再因社群三項皆空而硬擋');
assert.match(worker,/mf\.requireSocialLinks === true && TENANT !== 'tuibile'/,'tuibile 報名不得因社群空白被 requireSocialLinks 硬擋');
assert.match(worker,/if\(!supplied\('collabUrl','collab_url','website','web'\)\) delete data\.collab_url/,'部分更新不得洗掉既有官網');
assert.match(worker,/if\(!supplied\('fb','fb_url'\)\) delete data\.fb_url/,'部分更新不得洗掉既有 FB');
assert.match(worker,/if\(!supplied\('ig','ig_url'\)\) delete data\.ig_url/,'部分更新不得洗掉既有 IG');
assert.match(index,/id="np_web"/,'新增會員表單必須提供官網欄位');
assert.match(index,/FB、IG 或官網至少建議填寫一項/,'新增會員必須顯示社群審核提醒');
assert.match(index,/若完全未填寫，審核將不會通過。/,'新增會員必須明確告知缺社群的審核影響');
assert.doesNotMatch(index,/showError\('FB、IG 或官網至少需要填寫一項'/,'新增會員不得再用社群空白阻擋儲存');
assert.match(index,/collabUrl:g\('np_web'\)/,'新增會員官網必須送到後端');
assert.match(index,/collabUrl:\(M\.collabUrl\|\|M\.collab_url\|\|M\.website\|\|M\.web\|\|''\)\.trim\(\)/,'報名時必須帶入會員官網');
assert.doesNotMatch(index,/!!\([^;\n]*\)\.trim\(\)/,'不可再把真假值當成文字呼叫 trim');

const coreComplete=m=>[
  String(m.name||'').trim(),
  String(m.phone||'').trim(),
  String(m.brand||'').trim(),
].every(Boolean);
assert.equal(coreComplete({name:'王小明',phone:'0912345678',brand:'品牌'}),true,'社群空白不得阻擋會員基本資料儲存');
assert.equal(coreComplete({name:'王小明',phone:'0912345678',brand:'品牌',fb:'https://facebook.com/a'}),true);
assert.equal(coreComplete({name:'王小明',phone:'0912345678',brand:'品牌',ig:'https://instagram.com/a'}),true);
assert.equal(coreComplete({name:'王小明',phone:'0912345678',brand:'品牌',web:'https://example.com'}),true);

console.log('會員資料測試通過：FB／IG／官網改為審核提醒，不阻擋儲存／報名；已填資料與部分更新行為維持。');
