# 2BL 最近一次 Verified Baseline

驗證時間：2026-08-17 17:18–17:21（Asia/Taipei）

## 正式版本

- GitHub 正式程式：`main`
- 功能合併 commit：`80c540143ea5e737c85fd97d3aceadaa806131cf`
- 部署核准 commit：`2988cea09ba9470971921cf9246da42c8d267a8d`
- 部署後基準同步 commit：`47363d3df30ae33c2438e6e207a89a5e39416a91`
- PR：`#49`
- Worker：`2bl-v7`
- Cloudflare version：`d7110474-6e59-4a67-857d-fe54d3a92db0`
- Cloudflare deployment：`ba1fe844-c673-4a91-836a-0038871157f2`
- 流量：100%
- Route：`2b-love.com/s/*`
- 自訂 Worker Domain：無
- 禁止影響的 Worker：`tobeloved-api`，已確認未碰觸

## 已正式驗證

- 三段式報名排程改為每一段可自行設定開始與截止。
- 每段未完整填寫時不啟動；總開關未開啟時不啟動。
- 既有場次沒有因新功能自動開啟排程。
- Worker 正式來源與 GitHub 部署來源一致。
- 2BL 正式 API 與 Supabase 連線正常。
- 角色與後台模組測試、前後台隔離、排位、會員、現場財務、財報短網址、桌機版與資料契約測試通過。
- 正式網站與兩個正式 API 入口回應成功。

## 正式資料唯讀狀態

- 專案：Supabase `douhmxipedgpfbvfynbq`
- 租戶：`tuibile`
- 正式資料表：58
- 正式資料處理程序：30
- RLS：58 張正式資料表均已開啟
- RLS policy：0；目前正式架構由 Worker 使用服務端權限集中存取
- 啟用管理帳號：平台最高總管 2、指定系列管理者 3
- 場次：25
- Storage Bucket：3

本段只有統計與結構，不保存帳號、會員、金流、Token 或 Secret 內容。

## 回復點

- 部署前 Worker version：`1644e59e-b090-4a04-ae1f-8ca9c8f82859`
- 正式回復必須另行取得人工確認；不得更換 Worker、Route 或 Domain 取代回復流程。

## 基準限制

- 這份 Verified Baseline 只代表截至上述版本已驗證的內容。
- 本工作分支的世界樹與永久紀錄仍是 Pending，不得當成已合併或已部署。
- 正式資料庫的持續指令仍是 2026-08-16 舊短版；2026-08-17 完整新版尚未寫入，不能標示為 Verified。
- 後續若變更登入、權限、RLS、共用 API、資料結構、金流或正式路由，必須重新驗證受影響的舊基準。
