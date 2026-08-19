# 2BL 安全自動流

正式目標固定如下：

- GitHub：`ndiangrace-create/2bL`
- 正式分支：`main`
- 工作分支：`agent/2bl-safe-automation`
- Cloudflare Worker：`2bl-v7`
- 禁止操作：`tobeloved-api`
- Supabase：`2bl`／`douhmxipedgpfbvfynbq`
- Tenant：`tuibile`

## 目前可以自動執行

使用者授權「執行」只允許在安全工作分支完成修改與驗證，不等於合併或部署授權。只有收到使用者明確說出「確認部署」後，才可合併 `main` 並部署 `2bl-v7`。任一檢查失敗都必須停止部署並修正或回報。

Pull Request 與手動 audit 只會：讀取 Cloudflare 現況、核對 Worker 來源漂移、檢查 JavaScript、比對 Worker 使用的資料表／RPC 名稱、找出前端直接 Supabase 存取及不允許的 localStorage 資料，並上傳不含 Secret 值的稽核報告。

這個流程只有 `contents: read`，沒有提交、合併、部署、migration 或 Cloudflare 設定寫入步驟。

## 正式部署的安全鎖

`.github/workflows/2bl-production-deploy.yml` 只能從 `main` 手動啟動，且必須同時提供：

1. 完整文字 `確認部署 2bl-v7`。
2. 已核准且已合併的完整 main commit SHA。
3. 部署前報告中的 Cloudflare version ID。
4. GitHub Environment `2bl-production` 的人工核准（需由儲存庫管理者設定 required reviewer）。

部署前會再次執行資料契約嚴格檢查、Cloudflare 漂移檢查及 Wrangler dry-run。任何阻擋項目、版本漂移、Routes／Domains／Bindings／Secrets 名稱偏移或 commit 不一致都會停止。

Wrangler 設定固定指向既有 `2bl-v7`，不含 `routes`、`route`、`custom_domains` 或任何資源自動建立設定；`keep_vars` 保留 Dashboard 既有 Variables，Secret 只核對名稱、不讀取內容。

## 你需要明確設定／更換的項目

現在不用更換任何程式值，也不要更換 Worker 名稱。你只需要在準備正式部署時：

- 將 GitHub Environment `2bl-production` 設定 required reviewer。
- 把部署前報告列出的「完整 main commit SHA」填入 `expected_commit`。
- 把部署前報告列出的「Cloudflare version ID」填入 `expected_cloudflare_version`。
- 在 `confirmation` 原樣輸入 `確認部署 2bl-v7`。

`CLOUDFLARE_ACCOUNT_ID` 與 `CLOUDFLARE_API_TOKEN` 已存在 GitHub Secrets 時不需重填；流程不會顯示其內容。

## 回復方式

部署證據會保存部署前 version ID。正式驗證失敗時立即停止，由人工核准後才可對 `2bl-v7` 執行指定 version rollback；不得改用新 Worker、不得改 Routes 或 Domains。
