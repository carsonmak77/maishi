# 更新日志

## v2.1.4 - 2026-09-26

### 新增功能

#### 1. 同一广告位叠加多条广告 + 定时轮播

- **同一位置可投放多条广告**：前台不再只取第一条，同位置的全部启用广告按创建顺序自动轮播（`all` 全站通投同样生效）。
- **轮播时长可配置**：后台广告表单新增 **「轮播时长 (秒)」**（`staySeconds`，默认 5 秒，范围 1~600），轮到哪条按哪条的时长停留。
- **切换带淡入淡出过渡**（250ms），观感平滑不跳动。
- **浮漂广告同样支持多条轮播**：多条「浮动小图」广告在右下角轮流展示，× 关闭按钮一次关闭整个浮漂（本会话不再出现）。
- 计时器管理：重复初始化、关闭浮漂时自动清理定时器，不会产生叠加请求。

### 涉及文件

| 文件 | 改动 |
|------|------|
| `public/js/ads.js` | 同位置多广告收集、轮播调度器（setTimeout 链）、浮漂轮播、淡入淡出 |
| `public/css/style.css` | `.ad-fade-out` 过渡样式、浮漂 `.maishi-float-ad-media` 容器 |
| `server.js` | 广告 API 支持 `staySeconds`（默认 5，范围 1~600 校验） |
| `workers/api.js` | 同上（Cloudflare Workers 版） |
| `admin/index.html` / `admin/js/admin.js` | 轮播时长输入框、回填与保存 |
| `public/img/ad-*-demo-b.png` | 第二组轮播演示图（蓝 banner / 蓝 AD2） |

## v2.1.3 - 2026-09-26

### 新增功能

#### 1. 图片广告三端固定宽高显示

- 后台新建/编辑图片广告时可设置**图片宽度 (px)** 与**图片高度 (px)**，前台在电脑、平板、手机三端统一按固定宽高显示（`object-fit: cover` 裁切填充，不拉伸变形）。
- 留空时按广告格式给默认尺寸：横幅 960×120、矩形 300×250、内联 728×90、浮动小图 120×120。
- 窄屏安全兜底：图片宽度自动不超过屏幕宽度（高度保持固定），避免手机端出现横向滚动。
- 数据字段：广告对象新增 `imgWidth` / `imgHeight`，Express 与 Cloudflare Workers 两套 API 均已支持。

#### 2. 浮漂小图广告（全站漂浮，可关闭）

- 后台投放位置新增 **「浮动小图（全站漂浮）」**（`position: float`），选图片广告类型并填写图片 URL 即可。
- 前台自动在屏幕右下角显示固定定位的小浮窗，三端自适应：桌面按设置尺寸显示，小屏自动收缩（不超过 32vw）并避开底部导航栏与安全区。
- 自带 **× 关闭按钮**（移动端加大热区），点击后立即消失，且**本次会话内不再出现**（sessionStorage 记录）；更换广告后自动重新展示。
- 左下角带"广告"标识，暗色模式自动适配。

### 问题修复

- **修复图片广告无法显示的存量 Bug**：原 `renderAd` 判断 `!ad.content` 即隐藏广告位，而图片广告的 `content` 本来为空，导致图片广告从来不渲染。现改为 `content` 与 `imageUrl` 任一存在即渲染。

### 涉及文件

| 文件 | 改动 |
|------|------|
| `public/js/ads.js` | 固定宽高渲染、浮漂广告模块、图片广告渲染 Bug 修复 |
| `public/css/style.css` | `.ad-img-fixed` 固定尺寸样式、`.maishi-float-ad` 浮漂样式与三端适配 |
| `server.js` | 广告 API 支持 `imgWidth`/`imgHeight`（含默认值与 40–2000 合法性校验） |
| `workers/api.js` | 同上（Cloudflare Workers 版） |
| `admin/index.html` | 广告表单新增宽高输入框、投放位置新增"浮动小图" |
| `admin/js/admin.js` | 表单回填、保存新字段、位置标签 |
| `public/img/ad-*.png` | 内置两张演示图（横幅 / 浮漂），供后台测试用 |

