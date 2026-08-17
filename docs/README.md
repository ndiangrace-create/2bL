# 2BL 世界樹與永久紀錄

這個資料夾是 2BL 唯一正式的系統結構與變更索引。正式程式仍以 GitHub `main` 為準，正式營運資料仍以 Supabase `douhmxipedgpfbvfynbq` 的 `tuibile` 為準。

## 固定邊界

- 正式系統：2BL
- 正式網址：`https://2b-love.com/`
- 正式 GitHub：`ndiangrace-create/2bL`
- 正式分支：`main`
- 正式 Worker：`2bl-v7`
- 正式租戶：`tuibile`
- 永久禁止影響：DOING、`tobeloved-api`

## 文件入口

- [世界樹](world-tree.md)：功能、頁面、資料、角色與上下游關係。
- [資料字典](data-dictionary.md)：58 張正式資料表、全部欄位、主鍵、外鍵與 30 個資料處理程序。
- [API 動作目錄](api-action-catalog.md)：Worker 的 GET／POST 動作、模組與中央權限層級。
- [正式檔案目錄](source-file-catalog.md)：頁面、Worker、測試與 SQL 檔案的正式名稱及雜湊。
- [角色／日期／狀態矩陣](role-date-state-matrix.md)：角色邊界與跨日營運規則。
- [永久變更帳本](change-ledger.md)：Pending、Verified、Superseded 與回復點。
- [最近一次正式驗收基準](verified-baseline.md)：正式版本、部署與驗證證據。
- [未完成事項](open-items.md)：阻擋、風險及下一步。

## 更新規則

1. 討論與截圖不等於執行授權。
2. 收到「確認執行」、「開始執行」或「依這個方案執行」後，才可修改工作分支。
3. 執行不等於部署；只有收到獨立的「確認部署」才可合併與部署。
4. 每次修改先更新影響範圍，再更新程式與測試。
5. 變更先記為 Pending；正式環境驗證完成後才可追加 Verified 紀錄。
6. 舊紀錄不可刪除或靜默覆蓋，只能追加新版並標示取代關係。
7. 新增資料表、欄位、API、檔案或資料夾前，必須先查本索引與資料字典。
8. 所有治理文件必須通過 `scripts/build-governance-catalogs.mjs --check` 與 `scripts/verify-project-governance.mjs`。

## 本次第一階段範圍

- 完成正式程式、正式資料庫、Storage、角色、部署與既有紀錄的唯讀盤點。
- 建立可追溯文件與自動一致性檢查。
- 沒有新增或修改 Supabase 結構。
- 沒有修改正式營運資料。
- 沒有合併 `main`，也沒有部署。
