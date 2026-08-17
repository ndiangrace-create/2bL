# 2BL 正式資料字典

唯讀來源時間：2026-08-17T11:02:01.931766+00:00

本文件由正式 Supabase 結構快照產生，只記錄結構與用途，不含會員、管理者、金流或密鑰內容。
欄位異動必須先更新世界樹、影響範圍與回復方案，經確認後才可執行。

## ai_visual_jobs

- 模組：視覺、相框與場地圖
- 用途：AI 視覺產生工作
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| session_id | text | 否 | — |
| job_type | text | 否 | 'session_main_visual'::text |
| status | text | 否 | 'pending'::text |
| style_preset | text | 否 | — |
| aspect_ratio | text | 否 | '1:1'::text |
| size | text | 否 | '1024x1024'::text |
| title_snapshot | text | 否 | — |
| date_snapshot | text | 否 | — |
| location_snapshot | text | 否 | — |
| description_snapshot | text | 是 | — |
| prompt_text | text | 否 | — |
| requested_count | integer (int4) | 否 | 2 |
| completed_count | integer (int4) | 否 | 0 |
| model | text | 是 | — |
| quality | text | 是 | — |
| error_message | text | 是 | — |
| created_by | text | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| completed_at | timestamp with time zone (timestamptz) | 是 | — |

## announcements

- 模組：活動、場次與報名
- 用途：公告
- RLS：已開啟
- 主鍵：id
- 關聯：tenant_id → tenants.id
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| title | text | 是 | — |
| content | text | 是 | — |
| link_url | text | 是 | — |
| link_text | text | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 是 | now() |
| url | text | 是 | — |
| url_text | text | 是 | — |

## audit_logs

- 模組：身分、權限與平台設定
- 用途：全系統操作稽核
- RLS：已開啟
- 主鍵：id
- 關聯：tenant_id → tenants.id
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| actor_email | text | 是 | — |
| actor_role | text | 是 | — |
| action | text | 否 | — |
| target_table | text | 是 | — |
| target_id | text | 是 | — |
| before_json | jsonb | 否 | '{}'::jsonb |
| after_json | jsonb | 否 | '{}'::jsonb |
| meta_json | jsonb | 否 | '{}'::jsonb |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |

## consignment_inventory_movements

- 模組：寄賣與 POS
- 用途：寄賣庫存異動
- RLS：已開啟
- 主鍵：id
- 關聯：session_id → sessions.id；tenant_id → tenants.id；variant_id → consignment_product_variants.id
- Worker 使用：目前未直接引用或為資料庫內部／預留用途

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | uuid | 否 | gen_random_uuid() |
| tenant_id | text | 否 | — |
| session_id | text | 否 | — |
| variant_id | uuid | 否 | — |
| movement_type | text | 否 | — |
| quantity | integer (int4) | 否 | — |
| reference_type | text | 是 | — |
| reference_id | text | 是 | — |
| operator_email | text | 是 | — |
| note | text | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |

## consignment_product_variants

- 模組：寄賣與 POS
- 用途：寄賣商品規格與條碼
- RLS：已開啟
- 主鍵：id
- 關聯：product_id → consignment_products.id；session_id → sessions.id；tenant_id → tenants.id
- Worker 使用：目前未直接引用或為資料庫內部／預留用途

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | uuid | 否 | gen_random_uuid() |
| tenant_id | text | 否 | — |
| session_id | text | 否 | — |
| product_id | uuid | 否 | — |
| sku | text | 是 | — |
| barcode | text | 否 | — |
| variant_name | text | 否 | '一般'::text |
| price | numeric | 否 | — |
| declared_qty | integer (int4) | 否 | 0 |
| received_qty | integer (int4) | 否 | 0 |
| available_qty | integer (int4) | 否 | 0 |
| sold_qty | integer (int4) | 否 | 0 |
| returned_qty | integer (int4) | 否 | 0 |
| damaged_qty | integer (int4) | 否 | 0 |
| lost_qty | integer (int4) | 否 | 0 |
| status | text | 否 | 'draft'::text |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| updated_at | timestamp with time zone (timestamptz) | 否 | now() |

## consignment_products

- 模組：寄賣與 POS
- 用途：寄賣商品
- RLS：已開啟
- 主鍵：id
- 關聯：registration_id → registrations.id；session_id → sessions.id；tenant_id → tenants.id
- Worker 使用：目前未直接引用或為資料庫內部／預留用途

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | uuid | 否 | gen_random_uuid() |
| tenant_id | text | 否 | — |
| session_id | text | 否 | — |
| registration_id | text | 否 | — |
| member_email | text | 否 | — |
| brand_name | text | 否 | — |
| product_name | text | 否 | — |
| category | text | 是 | — |
| description | text | 是 | — |
| image_url | text | 是 | — |
| status | text | 否 | 'draft'::text |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| updated_at | timestamp with time zone (timestamptz) | 否 | now() |

## consignment_registrations

- 模組：寄賣與 POS
- 用途：寄賣申請
- RLS：已開啟
- 主鍵：registration_id
- 關聯：entry_slot_id → consignment_slots.id；exit_slot_id → consignment_slots.id；invoice_profile_id → member_invoice_profiles.id；registration_id → registrations.id；session_id → sessions.id；tenant_id → tenants.id
- Worker 使用：目前未直接引用或為資料庫內部／預留用途

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| registration_id | text | 否 | — |
| tenant_id | text | 否 | — |
| session_id | text | 否 | — |
| member_email | text | 否 | — |
| can_issue_invoice | boolean (bool) | 否 | — |
| invoice_profile_id | uuid | 是 | — |
| invoice_snapshot | jsonb | 否 | '{}'::jsonb |
| base_commission_rate | numeric | 否 | — |
| no_invoice_surcharge_rate | numeric | 否 | — |
| final_commission_rate | numeric | 否 | — |
| fixed_fee | numeric | 否 | 0 |
| entry_mode | text | 否 | — |
| entry_slot_id | uuid | 是 | — |
| entry_service_fee | numeric | 否 | 0 |
| exit_mode | text | 否 | — |
| exit_slot_id | uuid | 是 | — |
| exit_service_fee | numeric | 否 | 0 |
| contract_snapshot | jsonb | 否 | '{}'::jsonb |
| product_entry_status | text | 否 | 'locked'::text |
| product_submitted_at | timestamp with time zone (timestamptz) | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| updated_at | timestamp with time zone (timestamptz) | 否 | now() |

## consignment_sale_items

- 模組：寄賣與 POS
- 用途：寄賣銷售明細
- RLS：已開啟
- 主鍵：id
- 關聯：product_id → consignment_products.id；registration_id → registrations.id；sale_id → consignment_sales.id；session_id → sessions.id；tenant_id → tenants.id；variant_id → consignment_product_variants.id
- Worker 使用：目前未直接引用或為資料庫內部／預留用途

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | uuid | 否 | gen_random_uuid() |
| tenant_id | text | 否 | — |
| sale_id | uuid | 否 | — |
| session_id | text | 否 | — |
| variant_id | uuid | 否 | — |
| product_id | uuid | 否 | — |
| registration_id | text | 否 | — |
| brand_name | text | 否 | — |
| product_name | text | 否 | — |
| variant_name | text | 否 | — |
| barcode | text | 否 | — |
| quantity | integer (int4) | 否 | — |
| unit_price | numeric | 否 | — |
| line_total | numeric | 否 | — |
| commission_rate | numeric | 否 | — |
| commission_amount | numeric | 否 | — |
| brand_net_amount | numeric | 否 | — |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |

