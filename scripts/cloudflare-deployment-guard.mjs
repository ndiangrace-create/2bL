import fs from "node:fs";

const mode = process.argv[2] || "pre";
const expectedVersion = process.env.EXPECTED_CLOUDFLARE_VERSION_ID || "";
const baseline = JSON.parse(fs.readFileSync(".automation/cloudflare-baseline.json", "utf8"));
const audit = JSON.parse(fs.readFileSync(".automation/cloudflare-audit.json", "utf8"));

if (!['pre', 'post'].includes(mode)) throw new Error("mode 只能是 pre 或 post");
if (audit.worker_name !== "2bl-v7" || audit.forbidden_worker_untouched !== "tobeloved-api") {
  throw new Error("安全阻斷：Worker 目標不正確");
}

const normalize = value => JSON.stringify(value ?? null);
const protectedFields = ["routes", "custom_domains", "workers_dev", "bindings", "secret_names"];
for (const field of protectedFields) {
  if (normalize(audit[field]) !== normalize(baseline[field])) {
    throw new Error(`安全阻斷：Cloudflare ${field} 已偏離核准基準`);
  }
}
if (audit.compatibility_date !== baseline.compatibility_date ||
    normalize(audit.compatibility_flags) !== normalize(baseline.compatibility_flags)) {
  throw new Error("安全阻斷：Compatibility 設定已偏離核准基準");
}

const actualVersion = audit.current_version_id || audit.current_deployment?.versions?.[0]?.version_id || "";
if (mode === "pre") {
  if (!expectedVersion) throw new Error("缺少 EXPECTED_CLOUDFLARE_VERSION_ID");
  if (actualVersion !== expectedVersion) {
    throw new Error(`安全阻斷：正式 Worker 版本已漂移（預期 ${expectedVersion}，實際 ${actualVersion || '無法取得'}）`);
  }
} else if (!audit.worker_source_matches_deployment) {
  throw new Error("部署後 Worker 來源與 GitHub commit 不一致");
}

console.log(JSON.stringify({ok:true, mode, worker:audit.worker_name, version:actualVersion}));
