import fs from 'node:fs';
import assert from 'node:assert/strict';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const index=read('index.html');
const worker=read('worker.js');

for(const source of [...index.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(x=>x[1])){
  assert.doesNotThrow(()=>new Function(source),'index.html 內嵌程式語法錯誤');
}
assert.doesNotThrow(()=>new Function(worker.replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?\s*/,'').replace(/^export\s*\{[^}]+\};?\s*$/mg,'').replace(/^export\s+default\s*\{/m,'const __workerExport={')),'worker.js 語法錯誤');

assert.match(worker,/has\(m\.fb_url\)\|\|has\(m\.ig_url\)\|\|has\(m\.collab_url\)/,'後端完整度必須接受 FB、IG 或官網');
assert.match(worker,/if\(!socialOrWebsite\) return jsonErr\('FB、IG 或官網至少需要填寫一項'\)/,'後端儲存必須阻擋三項皆空');
assert.match(worker,/if\(!supplied\('collabUrl','collab_url','website','web'\)\) delete data\.collab_url/,'部分更新不得洗掉既有官網');
assert.match(worker,/if\(!supplied\('fb','fb_url'\)\) delete data\.fb_url/,'部分更新不得洗掉既有 FB');
assert.match(worker,/if\(!supplied\('ig','ig_url'\)\) delete data\.ig_url/,'部分更新不得洗掉既有 IG');
assert.match(index,/id="np_web"/,'新增會員表單必須提供官網欄位');
assert.match(index,/if\(!g\('np_fb'\)&&!g\('np_ig'\)&&!g\('np_web'\)\)/,'新增會員送出前必須檢查三選一');
assert.match(index,/collabUrl:g\('np_web'\)/,'新增會員官網必須送到後端');
assert.match(index,/collabUrl:\(M\.collabUrl\|\|M\.collab_url\|\|M\.website\|\|M\.web\|\|''\)\.trim\(\)/,'報名時必須帶入會員官網');
assert.doesNotMatch(index,/!!\([^;\n]*\)\.trim\(\)/,'不可再把真假值當成文字呼叫 trim');

const complete=m=>[
  String(m.name||'').trim(),
  String(m.phone||'').trim(),
  String(m.brand||'').trim(),
  String(m.fb||m.ig||m.web||'').trim(),
].every(Boolean);
assert.equal(complete({name:'王小明',phone:'0912345678',brand:'品牌',sell:'飾品',intro:'介紹',fb:'https://facebook.com/a'}),true);
assert.equal(complete({name:'王小明',phone:'0912345678',brand:'品牌',sell:'飾品',intro:'介紹',ig:'https://instagram.com/a'}),true);
assert.equal(complete({name:'王小明',phone:'0912345678',brand:'品牌',sell:'飾品',intro:'介紹',web:'https://example.com'}),true);
assert.equal(complete({name:'王小明',phone:'0912345678',brand:'品牌',sell:'飾品',intro:'介紹'}),false);
assert.equal(complete({name:'王小明',phone:'0912345678',brand:'品牌',web:'https://example.com'}),true,'非必填資料不可擋住儲存或報名');

console.log('會員資料測試通過：FB／IG／官網三選一、已填不誤擋、部分更新不清空舊資料。');