## v2.1.0 - 2026-09-08

### 新增功能

#### 1. 广告管理系统

新增完整的广告位管理功能，支持在网站各关键位置投放广告，可在后台统一管理。

**广告位布局**：

| 广告位标识 | 位置说明 | 推荐格式 |
|-----------|---------|---------|
| `home_top` | 首页顶部横幅（导航栏下方） | Banner (728x90) |
| `home_bottom` | 首页底部横幅（内容区末尾） | Banner |
| `post_top` | 文章详情页顶部（标题上方） | Banner |
| `post_bottom` | 文章详情页底部（评论区上方） | Banner |
| `genealogy_top` | 族谱页顶部（密码验证后） | Banner |
| `friends_top` | 友链页顶部 | Banner |
| `about_top` | 关于页顶部 | Banner |
| `all` | 全站通投（匹配所有位置） | - |

**广告类型**：
- **图片广告**：上传图片 + 跳转链接，点击新窗口打开
- **HTML 代码**：支持粘贴第三方广告代码（如 Google AdSense、联盟广告）
- **文字广告**：纯文字 + 链接，简洁不突兀

**后台管理功能**：
- **统计概览**：广告总数、启用中、已停用、总点击量
- **广告列表**：标题、投放位置、类型、格式、状态、点击量、创建时间
- **新建/编辑**：弹窗表单，支持所有字段配置
- **启用/停用**：一键切换广告状态
- **删除**：删除不需要的广告

**前端特性**：
- 自动扫描页面 `.ad-slot` 元素，匹配对应位置的广告渲染
- 5 分钟前端缓存，减少重复 API 请求
- 带"广告"标识标签，符合广告法规要求
- 支持 Banner / 矩形两种格式的自适应样式
- 暗色模式适配

### 后端新增 API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/ads` | GET | 前台获取所有启用的广告列表 |
| `/api/admin/ads` | GET | 后台获取所有广告（含停用） |
| `/api/admin/ads` | POST | 创建新广告 |
| `/api/admin/ads/:id` | PUT | 更新广告信息 |
| `/api/admin/ads/:id` | DELETE | 删除广告 |

### 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `server.js` | 修改 | 新增广告管理 5 个 API 接口 |
| `workers/api.js` | 修改 | 新增 `handleAds` 函数，广告管理 API 完整实现 |
| `admin/index.html` | 修改 | 新增「广告管理」导航项、广告列表页、编辑弹窗 |
| `admin/js/admin.js` | 修改 | 新增广告管理完整 JS 逻辑（加载/创建/编辑/删除/切换状态） |
| `public/css/style.css` | 修改 | 新增广告位完整样式（含暗色模式适配） |
| `public/js/ads.js` | 新增 | 广告位加载与渲染脚本（自动匹配+缓存+XSS防护） |
| `public/index.html` | 修改 | 新增首页顶部/底部广告位 |
| `public/post.html` | 修改 | 新增文章页顶部/底部广告位 |
| `public/genealogy.html` | 修改 | 新增族谱页顶部广告位 |
| `public/friends.html` | 修改 | 新增友链页顶部广告位 |
| `public/about.html` | 修改 | 新增关于页顶部广告位 |
| `d1/schema.sql` | 修改 | 初始化数据新增 `ads` 空数组 |

---

## v2.0.0 - 2026-08-31

### 重大更新：麦氏乡村定制版

基于 CARSON 博客系统深度定制，专为麦氏乡村家族网站打造，新增族谱大树图谱、乡村主题、联系方式与赞助支持等核心功能。

### 新增功能

#### 1. 族谱大树图谱展示

- **38 位先祖，23 代传承**：从始祖麦铁杖到当代麦邦杰，完整家族世系
- **金字塔布局**：始祖居顶，子嗣向下分叉展开，层级分明
- **SVG 动态连接线**：父子关系用 SVG 贝塞尔曲线连接，美观清晰
- **展开/折叠**：点击人名可展开或折叠其后代，支持全部展开/全部折叠
- **人物详情**：点击卡片查看生辰、配偶、称谓、生平简介等详细信息
- **搜索功能**：搜索族谱人名，高亮匹配结果，自动展开到匹配节点

