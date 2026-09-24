const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const http = require('http');
const app = express();
const PORT = process.env.PORT || 3000;

// ===== 性能优化：响应头中间件 =====
// 生产环境移除 X-Powered-By，减少信息泄露并节省字节
app.disable('x-powered-by');
// ==================================

// 中间件
// 调试：记录所有 /api/ 请求及响应状态
app.use(function (req, res, next) {
  if (req.path.startsWith('/api/')) {
    var start = Date.now();
    res.on('finish', function () {
      if (res.statusCode >= 400) {
        console.log('[WARN]', req.method, req.url, '→', res.statusCode, '(' + (Date.now() - start) + 'ms)');
      }
    });
  }
  next();
});

app.use(cors());
// 压缩：level 6 是速度与压缩比的最佳平衡点（level 9 慢3倍但体积仅小几个百分点）
app.use(compression({ threshold: 512, level: 6, memLevel: 8 }));

// 修复：浏览器有时会发送未编码的中文字符（如分类标签），导致 Express URL 解析返回 400
// 此中间件将 URL 中未编码的多字节字符转为 percent-encoding
app.use(function (req, res, next) {
  try {
    var rawUrl = req.url;
    // 检测是否包含非 ASCII 字符（可能未编码的中文字符）
    if (/[^\x00-\x7F]/.test(rawUrl)) {
      // 保留 query 前的 ? 和 & = 等分隔符，仅对值中的非 ASCII 字符编码
      var encoded = rawUrl.replace(/[^\x00-\x7F]+/g, function (m) {
        return encodeURIComponent(m);
      });
      req.url = encoded;
    }
  } catch (e) { /* 忽略编码错误，交给后续处理 */ }
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ===== 性能优化：安全头 + 缓存控制 =====
app.use(function (req, res, next) {
  // 安全头（减少攻击面，不影响性能）
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // DNS 预取，加速后续资源加载
  res.setHeader('X-DNS-Prefetch-Control', 'on');
  next();
});
// ==================================

// ===== 性能优化：简单的 API 限流（防止爬虫/攻击导致卡顿） =====
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 分钟窗口
const RATE_LIMIT_MAX = 120; // 每分钟最多 120 次请求（约 2 次/秒，正常浏览完全够用）
function rateLimitMiddleware(req, res, next) {
  // 仅限制 API 请求，不限静态资源
  if (!req.path.startsWith('/api/')) return next();
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return next();
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }
  next();
}
// 定期清理过期的限流记录，防止内存泄漏
setInterval(function () {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW) {
      rateLimitMap.delete(ip);
    }
  }
}, 5 * 60 * 1000).unref(); // 不阻塞进程退出
app.use(rateLimitMiddleware);
// ==================================

// ===== 维护模式中间件 =====
// 开启后普通用户需要密码才能访问，管理员不受影响
app.use(maintenanceMiddleware);
// ==================================

// ===== 性能优化：静态资源缓存升级 =====
// 通用静态资源配置
const staticOpts = {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : '0',
  etag: true,
  lastModified: true,
  setHeaders: function (res, filePath) {
    // JS/CSS 文件启用强缓存 + immutable（通过 URL 版本号控制更新）
    if (filePath.endsWith('.css') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
    }
    // HTML 文件启用 ETag 协商缓存（而非 no-store），减少重复传输
    if (filePath.endsWith('.html') || filePath.endsWith('.htm')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
};
app.use('/admin', express.static(path.join(__dirname, 'admin'), staticOpts));

// 上传目录：文件名带时间戳+随机 hash，可安全使用 immutable 缓存
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: '365d',
  etag: true,
  lastModified: true,
  immutable: true,
  setHeaders: function (res, filePath) {
    // 图片等静态资源使用强缓存 + immutable
    if (/\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=2592000'); // 30 天兜底
    }
  }
}));
app.use(express.static(path.join(__dirname, 'public'), staticOpts));
// ======================================

// ============ 缓存层 ============
// ===== 性能优化：LRU 缓存 + stale-while-revalidate + 粒度化失效 =====
// 使用双向链表 + Map 实现 LRU 缓存，限制最大条目数，防止内存膨胀
// 支持 stale-while-revalidate：过期后仍返回旧数据，同时后台异步刷新
// 支持按标签/分类的细粒度缓存失效

const CACHE_TTL = 60 * 1000;        // 默认缓存 60 秒
const CACHE_MAX_SIZE = 200;         // 最大缓存条目数（LRU 淘汰）
const CACHE_SWR_WINDOW = 30 * 1000; // SWR 窗口：过期后 30 秒内仍可返回 stale 数据

// LRU 缓存节点结构（双向链表）
function CacheNode(key, data, expireAt) {
  this.key = key;
  this.data = data;
  this.expireAt = expireAt;
  this.prev = null;
  this.next = null;
  // 标签索引：该缓存条目关联的分类/标签，用于细粒度失效
  this.tags = [];
  // ===== 性能优化：预序列化 JSON 字符串，缓存命中时直接发送，避免重复 JSON.stringify =====
  this.jsonStr = null;
}

const apiCache = new Map(); // key -> CacheNode
let cacheHead = null;       // 最新使用的节点
let cacheTail = null;       // 最久未使用的节点
let cacheSize = 0;

// 将节点移到头部（标记为最近使用）
function _cacheMoveToHead(node) {
  if (node === cacheHead) return;
  // 从原位置移除
  if (node.prev) node.prev.next = node.next;
  if (node.next) node.next.prev = node.prev;
  if (node === cacheTail) cacheTail = node.prev;
  // 插入头部
  node.prev = null;
  node.next = cacheHead;
  if (cacheHead) cacheHead.prev = node;
  cacheHead = node;
  if (!cacheTail) cacheTail = node;
}

// 淘汰最久未使用的节点
function _cacheEvictLRU() {
  if (!cacheTail) return;
  const evicted = cacheTail;
  cacheTail = evicted.prev;
  if (cacheTail) cacheTail.next = null;
  else cacheHead = null;
  apiCache.delete(evicted.key);
  cacheSize--;
}

// 根据请求生成缓存 key
function getCacheKey(req) {
  var query = '';
  if (req.query && Object.keys(req.query).length) {
    var sortedKeys = Object.keys(req.query).sort();
    query = '?' + sortedKeys.map(function (k) { return k + '=' + req.query[k]; }).join('&');
  }
  return req.method + ':' + req.path + query;
}

// 写入缓存，可选附带 tags 用于细粒度失效，可选预序列化的 jsonStr
function setCache(key, data, tags, jsonStr) {
  const now = Date.now();
  let node = apiCache.get(key);
  if (node) {
    // 更新现有节点
    node.data = data;
    node.expireAt = now + CACHE_TTL;
    node.tags = tags || [];
    node.jsonStr = jsonStr || null;
    _cacheMoveToHead(node);
    return;
  }
  // 新建节点
  node = new CacheNode(key, data, now + CACHE_TTL);
  node.tags = tags || [];
  node.jsonStr = jsonStr || null;
  apiCache.set(key, node);
  // 插入头部
  node.next = cacheHead;
  if (cacheHead) cacheHead.prev = node;
  cacheHead = node;
  if (!cacheTail) cacheTail = node;
  cacheSize++;
  // 超出上限时淘汰 LRU
  if (cacheSize > CACHE_MAX_SIZE) {
    _cacheEvictLRU();
  }
}

// 读取缓存，支持 stale-while-revalidate
// 返回 { data, stale, jsonStr } 或 null
function getCache(key, options) {
  const node = apiCache.get(key);
  if (!node) return null;
  const now = Date.now();
  if (now <= node.expireAt) {
    // 新鲜数据
    _cacheMoveToHead(node);
    return { data: node.data, stale: false, jsonStr: node.jsonStr };
  }
  // 已过期，检查是否在 SWR 窗口内
  const swr = (options && options.swr !== undefined) ? options.swr : true;
  if (swr && now - node.expireAt < CACHE_SWR_WINDOW) {
    // 在 SWR 窗口内，返回 stale 数据（调用方应在后台触发 revalidate）
    _cacheMoveToHead(node);
    return { data: node.data, stale: true, jsonStr: node.jsonStr };
  }
  // 完全过期，删除
  _cacheRemoveNode(node);
  return null;
}

// 从链表中移除节点
function _cacheRemoveNode(node) {
  if (node.prev) node.prev.next = node.next;
  if (node.next) node.next.prev = node.prev;
  if (node === cacheHead) cacheHead = node.next;
  if (node === cacheTail) cacheTail = node.prev;
  apiCache.delete(node.key);
  cacheSize--;
}

// 按模式清除缓存
function clearCache(pattern) {
  if (!pattern) {
    const count = cacheSize;
    apiCache.clear();
    cacheHead = null;
    cacheTail = null;
    cacheSize = 0;
    return count;
  }
  let count = 0;
  // 收集要删除的 key（避免迭代中修改）
  const toDelete = [];
  for (const key of apiCache.keys()) {
    if (key.includes(pattern)) {
      toDelete.push(key);
    }
  }
  for (let i = 0; i < toDelete.length; i++) {
    const node = apiCache.get(toDelete[i]);
    if (node) _cacheRemoveNode(node);
    count++;
  }
  return count;
}

// ===== 性能优化：按标签/分类细粒度缓存失效 =====
// 清除所有关联指定 tag 的缓存条目（如某个分类下的文章列表缓存）
function clearCacheByTag(tag) {
  if (!tag) return 0;
  let count = 0;
  const toDelete = [];
  for (const [key, node] of apiCache.entries()) {
    if (node.tags && node.tags.indexOf(tag) !== -1) {
      toDelete.push(key);
    }
  }
  for (let i = 0; i < toDelete.length; i++) {
    const node = apiCache.get(toDelete[i]);
    if (node) _cacheRemoveNode(node);
    count++;
  }
  return count;
}

function getCacheStats() {
  let total = cacheSize;
  let expired = 0;
  let stale = 0;
  const now = Date.now();
  const keys = [];
  let node = cacheHead;
  let count = 0;
  while (node && count < 50) {
    const expireIn = node.expireAt - now;
    const isExpired = expireIn <= 0;
    const isStale = isExpired && (now - node.expireAt) < CACHE_SWR_WINDOW;
    if (isExpired) expired++;
    if (isStale) stale++;
    keys.push({ key: node.key, expireIn: Math.max(0, expireIn), tags: node.tags });
    node = node.next;
    count++;
  }
  return {
    total,
    expired,
    stale,
    active: total - expired,
    maxSize: CACHE_MAX_SIZE,
    entries: keys
  };
}
// ================================================================

// ============ 内存数据库缓存 ============
// 将 db.json 解析后缓存在内存中，避免每次请求都读磁盘
let dbCache = null;
let dbCacheMtime = 0;

// ============ 浏览量批量写入 ============
// 累积浏览量变更，每 5 秒批量写入磁盘，避免每次访问文章都写磁盘
const pendingViewIncrements = {}; // { postId: increment }
let viewFlushTimer = null;
const VIEW_FLUSH_INTERVAL = 5000;

function scheduleViewFlush() {
  if (viewFlushTimer) return;
  viewFlushTimer = setTimeout(function () {
    viewFlushTimer = null;
    flushViewIncrements();
  }, VIEW_FLUSH_INTERVAL);
}

function flushViewIncrements() {
  const keys = Object.keys(pendingViewIncrements);
  if (!keys.length) return;
  const increments = {};
  Object.assign(increments, pendingViewIncrements);
  for (const k of keys) delete pendingViewIncrements[k];
  // 直接修改内存中的 DB 对象并保存
  if (dbCache) {
    let changed = false;
    // ===== 性能优化：复用预构建的 _postIndex 索引，避免每次 flush 都遍历全量文章 =====
    var postMap = dbCache._postIndex;
    if (!postMap) {
      // 兜底：索引未构建时临时构建（理论上不会走到这里）
      postMap = {};
      for (var i = 0; i < dbCache.posts.length; i++) {
        postMap[String(dbCache.posts[i].id)] = dbCache.posts[i];
      }
    }
    for (const postId in increments) {
      const post = postMap[postId];
      if (post) {
        post.views = (post.views || 0) + increments[postId];
        changed = true;
      }
    }
    if (changed) {
      saveDB(dbCache);
      clearCache('/api/posts');
    }
  }
}

// 进程退出时同步刷新浏览量，确保数据不丢失
function flushViewIncrementsSync() {
  const keys = Object.keys(pendingViewIncrements);
  if (!keys.length || !dbCache) return;
  const increments = {};
  Object.assign(increments, pendingViewIncrements);
  for (const k of keys) delete pendingViewIncrements[k];
  let changed = false;
  var postMap = dbCache._postIndex || {};
  for (const postId in increments) {
    const post = postMap[postId];
    if (post) {
      post.views = (post.views || 0) + increments[postId];
      changed = true;
    }
  }
  if (changed) {
    saveDBSync(dbCache);
  }
}

process.on('exit', flushViewIncrementsSync);
process.on('SIGINT', function () { flushViewIncrementsSync(); process.exit(0); });
process.on('SIGTERM', function () { flushViewIncrementsSync(); process.exit(0); });

// 缓存中间件：仅缓存 GET 请求且白名单内的前台路由
// 使用 Set 实现 O(1) 查找，替代数组 .some() 的 O(n) 遍历
const cacheWhitelist = new Set([
  '/api/posts',
  '/api/announcements',
  '/api/meta',
  '/api/settings',
  '/api/bootstrap',
  '/api/about',
  '/api/friends',
  '/api/comments',
  '/api/genealogy'
]);

function cacheMiddleware(req, res, next) {
  if (req.method !== 'GET') return next();
  if (!cacheWhitelist.has(req.path)) return next();
  const key = getCacheKey(req);
  const cached = getCache(key);
  if (cached) {
    // SWR 模式：如果是 stale 数据，先返回，同时标记需要后台刷新
    if (cached.stale) {
      res.setHeader('X-Cache', 'STALE');
      res.on('finish', function () {
        clearCache(key);
      });
    } else {
      res.setHeader('X-Cache', 'HIT');
    }
    // ===== 性能优化：优先使用预序列化 JSON 字符串，避免重复 stringify =====
    if (cached.jsonStr) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.send(cached.jsonStr);
    }
    return res.json(cached.data);
  }
  res.setHeader('X-Cache', 'MISS');
  const originalJson = res.json.bind(res);
  res.json = function (data) {
    if (res.statusCode === 200) {
      try {
        // 为文章列表等带查询参数的请求附带缓存 tag，便于细粒度失效
        var tags = [];
        if (req.path === '/api/posts') {
          if (req.query.category) tags.push('cat:' + req.query.category);
          if (req.query.tag) tags.push('tag:' + req.query.tag);
        }
        // ===== 性能优化：预序列化 JSON 并一起缓存，命中时直接发送 =====
        var jsonStr = JSON.stringify(data);
        setCache(key, data, tags, jsonStr);
      } catch (e) {}
    }
    return originalJson(data);
  };
  next();
}

app.use(cacheMiddleware);

// ============ 数据层 ============
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const FRIEND_AVATAR_DIR = path.join(UPLOAD_DIR, 'friends');
const SITE_LOGO_DIR = path.join(UPLOAD_DIR, 'site');
const ARTICLE_IMAGE_DIR = path.join(UPLOAD_DIR, 'articles');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(FRIEND_AVATAR_DIR)) fs.mkdirSync(FRIEND_AVATAR_DIR, { recursive: true });
if (!fs.existsSync(SITE_LOGO_DIR)) fs.mkdirSync(SITE_LOGO_DIR, { recursive: true });
if (!fs.existsSync(ARTICLE_IMAGE_DIR)) fs.mkdirSync(ARTICLE_IMAGE_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'db.json');

