# Cloudflare 部署完整教程

本仓库已包含 Cloudflare Worker 版本，可以从 GitHub 部署到 Cloudflare，并使用 D1 保存站点数据、R2 保存上传图片。原本的 Node.js/Express 版本仍可本地运行，Cloudflare 部署使用 `workers/api.js`。

本教程包含三种部署方式：
- **方式一**：Cloudflare Workers Builds（GitHub 自动部署，推荐）
- **方式二**：GitHub Actions CI/CD（自定义工作流自动部署）
- **方式三**：本地 Wrangler 手动部署

---

## 已支持功能

- 前台文章列表、文章详情、分类筛选、搜索、公告、关于页、友链、留言。
- 文章点赞、收藏、分享功能，个人中心查看点赞/收藏记录。
- 后台登录、文章管理、分类管理、投稿审核、友链审核、留言审核、站点设置。
- **后台缓存管理**：在后台直接清除本地缓存和 Cloudflare 边缘缓存，无需登录 Cloudflare 控制台。
- **登录角色区分**：管理员登录显示个人中心+后台管理+退出，普通用户只显示个人中心+退出。
- **性能优化**：Gzip 压缩、内存数据库缓存、API 响应缓存、浏览量批量写入、脚本 defer 加载、并行 API 请求、事件委托、搜索防抖。
- **族谱大树图谱展示**（38位先祖，23代传承，金字塔布局，SVG连接线，展开/折叠）。
- **族谱密码访问保护 + 用户申请访问 + 管理员审核**。
- **族谱搜索功能**。
- **用户提交族谱人物 + 管理员审核**。
- **网站维护模式**（密码保护，管理员开关）。
- **后台族谱管理**（增删改查、简介设置、密码申请审核）。
- **广告管理系统**：8 个预设广告位，支持图片/HTML/文字三种广告类型，后台统一管理，点击量统计。
- D1 替代 `data/db.json`，R2 替代本地 `uploads/`。
- 管理员账号密码在部署时自定义，不再写死到代码里。

---

## 族谱功能说明

- 大树图谱布局：始祖居顶，子嗣向下分叉展开，SVG动态绘制连接线
- 点击人物卡片查看详细信息（生辰、配偶、称谓、生平简介）
- 支持全部展开/全部折叠
- 搜索族谱人名，高亮匹配结果
- 密码访问保护，管理员可设置访问密码和有效期
- 用户可申请访问密码，管理员在后台审核
- 登录用户可提交族谱人物，管理员审核后显示

---

## 维护模式说明

- 管理员可在后台开启/关闭维护模式
- 维护模式下普通用户需要输入密码才能访问
- 管理员账号不受维护模式限制
- 可自定义维护提示语

---

## 后台管理功能

- 文章管理（增删改查、分类管理、投稿审核）
- 友链管理、留言审核、站点设置
- 缓存管理（本地缓存 + Cloudflare 边缘缓存）
- **族谱人物管理**（增删改查、批量导入）
- **族谱简介设置**（标题、副标题、简介文字、默认展开层级）
- **族谱密码申请审核**
- **广告管理**（广告位投放、图片/HTML/文字三种类型、启用停用、点击量统计）
- **维护模式设置**

---

## 后台缓存管理（v1.2.0 新增）

部署到 Cloudflare 后，可以直接在后台管理面板清除 Cloudflare 边缘缓存，无需登录 Cloudflare 控制台。

### 配置步骤

1. 登录后台管理（`/admin`），点击左侧菜单 **缓存管理**。
2. 在 **Cloudflare 缓存配置** 面板中填写：
   - **API Token**：在 [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) 创建，权限选择 `Zone - Cache Purge - Purge`。
   - **Zone ID**：在 Cloudflare 网站概览页面右下角找到。
3. 点击 **保存配置**。

### 使用方式

- **一键清除全部缓存**：点击顶部"一键清除全部缓存"按钮，同时清除本地服务器缓存和 Cloudflare 边缘缓存。
- **单独清除 Cloudflare 缓存**：点击"测试清除 Cloudflare 缓存"按钮，仅清除 Cloudflare 边缘缓存。
- **分类清除本地缓存**：可按文章/留言/友链/设置分类清除本地服务器缓存。
- **查看缓存状态**：实时查看缓存条目数量和过期时间。

