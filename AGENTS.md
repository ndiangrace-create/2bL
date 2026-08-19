# 2BL 持續溝通決策與閉環開發指令

本檔是 2BL 專案唯一正式持續指令。若較短、重複或互相矛盾的舊流程與本檔衝突，以本檔為準。

## 1. 固定合作方式

- 使用者提出想法、問題、疑問、抱怨、截圖或「這裡怪怪的」時，預設是討論，不是修改授權。
- 討論階段只可做必要的唯讀檢查，不得修改程式、資料庫、正式資料或正式環境。
- 動工前先用白話說明：真正目標、可能原因、建議做法、使用差異、影響範圍、方案差別、推薦方案及風險。
- 只有使用者明確說「確認執行」、「開始執行」或「依這個方案執行」才可修改。
- 「繼續」、「可以嗎」、「這樣好嗎」、「我覺得」及單純描述問題都不是執行授權。
- 取得執行授權後，可依已確認方案持續完成實作、測試與安全修正；若方向、金額、角色權限、正式資料或使用方式改變，必須暫停並重新確認。
- 執行授權不等於部署授權。只有收到「確認部署」才可合併 main 或部署正式環境。

## 2. 固定正式邊界

- 正式系統：2BL。
- GitHub：`ndiangrace-create/2bL`；`main` 是正式程式基準。
- 正式網站：`https://2b-love.com/`。
- 正式 Worker：`2bl-v7`。
- 正式 Supabase Project Ref：`douhmxipedgpfbvfynbq`。
- 正式租戶：`tuibile`；所有資料查詢與寫入必須包含此 tenant 範圍。
- Supabase 是營運資料唯一正式來源。
- 永久禁止修改或混用 DOING、`ndiangrace-create/2bl-saas`、`tobeloved-api`、thecorner、gracegift、playevent。
- 密鑰、Token、憑證只能放正式 Secrets 或環境變數，不得寫入程式、資料庫、文件或對話。

## 3. 固定流程

依序執行：

`Read-only Baseline Sync → Goal/Gap Clarification → Root Cause Analysis → Solution Design/Option Evaluation → User Decision Gate → Source-of-Truth/Safety Lock → World Tree/Data Dictionary Sync → Identity/Access Preservation Gate → Role/Date/State Matrix → Feature Contract → Impact/Dependency Mapping → Multi-perspective/Reverse Brainstorming → Full-stack Implementation → Finance/Seat/Data Integrity → Role/Access/State E2E → Regression Testing → Fix Until Definition of Done → Append-only Change Ledger → Deployment Confirmation Gate → Production Verification → World Tree/Verified Baseline Finalize`

任何階段發現錯誤，不得帶著錯誤往下。可安全修正時回到對應階段修正並重測；需要使用者決策、缺少權限或無法安全排除時才停止。

## 4. 開始前基準同步

每次先唯讀核對：

- GitHub main、正式網站、2bl-v7、2BL Supabase。
- 最近一次 Verified Baseline、世界樹、資料字典、決策、修正與部署紀錄。
- 未完成事項及上次驗收後的變動。

已有可信基準時，只檢查後續變動與本次影響範圍，不得無理由重跑整套系統。登入、角色、RLS、共用 API、資料結構或金流若改變，必須重新測相關舊驗收。

## 5. 正確設計與依賴盤點

- 先確認真正的使用者結果，不可只重述按鈕或畫面。
- 至少從首次使用者、已登入使用者、攤商／品牌、主辦、平台管理員、財務退款、手機／LINE／PWA、資料庫／API／權限資安等角度檢查。
- 盤點前台入口、登入 Session、Worker/API、Supabase 表欄位/RPC/RLS、主辦後台、平台後台、報名付款退款、快取、舊資料與向後相容。
- 先假設功能失敗，列出可能原因，並為每項制定預防措施、程式修正及驗收測試。
- 使用者識別使用正式 ID，不得只靠 Email 或電話。
- 狀態轉換要有正式規則；重試使用 idempotency key；多筆資料操作需同一交易或安全補償。
- 金額異動使用不可變帳本；前台、主辦後台與平台後台共用相同正式資料來源。

## 6. 世界樹、資料字典與檔名

- 新增結構前先查既有世界樹與資料字典；已存在就沿用，用途相近優先整合，確定不存在才提出最小可回復新增方案。
- 世界樹要記錄功能父子關係、頁面、按鈕、API、資料表、欄位、檔案、角色、狀態、依賴、新舊決策、差異、commit、PR、部署、測試、回復點、未完成及風險。
- 歷史只能追加或以新版取代，不得靜默覆蓋或刪除。
- 每個正式資料表、欄位、API、檔案、資料夾與功能只有一個正式名稱。
- 正式檔名不可持續產生 `index(4).html`、`admin-new.html`、`worker-final.js` 等副本。
- 發現重複結構時先確認正式版本與引用，未完成安全遷移與驗證前不得刪除。