const defaultFriends = [
  {
    id: 'friend-1',
    name: '天真',
    url: 'https://bin.zmide.com/',
    description: '与君初识，宛如故人',
    avatar: 'https://aka.doubaocdn.com/s/gbD3baqMhI',
    status: 'approved',
    visible: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'friend-2',
    name: 'ligen131',
    url: 'https://ligen.life/',
    description: "Don't worry, be happy.",
    avatar: 'https://aka.doubaocdn.com/s/b7lTvYK1dr',
    status: 'approved',
    visible: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'friend-3',
    name: 'jyi2ya 的博客',
    url: 'https://jyi2ya.github.io/',
    description: 'Let me write C again and kill me.',
    avatar: 'https://aka.doubaocdn.com/s/1quPpCxtBk',
    status: 'approved',
    visible: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'friend-4',
    name: 'Chales',
    url: 'https://www.n2ptr.space/',
    description: 'just a blog',
    avatar: 'https://aka.doubaocdn.com/s/1tCmUyEKIU',
    status: 'approved',
    visible: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'friend-5',
    name: '笨蛋小破站',
    url: 'https://blog.obdo.cc/',
    description: 'May all the beauty be blessed.',
    avatar: 'https://aka.doubaocdn.com/s/A8Wn2YvWm2',
    status: 'approved',
    visible: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

// statSync 节流：减少高频请求下的磁盘 I/O
var _lastStatTime = 0;
var _lastStatMtime = 0;
var STAT_THROTTLE_MS = 2000; // 2 秒内复用上次 stat 结果

function loadDB() {
  // 检查磁盘文件是否变化（通过 mtime），未变化直接返回内存缓存
  // 节流 statSync：2 秒内复用上次结果，减少磁盘 I/O
  try {
    var now = Date.now();
    var mtime;
    if (now - _lastStatTime < STAT_THROTTLE_MS) {
      mtime = _lastStatMtime;
    } else {
      const stat = fs.statSync(DB_FILE);
      _lastStatTime = now;
      _lastStatMtime = stat.mtimeMs;
      mtime = stat.mtimeMs;
    }
    if (dbCache && mtime === dbCacheMtime) {
      return dbCache;
    }
  } catch (e) {
    // 文件不存在或其他错误，继续走初始化逻辑
  }

  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      posts: [
        {
          id: '1',
          title: '欢迎使用麦氏乡村网站',
          summary: '一个简洁优雅的博客系统，灵感来源于微信的经典设计语言。',
          content: '<p>这是一个采用微信设计风格的博客系统。</p><h2>主要特性</h2><ul><li>简洁清新的界面设计</li><li>完整的后台管理系统</li><li>文章的增删改查</li><li>分类与标签管理</li><li>响应式布局，适配移动端</li></ul><p>微信风格的核心在于「克制」——用最少的视觉元素传达最清晰的信息。绿色主色调 #07C160 带来活力感，大面积留白让内容呼吸。</p><h2>使用方法</h2><p>1. 访问首页查看博客文章列表</p><p>2. 点击文章标题查看详情</p><p>3. 访问 /admin 进入后台管理</p><p>4. 默认管理员账号：admin / admin123</p><p>开始你的博客之旅吧！</p>',
          cover: '',
          author: 'Admin',
          category: '公告',
          tags: ['教程', '公告'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          views: 128,
          published: true,
          pinned: false,
          announcement: false,
          showOnHome: true
        },
        {
          id: '2',
          title: '如何写出高质量的技术博客',
          summary: '分享技术写作的方法论，从选题到结构到表达，让你的文章更专业。',
          content: '<p>技术博客是开发者最好的名片。本文分享一些实用的写作技巧。</p><h2>选题策略</h2><p>好的选题是成功的一半。建议从以下角度切入：</p><ul><li>解决过的技术难题</li><li>新技术的实践总结</li><li>项目架构设计复盘</li><li>性能优化案例分析</li></ul><h2>结构设计</h2><p>一篇好的技术文章通常包含：问题背景、方案选型、实现细节、踩坑记录、总结展望。逻辑要清晰，让读者能够跟上你的思路。</p><h2>表达技巧</h2><p>多用图表和代码示例，少用大段文字。关键概念加粗强调，复杂流程配示意图。代码要可运行，附带注释说明。</p><p>坚持写作，量变终会引起质变。</p>',
          cover: '',
          author: 'Admin',
          category: '技术',
          tags: ['写作', '技术'],
          createdAt: new Date(Date.now() - 86400000).toISOString(),
          updatedAt: new Date(Date.now() - 86400000).toISOString(),
          views: 56,
          published: true,
          pinned: false,
          announcement: false,
          showOnHome: true
        },
        {
          id: '3',
          title: '2024年前端开发趋势展望',
          summary: '从框架演进到工具链变革，梳理前端生态的最新发展方向。',
          content: '<p>前端领域瞬息万变，让我们一起看看当前的发展趋势。</p><h2>框架层面</h2><p>React、Vue、Angular 三足鼎立，但 Svelte 和 Solid 等编译时框架正在崛起。服务端组件（RSC）正在改变前端的开发范式。</p><h2>工具链</h2><p>Vite 已成为新一代构建工具的标准。Turbopack、Rspack 等 Rust/Go 编写的工具在性能上持续突破。</p><h2>AI 辅助开发</h2><p>AI 编程助手已从概念走向日常工具。代码生成、智能补全、自动化测试等场景正在被重新定义。</p><p>保持学习，拥抱变化，是前端开发者永恒的主题。</p>',
          cover: '',
          author: 'Admin',
          category: '技术',
          tags: ['前端', '趋势'],
          createdAt: new Date(Date.now() - 172800000).toISOString(),
          updatedAt: new Date(Date.now() - 172800000).toISOString(),
          views: 89,
          published: true,
          pinned: false,
          announcement: false,
          showOnHome: true
        }
      ],
      categories: ['公告', '技术', '生活', '随笔'],
      tags: ['教程', '公告', '写作', '技术', '前端', '趋势', '生活', '随笔'],
      friends: defaultFriends,
      users: [],
      comments: [],
      likes: [],
      favorites: [],
      settings: {
        siteName: '麦氏乡村',
        siteSubtitle: '记录麦氏家族族谱传承、乡村风貌与乡亲故事',
        description: '麦氏乡村——记录麦氏家族族谱传承、乡村风貌与乡亲故事。',
        logo: '',
        footerText: '',
        navLinks: [
          { name: '主页', url: 'index.html', visible: true },
          { name: '族谱', url: 'genealogy.html', visible: true },
          { name: '朋友们', url: 'friends.html', visible: true },
          { name: '关于', url: 'about.html', visible: true }
        ],
        about: {
          kicker: 'About',
          title: '关于麦氏乡村',
          summary: '麦氏乡村网站展示——记录麦氏家族族谱传承、乡村风貌与乡亲故事。',
          content: '<section class="about-card"><h2>麦氏乡村</h2><p>麦氏乡村网站展示是一处记录麦氏家族族谱传承、乡村风貌与乡亲故事的平台。</p></section><section class="about-card"><h2>族谱传承</h2><ul><li>始祖麦铁杖，隋代名将，谥号"烈"，开基立业。</li><li>历经九世传承，昭穆有序，支派分明。</li></ul><a class="btn-primary" href="genealogy.html">查看族谱</a></section><section class="about-card"><h2>联系方式</h2><p>邮箱：maishi@family.com</p><p>微信：maishi-family</p><p>地址：广东麦氏乡村</p></section><section class="about-card"><h2>赞助支持</h2><p>麦氏乡村网站由家族成员共同维护，欢迎赞助支持，您的支持将用于服务器运营与族谱资料整理。赞助码：MAISHI2026</p></section>'
        },
        commentSettings: {
          blockedKeywords: [],
          homepagePageSize: 5,
          postPageSize: 10
        }
      },
      admin: {
        username: 'admin',
        password: '$2a$10$N9qo8uLOickgx2ZMRZoMy.MrqKQFqBzDqD4nYDvLqFqKqKqKqKqKq'
      }
    };
    // 使用 bcryptjs 的同步方法生成默认密码 hash
    const bcrypt = require('bcryptjs');
    const salt = bcrypt.genSaltSync(10);
    initial.admin.password = bcrypt.hashSync('admin123', salt);
    // ===== 性能优化：初始化时也构建索引并更新缓存 =====
    buildDBIndexes(initial);
    dbCache = initial;
    try {
      const stat = fs.statSync(DB_FILE);
      dbCacheMtime = stat.mtimeMs;
      _lastStatTime = Date.now();
      _lastStatMtime = stat.mtimeMs;
    } catch (e) {}
    // 写入时剥离索引属性，保持文件格式一致
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, function (k, v) {
      if (this === initial && k.startsWith('_')) return undefined;
      return v;
    }, 2));
    return initial;
  }
  let db;
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    dbCacheMtime = fs.statSync(DB_FILE).mtimeMs;
  } catch (e) {
    console.error('数据库文件损坏，尝试备份并重建：', e.message);
    const backupName = DB_FILE + '.corrupt.' + Date.now();
    try { fs.renameSync(DB_FILE, backupName); } catch (_) {}
    const salt = bcrypt.genSaltSync(10);
    const fresh = JSON.parse(JSON.stringify(initial));
    fresh.admin.password = bcrypt.hashSync('admin123', salt);
    fs.writeFileSync(DB_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
  let changed = false;
  if (!Array.isArray(db.friends)) {
    db.friends = defaultFriends;
    changed = true;
  }
  if (!Array.isArray(db.users)) {
    db.users = [];
    changed = true;
  }
  if (!db.settings) {
    db.settings = { siteName: '麦氏乡村',
        description: '麦氏乡村——记录麦氏家族族谱传承、乡村风貌与乡亲故事。', logo: '', footerText: '', navLinks: [] };
    changed = true;
  }
  if (db.settings.description === undefined) {
    db.settings.description = '麦氏乡村——记录麦氏家族族谱传承、乡村风貌与乡亲故事。';
    changed = true;
  }
  if (db.settings.footerText === undefined) {
    db.settings.footerText = '';
    changed = true;
  }
  if (!Array.isArray(db.settings.navLinks)) {
    db.settings.navLinks = [
      { name: '主页', url: 'index.html', visible: true },
      { name: '族谱', url: 'genealogy.html', visible: true },
      { name: '朋友们', url: 'friends.html', visible: true },
      { name: '关于', url: 'about.html', visible: true }
    ];
    changed = true;
  }
  if (!db.settings.about) {
    db.settings.about = {
      kicker: 'About',
      title: '关于麦氏乡村',
      summary: '麦氏乡村网站展示——记录麦氏家族族谱传承、乡村风貌与乡亲故事。',
      content: '<section class="about-card"><h2>麦氏乡村</h2><p>麦氏乡村网站展示是一处记录麦氏家族族谱传承、乡村风貌与乡亲故事的平台。</p></section><section class="about-card"><h2>族谱传承</h2><ul><li>始祖麦铁杖，隋代名将，谥号"烈"，开基立业。</li><li>历经九世传承，昭穆有序，支派分明。</li></ul><a class="btn-primary" href="genealogy.html">查看族谱</a></section>'
    };
    changed = true;
  }
  if (!db.settings.contact) {
    db.settings.contact = {
      email: 'maishi@family.com',
      wechat: 'maishi-family',
      qq: '',
      phone: '',
      address: '广东麦氏乡村'
    };
    changed = true;
  }
  if (!db.settings.sponsor) {
    db.settings.sponsor = {
      description: '麦氏乡村网站由家族成员共同维护，如果您觉得本站对您有帮助，欢迎赞助支持，您的支持将用于服务器运营与族谱资料整理。',
      wechatQr: '',
      alipayQr: '',
      code: 'MAISHI2026'
    };
    changed = true;
  }
  if (!Array.isArray(db.comments)) {
    db.comments = [];
    changed = true;
  }
  if (!Array.isArray(db.likes)) {
    db.likes = [];
    changed = true;
  }
  if (!Array.isArray(db.favorites)) {
    db.favorites = [];
    changed = true;
  }
  if (!db.settings.commentSettings) {
    db.settings.commentSettings = {
      blockedKeywords: [],
      homepagePageSize: 5,
      postPageSize: 10
    };
    changed = true;
  }
  if (!Array.isArray(db.settings.commentSettings.blockedKeywords)) {
    db.settings.commentSettings.blockedKeywords = [];
    changed = true;
  }
  if (!Number.isFinite(Number(db.settings.commentSettings.homepagePageSize))) {
    db.settings.commentSettings.homepagePageSize = 5;
    changed = true;
  }
  if (!Number.isFinite(Number(db.settings.commentSettings.postPageSize))) {
    db.settings.commentSettings.postPageSize = 10;
    changed = true;
  }
  db.posts = db.posts.map(post => {
    if (post.pinned === undefined || post.announcement === undefined || post.showOnHome === undefined) changed = true;
    return {
      pinned: false,
      announcement: false,
      showOnHome: true,
      ...post
    };
  });
  db.friends = db.friends.map((friend, i) => ({
    status: 'approved',
    visible: true,
    iconUrl: '',
    sortOrder: friend.sortOrder !== undefined ? friend.sortOrder : (i + 1),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...friend,
    sortOrder: friend.sortOrder !== undefined ? friend.sortOrder : (i + 1)
  }));

  // ===== 族谱数据迁移 =====
  if (!Array.isArray(db.genealogy)) {
    db.genealogy = [];
    changed = true;
  }
  if (db.settings && db.settings.genealogyIntro === undefined) {
    db.settings.genealogyIntro = '';
    changed = true;
  }
  if (db.settings && db.settings.genealogyKicker === undefined) {
    db.settings.genealogyKicker = 'Genealogy';
    changed = true;
  }
  if (db.settings && db.settings.genealogyTitle === undefined) {
    db.settings.genealogyTitle = '麦氏族谱';
    changed = true;
  }
  if (db.settings && db.settings.genealogySubtitle === undefined) {
    db.settings.genealogySubtitle = '以金字塔图谱呈现自始祖麦铁杖至当代麦邦杰的家族传承，点击人名可展开或折叠其后代。';
    changed = true;
  }
  if (db.settings && db.settings.genealogyDefaultExpandLevels === undefined) {
    db.settings.genealogyDefaultExpandLevels = 5;
    changed = true;
  }
  if (db.settings && db.settings.genealogyPassword === undefined) {
    db.settings.genealogyPassword = '';
    changed = true;
  }
  if (db.settings && db.settings.genealogyPasswordCreatedAt === undefined) {
    db.settings.genealogyPasswordCreatedAt = '';
    changed = true;
  }
  if (db.settings && db.settings.genealogyPasswordExpiresIn === undefined) {
    db.settings.genealogyPasswordExpiresIn = 0;
    changed = true;
  }
  if (!Array.isArray(db.genealogyPasswordRequests)) {
    db.genealogyPasswordRequests = [];
    changed = true;
  }
  // ===== 维护模式迁移 =====
  if (db.settings && db.settings.maintenanceMode === undefined) {
    db.settings.maintenanceMode = false;
    changed = true;
  }
  if (db.settings && db.settings.maintenancePassword === undefined) {
    db.settings.maintenancePassword = '';
    changed = true;
  }
  if (db.settings && db.settings.maintenanceMessage === undefined) {
    db.settings.maintenanceMessage = '网站维护中，敬请谅解';
    changed = true;
  }
  // ===== 用户角色与昵称迁移 =====
  if (Array.isArray(db.users)) {
    db.users = db.users.map(function (u) {
      var patched = false;
      if (u.role === undefined) { u.role = 'user'; patched = true; }
      if (u.nickname === undefined) { u.nickname = ''; patched = true; }
      if (patched) changed = true;
      return u;
    });
  }
  if (changed) saveDB(db);
  // ===== 性能优化：构建数据库索引（随 dbCache 一起维护）=====
  buildDBIndexes(db);
  // ===== 性能优化：内存保护 - 冻结索引结构（派生数据，不应被意外修改）=====
  // 注意：settings/categories/tags 是可变的（管理后台可修改），不冻结
  if (db._postIndex) Object.freeze(db._postIndex);
  if (db._postsByCategory) Object.freeze(db._postsByCategory);
  if (db._postsByTag) Object.freeze(db._postsByTag);
  if (db._publishedPosts) Object.freeze(db._publishedPosts);
  if (db._publishedAnnouncements) Object.freeze(db._publishedAnnouncements);
  if (db._publishedPostsByCategory) Object.freeze(db._publishedPostsByCategory);
  if (db._publishedPostsByTag) Object.freeze(db._publishedPostsByTag);
  if (db._searchIndex) Object.freeze(db._searchIndex);
  dbCache = db;
  return db;
}

// ===== 性能优化：构建数据库索引 =====
// 在 loadDB 后及 saveDB 后重建索引，避免每次 API 请求遍历全量数组
// 索引全部挂载在 db 对象的 _ 前缀属性上，序列化时会被 JSON.stringify 包含但不影响功能
function buildDBIndexes(db) {
  if (!db || !Array.isArray(db.posts)) return;
  var posts = db.posts;
  var len = posts.length;

  // 1. posts by id 索引（O(1) 查找单篇文章）
  var postIndex = {};
  // 2. posts by category 索引（分类 -> 文章数组）
  var postsByCategory = {};
  // 3. posts by tag 索引（标签 -> 文章数组）
  var postsByTag = {};
  // 4. 已发布普通文章列表（预过滤）
  var publishedPosts = [];
  // 5. 已发布公告列表
  var publishedAnnouncements = [];
  // 6. 倒排搜索索引（关键词 -> postId 数组，简易版，基于标题和摘要分词）
  var searchIndex = {};

  for (var i = 0; i < len; i++) {
    var post = posts[i];
    var pid = String(post.id);

    // by id
    postIndex[pid] = post;

    // by category
    var cat = post.category;
    if (cat) {
      if (!postsByCategory[cat]) postsByCategory[cat] = [];
      postsByCategory[cat].push(post);
    }

    // by tag
    if (Array.isArray(post.tags)) {
      for (var t = 0; t < post.tags.length; t++) {
        var tag = post.tags[t];
        if (!postsByTag[tag]) postsByTag[tag] = [];
        postsByTag[tag].push(post);
      }
    }

    // 已发布过滤
    if (post.published) {
      if (post.announcement) {
        publishedAnnouncements.push(post);
      } else {
        publishedPosts.push(post);
      }
    }

    // 倒排搜索索引（基于标题 + 摘要 + 标签的关键词提取）
    // 简易策略：按非字母数字字符切分，建立词 -> postId 映射
    var searchText = (post.title || '') + ' ' + (post.summary || '') + ' ' + (post.tags || []).join(' ');
    // 简单分词：按空格、标点、中英文边界切分
    var tokens = searchText.toLowerCase().split(/[\s,.;:!?，。；：！？、""''（）()\[\]【】《》<>\/\\\-—_=+@#$%^&*~`|\n\r\t]+/);
    var seen = {}; // 同一篇文章中一个词只记录一次
    for (var w = 0; w < tokens.length; w++) {
      var word = tokens[w];
      if (word.length >= 2 && !seen[word]) {
        seen[word] = true;
        if (!searchIndex[word]) searchIndex[word] = [];
        searchIndex[word].push(pid);
      }
    }
  }

  // 对各列表预排序（按置顶 + 时间倒序），使用 sortPostsForList 的逻辑
  function sortPosts(postsArr) {
    var withTs = postsArr.map(function (p) {
      return { p: p, ts: new Date(p.createdAt).getTime() || 0 };
    });
    withTs.sort(function (a, b) {
      if (!!a.p.pinned !== !!b.p.pinned) return a.p.pinned ? -1 : 1;
      return b.ts - a.ts;
    });
    return withTs.map(function (item) { return item.p; });
  }

  // 先对已发布文章列表排序（置顶优先 + 时间倒序）
  var sortedPublished = sortPosts(publishedPosts);
  var sortedAnnouncements = sortPosts(publishedAnnouncements);

  // 对全量分类和标签下的文章列表分别预排序
  for (var catKey in postsByCategory) {
    postsByCategory[catKey] = sortPosts(postsByCategory[catKey]);
  }
  for (var tagKey in postsByTag) {
    postsByTag[tagKey] = sortPosts(postsByTag[tagKey]);
  }

  // ===== 性能优化：构建已发布非公告文章的分类/标签索引（前台高频查询用）=====
  var publishedPostsByCategory = {};
  var publishedPostsByTag = {};
  // 从已排序的已发布文章列表构建分类和标签子集，保证每个分类/标签内也是正确顺序
  for (var pi = 0; pi < sortedPublished.length; pi++) {
    var pp = sortedPublished[pi];
    var ppCat = pp.category;
    if (ppCat) {
      if (!publishedPostsByCategory[ppCat]) publishedPostsByCategory[ppCat] = [];
      publishedPostsByCategory[ppCat].push(pp);
    }
    if (Array.isArray(pp.tags)) {
      for (var pt = 0; pt < pp.tags.length; pt++) {
        var ptag = pp.tags[pt];
        if (!publishedPostsByTag[ptag]) publishedPostsByTag[ptag] = [];
        publishedPostsByTag[ptag].push(pp);
      }
    }
  }

  db._postIndex = postIndex;
  db._postsByCategory = postsByCategory;
  db._postsByTag = postsByTag;
  db._publishedPosts = sortedPublished;
  db._publishedAnnouncements = sortedAnnouncements;
  db._publishedPostsByCategory = publishedPostsByCategory;
  db._publishedPostsByTag = publishedPostsByTag;
  db._searchIndex = searchIndex;
}

// ===== 性能优化：saveDB 异步化 + debounce 合并 =====
// 50ms 内多次 saveDB 合并为一次磁盘写入，避免高频写操作阻塞事件循环
// 使用 fs.writeFile 异步写入，保持原子写入逻辑（先写 tmp 再 rename）
let _pendingSave = false;
let _saveTimer = null;
let _saveQueued = false;
const SAVE_DEBOUNCE_MS = 50;

function saveDB(data) {
  // 立即更新内存缓存和索引，保证读请求拿到最新数据
  dbCache = data;
  buildDBIndexes(data);
  // 内存保护：冻结索引结构（派生数据，不应被意外修改）
  if (data._postIndex) Object.freeze(data._postIndex);
  if (data._publishedPosts) Object.freeze(data._publishedPosts);
  if (data._publishedAnnouncements) Object.freeze(data._publishedAnnouncements);
  if (data._searchIndex) Object.freeze(data._searchIndex);

  // 如果已有待执行的写入，直接返回（合并到下一次写入）
  if (_saveTimer) {
    _saveQueued = true;
    return;
  }
  _saveQueued = false;
  _pendingSave = true;

  _saveTimer = setTimeout(function () {
    _saveTimer = null;
    _performSave(data);
  }, SAVE_DEBOUNCE_MS);
}

// 实际执行异步写入
function _performSave(data) {
  const tmp = DB_FILE + '.tmp';
  // ===== 性能优化：序列化时剥离索引属性，保持数据库文件格式不变 =====
  const jsonStr = JSON.stringify(data, function (key, value) {
    // 顶层 key 以 _ 开头的是索引，不写入磁盘
    if (this === data && key.startsWith('_')) return undefined;
    return value;
  }, 2);
  fs.writeFile(tmp, jsonStr, function (writeErr) {
    if (writeErr) {
      console.error('写入数据库文件失败:', writeErr.message);
      _pendingSave = false;
      return;
    }
    fs.rename(tmp, DB_FILE, function (renameErr) {
      _pendingSave = false;
      if (renameErr) {
        console.error('重命名数据库文件失败:', renameErr.message);
        return;
      }
      // 更新 mtime 缓存
      try {
        const stat = fs.statSync(DB_FILE);
        dbCacheMtime = stat.mtimeMs;
        _lastStatTime = Date.now();
        _lastStatMtime = stat.mtimeMs;
      } catch (e) {}

      // 如果 debounce 期间又有新的数据变更，继续触发下一次写入
      if (_saveQueued && dbCache) {
        _saveQueued = false;
        saveDB(dbCache);
      }
    });
  });
}

// 同步版本 saveDB（进程退出等特殊场景使用）
function saveDBSync(data) {
  dbCache = data;
  buildDBIndexes(data);
  // 内存保护：冻结索引结构
  if (data._postIndex) Object.freeze(data._postIndex);
  if (data._publishedPosts) Object.freeze(data._publishedPosts);
  if (data._publishedAnnouncements) Object.freeze(data._publishedAnnouncements);
  if (data._searchIndex) Object.freeze(data._searchIndex);
  const tmp = DB_FILE + '.tmp';
  // ===== 性能优化：序列化时剥离索引属性，保持数据库文件格式不变 =====
  const jsonStr = JSON.stringify(data, function (key, value) {
    if (this === data && key.startsWith('_')) return undefined;
    return value;
  }, 2);
  fs.writeFileSync(tmp, jsonStr);
  fs.renameSync(tmp, DB_FILE);
  try {
    const mtime = fs.statSync(DB_FILE).mtimeMs;
    dbCacheMtime = mtime;
    _lastStatTime = Date.now();
    _lastStatMtime = mtime;
  } catch (e) {}
}
// ========================================================

// ============ 上传配置 ============
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, FRIEND_AVATAR_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    cb(null, Date.now() + '-' + Math.random().toString(16).slice(2) + ext);
  }
});