### API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/admin/cloudflare/config` | GET | 获取 Cloudflare 配置 |
| `/api/admin/cloudflare/config` | POST | 保存 Cloudflare 配置 |
| `/api/admin/cloudflare/purge` | POST | 清除 Cloudflare 边缘缓存 |
| `/api/admin/cache/purge-all` | POST | 一键清除本地 + Cloudflare 缓存 |
| `/api/admin/cache/stats` | GET | 查看本地缓存统计 |
| `/api/admin/cache/clear` | POST | 分类清除本地缓存 |

---

## 登录角色区分（v1.2.0 新增）

- **管理员登录**：头像下拉菜单显示「个人中心」「后台管理」「退出」三个选项。
- **普通用户登录**：头像下拉菜单只显示「个人中心」「退出」两个选项。
- 服务端 `/api/user/login` 返回 `role` 字段（`admin` 或 `user`），前端存储并据此渲染菜单。

---

## 性能优化（v1.2.0 新增）

| 优化项 | 效果 |
|--------|------|
| Gzip 压缩 | CSS 压缩率 80.8%，JS 76.9%，HTML 65.1% |
| 内存数据库缓存 | 避免每次请求读磁盘 |
| API 响应缓存 | 重复请求响应 1-2ms |
| 浏览量批量写入 | 每 5 秒批量写盘 |
| 脚本 defer 加载 | 不阻塞页面渲染 |
| 并行 API 加载 | 首页加载速度提升 |
| 事件委托 | 减少 DOM 事件监听器数量 |
| 搜索防抖 | 避免每次按键发请求 |

---

## 文件说明

| 文件 | 说明 |
|------|------|
| `workers/api.js` | Cloudflare Worker 入口，处理 `/api/*`、`/uploads/*` 和静态页面，包含族谱API、维护模式API、广告管理API |
| `d1/schema.sql` | D1 数据库初始化表结构和默认数据（含族谱人物、广告数据结构） |
| `scripts/build-cloudflare.js` | 把 `public/` 和 `admin/` 打包到 `dist/` |
| `wrangler.toml` | Worker、Assets、D1、R2 绑定配置 |

---

## 第一步：本地准备

### 1.1 安装依赖

```bash
npm install
```

### 1.2 语法检查

```bash
npm run check
```

确认输出无报错。

### 1.3 构建静态资源

```bash
npm run build:cf
```

构建后 `dist/` 目录包含打包好的前台和后台静态文件。Cloudflare Worker 会通过 Assets 绑定托管这些文件。

---

## 第二步：推送到 GitHub

### 2.1 创建 GitHub 仓库

在 GitHub 上新建一个仓库（public 或 private 均可），例如 `maishi`。

### 2.2 初始化并推送

```bash
git init
git add .
git commit -m "init maishi"
git branch -M main
git remote add origin https://github.com/你的用户名/maishi.git
git push -u origin main
```

> 确保 `wrangler.toml` 中的 `database_id` 此时还是占位符（不要把真实 ID 提交到公开仓库），后面会在 Cloudflare 控制台或通过 Secret 配置。

---

## 第三步：创建 Cloudflare 资源

### 3.1 登录 Cloudflare

```bash
npx wrangler login
```

浏览器会打开 Cloudflare 授权页面，点击允许。

### 3.2 创建 D1 数据库

```bash
npx wrangler d1 create maishi-db
```

命令会输出类似：

```
✅ Successfully created DB 'maishi-db'
[[d1_databases]]
binding = "DB"
database_name = "maishi-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   ← 复制这个 ID
```

### 3.3 填入 database_id

打开 `wrangler.toml`，把 `database_id` 替换为上一步返回的真实值：

```toml
[[d1_databases]]
binding = "DB"
database_name = "maishi-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

提交更新到 GitHub：

```bash
git add wrangler.toml
git commit -m "config: set D1 database_id"
git push
```

### 3.4 初始化 D1 表结构

```bash
npx wrangler d1 execute maishi-db --remote --file=d1/schema.sql
```

`d1/schema.sql` 已包含麦氏文章、族谱数据、所有设置，执行后直接有完整数据，无需额外导入。

验证初始化成功：

```bash
npx wrangler d1 execute maishi-db --remote --command="SELECT COUNT(*) FROM posts"
```

验证族谱数据：

```bash
npx wrangler d1 execute maishi-db --remote --command="SELECT COUNT(*) FROM genealogy_people"
```

### 3.5 创建 R2 Bucket

```bash
npx wrangler r2 bucket create maishi-uploads
```

`wrangler.toml` 中已预配置好绑定：

```toml
[[r2_buckets]]
binding = "UPLOADS"
bucket_name = "maishi-uploads"
```

---

## 第四步：设置管理员密码和密钥

管理员用户名已在 `wrangler.toml` 中配置（默认 `admin`）。密码和 JWT 密钥用 Secret 设置，不会提交到 GitHub：

```bash
npx wrangler secret put ADMIN_PASSWORD
# 按提示输入管理员密码，例如：MySecurePass2026

