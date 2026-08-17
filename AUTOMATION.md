# 2BL 安全自動流

正式目標固定如下：

- GitHub：`ndiangrace-create/2bL`
- 正式分支：`main`
- 工作分支：`agent/2bl-safe-automation`
- Cloudflare Worker：`2bl-v7`
- 禁止操作：`tobeloved-api`
- Supabase：`2bl`／`douhmxipedgpfbvfynbq`
- Tenant：`tuibile`

## 持續溝通、執行與部署授權

- 使用者提出想法、問題、截圖或「怪怪的」時，只能討論與唯讀檢查。
- 只有收到「確認執行」、「開始執行」或「依這個方案執行」才可修改工作分支。
- 執行授權不包含合併或部署；只有收到獨立的「確認部署」才可合併 `main` 並部署正式環境。
- 若執行途中會改變金額、角色權限、正式資料、資料庫結構或既有使用方式，必須暫停並重新確認。
- 任一檢查失敗都必須停止，修正並重新驗證；不得帶著錯誤合併或部署。

## 目前可以自動執行

Pull Request 與手動 audit 只會：讀取 Cloudflare 現況、核對 Worker 來源漂移、檢查 JavaScript、比對 Worker 使用的資料表／RPC 名稱、找出前端直接 Supabase 存取及不允許的 localStorage 資料，並上傳不含 Secret 值的稽核報告。

這個流程只有 `contents: read`，沒有提交、合併、部署、migration 或 Cloudflare 設定寫入步驟。

世界樹、資料字典、角色／日期／狀態矩陣、永久變更帳本、未完成事項與最近一次 Verified Baseline 的正式索引位於 `docs/README.md`。所有新增結構與功能必須先更新該索引並通過 `scripts/verify-project-governance.mjs`。

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