const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(file.mimetype)) {
      return cb(new Error('头像仅支持 PNG、JPG、GIF、WEBP、SVG 图片'));
    }
    cb(null, true);
  }
});

function friendAvatarMiddleware(req, res, next) {
  uploadAvatar.single('avatar')(req, res, err => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '头像图片不能大于 1MB' });
    }
    return res.status(400).json({ error: err.message || '头像上传失败' });
  });
}

const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, SITE_LOGO_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    cb(null, 'logo-' + Date.now() + '-' + Math.random().toString(16).slice(2) + ext);
  }
});

const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(file.mimetype)) {
      return cb(new Error('网站 Logo 仅支持 PNG、JPG、GIF、WEBP、SVG 图片'));
    }
    cb(null, true);
  }
});

function siteLogoMiddleware(req, res, next) {
  uploadLogo.single('logo')(req, res, err => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '网站 Logo 不能大于 1MB' });
    }
    return res.status(400).json({ error: err.message || 'Logo 上传失败' });
  });
}

const articleImageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ARTICLE_IMAGE_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    cb(null, 'article-' + Date.now() + '-' + Math.random().toString(16).slice(2) + ext);
  }
});

const uploadArticleImage = multer({
  storage: articleImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(file.mimetype)) {
      return cb(new Error('文章图片仅支持 PNG、JPG、GIF、WEBP、SVG 图片'));
    }
    cb(null, true);
  }
});

function articleImageMiddleware(req, res, next) {
  uploadArticleImage.single('image')(req, res, err => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '文章图片不能大于 5MB' });
    }
    return res.status(400).json({ error: err.message || '文章图片上传失败' });
  });
}

function normalizeUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return 'https://' + value;
}

function escapeUserContent(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br>');
}

// 净化用户投稿的富文本 HTML：移除危险标签和事件属性，保留安全排版标签
function sanitizeUserHtml(html) {
  var str = String(html || '');
  
  // 先提取并保存允许的 iframe（视频嵌入）
  var allowedIframes = [];
  str = str.replace(/<iframe[^>]*(?:youtube\.com|youtu\.be|bilibili\.com|b23\.tv|douyin\.com|v\.qq\.com|player\.bilibili\.com)[^>]*>[\s\S]*?<\/iframe>/gi, function(match) {
    allowedIframes.push(match);
    return '___IFRAME_PLACEHOLDER_' + (allowedIframes.length - 1) + '___';
  });
  
  // 移除 script / style / object / embed 等危险标签及其内容
  str = str.replace(/<\s*(script|style|object|embed|link|meta|base|form)[\s\S]*?<\/\s*\1\s*>/gi, '');
  // 移除自闭合危险标签
  str = str.replace(/<\s*(script|style|object|embed|link|meta|base|form)[^>]*>/gi, '');
  // 移除其他 iframe（非视频平台的）
  str = str.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
  str = str.replace(/<iframe[^>]*>/gi, '');
  // 移除所有 on* 事件属性
  str = str.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // 移除 javascript: 协议
  str = str.replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]*)/gi, '$1="#"');
  
  // 恢复允许的 iframe
  str = str.replace(/___IFRAME_PLACEHOLDER_(\d+)___/g, function(match, index) {
    return allowedIframes[parseInt(index)] || '';
  });
  
  return str.trim();
}

function fileToAvatarPath(file) {
  return file ? '/uploads/friends/' + file.filename : '';
}

function fileToLogoPath(file) {
  return file ? '/uploads/site/' + file.filename : '';
}

function fileToArticleImagePath(file) {
  return file ? '/uploads/articles/' + file.filename : '';
}

function removeLocalAvatar(avatar) {
  if (!avatar || !avatar.startsWith('/uploads/friends/')) return;
  const filePath = path.join(__dirname, avatar.replace(/^\//, ''));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function removeLocalUpload(fileUrl) {
  if (!fileUrl || !fileUrl.startsWith('/uploads/')) return;
  const filePath = path.join(__dirname, fileUrl.replace(/^\//, ''));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function normalizeCommentSettings(settings = {}) {
  const homepagePageSize = Math.max(1, Math.min(100, Number(settings.homepagePageSize) || 5));
  const postPageSize = Math.max(1, Math.min(100, Number(settings.postPageSize) || 10));
  const blockedKeywords = Array.isArray(settings.blockedKeywords)
    ? settings.blockedKeywords
    : String(settings.blockedKeywords || '').split(/[\n,，]/);
  return {
    blockedKeywords: blockedKeywords.map(item => String(item || '').trim()).filter(Boolean),
    homepagePageSize,
    postPageSize
  };
}

function getCommentSettings(db) {
  db.settings = db.settings || {};
  db.settings.commentSettings = normalizeCommentSettings(db.settings.commentSettings || {});
  return db.settings.commentSettings;
}

function getMatchedKeywords(content, keywords) {
  const text = String(content || '').toLowerCase();
  return (keywords || []).filter(keyword => text.includes(String(keyword).toLowerCase()));
}

function sanitizePublicComment(comment) {
  const { matchedKeywords, ip, ...safe } = comment;
  return safe;
}

function getCommentTargetTitle(db, comment) {
  if (comment.targetType === 'home') return '网站主页留言区';
  // 使用 db._postIndex 索引（如果存在），避免线性查找
  if (db._postIndex && db._postIndex[String(comment.postId)]) {
    return db._postIndex[String(comment.postId)].title || '文章留言区';
  }
  const post = db.posts.find(item => String(item.id) === String(comment.postId));
  return post ? post.title : '文章留言区';
}

function optionalUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  try {
    return jwt.verify(token, SECRET_KEY);
  } catch (e) {
    return null;
  }
}

function sortPostsForList(posts) {
  // 预解析时间戳，避免排序时每次比较都创建 Date 对象
  var withTs = posts.map(function (p) {
    return { p: p, ts: new Date(p.createdAt).getTime() || 0 };
  });
  withTs.sort(function (a, b) {
    if (!!a.p.pinned !== !!b.p.pinned) return a.p.pinned ? -1 : 1;
    return b.ts - a.ts;
  });
  return withTs.map(function (item) { return item.p; });
}

/**
 * 从文章正文 HTML 中提取第一张图片的 src
 * 用于无封面图时自动抽取正文图片作为列表封面卡片
 */
function extractFirstImage(content) {
  if (!content || typeof content !== 'string') return '';
  const m = content.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : '';
}

// ===== 性能优化：全文搜索（基于倒排索引 + 内容兜底）=====
// 优先使用预构建的倒排索引快速定位候选文章，再对内容做精确匹配
// 搜索结果按匹配度排序：标题匹配 > 摘要匹配 > 标签匹配 > 内容匹配
function searchPosts(basePosts, keyword, db) {
  var kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return basePosts;

  var candidateIds = null;
  var searchIndex = db._searchIndex;

  if (searchIndex) {
    // 分词查询关键词
    var kwTokens = kw.split(/[\s,.;:!?，。；：！？、""''（）()\[\]【】《》<>\/\\\-—_=+@#$%^&*~`|\n\r\t]+/).filter(function (t) { return t.length >= 2; });
    if (kwTokens.length > 0) {
      // 取所有关键词命中的文章 ID 的并集
      var idSet = {};
      for (var i = 0; i < kwTokens.length; i++) {
        var ids = searchIndex[kwTokens[i]];
        if (ids) {
          for (var j = 0; j < ids.length; j++) {
            idSet[ids[j]] = true;
          }
        }
      }
      candidateIds = Object.keys(idSet);
    }
  }

  var candidates;
  if (candidateIds && candidateIds.length > 0) {
    // 从倒排索引得到候选集，再做精确匹配（保证内容搜索也能命中）
    var postIndex = db._postIndex || {};
    candidates = candidateIds.map(function (id) { return postIndex[id]; }).filter(Boolean);
    // 还需要从 basePosts 中过滤，保持与 basePosts 相同的范围
    var baseIds = {};
    for (var k = 0; k < basePosts.length; k++) {
      baseIds[String(basePosts[k].id)] = true;
    }
    candidates = candidates.filter(function (p) { return baseIds[String(p.id)]; });
  } else {
    // 倒排索引无结果时，使用 basePosts 做全量扫描兜底
    candidates = basePosts;
  }

  // 精确匹配 + 打分排序
  var results = [];
  for (var m = 0; m < candidates.length; m++) {
    var p = candidates[m];
    var score = 0;
    var title = (p.title || '').toLowerCase();
    var summary = (p.summary || '').toLowerCase();
    var content = (p.content || '').toLowerCase();
    var tags = Array.isArray(p.tags) ? p.tags.join(' ').toLowerCase() : '';

    if (title.indexOf(kw) !== -1) score += 100;
    if (summary.indexOf(kw) !== -1) score += 50;
    if (tags.indexOf(kw) !== -1) score += 30;
    if (content.indexOf(kw) !== -1) score += 10;

    if (score > 0) {
      results.push({ post: p, score: score });
    }
  }

  // 按分数降序，分数相同按时间降序
  results.sort(function (a, b) {
    if (a.score !== b.score) return b.score - a.score;
    var ta = new Date(a.post.createdAt).getTime() || 0;
    var tb = new Date(b.post.createdAt).getTime() || 0;
    return tb - ta;
  });

  return results.map(function (r) { return r.post; });
}
// ======================================================

// ============ 认证中间件 ============
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const SECRET_KEY = process.env.JWT_SECRET || 'carson-blog-secret-2024';

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: '未登录或登录已过期' });
  }
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录令牌无效' });
  }
}

function userAuthMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: '请先登录前台账号' });
  }
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    if (decoded.type !== 'user') {
      return res.status(401).json({ error: '登录令牌无效' });
    }
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录令牌无效' });
  }
}

// ===== 维护模式中间件 =====
function maintenanceMiddleware(req, res, next) {
  // 静态文件直接放行，避免不必要的 loadDB 调用
  if (!req.path.startsWith('/api/')) return next();
  const db = loadDB();
  const maintenanceMode = db.settings?.maintenanceMode;
  const maintenancePassword = db.settings?.maintenancePassword || '';
  const maintenanceMessage = db.settings?.maintenanceMessage || '网站维护中，敬请谅解';

  // 未开启维护模式，直接放行
  if (!maintenanceMode) return next();

  // API 路径：返回 JSON 错误
  if (req.path.startsWith('/api/')) {
    // 维护模式验证接口和认证接口放行，确保管理员可以登录
    if (req.path === '/api/maintenance/verify-password' ||
        req.path === '/api/auth/login' ||
        req.path === '/api/auth/verify' ||
        req.path === '/api/user/login') return next();

    // 管理后台 API 验证管理员身份
    if (req.path.startsWith('/api/admin/')) {
      const token = req.headers.authorization?.replace('Bearer ', '') || '';
      try {
        const decoded = jwt.verify(token, SECRET_KEY);
        if (decoded.role === 'admin') return next(); // 管理员放行
      } catch (e) {}
      return res.status(503).json({ error: '网站维护中，请稍后再试' });
    }

    // 其他 API 检查是否已验证维护密码
    const verified = req.headers['x-maintenance-verified'] === 'true' ||
                     (req.cookies && req.cookies.maintenanceVerified === 'true');
    if (verified) return next();
    return res.status(503).json({ error: maintenanceMessage });
  }

  // 管理页面路径：管理员可以访问
  if (req.path.startsWith('/admin/')) {
    return next(); // 让前端自己验证权限
  }

  // 静态页面：检查 sessionStorage（通过前端 JS 控制）
  // 这里直接放行页面，由前端 JS 检查维护模式并显示遮罩
  next();
}

// 写操作后自动清除相关缓存
function clearCacheAfterMutation(scope) {
  // scope: 'posts', 'comments', 'friends', 'settings', 'meta', 'all'
  if (scope === 'all') {
    clearCache();
    return;
  }
  const patterns = {
    posts: ['/api/posts', '/api/announcements', '/api/meta'],
    comments: ['/api/comments'],
    friends: ['/api/friends'],
    settings: ['/api/settings', '/api/about'],
    meta: ['/api/meta', '/api/posts']
  };
  const list = patterns[scope] || [scope];
  list.forEach(function (p) { clearCache(p); });
}

function clearCacheByScope(scope, pattern) {
  if (scope === 'pattern' && pattern) return clearCache(pattern);
  if (scope === 'all' || !scope) return clearCache();
  const patterns = {
    posts: ['/api/posts', '/api/announcements', '/api/meta'],
    comments: ['/api/comments'],
    friends: ['/api/friends'],
    settings: ['/api/settings', '/api/about'],
    meta: ['/api/meta', '/api/posts']
  };
  const list = patterns[scope];
  if (!list) return clearCache();
  let count = 0;
  list.forEach(function (p) { count += clearCache(p); });
  return count;
}

// ============ 后台缓存管理接口 ============
app.get('/api/admin/cache/stats', authMiddleware, (req, res) => {
  res.json(getCacheStats());
});

// 清除服务器内存缓存
app.post('/api/admin/cache/clear', authMiddleware, (req, res) => {
  const scope = String(req.body.scope || 'all').trim();
  const pattern = req.body.pattern ? String(req.body.pattern).trim() : '';
  const cleared = clearCacheByScope(scope, pattern);
  res.json({ message: '缓存已清除', cleared: cleared });
});

// 获取 Cloudflare 缓存配置
app.get('/api/admin/cloudflare/config', authMiddleware, (req, res) => {
  const db = loadDB();
  res.json({
    apiToken: db.settings?.cloudflareApiToken || '',
    zoneId: db.settings?.cloudflareZoneId || '',
    configured: !!(db.settings?.cloudflareApiToken && db.settings?.cloudflareZoneId)
  });
});

// 保存 Cloudflare 缓存配置
app.post('/api/admin/cloudflare/config', authMiddleware, (req, res) => {
  const db = loadDB();
  const apiToken = String(req.body.apiToken || '').trim();
  const zoneId = String(req.body.zoneId || '').trim();
  db.settings = db.settings || {};
  db.settings.cloudflareApiToken = apiToken;
  db.settings.cloudflareZoneId = zoneId;
  db.settings.updatedAt = new Date().toISOString();
  saveDB(db);
  res.json({ message: 'Cloudflare 配置已保存', configured: !!(apiToken && zoneId) });
});

