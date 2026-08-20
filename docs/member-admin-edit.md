# 後台協助修正會員資料

狀態：開發分支完成，尚未合併、尚未部署、尚未修改正式資料。

## 使用路徑
後台 → 會員 → 搜尋 Email／手機／品牌 → 資料／修改 → 修正基本資料 → 確認差異 → Worker 權限與系列範圍驗證 → members 正式資料更新 → audit_logs 留下修改前後 → 後台重新讀取。

## 安全規則
- Email 唯讀。
- 只更新 members，不覆寫歷史 registrations / payments / refunds / activity credit / seating。
- 管理權限沿用 canManageMembers 與系列範圍。
- 會員本人改手機需明確確認；背景自動儲存永遠沿用已驗證舊手機。
- 本人與管理者修改都寫入 audit_logs。
- 舊販售類別入口改寫正式 members.sell_category。