npx wrangler secret put JWT_SECRET
# 按提示输入随机密钥，例如：maishi-jwt-secret-2026-xyz
```

> 如果使用方式一（Workers Builds），Secret 需要在 Cloudflare 控制台中设置。详见方式一第 5 步。

---

## 方式一：Cloudflare Workers Builds（GitHub 自动部署，推荐）

这是 Cloudflare 官方提供的 GitHub 集成功能。连接 GitHub 仓库后，每次 `git push` 到 `main` 分支都会自动构建并部署到 Cloudflare Workers [$TRAE_REF](https://developers.cloudflare.com/workers/ci-cd/builds/)。

### 1. 进入 Workers & Pages

登录 [Cloudflare 控制台](https://dash.cloudflare.com/)，左侧菜单进入 **Workers & Pages**。

### 2. 创建应用

点击 **Create application** → 选择 **Import a repository** → 点击 **Get started**。

### 3. 连接 GitHub

1. 选择你的 **Git 账户**（首次使用会弹出 GitHub 授权页面，授权 Cloudflare 访问你的仓库）。
2. 在仓库列表中搜索并选择 `maishi` 仓库。
3. 如果列表中没有，点击 **Configure GitHub App** 添加仓库访问权限。

### 4. 配置构建设置

| 设置项 | 填写内容 |
|--------|----------|
| **Project name** | `maishi`（必须与 `wrangler.toml` 中 `name` 一致） |
| **Production branch** | `main` |
| **Build command** | `npm install && npm run build:cf` |
| **Deploy command** | `npx wrangler deploy` |
| **Root directory** | 留空（项目根目录） |

> **重要**：Worker 名称必须与 `wrangler.toml` 中的 `name` 字段一致，否则构建会失败 [$TRAE_REF](https://developers.cloudflare.com/workers/ci-cd/builds/)。

### 5. 设置 Secrets

在构建配置页面下方找到 **Environment variables** 或在部署后到 **Settings → Variables and Secrets** 中添加：

| 类型 | 变量名 | 值 |
|------|--------|-----|
| Secret | `ADMIN_PASSWORD` | 你的管理员密码 |
| Secret | `JWT_SECRET` | 你的 JWT 密钥 |

### 6. 保存并部署

点击 **Save and Deploy**。Cloudflare 会：
1. 拉取 GitHub 仓库代码
2. 执行 `npm install` 安装依赖
3. 执行 `npm run build:cf` 构建静态资源
4. 执行 `npx wrangler deploy` 部署 Worker

### 7. 查看部署结果

部署成功后，在 Worker 详情页可以看到：
- **workers.dev 地址**：`https://maishi.你的子域.workers.dev`
- **构建历史**：在 **Deployments** 标签页底部查看 **View build history**

### 8. 自动部署验证

之后每次你 `git push` 到 `main` 分支，Cloudflare 会自动触发构建和部署：

```bash
# 修改代码后
git add .
git commit -m "update: 修改内容"
git push
# Cloudflare 自动构建部署，无需手动操作
```

你可以在 Cloudflare 控制台 **Deployments** 标签页实时查看构建状态和日志。

### 9. 非生产分支预览

如果推送代码到非 `main` 分支（如 `dev`），Cloudflare 会生成预览版本，不会影响生产环境 [$TRAE_REF](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)：

```bash
git checkout -b dev
# 修改代码
git push origin dev
# Cloudflare 自动构建预览版本，生成预览 URL
```

---

## 方式二：GitHub Actions CI/CD（自定义工作流自动部署）