## consignment_sales

- 模組：寄賣與 POS
- 用途：寄賣銷售
- RLS：已開啟
- 主鍵：id
- 關聯：session_id → sessions.id；tenant_id → tenants.id
- Worker 使用：目前未直接引用或為資料庫內部／預留用途

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | uuid | 否 | gen_random_uuid() |
| tenant_id | text | 否 | — |
| session_id | text | 否 | — |
| sale_no | text | 否 | — |
| payment_method | text | 否 | — |
| subtotal | numeric | 否 | — |
| discount_amount | numeric | 否 | 0 |
| total_amount | numeric | 否 | — |
| status | text | 否 | 'completed'::text |
| cashier_email | text | 是 | — |
| note | text | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| voided_at | timestamp with time zone (timestamptz) | 是 | — |
| voided_by | text | 是 | — |

## consignment_settings

- 模組：寄賣與 POS
- 用途：寄賣場次設定
- RLS：已開啟
- 主鍵：session_id
- 關聯：session_id → sessions.id；tenant_id → tenants.id
- Worker 使用：目前未直接引用或為資料庫內部／預留用途

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| session_id | text | 否 | — |
| tenant_id | text | 否 | — |
| period_start | date | 否 | — |
| period_end | date | 否 | — |
| application_deadline | timestamp with time zone (timestamptz) | 是 | — |
| product_entry_deadline | timestamp with time zone (timestamptz) | 是 | — |
| base_commission_rate | numeric | 否 | 30 |
| no_invoice_surcharge_rate | numeric | 否 | 5 |
| fixed_fee | numeric | 否 | 0 |
| listing_service_fee | numeric | 否 | 0 |
| teardown_service_fee | numeric | 否 | 0 |
| max_brands | integer (int4) | 是 | — |
| contract_title | text | 是 | — |
| contract_content | text | 是 | — |
| status | text | 否 | 'draft'::text |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| updated_at | timestamp with time zone (timestamptz) | 否 | now() |

## consignment_slots

- 模組：寄賣與 POS
- 用途：寄賣檔期
- RLS：已開啟
- 主鍵：id
- 關聯：session_id → sessions.id；tenant_id → tenants.id
- Worker 使用：目前未直接引用或為資料庫內部／預留用途

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | uuid | 否 | gen_random_uuid() |
| tenant_id | text | 否 | — |
| session_id | text | 否 | — |
| slot_type | text | 否 | — |
| service_mode | text | 否 | — |
| label | text | 否 | — |
| start_at | timestamp with time zone (timestamptz) | 否 | — |
| end_at | timestamp with time zone (timestamptz) | 否 | — |
| capacity | integer (int4) | 是 | — |
| is_active | boolean (bool) | 否 | true |
| note | text | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| updated_at | timestamp with time zone (timestamptz) | 否 | now() |

## email_templates

- 模組：活動、場次與報名
- 用途：信件模板
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | uuid | 否 | gen_random_uuid() |
| tenant_id | text | 否 | 'tuibile'::text |
| template_key | text | 否 | — |
| title | text | 是 | — |
| subject | text | 是 | — |
| body | text | 是 | — |
| is_active | boolean (bool) | 否 | true |
| updated_by | text | 是 | — |
| updated_at | timestamp with time zone (timestamptz) | 否 | now() |

## error_logs

- 模組：身分、權限與平台設定
- 用途：系統錯誤紀錄
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | bigint (int8) | 否 | nextval('error_logs_id_seq'::regclass) |
| tenant_id | text | 否 | ''::text |
| level | text | 否 | 'error'::text |
| source | text | 否 | ''::text |
| action | text | 否 | ''::text |
| reg_id | text | 否 | ''::text |
| session_id | text | 否 | ''::text |
| email | text | 否 | ''::text |
| message | text | 否 | ''::text |
| detail | jsonb | 否 | '{}'::jsonb |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |

## events

- 模組：活動、場次與報名
- 用途：活動系列
- RLS：已開啟
- 主鍵：id
- 關聯：tenant_id → tenants.id
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| title | text | 否 | — |
| description | text | 是 | — |
| location | text | 是 | — |
| cover_url | text | 是 | — |
| status | text | 是 | '開放中'::text |
| created_at | timestamp with time zone (timestamptz) | 是 | now() |
| name | text | 是 | — |

## finance_audit_logs

- 模組：金流、退款與財報
- 用途：財務操作紀錄
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：目前未直接引用或為資料庫內部／預留用途

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| session_id | text | 是 | — |
| registration_id | text | 是 | — |
| issue_type | text | 否 | — |
| issue_message | text | 否 | — |
| severity | text | 是 | 'warning'::text |
| status | text | 是 | 'open'::text |
| checked_by | text | 是 | — |
| resolved_by | text | 是 | — |
| resolved_at | timestamp with time zone (timestamptz) | 是 | — |
| meta_json | jsonb | 是 | '{}'::jsonb |
| created_at | timestamp with time zone (timestamptz) | 是 | now() |
| updated_at | timestamp with time zone (timestamptz) | 是 | now() |

## finance_item_audit

- 模組：金流、退款與財報
- 用途：財務項目稽核
- RLS：已開啟
- 主鍵：id
- 關聯：session_id → sessions.id；tenant_id → tenants.id
- Worker 使用：目前未直接引用或為資料庫內部／預留用途

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | uuid | 否 | gen_random_uuid() |
| tenant_id | text | 否 | — |
| finance_item_id | text | 否 | — |
| session_id | text | 是 | — |
| action | text | 否 | — |
| before_json | jsonb | 是 | — |
| after_json | jsonb | 是 | — |
| actor_email | text | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |

## finance_items

- 模組：金流、退款與財報
- 用途：場次支出與調整項目
- RLS：已開啟
- 主鍵：id
- 關聯：session_id → sessions.id；tenant_id → tenants.id
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| session_id | text | 是 | — |
| type | text | 是 | — |
| name | text | 是 | — |
| amount | numeric | 是 | — |
| is_auto | boolean (bool) | 是 | false |
| created_at | timestamp with time zone (timestamptz) | 是 | now() |

## finance_share_links

- 模組：金流、退款與財報
- 用途：財報短網址與唯讀分享
- RLS：已開啟
- 主鍵：code
- 關聯：session_id → sessions.id；tenant_id → tenants.id
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| code | text | 否 | — |
| tenant_id | text | 否 | — |
| session_id | text | 否 | — |
| expires_at | timestamp with time zone (timestamptz) | 否 | — |
| is_active | boolean (bool) | 否 | true |
| access_count | integer (int4) | 否 | 0 |
| last_access_at | timestamp with time zone (timestamptz) | 是 | — |
| created_by | text | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |

## invoices

- 模組：金流、退款與財報
- 用途：發票資料
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | uuid | 否 | gen_random_uuid() |
| registration_id | text | 是 | — |
| invoice_type | text | 是 | — |
| invoice_title | text | 是 | — |
| tax_id | text | 是 | — |
| carrier | text | 是 | — |
| email | text | 是 | — |
| amount | numeric | 是 | 0 |
| status | text | 是 | '未開立'::text |
| created_at | timestamp with time zone (timestamptz) | 是 | now() |
| updated_at | timestamp with time zone (timestamptz) | 是 | now() |
| tenant_id | text | 是 | — |

## member_credit_ledger

- 模組：金流、退款與財報
- 用途：會員活動金帳本
- RLS：已開啟
- 主鍵：id
- 關聯：resolution_id → registration_resolutions.id
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| member_email | text | 否 | — |
| registration_id | text | 是 | — |
| resolution_id | text | 是 | — |
| direction | text | 否 | — |
| amount | numeric | 否 | — |
| status | text | 否 | '有效'::text |
| note | text | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| actor_email | text | 是 | — |

## member_invoice_profiles

- 模組：金流、退款與財報
- 用途：會員發票抬頭資料
- RLS：已開啟
- 主鍵：id
- 關聯：tenant_id → tenants.id
- Worker 使用：目前未直接引用或為資料庫內部／預留用途

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | uuid | 否 | gen_random_uuid() |
| tenant_id | text | 否 | — |
| member_email | text | 否 | — |
| company_name | text | 否 | — |
| tax_id | text | 否 | — |
| invoice_title | text | 否 | — |
| contact_name | text | 是 | — |
| contact_phone | text | 是 | — |
| invoice_email | text | 是 | — |
| invoice_method | text | 是 | — |
| note | text | 是 | — |
| is_default | boolean (bool) | 否 | false |
| is_active | boolean (bool) | 否 | true |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| updated_at | timestamp with time zone (timestamptz) | 否 | now() |

## member_notifications

- 模組：會員
- 用途：會員通知
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| member_email | text | 否 | — |
| registration_id | text | 是 | — |
| title | text | 否 | '系統通知'::text |
| message | text | 否 | ''::text |
| kind | text | 否 | 'system'::text |
| is_read | boolean (bool) | 否 | false |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| read_at | timestamp with time zone (timestamptz) | 是 | — |

## members

- 模組：會員
- 用途：會員與品牌資料
- RLS：已開啟
- 主鍵：email、tenant_id
- 關聯：tenant_id → tenants.id
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| email | text | 否 | — |
| tenant_id | text | 否 | — |
| name | text | 是 | — |
| phone | text | 是 | — |
| brand | text | 是 | — |
| brand_intro | text | 是 | — |
| photo_url | text | 是 | — |
| fb_url | text | 是 | — |
| ig_url | text | 是 | — |
| collab_url | text | 是 | — |
| collab_desc | text | 是 | — |
| collab_items | text | 是 | — |
| company | text | 是 | — |
| tax_id | text | 是 | — |
| invoice_email | text | 是 | — |
| city | text | 是 | — |
| line_id | text | 是 | — |
| joined_at | timestamp with time zone (timestamptz) | 是 | now() |
| updated_at | timestamp with time zone (timestamptz) | 是 | now() |
| fast_pass | boolean (bool) | 是 | false |
| brand_name | text | 是 | — |
| invoice_carrier | text | 是 | — |
| invoice_type | text | 是 | — |
| invoice_title | text | 是 | — |
| sell_category | text | 是 | — |
| google_sub | text | 是 | — |
| display_name | text | 是 | — |
| avatar_url | text | 是 | — |
| login_provider | text | 是 | — |
| last_login_at | timestamp with time zone (timestamptz) | 是 | — |
| admin_note | text | 是 | — |
| admin_note_updated_at | timestamp with time zone (timestamptz) | 是 | — |
| admin_note_updated_by | text | 是 | — |

## onsite_passcodes

- 模組：現場與逐日營運
- 用途：現場工讀通行碼
- RLS：已開啟
- 主鍵：id
- 關聯：session_id → sessions.id；tenant_id → tenants.id
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| session_id | text | 否 | — |
| code | text | 否 | — |
| assignee_note | text | 是 | ''::text |
| open_from | timestamp with time zone (timestamptz) | 是 | — |
| open_until | timestamp with time zone (timestamptz) | 是 | — |
| active | boolean (bool) | 否 | true |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| updated_at | timestamp with time zone (timestamptz) | 否 | now() |

## operation_settlements

- 模組：金流、退款與財報
- 用途：場次結算快照
- RLS：已開啟
- 主鍵：id
- 關聯：event_id → events.id；session_id → sessions.id；tenant_id → tenants.id
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | uuid | 否 | gen_random_uuid() |
| tenant_id | text | 否 | — |
| event_id | text | 是 | — |
| session_id | text | 否 | — |
| snapshot_json | jsonb | 否 | '{}'::jsonb |
| locked_at | timestamp with time zone (timestamptz) | 否 | now() |
| locked_by | text | 是 | — |
| updated_at | timestamp with time zone (timestamptz) | 否 | now() |

## operation_share_settings

- 模組：其他正式資料
- 用途：場次分潤設定
- RLS：已開啟
- 主鍵：id
- 關聯：event_id → events.id；session_id → sessions.id；tenant_id → tenants.id
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | uuid | 否 | gen_random_uuid() |
| tenant_id | text | 否 | — |
| event_id | text | 是 | — |
| session_id | text | 是 | — |
| partner_name | text | 是 | — |
| company_ratio | numeric | 否 | 50 |
| partner_ratio | numeric | 否 | 50 |
| created_by | text | 是 | — |
| updated_by | text | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| updated_at | timestamp with time zone (timestamptz) | 否 | now() |

## payment_profiles

- 模組：金流、退款與財報
- 用途：收款方式設定
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| name | text | 否 | — |
| mode | text | 否 | 'tuibile_self'::text |
| owner_name | text | 是 | ''::text |
| allowed_methods | jsonb | 否 | '{"bank": true, "card": false, "linepay": false}'::jsonb |
| bank_name | text | 是 | ''::text |
| bank_branch | text | 是 | ''::text |
| account_name | text | 是 | ''::text |
| bank_account | text | 是 | ''::text |
| linepay_display_name | text | 是 | ''::text |
| linepay_url | text | 是 | ''::text |
| card_display_name | text | 是 | ''::text |
| card_url | text | 是 | ''::text |
| note | text | 是 | ''::text |
| is_default | boolean (bool) | 否 | false |
| is_enabled | boolean (bool) | 否 | true |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| updated_at | timestamp with time zone (timestamptz) | 否 | now() |

## payment_provider_configs

- 模組：金流、退款與財報
- 用途：第三方金流設定預留
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：目前未直接引用或為資料庫內部／預留用途

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| provider_type | text | 否 | — |
| display_name | text | 否 | — |
| public_config_json | jsonb | 否 | '{}'::jsonb |
| secret_ref | text | 是 | ''::text |
| is_enabled | boolean (bool) | 否 | true |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| updated_at | timestamp with time zone (timestamptz) | 否 | now() |