// 清除 Cloudflare 边缘缓存（purge everything 或按 URL）
app.post('/api/admin/cloudflare/purge', authMiddleware, async (req, res) => {
  const db = loadDB();
  const apiToken = db.settings?.cloudflareApiToken || '';
  const zoneId = db.settings?.cloudflareZoneId || '';
  if (!apiToken || !zoneId) {
    return res.status(400).json({ error: '请先在设置中配置 Cloudflare API Token 和 Zone ID' });
  }
  const purgeEverything = req.body.purgeEverything !== false;
  const files = Array.isArray(req.body.files) ? req.body.files : [];

  const https = require('https');
  const payload = JSON.stringify(
    purgeEverything ? { purge_everything: true } : { files: files }
  );

  const options = {
    hostname: 'api.cloudflare.com',
    path: '/client/v4/zones/' + zoneId + '/purge_cache',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiToken,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  function callCloudflare(proxyAgent) {
    return new Promise(function (resolve, reject) {
      var reqOpts = options;
      if (proxyAgent) {
        reqOpts = Object.assign({}, options, { agent: proxyAgent });
      }
      var cfReq = https.request(reqOpts, function (cfRes) {
        var body = '';
        cfRes.on('data', function (chunk) { body += chunk; });
        cfRes.on('end', function () {
          try {
            var data = JSON.parse(body);
            resolve(data);
          } catch (e) {
            reject(new Error('Cloudflare 响应解析失败'));
          }
        });
      });
      cfReq.on('error', function (err) {
        reject(err);
      });
      cfReq.write(payload);
      cfReq.end();
    });
  }

  try {
    // 使用代理（如果配置了的话）
    var proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || '';
    var proxyAgent = null;
    if (proxyUrl) {
      try {
        var HttpsProxyAgent = require('https-proxy-agent');
        proxyAgent = new HttpsProxyAgent(proxyUrl);
      } catch (e) {
        // 没有安装 https-proxy-agent，直接连接
      }
    }

    var data = await callCloudflare(proxyAgent);
    if (data.success) {
      // 同时清除本地服务器缓存
      clearCache();
      res.json({
        message: purgeEverything
          ? 'Cloudflare 边缘缓存已全部清除，同时已清除本地缓存'
          : 'Cloudflare 指定 URL 缓存已清除',
        success: true,
        resultId: data.result && data.result.id ? data.result.id : ''
      });
    } else {
      var errMsg = (data.errors && data.errors[0] && data.errors[0].message) || 'Cloudflare API 返回错误';
      res.status(500).json({ error: errMsg, details: data.errors });
    }
  } catch (err) {
    res.status(500).json({ error: 'Cloudflare 缓存清除失败：' + (err.message || '未知错误') });
  }
});

// 一键清除全部缓存（本地 + Cloudflare）
app.post('/api/admin/cache/purge-all', authMiddleware, async (req, res) => {
  // 1. 清除本地服务器缓存
  var localCleared = clearCache();

  // 2. 尝试清除 Cloudflare 缓存
  const db = loadDB();
  const apiToken = db.settings?.cloudflareApiToken || '';
  const zoneId = db.settings?.cloudflareZoneId || '';

  if (!apiToken || !zoneId) {
    // Cloudflare 未配置，只清除本地缓存
    return res.json({
      message: '本地缓存已清除（' + localCleared + ' 条）。Cloudflare 未配置，跳过边缘缓存清除。',
      localCleared: localCleared,
      cloudflare: 'not_configured'
    });
  }

  try {
    var https = require('https');
    var payload = JSON.stringify({ purge_everything: true });
    var options = {
      hostname: 'api.cloudflare.com',
      path: '/client/v4/zones/' + zoneId + '/purge_cache',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiToken,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    function callCF(agent) {
      return new Promise(function (resolve, reject) {
        var reqOpts = options;
        if (agent) reqOpts = Object.assign({}, options, { agent: agent });
        var cfReq = https.request(reqOpts, function (cfRes) {
          var body = '';
          cfRes.on('data', function (chunk) { body += chunk; });
          cfRes.on('end', function () {
            try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('CF响应解析失败')); }
          });
        });
        cfReq.on('error', function (err) { reject(err); });
        cfReq.write(payload);
        cfReq.end();
      });
    }

    var proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || '';
    var proxyAgent = null;
    if (proxyUrl) {
      try {
        var HttpsProxyAgent = require('https-proxy-agent');
        proxyAgent = new HttpsProxyAgent(proxyUrl);
      } catch (e) {}
    }

    var data = await callCF(proxyAgent);
    if (data.success) {
      res.json({
        message: '全部缓存已清除（本地 ' + localCleared + ' 条 + Cloudflare 边缘缓存）',
        localCleared: localCleared,
        cloudflare: 'success'
      });
    } else {
      var errMsg = (data.errors && data.errors[0] && data.errors[0].message) || 'Cloudflare API 错误';
      res.json({
        message: '本地缓存已清除（' + localCleared + ' 条）。Cloudflare 清除失败：' + errMsg,
        localCleared: localCleared,
        cloudflare: 'failed',
        cloudflareError: errMsg
      });
    }
  } catch (err) {
    res.json({
      message: '本地缓存已清除（' + localCleared + ' 条）。Cloudflare 连接失败：' + (err.message || ''),
      localCleared: localCleared,
      cloudflare: 'error'
    });
  }
});

// ============ 认证接口 ============
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const db = loadDB();
  if (username !== db.admin.username) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  if (!bcrypt.compareSync(password, db.admin.password)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = jwt.sign({ username, role: 'admin' }, SECRET_KEY, { expiresIn: '24h' });
  res.json({ token, username });
});

app.get('/api/auth/verify', authMiddleware, (req, res) => {
  res.json({ valid: true, username: req.user.username });
});

// ============ 前台用户接口 ============
app.post('/api/user/register', (req, res) => {
  const db = loadDB();
  const { username, password } = req.body;
  const name = String(username || '').trim();
  if (!name || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (name.length < 3) {
    return res.status(400).json({ error: '用户名至少需要 3 个字符' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: '密码至少需要 6 位' });
  }
  if (db.users.some(user => user.username === name)) {
    return res.status(400).json({ error: '用户名已存在' });
  }
  const salt = bcrypt.genSaltSync(10);
  const user = {
    id: Date.now().toString(),
    username: name,
    password: bcrypt.hashSync(password, salt),
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  saveDB(db);
  const token = jwt.sign({ username: name, type: 'user' }, SECRET_KEY, { expiresIn: '7d' });
  res.status(201).json({ token, username: name, role: 'user' });
});

app.post('/api/user/login', (req, res) => {
  const db = loadDB();
  const { username, password } = req.body;
  const name = String(username || '').trim();
  if (name === db.admin.username && bcrypt.compareSync(password || '', db.admin.password)) {
    const token = jwt.sign({ username: db.admin.username, type: 'user', role: 'admin' }, SECRET_KEY, { expiresIn: '7d' });
    return res.json({ token, username: db.admin.username, role: 'admin', nickname: '' });
  }
  const user = db.users.find(item => item.username === name);
  if (!user || !bcrypt.compareSync(password || '', user.password)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  if (user.disabled) {
    return res.status(403).json({ error: '该账号已被禁用，请联系管理员' });
  }
  // 登录时读取数据库中的最新角色，使被提升为管理员的乡亲立即获得管理员权限
  const role = user.role === 'admin' ? 'admin' : 'user';
  user.lastLoginAt = new Date().toISOString();
  saveDB(db);
  const token = jwt.sign({ username: user.username, type: 'user', role: role }, SECRET_KEY, { expiresIn: '7d' });
  res.json({ token, username: user.username, role: role, nickname: user.nickname || '' });
});

app.get('/api/user/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    if (decoded.type !== 'user') return res.status(401).json({ error: '登录令牌无效' });
    // 从数据库读取最新角色与昵称，避免令牌过期前角色/昵称变更不生效
    const db = loadDB();
    if (decoded.role === 'admin' && decoded.username === db.admin.username) {
      const result = { username: decoded.username, role: 'admin', nickname: '' };
      const approvedRequest = (db.genealogyPasswordRequests || []).find(function (r) {
        return r.username === decoded.username && r.status === 'approved' && r.approvedPassword;
      });
      if (approvedRequest) result.genealogyPassword = approvedRequest.approvedPassword;
      return res.json(result);
    }
    const user = (db.users || []).find(function (u) { return u.username === decoded.username; });
    if (!user) return res.json({ username: decoded.username, role: decoded.role || 'user', nickname: '' });
    if (user.disabled) return res.status(403).json({ error: '该账号已被禁用' });
    const result = { username: user.username, role: user.role === 'admin' ? 'admin' : 'user', nickname: user.nickname || '' };
    const approvedRequest = (db.genealogyPasswordRequests || []).find(function (r) {
      return r.username === decoded.username && r.status === 'approved' && r.approvedPassword;
    });
    if (approvedRequest) result.genealogyPassword = approvedRequest.approvedPassword;
    res.json(result);
  } catch (e) {
    res.status(401).json({ error: '登录令牌无效' });
  }
});

// 前台用户：查看自己的投稿记录
app.get('/api/user/submissions', userAuthMiddleware, (req, res) => {
  const db = loadDB();
  const username = req.user.username;
  const list = db.posts
    .filter(post => post.submittedBy === username)
    .sort((a, b) => new Date(b.submittedAt || b.createdAt) - new Date(a.submittedAt || a.createdAt))
    .map(({ content, ...rest }) => rest);
  res.json(list);
});

// 前台用户：提交文章投稿，默认待管理员审核，审核通过后才会在前台展示
// 被管理员提升为「管理员角色」的乡亲，投稿后直接发布到前台，无需审核
app.post('/api/user/submissions', userAuthMiddleware, (req, res) => {
  const db = loadDB();
  const title = String(req.body.title || '').trim();
  const summary = String(req.body.summary || '').trim();
  const content = String(req.body.content || '').trim();
  const category = String(req.body.category || '投稿').trim() || '投稿';
  const rawTags = Array.isArray(req.body.tags)
    ? req.body.tags
    : String(req.body.tags || '').split(/[,，]/);
  const tags = rawTags.map(t => String(t || '').trim()).filter(Boolean).slice(0, 8);

  if (!title) return res.status(400).json({ error: '投稿标题不能为空' });
  if (!content) return res.status(400).json({ error: '投稿正文不能为空' });
  if (title.length > 80) return res.status(400).json({ error: '标题不能超过 80 个字符' });
  if (summary.length > 300) return res.status(400).json({ error: '摘要不能超过 300 个字符' });
  if (content.length > 20000) return res.status(400).json({ error: '正文不能超过 20000 个字符' });

  // 读取数据库中的最新角色，决定是否直接发布
  var currentUser = (db.users || []).find(function (u) { return u.username === req.user.username; });
  var isPublisher = (req.user.role === 'admin') || (currentUser && currentUser.role === 'admin' && !currentUser.disabled);

  const post = {
    id: Date.now().toString() + '-' + Math.random().toString(16).slice(2, 8),
    title,
    summary,
    content: sanitizeUserHtml(content),
    cover: '',
    author: req.user.username,
    category,
    tags,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    views: 0,
    published: isPublisher ? true : false,
    pinned: false,
    announcement: false,
    showOnHome: true,
    reviewStatus: isPublisher ? 'approved' : 'pending',
    submittedBy: req.user.username,
    submittedAt: new Date().toISOString(),
    reviewedAt: isPublisher ? new Date().toISOString() : '',
    reviewer: isPublisher ? 'self(admin-role)' : '',
    rejectionReason: ''
  };

  db.posts.push(post);
  if (!db.categories.includes(category)) db.categories.push(category);
  tags.forEach(t => { if (!db.tags.includes(t)) db.tags.push(t); });
  saveDB(db);
  clearCacheAfterMutation('meta');
  res.status(201).json({
    message: isPublisher ? '文章已直接发布' : '投稿已提交，请等待管理员审核',
    submission: { ...post, content: undefined }
  });
});

// 前台用户：更新个人资料（昵称）
app.put('/api/user/profile', userAuthMiddleware, (req, res) => {
  const db = loadDB();
  const user = (db.users || []).find(function (u) { return u.username === req.user.username; });
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (req.body.nickname !== undefined) {
    user.nickname = String(req.body.nickname).trim().slice(0, 20);
  }
  saveDB(db);
  res.json({ username: user.username, nickname: user.nickname || '', role: user.role || 'user' });
});

// ============ 点赞 / 收藏接口 ============
// 获取当前用户的点赞和收藏 ID 列表（用于文章详情页按钮初始化）
app.get('/api/user/interactions', userAuthMiddleware, (req, res) => {
  const db = loadDB();
  const username = req.user.username;
  const likedPostIds = db.likes.filter(l => l.username === username).map(l => l.postId);
  const favoritedPostIds = db.favorites.filter(f => f.username === username).map(f => f.postId);
  res.json({ likedPostIds, favoritedPostIds });
});

// 切换点赞
app.post('/api/user/likes/:postId', userAuthMiddleware, (req, res) => {
  const db = loadDB();
  const username = req.user.username;
  const postId = String(req.params.postId || '');
  const post = db.posts.find(p => String(p.id) === postId);
  if (!post) return res.status(404).json({ error: '文章不存在' });
  if (post.published === false) return res.status(403).json({ error: '该文章已下架' });

  const idx = db.likes.findIndex(l => l.username === username && l.postId === postId);
  if (idx !== -1) {
    db.likes.splice(idx, 1);
    saveDB(db);
    res.json({ liked: false, message: '已取消点赞' });
  } else {
    db.likes.push({ username, postId, createdAt: new Date().toISOString() });
    saveDB(db);
    res.json({ liked: true, message: '点赞成功' });
  }
});

// 切换收藏
app.post('/api/user/favorites/:postId', userAuthMiddleware, (req, res) => {
  const db = loadDB();
  const username = req.user.username;
  const postId = String(req.params.postId || '');
  const post = db.posts.find(p => String(p.id) === postId);
  if (!post) return res.status(404).json({ error: '文章不存在' });
  if (post.published === false) return res.status(403).json({ error: '该文章已下架' });

  const idx = db.favorites.findIndex(f => f.username === username && f.postId === postId);
  if (idx !== -1) {
    db.favorites.splice(idx, 1);
    saveDB(db);
    res.json({ favorited: false, message: '已取消收藏' });
  } else {
    db.favorites.push({ username, postId, createdAt: new Date().toISOString() });
    saveDB(db);
    res.json({ favorited: true, message: '收藏成功' });
  }
});

// 获取当前用户点赞的文章列表
app.get('/api/user/likes', userAuthMiddleware, (req, res) => {
  const db = loadDB();
  const username = req.user.username;
  // 构建 postId -> post 索引，避免 N 次线性查找
  var postMap = {};
  for (var i = 0; i < db.posts.length; i++) {
    postMap[String(db.posts[i].id)] = db.posts[i];
  }
  const likedPostIds = db.likes
    .filter(l => l.username === username)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(l => l.postId);
  const posts = likedPostIds
    .map(id => postMap[String(id)])
    .filter(p => p && p.published !== false)
    .map(({ content, ...rest }) => rest);
  res.json(posts);
});

// 获取当前用户收藏的文章列表
app.get('/api/user/favorites', userAuthMiddleware, (req, res) => {
  const db = loadDB();
  const username = req.user.username;
  // 构建 postId -> post 索引，避免 N 次线性查找
  var postMap = {};
  for (var i = 0; i < db.posts.length; i++) {
    postMap[String(db.posts[i].id)] = db.posts[i];
  }
  const favoritedPostIds = db.favorites
    .filter(f => f.username === username)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(f => f.postId);
  const posts = favoritedPostIds
    .map(id => postMap[String(id)])
    .filter(p => p && p.published !== false)
    .map(({ content, ...rest }) => rest);
  res.json(posts);
});

// ============ 健康检查接口 ============
// 轻量级健康检查，用于负载均衡和监控，不走缓存和限流
app.get('/health', function (req, res) {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ status: 'ok', uptime: process.uptime(), memory: process.memoryUsage().heapUsed });
});

// ============ 文章接口 ============
// 获取文章列表（前台，只返回已发布的）
// ===== 性能优化：使用预构建索引，避免每次请求 filter + sort =====
app.get('/api/posts', (req, res) => {
  const db = loadDB();
  var { category, tag, search, home } = req.query;
  // 双重解码：前端对 category/search/tag 额外 encodeURIComponent 了一次
  // Express 的 query parser 已经解码一次，这里再解码一次得到原始中文
  // 原因：沙箱代理会解码 percent-encoded 中文字符为原始 UTF-8 字节，导致 Node.js HTTP parser 返回 400
  function safeDecode(s) {
    if (!s || typeof s !== 'string') return s;
    try {
      var decoded = decodeURIComponent(s);
      if (decoded === s) return s;
      return decoded;
    } catch (e) {
      return s;
    }
  }
  if (category) category = safeDecode(category);
  if (tag) tag = safeDecode(tag);
  if (search) search = safeDecode(search);
  var posts;

  // 优先使用预构建的已发布文章索引（已预排序，O(1) 查找）
  if (category && db._publishedPostsByCategory && db._publishedPostsByCategory[category]) {
    posts = db._publishedPostsByCategory[category];
  } else if (tag && db._publishedPostsByTag && db._publishedPostsByTag[tag]) {
    posts = db._publishedPostsByTag[tag];
  } else if (db._publishedPosts) {
    posts = db._publishedPosts;
  } else {
    // 兜底：索引不可用时走全量过滤
    posts = db.posts.filter(function (p) { return p.published && !p.announcement; });
    posts = sortPostsForList(posts);
  }

  // home 过滤（从预排序数组中过滤，数量已大大减少）
  if (home === '1' || home === 'true') {
    posts = posts.filter(function (p) { return p.showOnHome === true; });
  }

  // ===== 性能优化：搜索使用倒排索引 + 打分排序 =====
  if (search) {
    posts = searchPosts(posts, search, db);
  }

  // 列表不返回完整 content，但附带正文首图（供无封面图时抽取显示）
  const list = posts.map(({ content, ...rest }) => {
    const firstImage = extractFirstImage(content);
    return firstImage ? { ...rest, firstImage } : rest;
  });
  res.json(list);
});

// 获取网站公告（前台主页独立显示，与普通文章列表区分）
// ===== 性能优化：使用预构建的 _publishedAnnouncements 列表 =====
app.get('/api/announcements', (req, res) => {
  const db = loadDB();
  const limit = Math.max(1, Math.min(20, Number(req.query.limit) || 5));
  const announcements = db._publishedAnnouncements || sortPostsForList(db.posts.filter(p => p.published && p.announcement));
  const list = announcements.slice(0, limit).map(({ content, ...rest }) => {
    const firstImage = extractFirstImage(content);
    return firstImage ? { ...rest, firstImage } : rest;
  });
  res.json(list);
});