如果你想完全控制部署流程，可以使用 GitHub Actions 配合 Wrangler Action [$TRAE_REF](https://github.com/cloudflare/wrangler-action) 实现自动部署。

### 1. 创建 API Token

在 [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) 页面创建一个 token，权限设置为：

| 权限范围 | 权限 |
|----------|------|
| Account - Account Settings | Read |
| Account - Workers Scripts | Edit |
| Account - Workers KV Storage | Edit |
| Account - Workers R2 Storage | Edit |
| Account - D1 | Edit |
| Zone - Workers Routes | Edit |

创建后复制 Token 值。

### 2. 添加 GitHub Secrets

在 GitHub 仓库 **Settings → Secrets and variables → Actions** 中添加：

| Secret 名 | 值 |
|-----------|-----|
| `CLOUDFLARE_API_TOKEN` | 上一步创建的 API Token |
| `CLOUDFLARE_ACCOUNT_ID` | 你的 Cloudflare Account ID（在控制台右侧栏可见） |
| `ADMIN_PASSWORD` | 管理员密码 |
| `JWT_SECRET` | JWT 密钥 |

### 3. 创建工作流文件

在项目根目录创建 `.github/workflows/deploy.yml`：

```yaml
name: Deploy to Cloudflare Workers

on:
  push:
    branches:
      - main
  workflow_dispatch:  # 也支持手动触发

jobs:
  deploy:
    runs-on: ubuntu-latest
    name: Build and Deploy
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build static assets
        run: npm run build:cf

      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy

      - name: Set ADMIN_PASSWORD secret
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: secret put ADMIN_PASSWORD
          environment: production
        env:
          CLOUDFLARE_SECRET_INPUT: ${{ secrets.ADMIN_PASSWORD }}

      - name: Set JWT_SECRET secret
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: secret put JWT_SECRET
          environment: production
        env:
          CLOUDFLARE_SECRET_INPUT: ${{ secrets.JWT_SECRET }}
```

### 4. 提交并推送

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add Cloudflare Workers auto deploy workflow"
git push
```

### 5. 查看部署状态

在 GitHub 仓库的 **Actions** 标签页可以查看每次部署的执行状态和日志。

### 6. 手动触发部署

也可以在 GitHub 的 **Actions → Deploy to Cloudflare Workers → Run workflow** 手动触发部署。

### 自动部署流程

```
git push → GitHub Actions 触发 → npm ci → npm run build:cf → wrangler deploy → 部署完成
```

每次推送到 `main` 分支自动执行，无需手动操作 [$TRAE_REF](https://ubitools.com/cloudflare-wrangler-guide/)。

---

## 方式三：本地 Wrangler 手动部署

适合首次部署或调试。

### 1. 确保资源已创建

确认第三步（D1、R2）和第四步（Secrets）已完成。

### 2. 构建并部署

```bash
npm run build:cf
npx wrangler deploy
```

### 3. 查看部署信息

```bash
npx wrangler deployments list
```

---

## 绑定自定义域名

### 通过 Cloudflare 控制台

1. 在 Worker 详情页 → **Settings** → **Domains & Routes**。
2. 点击 **Add Custom Domain**。
3. 输入你的域名（如 `blog.yoursite.com`），该域名需已托管在 Cloudflare。
4. Cloudflare 会自动添加 DNS 记录，几分钟后生效。

### 通过 wrangler.toml

```toml
routes = [
  { pattern = "blog.yoursite.com/*", custom_domain = true }
]
```

---

## 本地预览 Worker

本地预览 Worker 完整版：

```bash
npm run build:cf
npx wrangler dev --remote
```

`--remote` 参数使用远程 D1 和 R2 资源。不加 `--remote` 则使用本地模拟环境（需要 `wrangler dev` 自动创建的本地 D1 副本）。

---

## 数据迁移

### 从本地 db.json 迁移到 D1

如果本地已有 `data/db.json`` 数据，需要迁移到 D1：

1. 读取本地 `db.json` 内容。
2. 转义为 SQL 语句：

```sql
UPDATE app_data
SET data = '这里放转义后的 db.json 内容',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'main';
```

3. 执行导入：

```bash
npx wrangler d1 execute maishi-db --remote --command="UPDATE app_data SET data = '...' WHERE key = 'main'"
```

如果内容较多，建议编写脚本读取 `data/db.json` 后调用 D1 REST API 或 `wrangler d1 execute` 分批导入。

---

## 常见问题排查

### 构建失败：Worker name 不匹配

**错误**：`Worker name in the dashboard does not match the name in wrangler.toml`

**解决**：确保 Cloudflare 控制台中的 Worker 名称与 `wrangler.toml` 中 `name = "maishi"` 完全一致 [$TRAE_REF](https://developers.cloudflare.com/workers/ci-cd/builds/)。

### 部署失败：database_id 未设置

**错误**：`D1_ERROR: database not found` 或 `database_id is a placeholder`

**解决**：按第三步 3.3 节填入真实的 `database_id` 并提交到 GitHub。

### 登录后台提示密码错误

**原因**：Secret 未正确设置。

**解决**：
- 方式一（Workers Builds）：在 Cloudflare 控制台 **Settings → Variables and Secrets** 中确认 `ADMIN_PASSWORD` 和 `JWT_SECRET` 已设置。
- 方式三（本地部署）：重新执行 `npx wrangler secret put ADMIN_PASSWORD`。

### R2 上传图片失败

**检查**：
1. 确认 R2 Bucket `maishi-uploads` 已创建。
2. 确认 `wrangler.toml` 中 R2 绑定配置正确。
3. R2 图片通过 Worker 的 `/uploads/*` 代理访问，不需要单独公开 Bucket。

### 自动部署未触发

**检查**：
1. GitHub 仓库 **Settings → Actions** 确认工作流未被禁用。
2. 方式一：在 Cloudflare 控制台确认 Worker → **Settings → Builds** 中已连接仓库且分支为 `main`。
3. 方式二：确认 `.github/workflows/deploy.yml` 在 `main` 分支上。

### D1 数据库初始化失败

```bash
# 查看远程 D1 表
npx wrangler d1 execute maishi-db --remote --command=".tables"

# 查看文章数
npx wrangler d1 execute maishi-db --remote --command="SELECT COUNT(*) as count FROM posts"

# 重新初始化（会覆盖现有数据）
npx wrangler d1 execute maishi-db --remote --file=d1/schema.sql
```

### 族谱页面显示空白或报错

**检查**：
1. 确认 D1 数据库已初始化，`genealogy_people` 表存在且有数据。
2. 执行 `npx wrangler d1 execute maishi-db --remote --command="SELECT COUNT(*) FROM genealogy_people"` 验证数据量。
3. 如果表不存在，重新执行 `npx wrangler d1 execute maishi-db --remote --file=d1/schema.sql`。

### 族谱密码访问不生效

**检查**：
1. 在后台 **族谱管理 → 简介设置** 中确认已开启密码保护并设置了访问密码。
2. 确认密码有效期设置正确，如设为 0 表示永久有效。
3. 清除浏览器缓存后重新访问族谱页面。

### 维护模式开启后仍可正常访问

**说明**：
- 管理员账号登录后不受维护模式限制，可以正常访问全站。
- 普通用户或未登录用户会看到维护模式提示页，需要输入维护密码才能访问。

**检查**：
1. 确认当前登录账号是否为管理员，管理员不受维护模式限制。
2. 在后台 **维护模式设置** 中确认维护模式开关已打开且密码已设置。
3. 尝试退出登录后访问前台页面，验证维护模式是否生效。

### 用户提交的族谱人物不显示

**原因**：用户提交的族谱人物需要管理员审核后才会在前台显示。

**解决**：
1. 登录后台管理，进入 **族谱管理 → 人物审核**。
2. 找到待审核的人物条目，点击审核通过或驳回。
3. 审核通过后该人物会自动显示在族谱图谱中。

---

## 注意事项

- `wrangler.toml` 中的 `database_id` 替换为真实值后可以提交到 GitHub（它不是敏感信息，只是一个资源标识符）。
- **绝对不要**把真实的 `ADMIN_PASSWORD` 和 `JWT_SECRET` 写入 `wrangler.toml` 或提交到 GitHub。
- R2 图片通过 Worker 的 `/uploads/*` 代理访问，不需要单独公开 Bucket。
- Cloudflare Worker 版本不使用 Express、bcrypt 或本地磁盘，部署后数据以 D1/R2 为准。
- Workers 免费版每天有 100,000 次请求限制，超出需要升级到 Workers Paid 计划。
- D1 免费版每天有 5,000,000 行读取限制，R2 免费版有 10GB 存储限制。