## payments

- 模組：金流、退款與財報
- 用途：付款紀錄
- RLS：已開啟
- 主鍵：id
- 關聯：reg_id → registrations.id；session_id → sessions.id；tenant_id → tenants.id
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| reg_id | text | 是 | — |
| session_id | text | 是 | — |
| email | text | 是 | — |
| amount | numeric | 是 | — |
| method | text | 是 | — |
| status | text | 是 | '待確認'::text |
| trade_no | text | 是 | — |
| paid_at | timestamp with time zone (timestamptz) | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 是 | now() |
| screenshot_status | text | 是 | ''::text |
| screenshot_received_at | timestamp with time zone (timestamptz) | 是 | — |
| detail_json | jsonb | 是 | '{}'::jsonb |
| line_card_text | text | 是 | — |
| admin_note | text | 是 | — |
| registration_id | text | 是 | — |
| payment_profile_id | text | 是 | — |
| payment_profile_snapshot | jsonb | 是 | — |

## photo_frames

- 模組：視覺、相框與場地圖
- 用途：活動拍照框
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| name | text | 否 | — |
| frame_url | text | 否 | ''::text |
| is_active | boolean (bool) | 否 | true |
| is_unlimited | boolean (bool) | 否 | false |
| start_at | timestamp with time zone (timestamptz) | 是 | — |
| end_at | timestamp with time zone (timestamptz) | 是 | — |
| scope_type | text | 否 | 'all'::text |
| scope_event_id | text | 是 | — |
| scope_session_id | text | 是 | — |
| note | text | 是 | ''::text |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| updated_at | timestamp with time zone (timestamptz) | 否 | now() |

## photo_leads

- 模組：視覺、相框與場地圖
- 用途：拍照活動聯絡資料
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| frame_id | text | 是 | — |
| event_id | text | 是 | — |
| session_id | text | 是 | — |
| name | text | 否 | ''::text |
| email | text | 否 | ''::text |
| phone | text | 是 | ''::text |
| first_time | text | 是 | ''::text |
| source | text | 是 | ''::text |
| marketing_consent | boolean (bool) | 否 | false |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |

## platform_staff

- 模組：身分、權限與平台設定
- 用途：平台總管相容來源
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | (gen_random_uuid())::text |
| email | text | 否 | — |
| name | text | 是 | ''::text |
| is_active | boolean (bool) | 是 | true |
| last_login_at | timestamp with time zone (timestamptz) | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 是 | now() |

## refund_transactions

- 模組：金流、退款與財報
- 用途：退款與押金退款交易
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| registration_id | text | 否 | — |
| session_id | text | 否 | — |
| refund_scope | text | 否 | — |
| activity_dates | jsonb | 否 | '[]'::jsonb |
| paid_amount | numeric | 否 | 0 |
| refund_amount | numeric | 否 | 0 |
| admin_fee | numeric | 否 | 0 |
| transfer_fee | numeric | 否 | 0 |
| deposit_amount | numeric | 否 | 0 |
| deposit_included | boolean (bool) | 否 | false |
| refund_method | text | 否 | ''::text |
| refund_reference | text | 否 | ''::text |
| refund_note | text | 否 | ''::text |
| status | text | 否 | '已退款'::text |
| refunded_at | timestamp with time zone (timestamptz) | 是 | — |
| actor_email | text | 否 | ''::text |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| updated_at | timestamp with time zone (timestamptz) | 否 | now() |

## registration_day_ops

- 模組：現場與逐日營運
- 用途：逐日報到、撤場與押金狀態
- RLS：已開啟
- 主鍵：tenant_id、registration_id、activity_date
- 關聯：無正式外鍵或尚未建立
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| tenant_id | text | 否 | — |
| session_id | text | 否 | — |
| registration_id | text | 否 | — |
| activity_date | date | 否 | — |
| participation_status | text | 否 | '參加'::text |
| checkin_status | text | 否 | '未報到'::text |
| checkin_at | timestamp with time zone (timestamptz) | 是 | — |
| stall_number | text | 是 | — |
| equipment_json | jsonb | 否 | '{}'::jsonb |
| teardown_status | text | 否 | '未撤場'::text |
| deposit_status | text | 否 | '未退押金'::text |
| deposit_refunded_at | timestamp with time zone (timestamptz) | 是 | — |
| violation_flags | text | 是 | — |
| admin_note | text | 是 | — |
| refund_status | text | 否 | ''::text |
| refund_amount | numeric | 否 | 0 |
| refund_note | text | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| updated_at | timestamp with time zone (timestamptz) | 否 | now() |

## registration_day_seats

- 模組：排位與攤位
- 用途：逐日排位結果
- RLS：已開啟
- 主鍵：tenant_id、session_id、activity_date、seat_code
- 關聯：無正式外鍵或尚未建立
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| tenant_id | text | 否 | — |
| session_id | text | 否 | — |
| activity_date | date | 否 | — |
| seat_code | text | 否 | — |
| registration_id | text | 否 | — |
| assigned_type | text | 否 | 'auto'::text |
| assigned_by | text | 是 | — |
| assigned_at | timestamp with time zone (timestamptz) | 否 | now() |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| updated_at | timestamp with time zone (timestamptz) | 否 | now() |

## registration_items

- 模組：活動、場次與報名
- 用途：報名金流明細相容表
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | uuid | 否 | gen_random_uuid() |
| registration_id | text | 是 | — |
| item_type | text | 是 | — |
| item_name | text | 是 | — |
| quantity | integer (int4) | 是 | 1 |
| unit_price | numeric | 是 | 0 |
| amount | numeric | 是 | 0 |
| note | text | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 是 | now() |
| tenant_id | text | 是 | — |

## registration_resolutions

- 模組：活動、場次與報名
- 用途：報名取消、退款與保留決議
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：目前未直接引用或為資料庫內部／預留用途

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| member_email | text | 否 | — |
| source_registration_id | text | 否 | — |
| source_session_id | text | 否 | — |
| mode | text | 否 | — |
| target_registration_id | text | 是 | — |
| target_session_id | text | 是 | — |
| paid_amount | numeric | 否 | 0 |
| activity_paid | numeric | 否 | 0 |
| deposit_paid | numeric | 否 | 0 |
| credit_created | numeric | 否 | 0 |
| deposit_refund_due | numeric | 否 | 0 |
| due_amount | numeric | 否 | 0 |
| note | text | 是 | — |
| actor_email | text | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |

## registrations

