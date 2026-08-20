# 2BL 會員資料協助修正｜安全 Checkpoint

記錄日期：2026-08-21（Asia/Taipei）
狀態：工作分支已完成開發，尚未合併 main、尚未部署、尚未修改正式 Supabase 資料。

## 固定環境
- Repository：ndiangrace-create/2bL
- Base：main
- Base commit：ca34d75e86bdefd77a5e8165bd1bc845e84c0de6
- Branch：agent/member-admin-edit
- Draft PR：#62
- PR head（記錄時）：134f143d9c397b98a9521d3c451e13ab3addf46f
- Supabase：douhmxipedgpfbvfynbq
- tenant_id：tuibile
- Worker：2bl-v7
- DOING / tobeloved-api：禁止碰觸

## 本次真正要達成的結果
主辦在後台查到會員後，可協助修改不熟悉手機操作的會員基本資料，不必每次直接改資料庫；修改後會員可用正確手機重新登入，且所有既有歷史資料維持原紀錄。

## 可修改欄位
- 姓名
- 手機
- 品牌名稱
- 販售類別
- Facebook
- Instagram
- 官網／作品連結
- 品牌介紹

Email 維持唯讀，不在一般會員資料修改流程直接更換。

## 已再次核對的保護範圍
PR #62 目前只變更 9 個檔案：
- DATA_CONTRACT.md
- admin.html
- docs/member-admin-edit-checkpoint.md
- docs/member-admin-edit-validation.md
- docs/member-admin-edit.md
- index.html
- lib/admin-authorization.js
- scripts/test-member-admin-edit.mjs
- worker.js

本 PR 沒有 Supabase migration、沒有 SQL schema 變更、沒有直接修改正式資料。

後台 `adminUpdateMemberProfile` 的 Worker 寫入只更新 `members`：
- name
- phone
- brand_name
- sell_category
- fb_url
- ig_url
- collab_url
- brand_intro
- updated_at

不更新、不刪除：
- registrations
- payments
- refund_transactions
- registration_resolutions
- member_credit_ledger
- registration_day_ops
- registration_day_seats
- seat_assignments
- stalls
- finance_items
- consignment_* 歷史資料

因此修改手機／姓名／品牌等基本資料，不會主動覆寫或刪除歷史報名、付款、退款、活動金、排位、報到、撤場、押金與財務紀錄。

## Audit
- 管理者修改：`audit_logs.action = admin_member_profile_update`
- 會員本人修改：`audit_logs.action = member_profile_self_update`
- 保存修改前／修改後與 changed_fields

## 手機誤改防護
- 前台背景自動儲存只能沿用已驗證的舊手機。
- 背景儲存不得把畫面中尚未明確送出的新手機寫成登入手機。
- 會員本人明確修改手機時，會再次顯示舊手機 → 新手機並要求確認。
- 管理者後台修改手機時，先顯示差異再送出。

## 權限
- 使用既有 `canManageMembers`。
- 系列管理者只能處理自己系列內曾有報名的會員。
- Email 不可在此功能修改。

## 完成前必做正式 E2E
正式部署後必須實測：
1. 後台搜尋會員。
2. 修改手機。
3. Worker 成功更新 members。
4. 後台重新讀取為新手機。
5. 使用新手機重新登入會員端。
6. 歷史報名仍存在。
7. 付款紀錄仍存在。
8. 退款紀錄仍存在。
9. 活動金餘額／ledger 不變。
10. 排位與每日現場紀錄仍存在。
11. 查看 audit_logs 修改紀錄。
12. LINE 內建瀏覽器與手機 Chrome 驗證。

上述未完成前狀態保持 VERIFY，不得宣稱正式 PASS。

## 目前待辦
- 等使用者明確說「確認部署」後，才可合併／部署。
- 正式部署後完成上述 E2E 與回歸。
- 先前已確認要重做的「2BL 營運世界樹」概念仍保留待辦：世界樹要以角色 → 實際營運路徑 → 系統支撐 → 開發狀態為主，不再只是工程功能清單。
