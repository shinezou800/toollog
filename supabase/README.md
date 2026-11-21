# Supabase Free：配置与权限核对

此目录是可审查、可重复应用的云端配置，**文件存在不代表已在真实项目执行或验证**。

## 先确认免费与数据范围

1. 在 [Supabase Dashboard](https://supabase.com/dashboard) 使用你自己的账号登录。没有账号时选择 Sign up，可用 GitHub 登录；不要把密码发到对话或仓库。
2. 选择或新建 **Free** 组织，再新建专用 Toollog 项目；确认该组织没有付费订阅、信用卡要求或自动升级。选择数据库地区并保存数据库密码到密码管理器，不勾选付费附加项。遇到绑卡、升级或免费项目额度不足时停止。
3. 这是你名下的托管 Postgres 和 Auth：记录及登录邮箱会交给 Supabase 处理；服务 API 在公网，但业务数据要求登录与唯一管理员权限。前端只放 Devin 授权私密预览，不购买域名或部署公共站点。

## 项目设置（在放入真实记录前完成）

1. Authentication → Sign In / Providers → 关闭 **Allow new users to sign up** 及匿名登录；只保留 Email/Password，不配置公开邀请、OAuth、短信或邮件注册路径。
2. Authentication → Users → Add user / Create new user，建立唯一管理员并确认邮箱；管理员设置强密码，不依赖免费默认 SMTP 发重置邮件。将此用户 UUID 留在项目管理环境，不能用浏览器传入的邮箱或角色认定管理员。
3. 在 SQL Editor 执行 `migrations/202611210001_cloud.sql`。**不要执行 `tests/bootstrap.sql`**，它只用于本地临时 PostgreSQL，不适用于 Supabase。
4. 在管理端单独绑定管理员；将下方 UUID 占位符替换为第 2 步的真实用户 ID，再运行。实际 UUID、邮箱和密码不提交进 Git。

   ```sql
   update toollog_private.control
   set admin_id = '00000000-0000-0000-0000-000000000000'::uuid
   where singleton and admin_id is null;
   ```

   必须确认更新恰好一行；若为零行先检查，不覆盖已有管理员。控制表只能容纳一行，因此只能绑定一个用户；没有注册后自动提升管理员的逻辑。

5. 在 Project Settings → API / API Keys 找到项目 URL 与 **publishable** key，放在本机 `.env.local`（被 Git 忽略）：

   ```dotenv
   VITE_SUPABASE_URL=https://PROJECT.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

   浏览器使用的 publishable/旧 anon key 不是管理员权限。**service_role / sb_secret 密钥不需要交给应用**；即使仅用于服务器，也只能放服务端安全配置。不能用 `VITE_` 前缀，不能放 GitHub。构建配置会拒绝 service_role/secret key，避免等到网页运行时才报错、密钥已进产物。

6. `npm ci && npm run build && npm run preview`。未配置时显示锁定的设置页，绝不偷偷回落为“保存成功”的本地模式。新构建输出到 `dist-cloud/`，避免覆盖仍在运行的旧本机原型 `dist/`；私有预览须用生产构建。

## RLS 与访问边界

| 对象 | 权限 |
| --- | --- |
| `public.tools`、`public.trials` | ENABLE + FORCE RLS；仅绑定的管理员可 SELECT；客户端无直接写表权限 |
| `toollog_private.control` | ENABLE + FORCE RLS；不暴露 schema、不授予客户端权限；保存唯一管理员、库版本、导入开关 |
| `toollog_load`、`toollog_save` | 只给 authenticated 执行权限，函数内再次核对唯一管理员；匿名与其他已登录用户不能读写 |
| `toollog_is_admin` | 只对已登录请求返回其自身是否为唯一管理员，不列出任何账号信息 |

写入 RPC 使用固定空 search_path、防止对象替换，SQL 参数不做动态拼接；输入需通过数据库约束。控制行锁 + 全库 revision 做乐观并发控制：两个设备基于同一版本保存，只允许一个成功，另一个保留草稿、提示刷新。初版单管理员、最多 1000 个工具/单工具 1000 篇手记、请求最多约 2 MB；这是简化的全库版本保护，不提供多记录并发自动合并或毫秒级推送。

没有删除功能，RPC 也拒绝丢掉已有工具或手记的快照。日期、必填内容、长度、状态、URL 协议和重复 ID 在服务器校验；保存工具与手记以及递增版本属于同一事务。RLS 保护的是所有本应用表；不修改 Supabase 自身系统表。

## 旧数据：先备份，再等待确认，最后导入

- 开发与验收不需要读取你的实体手机数据。本会话不能替你读取 iPhone Safari 的 localStorage，故实际备份必须在**有原记录的浏览器和原网址**点击“导出备份”完成，并在下载/文件 App 中确认文件已保存。
- 在新应用登录后，展开旧数据迁移面板，可下载当前来源的原始 localStorage 备份、预检本机记录或选取旧 JSON；损坏/未知版本不上传，备份不改写原文。
- 面板逐条展示原始字段、工具/手记数量、新增/跳过数量和同 ID 冲突。完全相同（忽略对象键和记录显示排序）跳过，不同内容的同 ID **阻止整批导入**，需人工整理，不自动覆盖。
- **初始 `import_enabled=false`**：就算勾选复核框，导入按钮也不能使用，服务器同样拒绝导入 RPC。只有你在对话中确认已备份并允许导入后，才在管理端解锁：

  ```sql
  -- 仅获得所有者针对真实旧数据的明确确认后执行，不能自动执行。
  update toollog_private.control set import_enabled=true where singleton;
  ```

- 解锁后重新预检，核对逐条内容，勾选备份与上传确认。请求使用预检的原版本，不暗中合并更新后的云端；事务成功后再读取并比较全部内容。网络中断、冲突或结果不确定时保留备份和本机数据，重新预检后可安全重试；不重复新增已有 ID。
- 本机副本**从不自动删除**。上传完成后可在管理端重新设 `import_enabled=false`；此开关是防误操作护栏，不是对唯一管理员手工调用通用编辑接口的额外隔离。

## 验证

前端：`npm test`、`npm run build`。

临时 PostgreSQL 权限/事务回归（无需 Supabase 凭据、不会访问真实云项目）：

```sh
docker run --name toollog-db -e POSTGRES_HOST_AUTH_METHOD=trust --publish 127.0.0.1:55432:5432 --detach postgres:17-bookworm
docker exec -i toollog-db psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/bootstrap.sql
docker exec -i toollog-db psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/202611210001_cloud.sql
docker exec -i toollog-db psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/security.sql
```

使用本地临时容器与合成 UUID；bootstrap 为 auth.uid()/auth.jwt() 提供最小替身。security 测试在真实 PostgreSQL 上验证 RLS/角色权限、其他用户拒绝、原文、事务回滚、CAS 与导入锁，最后 ROLLBACK；**不等于真实 Supabase Auth/公网 API 或真实 iPhone 验证**。

Supabase 的 API 连接还启用 `safeupdate`，普通 PostgreSQL 镜像没有这个扩展。在本地 Supabase PostgreSQL 的另一个一次性空数据库内，以本地 `supabase_admin` 执行 bootstrap 和迁移后，用 `psql -v ON_ERROR_STOP=1 -f supabase/tests/safeupdate.sql` 再跑同一套回归（须保留旁边的 `security.sql`）。该入口加载实际扩展并显示启用状态，确保保存 RPC 的版本更新有明确行条件；**不能关闭安全更新来绕过失败**。此测试也只使用合成用户，不在托管项目或真实数据上执行。

上线私密预览前还须检查真实项目的所有业务表 RLS、匿名 REST/RPC 的读/写拒绝、非管理员拒绝、管理员登录及两个独立会话同步。两端新增/编辑后刷新重开持久化；实体 iPhone 与桌面模拟结果分开。免费项目可能一周不活跃暂停，没有免费自动数据库备份保障，继续手动导出。
