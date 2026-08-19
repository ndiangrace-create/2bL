# 2BL 正式資料契約與唯讀盤點

盤點日期：2026-08-15（Asia/Taipei）  
正式 Supabase：`2bl`／`douhmxipedgpfbvfynbq`  
正式 Tenant：`tuibile`

本文件記錄唯讀盤點與已授權的 RPC 權限修正。工作分支另有尚未套用正式資料庫的 migration；正式資料目前未改動。

## 唯一資料流

正式資料只能走：瀏覽器 → `2bl-v7` Worker API → Supabase `douhmxipedgpfbvfynbq`。

- 前端不得直接呼叫 Supabase URL、REST、RPC 或攜帶 Supabase key。
- Worker 的資料表與 RPC 名稱必須存在於 `.automation/supabase-schema-audit.json`。
- 不得以 localStorage 保存會員電話、收藏、名單、付款、退款、報名或任何正式業務資料。
- localStorage 只允許登入 token、email、tenant/session 範圍與頁籤／導覽暫存狀態。
- 新名稱不得由程式自行發明；正式名稱只能從現有 schema 選定，任何 schema 更動另提 migration 並等待核准。
- 新功能一律採獨立追加：不得刪除、取代或重設既有可用功能與設定；需要串接既有付款、報名、通知或權限流程時，必須完整接入並通過原功能回歸測試。

## 欄位名稱統一方向

以下是依現有 schema、實際資料分布與正式 Worker 使用情形整理的目標名稱，**本次未改資料庫**：

| 資料表 | 目標正式欄位 | 相容／舊欄位 | 現況 |
|---|---|---|---|
| events | `title` | `name` | 1 筆只有 title，4 筆相同 |
| members | `brand_name` | `brand` | 82 筆只有 brand_name |
| payments | `registration_id` | `reg_id` | 65 筆只有 registration_id |
| registrations | `payment_status` | `pay_status` | 56 筆衝突，需先定義轉換規則 |
| registrations | `payment_method` | `pay_method` | 65 筆只有 payment_method |
| registrations | `total_amount` | `amount` | 113 筆相同 |
| registrations | `stall_number` | `stall_no` | 14 筆只有 stall_number |
| stalls | `reg_id` | `registration_id` | 14 筆只有 reg_id；沿用現行 schema 實際來源 |
| stalls | `seat_code` | `stall_no` | 158 筆相同 |
| stalls | `price_delta` | `price_adjustment` | 9 筆衝突，需先定義轉換規則 |
| stalls | `map_order` | `sort_order` | 158 筆衝突，需確認兩欄語意是否真的相同 |
| sessions | `seat_assign_days_before` | `seat_auto_layout_days_before` | 25 筆相同 |
| sessions | `registration_schedule_json` | 無 | 報名自訂分階段排程唯一來源；每段開始／截止由後台設定，未填或未啟用時沿用手動狀態 |
| tenants | `config_json.officialGroup` | 前台硬編碼邀請網址 | 已繳費大群組唯一設定來源；包含啟用、名稱、邀請文字、HTTPS 加入網址與密碼，不新增資料表或欄位 |
| tenants | `plan_type` | `plan` | 1 筆衝突，需先定義方案值對照 |
| sessions / stalls | `stalls` 關聯表 | `sessions.stall_list_json` | 舊 JSON 仍有 1 筆，禁止直接刪除 |

有衝突的欄位不得自動覆蓋、刪除或改名。下一次資料庫變更必須先提供值域對照、回填 SQL、驗證 SQL、索引／FK／RLS 影響與回復方案。

## 已完成的阻擋修正

1. Worker 已停止引用不存在的三張資料表與一個 RPC，並改接既有正式資料來源或安全關閉未開放功能。
2. 瀏覽器已停止保存收藏、電話、拍照完成旗標與現場操作人長期資料。
3. 五個 SECURITY DEFINER RPC 已撤銷 public、anon、authenticated 的執行權，只保留 Worker 使用的 service_role。
4. 五個 RPC 的 search_path 均已固定為 public。
5. 57 個 public table 維持 RLS 開啟且沒有一般使用者 policy；前端不直連 Supabase，資料僅由 Worker 進出。

資料契約阻擋已清除。工作分支新增 `member_notifications` 與押金防呆 trigger，並準備安全回填既有每日報到；都必須先完成差異確認，才能套用正式資料庫、合併與部署。

## 工作分支待套用項目

- `supabase/onsite_daily_finance_integrity.sql`：通知資料表與押金最後一天／撤場完成／不可重複退款的資料庫防呆。
- `supabase/backfill_daily_checkins_safe.sql`：只把既有「已報到」且日期確實屬於該報名的資料補進每日紀錄；不刪除、不取消、不改金額。
- `supabase/normalize_daily_deposit_status_safe.sql`：把舊資料中誤標在「非最後參加日」的每日押金狀態改為「不適用」；正式退款交易、全域押金結果與金額都不變。
- 正式套用前必須先看預覽數量，套用後再核對每日總數與原本總數。

