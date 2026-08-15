# 2BL 安全自動流

此分支只用來建立與驗證 2BL 安全自動流程。

固定目標：

- GitHub：`ndiangrace-create/2bL`
- 正式分支：`main`
- Cloudflare Worker：`2bl-v7`
- 禁止操作：`tobeloved-api`
- Supabase：`douhmxipedgpfbvfynbq`
- Tenant：`tuibile`

目前階段只允許 Cloudflare GET 唯讀盤點、版本雜湊核對及將正式 Worker 來源放入本工作分支。

禁止部署、禁止修改 Routes／Custom Domains／Bindings／Variables／Secrets，禁止合併 `main`。

正式部署流程必須等本分支完成差異及測試報告，並收到使用者明確說「確認部署」後才可建立或啟用。
