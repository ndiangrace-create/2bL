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
