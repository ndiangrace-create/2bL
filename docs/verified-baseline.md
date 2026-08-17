# 2BL 最近一次 Verified Baseline

驗證時間：2026-08-17 20:21–20:24（Asia/Taipei）

## 正式版本

- GitHub 正式程式：`main`
- 功能合併 commit：`9ba40e41dd1c7f278604f97e14fa7b6fc31a4db0`
- 部署核准 commit：`cd073e962e9e1904605ae1347f7a73b913fa14b4`
- PR：`#51`
- Worker：`2bl-v7`
- Cloudflare version：`3c90045b-8297-452c-96d6-9f96e1c1cad6`
- GitHub Actions：`32029440639`
- 部署證據 Artifact：`9288314386`
- 流量：100%
- Route：`2b-love.com/s/*`
- 自訂 Worker Domain：無
- 禁止影響的 Worker：`tobeloved-api`，已確認未碰觸

## 本次正式驗證

- 前台查詢紀錄區已移除內部版本字樣。
- 管理後台瀏覽器標題已移除工程名稱。
- 現場頁已移除內部修復版文字。
- 三個正式頁面皆能正常讀取，內部標記搜尋結果為 0。
- 2BL 正式 API 與 Supabase 連線正常。
- Google OAuth 入口正常導向 Google。
- 安全自動流、嚴格資料契約、登入與角色隔離、報名、會員、排位、現場財務、財報短網址、桌機與手機回歸測試通過。
- 本次沒有修改登入、權限、金流、資料庫結構或正式營運資料。
- Worker 正式來源、Route、Domain、Bindings 與 Secret 名稱的部署前後保護檢查通過。

## 沿用的正式資料唯讀狀態

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

- 部署前 Worker version：`d7110474-6e59-4a67-857d-fe54d3a92db0`
- 前一個已驗證部署核准 commit：`2988cea09ba9470971921cf9246da42c8d267a8d`
- 前一個 Cloudflare deployment：`ba1fe844-c673-4a91-836a-0038871157f2`
- 正式回復必須另行取得人工確認；不得更換 Worker、Route 或 Domain 取代回復流程。

## 基準限制

- 這份 Verified Baseline 只代表截至上述版本已驗證的內容。
- 本工作分支的世界樹與永久紀錄仍是 Pending，不得當成已合併或已部署。
- 正式資料庫的持續指令已於 2026-08-17 依明確執行確認更新為 12 節唯一正式全文，重新讀回與正式來源雜湊一致。
- 後續若變更登入、權限、RLS、共用 API、資料結構、金流或正式路由，必須重新驗證受影響的舊基準。