// 获取单篇文章
// ===== 性能优化：使用 _postIndex O(1) 查找 =====
app.get('/api/posts/:id', (req, res) => {
  const db = loadDB();
  const post = db._postIndex ? db._postIndex[String(req.params.id)] : db.posts.find(p => p.id === req.params.id);
  if (!post || !post.published) {
    return res.status(404).json({ error: '文章不存在' });
  }
  // 浏览量批量延迟写入，避免每次访问都写磁盘
  pendingViewIncrements[String(post.id)] = (pendingViewIncrements[String(post.id)] || 0) + 1;
  scheduleViewFlush();
  // 返回时加上待写入的浏览量增量，保证用户看到的数字是最新的
  const pendingInc = pendingViewIncrements[String(post.id)] || 0;
  res.json(Object.assign({}, post, { views: (post.views || 0) + pendingInc }));
});

// ===== 广告管理 API =====
// 前台获取广告列表
app.get('/api/ads', (req, res) => {
  const db = loadDB();
  const ads = (db.ads || []).filter(a => a.active);
  res.json(ads.map(a => ({
    id: a.id, position: a.position, type: a.type, title: a.title,
    content: a.content, imageUrl: a.imageUrl, link: a.link,
    active: a.active, format: a.format
  })));
});

// 后台获取所有广告
app.get('/api/admin/ads', authMiddleware, (req, res) => {
  const db = loadDB();
  res.json(db.ads || []);
});

// 后台创建广告
app.post('/api/admin/ads', authMiddleware, (req, res) => {
  const db = loadDB();
  if (!db.ads) db.ads = [];
  const { position, type, title, content, imageUrl, link, format } = req.body;
  if (!position || !type) return res.status(400).json({ error: '广告位置和类型必填' });
  const ad = {
    id: Date.now().toString(),
    position: String(position).trim(),
    type: String(type).trim(),
    title: String(title || '').trim(),
    content: String(content || '').trim(),
    imageUrl: String(imageUrl || '').trim(),
    link: String(link || '').trim(),
    format: String(format || 'banner').trim(),
    active: true,
    createdAt: new Date().toISOString()
  };
  db.ads.push(ad);
  saveDB(db);
  res.status(201).json(ad);
});

// 后台更新广告
app.put('/api/admin/ads/:id', authMiddleware, (req, res) => {
  const db = loadDB();
  if (!db.ads) db.ads = [];
  const ad = db.ads.find(a => a.id === req.params.id);
  if (!ad) return res.status(404).json({ error: '广告不存在' });
  const { position, type, title, content, imageUrl, link, format, active } = req.body;
  if (position !== undefined) ad.position = String(position).trim();
  if (type !== undefined) ad.type = String(type).trim();
  if (title !== undefined) ad.title = String(title).trim();
  if (content !== undefined) ad.content = String(content).trim();
  if (imageUrl !== undefined) ad.imageUrl = String(imageUrl).trim();
  if (link !== undefined) ad.link = String(link).trim();
  if (format !== undefined) ad.format = String(format).trim();
  if (active !== undefined) ad.active = Boolean(active);
  saveDB(db);
  res.json(ad);
});

// 后台删除广告
app.delete('/api/admin/ads/:id', authMiddleware, (req, res) => {
  const db = loadDB();
  if (!db.ads) db.ads = [];
  const idx = db.ads.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '广告不存在' });
  db.ads.splice(idx, 1);
  saveDB(db);
  res.json({ message: '删除成功' });
});

// 后台：获取所有文章（含未发布），支持分页、搜索、筛选
app.get('/api/admin/posts', authMiddleware, (req, res) => {
  const db = loadDB();
  let posts = db.posts.slice();

  // 状态筛选
  const status = String(req.query.status || 'all').trim();
  if (status === 'published') {
    posts = posts.filter(p => p.published);
  } else if (status === 'draft') {
    posts = posts.filter(p => !p.published);
  }

  // 分类筛选
  const category = String(req.query.category || '').trim();
  if (category) {
    posts = posts.filter(p => p.category === category);
  }

  // 标签筛选
  const tag = String(req.query.tag || '').trim();
  if (tag) {
    posts = posts.filter(p => Array.isArray(p.tags) && p.tags.includes(tag));
  }

  // 搜索筛选（标题、摘要、内容）
  const search = String(req.query.search || '').trim();
  if (search) {
    const lowerSearch = search.toLowerCase();
    posts = posts.filter(p => {
      return (p.title && p.title.toLowerCase().includes(lowerSearch)) ||
             (p.summary && p.summary.toLowerCase().includes(lowerSearch)) ||
             (p.content && p.content.toLowerCase().includes(lowerSearch));
    });
  }

  // 排序
  posts = sortPostsForList(posts);

  // 分页
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
  const total = posts.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const paginatedPosts = posts.slice(start, start + pageSize);

  const list = paginatedPosts.map(({ content, ...rest }) => rest);
  res.json({
    posts: list,
    total: total,
    page: page,
    pageSize: pageSize,
    totalPages: totalPages
  });
});

// 后台：获取用户投稿列表
app.get('/api/admin/submissions', authMiddleware, (req, res) => {
  const db = loadDB();
  const status = String(req.query.status || '').trim();
  let submissions = db.posts.filter(post => post.submittedBy || ['pending', 'approved', 'rejected'].includes(post.reviewStatus));
  if (['pending', 'approved', 'rejected'].includes(status)) {
    submissions = submissions.filter(post => (post.reviewStatus || (post.published ? 'approved' : 'pending')) === status);
  }
  submissions = submissions
    .sort((a, b) => new Date(b.submittedAt || b.createdAt) - new Date(a.submittedAt || a.createdAt))
    .map(({ content, ...rest }) => rest);
  res.json(submissions);
});

// 后台：审核用户投稿。通过后会正式发布到前台，不通过则继续隐藏。
app.patch('/api/admin/submissions/:id/status', authMiddleware, (req, res) => {
  const db = loadDB();
  const post = db.posts.find(item => String(item.id) === String(req.params.id));
  if (!post || !post.submittedBy) return res.status(404).json({ error: '投稿不存在' });
  const status = String(req.body.status || '').trim();
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: '审核状态无效' });
  }
  post.reviewStatus = status;
  post.published = status === 'approved';
  post.reviewedAt = new Date().toISOString();
  post.reviewer = req.user.username || 'admin';
  post.rejectionReason = status === 'rejected' ? String(req.body.reason || '').trim() : '';
  post.updatedAt = new Date().toISOString();
  saveDB(db);
  clearCacheAfterMutation('posts');
  res.json(post);
});

// 后台：获取单篇文章
app.get('/api/admin/posts/:id', authMiddleware, (req, res) => {
  const db = loadDB();
  const post = db.posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: '文章不存在' });
  res.json(post);
});

// 创建文章
app.post('/api/admin/posts', authMiddleware, (req, res) => {
  const db = loadDB();
  const { title, summary, content, cover, author, category, tags, published, pinned, announcement, showOnHome } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: '标题和内容不能为空' });
  }
  const post = {
    id: Date.now().toString(),
    title,
    summary: summary || '',
    content,
    cover: cover || '',
    author: author || 'Admin',
    category: category || '未分类',
    tags: tags || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    views: 0,
    published: published !== undefined ? published : true,
    pinned: !!pinned,
    announcement: !!announcement,
    showOnHome: !!showOnHome,
    reviewStatus: 'approved'
  };
  db.posts.push(post);
  // 更新分类和标签
  if (category && !db.categories.includes(category)) db.categories.push(category);
  if (tags) {
    tags.forEach(t => { if (!db.tags.includes(t)) db.tags.push(t); });
  }
  saveDB(db);
  clearCacheAfterMutation('posts');
  res.status(201).json(post);
});

// 更新文章
app.put('/api/admin/posts/:id', authMiddleware, (req, res) => {
  const db = loadDB();
  const idx = db.posts.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '文章不存在' });
  const { title, summary, content, cover, author, category, tags, published, pinned, announcement, showOnHome } = req.body;
  db.posts[idx] = {
    ...db.posts[idx],
    title: title !== undefined ? title : db.posts[idx].title,
    summary: summary !== undefined ? summary : db.posts[idx].summary,
    content: content !== undefined ? content : db.posts[idx].content,
    cover: cover !== undefined ? cover : db.posts[idx].cover,
    author: author !== undefined ? author : db.posts[idx].author,
    category: category !== undefined ? category : db.posts[idx].category,
    tags: tags !== undefined ? tags : db.posts[idx].tags,
    published: published !== undefined ? published : db.posts[idx].published,
    pinned: pinned !== undefined ? !!pinned : !!db.posts[idx].pinned,
    announcement: announcement !== undefined ? !!announcement : !!db.posts[idx].announcement,
    showOnHome: showOnHome !== undefined ? !!showOnHome : db.posts[idx].showOnHome === true,
    updatedAt: new Date().toISOString()
  };
  if (category && !db.categories.includes(category)) db.categories.push(category);
  if (tags) {
    tags.forEach(t => { if (!db.tags.includes(t)) db.tags.push(t); });
  }
  saveDB(db);
  clearCacheAfterMutation('posts');
  res.json(db.posts[idx]);
});

// 删除文章
app.delete('/api/admin/posts/:id', authMiddleware, (req, res) => {
  const db = loadDB();
  const idx = db.posts.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '文章不存在' });
  db.posts.splice(idx, 1);
  saveDB(db);
  clearCacheAfterMutation('posts');
  res.json({ message: '删除成功' });
});

// 后台：批量操作文章
app.post('/api/admin/posts/batch', authMiddleware, (req, res) => {
  const db = loadDB();
  const action = String(req.body.action || '').trim();
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];
  if (!ids.length) {
    return res.status(400).json({ error: '请选择要操作的文章' });
  }
  const validActions = ['delete', 'publish', 'draft', 'pin', 'unpin'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: '无效的操作类型' });
  }
  let updated = 0;
  const now = new Date().toISOString();
  if (action === 'delete') {
    for (var i = db.posts.length - 1; i >= 0; i--) {
      if (ids.includes(String(db.posts[i].id))) {
        db.posts.splice(i, 1);
        updated++;
      }
    }
  } else {
    for (var j = 0; j < db.posts.length; j++) {
      if (ids.includes(String(db.posts[j].id))) {
        if (action === 'publish') {
          db.posts[j].published = true;
        } else if (action === 'draft') {
          db.posts[j].published = false;
        } else if (action === 'pin') {
          db.posts[j].pinned = true;
        } else if (action === 'unpin') {
          db.posts[j].pinned = false;
        }
        db.posts[j].updatedAt = now;
        updated++;
      }
    }
  }
  saveDB(db);
  clearCacheAfterMutation('posts');
  res.json({ success: true, updated: updated });
});

// 后台：上传文章图片，返回可插入正文的图片地址
app.post('/api/admin/uploads/images', authMiddleware, articleImageMiddleware, (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请先选择要上传的图片' });
  const url = fileToArticleImagePath(req.file);
  res.status(201).json({ url, html: '<p><img src="' + url + '" alt="文章图片"></p>' });
});

// 前台用户：上传投稿图片，返回可插入正文的图片地址（与后台编辑器体验一致）
app.post('/api/user/uploads/images', userAuthMiddleware, articleImageMiddleware, (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请先选择要上传的图片' });
  const url = fileToArticleImagePath(req.file);
  res.status(201).json({ url, html: '<p><img src="' + url + '" alt="投稿图片"></p>' });
});

// 后台：上传默认封面图（未上传封面图文章的全局默认封面）
app.post('/api/admin/uploads/default-cover', authMiddleware, articleImageMiddleware, (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请先选择要上传的图片' });
  const url = fileToArticleImagePath(req.file);
  // 清除旧的默认封面文件
  const db = loadDB();
  const oldCover = db.settings?.defaultCover || '';
  if (oldCover && oldCover.startsWith('/uploads/') && oldCover !== url) {
    removeLocalUpload(oldCover);
  }
  db.settings.defaultCover = url;
  db.settings.updatedAt = new Date().toISOString();
  saveDB(db);
  clearCacheAfterMutation('settings');
  res.status(201).json({ url });
});

// 获取统计数据
app.get('/api/admin/stats', authMiddleware, (req, res) => {
  const db = loadDB();
  // 单次遍历完成所有统计，避免多次 filter/reduce
  var totalPosts = db.posts.length;
  var publishedPosts = 0;
  var pendingSubmissions = 0;
  var totalViews = 0;
  var last7DaysMap = {};
  var now = Date.now();
  for (var i = 6; i >= 0; i--) {
    var d = new Date(now - i * 86400000);
    last7DaysMap[d.toISOString().split('T')[0]] = 0;
  }
  for (var j = 0; j < db.posts.length; j++) {
    var p = db.posts[j];
    if (p.published) publishedPosts++;
    if (p.submittedBy && (p.reviewStatus || 'pending') === 'pending') pendingSubmissions++;
    totalViews += (p.views || 0);
    var day = (p.createdAt || '').split('T')[0];
    if (last7DaysMap.hasOwnProperty(day)) last7DaysMap[day]++;
  }
  var last7Days = Object.keys(last7DaysMap).map(function (date) {
    return { date: date, count: last7DaysMap[date] };
  });
  const totalCategories = db.categories.length;
  const totalTags = db.tags.length;
  // 族谱待审核数
  var pendingGenealogy = 0;
  if (Array.isArray(db.genealogy)) {
    for (var gi = 0; gi < db.genealogy.length; gi++) {
      if ((db.genealogy[gi].reviewStatus || 'approved') === 'pending') pendingGenealogy++;
    }
  }
  // 族谱总人数
  var totalGenealogy = Array.isArray(db.genealogy) ? db.genealogy.length : 0;
  // 留言待审核数
  var pendingComments = 0;
  var totalComments = 0;
  if (Array.isArray(db.comments)) {
    for (var ci = 0; ci < db.comments.length; ci++) {
      totalComments++;
      if (db.comments[ci].status === 'pending') pendingComments++;
    }
  }
  // 族谱密码申请待审核数
  var pendingPwdRequests = 0;
  var totalPwdRequests = 0;
  if (Array.isArray(db.genealogyPasswordRequests)) {
    for (var ri = 0; ri < db.genealogyPasswordRequests.length; ri++) {
      totalPwdRequests++;
      if (db.genealogyPasswordRequests[ri].status === 'pending') pendingPwdRequests++;
    }
  }
  // 用户总数
  var totalUsers = Array.isArray(db.users) ? db.users.length : 0;
  res.json({ totalPosts, publishedPosts, pendingSubmissions, pendingGenealogy, totalGenealogy, pendingComments, totalComments, pendingPwdRequests, totalPwdRequests, totalUsers, totalViews, totalCategories, totalTags, last7Days });
});

// 获取分类和标签
app.get('/api/meta', (req, res) => {
  const db = loadDB();
  res.json({ categories: db.categories, tags: db.tags });
});

// 后台：分类管理
app.get('/api/admin/categories', authMiddleware, (req, res) => {
  const db = loadDB();
  // 单次遍历统计每个分类的文章数，避免对每个分类遍历全部文章
  var countMap = {};
  var i;
  for (i = 0; i < (db.categories || []).length; i++) {
    countMap[db.categories[i]] = 0;
  }
  for (i = 0; i < db.posts.length; i++) {
    var cat = db.posts[i].category;
    if (cat && countMap.hasOwnProperty(cat)) countMap[cat]++;
  }
  const categories = (db.categories || []).map(function (name) {
    return { name: name, postCount: countMap[name] };
  });
  res.json(categories);
});

app.post('/api/admin/categories', authMiddleware, (req, res) => {
  const db = loadDB();
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '分类名称不能为空' });
  if (name.length > 30) return res.status(400).json({ error: '分类名称不能超过 30 个字符' });
  if (db.categories.includes(name)) return res.status(400).json({ error: '分类已存在' });
  db.categories.push(name);
  saveDB(db);
  clearCacheAfterMutation('meta');
  res.status(201).json({ name, postCount: 0 });
});

app.put('/api/admin/categories/:name', authMiddleware, (req, res) => {
  const db = loadDB();
  const oldName = decodeURIComponent(req.params.name || '');
  const newName = String(req.body.name || '').trim();
  if (!oldName || !db.categories.includes(oldName)) return res.status(404).json({ error: '分类不存在' });
  if (!newName) return res.status(400).json({ error: '新分类名称不能为空' });
  if (newName.length > 30) return res.status(400).json({ error: '分类名称不能超过 30 个字符' });
  if (newName !== oldName && db.categories.includes(newName)) return res.status(400).json({ error: '新分类名称已存在' });
  db.categories = db.categories.map(item => item === oldName ? newName : item);
  db.posts = db.posts.map(post => post.category === oldName ? { ...post, category: newName, updatedAt: new Date().toISOString() } : post);
  saveDB(db);
  clearCacheAfterMutation('meta');
  res.json({ name: newName, postCount: db.posts.filter(post => post.category === newName).length });
});

app.delete('/api/admin/categories/:name', authMiddleware, (req, res) => {
  const db = loadDB();
  const name = decodeURIComponent(req.params.name || '');
  if (!name || !db.categories.includes(name)) return res.status(404).json({ error: '分类不存在' });
  const usedCount = db.posts.filter(post => post.category === name).length;
  if (usedCount > 0) return res.status(400).json({ error: '该分类下还有文章，不能删除。请先修改文章分类。' });
  db.categories = db.categories.filter(item => item !== name);
  saveDB(db);
  clearCacheAfterMutation('meta');
  res.json({ message: '删除成功' });
});

// 后台：标签管理
app.get('/api/admin/tags', authMiddleware, (req, res) => {
  const db = loadDB();
  // 单次遍历统计每个标签的文章数
  var countMap = {};
  var i, j;
  // 先加入独立标签列表中的标签（0 篇起步）
  if (db.tags && db.tags.length) {
    for (i = 0; i < db.tags.length; i++) {
      countMap[db.tags[i]] = 0;
    }
  }
  // 再统计文章中的标签
  for (i = 0; i < db.posts.length; i++) {
    var postTags = db.posts[i].tags || [];
    for (j = 0; j < postTags.length; j++) {
      var t = postTags[j];
      if (t) countMap[t] = (countMap[t] || 0) + 1;
    }
  }
  var tagNames = Object.keys(countMap).sort();
  var result = tagNames.map(function (name) {
    return { name: name, postCount: countMap[name] };
  });
  res.json(result);
});