- 模組：活動、場次與報名
- 用途：報名主資料、審核、付款摘要、設備與跨日狀態
- RLS：已開啟
- 主鍵：id
- 關聯：event_id → events.id；session_id → sessions.id；tenant_id → tenants.id
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| session_id | text | 是 | — |
| event_id | text | 是 | — |
| email | text | 否 | — |
| name | text | 是 | — |
| phone | text | 是 | — |
| brand | text | 是 | — |
| brand_intro | text | 是 | — |
| sell_cat | text | 是 | — |
| sell_item | text | 是 | — |
| sell_link | text | 是 | — |
| photo_url | text | 是 | — |
| fb_url | text | 是 | — |
| ig_url | text | 是 | — |
| equip_json | jsonb | 是 | '{}'::jsonb |
| custom_fields_json | jsonb | 是 | '{}'::jsonb |
| stall_count | integer (int4) | 是 | 1 |
| stall_no | text | 是 | — |
| deposit | numeric | 是 | 0 |
| review_status | text | 是 | '待審核'::text |
| pay_status | text | 是 | '未繳費'::text |
| amount | numeric | 是 | 0 |
| pay_method | text | 是 | — |
| paid_at | timestamp with time zone (timestamptz) | 是 | — |
| checkin_status | text | 是 | '未報到'::text |
| checkin_at | timestamp with time zone (timestamptz) | 是 | — |
| clear_status | text | 是 | '未清場'::text |
| deposit_refunded | text | 是 | '未退押金'::text |
| tax_id | text | 是 | — |
| invoice_title | text | 是 | — |
| invoice_email | text | 是 | — |
| invoice_status | text | 是 | — |
| invoice_type | text | 是 | — |
| invoice_carrier | text | 是 | — |
| admin_note | text | 是 | — |
| selected_dates_json | jsonb | 是 | '[]'::jsonb |
| addon_qty_json | jsonb | 是 | '{}'::jsonb |
| addon_amount | numeric | 是 | 0 |
| total_amount | numeric | 是 | 0 |
| remind_sent | boolean (bool) | 是 | false |
| transfer_status | text | 是 | ''::text |
| transfer_target_session_id | text | 是 | — |
| original_session_id | text | 是 | — |
| transfer_chosen_at | timestamp with time zone (timestamptz) | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 是 | now() |
| sell_category | text | 是 | — |
| sell_items | text | 是 | — |
| equipment_json | jsonb | 是 | '{}'::jsonb |
| payment_status | text | 是 | '未繳費'::text |
| payment_method | text | 是 | — |
| stall_number | text | 是 | — |
| reminder_sent | boolean (bool) | 是 | false |
| brand_name | text | 是 | — |
| payment_report_amount | numeric | 是 | 0 |
| payment_last5 | text | 是 | — |
| payment_reported_at | timestamp with time zone (timestamptz) | 是 | — |
| payment_screenshot_status | text | 是 | ''::text |
| payment_screenshot_received_at | timestamp with time zone (timestamptz) | 是 | — |
| payment_detail_json | jsonb | 是 | '{}'::jsonb |
| payment_line_card_text | text | 是 | — |
| refund_amount | numeric | 是 | 0 |
| refund_admin_fee | numeric | 是 | 0 |
| refund_transfer_fee | numeric | 是 | 0 |
| refund_rule_label | text | 是 | — |
| refunded_at | timestamp with time zone (timestamptz) | 是 | — |
| refund_note | text | 是 | — |
| participants_json | jsonb | 是 | '{}'::jsonb |
| member_id | text | 是 | — |
| status | text | 是 | '待審核'::text |
| agreement_viewed | boolean (bool) | 是 | false |
| agreement_accepted | boolean (bool) | 是 | false |
| seat_choice_intent | text | 是 | 'none'::text |
| seat_choice_status | text | 是 | 'none'::text |
| seat_choice_type | text | 是 | 'auto'::text |
| seat_fee_total | numeric | 是 | 0 |
| seat_hold_expires_at | timestamp with time zone (timestamptz) | 是 | — |
| teardown_status | text | 是 | '未撤場'::text |
| violation_flags | text | 是 | ''::text |
| bundle_id | text | 是 | ''::text |
| bundle_group_id | text | 是 | ''::text |
| payment_profile_id | text | 是 | — |
| payment_profile_snapshot | jsonb | 是 | — |
| payment_owner_mode | text | 是 | — |
| payment_methods_allowed | jsonb | 是 | — |
| bank_account_snapshot | jsonb | 是 | — |
| linepay_config_snapshot | jsonb | 是 | — |
| card_config_snapshot | jsonb | 是 | — |
| payment_snapshot_created_at | timestamp with time zone (timestamptz) | 是 | — |
| payment_group_id | text | 是 | ''::text |
| transferred_from_registration_id | text | 是 | — |
| paid_amount | numeric | 否 | 0 |
| pending_partial_refund | numeric | 是 | 0 |
| pending_partial_note | text | 是 | — |
| roster_number | text | 是 | — |
| roster_sequence | integer (int4) | 是 | — |
| roster_numbered_at | timestamp with time zone (timestamptz) | 是 | — |
| activity_credit_applied | numeric | 否 | 0 |

## report_download_logs

- 模組：報表
- 用途：報表下載紀錄
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：目前未直接引用或為資料庫內部／預留用途

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| session_id | text | 是 | — |
| event_id | text | 是 | — |
| template_id | text | 是 | — |
| export_id | text | 是 | — |
| staff_email | text | 是 | — |
| action | text | 否 | 'download'::text |
| file_name | text | 是 | — |
| file_format | text | 否 | 'xlsx'::text |
| status | text | 否 | 'generated'::text |
| user_agent | text | 是 | — |
| meta_json | jsonb | 否 | '{}'::jsonb |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |

## report_exports

- 模組：報表
- 用途：報表輸出紀錄
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：目前未直接引用或為資料庫內部／預留用途

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| session_id | text | 是 | — |
| event_id | text | 是 | — |
| template_id | text | 是 | — |
| file_name | text | 是 | — |
| file_format | text | 否 | 'xlsx'::text |
| status | text | 否 | 'generated'::text |
| snapshot_summary_json | jsonb | 否 | '{}'::jsonb |
| generated_by | text | 是 | — |
| generated_at | timestamp with time zone (timestamptz) | 否 | now() |
| downloaded_at | timestamp with time zone (timestamptz) | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |

## report_permissions

- 模組：報表
- 用途：報表讀取權限
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：目前未直接引用或為資料庫內部／預留用途

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| name | text | 否 | — |
| allowed_roles_json | jsonb | 否 | '[]'::jsonb |
| allowed_emails_json | jsonb | 否 | '[]'::jsonb |
| allowed_templates_json | jsonb | 否 | '[]'::jsonb |
| allowed_sessions_json | jsonb | 否 | '[]'::jsonb |
| is_active | boolean (bool) | 否 | true |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| updated_at | timestamp with time zone (timestamptz) | 否 | now() |

## report_templates

- 模組：報表
- 用途：報表模板
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：目前未直接引用或為資料庫內部／預留用途

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| name | text | 否 | — |
| report_type | text | 否 | 'session_workbook'::text |
| session_type | text | 是 | — |
| config_json | jsonb | 否 | '{}'::jsonb |
| is_active | boolean (bool) | 否 | true |
| created_by | text | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| updated_at | timestamp with time zone (timestamptz) | 否 | now() |

## seat_assignments

