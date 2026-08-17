# 2BL 世界樹

狀態定義：`Verified` 為已有正式部署與驗證證據；`Implemented` 為程式存在且有測試、但本次未重新操作正式帳號；`Partial` 為結構存在但仍有未完成項目；`Dormant` 為正式預留、目前沒有營運資料；`Blocked` 為不得繼續擴充或清理。

## 0. 正式基礎

- 2BL
  - 前台：`index.html`、`about.html`
  - 管理後台：`admin.html`
  - 現場：`onsite.html`
  - 平台管理：`manage.html`、`apply.html`
  - 寄賣／POS：`consignment.html`、`pos.html`
  - 共用後端：`worker.js`
  - 權限唯一規格：`lib/admin-authorization.js`
  - 正式資料：Supabase `douhmxipedgpfbvfynbq`／`tuibile`
  - 正式部署：Cloudflare `2bl-v7`

## 1. 前台、會員與報名（Verified）

- 使用者：一般訪客、會員。
- 頁面：`index.html`、`about.html`。
- 主要流程：查看活動 → 會員資料 → 選擇場次／日期／設備 → 報名 → 查看我的紀錄 → 付款回報／取消。
- 主要資料：`tenants`、`events`、`sessions`、`members`、`registrations`、`registration_items`、`payments`、`member_notifications`。
- 上游：場次狀態、三段式報名排程、報名資格、設備與付款設定。
- 下游：審核、付款、排位、報到、退款、通知、財報。
- 保護：前端不直連 Supabase；正式狀態與金額由 Worker 讀寫。

## 2. 活動、場次與三段式報名排程（Verified）

- 使用者：平台總管、租戶擁有者、被指定系列管理者。
- 頁面：`admin.html`。
- 主要資料：`events`、`sessions`、`session_bundles`、`tenant_agreement_templates`、`announcements`、`email_templates`、`payment_profiles`。
- 規則：每段有完整開始與截止才成立；總開關開啟後才生效；空白不啟動；複製場次時排程重設為關閉。
- 日期：第一段可自訂開始；第二、三段依活動日前 X 天 00:00 重開、23:59 截止；時區固定 Asia/Taipei。
- 下游：前台可否報名、後台人工報名、通知與場次顯示。

## 3. 審核、付款、取消、退款與活動金（Implemented）

- 使用者：會員、平台總管、租戶擁有者、指定系列管理者；部分退款動作由現場人員執行。
- 頁面：`index.html`、`admin.html`、`onsite.html`。
- 主要資料：`registrations`、`payments`、`refund_transactions`、`registration_resolutions`、`member_credit_ledger`、`invoices`。
- 關鍵狀態：待審核／已錄取／不錄取／已取消；未繳費／待確認／已繳費／已退費。
- 保護：退款交易與顯示狀態分離；兩日押金只能依正式退款交易計一次；人工活動金使用不可覆寫帳本。
- 未完成：舊新付款狀態欄位仍有衝突，禁止自動清理。

## 4. 排位、攤位圖與連號（Implemented）

- 使用者：管理者、現場人員、會員。
- 頁面：`admin.html`、`onsite.html`、`index.html`。
- 主要資料：`stalls`、`seat_maps`、`seat_assignments`、`registration_day_seats`、`seat_operation_logs`、`venue_map_templates`。
- 流程：付款名單同步 → 編號 → 自動／手動排位 → 逐日位置 → 發布 → 會員查看。
- 日期：跨日活動以逐日位置為準；場次可設定活動前幾天自動排位。
- 保護：系列管理者只能操作被指定系列；每次移動與重排保留操作紀錄。

## 5. 現場報到、撤場與押金（Implemented）

- 使用者：平台總管、管理者、工讀生通行碼。
- 頁面：`onsite.html`、`admin.html`。
- 主要資料：`registration_day_ops`、`onsite_passcodes`、`refund_transactions`、`member_notifications`。
- 日期：每一天的報到與撤場分開；押金只在最後參加日適用；非最後參加日不得顯示成已退押金。
- 下游：押金統計、退款交易、現場清單、會員通知與財報。
- 保護：通行碼只限指定場次；重複操作必須回讀目前狀態。