#### 2. 族谱密码访问保护

- 管理员可设置族谱访问密码和有效期
- 用户可申请访问密码，管理员在后台审核
- 密码过期自动失效，需重新申请

#### 3. 族谱后台管理

- **人物管理**：增删改查族谱人物，支持批量导入
- **简介设置**：标题、副标题、简介文字、默认展开层级
- **密码申请审核**：审核用户的密码访问申请
- **人物提交审核**：用户提交的族谱人物需管理员审核通过后显示

#### 4. 联系方式与赞助支持

- **联系我们**：后台可配置邮箱、微信、QQ、电话、地址
- **赞助支持**：后台可配置赞助描述、微信收款码、支付宝收款码、赞助码
- 关于页面动态渲染，管理员随时修改无需改代码

#### 5. 网站维护模式

- 管理员可在后台开启/关闭维护模式
- 维护模式下普通用户需输入密码访问
- 管理员账号不受维护模式限制
- 可自定义维护提示语

#### 6. 仪表盘审核中心

- 仪表盘集中展示所有待审核项：
  - 族谱人数待审核
  - 族谱密码申请审核
  - 投稿审核
  - 留言审核
  - 友链审核
- 点击卡片直接跳转到对应管理页面

#### 7. 后台快捷操作

- 仪表盘新增快捷操作面板
- 快速发布文章、添加友链、审核留言等常用功能一键直达

### 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `server.js` | 修改 | 新增族谱API、联系/赞助API、维护模式API、审核统计API |
| `workers/api.js` | 修改 | Cloudflare Worker 完整API支持（含族谱、联系赞助、维护模式等） |
| `public/genealogy.html` | 新增 | 族谱大树图谱页面（SVG连接+展开折叠+搜索+密码保护） |
| `public/css/style.css` | 修改 | 族谱样式、关于页联系/赞助样式、维护模式样式 |
| `public/js/genealogy.js` | 新增 | 族谱大树图谱渲染逻辑 |
| `admin/index.html` | 修改 | 新增族谱管理、仪表盘审核中心、快捷操作、维护模式设置 |
| `admin/js/admin.js` | 修改 | 族谱管理、审核中心、快捷操作、维护模式等后台逻辑 |
| `d1/schema.sql` | 修改 | 新增族谱数据、联系赞助设置、维护模式设置等初始化数据 |
| `CHANGELOG.md` | 修改 | 新增 v2.0.0 更新日志 |
| `package.json` | 修改 | 版本号 1.4.0 → 2.0.0，项目名改为麦氏乡村 |

---

## v1.4.0 - 2026-08-22

### 新增功能

#### 1. 用户管理

后台新增「用户管理」页面，支持对前台注册用户的完整管理：

- **用户列表**：分页展示所有注册用户，支持用户名搜索
- **用户信息**：用户名、注册时间、最后登录时间、账号状态
- **账号管理**：添加用户、编辑用户、重置密码、禁用/启用账号、删除用户
- **批量操作**：批量禁用、批量启用、批量删除
- **安全保护**：禁止删除管理员账号；删除用户时自动清理其点赞、收藏、投稿数据
- **禁用登录拦截**：被禁用用户登录时返回错误提示

#### 2. 文章管理增强

- **分页浏览**：支持页码切换、每页数量、首页/末页快捷跳转
- **搜索功能**：按标题、摘要、内容全文搜索，300ms 防抖
- **分类筛选**：下拉选择分类，快速筛选该分类下的文章
- **状态筛选**：全部 / 已发布 / 草稿 三种状态切换
- **批量操作**：批量发布、批量设为草稿、批量置顶、批量取消置顶、批量删除
- **全选/反选**：表头复选框一键全选或取消全选
- **总数统计**：工具栏实时显示当前筛选条件下的文章总数

#### 3. 标签管理

后台新增「标签管理」页面（分类管理之后）：