- 模組：排位與攤位
- 用途：排位指派相容資料
- RLS：已開啟
- 主鍵：id
- 關聯：registration_id → registrations.id；session_id → sessions.id；stall_id → stalls.id；tenant_id → tenants.id
- Worker 使用：目前未直接引用或為資料庫內部／預留用途

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| session_id | text | 否 | — |
| registration_id | text | 是 | — |
| stall_id | text | 是 | — |
| seat_code | text | 否 | — |
| status | text | 否 | '預留'::text |
| assigned_by | text | 是 | — |
| assigned_source | text | 否 | 'member'::text |
| assigned_at | timestamp with time zone (timestamptz) | 否 | now() |
| released_at | timestamp with time zone (timestamptz) | 是 | — |
| locked_at | timestamp with time zone (timestamptz) | 是 | — |

## seat_maps

- 模組：排位與攤位
- 用途：場次排位底圖與設定
- RLS：已開啟
- 主鍵：id
- 關聯：session_id → sessions.id；tenant_id → tenants.id
- Worker 使用：目前未直接引用或為資料庫內部／預留用途

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| session_id | text | 否 | — |
| map_name | text | 否 | '預設選位圖'::text |
| map_type | text | 否 | 'grid'::text |
| layout_json | jsonb | 否 | '{}'::jsonb |
| is_enabled | boolean (bool) | 否 | true |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| updated_at | timestamp with time zone (timestamptz) | 是 | — |

## seat_operation_logs

- 模組：排位與攤位
- 用途：排位操作紀錄
- RLS：已開啟
- 主鍵：id
- 關聯：registration_id → registrations.id；session_id → sessions.id；stall_id → stalls.id；tenant_id → tenants.id
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| session_id | text | 是 | — |
| registration_id | text | 是 | — |
| stall_id | text | 是 | — |
| action | text | 否 | — |
| operator_type | text | 是 | — |
| operator_id | text | 是 | — |
| note | text | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |

## session_bundles

- 模組：活動、場次與報名
- 用途：多場次組合方案
- RLS：已開啟
- 主鍵：id
- 關聯：tenant_id → tenants.id
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| name | text | 否 | — |
| session_ids | text | 否 | ''::text |
| bundle_price | integer (int4) | 否 | 0 |
| active | boolean (bool) | 否 | true |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| updated_at | timestamp with time zone (timestamptz) | 否 | now() |

## session_visual_assets

- 模組：視覺、相框與場地圖
- 用途：場次視覺素材
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| session_id | text | 否 | — |
| job_id | text | 否 | — |
| asset_type | text | 否 | 'main_visual'::text |
| style_preset | text | 否 | — |
| storage_provider | text | 否 | 'supabase_storage'::text |
| bucket_name | text | 否 | 'session-visuals'::text |
| storage_path | text | 否 | — |
| public_url | text | 否 | — |
| mime_type | text | 否 | 'image/png'::text |
| width | integer (int4) | 否 | 1024 |
| height | integer (int4) | 否 | 1024 |
| file_size | bigint (int8) | 是 | — |
| variant_no | integer (int4) | 否 | — |
| is_selected | boolean (bool) | 否 | false |
| prompt_text | text | 是 | — |
| created_by | text | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |

## sessions

- 模組：活動、場次與報名
- 用途：活動場次、日期、費用、設備與報名排程
- RLS：已開啟
- 主鍵：id
- 關聯：event_id → events.id；tenant_id → tenants.id
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| event_id | text | 是 | — |
| name | text | 否 | — |
| type | text | 是 | — |
| region | text | 是 | — |
| venue | text | 是 | — |
| dates_json | jsonb | 是 | '[]'::jsonb |
| fee | numeric | 是 | 0 |
| deposit | numeric | 是 | 0 |
| limit_count | integer (int4) | 是 | 0 |
| max_stalls | integer (int4) | 是 | 0 |
| current_count | integer (int4) | 是 | 0 |
| status | text | 是 | '報名中'::text |
| need_review | boolean (bool) | 是 | true |
| modules_json | jsonb | 是 | '{}'::jsonb |
| equip_json | jsonb | 是 | '{}'::jsonb |
| basic_equip | text | 是 | — |
| custom_fields_json | jsonb | 是 | '[]'::jsonb |
| addons_json | jsonb | 是 | '[]'::jsonb |
| portals | text | 是 | — |
| cover_url | text | 是 | — |
| description | text | 是 | — |
| organizer | text | 是 | — |
| co_organizer | text | 是 | — |
| stall_list_json | jsonb | 是 | '[]'::jsonb |
| invoice_tax_json | jsonb | 是 | — |
| force_cancel | boolean (bool) | 是 | false |
| force_cancel_target_id | text | 是 | — |
| force_cancel_deadline | timestamp with time zone (timestamptz) | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 是 | now() |
| assigned_staff | text | 是 | — |
| theme | text | 是 | — |
| payment_methods_json | jsonb | 是 | '{"bank": true, "card": false, "linepay": true}'::jsonb |
| payment_links_json | jsonb | 是 | '{}'::jsonb |
| payment_notice | text | 是 | — |
| refund_rules_json | jsonb | 是 | — |
| agreement_required | boolean (bool) | 是 | true |
| agreement_title | text | 是 | '報名合約／活動細則與攤商規範'::text |
| agreement_content | text | 是 | ''::text |
| agreement_version | text | 是 | ''::text |
| agreement_updated_at | timestamp with time zone (timestamptz) | 是 | — |
| seat_pricing_enabled | boolean (bool) | 是 | false |
| seat_hold_hours | integer (int4) | 是 | 24 |
| seat_map_url | text | 是 | — |
| updated_at | timestamp with time zone (timestamptz) | 是 | now() |
| payment_profile_id | text | 是 | — |
| main_visual_asset_id | text | 是 | — |
| ai_visual_preset | text | 是 | — |
| seat_assign_days_before | integer (int4) | 否 | 7 |
| seat_assign_done_at | timestamp with time zone (timestamptz) | 是 | — |
| venue_map_template_id | text | 是 | — |
| seat_assign_last_at | timestamp with time zone (timestamptz) | 是 | — |
| seat_assign_run_count | integer (int4) | 否 | 0 |
| seat_board_json | jsonb | 否 | '{}'::jsonb |
| seat_module_enabled | boolean (bool) | 否 | false |
| seat_auto_layout_days_before | integer (int4) | 否 | 7 |
| seat_layout_template_id | text | 是 | — |
| seat_layout_published_at | timestamp with time zone (timestamptz) | 是 | — |
| registration_schedule_json | jsonb | 否 | '{"preset": "three_stage", "enabled": false, "version": 1, "windows": [], "timezone": "Asia/Taipei"}'::jsonb |

## short_links

- 模組：其他正式資料
- 用途：一般短網址
- RLS：已開啟
- 主鍵：id
- 關聯：session_id → sessions.id；tenant_id → tenants.id
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | bigint (int8) | 否 | nextval('short_links_id_seq'::regclass) |
| tenant_id | text | 否 | — |
| session_id | text | 否 | — |
| code | text | 否 | — |
| clicks | integer (int4) | 否 | 0 |
| last_click_at | timestamp with time zone (timestamptz) | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |

## staff