## 7. 正式資料流

- 會員、帳號、角色權限、活動日期、報名審核、付款退款押金活動金、支出財務、設備、報到、排位、通知、設定與正式營運紀錄都由 Supabase 讀寫。
- 前端不得自行推算或保存正式金額、狀態、名額、排位與權限。
- 重新整理、重新登入或換裝置後，資料必須可從 Supabase 正確讀回。
- 上傳圖片與檔案使用正式 Storage，資料庫保存歸屬與引用；程式碼留在 GitHub。
- localStorage 只能暫存登入 Token、Email、頁籤或未送出的畫面內容，不得成為正式資料來源。

## 8. 帳號與權限保護

- 修改前鎖定既有使用者、管理者、最高總管的帳號、登入方式、角色、權限與可進入範圍。
- 不得造成合法帳號無法登入、角色遺失／降級、登入循環、返回失效、一般使用者越權、管理者取得總管權限或不同角色看到錯誤資料。
- 不得使用共用帳號、硬編碼權限、後門或關閉安全檢查。
- 涉及登入、身分、權限、RLS、API 或路由時，部署前後都要分角色驗證登入、重登、重新整理、返回、直接網址、正常存取與越權阻擋。
- 合法角色進不去或任何越權都視為驗收失敗。

## 9. 完整實作與阻斷驗收

- 不得只改 UI。功能閉環必須包含：入口 → 身分驗證 → API → 資料保存 → 狀態恢復 → 前台顯示 → 後台管理 → 失敗處理 → 修改與歷史。
- 追查每個按鈕：按鈕 → 前端函式 → API action → Worker handler → Supabase 寫入 → 重新讀取 → 正確顯示。
- 找出所有同名、舊版、重複函式、按鈕、路由、設定與模組。
- 管理端異動後，會員端、統計、名額、排位、財務及歷史紀錄需同步。
- 多表操作使用 transaction；任一步失敗整筆回滾。
- 測試正常、錯誤、邊界、越權、斷網、重複提交、Token 過期、資料缺漏、重新整理、登出重登及不同裝置。
- 2BL 特別驗收報名、審核、付款、取消、退款、活動金、押金、支出收益、設備分日上限、報到、排位、連號、跨日位置、通知、手機平板桌機、返回與快取。
- Worker 必須存在正式 action 與 handler；資料要實際寫入 Supabase；前後台及上下游一致。
- JavaScript、SQL、API、E2E、Regression 全部通過；失敗就修正並重測直到 Definition of Done。
- 沒有完成端對端測試不得宣稱完成。

## 10. 紀錄、部署與回復

- 每次永久追加：目標、修改前後、原因、影響頁面／按鈕／API／資料／RLS／角色／日期／狀態、依賴、commit、PR、部署、測試、正式驗證、回復點及風險。
- 部署前標記 Pending；正式環境驗證成功後才可改 Verified，並更新世界樹、資料字典、決策、依賴及 Verified Baseline。
- 破壞性資料庫變更、RLS/Trigger/Function/Constraint 重大修改、正式搬移／回填／刪除、舊場次金流修正、帳號角色權限變更、合併與部署都要另行明確確認及回復方案。
- 優先使用工作分支與可回復增量修改。
- 未收到「確認部署」不得合併 main、部署 2bl-v7 或修改正式網站。
- 部署後核對正式檔名、大小、SHA-256、線上檔案、正式網址、登入角色、API 與正式資料讀寫。

## 11. 固定啟動句與回報

收到「2BL，讓我們繼續接上」時，只先讀取 Verified Baseline、世界樹與未完成事項，白話說明上次進度、建議接續、做法與影響，等待確認；不得直接長時間修改或部署。

對使用者只用白話簡短回報：

- 已經完成：真的可用的功能、原問題、修正差異、測試及部署狀態。
- 還沒完成：未完成內容、原因、是否影響使用、下一步。
- 還可以完善：實際好處，並標示「上線前必要」或「之後再做也可以」。
- 需要決定時，只說要選什麼及選項的實際差別。

工程證據保存在修正紀錄、資料字典與世界樹；除非使用者要求，不以程式碼、SQL、API 路徑、測試日誌或大量工程術語回報。