- **标签列表**：展示所有标签及对应文章数量
- **新增标签**：手动添加标签，支持 20 字符限制
- **重命名标签**：修改标签名称，自动同步更新所有文章中的标签
- **删除标签**：删除标签，自动从所有文章中移除该标签
- **单次遍历统计**：性能优化，一次遍历统计所有标签文章数

#### 4. 媒体库

后台新增「媒体库」页面（缓存管理之后）：

- **文件管理**：集中管理所有已上传的图片文件
- **分类浏览**：按文件夹筛选（全部 / 文章图片 / 友链头像 / 站点资源）
- **网格视图**：缩略图预览 + 文件名 + 大小 + 上传时间
- **文件操作**：复制文件链接、删除文件
- **安全校验**：路径穿越防护，仅允许操作 `/uploads/` 目录下的文件

#### 5. 留言回复功能

- **管理员回复**：后台可对留言进行回复，回复内容同步显示在前台
- **回复管理**：添加回复、修改回复、删除回复
- **回复时间**：记录回复时间戳
- **前台展示**：文章页和主页留言区显示管理员回复

#### 6. 数据备份导出

- **一键导出**：后台网站设置页「数据管理」面板一键导出全部数据
- **导出内容**：文章、分类、标签、留言、用户（不含密码）、友链、设置、点赞、收藏
- **文件格式**：JSON 格式，文件名带时间戳 `carson-blog-backup-YYYYMMDD-HHmmss.json`
- **版本标识**：导出版本号标识，方便后续导入兼容

### 后端新增 API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/admin/users` | GET | 用户列表（搜索+分页） |
| `/api/admin/users` | POST | 创建用户 |
| `/api/admin/users/:id` | PUT | 更新用户（密码/禁用） |
| `/api/admin/users/:id` | DELETE | 删除用户 |
| `/api/admin/users/batch` | POST | 批量操作（删除/禁用/启用） |
| `/api/admin/posts/batch` | POST | 文章批量操作 |
| `/api/admin/comments/batch` | POST | 留言批量操作 |
| `/api/admin/tags` | GET/POST | 标签列表/新增 |
| `/api/admin/tags/:name` | PUT/DELETE | 重命名/删除标签 |
| `/api/admin/media` | GET/DELETE | 媒体库列表/删除文件 |
| `/api/admin/comments/:id/reply` | POST | 添加/更新回复 |
| `/api/admin/comments/:id/reply` | DELETE | 删除回复 |
| `/api/admin/export` | GET | 数据导出下载 |

### 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `server.js` | 修改 | 新增 13 个 API 接口 + 留言 disabled 登录拦截 |
| `admin/index.html` | 修改 | 新增 4 个导航项、4 个页面、多个弹窗 |
| `admin/js/admin.js` | 修改 | 新增 30+ 个管理函数 + 事件绑定 |
| `admin/css/admin.css` | 修改 | 新增用户、标签、媒体库、回复、批量、分页等样式 |
| `public/css/style.css` | 修改 | 留言回复展示样式 |
| `public/js/main.js` | 修改 | 留言渲染支持回复展示 |
| `CHANGELOG.md` | 修改 | 新增 v1.4.0 更新日志 |
| `package.json` | 修改 | 版本号 1.3.0 → 1.4.0 |

---

## v1.3.0 - 2026-08-22

### 新增功能

#### 1. 五种显示模式（后台管理员切换）

在后台「网站设置」页面新增显示模式选择器，提供 5 种可视化预览卡片供管理员切换前台文章列表布局：

| 模式 | 标识值 | 说明 |
|------|--------|------|
| 默认模式 | `default` | 当前封面卡片纵向列表（保留原样式） |
| 传统列表 | `list` | 图文左右排列，封面在左、内容在右 |
| 固定网格卡片 | `grid` | 等大网格排列，封面+标题+摘要 |
| 瀑布流 | `waterfall` | 不等高流式排列（CSS columns，3列/平板2列/手机2列） |
| 杂志混合布局 | `magazine` | 第一篇大图特写+渐变遮罩标题，其余小图网格 |