app.post('/api/admin/tags', authMiddleware, (req, res) => {
  const db = loadDB();
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '标签名称不能为空' });
  if (name.length > 20) return res.status(400).json({ error: '标签名称不能超过 20 个字符' });
  // 检查是否已存在（从文章中收集已有标签）
  var exists = false;
  for (var i = 0; i < db.posts.length; i++) {
    var tags = db.posts[i].tags || [];
    if (tags.includes(name)) { exists = true; break; }
  }
  if (exists) return res.status(400).json({ error: '标签已存在' });
  // 标签不单独存储，添加标签 = 给最新文章打上标签？不对。
  // 标签系统是依附于文章的。这里我们创建一个"空标签"的概念：
  // 在 settings 中维护独立标签列表，或简单地不创建空标签。
  // 更合理的做法：标签只存在于文章的 tags 数组中。
  // 添加标签 = 在系统中登记一个标签（存入 db.tags 列表），但不与任何文章关联。
  if (!db.tags) db.tags = [];
  if (db.tags.includes(name)) return res.status(400).json({ error: '标签已存在' });
  db.tags.push(name);
  saveDB(db);
  clearCacheAfterMutation('meta');
  res.status(201).json({ name, postCount: 0 });
});

app.put('/api/admin/tags/:name', authMiddleware, (req, res) => {
  const db = loadDB();
  const oldName = decodeURIComponent(req.params.name || '');
  const newName = String(req.body.newName || '').trim();
  if (!oldName) return res.status(404).json({ error: '标签不存在' });
  if (!newName) return res.status(400).json({ error: '新标签名称不能为空' });
  if (newName.length > 20) return res.status(400).json({ error: '标签名称不能超过 20 个字符' });
  if (newName === oldName) return res.json({ name: newName, postCount: 0 });
  // 检查新名称是否已存在
  var exists = false;
  for (var i = 0; i < db.posts.length; i++) {
    var tags = db.posts[i].tags || [];
    if (tags.includes(newName)) { exists = true; break; }
  }
  if (!exists && db.tags && db.tags.includes(newName)) exists = true;
  if (exists) return res.status(400).json({ error: '新标签名称已存在' });
  // 更新所有文章中的标签
  var postCount = 0;
  for (var i = 0; i < db.posts.length; i++) {
    var postTags = db.posts[i].tags || [];
    var idx = postTags.indexOf(oldName);
    if (idx !== -1) {
      postTags[idx] = newName;
      db.posts[i].tags = postTags;
      db.posts[i].updatedAt = new Date().toISOString();
      postCount++;
    }
  }
  // 更新独立标签列表
  if (db.tags) {
    var tagIdx = db.tags.indexOf(oldName);
    if (tagIdx !== -1) {
      db.tags[tagIdx] = newName;
    }
  }
  saveDB(db);
  clearCacheAfterMutation('meta');
  res.json({ name: newName, postCount: postCount });
});

app.delete('/api/admin/tags/:name', authMiddleware, (req, res) => {
  const db = loadDB();
  const name = decodeURIComponent(req.params.name || '');
  if (!name) return res.status(404).json({ error: '标签不存在' });
  // 从所有文章中移除该标签
  for (var i = 0; i < db.posts.length; i++) {
    var tags = db.posts[i].tags || [];
    var idx = tags.indexOf(name);
    if (idx !== -1) {
      tags.splice(idx, 1);
      db.posts[i].tags = tags;
      db.posts[i].updatedAt = new Date().toISOString();
    }
  }
  // 从独立标签列表中移除
  if (db.tags) {
    db.tags = db.tags.filter(function (t) { return t !== name; });
  }
  saveDB(db);
  clearCacheAfterMutation('meta');
  res.json({ message: '删除成功' });
});

// 公开：获取站点设置
app.get('/api/settings', (req, res) => {
  const db = loadDB();
  res.json({
    siteName: db.settings?.siteName || '麦氏乡村',
    siteSubtitle: db.settings?.siteSubtitle || '记录麦氏家族族谱传承、乡村风貌与乡亲故事',
    description: db.settings?.description || '',
    logo: db.settings?.logo || '',
    footerText: db.settings?.footerText || '',
    navLinks: db.settings?.navLinks || [],
    defaultCover: db.settings?.defaultCover || '',
    displayMode: db.settings?.displayMode || 'default',
    maintenanceMode: db.settings?.maintenanceMode || false,
    maintenanceMessage: db.settings?.maintenanceMessage || '网站维护中，敬请谅解'
  });
});

// 公开：合并接口（settings + meta），减少首页 API 往返
app.get('/api/bootstrap', (req, res) => {
  const db = loadDB();
  var categories = [];
  if (db._categoryList) categories = db._categoryList;
  else if (Array.isArray(db.categories)) categories = db.categories;
  res.json({
    settings: {
      siteName: db.settings?.siteName || '麦氏乡村',
      siteSubtitle: db.settings?.siteSubtitle || '记录麦氏家族族谱传承、乡村风貌与乡亲故事',
      description: db.settings?.description || '',
      logo: db.settings?.logo || '',
      footerText: db.settings?.footerText || '',
      navLinks: db.settings?.navLinks || [],
      defaultCover: db.settings?.defaultCover || '',
      displayMode: db.settings?.displayMode || 'default',
      maintenanceMode: db.settings?.maintenanceMode || false,
      maintenanceMessage: db.settings?.maintenanceMessage || '网站维护中，敬请谅解'
    },
    meta: { categories: categories, tags: db.tags || [] }
  });
});

// 公开：获取关于页面内容（含联系方式与赞助信息）
app.get('/api/about', (req, res) => {
  const db = loadDB();
  res.json({
    ...(db.settings.about || {}),
    contact: db.settings.contact || {},
    sponsor: db.settings.sponsor || {}
  });
});

// 前台：验证维护模式密码
app.post('/api/maintenance/verify-password', (req, res) => {
  const db = loadDB();
  const password = String(req.body.password || '').trim();
  const maintenancePassword = db.settings?.maintenancePassword || '';
  const maintenanceMode = db.settings?.maintenanceMode || false;

  if (!maintenanceMode) {
    return res.json({ success: true, message: '维护模式未开启' });
  }

  if (!maintenancePassword) {
    return res.status(400).json({ error: '维护密码未设置' });
  }

  if (password === maintenancePassword) {
    return res.json({ success: true, message: '验证成功' });
  } else {
    return res.status(401).json({ error: '密码错误' });
  }
});

// 后台：更新站点名称与 Logo
app.post('/api/admin/settings', authMiddleware, siteLogoMiddleware, (req, res) => {
  const db = loadDB();
  const siteName = String(req.body.siteName || db.settings?.siteName || '麦氏乡村').trim() || '麦氏乡村';
  const siteSubtitle = String(req.body.siteSubtitle || '').trim();
  const description = String(req.body.description || '').trim();
  const footerText = String(req.body.footerText || '').trim();
  const oldLogo = db.settings?.logo || '';
  const nextLogo = req.file ? fileToLogoPath(req.file) : oldLogo;
  if (req.file && oldLogo) removeLocalUpload(oldLogo);

  // 处理导航链接
  let navLinks = db.settings?.navLinks || [];
  if (req.body.navLinks !== undefined) {
    try {
      navLinks = typeof req.body.navLinks === 'string' ? JSON.parse(req.body.navLinks) : req.body.navLinks;
      if (!Array.isArray(navLinks)) navLinks = [];
    } catch (e) {
      navLinks = db.settings?.navLinks || [];
    }
  }

  // 处理默认封面图（未上传封面图文章的全局默认封面）
  let defaultCover = db.settings?.defaultCover || '';
  if (req.body.defaultCover !== undefined) {
    const newCover = String(req.body.defaultCover).trim();
    // 清除旧的上传文件（仅当从上传文件切换到空或其他值时）
    if (defaultCover && defaultCover.startsWith('/uploads/') && defaultCover !== newCover) {
      removeLocalUpload(defaultCover);
    }
    defaultCover = newCover;
  }

  // 处理显示模式（五种：默认、传统列表、固定网格卡片、瀑布流、杂志混合布局）
  const VALID_DISPLAY_MODES = ['default', 'list', 'grid', 'waterfall', 'magazine'];
  let displayMode = db.settings?.displayMode || 'default';
  if (req.body.displayMode !== undefined) {
    const mode = String(req.body.displayMode).trim();
    displayMode = VALID_DISPLAY_MODES.includes(mode) ? mode : 'default';
  }

  // 处理维护模式
  let maintenanceMode = db.settings?.maintenanceMode || false;
  let maintenancePassword = db.settings?.maintenancePassword || '';
  let maintenanceMessage = db.settings?.maintenanceMessage || '网站维护中，敬请谅解';
  if (req.body.maintenanceMode !== undefined) {
    maintenanceMode = req.body.maintenanceMode === 'true' || req.body.maintenanceMode === true;
  }
  if (req.body.maintenancePassword !== undefined) {
    maintenancePassword = String(req.body.maintenancePassword || '').trim();
  }
  if (req.body.maintenanceMessage !== undefined) {
    maintenanceMessage = String(req.body.maintenanceMessage || '').trim() || '网站维护中，敬请谅解';
  }

  db.settings = {
    ...(db.settings || {}),
    siteName,
    siteSubtitle,
    description,
    footerText,
    logo: nextLogo,
    navLinks,
    defaultCover,
    displayMode,
    maintenanceMode,
    maintenancePassword,
    maintenanceMessage,
    updatedAt: new Date().toISOString()
  };
  saveDB(db);
  clearCacheAfterMutation('settings');
  res.json(db.settings);
});

// 后台：保存关于页面内容，正文支持 HTML
app.post('/api/admin/about', authMiddleware, (req, res) => {
  const db = loadDB();
  db.settings = db.settings || {};
  db.settings.about = {
    kicker: String(req.body.kicker || 'About').trim() || 'About',
    title: String(req.body.title || '关于本站').trim() || '关于本站',
    summary: String(req.body.summary || '').trim(),
    content: String(req.body.content || '')
  };
  db.settings.updatedAt = new Date().toISOString();
  saveDB(db);
  clearCacheAfterMutation('settings');
  res.json(db.settings.about);
});

// 后台：保存联系方式
app.post('/api/admin/contact', authMiddleware, (req, res) => {
  const db = loadDB();
  db.settings = db.settings || {};
  db.settings.contact = {
    email: String(req.body.email || '').trim(),
    wechat: String(req.body.wechat || '').trim(),
    qq: String(req.body.qq || '').trim(),
    phone: String(req.body.phone || '').trim(),
    address: String(req.body.address || '').trim()
  };
  db.settings.updatedAt = new Date().toISOString();
  saveDB(db);
  clearCacheAfterMutation('settings');
  res.json(db.settings.contact);
});

// 后台：保存赞助设置
app.post('/api/admin/sponsor', authMiddleware, (req, res) => {
  const db = loadDB();
  db.settings = db.settings || {};
  db.settings.sponsor = {
    description: String(req.body.description || '').trim(),
    wechatQr: String(req.body.wechatQr || '').trim(),
    alipayQr: String(req.body.alipayQr || '').trim(),
    code: String(req.body.code || '').trim()
  };
  db.settings.updatedAt = new Date().toISOString();
  saveDB(db);
  clearCacheAfterMutation('settings');
  res.json(db.settings.sponsor);
});

// ============ 留言接口 ============
// 公开：获取已审核通过的留言，支持主页和文章留言分页
app.get('/api/comments', (req, res) => {
  const db = loadDB();
  const settings = getCommentSettings(db);
  const targetType = req.query.targetType === 'post' ? 'post' : 'home';
  const postId = String(req.query.postId || '').trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const defaultLimit = targetType === 'home' ? settings.homepagePageSize : settings.postPageSize;
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || defaultLimit));

  let comments = db.comments.filter(comment => comment.status === 'approved' && comment.targetType === targetType);
  if (targetType === 'post') {
    comments = comments.filter(comment => String(comment.postId || '') === postId);
  }

  comments = comments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const total = comments.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  res.json({
    comments: comments.slice(start, start + limit).map(sanitizePublicComment),
    page,
    limit,
    total,
    totalPages
  });
});

// 公开：提交留言，游客和登录用户均可提交；命中关键词进入待审核
app.post('/api/comments', (req, res) => {
  const db = loadDB();
  const settings = getCommentSettings(db);
  const user = optionalUser(req);
  const targetType = req.body.targetType === 'post' ? 'post' : 'home';
  const postId = String(req.body.postId || '').trim();
  const content = String(req.body.content || '').trim();
  const authorName = user?.username || String(req.body.authorName || '').trim() || '游客';

  if (!content) return res.status(400).json({ error: '留言内容不能为空' });
  if (content.length > 1000) return res.status(400).json({ error: '留言内容不能超过 1000 字' });
  if (authorName.length > 30) return res.status(400).json({ error: '昵称不能超过 30 个字符' });
  if (targetType === 'post') {
    // ===== 性能优化：使用 _postIndex O(1) 查找 =====
    const post = db._postIndex ? db._postIndex[String(postId)] : db.posts.find(item => String(item.id) === postId);
    if (!post || !post.published) return res.status(404).json({ error: '文章不存在，无法留言' });
  }

  const matchedKeywords = getMatchedKeywords(content, settings.blockedKeywords);
  const status = matchedKeywords.length ? 'pending' : 'approved';
  const comment = {
    id: Date.now().toString() + '-' + Math.random().toString(16).slice(2, 8),
    targetType,
    postId: targetType === 'post' ? postId : '',
    authorName,
    content,
    status,
    matchedKeywords,
    ip: req.ip || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  db.comments.push(comment);
  saveDB(db);
  clearCacheAfterMutation('comments');
  res.status(201).json({
    message: status === 'pending' ? '留言已提交，需管理员审核后显示' : '留言发布成功',
    comment: sanitizePublicComment(comment)
  });
});

// 后台：获取全部留言，包含待审核、已通过和不通过
app.get('/api/admin/comments', authMiddleware, (req, res) => {
  const db = loadDB();
  const status = String(req.query.status || '').trim();
  const targetType = String(req.query.targetType || '').trim();
  // 构建 postId -> title 索引，避免对每条评论线性查找文章
  var postTitleMap = {};
  for (var i = 0; i < db.posts.length; i++) {
    postTitleMap[String(db.posts[i].id)] = db.posts[i].title;
  }
  let comments = db.comments || [];
  if (['pending', 'approved', 'rejected'].includes(status)) {
    comments = comments.filter(comment => comment.status === status);
  }
  if (['home', 'post'].includes(targetType)) {
    comments = comments.filter(comment => comment.targetType === targetType);
  }
  comments = comments
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(comment => ({
      ...comment,
      targetTitle: comment.targetType === 'home'
        ? '网站主页留言区'
        : (postTitleMap[String(comment.postId)] || '文章留言区')
    }));
  res.json(comments);
});

// 后台：更新留言审核状态
app.patch('/api/admin/comments/:id/status', authMiddleware, (req, res) => {
  const db = loadDB();
  const comment = db.comments.find(item => String(item.id) === String(req.params.id));
  if (!comment) return res.status(404).json({ error: '留言不存在' });
  const status = String(req.body.status || '').trim();
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: '状态无效' });
  }
  comment.status = status;
  comment.updatedAt = new Date().toISOString();
  saveDB(db);
  clearCacheAfterMutation('comments');
  res.json(comment);
});

// 后台：删除留言
app.delete('/api/admin/comments/:id', authMiddleware, (req, res) => {
  const db = loadDB();
  const idx = db.comments.findIndex(item => String(item.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: '留言不存在' });
  db.comments.splice(idx, 1);
  saveDB(db);
  clearCacheAfterMutation('comments');
  res.json({ message: '删除成功' });
});

// 后台：批量操作留言
app.post('/api/admin/comments/batch', authMiddleware, (req, res) => {
  const db = loadDB();
  const action = String(req.body.action || '').trim();
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];
  if (!ids.length) {
    return res.status(400).json({ error: '请选择要操作的留言' });
  }
  const validActions = ['approve', 'reject', 'pending', 'delete'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: '无效的操作类型' });
  }
  let updated = 0;
  const now = new Date().toISOString();
  if (action === 'delete') {
    for (var i = db.comments.length - 1; i >= 0; i--) {
      if (ids.includes(String(db.comments[i].id))) {
        db.comments.splice(i, 1);
        updated++;
      }
    }
  } else {
    var statusMap = { approve: 'approved', reject: 'rejected', pending: 'pending' };
    var targetStatus = statusMap[action];
    for (var j = 0; j < db.comments.length; j++) {
      if (ids.includes(String(db.comments[j].id))) {
        db.comments[j].status = targetStatus;
        db.comments[j].updatedAt = now;
        updated++;
      }
    }
  }
  saveDB(db);
  clearCacheAfterMutation('comments');
  res.json({ success: true, updated: updated });
});

// 后台：读取留言设置
app.get('/api/admin/comment-settings', authMiddleware, (req, res) => {
  const db = loadDB();
  res.json(getCommentSettings(db));
});

// 后台：保存留言关键词与分页设置
app.post('/api/admin/comment-settings', authMiddleware, (req, res) => {
  const db = loadDB();
  db.settings = db.settings || {};
  db.settings.commentSettings = normalizeCommentSettings({
    blockedKeywords: req.body.blockedKeywords,
    homepagePageSize: req.body.homepagePageSize,
    postPageSize: req.body.postPageSize
  });
  db.settings.updatedAt = new Date().toISOString();
  saveDB(db);
  clearCacheAfterMutation('comments');
  res.json(db.settings.commentSettings);
});

// 后台：回复留言
app.post('/api/admin/comments/:id/reply', authMiddleware, (req, res) => {
  const db = loadDB();
  const comment = db.comments.find(item => String(item.id) === String(req.params.id));
  if (!comment) return res.status(404).json({ error: '留言不存在' });
  const reply = String(req.body.reply || '').trim();
  if (!reply) return res.status(400).json({ error: '回复内容不能为空' });
  if (reply.length > 1000) return res.status(400).json({ error: '回复内容不能超过 1000 字' });
  comment.reply = reply;
  comment.replyAt = new Date().toISOString();
  comment.updatedAt = new Date().toISOString();
  saveDB(db);
  clearCacheAfterMutation('comments');
  res.json(comment);
});

// 后台：删除留言回复
app.delete('/api/admin/comments/:id/reply', authMiddleware, (req, res) => {
  const db = loadDB();
  const comment = db.comments.find(item => String(item.id) === String(req.params.id));
  if (!comment) return res.status(404).json({ error: '留言不存在' });
  delete comment.reply;
  delete comment.replyAt;
  comment.updatedAt = new Date().toISOString();
  saveDB(db);
  clearCacheAfterMutation('comments');
  res.json({ message: '回复已删除' });
});

