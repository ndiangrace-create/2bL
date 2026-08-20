# AI 貼文排程小幫手｜功能契約與進度

狀態：Partially Verified（管理、保存、AI 產文與排程基礎已正式部署；Meta 真實發布待設定與驗收）

## 第一版結果

平台總管理員選擇 2BL 活動或自行輸入宣傳資料，系統使用 Cloudflare Workers AI 一次產生不同角度的完整 Facebook／Instagram／Threads 文章、Hashtag、建議日期時間與每篇不同視覺方向的完整圖片 Prompt。平台總管理員在同一頁整批審核，直接修改文章、圖片、日期、時間、平台、合作帳號標註與 Hashtag；圖片只有在管理員按下單篇「免費 AI 產圖」時才會生成，也可自行上傳。完成後只按一次「確認全部並發布排程」，Worker 到時間依每篇勾選的平台分別發布。

系統沒有付費 AI 備援；免費服務額度不足或暫時失敗時直接顯示錯誤，不會自動改走付費服務。既有活動主視覺也已改用相同免費產圖模型。

## 正式資料與依賴

- 後台入口：`admin.html`。
- 獨立工具頁：`social.html`。
- Worker：`worker.js`。
- 權限：只允許正式 `platform_super_admin`；租戶主要管理者、系列管理者與其他角色都不能操作，後端每次重新核對正式權限。
- 活動來源：只讀取 `sessions` 的公開宣傳欄位。
- 正式資料：`social_partners`、`social_campaigns`、`social_posts`、`social_meta_connections`、`social_publish_attempts`。
- 圖片：沿用 Supabase Storage `covers`，以 `tuibile/social-posts/...` 分層保存。
- 文字 AI：Cloudflare Workers AI JSON Schema；已生成內容先保存，再讀取時不重新生成。
- 圖片 AI：Cloudflare Workers AI SDXL Lightning；只有明確按下產圖按鈕時執行。
- Meta：使用「兔彼樂社群自動發文」App；Facebook／Instagram 與 Threads 各走官方 OAuth，不保存任何社群密碼；Token 分開加密保存。
- 排程：Cloudflare Cron 每分鐘只認領到期貼文；原有每日工作保留原時間。

## 狀態與防重複

- 貼文：待審核、已排程、發布中、已發布、發布失敗、已取消。
- 每篇每平台只有一筆正式發布嘗試；成功平台不會因另一平台重試而再次發布。
- 同一篇可選 Facebook、Instagram、Threads 任意組合；某平台失敗只記錄該平台，其他平台照常發布。
- 外部平台已成功但本地回寫不確定時，不自動重試，避免重複貼文；需人工確認後再操作。
- 整批排程由單一資料庫交易驗證並寫入；缺漏只回報對應貼文與欄位，不清空資料。

## 合作帳號標註與 Hashtag

- 合作單位帳號由平台總管理員輸入並保存；AI 只收到合作單位 id 與名稱，只能建議該篇適合標註誰，不能產生或猜測網址、username 或帳號 ID。
- Facebook 與 Instagram 分開選擇。每篇都能新增、移除及修改合作帳號，不必重新產生文章。
- Hashtag 分為活動固定 Hashtag 與該篇專屬 Hashtag；單篇重新產生只改專屬 Hashtag。
- Facebook Page Mentioning 預設關閉；只有 Meta App 確認具備能力並設定 `META_FACEBOOK_PAGE_MENTIONING_ENABLED=true` 才會送出粉專標註。
- Instagram 圖片標註使用官方 `user_tags`。若 Meta 拒絕任一平台標註，系統會改為不標註並正常發布文章，保存該帳號無法自動標註的結果。
- Threads 第一版只做官方發文，不自動標註合作帳號，也不把猜測的 `@名稱` 當成官方標註。
- Facebook 發布後會讀取 Meta 回傳的 `message_tags` 驗證；Instagram API 接受 `user_tags` 後仍標示「待實際貼文確認」，不得直接宣稱驗收成功。

## 安全界線

- tenant 固定為 `tuibile`。
- 只有平台最高總管理員可操作 Meta 授權與宣傳工具。
- AI 只收到活動公開宣傳欄位，不含會員、攤商私人資料、付款、財務與後台備註。
- 正式貼文、圖片、排程、授權狀態與發布結果不使用 localStorage。
- `META_APP_SECRET`、`THREADS_APP_SECRET` 與 Token 加密金鑰只放 Cloudflare Secrets。若 Threads 與 Meta 使用同一組 App 憑證，可省略 Threads 專用 secret，Worker 會回退使用 Meta App secret。

## 上線與驗收項目

- `supabase/ai_social_scheduler.sql` 已套用；五張新表均開啟 RLS，一般使用者無權讀寫，既有會員、報名與付款筆數保持不變。
- 先套用 `supabase/20260819210736_add_threads_social_scheduler.sql`，再設定 Meta App ID、App Secret、Graph API 版本、Redirect URI 與 Token 加密金鑰。
- Threads 回呼網址固定為 `https://2bl-v7.ndiangrace.workers.dev/auth/threads/callback`；如 Meta 控制台提供獨立 Threads App ID／Secret，設定 `THREADS_APP_ID`、`THREADS_APP_SECRET`，否則沿用 `META_APP_ID`、`META_APP_SECRET`。
- Threads 解除授權回呼為 `https://2bl-v7.ndiangrace.workers.dev/auth/threads/deauthorize`，資料刪除要求網址為 `https://2bl-v7.ndiangrace.workers.dev/auth/threads/delete`；兩者會驗證 Meta `signed_request`，並清除已保存的 Threads Token。
- Facebook／Instagram 回呼網址為 `https://2bl-v7.ndiangrace.workers.dev/auth/meta/callback`；若新版商家專用 Facebook 登入要求 configuration ID，設定 `META_BUSINESS_LOGIN_CONFIG_ID`。
- Meta「基本資料」的應用程式網域必須加入 `2bl-v7.ndiangrace.workers.dev`；Facebook 登入與 Threads 各自的 OAuth 允許清單必須逐字加入上面對應 URI，不能只填在測試欄位。
- Meta App 權限、測試帳號及 App Review 完成。
- 以真實 Facebook 粉專、Instagram Professional Account 及 Threads 帳號完成 OAuth、選帳號、三平台發布、FB／IG 標註、標註失敗降級與逐平台失敗重試測試。
- 確認 Facebook Page Mentioning 是否已獲 App 使用權；未確認前保持關閉。
- 手機與桌面完成整批審核、上傳圖片、重新整理、排程與取消的實際操作。
- 全套既有 2BL regression 通過。

## 回復方式

未部署前直接放棄此工作分支。部署後回復時先停止新增 Cron，再回復 Worker 與 `admin.html`；保留五張新增資料表供稽核，不直接刪除正式貼文、合作帳號及發布紀錄。

## 2026-08-20 正式部署驗證

- 正式資料結構與權限已套用，新增表只允許 Worker 存取；既有會員、報名與付款資料保持不變。
- `social.html` 與 `admin.html` 正式網址均回傳 200，新入口、保存合作單位與 Hashtag 編輯畫面已上線。
- `2bl-v7` ping、`tuibile` Supabase 連線及自訂網域 route 均正常；未登入直接呼叫宣傳工具會被阻擋。
- 正式資料庫已用交易完成合作帳號寫入／讀回測試並回滾，沒有留下驗證資料。
- Meta 專用設定尚未建立，因此 OAuth、真實 FB／IG 發布及實際標註仍為 Pending；系統不得宣稱 Meta 標註成功。
