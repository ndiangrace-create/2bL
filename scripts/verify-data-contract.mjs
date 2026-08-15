import fs from "node:fs";
import path from "node:path";

const strict = process.argv.includes("--strict");
const root = process.env.DATA_CONTRACT_ROOT || process.cwd();
const auditPath = path.join(root, ".automation", "supabase-schema-audit.json");
const formalFiles = ["index.html", "admin.html", "onsite.html", "worker.js"];

if (!fs.existsSync(auditPath)) throw new Error("缺少 Supabase 唯讀盤點基準");
const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
if (audit?.project?.id !== "douhmxipedgpfbvfynbq" || audit?.project?.name !== "2bl") {
  throw new Error("安全阻斷：Supabase 正式專案不是 2bl / douhmxipedgpfbvfynbq");
}

const sources = {};
for (const file of formalFiles) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) throw new Error(`缺少正式檔案：${file}`);
  sources[file] = fs.readFileSync(full, "utf8");
}

const frontendFiles = formalFiles.filter(file => file.endsWith(".html"));
const directSupabase = [];
for (const file of frontendFiles) {
  const source = sources[file];
  for (const pattern of [/\.supabase\.co/gi, /\/rest\/v1\//gi, /\/rpc\//gi, /createClient\s*\(/gi, /SUPABASE_(?:URL|KEY|SERVICE_ROLE_KEY)/g]) {
    if (pattern.test(source)) directSupabase.push({ file, pattern: String(pattern) });
  }
}

function literalConstants(source) {
  const result = new Map();
  for (const match of source.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*['"]([^'"]+)['"]/g)) {
    result.set(match[1], match[2]);
  }
  return result;
}

const allowedStorage = new Set([
  "2bl_page_state", "2bl_current_tab", "2bl_activity_view",
  "tb_member_email", "tb_member_email_v2", "2bl_member_token",
  "2bl_admin_page_state", "tb_v3", "2bl_onsite_admin_token",
  "2bl_onsite_admin_email", "2bl_onsite_email", "2bl_onsite_tenant"
]);
const storageUses = [];
for (const file of frontendFiles) {
  const source = sources[file];
  const constants = literalConstants(source);
  for (const match of source.matchAll(/localStorage\.(getItem|setItem|removeItem)\(\s*([^,)]+)/g)) {
    const method = match[1];
    const raw = match[2].trim();
    const literal = raw.match(/^['"]([^'"]+)['"]$/)?.[1];
    const key = literal || constants.get(raw) || `<dynamic:${raw}>`;
    storageUses.push({ file, method, key });
  }
}
const uniqueStorageUses = [...new Map(storageUses.map(item => [`${item.file}:${item.method}:${item.key}`, item])).values()];
const disallowedStorage = uniqueStorageUses.filter(item => item.method !== "removeItem" && !allowedStorage.has(item.key));

const worker = sources["worker.js"];
const tableCalls = [...worker.matchAll(/\bdb(?:Get|Insert|Update|Delete)\s*\(\s*env\s*,\s*['"]([a-z0-9_]+)['"]/g)].map(m => m[1]);
const rpcCalls = [...worker.matchAll(/\bdbRpc\s*\(\s*env\s*,\s*['"]([a-z0-9_]+)['"]/g)].map(m => m[1]);
const usedTables = [...new Set(tableCalls)].sort();
const usedRoutines = [...new Set(rpcCalls)].sort();
const knownTables = new Set(audit.inventory.tables);
const knownRoutines = new Set(audit.inventory.routines);
const migrationDir = path.join(root, "supabase");
if (fs.existsSync(migrationDir)) {
  for (const file of fs.readdirSync(migrationDir).filter(name => name.endsWith(".sql"))) {
    const sql = fs.readFileSync(path.join(migrationDir, file), "utf8");
    for (const match of sql.matchAll(/create\s+or\s+replace\s+function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi)) {
      knownRoutines.add(match[1].toLowerCase());
    }
  }
}
const unknownTables = usedTables.filter(name => !knownTables.has(name));
const unknownRoutines = usedRoutines.filter(name => !knownRoutines.has(name));

const blockers = [];
if (directSupabase.length) blockers.push("前端存在直接 Supabase 存取");
if (unknownTables.length) blockers.push("Worker 引用不存在的資料表");
if (unknownRoutines.length) blockers.push("Worker 引用不存在的 RPC");
if (disallowedStorage.length) blockers.push("localStorage 保存非允許資料");
if ((audit.security_blockers || []).length) blockers.push("Supabase 權限安全問題尚未修正");

const report = {
  generated_at: new Date().toISOString(),
  project_id: audit.project.id,
  formal_files: formalFiles,
  frontend_direct_supabase: directSupabase,
  worker_tables: usedTables,
  worker_routines: usedRoutines,
  unknown_tables: unknownTables,
  unknown_routines: unknownRoutines,
  local_storage: {
    allowed_keys: [...allowedStorage].sort(),
    observed: uniqueStorageUses,
    disallowed: disallowedStorage
  },
  blockers,
  deployment_ready: blockers.length === 0
};

fs.mkdirSync(path.join(root, ".automation"), { recursive: true });
fs.writeFileSync(path.join(root, ".automation", "data-contract-report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (strict && blockers.length) process.exitCode = 2;
