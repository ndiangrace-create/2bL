# AI 貼文排程小幫手｜功能契約與進度

狀態：Deploying（正式資料結構已安全套用，程式尚待正式部署與驗證）

## 第一版結果

平台總管理員選擇 2BL 活動或自行輸入宣傳資料，系統一次產生不同角度的完整 FB／IG 文章、Hashtag、建議日期時間與每篇不同視覺方向的完整圖片 Prompt。平台總管理員在同一頁整批審核，直接修改文章、圖片、日期、時間、平台、合作帳號標註與 Hashtag；圖片由管理員把 Prompt 複製到 ChatGPT 等工具產生後上傳。完成後只按一次「確認全部並發布排程」，Worker 到時間自動發布 Facebook 粉專及 Instagram Professional Account。

第一版禁止從此功能自動呼叫付費圖片 API。既有 AI 主視覺功能保留且不受影響。

## 正式資料與依賴

- 後台入口：`admin.html`。
- 獨立工具頁：`social.html`。
- Worker：`worker.js`。
- 權限：只允許正式 `platform_super_admin`；租戶主要管理者、系列管理者與其他角色都不能操作，後端每次重新核對正式權限。
- 活動來源：只讀取 `sessions` 的公開宣傳欄位。
- 正式資料：`social_partners`、`social_campaigns`、`social_posts`、`social_meta_connections`、`social_publish_attempts`。
- 圖片：沿用 Supabase Storage `covers`，以 `tuibile/social-posts/...` 分層保存。
- 文字 AI：OpenAI Responses API Structured Outputs；已生成內容先保存，再讀取時不重新生成。
- Meta：既有「兔彼樂社群排程系統」App；官方 OAuth，不保存 Facebook／Instagram 密碼；Token 加密後保存。
- 排程：Cloudflare Cron 每分鐘只認領到期貼文；原有每日工作保留原時間。

## 狀態與防重複

- 貼文：待審核、已排程、發布中、已發布、發布失敗、已取消。
- 每篇每平台只有一筆正式發布嘗試；成功平台不會因另一平台重試而再次發布。
- 外部平台已成功但本地回寫不確定時，不自動重試，避免重複貼文；需人工確認後再操作。
- 整批排程由單一資料庫交易驗證並寫入；缺漏只回報對應貼文與欄位，不清空資料。

## 合作帳號標註與 Hashtag

- 合作單位帳號由平台總管理員輸入並保存；AI 只收到合作單位 id 與名稱，只能建議該篇適合標註誰，不能產生或猜測網址、username 或帳號 ID。
- Facebook 與 Instagram 分開選擇。每篇都能新增、移除及修改合作帳號，不必重新產生文章。
- Hashtag 分為活動固定 Hashtag 與該篇專屬 Hashtag；單篇重新產生只改專屬 Hashtag。
- Facebook Page Mentioning 預設關閉；只有 Meta App 確認具備能力並設定 `META_FACEBOOK_PAGE_MENTIONING_ENABLED=true` 才會送出粉專標註。
- Instagram 圖片標註使用官方 `user_tags`。若 Meta 拒絕任一平台標註，系統會改為不標註並正常發布文章，保存該帳號無法自動標註的結果。
- Facebook 發布後會讀取 Meta 回傳的 `message_tags` 驗證；Instagram API 接受 `user_tags` 後仍標示「待實際貼文確認」，不得直接宣稱驗收成功。

## 安全界線

- tenant 固定為 `tuibile`。
- 只有平台最高總管理員可操作 Meta 授權與宣傳工具。
- AI 只收到活動公開宣傳欄位，不含會員、攤商私人資料、付款、財務與後台備註。
- 正式貼文、圖片、排程、授權狀態與發布結果不使用 localStorage。
- `META_APP_SECRET`、OpenAI Key、Token 加密金鑰只放 Cloudflare Secrets。

## 上線與驗收項目

- `supabase/ai_social_scheduler.sql` 已套用；五張新表均開啟 RLS，一般使用者無權讀寫，既有會員、報名與付款筆數保持不變。
- 設定 Meta App ID、App Secret、Graph API 版本、Redirect URI 與 Token 加密金鑰。
- Meta App 權限、測試帳號及 App Review 完成。
- 以真實 Facebook 粉專及 Instagram Professional Account 完成 OAuth、選帳號、發布、標註、標註失敗降級與失敗重試測試。
- 確認 Facebook Page Mentioning 是否已獲 App 使用權；未確認前保持關閉。
- 手機與桌面完成整批審核、上傳圖片、重新整理、排程與取消的實際操作。
- 全套既有 2BL regression 通過。

## 回復方式

未部署前直接放棄此工作分支。部署後回復時先停止新增 Cron，再回復 Worker 與 `admin.html`；保留五張新增資料表供稽核，不直接刪除正式貼文、合作帳號及發布紀錄。
