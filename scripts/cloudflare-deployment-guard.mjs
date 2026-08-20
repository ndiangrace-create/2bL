import fs from "node:fs";

const mode = process.argv[2] || "pre";
const expectedVersion = process.env.EXPECTED_CLOUDFLARE_VERSION_ID || "";
const allowWorkersAiMigration = process.env.ALLOW_WORKERS_AI_MIGRATION === "true";
const baseline = JSON.parse(fs.readFileSync(".automation/cloudflare-baseline.json", "utf8"));
const audit = JSON.parse(fs.readFileSync(".automation/cloudflare-audit.json", "utf8"));

if (!['pre', 'post'].includes(mode)) throw new Error("mode 只能是 pre 或 post");
if (audit.worker_name !== "2bl-v7" || audit.forbidden_worker_untouched !== "tobeloved-api") {
  throw new Error("安全阻斷：Worker 目標不正確");
}

const normalize = value => JSON.stringify(value ?? null);
const protectedFields = ["routes", "custom_domains", "workers_dev", "bindings", "secret_names"];
for (const field of protectedFields) {
  let actual = audit[field];
  if (mode === "pre" && allowWorkersAiMigration && field === "secret_names") {
    actual = (Array.isArray(actual) ? actual : []).filter(name => name !== "OPENAI_API_KEY");
  }
  if (mode === "pre" && allowWorkersAiMigration && field === "bindings") {
    actual = (Array.isArray(actual) ? actual : [])
      .filter(binding => binding?.name !== "OPENAI_API_KEY");
    if (!actual.some(binding => binding?.name === "AI" && binding?.type === "ai")) {
      actual.push({ name: "AI", type: "ai" });
    }
    actual.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
  }
  if (normalize(actual) !== normalize(baseline[field])) {
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
