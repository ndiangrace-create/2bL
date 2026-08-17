import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const json=rel=>JSON.parse(read(rel));
const required=[
  'docs/README.md','docs/world-tree.md','docs/data-dictionary.md','docs/api-action-catalog.md',
  'docs/source-file-catalog.md','docs/role-date-state-matrix.md','docs/change-ledger.md',
  'docs/verified-baseline.md','docs/open-items.md',
  '.automation/world-tree-source-audit.json','.automation/operational-source-audit.json',
];
const errors=[];
for(const rel of required) if(!fs.existsSync(path.join(root,rel))) errors.push(`缺少 ${rel}`);

const automation=read('AUTOMATION.md');
for(const token of ['ndiangrace-create/2bL','main','2bl-v7','tobeloved-api','douhmxipedgpfbvfynbq','tuibile']){
  if(!automation.includes(token)) errors.push(`AUTOMATION.md 缺少正式邊界 ${token}`);
}
if(automation.includes('直接合併並部署')) errors.push('AUTOMATION.md 仍含未確認即部署的舊規則');
if(!automation.includes('確認執行')||!automation.includes('確認部署')) errors.push('AUTOMATION.md 未分離執行與部署授權');

const db=json('.automation/world-tree-source-audit.json');
const ops=json('.automation/operational-source-audit.json');
const cf=json('.automation/cloudflare-baseline.json');
if(db.project_id!=='douhmxipedgpfbvfynbq'||db.tenant_id!=='tuibile') errors.push('資料結構快照專案邊界錯誤');
if(db.database_structure_changed!==false) errors.push('第一階段不得變更資料庫結構');
if(ops.business_data_changed!==false) errors.push('第一階段不得變更正式營運資料');
if(ops.canonical_instruction_attachment?.matches_database_record!==true) errors.push('完整持續指令尚未與正式資料庫一致');
if(ops.canonical_instruction_attachment?.content_stored_in_audit!==true) errors.push('持續指令修改前後內容缺少永久稽核回復點');
if(ops.canonical_instruction_attachment?.one_time_request_excluded!==true) errors.push('一次性新增要求不應混入正式持續指令');
if(cf.worker_name!=='2bl-v7'||cf.forbidden_worker_untouched!=='tobeloved-api') errors.push('Cloudflare 正式邊界錯誤');
if(cf.worker_source_matches_deployment!==true) errors.push('正式 Worker 來源與部署不一致');

const dictionary=read('docs/data-dictionary.md');
for(const table of db.tables||[]) if(!dictionary.includes(`## ${table.name}\n`)) errors.push(`資料字典缺少 ${table.name}`);
const api=read('docs/api-action-catalog.md');
for(const expected of ['frontBootstrap','register','adminLogin','adminSeatBoard','refundDeposit','createFinanceShare']){
  if(!api.includes(`| ${expected} |`)) errors.push(`API 目錄缺少 ${expected}`);
}
const baseline=read('docs/verified-baseline.md');
for(const expected of [cf.current_version_id,cf.current_deployment?.id,cf.git_sha]){
  if(expected&&!baseline.includes(expected)) errors.push(`Verified Baseline 缺少 ${expected}`);
}
const ledger=read('docs/change-ledger.md');
if(!ledger.includes('Pending')||!ledger.includes('Verified')) errors.push('永久變更帳本缺少狀態規則或基準紀錄');
const openItems=read('docs/open-items.md');
if(!openItems.includes('完整持續指令已同步至專案資料庫')) errors.push('未完成事項尚未標示持續指令同步完成');

if(errors.length){console.error(JSON.stringify({ok:false,errors},null,2));process.exit(1);}
console.log(JSON.stringify({ok:true,documents:required.length,tables:db.tables.length,routines:db.routines.length,workerVersion:cf.current_version_id}));