- 切换后立即生效，前台根据 `displayMode` 字段动态切换容器布局类和渲染函数
- 5 种布局均支持完整响应式适配（桌面/平板/手机）
- 封面图优先级链不变：正文首图 → 文章封面 → 默认封面 → 随机样式占位

#### 2. 深度性能优化（防止网站卡顿）

| 优化项 | 文件 | 说明 |
|--------|------|------|
| statSync 节流 | `server.js` | 2 秒内复用上次 stat 结果，减少高频请求下的磁盘 I/O |
| 缓存键修复 | `server.js` | 缓存键包含查询参数，避免不同分页/分类返回相同缓存 |
| initialDB 崩溃修复 | `server.js` | 修复数据库损坏时引用未定义变量导致服务器崩溃的 P0 Bug |
| sortPostsForList 优化 | `server.js` | 预解析时间戳，避免排序时每次比较创建 Date 对象 |
| 统计接口单次遍历 | `server.js` | `/api/admin/stats` 从 9 次遍历 db.posts 优化为 1 次 |
| 分类计数单次遍历 | `server.js` | `/api/admin/categories` 从 O(n*m) 优化为 O(n+m) |
| N+1 查询消除 | `server.js` | 点赞/收藏/评论列表构建 postId→post 索引 Map，避免线性查找 |
| 浏览量写入优化 | `server.js` | `flushViewIncrements` 构建 postMap 索引，替代每次 find 遍历 |
| 静态文件缓存 | `server.js` | JS/CSS 设置 Cache-Control 头，上传文件 30 天缓存 |
| 请求体限制 | `server.js` | JSON/URLencoded 请求体限制 2MB，防止超大请求 |
| 事件委托修复 | `main.js` | 公告列表从每项绑定改为容器级事件委托，消除内存泄漏 |
| requestAnimationFrame | `main.js` | 文章列表 DOM 更新包裹 rAF，让浏览器批量处理布局变更 |
| 图片懒加载 | `main.js` | 文章正文图片添加 loading=lazy + IntersectionObserver 淡入效果 |
| CSS transition 优化 | `style.css` | 11 处 `transition: all` 替换为具体属性，减少浏览器属性计算 |
| will-change 优化 | `style.css` | 5 个频繁动画元素添加 will-change: transform，提升合成性能 |
| contain 隔离 | `style.css` | 文章卡片添加 contain: layout，隔离布局变化避免兄弟节点 reflow |

### 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `server.js` | 修改 | displayMode 字段、缓存键修复、statSync 节流、N+1 消除、统计优化、initialDB 修复 |
| `public/js/main.js` | 修改 | displayMode state、5 种布局渲染函数、事件委托修复、rAF 优化、图片懒加载 |
| `public/css/style.css` | 修改 | 5 种布局 CSS、transition 优化、will-change、contain |
| `admin/index.html` | 修改 | 显示模式选择器 UI |
| `admin/css/admin.css` | 修改 | 选择器卡片样式和预览图 |
| `admin/js/admin.js` | 修改 | displayMode 加载和保存逻辑 |
| `README.md` | 修改 | 新增显示模式和性能优化说明 |
| `CHANGELOG.md` | 修改 | 新增 v1.3.0 更新日志 |

---

## v1.2.1 - 2026-08-14

### Bug 修复

#### 1. 管理员与普通用户菜单区分（Cloudflare 部署）

- **问题**：Cloudflare Workers 部署后，管理员登录后菜单不显示"后台管理"入口
- **修复**：
  - `workers/api.js`：`/api/user/login`、`/api/user/register`、`/api/user/me` 响应统一返回 `role` 字段
  - `public/js/main.js`：新增 `refreshFrontRole()` 函数，页面加载时异步调用 `/api/user/me` 刷新 role，确保菜单正确渲染

#### 2. 个人中心我的点赞/我的收藏接口（Cloudflare 部署）

