# 2BL 正式資料契約與唯讀盤點

盤點日期：2026-08-15（Asia/Taipei）  
正式 Supabase：`2bl`／`douhmxipedgpfbvfynbq`  
正式 Tenant：`tuibile`

本文件只記錄唯讀結果，未建立資料表、欄位、RPC、policy、migration 或 Edge Function。

## 唯一資料流

正式資料只能走：瀏覽器 → `2bl-v7` Worker API → Supabase `douhmxipedgpfbvfynbq`。

- 前端不得直接呼叫 Supabase URL、REST、RPC 或攜帶 Supabase key。
- Worker 的資料表與 RPC 名稱必須存在於 `.automation/supabase-schema-audit.json`。
- 不得以 localStorage 保存會員電話、收藏、名單、付款、退款、報名或任何正式業務資料。
- localStorage 只允許登入 token、email、tenant/session 範圍與頁籤／導覽暫存狀態。
- 新名稱不得由程式自行發明；正式名稱只能從現有 schema 選定，任何 schema 更動另提 migration 並等待核准。

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
| tenants | `plan_type` | `plan` | 1 筆衝突，需先定義方案值對照 |
| sessions / stalls | `stalls` 關聯表 | `sessions.stall_list_json` | 舊 JSON 仍有 1 筆，禁止直接刪除 |

有衝突的欄位不得自動覆蓋、刪除或改名。下一次資料庫變更必須先提供值域對照、回填 SQL、驗證 SQL、索引／FK／RLS 影響與回復方案。

## 目前阻擋部署的資料問題

1. Worker 引用不存在的資料表：`admin_login_logs`、`billing_logs`、`tenant_apply_logs`。
2. Worker 引用不存在的 RPC：`operation_session_report`。
3. `index.html` 仍以 localStorage 保存 `fav_sessions`、`tb_member_phone`、`2bl_photo_lead_done`。
4. `onsite.html` 仍以 localStorage 保存 `2bl_onsite_operator`。
5. 五個 SECURITY DEFINER RPC 對 anon/authenticated 保有 EXECUTE，其中兩個未固定 search_path。
6. 所有 57 個 public table 都啟用 RLS，但 policy 數為 0；目前 Worker 使用 service role，不能把「RLS 已啟用」誤判成一般 API 已安全。

上述問題未解決以前，安全部署工作流會在資料契約嚴格檢查階段停止。

## 目前允許的 localStorage 類型

- 登入：token、email、登入 session 容器。
- 導覽：目前頁籤、返回頁面、篩選條件、tenant/session 範圍。
- 不允許：電話、收藏、操作人姓名、表單內容、付款／退款／報名資料與「已完成」業務旗標。

## 不會自行執行的修正

- 不會建立缺少的三張表或缺少的 RPC，因為必須先確認它們應改接哪個既有正式名稱。
- 不會撤銷 RPC 權限或新增 RLS policy，因為這是正式資料庫變更。
- 不會清除或合併重複欄位，因為現有資料有衝突。
- 不會刪除重複索引，需先確認實際 constraint 依賴。
