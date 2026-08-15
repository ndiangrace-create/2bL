import fs from "node:fs";
import crypto from "node:crypto";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const TARGET_WORKER = "2bl-v7";
const FORBIDDEN_WORKER = "tobeloved-api";
const BOOTSTRAP = process.env.BOOTSTRAP_SOURCE === "true";
const API = "https://api.cloudflare.com/client/v4";

if (!ACCOUNT_ID || !API_TOKEN) {
  throw new Error("缺少 CLOUDFLARE_ACCOUNT_ID 或 CLOUDFLARE_API_TOKEN GitHub Secret");
}
if (TARGET_WORKER === FORBIDDEN_WORKER) {
  throw new Error("安全阻斷：禁止操作 DOING Worker");
}

async function cf(path, { optional = false, raw = false } = {}) {
  const response = await fetch(API + path, {
    method: "GET",
    headers: { Authorization: `Bearer ${API_TOKEN}` }
  });
  if (!response.ok) {
    const detail = await response.text();
    if (optional) return { unavailable: true, status: response.status };
    throw new Error(`Cloudflare GET ${path} 失敗：HTTP ${response.status} ${detail.slice(0, 300)}`);
  }
  if (raw) return response;
  const payload = await response.json();
  if (payload.success === false) {
    throw new Error(`Cloudflare GET ${path} 失敗：${JSON.stringify(payload.errors || [])}`);
  }
  return payload.result;
}

function safeBinding(binding) {
  return {
    name: String(binding?.name || ""),
    type: String(binding?.type || "")
  };
}

const token = await cf("/user/tokens/verify");
const settings = await cf(`/accounts/${ACCOUNT_ID}/workers/scripts/${TARGET_WORKER}/settings`);
const deployments = await cf(`/accounts/${ACCOUNT_ID}/workers/scripts/${TARGET_WORKER}/deployments`);
const subdomain = await cf(`/accounts/${ACCOUNT_ID}/workers/scripts/${TARGET_WORKER}/subdomain`, { optional: true });
const secrets = await cf(`/accounts/${ACCOUNT_ID}/workers/scripts/${TARGET_WORKER}/secrets`, { optional: true });
const domains = await cf(`/accounts/${ACCOUNT_ID}/workers/domains`, { optional: true });
const zones = await cf(`/zones?account.id=${ACCOUNT_ID}&per_page=50`);

const matchedRoutes = [];
for (const zone of Array.isArray(zones) ? zones : []) {
  const routes = await cf(`/zones/${zone.id}/workers/routes`);
  for (const route of Array.isArray(routes) ? routes : []) {
    if (String(route.script || "") === TARGET_WORKER) {
      matchedRoutes.push({
        zone_name: String(zone.name || ""),
        pattern: String(route.pattern || "")
      });
    }
  }
}

const contentResponse = await cf(
  `/accounts/${ACCOUNT_ID}/workers/scripts/${TARGET_WORKER}/content`,
  { raw: true }
);
const contentBytes = Buffer.from(await contentResponse.arrayBuffer());
const contentType = contentResponse.headers.get("content-type") || "";
const deployedSha256 = crypto.createHash("sha256").update(contentBytes).digest("hex");

const currentDeployment = Array.isArray(deployments?.items)
  ? deployments.items[0]
  : Array.isArray(deployments)
    ? deployments[0]
    : null;

const customDomains = Array.isArray(domains)
  ? domains
      .filter(item => String(item?.service || item?.script || "") === TARGET_WORKER)
      .map(item => String(item?.hostname || item?.domain || ""))
      .filter(Boolean)
  : [];

const report = {
  generated_at: new Date().toISOString(),
  repository: process.env.GITHUB_REPOSITORY || "",
  git_ref: process.env.GITHUB_REF || "",
  git_sha: process.env.GITHUB_SHA || "",
  cloudflare_account_suffix: ACCOUNT_ID.slice(-6),
  token_status: String(token?.status || "active"),
  worker_name: TARGET_WORKER,
  forbidden_worker_untouched: FORBIDDEN_WORKER,
  deployed_content_sha256: deployedSha256,
  deployed_content_type: contentType,
  compatibility_date: String(settings?.compatibility_date || ""),
  compatibility_flags: Array.isArray(settings?.compatibility_flags) ? settings.compatibility_flags : [],
  usage_model: String(settings?.usage_model || ""),
  bindings: Array.isArray(settings?.bindings) ? settings.bindings.map(safeBinding) : [],
  secret_names: Array.isArray(secrets)
    ? secrets.map(item => String(item?.name || "")).filter(Boolean)
    : [],
  secrets_endpoint_available: !secrets?.unavailable,
  workers_dev: subdomain?.unavailable
    ? { endpoint_available: false }
    : {
        endpoint_available: true,
        enabled: Boolean(subdomain?.enabled),
        previews_enabled: Boolean(subdomain?.previews_enabled)
      },
  routes: matchedRoutes,
  custom_domains: customDomains,
  current_deployment: currentDeployment
    ? {
        id: String(currentDeployment.id || ""),
        created_on: String(currentDeployment.created_on || ""),
        source: String(currentDeployment.source || "")
      }
    : null
};

fs.mkdirSync(".automation", { recursive: true });
fs.writeFileSync(".automation/cloudflare-audit.json", JSON.stringify(report, null, 2) + "\n");

const sourcePath = "worker.js";
if (fs.existsSync(sourcePath)) {
  const localBytes = fs.readFileSync(sourcePath);
  const localSha = crypto.createHash("sha256").update(localBytes).digest("hex");
  report.github_worker_sha256 = localSha;
  report.worker_source_matches_deployment = localSha === deployedSha256;
  fs.writeFileSync(".automation/cloudflare-audit.json", JSON.stringify(report, null, 2) + "\n");
  if (localSha !== deployedSha256) {
    throw new Error(`安全阻斷：GitHub worker.js (${localSha}) 與 Cloudflare 2bl-v7 (${deployedSha256}) 不一致`);
  }
} else if (BOOTSTRAP) {
  if (!/javascript|ecmascript|text\/plain/i.test(contentType)) {
    throw new Error(`無法安全取回 Worker 單檔來源，Content-Type 為 ${contentType}`);
  }
  const sourceText = contentBytes.toString("utf8");
  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /(?:sk|rk)-[A-Za-z0-9_-]{20,}/,
    /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/
  ];
  if (secretPatterns.some(pattern => pattern.test(sourceText))) {
    throw new Error("安全阻斷：已部署 Worker 原始碼疑似含硬編碼機密，禁止提交 GitHub");
  }
  fs.writeFileSync(sourcePath, contentBytes);
  fs.writeFileSync(".automation/cloudflare-baseline.json", JSON.stringify(report, null, 2) + "\n");
  console.log(`已從 Cloudflare 2bl-v7 取得正式來源，SHA-256：${deployedSha256}`);
} else {
  throw new Error("安全阻斷：GitHub 尚無 worker.js，且本次未授權來源初始化");
}

console.log(JSON.stringify({
  ok: true,
  worker: TARGET_WORKER,
  sha256: deployedSha256,
  routes: matchedRoutes.length,
  custom_domains: customDomains.length,
  bindings: report.bindings.length,
  secret_names: report.secret_names.length
}));