- **问题**：Cloudflare Workers 部署缺少点赞/收藏相关 API 接口
- **修复**：
  - `workers/api.js`：新增 `GET /api/user/likes`、`GET /api/user/favorites`、`POST /api/user/likes/:postId`、`POST /api/user/favorites/:postId`、`GET /api/user/interactions` 接口
  - `d1/schema.sql`：初始化数据新增 `likes` 和 `favorites` 数组

#### 3. 主题颜色/语言/暗黑模式设置无效

- **问题**：点击底部工具栏的主题颜色、语言、暗黑模式按钮无响应
- **原因**：`renderProtectedFooter()` 的 MutationObserver 和定时器在特定时序下导致工具栏按钮 DOM 节点被重新创建，原先通过 `addEventListener` 直接绑定的事件监听器丢失
- **修复**：
  - `public/js/toolbar.js`：改用**事件委托**模式，在 `document` 级别统一监听 click 事件，通过 `e.target.closest('button')` 判断点击目标，彻底解决按钮被重建后事件丢失的问题
  - `public/js/toolbar.js`：`applyThemeColor()` 统一使用 `--theme-primary` 系列 CSS 变量，与 anti-flicker 脚本和 CSS 变量链保持一致
  - `public/js/main.js`：`renderProtectedFooter()` 不再替换整个 `footer.innerHTML`，改为只追加/更新版权信息元素，保留工具栏按钮

### 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `workers/api.js` | 修改 | 登录/注册/me 返回 role；新增点赞/收藏 API 接口 |
| `d1/schema.sql` | 修改 | 初始化数据新增 likes/favorites 数组 |
| `public/js/toolbar.js` | 修改 | 事件委托替代直接绑定；CSS 变量统一 |
| `public/js/main.js` | 修改 | 新增 refreshFrontRole()；renderProtectedFooter() 保留工具栏按钮 |
| `server.js` | 修改 | 注册接口返回 role 字段 |

---

## v1.2.0 - 2026-08-14

### 新增功能

#### 1. 后台 Cloudflare 缓存管理（无需登录 Cloudflare 控制台）

- **服务端**（`server.js`）：新增 4 个 API 接口
  - `GET /api/admin/cloudflare/config` — 获取 Cloudflare API Token 和 Zone ID 配置
  - `POST /api/admin/cloudflare/config` — 保存 Cloudflare 配置（加密存储在 db.json）
  - `POST /api/admin/cloudflare/purge` — 清除 Cloudflare 边缘缓存（purge everything 或按 URL）
  - `POST /api/admin/cache/purge-all` — 一键清除本地缓存 + Cloudflare 边缘缓存

- **后台管理面板**（`admin/index.html` + `admin/js/admin.js`）：
  - 缓存管理页面新增"一键缓存清除"面板，点击按钮同时清除本地和 Cloudflare 缓存
  - 新增 Cloudflare 配置面板：可填写 API Token 和 Zone ID，保存后直接在后台清除边缘缓存
  - 支持代理环境（自动检测 HTTPS_PROXY 环境变量），适配沙箱/内网部署
  - 清除结果显示本地清除条数和 Cloudflare 清除状态

#### 2. 登录角色区分功能

- **服务端**（`server.js`）：
  - `/api/user/login` 响应新增 `role` 字段：管理员返回 `role: "admin"`，普通用户返回 `role: "user"`
  - `/api/user/me` 响应也返回 `role`，便于前端刷新页面后恢复角色状态

- **前端**（`main.js`）：
  - 登录/注册时将 `role` 存入 `localStorage.frontRole`
  - 点击头像下拉菜单根据角色动态渲染：
    - **管理员**：个人中心 + 后台管理 + 退出
    - **普通用户**：个人中心 + 退出（不显示后台管理入口）
  - 退出登录和 token 过期时同步清除 `frontRole`

#### 3. 网站性能优化（防止访问卡顿）

