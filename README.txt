2BL 團購完整檔案包

這一包整合目前已完成且通過語法檢查的正式檔案：
- admin.html
- index.html
- worker.txt
- groupbuy.html
- groupbuy-shop.html
- complete_groupbuy.sql

已包含：
- 團購＝既有場次模組
- 商品照片／說明／庫存
- 多商品購物車
- 現場取貨／宅配開關
- 運費／滿額免運
- 場次管理員申請
- 供應商出貨資料設計
- 商品數量階梯價資料欄位
- 多日優惠 Worker 保存／讀回／正式計價修復

重要：
complete_groupbuy.sql 為 idempotent 補欄位 SQL，可重複執行。
目前尚未能由本工具完成正式瀏覽器登入後 E2E，因此部署後仍需真人測試：
1. 多日優惠儲存後重開
2. 團購商品建立
3. 宅配收件資料
4. 多商品一起下單
5. 供應商出貨資料
6. 未開團購的既有市集場次回歸