- 模組：身分、權限與平台設定
- 用途：租戶與平台管理帳號的正式授權來源
- RLS：已開啟
- 主鍵：email、tenant_id
- 關聯：tenant_id → tenants.id
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| email | text | 否 | — |
| tenant_id | text | 否 | — |
| name | text | 是 | — |
| role | text | 是 | '活動夥伴'::text |
| perms_json | jsonb | 是 | '{}'::jsonb |
| limit_sessions | text | 是 | — |
| joined_at | timestamp with time zone (timestamptz) | 是 | now() |
| is_active | boolean (bool) | 是 | true |
| normalized_role | text | 是 | — |
| role_id | text | 是 | — |
| active | boolean (bool) | 是 | true |
| updated_at | timestamp with time zone (timestamptz) | 是 | now() |
| id | uuid | 是 | gen_random_uuid() |
| scope_type | text | 是 | 'all'::text |
| scope_event_id | text | 是 | — |
| scope_session_ids | jsonb | 否 | '[]'::jsonb |
| permissions | jsonb | 否 | '{}'::jsonb |
| display_name | text | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 是 | now() |

## staff_action_logs

- 模組：身分、權限與平台設定
- 用途：管理者操作紀錄
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| staff_id | text | 是 | — |
| staff_email | text | 是 | — |
| action_type | text | 否 | — |
| target_type | text | 是 | — |
| target_id | text | 是 | — |
| before_data | jsonb | 是 | — |
| after_data | jsonb | 是 | — |
| meta_json | jsonb | 是 | '{}'::jsonb |
| created_at | timestamp with time zone (timestamptz) | 是 | now() |

## staff_session_permissions

- 模組：身分、權限與平台設定
- 用途：管理者可操作場次範圍
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| staff_id | text | 是 | — |
| staff_email | text | 否 | — |
| session_id | text | 否 | — |
| can_view | boolean (bool) | 是 | true |
| can_checkin | boolean (bool) | 是 | true |
| can_mark_absent | boolean (bool) | 是 | true |
| can_note | boolean (bool) | 是 | true |
| can_mark_refund_flag | boolean (bool) | 是 | true |
| is_active | boolean (bool) | 是 | true |
| created_at | timestamp with time zone (timestamptz) | 是 | now() |
| updated_at | timestamp with time zone (timestamptz) | 是 | now() |

## stalls

- 模組：排位與攤位
- 用途：攤位版面與占用狀態
- RLS：已開啟
- 主鍵：id
- 關聯：session_id → sessions.id；tenant_id → tenants.id
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| session_id | text | 是 | — |
| stall_no | text | 是 | — |
| status | text | 是 | '空閒'::text |
| reg_id | text | 是 | — |
| hold_time | timestamp with time zone (timestamptz) | 是 | — |
| email | text | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 是 | now() |
| seat_label | text | 是 | — |
| seat_type | text | 是 | — |
| price_adjustment | numeric | 否 | 0 |
| sort_order | integer (int4) | 否 | 0 |
| row_label | text | 是 | — |
| col_label | text | 是 | — |
| is_selectable | boolean (bool) | 否 | true |
| is_reserved | boolean (bool) | 否 | false |
| is_locked | boolean (bool) | 否 | false |
| updated_at | timestamp with time zone (timestamptz) | 是 | — |
| seat_code | text | 是 | — |
| price_delta | numeric | 是 | 0 |
| map_x | numeric | 是 | — |
| map_y | numeric | 是 | — |
| map_order | integer (int4) | 是 | 0 |
| is_active | boolean (bool) | 是 | true |
| registration_id | text | 是 | — |
| seat_hold_expires_at | timestamp with time zone (timestamptz) | 是 | — |
| note | text | 是 | — |
| category | text | 是 | ''::text |

## system_settings

- 模組：身分、權限與平台設定
- 用途：正式系統設定
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：目前未直接引用或為資料庫內部／預留用途

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | uuid | 否 | gen_random_uuid() |
| tenant_id | text | 否 | 'tuibile'::text |
| setting_key | text | 否 | — |
| setting_value | jsonb | 否 | '{}'::jsonb |
| updated_by | text | 是 | — |
| updated_at | timestamp with time zone (timestamptz) | 否 | now() |

## tenant_agreement_templates

- 模組：身分、權限與平台設定
- 用途：合約模板
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| title | text | 是 | '報名合約／活動細則與攤商規範'::text |
| content | text | 是 | ''::text |
| version | text | 是 | 'v1.0'::text |
| updated_at | timestamp with time zone (timestamptz) | 是 | now() |
| created_at | timestamp with time zone (timestamptz) | 是 | now() |
| slot_no | integer (int4) | 是 | 1 |
| label | text | 是 | ''::text |

## tenant_settings

- 模組：身分、權限與平台設定
- 用途：租戶擴充設定
- RLS：已開啟
- 主鍵：id
- 關聯：tenant_id → tenants.id
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| module_flags_json | jsonb | 否 | '{}'::jsonb |
| setting_key | text | 是 | — |
| setting_value | text | 是 | — |
| updated_by | text | 是 | — |
| updated_at | timestamp with time zone (timestamptz) | 否 | now() |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |

## tenants

- 模組：身分、權限與平台設定
- 用途：租戶主資料與整體設定
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| name | text | 否 | — |
| slug | text | 否 | — |
| owner_email | text | 否 | [redacted-email-default] |
| plan | text | 是 | 'free'::text |
| line_url | text | 是 | — |
| bank_info | text | 是 | — |
| created_at | timestamp with time zone (timestamptz) | 是 | now() |
| config_json | jsonb | 是 | '{}'::jsonb |
| logo_url | text | 是 | — |
| brand_color | text | 是 | '#2d6a4f'::text |
| email_from | text | 是 | — |
| email_reply_to | text | 是 | — |
| footer_text | text | 是 | — |
| site_url | text | 是 | — |
| auth_secret | text | 是 | — |
| active | boolean (bool) | 是 | true |
| invoice_enabled | boolean (bool) | 是 | true |
| invoice_tax_id | text | 是 | — |
| invoice_title | text | 是 | — |
| invoice_email | text | 是 | — |
| invoice_carrier | text | 是 | — |
| invoice_prefix | text | 是 | — |
| invoice_note | text | 是 | — |
| invoice_config_json | jsonb | 是 | '{}'::jsonb |
| invoice_mode | text | 是 | 'enabled'::text |
| payment_config_json | jsonb | 是 | '{}'::jsonb |
| default_refund_rules_json | jsonb | 是 | '{"rules": [{"key": "before_7", "label": "活動前 7 日以上：扣行政費 NT$500", "minDays": 7, "adminFee": 500, "adminFeeType": "fixed"}, {"key": "before_3_6", "label": "活動前 3～6 日：退 50%", "maxDays": 6, "minDays": 3, "adminFeeType": "percent", "adminFeePercent": 50}, {"key": "within_3", "label": "活動前 3 日內或當日：不退費", "maxDays": 2, "minDays": -9999, "adminFeeType": "percent", "adminFeePercent": 100}], "transferFeeDefault": 0}'::jsonb |
| status | text | 是 | 'active'::text |
| plan_type | text | 是 | 'trial'::text |
| trial_start_at | timestamp with time zone (timestamptz) | 是 | — |
| trial_end_at | timestamp with time zone (timestamptz) | 是 | — |
| is_locked | boolean (bool) | 否 | false |
| contact_name | text | 是 | — |
| contact_phone | text | 是 | — |
| event_type | text | 是 | — |
| apply_note | text | 是 | — |
| notify_email | text | 是 | — |
| updated_at | timestamp with time zone (timestamptz) | 是 | now() |
| locked_reason | text | 是 | — |
| session_count_used | integer (int4) | 否 | 0 |