// ============ 友链接口 ============
// 前台：只展示审核通过且可见的友链
app.get('/api/friends', (req, res) => {
  const db = loadDB();
  const friends = db.friends
    .filter(friend => friend.status === 'approved' && friend.visible !== false)
    .sort((a, b) => {
      var sa = Number(a.sortOrder);
      var sb = Number(b.sortOrder);
      if (isFinite(sa) && isFinite(sb) && sa !== sb) return sa - sb;
      if (isFinite(sa) && !isFinite(sb)) return -1;
      if (!isFinite(sa) && isFinite(sb)) return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  res.json(friends);
});

// 前台：用户提交友链，默认进入待审核
app.post('/api/friends', friendAvatarMiddleware, (req, res) => {
  try {
    const db = loadDB();
    const { name, url, description, iconUrl } = req.body;
    const siteName = String(name || '').trim();
    const siteUrl = normalizeUrl(url);
    const siteDesc = String(description || '').trim();
    const siteIconUrl = normalizeUrl(iconUrl);

    if (!siteName || !siteUrl) {
      if (req.file) removeLocalAvatar(fileToAvatarPath(req.file));
      return res.status(400).json({ error: '站点名称和链接不能为空' });
    }

    try {
      new URL(siteUrl);
    } catch (e) {
      if (req.file) removeLocalAvatar(fileToAvatarPath(req.file));
      return res.status(400).json({ error: '请输入有效的链接地址' });
    }
    if (siteIconUrl) {
      try {
        new URL(siteIconUrl);
      } catch (e) {
        if (req.file) removeLocalAvatar(fileToAvatarPath(req.file));
        return res.status(400).json({ error: '请输入有效的小图标链接' });
      }
    }

    const friend = {
      id: Date.now().toString(),
      name: siteName,
      url: siteUrl,
      description: siteDesc || '这个朋友还没有留下签名',
      avatar: fileToAvatarPath(req.file),
      iconUrl: siteIconUrl,
      sortOrder: 0,
      status: 'pending',
      visible: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    db.friends.push(friend);
    saveDB(db);
    clearCacheAfterMutation('friends');
    res.status(201).json({ message: '友链已提交，请等待后台审核', friend });
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '头像图片不能大于 1MB' });
    }
    res.status(400).json({ error: err.message || '提交失败' });
  }
});

// 后台：获取全部友链
app.get('/api/admin/friends', authMiddleware, (req, res) => {
  const db = loadDB();
  const friends = db.friends.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(friends);
});

// 后台：添加友链，可直接审核通过
app.post('/api/admin/friends', authMiddleware, friendAvatarMiddleware, (req, res) => {
  try {
    const db = loadDB();
    const { name, url, description, iconUrl, status, visible } = req.body;
    const siteName = String(name || '').trim();
    const siteUrl = normalizeUrl(url);
    const siteIconUrl = normalizeUrl(iconUrl);
    if (!siteName || !siteUrl) {
      if (req.file) removeLocalAvatar(fileToAvatarPath(req.file));
      return res.status(400).json({ error: '站点名称和链接不能为空' });
    }
    try {
      new URL(siteUrl);
    } catch (e) {
      if (req.file) removeLocalAvatar(fileToAvatarPath(req.file));
      return res.status(400).json({ error: '请输入有效的链接地址' });
    }
    if (siteIconUrl) {
      try {
        new URL(siteIconUrl);
      } catch (e) {
        if (req.file) removeLocalAvatar(fileToAvatarPath(req.file));
        return res.status(400).json({ error: '请输入有效的小图标链接' });
      }
    }
    const finalStatus = ['pending', 'approved', 'rejected'].includes(status) ? status : 'approved';
    const sortOrderNum = Math.max(0, Math.min(9999, parseInt(req.body.sortOrder, 10) || 0));
    const friend = {
      id: Date.now().toString(),
      name: siteName,
      url: siteUrl,
      description: String(description || '').trim(),
      avatar: fileToAvatarPath(req.file),
      iconUrl: siteIconUrl,
      sortOrder: sortOrderNum,
      status: finalStatus,
      visible: finalStatus === 'approved' && visible !== 'false',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.friends.push(friend);
    saveDB(db);
    clearCacheAfterMutation('friends');
    res.status(201).json(friend);
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '头像图片不能大于 1MB' });
    }
    res.status(400).json({ error: err.message || '保存失败' });
  }
});

// 后台：更新友链资料、审核状态和头像
app.put('/api/admin/friends/:id', authMiddleware, friendAvatarMiddleware, (req, res) => {
  try {
    const db = loadDB();
    const idx = db.friends.findIndex(friend => friend.id === req.params.id);
    if (idx === -1) {
      if (req.file) removeLocalAvatar(fileToAvatarPath(req.file));
      return res.status(404).json({ error: '友链不存在' });
    }

    const current = db.friends[idx];
    const { name, url, description, iconUrl, status, visible, sortOrder } = req.body;
    const nextStatus = ['pending', 'approved', 'rejected'].includes(status) ? status : current.status;
    const nextAvatar = req.file ? fileToAvatarPath(req.file) : current.avatar;
    const nextSortOrder = sortOrder !== undefined ? Math.max(0, Math.min(9999, parseInt(sortOrder, 10) || 0)) : (current.sortOrder || 0);

    if (req.file && current.avatar) removeLocalAvatar(current.avatar);

    const nextUrl = url !== undefined ? normalizeUrl(url) : current.url;
    const nextIconUrl = iconUrl !== undefined ? normalizeUrl(iconUrl) : (current.iconUrl || '');
    if (nextUrl) {
      try {
        new URL(nextUrl);
      } catch (e) {
        if (req.file) removeLocalAvatar(nextAvatar);
        return res.status(400).json({ error: '请输入有效的链接地址' });
      }
    }
    if (nextIconUrl) {
      try {
        new URL(nextIconUrl);
      } catch (e) {
        if (req.file) removeLocalAvatar(nextAvatar);
        return res.status(400).json({ error: '请输入有效的小图标链接' });
      }
    }

    db.friends[idx] = {
      ...current,
      name: name !== undefined ? String(name).trim() : current.name,
      url: nextUrl,
      description: description !== undefined ? String(description).trim() : current.description,
      avatar: nextAvatar,
      iconUrl: nextIconUrl,
      sortOrder: nextSortOrder,
      status: nextStatus,
      visible: nextStatus === 'approved' && visible !== 'false',
      updatedAt: new Date().toISOString()
    };
    saveDB(db);
    clearCacheAfterMutation('friends');
    res.json(db.friends[idx]);
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '头像图片不能大于 1MB' });
    }
    res.status(400).json({ error: err.message || '更新失败' });
  }
});

// 后台：快捷审核
app.patch('/api/admin/friends/:id/status', authMiddleware, (req, res) => {
  const db = loadDB();
  const friend = db.friends.find(item => item.id === req.params.id);
  if (!friend) return res.status(404).json({ error: '友链不存在' });
  const { status } = req.body;
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: '状态无效' });
  }
  friend.status = status;
  friend.visible = status === 'approved';
  friend.updatedAt = new Date().toISOString();
  saveDB(db);
  clearCacheAfterMutation('friends');
  res.json(friend);
});

// 后台：删除友链
app.delete('/api/admin/friends/:id', authMiddleware, (req, res) => {
  const db = loadDB();
  const idx = db.friends.findIndex(friend => friend.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '友链不存在' });
  const [removed] = db.friends.splice(idx, 1);
  removeLocalAvatar(removed.avatar);
  saveDB(db);
  clearCacheAfterMutation('friends');
  res.json({ message: '删除成功' });
});

// ============ 族谱接口 ============

// 公开：获取族谱人物列表与族谱简介（金字塔树形数据）
app.get('/api/genealogy', (req, res) => {
  const db = loadDB();
  // 公开接口仅返回已审核通过的人物
  const people = (db.genealogy || []).filter(function (p) {
    return !p.reviewStatus || p.reviewStatus === 'approved';
  }).map(function (p) {
    return {
      id: p.id,
      name: p.name,
      generation: p.generation,
      parentId: p.parentId || null,
      spouse: p.spouse || '',
      birthDate: p.birthDate || '',
      title: p.title || '',
      era: p.era || '',
      intro: p.intro || ''
    };
  });
  res.json({
    people: people,
    intro: (db.settings && db.settings.genealogyIntro) || '',
    kicker: (db.settings && db.settings.genealogyKicker) || 'Genealogy',
    title: (db.settings && db.settings.genealogyTitle) || '麦氏族谱',
    subtitle: (db.settings && db.settings.genealogySubtitle) || '',
    maxVisibleLevels: (db.settings && db.settings.genealogyDefaultExpandLevels) || 5
  });
});

// 后台：获取族谱（含待审核人物）
app.get('/api/admin/genealogy', authMiddleware, (req, res) => {
  const db = loadDB();
  const people = (db.genealogy || []).map(function (p) {
    return {
      id: p.id,
      name: p.name,
      generation: p.generation,
      parentId: p.parentId || null,
      spouse: p.spouse || '',
      birthDate: p.birthDate || '',
      title: p.title || '',
      era: p.era || '',
      intro: p.intro || '',
      reviewStatus: p.reviewStatus || 'approved',
      submittedBy: p.submittedBy || ''
    };
  });
  res.json({
    people: people,
    intro: (db.settings && db.settings.genealogyIntro) || '',
    kicker: (db.settings && db.settings.genealogyKicker) || 'Genealogy',
    title: (db.settings && db.settings.genealogyTitle) || '麦氏族谱',
    subtitle: (db.settings && db.settings.genealogySubtitle) || '',
    maxVisibleLevels: (db.settings && db.settings.genealogyDefaultExpandLevels) || 5
  });
});

// 后台：新增族谱人物
app.post('/api/admin/genealogy', authMiddleware, (req, res) => {
  const db = loadDB();
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '人物姓名不能为空' });
  if (name.length > 30) return res.status(400).json({ error: '姓名不能超过 30 个字符' });
  const person = {
    id: 'g' + Date.now().toString() + Math.random().toString(16).slice(2, 6),
    name: name,
    generation: Number(req.body.generation) || 1,
    parentId: req.body.parentId ? String(req.body.parentId) : null,
    spouse: String(req.body.spouse || '').trim(),
    birthDate: String(req.body.birthDate || '').trim(),
    title: String(req.body.title || '').trim(),
    era: String(req.body.era || '').trim(),
    intro: String(req.body.intro || '').trim()
  };
  if (!Array.isArray(db.genealogy)) db.genealogy = [];
  person.reviewStatus = 'approved';
  person.submittedBy = '';
  db.genealogy.push(person);
  saveDB(db);
  clearCache('/api/genealogy');
  res.status(201).json(person);
});

// 后台：修改族谱简介及标题（必须在 :id 路由之前，否则 intro 会被当作 :id 匹配）
app.put('/api/admin/genealogy/intro', authMiddleware, (req, res) => {
  const db = loadDB();
  db.settings = db.settings || {};
  if (req.body.intro !== undefined) {
    db.settings.genealogyIntro = String(req.body.intro || '');
  }
  if (req.body.kicker !== undefined) {
    db.settings.genealogyKicker = String(req.body.kicker || '').slice(0, 30);
  }
  if (req.body.title !== undefined) {
    db.settings.genealogyTitle = String(req.body.title || '').slice(0, 50);
  }
  if (req.body.subtitle !== undefined) {
    db.settings.genealogySubtitle = String(req.body.subtitle || '').slice(0, 200);
  }
  if (req.body.defaultExpandLevels !== undefined) {
    var levels = parseInt(req.body.defaultExpandLevels, 10);
    if (isNaN(levels) || levels < 1) levels = 1;
    db.settings.genealogyDefaultExpandLevels = levels;
  }
  db.settings.updatedAt = new Date().toISOString();
  saveDB(db);
  clearCache('/api/genealogy');
  res.json({
    intro: db.settings.genealogyIntro,
    kicker: db.settings.genealogyKicker,
    title: db.settings.genealogyTitle,
    subtitle: db.settings.genealogySubtitle,
    maxVisibleLevels: db.settings.genealogyDefaultExpandLevels
  });
});

// 后台：修改族谱人物
app.put('/api/admin/genealogy/:id', authMiddleware, (req, res) => {
  const db = loadDB();
  const person = (db.genealogy || []).find(function (p) { return String(p.id) === String(req.params.id); });
  if (!person) return res.status(404).json({ error: '人物不存在' });
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ error: '人物姓名不能为空' });
    person.name = name.slice(0, 30);
  }
  if (req.body.generation !== undefined) person.generation = Number(req.body.generation) || 1;
  if (req.body.parentId !== undefined) {
    const newParent = req.body.parentId ? String(req.body.parentId) : null;
    // 防止将自己设为自己的祖先，形成环路
    if (newParent && newParent === String(person.id)) {
      return res.status(400).json({ error: '不能将自己设为父节点' });
    }
    person.parentId = newParent;
  }
  if (req.body.title !== undefined) person.title = String(req.body.title).trim();
  if (req.body.era !== undefined) person.era = String(req.body.era).trim();
  if (req.body.spouse !== undefined) person.spouse = String(req.body.spouse).trim();
  if (req.body.birthDate !== undefined) person.birthDate = String(req.body.birthDate).trim();
  if (req.body.intro !== undefined) person.intro = String(req.body.intro).trim();
  saveDB(db);
  clearCache('/api/genealogy');
  res.json(person);
});

// 后台：删除族谱人物（同时移除其后代，避免悬挂节点）
app.delete('/api/admin/genealogy/:id', authMiddleware, (req, res) => {
  const db = loadDB();
  if (!Array.isArray(db.genealogy)) return res.status(404).json({ error: '人物不存在' });
  const toDelete = new Set([String(req.params.id)]);
  // 迭代收集所有后代
  var changed = true;
  while (changed) {
    changed = false;
    for (var i = 0; i < db.genealogy.length; i++) {
      var p = db.genealogy[i];
      if (p.parentId && toDelete.has(String(p.parentId)) && !toDelete.has(String(p.id))) {
        toDelete.add(String(p.id));
        changed = true;
      }
    }
  }
  const before = db.genealogy.length;
  db.genealogy = db.genealogy.filter(function (p) { return !toDelete.has(String(p.id)); });
  if (db.genealogy.length === before) return res.status(404).json({ error: '人物不存在' });
  saveDB(db);
  clearCache('/api/genealogy');
  res.json({ message: '删除成功', removed: before - db.genealogy.length });
});

// 后台：批量导入族谱数据（替换全部）
app.post('/api/admin/genealogy/import', authMiddleware, (req, res) => {
  var people = req.body.people;
  if (!Array.isArray(people)) return res.status(400).json({ error: '数据格式错误：需要 people 数组' });
  var validFields = ['id', 'name', 'generation', 'parentId', 'spouse', 'birthDate', 'title', 'era', 'intro'];
  var cleaned = [];
  for (var i = 0; i < people.length; i++) {
    var p = people[i];
    if (!p || typeof p !== 'object') continue;
    var name = String(p.name || '').trim();
    if (!name) continue;
    var person = {
      id: String(p.id || ('g' + Date.now().toString() + Math.random().toString(16).slice(2, 8))),
      name: name.slice(0, 30),
      generation: Number(p.generation) || 1,
      parentId: p.parentId ? String(p.parentId) : null,
      spouse: String(p.spouse || '').trim().slice(0, 30),
      birthDate: String(p.birthDate || '').trim().slice(0, 30),
      title: String(p.title || '').trim().slice(0, 20),
      era: String(p.era || '').trim().slice(0, 30),
      intro: String(p.intro || '').trim(),
      reviewStatus: 'approved',
      submittedBy: ''
    };
    cleaned.push(person);
  }
  var db = loadDB();
  db.genealogy = cleaned;
  saveDB(db);
  clearCache('/api/genealogy');
  res.json({ message: '导入成功', count: cleaned.length });
});

// 后台：修改族谱简介及标题（已移至 :id 路由之前，此处为旧位置已删除）

// ============ 族谱用户投稿与审核接口 ============

// 前台用户：提交族谱人物（待审核）
app.post('/api/user/genealogy', userAuthMiddleware, (req, res) => {
  const db = loadDB();
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '人物姓名不能为空' });
  if (name.length > 30) return res.status(400).json({ error: '姓名不能超过 30 个字符' });

  var currentUser = (db.users || []).find(function (u) { return u.username === req.user.username; });
  var isPublisher = (req.user.role === 'admin') || (currentUser && currentUser.role === 'admin' && !currentUser.disabled);

  const person = {
    id: 'g' + Date.now().toString() + Math.random().toString(16).slice(2, 6),
    name: name,
    generation: Number(req.body.generation) || 1,
    parentId: req.body.parentId ? String(req.body.parentId) : null,
    spouse: String(req.body.spouse || '').trim().slice(0, 30),
    birthDate: String(req.body.birthDate || '').trim().slice(0, 30),
    title: String(req.body.title || '').trim().slice(0, 20),
    era: String(req.body.era || '').trim().slice(0, 30),
    intro: String(req.body.intro || '').trim(),
    reviewStatus: isPublisher ? 'approved' : 'pending',
    submittedBy: req.user.username,
    submittedAt: new Date().toISOString(),
    reviewedAt: isPublisher ? new Date().toISOString() : '',
    reviewer: isPublisher ? 'self(admin-role)' : '',
    rejectionReason: ''
  };
  if (!Array.isArray(db.genealogy)) db.genealogy = [];
  db.genealogy.push(person);
  saveDB(db);
  clearCache('/api/genealogy');
  res.status(201).json({
    message: isPublisher ? '人物已直接添加并显示' : '人物已提交，请等待管理员审核',
    person: person
  });
});

// 前台用户：查看自己提交的族谱人物
app.get('/api/user/genealogy/submissions', userAuthMiddleware, (req, res) => {
  const db = loadDB();
  const username = req.user.username;
  const list = (db.genealogy || [])
    .filter(function (p) { return p.submittedBy === username; })
    .sort(function (a, b) {
      return new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0);
    });
  res.json(list);
});

// 前台用户：查看自己的族谱密码申请记录
app.get('/api/user/genealogy-password-requests', userAuthMiddleware, (req, res) => {
  const db = loadDB();
  const username = req.user.username;
  const requests = (db.genealogyPasswordRequests || [])
    .filter(function (r) { return r.username === username; })
    .sort(function (a, b) {
      return new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0);
    })
    .map(function (r) {
      // 只返回必要字段，密码只在审核通过时返回
      return {
        id: r.id,
        name: r.name,
        contact: r.contact,
        reason: r.reason,
        status: r.status,
        approvedPassword: r.status === 'approved' ? (r.approvedPassword || '') : '',
        requestedAt: r.requestedAt,
        reviewedAt: r.reviewedAt
      };
    });
  res.json(requests);
});