| 优化项 | 说明 |
|--------|------|
| Gzip 压缩 | 使用 `compression` 中间件覆盖所有响应（API + 静态文件），CSS 压缩率 80.8%，JS 76.9% |
| 内存数据库缓存 | 通过 mtime 检测文件变化，避免每次请求读磁盘解析 JSON |
| API 响应缓存 | 只读 GET 请求缓存 60 秒，重复请求响应时间降至 1-2ms |
| 浏览量批量写入 | 每 5 秒批量写盘，避免每次文章访问触发磁盘 I/O |
| 脚本 defer 加载 | 所有 HTML 外部脚本加 `defer`，不阻塞页面渲染 |
| 并行 API 加载 | 首页公告/分类/文章用 `Promise.all` 并行请求 |
| 事件委托 | 文章卡片/分类标签/点赞收藏列表改用容器级委托 |
| 搜索防抖 | 输入搜索加 400ms 防抖，避免每次按键发请求 |
| MutationObserver 优化 | 从监听整个 body 子树改为仅监听 footer + 轻量定时器 |

### 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `server.js` | 修改 | 新增 Cloudflare 缓存管理 API、登录返回 role、compression 压缩中间件 |
| `public/js/main.js` | 修改 | 角色区分菜单、并行加载、事件委托、搜索防抖、MutationObserver 优化 |
| `public/*.html` (8个) | 修改 | 所有脚本标签添加 defer 属性 |
| `admin/index.html` | 修改 | 缓存管理页面新增 Cloudflare 配置和一键清除面板 |
| `admin/js/admin.js` | 修改 | 新增 Cloudflare 配置加载/保存/清除功能 |
| `package.json` | 修改 | 新增 compression 和 https-proxy-agent 依赖 |
| `CLOUDFLARE_DEPLOY.md` | 修改 | 新增后台缓存管理功能说明 |
| `CHANGELOG.md` | 修改 | 新增 v1.2.0 更新日志 |

---

## v1.1.0 - 2026-08-13

### 新增功能

#### 1. 个人中心点赞/收藏/分享功能

- **后端 API**（`server.js`）：新增 5 个接口
  - `GET /api/user/interactions` — 获取当前用户的点赞/收藏 ID 列表
  - `POST /api/user/likes/:postId` — 切换点赞（已赞则取消，未赞则点赞）
  - `POST /api/user/favorites/:postId` — 切换收藏
  - `GET /api/user/likes` — 获取用户点赞的文章列表
  - `GET /api/user/favorites` — 获取用户收藏的文章列表

- **前端交互**（`main.js`）：
  - 登录用户：点赞/收藏实时同步到服务器，文章详情页打开时从服务器加载初始状态
  - 未登录用户：使用 localStorage 保存点赞/收藏，并提示"登录后可在个人中心查看记录"
  - 登录后自动检测 localStorage 中的本地点赞/收藏，合并同步到服务器
  - 分享功能：优先调用浏览器原生分享 API，不支持时复制链接到剪贴板

- **个人中心页面**（`profile.html`）：
  - 新增"我的点赞"展示区，展示用户点赞过的文章列表
  - 新增"我的收藏"展示区，展示用户收藏过的文章列表
  - 每个区域有独立刷新按钮，卡片带"赞"/"藏"角标
  - 点击卡片可跳转到文章详情页
  - 补全底部工具栏和主题/语言切换功能

#### 2. 品牌更名：微信博客 → CARSON博客系统

- `README.md`：标题和描述更新为 CARSON博客系统
- `package.json` / `package-lock.json`：项目名 `wechat-blog` → `carson-blog`
- `wrangler.toml`：Worker 名称、D1 数据库名、R2 Bucket 名全部更新
- `CLOUDFLARE_DEPLOY.md`：部署命令中的资源名称更新
- `server.js`：启动提示信息、JWT 密钥默认值更新
- `workers/api.js`：JWT 密钥默认值更新
- `index.html`：meta description 更新为 CARSON 品牌

#### 3. 主题/语言/暗黑模式默认值

- 主题颜色默认为绿色（`#07C160`）
- 语言默认为中文
- 暗黑模式默认为白天
- 全部 8 个 HTML 页面 `<head>` 中添加防闪烁内联脚本，页面渲染前立即应用设置

### Bug 修复

#### 高优先级