## venue_map_templates

- 模組：視覺、相框與場地圖
- 用途：場地圖模板
- RLS：已開啟
- 主鍵：id
- 關聯：無正式外鍵或尚未建立
- Worker 使用：是

| 欄位 | 型態 | 可空白 | 預設值 |
|---|---|---:|---|
| id | text | 否 | — |
| tenant_id | text | 否 | — |
| name | text | 否 | — |
| seat_map_url | text | 是 | ''::text |
| seats_json | jsonb | 否 | '[]'::jsonb |
| note | text | 是 | ''::text |
| created_at | timestamp with time zone (timestamptz) | 否 | now() |
| updated_at | timestamp with time zone (timestamptz) | 否 | now() |

## 正式資料處理程序

| 名稱 | 參數 | 回傳 | 權限模式 |
|---|---|---|---|
| adjust_member_credit_atomic | p_tenant_id text, p_member_email text, p_direction text, p_amount numeric, p_note text, p_actor_email text | jsonb | 特權執行；需維持封閉授權 |
| apply_member_credit_atomic | p_tenant_id text, p_registration_id text, p_member_email text | jsonb | 特權執行；需維持封閉授權 |
| claim_session_slot | p_tenant_id text, p_session_id text, p_stall_count integer | jsonb | 特權執行；需維持封閉授權 |
| complete_deposit_refund_atomic | p_tenant_id text, p_registration_id text, p_activity_date date, p_refund_method text, p_refund_reference text, p_refund_note text, p_refunded_at timestamp with time zone, p_actor_email text | jsonb | 特權執行；需維持封閉授權 |
| complete_partial_day_refund_atomic | p_tenant_id text, p_registration_id text, p_dates jsonb, p_refund_amount numeric, p_admin_fee numeric, p_transfer_fee numeric, p_deposit_amount numeric, p_deposit_included boolean, p_refund_method text, p_refund_reference text, p_refund_note text, p_refunded_at timestamp with time zone, p_actor_email text | jsonb | 特權執行；需維持封閉授權 |
| complete_registration_refund_atomic | p_tenant_id text, p_items jsonb, p_refund_method text, p_refund_reference text, p_refund_note text, p_refunded_at timestamp with time zone, p_actor_email text, p_scope text | jsonb | 特權執行；需維持封閉授權 |
| consignment_adjust_inventory | p_tenant_id text, p_session_id text, p_barcode text, p_movement_type text, p_quantity integer, p_operator_email text, p_note text | jsonb | 特權執行；需維持封閉授權 |
| consignment_create_application | p_registration jsonb, p_consignment jsonb | jsonb | 特權執行；需維持封閉授權 |
| consignment_pos_checkout | p_tenant_id text, p_session_id text, p_cashier_email text, p_payment_method text, p_items jsonb, p_discount_amount numeric, p_note text | jsonb | 特權執行；需維持封閉授權 |
| consignment_pos_void_sale | p_tenant_id text, p_sale_id uuid, p_operator_email text, p_note text | jsonb | 特權執行；需維持封閉授權 |
| consignment_review_application | p_tenant_id text, p_registration_id text, p_review_status text, p_operator_email text | jsonb | 特權執行；需維持封閉授權 |
| consignment_save_product | p_tenant_id text, p_registration_id text, p_member_email text, p_product_name text, p_category text, p_description text, p_image_url text, p_variants jsonb | jsonb | 特權執行；需維持封閉授權 |
| consignment_submit_products | p_tenant_id text, p_registration_id text, p_member_email text | jsonb | 特權執行；需維持封閉授權 |
| create_bundle_registrations_atomic | p_tenant_id text, p_bundle_group_id text, p_rows jsonb, p_merges jsonb | jsonb | 呼叫者權限 |
| guard_deposit_refund_transaction |  | trigger | 呼叫者權限 |
| purge_error_logs | p_days integer | jsonb | 呼叫者權限 |
| release_session_slot | p_tenant_id text, p_session_id text, p_stall_count integer | jsonb | 特權執行；需維持封閉授權 |
| resolve_registration_atomic | p_tenant_id text, p_registration_id text, p_mode text, p_target_session_id text, p_new_registration_id text, p_target_event_id text, p_target_dates jsonb, p_target_activity_fee numeric, p_target_deposit numeric, p_paid_amount numeric, p_activity_paid numeric, p_deposit_paid numeric, p_credit_created numeric, p_deposit_refund_due numeric, p_due_amount numeric, p_note text, p_actor_email text | jsonb | 特權執行；需維持封閉授權 |
| restore_member_credit_atomic | p_tenant_id text, p_registration_id text, p_note text | jsonb | 特權執行；需維持封閉授權 |
| rotate_onsite_passcode | p_tenant_id text, p_session_id text, p_code text, p_assignee_note text, p_open_from timestamp with time zone, p_open_until timestamp with time zone, p_rotate boolean, p_expected_current_id text, p_actor_email text, p_actor_role text | TABLE(passcode_id text, code text, open_from timestamp with time zone, open_until timestamp with time zone, assignee_note text, active boolean, reused boolean, stale_request boolean) | 呼叫者權限 |
| save_seat_marker_positions_atomic | p_tenant_id text, p_session_id text, p_positions jsonb | jsonb | 特權執行；需維持封閉授權 |
| seat_expand_blank_board | p_tenant_id text, p_session_id text | jsonb | 特權執行；需維持封閉授權 |
| seat_rebuild_blank_board | p_tenant_id text, p_session_id text, p_columns integer, p_force boolean | jsonb | 特權執行；需維持封閉授權 |
| seat_sync_paid_roster_numbers | p_tenant_id text, p_session_id text | jsonb | 特權執行；需維持封閉授權 |
| set_deposit_return_status_atomic | p_tenant_id text, p_registration_id text, p_activity_date date, p_returned boolean, p_actor_email text, p_note text | jsonb | 特權執行；需維持封閉授權 |
| set_session_main_visual_atomic | p_tenant_id text, p_session_id text, p_asset_id text | jsonb | 呼叫者權限 |
| short_link_hit | p_code text | TABLE(tenant_id text, session_id text, clicks integer) | 呼叫者權限 |
| sync_seat_roster_atomic | p_tenant_id text, p_session_id text, p_actor_email text | jsonb | 特權執行；需維持封閉授權 |
| sync_seat_roster_mobile_atomic | p_tenant_id text, p_session_id text, p_actor_email text | jsonb | 特權執行；需維持封閉授權 |
| void_manual_member_credit_atomic | p_tenant_id text, p_ledger_id text, p_note text, p_actor_email text | jsonb | 特權執行；需維持封閉授權 |