// 后台：审核族谱人物（通过/驳回）
app.patch('/api/admin/genealogy/:id/review', authMiddleware, (req, res) => {
  const db = loadDB();
  const person = (db.genealogy || []).find(function (p) { return String(p.id) === String(req.params.id); });
  if (!person) return res.status(404).json({ error: '人物不存在' });
  const status = String(req.body.status || '').trim();
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: '审核状态无效' });
  }
  person.reviewStatus = status;
  person.reviewedAt = new Date().toISOString();
  person.reviewer = req.user.username || 'admin';
  person.rejectionReason = status === 'rejected' ? String(req.body.reason || '').trim() : '';
  saveDB(db);
  clearCache('/api/genealogy');
  res.json(person);
});

// ============ 族谱密码访问接口 ============

// 前台：验证族谱访问密码
app.post('/api/genealogy/verify-password', (req, res) => {
  const db = loadDB();
  const password = String(req.body.password || '');
  const genealogyPassword = (db.settings && db.settings.genealogyPassword) || '';

  if (!genealogyPassword) {
    return res.status(400).json({ error: '管理员尚未设置族谱访问密码' });
  }

  // 检查密码是否已过期
  var createdAt = db.settings.genealogyPasswordCreatedAt || '';
  var expiresIn = parseInt(db.settings.genealogyPasswordExpiresIn) || 0;
  if (createdAt && expiresIn > 0) {
    var createdTime = new Date(createdAt).getTime();
    var expireTime = createdTime + expiresIn * 24 * 60 * 60 * 1000;
    if (Date.now() > expireTime) {
      return res.status(403).json({ error: '密码已过期，请联系管理员获取新密码', expired: true });
    }
  }

  if (password === genealogyPassword) {
    return res.json({ success: true, message: '验证成功' });
  } else {
    return res.status(401).json({ error: '密码错误' });
  }
});

// 前台：申请族谱访问密码（登录用户会自动关联账号）
app.post('/api/genealogy/request-password', (req, res) => {
  const db = loadDB();
  const name = String(req.body.name || '').trim();
  const contact = String(req.body.contact || '').trim();
  const reason = String(req.body.reason || '').trim();

  if (!name || !contact) {
    return res.status(400).json({ error: '姓名和联系方式不能为空' });
  }

  // 尝试从请求头获取登录用户信息
  let username = '';
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    try {
      const decoded = jwt.verify(token, SECRET_KEY);
      if (decoded.type === 'user') {
        username = decoded.username || '';
      }
    } catch (e) {
      // token 无效则忽略，仍以匿名方式提交
    }
  }

  if (!Array.isArray(db.genealogyPasswordRequests)) {
    db.genealogyPasswordRequests = [];
  }

  const request = {
    id: 'gpr' + Date.now().toString() + Math.random().toString(16).slice(2, 6),
    name: name,
    contact: contact,
    reason: reason,
    status: 'pending',
    username: username,
    approvedPassword: '',
    requestedAt: new Date().toISOString(),
    reviewedAt: '',
    reviewer: ''
  };

  db.genealogyPasswordRequests.push(request);
  saveDB(db);
  return res.json({ success: true, message: '申请已提交，请等待管理员审核' });
});

// 后台：获取密码访问申请列表
app.get('/api/admin/genealogy-password-requests', authMiddleware, (req, res) => {
  const db = loadDB();
  var requests = db.genealogyPasswordRequests || [];
  // 按申请时间倒序排列（最新在前）
  requests = requests.slice().sort(function (a, b) {
    return new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime();
  });
  res.json(requests);
});

// 后台：审核密码访问申请（通过/拒绝）
app.patch('/api/admin/genealogy-password-requests/:id', authMiddleware, (req, res) => {
  const db = loadDB();
  var id = req.params.id;
  var status = String(req.body.status || '').trim();
  if (status !== 'approved' && status !== 'rejected') {
    return res.status(400).json({ error: '无效的审核状态' });
  }
  if (!Array.isArray(db.genealogyPasswordRequests)) {
    db.genealogyPasswordRequests = [];
  }
  var req_item = db.genealogyPasswordRequests.find(function (r) { return r.id === id; });
  if (!req_item) {
    return res.status(404).json({ error: '申请不存在' });
  }
  req_item.status = status;
  req_item.reviewedAt = new Date().toISOString();
  req_item.reviewer = (req.user && req.user.username) ? req.user.username : 'admin';
  // 审核通过时，记录当前族谱密码（用户可在个人中心查看）
  if (status === 'approved') {
    req_item.approvedPassword = (db.settings && db.settings.genealogyPassword) || '';
  } else {
    req_item.approvedPassword = '';
  }
  saveDB(db);
  res.json({ success: true, message: status === 'approved' ? '已通过申请' : '已拒绝申请' });
});

// 后台：删除密码访问申请
app.delete('/api/admin/genealogy-password-requests/:id', authMiddleware, (req, res) => {
  const db = loadDB();
  var id = req.params.id;
  if (!Array.isArray(db.genealogyPasswordRequests)) {
    db.genealogyPasswordRequests = [];
  }
  var idx = db.genealogyPasswordRequests.findIndex(function (r) { return r.id === id; });
  if (idx === -1) {
    return res.status(404).json({ error: '申请不存在' });
  }
  db.genealogyPasswordRequests.splice(idx, 1);
  saveDB(db);
  res.json({ success: true, message: '已删除申请' });
});

// 后台：获取族谱密码
app.get('/api/admin/genealogy-password', authMiddleware, (req, res) => {
  const db = loadDB();
  var createdAt = (db.settings && db.settings.genealogyPasswordCreatedAt) || '';
  var expiresIn = parseInt((db.settings && db.settings.genealogyPasswordExpiresIn)) || 0;
  var expired = false;
  var expireTime = '';
  var remainingText = '';
  if (createdAt && expiresIn > 0) {
    var createdMs = new Date(createdAt).getTime();
    var expireMs = createdMs + expiresIn * 24 * 60 * 60 * 1000;
    expireTime = new Date(expireMs).toISOString();
    var remainingMs = expireMs - Date.now();
    if (remainingMs <= 0) {
      expired = true;
      remainingText = '已过期';
    } else {
      var remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
      remainingText = '剩余 ' + remainingDays + ' 天';
    }
  } else if (createdAt && expiresIn === 0) {
    remainingText = '永不过期';
  }
  res.json({
    password: (db.settings && db.settings.genealogyPassword) || '',
    createdAt: createdAt,
    expiresIn: expiresIn,
    expireTime: expireTime,
    expired: expired,
    remainingText: remainingText
  });
});

// 后台：设置/生成族谱密码
app.put('/api/admin/genealogy-password', authMiddleware, (req, res) => {
  const db = loadDB();
  const password = String(req.body.password || '').trim();
  if (!password) {
    return res.status(400).json({ error: '密码不能为空' });
  }
  if (password.length < 4 || password.length > 50) {
    return res.status(400).json({ error: '密码长度需在 4-50 个字符之间' });
  }
  var expiresIn = parseInt(req.body.expiresIn);
  if (isNaN(expiresIn) || expiresIn < 0) expiresIn = 0;
  if (!db.settings) db.settings = {};
  db.settings.genealogyPassword = password;
  db.settings.genealogyPasswordCreatedAt = new Date().toISOString();
  db.settings.genealogyPasswordExpiresIn = expiresIn;
  saveDB(db);
  res.json({ success: true, message: '密码已设置', password: password, expiresIn: expiresIn });
});

// 后台：随机生成族谱密码
app.post('/api/admin/genealogy-password/generate', authMiddleware, (req, res) => {
  const db = loadDB();
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';
  var pwd = '';
  for (var i = 0; i < 8; i++) {
    pwd += chars[Math.floor(Math.random() * chars.length)];
  }
  var expiresIn = parseInt(req.body.expiresIn);
  if (isNaN(expiresIn) || expiresIn < 0) expiresIn = 0;
  if (!db.settings) db.settings = {};
  db.settings.genealogyPassword = pwd;
  db.settings.genealogyPasswordCreatedAt = new Date().toISOString();
  db.settings.genealogyPasswordExpiresIn = expiresIn;
  saveDB(db);
  res.json({ success: true, password: pwd, message: '密码已生成', expiresIn: expiresIn });
});

// 后台：清除族谱访问密码
app.delete('/api/admin/genealogy-password', authMiddleware, (req, res) => {
  const db = loadDB();
  if (!db.settings) db.settings = {};
  db.settings.genealogyPassword = '';
  db.settings.genealogyPasswordCreatedAt = '';
  db.settings.genealogyPasswordExpiresIn = 0;
  saveDB(db);
  res.json({ success: true, message: '密码已清除' });
});

// ============ 后台用户管理接口 ============

// 获取用户列表（支持搜索、分页）
app.get('/api/admin/users', authMiddleware, (req, res) => {
  const db = loadDB();
  const search = String(req.query.search || '').trim().toLowerCase();
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;

  let users = db.users || [];

  if (search) {
    users = users.filter(user =>
      user.username.toLowerCase().includes(search)
    );
  }

  const total = users.length;
  const start = (page - 1) * pageSize;
  const paginatedUsers = users
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(start, start + pageSize)
    .map(user => ({
      id: user.id,
      username: user.username,
      nickname: user.nickname || '',
      role: user.role || 'user',
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt || null,
      disabled: user.disabled || false
    }));

  res.json({
    users: paginatedUsers,
    total: total,
    page: page,
    pageSize: pageSize
  });
});

// 创建新用户
app.post('/api/admin/users', authMiddleware, (req, res) => {
  const db = loadDB();
  const { username, password } = req.body;
  const name = String(username || '').trim();

  if (!name || name.length < 3 || name.length > 20) {
    return res.status(400).json({ error: '用户名长度需在 3-20 个字符之间' });
  }
  if (!password || String(password).length < 6 || String(password).length > 32) {
    return res.status(400).json({ error: '密码长度需在 6-32 个字符之间' });
  }
  if (db.users.some(user => user.username === name)) {
    return res.status(400).json({ error: '用户名已存在' });
  }
  if (name === db.admin.username) {
    return res.status(400).json({ error: '用户名已存在' });
  }

  const salt = bcrypt.genSaltSync(10);
  const user = {
    id: Date.now().toString(),
    username: name,
    nickname: String(req.body.nickname || '').trim(),
    role: req.body.role === 'admin' ? 'admin' : 'user',
    password: bcrypt.hashSync(String(password), salt),
    createdAt: new Date().toISOString(),
    disabled: false,
    lastLoginAt: null
  };
  db.users.push(user);
  saveDB(db);

  res.status(201).json({
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    role: user.role,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    disabled: user.disabled
  });
});

// 更新用户（修改密码、切换禁用状态）
app.put('/api/admin/users/:id', authMiddleware, (req, res) => {
  const db = loadDB();
  const user = db.users.find(item => String(item.id) === String(req.params.id));
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const { password, disabled, role, nickname } = req.body;

  if (password !== undefined) {
    const pwd = String(password);
    if (pwd.length < 6 || pwd.length > 32) {
      return res.status(400).json({ error: '密码长度需在 6-32 个字符之间' });
    }
    const salt = bcrypt.genSaltSync(10);
    user.password = bcrypt.hashSync(pwd, salt);
  }

  if (disabled !== undefined) {
    user.disabled = Boolean(disabled);
  }

  // 设置/取消管理员角色：管理员可将任意乡亲提升为管理员，使其可直接发布文章
  if (role !== undefined) {
    user.role = role === 'admin' ? 'admin' : 'user';
  }

  if (nickname !== undefined) {
    user.nickname = String(nickname).trim().slice(0, 20);
  }

  saveDB(db);

  res.json({
    id: user.id,
    username: user.username,
    nickname: user.nickname || '',
    role: user.role || 'user',
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
    disabled: user.disabled || false
  });
});

// 删除用户
app.delete('/api/admin/users/:id', authMiddleware, (req, res) => {
  const db = loadDB();
  const idx = db.users.findIndex(item => String(item.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: '用户不存在' });

  const user = db.users[idx];

  // 不能删除 admin 用户（admin 不在 users 数组中，但做个防御）
  if (user.username === db.admin.username) {
    return res.status(400).json({ error: '不能删除管理员账号' });
  }

  const username = user.username;

  // 移除用户的点赞
  db.likes = (db.likes || []).filter(l => l.username !== username);

  // 移除用户的收藏
  db.favorites = (db.favorites || []).filter(f => f.username !== username);

  // 移除用户的投稿（删除投稿文章，或清空 submittedBy）
  db.posts = (db.posts || []).filter(p => p.submittedBy !== username);

  // 移除用户
  db.users.splice(idx, 1);
  saveDB(db);
  clearCacheAfterMutation('posts');

  res.json({ message: '删除成功' });
});

// 批量操作用户
app.post('/api/admin/users/batch', authMiddleware, (req, res) => {
  const db = loadDB();
  const { action, ids } = req.body;

  if (!['delete', 'disable', 'enable'].includes(action)) {
    return res.status(400).json({ error: '无效的操作类型' });
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '请选择要操作的用户' });
  }

  const idList = ids.map(String);
  let count = 0;

  if (action === 'delete') {
    const toDelete = db.users.filter(u =>
      idList.includes(String(u.id)) && u.username !== db.admin.username
    );
    const usernames = toDelete.map(u => u.username);

    // 移除相关数据
    db.likes = (db.likes || []).filter(l => !usernames.includes(l.username));
    db.favorites = (db.favorites || []).filter(f => !usernames.includes(f.username));
    db.posts = (db.posts || []).filter(p => !usernames.includes(p.submittedBy));

    // 删除用户
    db.users = db.users.filter(u => !idList.includes(String(u.id)) || u.username === db.admin.username);
    count = toDelete.length;
    clearCacheAfterMutation('posts');
  } else if (action === 'disable') {
    db.users.forEach(u => {
      if (idList.includes(String(u.id)) && u.username !== db.admin.username) {
        u.disabled = true;
        count++;
      }
    });
  } else if (action === 'enable') {
    db.users.forEach(u => {
      if (idList.includes(String(u.id))) {
        u.disabled = false;
        count++;
      }
    });
  }

  saveDB(db);
  res.json({ message: '操作成功', count: count });
});

// ============ 媒体库接口 ============

// 递归读取目录中的文件
function readMediaFiles(dir, baseDir, folderName) {
  var results = [];
  if (!fs.existsSync(dir)) return results;
  var items = fs.readdirSync(dir);
  for (var i = 0; i < items.length; i++) {
    var fullPath = path.join(dir, items[i]);
    try {
      var stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        var subFiles = readMediaFiles(fullPath, baseDir, folderName);
        results = results.concat(subFiles);
      } else {
        var relativePath = '/' + path.relative(baseDir, fullPath).replace(/\\/g, '/');
        var mimeType = getMimeType(items[i]);
        results.push({
          path: '/uploads/' + relativePath.replace(/^\//, ''),
          name: items[i],
          size: stat.size,
          type: mimeType,
          createdAt: stat.mtimeMs,
          folder: folderName
        });
      }
    } catch (e) {}
  }
  return results;
}

function getMimeType(filename) {
  var ext = path.extname(filename).toLowerCase();
  var map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.bmp': 'image/bmp'
  };
  return map[ext] || 'application/octet-stream';
}

// 后台：获取媒体库文件列表
app.get('/api/admin/media', authMiddleware, (req, res) => {
  var folder = String(req.query.folder || '').trim();
  var allFiles = [];

  // 读取三个子目录
  var folders = [
    { name: 'articles', dir: ARTICLE_IMAGE_DIR },
    { name: 'friends', dir: FRIEND_AVATAR_DIR },
    { name: 'site', dir: SITE_LOGO_DIR }
  ];

  for (var i = 0; i < folders.length; i++) {
    var f = folders[i];
    if (folder && folder !== f.name) continue;
    var files = readMediaFiles(f.dir, UPLOAD_DIR, f.name);
    allFiles = allFiles.concat(files);
  }

  // 按创建时间倒序
  allFiles.sort(function (a, b) { return b.createdAt - a.createdAt; });

  res.json({
    files: allFiles,
    total: allFiles.length
  });
});

// 后台：删除媒体文件
app.delete('/api/admin/media', authMiddleware, (req, res) => {
  var filePath = String(req.body.path || '').trim();
  if (!filePath || !filePath.startsWith('/uploads/')) {
    return res.status(400).json({ error: '路径不合法' });
  }
  // 防止路径穿越
  var normalized = path.normalize(filePath.replace(/^\/uploads/, ''));
  if (normalized.startsWith('..') || normalized.startsWith('/') || path.isAbsolute(normalized)) {
    return res.status(400).json({ error: '路径不合法' });
  }
  var fullPath = path.join(UPLOAD_DIR, normalized);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: '文件不存在' });
  }
  try {
    fs.unlinkSync(fullPath);
    res.json({ message: '删除成功' });
  } catch (e) {
    res.status(500).json({ error: '删除失败：' + e.message });
  }
});

// ============ 数据导出接口 ============

// 后台：导出全部数据
app.get('/api/admin/export', authMiddleware, (req, res) => {
  const db = loadDB();
  var now = new Date();
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var filename = 'carson-blog-backup-' +
    now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' +
    pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) + '.json';

  // 构造导出数据（用户密码不导出）
  var exportData = {
    posts: db.posts || [],
    categories: db.categories || [],
    tags: db.tags || [],
    comments: db.comments || [],
    users: (db.users || []).map(function (u) {
      return { id: u.id, username: u.username, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, disabled: u.disabled };
    }),
    friends: db.friends || [],
    settings: db.settings || {},
    likes: db.likes || [],
    favorites: db.favorites || [],
    exportedAt: new Date().toISOString(),
    version: '1.0'
  };

  var jsonStr = JSON.stringify(exportData, null, 2);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  res.setHeader('Content-Length', Buffer.byteLength(jsonStr, 'utf8'));
  res.send(jsonStr);
});

// 404 兜底路由（API 返回 JSON，其他返回 index.html）
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: '接口不存在' });
  }
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 全局错误处理器
app.use((err, req, res, next) => {
  console.error('未处理的错误:', err.message);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: '服务器内部错误' });
  }
  res.status(500).sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 启动服务
// 使用 insecureHTTPParser: true 允许 URL 中包含原始 UTF-8 字符
// （沙箱代理可能将 percent-encoded 中文字符解码为原始字节，导致 llhttp 拒绝请求返回 400）
const server = http.createServer({ insecureHTTPParser: true }, app);
server.listen(PORT, () => {
  console.log(`\n  麦氏乡村网站系统已启动！`);
  console.log(`  ────────────────────────────`);
  console.log(`  前台博客:  http://localhost:${PORT}`);
  console.log(`  后台管理:  http://localhost:${PORT}/admin`);
  console.log(`  ────────────────────────────`);
  console.log(`  默认账号:  admin`);
  console.log(`  默认密码:  admin123\n`);
});