| 修复项 | 文件 | 问题 | 方案 |
|--------|------|------|------|
| 状态同步 | `main.js` | `syncInteractionStatus` 中 `data.likedPostIds` 未做 null 检查，API 返回异常时抛 TypeError | 添加 `\|\| []` 防御 |
| 认证处理 | `main.js` | `toggleLikeServer`/`toggleFavoriteServer` 未调用 `handleAuthError`，令牌过期不跳转登录 | catch 块中加入 `handleAuthError` 检查 |
| 本地点赞丢失 | `main.js` | 登录前 localStorage 中的点赞/收藏在登录后被服务器数据覆盖 | `syncInteractionStatus` 自动检测并同步 localStorage 到服务器 |
| 状态脱节 | `main.js` | 服务器切换点赞/收藏后不同步 localStorage | 新增 `updateLocalInteraction` 函数，操作成功后同步写入 |
| 数据库崩溃 | `server.js` | `loadDB` 的 `JSON.parse` 无 try-catch，DB 文件损坏导致全站崩溃 | 添加 try-catch，损坏时自动备份并重建 |
| 数据损坏 | `server.js` | `saveDB` 非原子写入，进程崩溃时数据损坏 | 改为先写临时文件再 rename 原子写入 |

#### 中优先级

| 修复项 | 文件 | 问题 | 方案 |
|--------|------|------|------|
| 缓存错误响应 | `server.js` | 缓存中间件缓存 404/500 错误响应 | 仅在 `statusCode === 200` 时缓存 |
| 全局错误处理 | `server.js` | 无全局错误处理器，未捕获异常返回 HTML | 添加 `app.use(err, ...)` 返回 JSON |
| 404 兜底 | `server.js` | 无 404 兜底路由 | API 返回 JSON，其他返回 index.html |
| 文章下架校验 | `server.js` | 点赞/收藏接口未校验文章 `published` 状态 | 添加 `published === false` 时返回 403 |
| 下架文章过滤 | `server.js` | 点赞/收藏列表返回已下架文章 | 过滤 `published !== false` |
| 变量遮蔽 | `main.js` | 4 处回调参数 `t` 遮蔽全局翻译函数 `t()` | 重命名为 `tag` / `el` |

#### 低优先级

| 修复项 | 文件 | 问题 | 方案 |
|--------|------|------|------|
| 移动端布局 | `style.css` | `.interaction-item` 缺少移动端响应式规则 | 添加 `flex-direction: column` |
| 认证跳转 | `main.js` | 个人中心入口只检查用户名不检查令牌 | 同时检查 `frontToken` 和 `frontUsername` |
| 登录过期 | `main.js` | 令牌过期只显示错误不跳转 | 新增 `handleAuthError` 统一处理，自动清除并跳转 |

### 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `server.js` | 修改 | 新增点赞/收藏 API、数据库迁移、错误处理、原子写入、缓存修复 |
| `public/js/main.js` | 修改 | 点赞/收藏交互、状态同步、认证处理、变量遮蔽修复 |
| `public/profile.html` | 修改 | 新增点赞/收藏展示区、底部工具栏、toolbar.js |
| `public/css/style.css` | 修改 | 新增 interaction-item 样式、移动端响应式 |
| `public/js/toolbar.js` | 修改 | 新增点赞/收藏相关 i18n 翻译文案 |
| `public/index.html` | 修改 | meta description 更新为 CARSON 品牌 |
| `public/*.html` (8个) | 修改 | 全部添加防闪烁内联脚本 |
| `README.md` | 重写 | 完整功能列表、项目结构、技术特性说明 |
| `CLOUDFLARE_DEPLOY.md` | 修改 | 资源名称 wechat-blog → carson-blog |
| `package.json` | 修改 | 项目名和描述更新 |
| `package-lock.json` | 修改 | 项目名更新 |
| `wrangler.toml` | 修改 | Worker/D1/R2 名称更新 |
| `workers/api.js` | 修改 | JWT 密钥默认值更新 |
| `CHANGELOG.md` | 新增 | 本次更新日志 |