## 6. 財務、支出、分潤、發票與分享（Implemented）

- 使用者：平台總管、租戶擁有者、指定系列管理者；分享頁為持有短網址的唯讀訪客。
- 頁面：`admin.html`。
- 主要資料：`payments`、`refund_transactions`、`finance_items`、`finance_item_audit`、`finance_audit_logs`、`operation_share_settings`、`operation_settlements`、`finance_share_links`、`short_links`、`invoices`。
- 正式口徑：總收款、營業收入、押金、退款與支出分開；分潤只使用退款後可分配盈餘。
- 保護：正式金額從 Supabase 讀取；分享頁不得顯示管理路徑、帳號或內部來源名稱。
- 未完成：部分舊場次欄位仍需依帳本逐場核對，禁止大量回填。

## 7. 管理帳號、角色與資料隔離（Implemented）

- 角色：`platform_super_admin`、`organizer_owner`、`organizer_admin`、`session_admin`、`finance_admin`、`onsite_staff`。
- 主要資料：`staff`、`platform_staff`、`staff_session_permissions`、`staff_action_logs`、`audit_logs`。
- 正式現況：2 個啟用的最高總管、3 個啟用的指定系列管理者；本階段只做統計，不讀取或保存帳號內容。
- 持續指令：`system_settings.system_operating_instructions` 已有舊短版紀錄，但與 2026-08-17 確認的完整新版不一致；第一階段禁止寫入，因此標記為 Pending。
- 保護：總管保留全平台能力；指定系列管理者不能跨系列、不能刪除、不能管理租戶或取得平台總管權限。
- 驗證：登入、重新登入、直接網址、重新整理、返回、功能存取及越權阻擋。

## 8. 視覺、相框、場地圖與檔案（Partial）

- 使用者：平台總管、租戶擁有者、指定系列管理者、前台使用者。
- 主要資料：`photo_frames`、`photo_leads`、`ai_visual_jobs`、`session_visual_assets`、`venue_map_templates`。
- Storage：`covers`、`session-visuals` 為公開素材；`711` 為非公開空間。
- 保護：資料庫保存歸屬與引用，檔案放 Storage；不得把 Token 或密鑰放入資料庫及文件。
- 未完成：Storage 物件的歸屬完整率尚未逐筆驗證。

## 9. 寄賣與 POS（Partial／Dormant）

- 頁面：`consignment.html`、`pos.html`。
- 主要資料：`consignment_settings`、`consignment_slots`、`consignment_registrations`、`consignment_products`、`consignment_product_variants`、`consignment_inventory_movements`、`consignment_sales`、`consignment_sale_items`。
- 現況：正式結構存在，但目前多數沒有營運資料；不得把存在的結構誤判為已完成營運驗收。

## 10. 報表與輸出（Partial／Dormant）

- 主要資料：`report_templates`、`report_exports`、`report_download_logs`、`report_permissions`。
- 現況：模板存在，輸出、下載及權限紀錄目前沒有正式資料；需在真正啟用前做角色與下載 E2E。

## 11. 安全自動流、部署與回復（Verified）

- 唯讀稽核：`.github/workflows/2bl-safe-automation.yml`。
- 正式部署：`.github/workflows/2bl-production-deploy.yml`。
- 證據：`.automation/cloudflare-baseline.json`、`.automation/data-contract-report.json`、`.automation/supabase-schema-audit.json`。
- 新增治理證據：`.automation/world-tree-source-audit.json`、`.automation/operational-source-audit.json`。
- 保護：沒有獨立的「確認部署」不得合併或部署；部署只准 `2bl-v7`；Route、Domain、Bindings 與 Secret 名稱偏移即停止。

## 12. 已淘汰或待確認副本（Blocked）

- `index .html`、`admin .html` 與正式檔名內容不同。
- 正式入口固定為 `index.html`、`admin.html`。
- 在完成引用與歷史來源核對前，不得刪除、改名或重新當成正式來源。
