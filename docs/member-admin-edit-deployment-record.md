# 會員資料協助修正｜正式部署紀錄

日期：2026-08-21（Asia/Taipei）

- 功能 PR：#62
- 功能 merge commit：`d38b3ca121553a3c16b571d4d2c13881f97746cf`
- 部署請求 commit：`384347c129e79ba2792663a2392b6271d70e0d74`
- 正式 Worker：`2bl-v7`
- 正式 Cloudflare version：`3b383dff-d161-41bb-bd55-5e1942107c1f`
- 正式 deployment：`4d4f48d0-74fb-47e3-990e-185fdced13ab`
- 正式 deployed content SHA-256：`65262f02565e938a03bf8a9e660f7d4ff62e221797a1081809a56231ea858bd3`
- 部署後唯讀驗證 run：`32418327573`
- Wrangler dry-run SHA-256：`65262f02565e938a03bf8a9e660f7d4ff62e221797a1081809a56231ea858bd3`
- 結果：dry-run 封裝與正式 Worker 完全一致。
- 正式 API：`tenant=tuibile` ping 通過，Supabase 回報正常。
- Data contract：strict 通過；unknown tables = 0、unknown routines = 0、disallowed localStorage = 0、blockers = 0。
- Cloudflare route／bindings／secrets 名稱保留；`tobeloved-api` 未碰觸。
- 本功能沒有 Supabase schema migration；會員管理者修改只更新 `members` 基本資料並寫 `audit_logs`，不覆寫歷史 `registrations`、`payments`、`refund_transactions`、`member_credit_ledger` 或 seating。

## 正式功能範圍

後台：會員 → 搜尋 → 資料／修改，可協助修改姓名、手機、品牌、販售類別、FB、IG、官網／作品連結、品牌介紹。Email 維持唯讀。

前台保護：背景儲存不得靜默更換登入手機；會員本人明確改手機時必須再次確認。

## 狀態

- 部署與 Worker 來源驗證：PASS
- 正式 API / Supabase 連線：PASS
- 程式／資料契約／權限安全門：PASS
- 真人會員資料修改 → 新手機重新登入 → 歷史報名／付款／退款／活動金／排位完整：UAT，尚未以真實會員執行，禁止在未測前標示整體功能完全 PASS。