## 目前允許的 localStorage 類型

- 登入：token、email、登入 session 容器。
- 導覽：目前頁籤、返回頁面、篩選條件、tenant/session 範圍。
- 不允許：電話、收藏、操作人姓名、表單內容、付款／退款／報名資料與「已完成」業務旗標。

## 尚未執行的資料整理

- 不會清除或合併重複欄位，因為現有資料有衝突。
- 不會刪除重複索引，需先確認實際 constraint 依賴。
- 不會新增一般使用者 RLS policy；目前正式架構只允許 Worker 存取 Supabase。

## 2026-08-19｜已繳費大群組邀請（Pending）

- 目標：保留「已確認繳費 → 查看行前通知」入口，並在本人「我的紀錄」付款區塊直接顯示邀請文字、加入按鈕與密碼；繳費確認信同步提供相同資訊。
- 資料：沿用 `tenants.config_json` 的獨立 `officialGroup` 區塊，不新增資料庫結構，不覆蓋其他租戶設定。
- 權限：只有平台總管與租戶總管理者可讀寫完整設定；系列管理者、現場人員與未登入者不能取得管理設定。
- 狀態：只有有效的已繳費或免費報名可取得邀請；未繳費、付款待確認、已取消、未錄取及退費流程一律不回傳。
- 公開面：新增的「我的紀錄」卡片與信件不直接顯示網址，只藏在加入按鈕中；既有 FAQ 與既有大群組入口原樣保留，不因新增功能被刪除或取代。
- 驗證：Worker 語法、前後台內嵌腳本、完整自動測試、角色操作者模擬與資料契約嚴格檢查均通過。
- 狀態：`Pending`；尚未合併、尚未部署、尚未改動正式 Supabase 資料。收到「確認部署」並完成正式驗證後，才能追加 `Verified` 紀錄。

## 2026-08-19｜已繳費大群組邀請（Verified）

- 正式來源：PR #55；功能合併 commit `5be1c9118a34e8e71ae268adc1ae58baacfdf6fc`；一次性部署 commit `a798f80d1899149e4fe26057864f62e77736e264`。
- 正式部署：僅更新既有 Cloudflare Worker `2bl-v7`；部署流程 #34 成功；正式 version ID `699037af-367b-4089-be13-67946a6ca283`；部署後來源 SHA-256 與核准封裝完全一致。
- 正式資料：未新增 schema、未搬移或覆寫 Supabase 資料；沿用 `tenants.config_json.officialGroup`，其他 tenant config 原值保留。
- 正式驗證：2b-love.com 前台與 admin.html 均回傳 200；我的紀錄卡片、已繳費狀態接線、既有行前通知入口、後台密碼欄位與儲存動作均存在。
- 權限驗證：未登入者無法讀取大群組管理設定，回應不含密碼或邀請網址；公開 frontBootstrap 不含大群組受保護設定。
- 連線驗證：2bl-v7 ping 正常，tuibile Supabase 連線正常；安全稽核、資料契約、角色操作者模擬與完整自動測試通過。
- 邊界：`tobeloved-api` 未修改、未部署；既有 Routes、Bindings 與 Secrets 名稱均保留。

## 2026-08-20｜AI 貼文排程小幫手（Pending）

- 新增資料：`social_campaigns`（宣傳批次）、`social_posts`（正式貼文與排程）、`social_meta_connections`（加密 Meta 授權狀態與選定帳號）、`social_publish_attempts`（逐平台發布與防重複紀錄）。
- 租戶：四張表與所有 Worker 查詢皆固定包含 `tenant_id = tuibile`；沒有跨租戶讀寫。
- 活動來源：只從 `sessions` 讀取名稱、日期、時間、地點、公開介紹、公開圖片、主辦與合作單位；不讀會員、攤商私人資料、付款、財務或後台備註。
- 圖片：沿用正式 `covers` Storage bucket，路徑固定在 `tuibile/social-posts/...`；資料庫保存圖片 URL 與 Storage path。
- 文字 AI：整批第一次主動產生時只呼叫一次 OpenAI Responses API；成功後立即保存。重新整理、查看、儲存、切頁或上傳圖片不會再次生成。
- 圖片 AI：本功能第一版不呼叫 OpenAI Image API，只保存每篇不同的完整圖片 Prompt；既有 AI 主視覺功能維持原狀。
- 整批排程：`schedule_social_campaign` 在單一資料庫交易內驗證並寫入全部貼文；缺漏時回傳對應篇次與欄位，整批不清空。
- 自動發布：`claim_due_social_posts` 使用鎖定與跳過已鎖資料的方式原子認領；`social_publish_attempts` 以貼文＋平台唯一約束防止同一平台重複發布。
- 權限：四張表 RLS 開啟，撤銷 anon/authenticated，僅 Worker service role 可存取。Meta Token 由 Worker 以獨立金鑰加密後保存；App Secret 與加密金鑰不進資料庫。
- 狀態：`Deploying`；正式 Supabase migration `20260819174430_ai_social_scheduler_partner_mentions` 已套用並驗證，分支尚未合併，`2bl-v7` 與正式網站尚待部署。

