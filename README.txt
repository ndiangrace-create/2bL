2BL 團GO｜完整 Worker 修正版

正式環境：
- Repo：ndiangrace-create/2bL
- Branch：main
- Worker：2bl-v7
- Supabase Project Ref：douhmxipedgpfbvfynbq
- tenant_id：tuibile

【這次最重要的修正】
上一包的 worker.txt 只有 174 行，是團購 wrapper，不能當正式完整 Worker 覆蓋。
本包已重新直接讀取 Cloudflare 2bl-v7「目前線上正式部署 Worker」作為基準，再把最新團GO模組合併進同一份完整 Worker。

正式線上 Worker 基準：
- 13,226 行
- 781,308 bytes
- SHA-256：c3adec17771d18deed63e6546384731ecd00668c7affaf58cae56a431c3572e2

本包合併後 worker.js / worker.txt：
- 13,408 行
- 完整既有 2BL Worker + 最新團GO closed-loop 模組
- 不需要 worker-groupbuy.js
- 非團購 action 仍走原正式 Worker
- 原正式 Worker 主體在合併點之前保持原內容不變
- wrangler.jsonc 使用正式入口 main = worker.js

【手動更新順序】
1. Supabase SQL Editor：執行 groupbuy-migration.sql
2. GitHub main 根目錄更新：
   - admin.html
   - groupbuy.html
   - groupbuy-admin.html
   - groupbuy-payment.html
3. GitHub main 根目錄 worker.js：用本包 worker.js 完整覆蓋。
   若裝置無法下載 .js，可下載 worker.txt，內容完全相同，再貼進 GitHub 的 worker.js。
4. wrangler.jsonc：確認 main 為 worker.js。
   不要再建立或使用 worker-groupbuy.js。
5. 部署 Cloudflare Worker：2bl-v7

【不要做】
- 不要用上一包 174 行的 wrapper 覆蓋正式 Worker。
- 不要把 wrangler main 改成 worker-groupbuy.js。
- 不要操作 DOING / tobeloved-api / 2BL-SaaS。

【本包包含的團GO更新】
- 每個單一團購頁可直接申請成為團購主
- 手機拍照 / 相簿新增商品
- 圖片本機先處理 1:1、最大 1200x1200、WebP 優先、單張 <=500KB，再上傳 Supabase Storage
- 圖片 URL / 尺寸 / 容量 / SHA-256 / Storage path / 商品關聯進正式資料庫
- 團購價 / 團購主採購價單筆級距，不跨訂單累積
- 團購主專屬價格不公開
- 訂單建立、付款頁、付款回報、退回回報、確認付款、取消、退款、出貨閉環
- 已付款才可出貨
- 正式 payment profile / 收款快照
- 團GO LINE 與市集 LINE 分離

【正式驗收仍需部署後執行】
團購頁 → 團購主申請 → 後台審核/指派 → 專屬連結 → 商品下單 → 付款頁 → 付款回報 → 後台確認 → 已付款 → 出貨 → 取消/退款 → 重整/重新登入資料仍存在；並回歸驗證既有市集入口。

尚未完成正式部署驗證：本包已完成檔案與語法驗證，但尚未上線。

【商品管理一頁整合修正】
1. 團購管理維持「每場一張大卡片」。
2. 已移除場次卡片上的獨立「批次價格」入口；團購主頁改名「團購主管理」，不再重複編輯商品採購價。
3. 點「商品管理」後，同一頁以四個小卡切換：商品總覽／新增商品／批次建立／批次設定。
4. 批次設定同頁一次管理：原價、團購價、供應成本、團購主 1 件採購價、買家單筆級距、團購主單筆級距。
5. 批次建立也在商品管理同頁，可先套用上述完整價格方案，再逐張商品小卡微調後一次建立。
6. 商品價格批次儲存仍透過 Worker action bulkUpdateGroupBuyPrices → RPC bulk_update_groupbuy_product_prices；最新版 migration 已擴充為同一 transaction 更新 original_price、price、supply_cost、quantity_tiers_json、default_promoter_tiers_json。
7. 歷史訂單價格快照不改；新價格只影響後續新訂單。
8. 團購主指派／專屬連結仍保留在「團購主管理」，價格維護只有商品管理一個正式入口。
