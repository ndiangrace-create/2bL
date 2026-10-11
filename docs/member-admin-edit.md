# 後台協助修正會員資料

狀態：開發分支完成，尚未合併、尚未部署、尚未修改正式資料。

## 使用路徑
後台 → 會員 → 搜尋 Email／手機／品牌 → 資料／修改 → 修正基本資料 → 確認差異 → Worker 權限與系列範圍驗證 → members 正式資料更新 → audit_logs 留下修改前後 → 後台重新讀取。

## 安全規則
- Email 唯讀。
- 只更新 members，不覆寫歷史 registrations / payments / refunds / activity credit / seating。
- 管理權限沿用 canManageMembers 與系列範圍。
- 會員本人改手機需明確確認；背景自動儲存永遠沿用已驗證舊手機。
- 本人與管理者修改都寫入 audit_logs。
- 舊販售類別入口改寫正式 members.sell_category。


## 2026-10-11｜報名頁會員／發票修改視窗（Pending）

- 授權：使用者明確「執行」，僅開發與測試；尚未收到本輪「確認部署」。
- 正式來源：GitHub main `5d4bc3f2a23cc9d4350032c07321bca79f66052e`；完整 index.html Git blob `0e10369d618a1ee12d0bdbefed7c043f144f4915`，437994 bytes，SHA-256 `a8ef33c68b5df2c0aff8a294f7e27a7f3a83abd25f8361070b41fdfb109770a3`。
- 根因：`memberEditModal` 原放在 `.page#pageMember` 內，開啟報名頁時該祖先 display:none；openMemberEditModal 已加 show 仍無法顯示。正式前台唯讀 DOM 已見此祖先關係，隔離 DOM 已重現。
- 最小修正：原 openMemberEditModal 在開啟前把同一個 modal 節點移到 body；不新建、不複製、不切换頁面、不增加第二個儲存入口。
- 舊框架解除：原 openInvoiceEditModal 尋找不存在的 data-edit-tab 發票頁籤；改等原編輯資料填入後捲至既有 .member-edit-card.invoice，維持同一個 modal/API。
- 正式資料鏈：原 getMember（Email＋已驗證手機／tenant）→原會員視窗→原 saveMember/authPhone→原 hSaveMember/upsertMember→members＋audit_logs→原 getMember 讀回→fillMemberCard／syncMemberIntoCurrentRegForm。
- 未改：saveMemberEdit、登入、Token、電話確認、前台 api/apiPost、submitReg、updateFee；Worker、後台、現場、Schema、RLS、角色權限、財務、通知與所有既有收費／報名規則均無變更。
- 依賴／入口：報名頁會員修改、報名頁發票修改、會員 hero 編輯、會員資料／發票編輯、必填資料提示共用同一節點，保留所有既有 ID/事件。
- 測試：verification/member-edit-dialog/integration.mjs，16項隔離 DOM＋GitHub 基準 Worker＋PGlite/Postgres 契約通過；正式 members/audit_logs 欄位 metadata 唯讀取得。覆蓋原錯誤重現、各頁視窗、重複開啟、背景關閉、發票定位、必填保護、SQL 保存與讀回、穩定會員 ID、正式原稽核、重新建立頁面讀回、跨租戶隔離、錯誤手機、DB 失敗及電話變更取消；AST 比對僅兩個開啟函式不同。
- 既有回歸通過：test-member-record-session、test-member-login-token（7項）、test-member-admin-edit、test-member-profile-system、test-member-social-review-notice、test-finance-share-short-url；語法與 git diff --check 通過。
- 真實瀏覽器：CUA 單次嘗試 http://127.0.0.1:8789，回 ERR_CONNECTION_REFUSED；未改網路路径、未使用替代瀏覽器驅動或公開假測試站。因此本輪不能宣稱真實瀏覽器／正式 UI→API→Supabase E2E 通過。
- 檔案：只交付 index.html；438174 bytes，SHA-256 `4ff12503bcc74830ec6d4bbf7357cb58efaa7c5b8ca339e72ab426fa1646ff12`。交付包內 index.html 需重新核對與通過測試同一份。
- 個別更名：使用者同意準備將這位會員品牌改為 Ej手作；正式資料仍為原值，未異動。精準會員 ID、原值與資料指紋保存於私有交付紀錄，不推至公開 Git；待本輪部署確認後走原管理者會員修正＋稽核流程，變更前重新核對。不得把會員改名寫死到 HTML 或改歷史報名。
- 回復：從上述 main baseline 恢復 index.html，無資料庫 migration／W 回滾需求。正式更名若執行後要回復，仍走原授權管理端修正並保留新稽核紀錄，不刪帳本／历史資料。
- 邊界：10/07 主辦代報原 RPC 資料庫修正不回復、不重作；手機姓名／模糊搜尋、亮相秀角色與設備／費用顯示仍是另輪未完成事項，不包含本輪。
- 狀態：Pending；隔離驗證通過，尚未真實瀏覽器驗證／正式部署／正式更名。沒有建立正式測試會員或報名、沒有改正式資料、沒有寄信。