## 2026-08-20｜合作帳號標註／Hashtag 擴充（Pending）

- 新增 `social_partners` 作為已確認合作單位帳號的唯一正式來源；保存名稱、Facebook 粉專網址／ID、Instagram username／ID 與驗證狀態。
- `social_campaigns.partner_ids` 保存該批可使用的合作單位；`social_posts` 分開保存 Facebook／Instagram 選擇、活動固定 Hashtag、該篇專屬 Hashtag 與 Meta 標註結果。
- AI 只取得合作單位 id 與名稱並建議該篇適合標註誰；正式帳號只能來自平台總管理員輸入或已保存資料，任何 AI 回傳的不明 id 都會被丟棄。
- Facebook Page Mentioning 與 Instagram `user_tags` 分開處理；標註遭 Meta 拒絕時改為不標註並正常發布，錯誤只記在該篇該帳號，不清除貼文或整批排程。
- 權限由「租戶主要管理者」收緊為「平台最高總管理員」；入口與 Worker 操作都受限制，其他角色無法以直接網址繞過。
- 狀態：`Deploying`；正式資料庫已套用並驗證，尚未完成真實 Meta 標註驗收，程式尚待合併與部署。

## 2026-08-20｜AI 貼文排程與合作標註（Partially Verified）

- 正式資料庫：migration `20260819174430_ai_social_scheduler_partner_mentions` 已套用；五張表 RLS 開啟，anon／authenticated 無讀寫權，兩個排程 RPC 只有 service role 可執行。
- 正式來源：功能修正 commit `64306cbca616db5e181ddb3788a25fb5ecfdd5ea`；一次性部署 commit `91b5192f701ceff852f16652a595a6c3cdaffb27`。
- 正式部署：GitHub Actions run `32284430799` 成功；僅更新 `2bl-v7`，Cloudflare version ID `65b047bd-9c1c-42f9-853d-daf407c3d255`，部署後來源與核准封裝一致。
- 正式頁面：`social.html` 與 `admin.html` 均回傳 200；正式頁面包含平台總管理員入口、已保存合作單位、活動固定 Hashtag 與分篇編輯功能。
- 正式連線：workers.dev 與 `2b-love.com/s/` ping 正常，tenant 為 `tuibile`，Supabase 連線正常；未登入呼叫宣傳功能會回傳登入失效。
- 資料驗證：以 service role 在交易內完成合作單位寫入與讀回後回滾；驗證資料未留下。既有 129 筆報名、119 位會員、76 筆付款資料保持不變。
- 邊界：`tobeloved-api` 未修改；既有 Route、Bindings 與九個 Secret 名稱均保持不變。
- 未完成：Meta App ID、App Secret、Graph API 版本與 Token 加密金鑰尚未設定；尚未完成真實 OAuth、FB／IG 發布、支援標註與不支援標註降級驗收，因此 Meta 部分維持 `Pending`。

## 2026-08-20｜Threads（脆）排程擴充（Pending）

- 新增平台：同一篇貼文可個別勾選 Facebook、Instagram、Threads，三平台各自保存發布結果；某一平台失敗不阻止其他平台。
- 正式文章：`social_posts.threads_text` 保存人工可直接修改的 Threads 完整文章；AI 會產生較精簡版本，但不得猜測或產生合作帳號。
- 授權：`social_meta_connections` 新增獨立 Threads 狀態、加密 Token、到期時間及已授權帳號 id／username；不共用 Facebook Page Token。
- 發布：`social_publish_attempts.platform` 增加 `threads`，仍維持貼文＋平台唯一防重複；Threads 只使用官方 `graph.threads.net` 建立圖片容器及 `threads_publish`。
- 標註：Threads 第一版不宣稱支援合作帳號自動標註，不送猜測的 `@名稱`；Facebook Page Mentioning 與 Instagram `user_tags` 規則不變。
- 資料遷移：新增 `supabase/20260819210736_add_threads_social_scheduler.sql`，只追加欄位、constraint 與新版整批排程函式，不刪除或搬移既有 FB／IG 資料。
- 狀態：`Pending`；已獲「確認執行」進行本機施工，尚未套用正式 Supabase、尚未設定正式 Secrets、尚未合併、尚未部署、尚未完成三平台真實發文驗收。
