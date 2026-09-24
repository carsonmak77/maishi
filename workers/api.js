const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization'
};

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);

function now() {
  return new Date().toISOString();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

function textEncoder() {
  return new TextEncoder();
}

function base64UrlEncode(input) {
  let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input) {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - input.length % 4) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacSha256(secret, text) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  return crypto.subtle.sign('HMAC', key, textEncoder().encode(text));
}

async function signToken(payload, env, ttlSeconds) {
  const secret = env.JWT_SECRET || 'carson-blog-cloudflare-secret';
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const head = base64UrlEncode(textEncoder().encode(JSON.stringify(header)));
  const data = base64UrlEncode(textEncoder().encode(JSON.stringify(body)));
  const signature = base64UrlEncode(await hmacSha256(secret, `${head}.${data}`));
  return `${head}.${data}.${signature}`;
}

async function verifyToken(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const secret = env.JWT_SECRET || 'carson-blog-cloudflare-secret';
  const expected = base64UrlEncode(await hmacSha256(secret, `${parts[0]}.${parts[1]}`));
  if (expected !== parts[2]) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function defaultDB() {
  const created = now();
  return {
    posts: [
      {
        id: '1',
        title: '欢迎使用麦氏乡村网站',
        summary: '麦氏乡村——记录麦氏家族族谱传承、乡村风貌与乡亲故事。',
        content: '<p>这是一个采用微信设计风格的博客系统。</p><h2>主要特性</h2><ul><li>简洁清新的界面设计</li><li>完整的后台管理系统</li><li>文章的增删改查</li><li>分类与标签管理</li><li>响应式布局，适配移动端</li></ul><p>Cloudflare 版本使用 D1 保存数据，R2 保存上传图片，管理员账号密码由部署环境变量设置。</p>',
        cover: '',
        author: 'Admin',
        category: '公告',
        tags: ['教程', '公告'],
        createdAt: created,
        updatedAt: created,
        views: 0,
        published: true,
        pinned: false,
        announcement: false,
      showOnHome: true,
      reviewStatus: 'approved'
      }
    ],
    categories: ['公告', '技术', '生活', '随笔'],
    tags: ['教程', '公告', '写作', '技术', '前端', '趋势', '生活', '随笔'],
    friends: [],
    users: [],
    comments: [],
    settings: {
      siteName: '麦氏乡村',
      description: '麦氏乡村——记录麦氏家族族谱传承、乡村风貌与乡亲故事。',
      logo: '',
      footerText: '',
      navLinks: [
        { name: '主页', url: 'index.html', visible: true },
        { name: '族谱', url: 'genealogy.html', visible: true },
        { name: '朋友们', url: 'friends.html', visible: true },
        { name: '关于', url: 'about.html', visible: true }
      ],
      tempAccessMode: false,
      tempAccessNotice: '',
      tempAccessKey: '',
      about: {
        kicker: 'About',
        title: '关于本站',
        summary: '这是一个微信风格的轻量博客系统，专注于文章发布、内容阅读和简单后台管理。',
        content: '<section class="about-card"><h2>设计理念</h2><p>本站延续微信式的简洁风格，让读者把注意力放在内容本身。</p></section>'
      },
      commentSettings: {
        blockedKeywords: [],
        homepagePageSize: 5,
        postPageSize: 10
      },
      siteSubtitle: '记录麦氏家族族谱传承、乡村风貌与乡亲故事',
      defaultCover: '',
      displayMode: 'default',
      genealogyIntro: '',
      genealogyKicker: 'Genealogy',
      genealogyTitle: '麦氏族谱',
      genealogySubtitle: '',
      genealogyDefaultExpandLevels: 2,
      genealogyPassword: '',
      genealogyPasswordCreatedAt: '',
      genealogyPasswordExpiresIn: 0,
      maintenanceMode: false,
      maintenancePassword: '',
      maintenanceMessage: '网站维护中，敬请谅解',
      contact: { email: '', wechat: '', qq: '', phone: '', address: '' },
      sponsor: { description: '', wechatQr: '', alipayQr: '', code: '' },
      cloudflareApiToken: '',
      cloudflareZoneId: ''
    },
    genealogy: [],
    genealogyPasswordRequests: [],
    likes: [],
    favorites: []
  };
}

function migrateDB(db) {
  db.posts = Array.isArray(db.posts) ? db.posts : [];
  db.categories = Array.isArray(db.categories) ? db.categories : ['公告', '技术', '生活', '随笔'];
  db.tags = Array.isArray(db.tags) ? db.tags : [];
  db.friends = Array.isArray(db.friends) ? db.friends : [];
  db.users = Array.isArray(db.users) ? db.users : [];
  db.comments = Array.isArray(db.comments) ? db.comments : [];
  db.likes = Array.isArray(db.likes) ? db.likes : [];
  db.favorites = Array.isArray(db.favorites) ? db.favorites : [];
  db.settings = db.settings || {};
  db.settings.siteName = db.settings.siteName || '麦氏乡村';
  db.settings.description = db.settings.description || '麦氏乡村——记录麦氏家族族谱传承、乡村风貌与乡亲故事。';
  db.settings.logo = db.settings.logo || '';
  db.settings.footerText = db.settings.footerText || '';
  if (!Array.isArray(db.settings.navLinks)) {
    db.settings.navLinks = [
      { name: '主页', url: 'index.html', visible: true },
      { name: '族谱', url: 'genealogy.html', visible: true },
      { name: '朋友们', url: 'friends.html', visible: true },
      { name: '关于', url: 'about.html', visible: true }
    ];
  }
  if (db.settings.tempAccessMode === undefined) db.settings.tempAccessMode = false;
  if (db.settings.tempAccessNotice === undefined) db.settings.tempAccessNotice = '';
  if (db.settings.tempAccessKey === undefined) db.settings.tempAccessKey = '';
  db.settings.about = db.settings.about || {
    kicker: 'About',
    title: '关于麦氏乡村',
    summary: '麦氏乡村网站展示——记录麦氏家族族谱传承、乡村风貌与乡亲故事。',
    content: '<section class="about-card"><h2>麦氏乡村</h2><p>麦氏乡村网站展示是一处记录麦氏家族族谱传承、乡村风貌与乡亲故事的平台。</p></section><section class="about-card"><h2>族谱传承</h2><ul><li>始祖麦铁杖，隋代名将，谥号"烈"，开基立业。</li><li>历经九世传承，昭穆有序，支派分明。</li></ul><a class="btn-primary" href="genealogy.html">查看族谱</a></section><section class="about-card"><h2>联系方式</h2><p>邮箱：maishi@family.com</p><p>微信：maishi-family</p><p>地址：广东麦氏乡村</p></section><section class="about-card"><h2>赞助支持</h2><p>麦氏乡村网站由家族成员共同维护，欢迎赞助支持，您的支持将用于服务器运营与族谱资料整理。赞助码：MAISHI2026</p></section>'
  };
  db.settings.commentSettings = normalizeCommentSettings(db.settings.commentSettings || {});
  db.posts = db.posts.map(post => ({
    pinned: false,
    announcement: false,
    showOnHome: true,
    ...post,
    published: post.published !== false,
    reviewStatus: post.reviewStatus || (post.submittedBy ? (post.published ? 'approved' : 'pending') : 'approved')
  }));
  db.friends = db.friends.map((friend, i) => ({
    status: 'approved',
    visible: true,
    iconUrl: '',
    createdAt: now(),
    updatedAt: now(),
    ...friend,
    sortOrder: friend.sortOrder !== undefined ? friend.sortOrder : 0
  }));
  // 族谱数据迁移
  if (!Array.isArray(db.genealogy)) db.genealogy = [];
  if (!Array.isArray(db.genealogyPasswordRequests)) db.genealogyPasswordRequests = [];
  if (db.settings.genealogyIntro === undefined) db.settings.genealogyIntro = '';
  if (db.settings.genealogyKicker === undefined) db.settings.genealogyKicker = 'Genealogy';
  if (db.settings.genealogyTitle === undefined) db.settings.genealogyTitle = '麦氏族谱';
  if (db.settings.genealogySubtitle === undefined) db.settings.genealogySubtitle = '';
  if (db.settings.genealogyDefaultExpandLevels === undefined) db.settings.genealogyDefaultExpandLevels = 5;
  if (db.settings.genealogyPassword === undefined) db.settings.genealogyPassword = '';
  if (db.settings.genealogyPasswordCreatedAt === undefined) db.settings.genealogyPasswordCreatedAt = '';
  if (db.settings.genealogyPasswordExpiresIn === undefined) db.settings.genealogyPasswordExpiresIn = 0;
  // 维护模式数据迁移
  if (db.settings.maintenanceMode === undefined) db.settings.maintenanceMode = false;
  if (db.settings.maintenancePassword === undefined) db.settings.maintenancePassword = '';
  if (db.settings.maintenanceMessage === undefined) db.settings.maintenanceMessage = '网站维护中，敬请谅解';
  // 联系与赞助设置数据迁移
  if (!db.settings.contact) db.settings.contact = { email: '', wechat: '', qq: '', phone: '', address: '' };
  if (!db.settings.sponsor) db.settings.sponsor = { description: '', wechatQr: '', alipayQr: '', code: '' };
  return db;
}

async function loadDB(env) {
  if (!env.DB) throw new Error('缺少 D1 绑定 DB');
  const row = await env.DB.prepare('SELECT data FROM app_data WHERE key = ?').bind('main').first();
  if (row && row.data) return migrateDB(JSON.parse(row.data));
  const db = defaultDB();
  await saveDB(env, db);
  return db;
}

async function saveDB(env, db) {
  await env.DB.prepare(
    'INSERT INTO app_data (key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
  ).bind('main', JSON.stringify(db), now()).run();
}

function sortPostsForList(posts) {
  return posts.slice().sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
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
  str = str.replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form)[\s\S]*?<\/\s*\1\s*>/gi, '');
  str = str.replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form)[^>]*>/gi, '');
  str = str.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  str = str.replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]*)/gi, '$1="#"');
  return str.trim();
}

function normalizeCommentSettings(settings = {}) {
  const homepagePageSize = Math.max(1, Math.min(100, Number(settings.homepagePageSize) || 5));
  const postPageSize = Math.max(1, Math.min(100, Number(settings.postPageSize) || 10));
  const source = Array.isArray(settings.blockedKeywords)
    ? settings.blockedKeywords
    : String(settings.blockedKeywords || '').split(/[\n,，]/);
  return {
    blockedKeywords: source.map(item => String(item || '').trim()).filter(Boolean),
    homepagePageSize,
    postPageSize
  };
}

function sanitizePublicComment(comment) {
  const { matchedKeywords, ip, ...safe } = comment;
  return safe;
}

function getCommentTargetTitle(db, comment) {
  if (comment.targetType === 'home') return '网站主页留言区';
  const post = db.posts.find(item => String(item.id) === String(comment.postId));
  return post ? post.title : '文章留言区';
}

function requestPath(url) {
  return new URL(url).pathname.replace(/\/+$/, '') || '/';
}

async function readJSON(request) {
  try {
    return await request.json();
  } catch (e) {
    return {};
  }
}

async function readForm(request) {
  try {
    return await request.formData();
  } catch (e) {
    return new FormData();
  }
}

function formString(form, key, fallback = '') {
  const value = form.get(key);
  return value === null || value === undefined ? fallback : String(value);
}

async function requireAuth(request, env) {
  const user = await verifyToken(request, env);
  if (!user) return null;
  return user;
}

async function requireFrontUser(request, env) {
  const user = await verifyToken(request, env);
  if (!user || user.type !== 'user') return null;
  return user;
}

async function putUpload(env, file, prefix, maxBytes) {
  if (!file || typeof file.arrayBuffer !== 'function') return '';
  if (file.size > maxBytes) throw new Error(maxBytes >= 5 * 1024 * 1024 ? '文章图片不能大于 5MB' : '图片不能大于 1MB');
  if (!IMAGE_TYPES.has(file.type)) throw new Error('仅支持 PNG、JPG、GIF、WEBP、SVG 图片');
  const extMap = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg'
  };
  const key = `${prefix}/${Date.now()}-${crypto.randomUUID()}${extMap[file.type] || '.png'}`;
  await env.UPLOADS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { originalName: file.name || '' }
  });
  return `/uploads/${key}`;
}

async function handleAuth(request, env, path, method) {
  if (path === '/api/auth/login' && method === 'POST') {
    const body = await readJSON(request);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const adminUser = env.ADMIN_USERNAME || 'admin';
    const adminPass = env.ADMIN_PASSWORD || 'admin123';
    if (username !== adminUser || password !== adminPass) return error('用户名或密码错误', 401);
    const token = await signToken({ username, role: 'admin' }, env, 24 * 3600);
    return json({ token, username });
  }
  if (path === '/api/auth/verify' && method === 'GET') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('登录令牌无效', 401);
    return json({ valid: true, username: user.username });
  }
  return null;
}

async function handleUsers(request, env, path, method) {
  if (path === '/api/user/register' && method === 'POST') {
    const db = await loadDB(env);
    const body = await readJSON(request);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) return error('用户名和密码不能为空');
    if (username.length < 3) return error('用户名至少需要 3 个字符');
    if (password.length < 6) return error('密码至少需要 6 位');
    if (db.users.some(user => user.username === username)) return error('用户名已存在');
    const salt = crypto.randomUUID();
    const user = { id: Date.now().toString(), username, password: await sha256(`${salt}:${password}`), salt, nickname: '', role: 'user', createdAt: now(), disabled: false, lastLoginAt: null };
    db.users.push(user);
    await saveDB(env, db);
    const token = await signToken({ username, type: 'user', role: 'user' }, env, 7 * 24 * 3600);
    return json({ token, username, role: 'user', nickname: '' }, 201);
  }
  if (path === '/api/user/login' && method === 'POST') {
    const db = await loadDB(env);
    const body = await readJSON(request);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (username === (env.ADMIN_USERNAME || 'admin') && password === (env.ADMIN_PASSWORD || 'admin123')) {
      const token = await signToken({ username, type: 'user', role: 'admin' }, env, 7 * 24 * 3600);
      return json({ token, username, role: 'admin', nickname: '' });
    }
    const user = db.users.find(item => item.username === username);
    if (!user || user.password !== await sha256(`${user.salt || ''}:${password}`)) return error('用户名或密码错误', 401);
    if (user.disabled) return error('账号已被禁用，请联系管理员', 403);
    user.lastLoginAt = now();
    await saveDB(env, db);
    const role = user.role === 'admin' ? 'admin' : 'user';
    const token = await signToken({ username, type: 'user', role }, env, 7 * 24 * 3600);
    return json({ token, username, role, nickname: user.nickname || '' });
  }
  if (path === '/api/user/me' && method === 'GET') {
    const user = await requireAuth(request, env);
    if (!user || user.type !== 'user') return error('未登录', 401);
    const db = await loadDB(env);
    // 管理员直接返回
    if (user.role === 'admin' && user.username === (env.ADMIN_USERNAME || 'admin')) {
      const result = { username: user.username, role: 'admin', nickname: '' };
      const approvedRequest = (db.genealogyPasswordRequests || []).find(
        r => r.username === user.username && r.status === 'approved' && r.approvedPassword
      );
      if (approvedRequest) result.genealogyPassword = approvedRequest.approvedPassword;
      return json(result);
    }
    // 普通用户从数据库读取最新信息
    const dbUser = (db.users || []).find(u => u.username === user.username);
    if (!dbUser) return json({ username: user.username, role: user.role || 'user', nickname: '' });
    if (dbUser.disabled) return error('该账号已被禁用', 403);
    const result = {
      username: dbUser.username,
      role: dbUser.role === 'admin' ? 'admin' : 'user',
      nickname: dbUser.nickname || ''
    };
    // 查找用户已批准的族谱密码申请
    const approvedRequest = (db.genealogyPasswordRequests || []).find(
      r => r.username === user.username && r.status === 'approved' && r.approvedPassword
    );
    if (approvedRequest) {
      result.genealogyPassword = approvedRequest.approvedPassword;
    }
    return json(result);
  }
  // 获取当前用户点赞的文章列表
  if (path === '/api/user/likes' && method === 'GET') {
    const user = await requireFrontUser(request, env);
    if (!user) return error('请先登录前台账号', 401);
    const db = await loadDB(env);
    const likedPostIds = (db.likes || [])
      .filter(l => l.username === user.username)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .map(l => l.postId);
    const posts = likedPostIds
      .map(id => db.posts.find(p => String(p.id) === String(id)))
      .filter(p => p && p.published !== false)
      .map(({ content, ...rest }) => rest);
    return json(posts);
  }
  // 获取当前用户收藏的文章列表
  if (path === '/api/user/favorites' && method === 'GET') {
    const user = await requireFrontUser(request, env);
    if (!user) return error('请先登录前台账号', 401);
    const db = await loadDB(env);
    const favoritedPostIds = (db.favorites || [])
      .filter(f => f.username === user.username)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .map(f => f.postId);
    const posts = favoritedPostIds
      .map(id => db.posts.find(p => String(p.id) === String(id)))
      .filter(p => p && p.published !== false)
      .map(({ content, ...rest }) => rest);
    return json(posts);
  }
  // 切换点赞
  const likeMatch = path.match(/^\/api\/user\/likes\/([^/]+)$/);
  if (likeMatch && method === 'POST') {
    const user = await requireFrontUser(request, env);
    if (!user) return error('请先登录前台账号', 401);
    const db = await loadDB(env);
    const postId = String(likeMatch[1]);
    const post = db.posts.find(p => String(p.id) === postId);
    if (!post) return error('文章不存在', 404);
    if (post.published === false) return error('该文章已下架', 403);
    if (!Array.isArray(db.likes)) db.likes = [];
    const idx = db.likes.findIndex(l => l.username === user.username && l.postId === postId);
    if (idx !== -1) {
      db.likes.splice(idx, 1);
      await saveDB(env, db);
      return json({ liked: false, message: '已取消点赞' });
    } else {
      db.likes.push({ username: user.username, postId, createdAt: now() });
      await saveDB(env, db);
      return json({ liked: true, message: '点赞成功' });
    }
  }
  // 切换收藏
  const favMatch = path.match(/^\/api\/user\/favorites\/([^/]+)$/);
  if (favMatch && method === 'POST') {
    const user = await requireFrontUser(request, env);
    if (!user) return error('请先登录前台账号', 401);
    const db = await loadDB(env);
    const postId = String(favMatch[1]);
    const post = db.posts.find(p => String(p.id) === postId);
    if (!post) return error('文章不存在', 404);
    if (post.published === false) return error('该文章已下架', 403);
    if (!Array.isArray(db.favorites)) db.favorites = [];
    const idx = db.favorites.findIndex(f => f.username === user.username && f.postId === postId);
    if (idx !== -1) {
      db.favorites.splice(idx, 1);
      await saveDB(env, db);
      return json({ favorited: false, message: '已取消收藏' });
    } else {
      db.favorites.push({ username: user.username, postId, createdAt: now() });
      await saveDB(env, db);
      return json({ favorited: true, message: '收藏成功' });
    }
  }
  // 获取用户互动状态（点赞/收藏）
  if (path === '/api/user/interactions' && method === 'GET') {
    const user = await requireFrontUser(request, env);
    if (!user) return error('请先登录前台账号', 401);
    const db = await loadDB(env);
    const likedIds = (db.likes || []).filter(l => l.username === user.username).map(l => l.postId);
    const favoritedIds = (db.favorites || []).filter(f => f.username === user.username).map(f => f.postId);
    return json({ likedIds, favoritedIds });
  }
  if (path === '/api/user/submissions' && method === 'GET') {
    const user = await requireFrontUser(request, env);
    if (!user) return error('请先登录前台账号', 401);
    const db = await loadDB(env);
    const list = db.posts
      .filter(post => post.submittedBy === user.username)
      .sort((a, b) => new Date(b.submittedAt || b.createdAt) - new Date(a.submittedAt || a.createdAt))
      .map(({ content, ...rest }) => rest);
    return json(list);
  }
  if (path === '/api/user/submissions' && method === 'POST') {
    const user = await requireFrontUser(request, env);
    if (!user) return error('请先登录前台账号', 401);
    const db = await loadDB(env);
    const body = await readJSON(request);
    const title = String(body.title || '').trim();
    const summary = String(body.summary || '').trim();
    const content = String(body.content || '').trim();
    const category = String(body.category || '投稿').trim() || '投稿';
    const rawTags = Array.isArray(body.tags) ? body.tags : String(body.tags || '').split(/[,，]/);
    const tags = rawTags.map(tag => String(tag || '').trim()).filter(Boolean).slice(0, 8);
    if (!title) return error('投稿标题不能为空');
    if (!content) return error('投稿正文不能为空');
    if (title.length > 80) return error('标题不能超过 80 个字符');
    if (summary.length > 300) return error('摘要不能超过 300 个字符');
    if (content.length > 20000) return error('正文不能超过 20000 个字符');
    const post = {
      id: Date.now().toString() + '-' + crypto.randomUUID().slice(0, 8),
      title,
      summary,
      content: sanitizeUserHtml(content),
      cover: '',
      author: user.username,
      category,
      tags,
      createdAt: now(),
      updatedAt: now(),
      views: 0,
      published: false,
      pinned: false,
      announcement: false,
      showOnHome: true,
      reviewStatus: 'pending',
      submittedBy: user.username,
      submittedAt: now(),
      reviewedAt: '',
      reviewer: '',
      rejectionReason: ''
    };
    db.posts.push(post);
    if (!db.categories.includes(category)) db.categories.push(category);
    tags.forEach(tag => { if (tag && !db.tags.includes(tag)) db.tags.push(tag); });
    await saveDB(env, db);
    const { content: _content, ...safe } = post;
    return json({ message: '投稿已提交，请等待管理员审核', submission: safe }, 201);
  }
  if (path === '/api/user/uploads/images' && method === 'POST') {
    const user = await requireFrontUser(request, env);
    if (!user) return error('请先登录前台账号', 401);
    const form = await readForm(request);
    const urlPath = await putUpload(env, form.get('image'), 'articles', 5 * 1024 * 1024);
    if (!urlPath) return error('请先选择要上传的图片');
    return json({ url: urlPath, html: `<p><img src="${urlPath}" alt="投稿图片"></p>` }, 201);
  }
  // 更新用户个人资料
  if (path === '/api/user/profile' && method === 'PUT') {
    const user = await requireFrontUser(request, env);
    if (!user) return error('请先登录前台账号', 401);
    const db = await loadDB(env);
    const target = db.users.find(u => u.username === user.username);
    if (!target) return error('用户不存在', 404);
    const body = await readJSON(request);
    if (body.nickname !== undefined) {
      target.nickname = String(body.nickname).trim().slice(0, 20);
    }
    await saveDB(env, db);
    return json({ username: target.username, nickname: target.nickname || '', role: target.role || 'user' });
  }
  return null;
}

async function handlePosts(request, env, path, method, url) {
  const publicPost = path.match(/^\/api\/posts\/([^/]+)$/);
  const adminPost = path.match(/^\/api\/admin\/posts\/([^/]+)$/);

  if (path === '/api/posts' && method === 'GET') {
    const db = await loadDB(env);
    const category = url.searchParams.get('category');
    const tag = url.searchParams.get('tag');
    const search = url.searchParams.get('search');
    const home = url.searchParams.get('home');
    let posts = db.posts.filter(p => p.published && !p.announcement);
    if (home === '1' || home === 'true') posts = posts.filter(p => p.showOnHome === true);
    if (category) posts = posts.filter(p => p.category === category);
    if (tag) posts = posts.filter(p => (p.tags || []).includes(tag));
    if (search) {
      const kw = search.toLowerCase();
      posts = posts.filter(p => String(p.title || '').toLowerCase().includes(kw) || String(p.summary || '').toLowerCase().includes(kw) || String(p.content || '').toLowerCase().includes(kw));
    }
    return json(sortPostsForList(posts).map(({ content, ...rest }) => rest));
  }

  if (path === '/api/announcements' && method === 'GET') {
    const db = await loadDB(env);
    const limit = Math.max(1, Math.min(20, Number(url.searchParams.get('limit')) || 5));
    const posts = sortPostsForList(db.posts.filter(p => p.published && p.announcement)).slice(0, limit);
    return json(posts.map(({ content, ...rest }) => rest));
  }

  // ===== 广告管理 API =====
  if (path === '/api/ads' && method === 'GET') {
    const db = await loadDB(env);
    const ads = (db.ads || []).filter(a => a.active);
    return json(ads.map(a => ({
      id: a.id, position: a.position, type: a.type, title: a.title,
      content: a.content, imageUrl: a.imageUrl, link: a.link,
      active: a.active, format: a.format
    })));
  }

  if (publicPost && method === 'GET') {
    const db = await loadDB(env);
    const post = db.posts.find(p => String(p.id) === decodeURIComponent(publicPost[1]));
    if (!post || !post.published) return error('文章不存在', 404);
    post.views = Number(post.views || 0) + 1;
    await saveDB(env, db);
    return json(post);
  }

  if (path === '/api/admin/posts' && method === 'GET') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    return json(sortPostsForList(db.posts).map(({ content, ...rest }) => rest));
  }

  if (adminPost && method === 'GET') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const post = db.posts.find(p => String(p.id) === decodeURIComponent(adminPost[1]));
    if (!post) return error('文章不存在', 404);
    return json(post);
  }

  if (path === '/api/admin/posts' && method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const body = await readJSON(request);
    if (!body.title || !body.content) return error('标题和内容不能为空');
    const post = {
      id: Date.now().toString(),
      title: body.title,
      summary: body.summary || '',
      content: body.content,
      cover: body.cover || '',
      author: body.author || user.username || 'Admin',
      category: body.category || '未分类',
      tags: Array.isArray(body.tags) ? body.tags : [],
      createdAt: now(),
      updatedAt: now(),
      views: 0,
      published: body.published !== undefined ? !!body.published : true,
      pinned: !!body.pinned,
      announcement: !!body.announcement,
      showOnHome: !!body.showOnHome,
      reviewStatus: 'approved'
    };
    db.posts.push(post);
    if (post.category && !db.categories.includes(post.category)) db.categories.push(post.category);
    post.tags.forEach(tag => { if (tag && !db.tags.includes(tag)) db.tags.push(tag); });
    await saveDB(env, db);
    return json(post, 201);
  }

  if (adminPost && method === 'PUT') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const id = decodeURIComponent(adminPost[1]);
    const idx = db.posts.findIndex(p => String(p.id) === id);
    if (idx === -1) return error('文章不存在', 404);
    const body = await readJSON(request);
    const current = db.posts[idx];
    db.posts[idx] = {
      ...current,
      title: body.title !== undefined ? body.title : current.title,
      summary: body.summary !== undefined ? body.summary : current.summary,
      content: body.content !== undefined ? body.content : current.content,
      cover: body.cover !== undefined ? body.cover : current.cover,
      author: body.author !== undefined ? body.author : current.author,
      category: body.category !== undefined ? body.category : current.category,
      tags: body.tags !== undefined ? body.tags : current.tags,
      published: body.published !== undefined ? !!body.published : current.published,
      pinned: body.pinned !== undefined ? !!body.pinned : !!current.pinned,
      announcement: body.announcement !== undefined ? !!body.announcement : !!current.announcement,
      showOnHome: body.showOnHome !== undefined ? !!body.showOnHome : current.showOnHome === true,
      updatedAt: now()
    };
    if (db.posts[idx].category && !db.categories.includes(db.posts[idx].category)) db.categories.push(db.posts[idx].category);
    (db.posts[idx].tags || []).forEach(tag => { if (tag && !db.tags.includes(tag)) db.tags.push(tag); });
    await saveDB(env, db);
    return json(db.posts[idx]);
  }

  if (adminPost && method === 'DELETE') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const idx = db.posts.findIndex(p => String(p.id) === decodeURIComponent(adminPost[1]));
    if (idx === -1) return error('文章不存在', 404);
    db.posts.splice(idx, 1);
    await saveDB(env, db);
    return json({ message: '删除成功' });
  }

  if (path === '/api/admin/uploads/images' && method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const form = await readForm(request);
    const urlPath = await putUpload(env, form.get('image'), 'articles', 5 * 1024 * 1024);
    if (!urlPath) return error('请先选择要上传的图片');
    return json({ url: urlPath, html: `<p><img src="${urlPath}" alt="文章图片"></p>` }, 201);
  }

  // 批量操作文章
  if (path === '/api/admin/posts/batch' && method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const body = await readJSON(request);
    const action = String(body.action || '').trim();
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    if (!ids.length) return error('请选择要操作的文章');
    const validActions = ['delete', 'publish', 'draft', 'pin', 'unpin'];
    if (!validActions.includes(action)) return error('无效的操作类型');
    let updated = 0;
    const ts = now();
    if (action === 'delete') {
      for (let i = db.posts.length - 1; i >= 0; i--) {
        if (ids.includes(String(db.posts[i].id))) {
          db.posts.splice(i, 1);
          updated++;
        }
      }
    } else {
      for (let j = 0; j < db.posts.length; j++) {
        if (ids.includes(String(db.posts[j].id))) {
          if (action === 'publish') db.posts[j].published = true;
          else if (action === 'draft') db.posts[j].published = false;
          else if (action === 'pin') db.posts[j].pinned = true;
          else if (action === 'unpin') db.posts[j].pinned = false;
          db.posts[j].updatedAt = ts;
          updated++;
        }
      }
    }
    await saveDB(env, db);
    return json({ success: true, updated });
  }

  // 上传默认封面图
  if (path === '/api/admin/uploads/default-cover' && method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const form = await readForm(request);
    const oldCover = db.settings.defaultCover || '';
    if (oldCover && oldCover.startsWith('/uploads/')) {
      const oldKey = decodeURIComponent(oldCover.replace(/^\/uploads\//, ''));
      await env.UPLOADS.delete(oldKey).catch(() => {});
    }
    const urlPath = await putUpload(env, form.get('image'), 'articles', 5 * 1024 * 1024);
    if (!urlPath) return error('请先选择要上传的图片');
    db.settings.defaultCover = urlPath;
    db.settings.updatedAt = now();
    await saveDB(env, db);
    return json({ url: urlPath }, 201);
  }

  return null;
}

async function handleSubmissions(request, env, path, method, url) {
  const statusMatch = path.match(/^\/api\/admin\/submissions\/([^/]+)\/status$/);
  if (path === '/api/admin/submissions' && method === 'GET') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const status = String(url.searchParams.get('status') || '').trim();
    let submissions = db.posts.filter(post => post.submittedBy || ['pending', 'approved', 'rejected'].includes(post.reviewStatus));
    if (['pending', 'approved', 'rejected'].includes(status)) {
      submissions = submissions.filter(post => (post.reviewStatus || (post.published ? 'approved' : 'pending')) === status);
    }
    return json(submissions
      .sort((a, b) => new Date(b.submittedAt || b.createdAt) - new Date(a.submittedAt || a.createdAt))
      .map(({ content, ...rest }) => rest));
  }
  if (statusMatch && method === 'PATCH') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const body = await readJSON(request);
    const post = db.posts.find(item => String(item.id) === decodeURIComponent(statusMatch[1]));
    if (!post || !post.submittedBy) return error('投稿不存在', 404);
    const status = String(body.status || '').trim();
    if (!['pending', 'approved', 'rejected'].includes(status)) return error('审核状态无效');
    post.reviewStatus = status;
    post.published = status === 'approved';
    post.reviewedAt = now();
    post.reviewer = user.username || 'admin';
    post.rejectionReason = status === 'rejected' ? String(body.reason || '').trim() : '';
    post.updatedAt = now();
    await saveDB(env, db);
    return json(post);
  }
  return null;
}

async function handleMetaSettings(request, env, path, method) {
  if (path === '/api/meta' && method === 'GET') {
    const db = await loadDB(env);
    return json({ categories: db.categories, tags: db.tags });
  }
  if (path === '/api/settings' && method === 'GET') {
    const db = await loadDB(env);
    return json({
      siteName: db.settings.siteName || '麦氏乡村',
      siteSubtitle: db.settings.siteSubtitle || '记录麦氏家族族谱传承、乡村风貌与乡亲故事',
      description: db.settings.description || '',
      logo: db.settings.logo || '',
      footerText: db.settings.footerText || '',
      navLinks: db.settings.navLinks || [],
      defaultCover: db.settings.defaultCover || '',
      displayMode: db.settings.displayMode || 'default',
      tempAccessMode: db.settings.tempAccessMode || false,
      tempAccessNotice: db.settings.tempAccessNotice || '',
      tempAccessKey: db.settings.tempAccessKey || '',
      maintenanceMode: db.settings.maintenanceMode || false,
      maintenanceMessage: db.settings.maintenanceMessage || '网站维护中，敬请谅解'
    });
  }
  if (path === '/api/bootstrap' && method === 'GET') {
    const db = await loadDB(env);
    return json({
      settings: {
        siteName: db.settings.siteName || '麦氏乡村',
        siteSubtitle: db.settings.siteSubtitle || '记录麦氏家族族谱传承、乡村风貌与乡亲故事',
        description: db.settings.description || '',
        logo: db.settings.logo || '',
        footerText: db.settings.footerText || '',
        navLinks: db.settings.navLinks || [],
        defaultCover: db.settings.defaultCover || '',
        displayMode: db.settings.displayMode || 'default',
        maintenanceMode: db.settings.maintenanceMode || false,
        maintenanceMessage: db.settings.maintenanceMessage || '网站维护中，敬请谅解'
      },
      meta: { categories: db.categories || [], tags: db.tags || [] }
    });
  }
  if (path === '/api/about' && method === 'GET') {
    const db = await loadDB(env);
    return json({
      ...(db.settings.about || {}),
      contact: db.settings.contact || {},
      sponsor: db.settings.sponsor || {}
    });
  }
  if (path === '/api/admin/settings' && method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const form = await readForm(request);
    const logo = form.get('logo');
    const nextLogo = logo && typeof logo.arrayBuffer === 'function' && logo.size
      ? await putUpload(env, logo, 'site', 1024 * 1024)
      : db.settings.logo || '';

    // 处理导航链接
    let navLinks = db.settings.navLinks || [];
    const navLinksRaw = formString(form, 'navLinks', '');
    if (navLinksRaw) {
      try {
        navLinks = JSON.parse(navLinksRaw);
        if (!Array.isArray(navLinks)) navLinks = db.settings.navLinks || [];
      } catch (e) {
        navLinks = db.settings.navLinks || [];
      }
    }

    // 处理临时访问模式
    const tempAccessRaw = formString(form, 'tempAccessMode', '');
    const tempAccessMode = tempAccessRaw === 'true' || tempAccessRaw === true;
    const tempAccessNotice = formString(form, 'tempAccessNotice', '').slice(0, 200);

    // 处理临时访问密钥
    let tempAccessKey = db.settings.tempAccessKey || '';
    const regenerateKey = formString(form, 'regenerateAccessKey', '');
    if (regenerateKey === 'true') {
      tempAccessKey = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    } else if (formString(form, 'tempAccessKey', '') !== '') {
      tempAccessKey = formString(form, 'tempAccessKey', '').trim();
    } else if (formString(form, 'tempAccessKey', '') === '' && form.has('tempAccessKey')) {
      tempAccessKey = '';
    }

    // 处理默认封面图
    const defaultCoverRaw = formString(form, 'defaultCover', '');
    const defaultCover = defaultCoverRaw !== '' || form.has('defaultCover')
      ? defaultCoverRaw.trim()
      : (db.settings.defaultCover || '');

    // 处理显示模式
    const VALID_DISPLAY_MODES = ['default', 'list', 'grid', 'waterfall', 'magazine'];
    const displayModeRaw = formString(form, 'displayMode', '');
    const displayMode = displayModeRaw !== ''
      ? (VALID_DISPLAY_MODES.includes(displayModeRaw.trim()) ? displayModeRaw.trim() : 'default')
      : (db.settings.displayMode || 'default');

    // 处理维护模式设置
    const maintenanceModeRaw = formString(form, 'maintenanceMode', '');
    const maintenanceMode = maintenanceModeRaw === 'true' || maintenanceModeRaw === 'true';
    const maintenancePassword = formString(form, 'maintenancePassword', db.settings.maintenancePassword || '');
    const maintenanceMessage = formString(form, 'maintenanceMessage', '') !== ''
      ? formString(form, 'maintenanceMessage', '').trim() || '网站维护中，敬请谅解'
      : (db.settings.maintenanceMessage || '网站维护中，敬请谅解');

    db.settings = {
      ...db.settings,
      siteName: formString(form, 'siteName', db.settings.siteName || '麦氏乡村').trim() || '麦氏乡村',
      siteSubtitle: formString(form, 'siteSubtitle', '').trim(),
      description: formString(form, 'description', '').trim(),
      footerText: formString(form, 'footerText', '').trim(),
      logo: nextLogo,
      navLinks: navLinksRaw ? navLinks : db.settings.navLinks,
      defaultCover,
      displayMode,
      tempAccessMode: tempAccessRaw !== '' ? tempAccessMode : (db.settings.tempAccessMode || false),
      tempAccessNotice: formString(form, 'tempAccessNotice', '') !== '' ? tempAccessNotice : (db.settings.tempAccessNotice || ''),
      tempAccessKey: regenerateKey === 'true' ? tempAccessKey : (form.has('tempAccessKey') ? tempAccessKey : (db.settings.tempAccessKey || '')),
      maintenanceMode: maintenanceModeRaw !== '' ? maintenanceMode : (db.settings.maintenanceMode || false),
      maintenancePassword: maintenancePassword,
      maintenanceMessage: maintenanceMessage,
      updatedAt: now()
    };
    await saveDB(env, db);
    return json(db.settings);
  }
  if (path === '/api/admin/about' && method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const body = await readJSON(request);
    db.settings.about = {
      kicker: String(body.kicker || 'About').trim() || 'About',
      title: String(body.title || '关于本站').trim() || '关于本站',
      summary: String(body.summary || '').trim(),
      content: String(body.content || '')
    };
    db.settings.updatedAt = now();
    await saveDB(env, db);
    return json(db.settings.about);
  }
  if (path === '/api/admin/contact' && method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const body = await readJSON(request);
    db.settings.contact = {
      email: String(body.email || '').trim(),
      wechat: String(body.wechat || '').trim(),
      qq: String(body.qq || '').trim(),
      phone: String(body.phone || '').trim(),
      address: String(body.address || '').trim()
    };
    db.settings.updatedAt = now();
    await saveDB(env, db);
    return json(db.settings.contact);
  }
  if (path === '/api/admin/sponsor' && method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const body = await readJSON(request);
    db.settings.sponsor = {
      description: String(body.description || '').trim(),
      wechatQr: String(body.wechatQr || '').trim(),
      alipayQr: String(body.alipayQr || '').trim(),
      code: String(body.code || '').trim()
    };
    db.settings.updatedAt = now();
    await saveDB(env, db);
    return json(db.settings.sponsor);
  }
  return null;
}

async function handleCategories(request, env, path, method) {
  const match = path.match(/^\/api\/admin\/categories\/(.+)$/);
  if (path === '/api/admin/categories' && method === 'GET') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    return json((db.categories || []).map(name => ({
      name,
      postCount: db.posts.filter(post => post.category === name).length
    })));
  }
  if (path === '/api/admin/categories' && method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const body = await readJSON(request);
    const name = String(body.name || '').trim();
    if (!name) return error('分类名称不能为空');
    if (name.length > 30) return error('分类名称不能超过 30 个字符');
    if (db.categories.includes(name)) return error('分类已存在');
    db.categories.push(name);
    await saveDB(env, db);
    return json({ name, postCount: 0 }, 201);
  }
  if (match && method === 'PUT') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const oldName = decodeURIComponent(match[1]);
    const body = await readJSON(request);
    const newName = String(body.name || '').trim();
    if (!oldName || !db.categories.includes(oldName)) return error('分类不存在', 404);
    if (!newName) return error('新分类名称不能为空');
    if (newName !== oldName && db.categories.includes(newName)) return error('新分类名称已存在');
    db.categories = db.categories.map(item => item === oldName ? newName : item);
    db.posts = db.posts.map(post => post.category === oldName ? { ...post, category: newName, updatedAt: now() } : post);
    await saveDB(env, db);
    return json({ name: newName, postCount: db.posts.filter(post => post.category === newName).length });
  }
  if (match && method === 'DELETE') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const name = decodeURIComponent(match[1]);
    if (!name || !db.categories.includes(name)) return error('分类不存在', 404);
    if (db.posts.some(post => post.category === name)) return error('该分类下还有文章，不能删除。请先修改文章分类。');
    db.categories = db.categories.filter(item => item !== name);
    await saveDB(env, db);
    return json({ message: '删除成功' });
  }
  return null;
}

// ===== 广告管理 API =====
async function handleAds(request, env, path, method, url) {
  const adMatch = path.match(/^\/api\/admin\/ads\/(.+)$/);

  // 后台获取所有广告
  if (path === '/api/admin/ads' && method === 'GET') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    return json(db.ads || []);
  }

  // 后台创建广告
  if (path === '/api/admin/ads' && method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    if (!db.ads) db.ads = [];
    const body = await readJSON(request);
    const { position, type, title, content, imageUrl, link, format } = body;
    if (!position || !type) return error('广告位置和类型必填', 400);
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
      clicks: 0,
      impressions: 0,
      createdAt: now()
    };
    db.ads.push(ad);
    await saveDB(env, db);
    return json(ad, 201);
  }

  // 后台更新广告
  if (adMatch && method === 'PUT') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    if (!db.ads) db.ads = [];
    const ad = db.ads.find(a => a.id === decodeURIComponent(adMatch[1]));
    if (!ad) return error('广告不存在', 404);
    const body = await readJSON(request);
    if (body.position !== undefined) ad.position = String(body.position).trim();
    if (body.type !== undefined) ad.type = String(body.type).trim();
    if (body.title !== undefined) ad.title = String(body.title).trim();
    if (body.content !== undefined) ad.content = String(body.content).trim();
    if (body.imageUrl !== undefined) ad.imageUrl = String(body.imageUrl).trim();
    if (body.link !== undefined) ad.link = String(body.link).trim();
    if (body.format !== undefined) ad.format = String(body.format).trim();
    if (body.active !== undefined) ad.active = Boolean(body.active);
    ad.updatedAt = now();
    await saveDB(env, db);
    return json(ad);
  }

  // 后台删除广告
  if (adMatch && method === 'DELETE') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    if (!db.ads) db.ads = [];
    const idx = db.ads.findIndex(a => a.id === decodeURIComponent(adMatch[1]));
    if (idx === -1) return error('广告不存在', 404);
    db.ads.splice(idx, 1);
    await saveDB(env, db);
    return json({ message: '删除成功' });
  }

  // 广告点击统计
  if (adMatch && method === 'POST' && path.endsWith('/click')) {
    const db = await loadDB(env);
    if (!db.ads) db.ads = [];
    const ad = db.ads.find(a => a.id === decodeURIComponent(adMatch[1].replace('/click', '')));
    if (ad) {
      ad.clicks = Number(ad.clicks || 0) + 1;
      await saveDB(env, db);
    }
    return json({ message: 'ok' });
  }

  return null;
}

async function handleComments(request, env, path, method, url) {
  const statusMatch = path.match(/^\/api\/admin\/comments\/([^/]+)\/status$/);
  const deleteMatch = path.match(/^\/api\/admin\/comments\/([^/]+)$/);
  const replyMatch = path.match(/^\/api\/admin\/comments\/([^/]+)\/reply$/);
  if (path === '/api/comments' && method === 'GET') {
    const db = await loadDB(env);
    const settings = normalizeCommentSettings(db.settings.commentSettings);
    const targetType = url.searchParams.get('targetType') === 'post' ? 'post' : 'home';
    const postId = String(url.searchParams.get('postId') || '').trim();
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || (targetType === 'home' ? settings.homepagePageSize : settings.postPageSize)));
    let comments = db.comments.filter(comment => comment.status === 'approved' && comment.targetType === targetType);
    if (targetType === 'post') comments = comments.filter(comment => String(comment.postId || '') === postId);
    comments = comments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const total = comments.length;
    const start = (page - 1) * limit;
    return json({ comments: comments.slice(start, start + limit).map(sanitizePublicComment), page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
  }
  if (path === '/api/comments' && method === 'POST') {
    const db = await loadDB(env);
    const settings = normalizeCommentSettings(db.settings.commentSettings);
    const body = await readJSON(request);
    const user = await verifyToken(request, env);
    const targetType = body.targetType === 'post' ? 'post' : 'home';
    const postId = String(body.postId || '').trim();
    const content = String(body.content || '').trim();
    const authorName = user?.username || String(body.authorName || '').trim() || '游客';
    if (!content) return error('留言内容不能为空');
    if (content.length > 1000) return error('留言内容不能超过 1000 字');
    if (targetType === 'post' && !db.posts.find(item => String(item.id) === postId && item.published)) return error('文章不存在，无法留言', 404);
    const matchedKeywords = settings.blockedKeywords.filter(keyword => content.toLowerCase().includes(String(keyword).toLowerCase()));
    const comment = {
      id: Date.now().toString() + '-' + crypto.randomUUID().slice(0, 8),
      targetType,
      postId: targetType === 'post' ? postId : '',
      authorName,
      content,
      status: matchedKeywords.length ? 'pending' : 'approved',
      matchedKeywords,
      ip: request.headers.get('CF-Connecting-IP') || '',
      createdAt: now(),
      updatedAt: now()
    };
    db.comments.push(comment);
    await saveDB(env, db);
    return json({ message: comment.status === 'pending' ? '留言已提交，需管理员审核后显示' : '留言发布成功', comment: sanitizePublicComment(comment) }, 201);
  }
  if (path === '/api/admin/comments' && method === 'GET') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const status = String(url.searchParams.get('status') || '').trim();
    const targetType = String(url.searchParams.get('targetType') || '').trim();
    let comments = db.comments || [];
    if (['pending', 'approved', 'rejected'].includes(status)) comments = comments.filter(comment => comment.status === status);
    if (['home', 'post'].includes(targetType)) comments = comments.filter(comment => comment.targetType === targetType);
    return json(comments.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(comment => ({ ...comment, targetTitle: getCommentTargetTitle(db, comment) })));
  }
  // 批量操作留言
  if (path === '/api/admin/comments/batch' && method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const body = await readJSON(request);
    const action = String(body.action || '').trim();
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    if (!ids.length) return error('请选择要操作的留言');
    const validActions = ['approve', 'reject', 'pending', 'delete'];
    if (!validActions.includes(action)) return error('无效的操作类型');
    let updated = 0;
    const ts = now();
    if (action === 'delete') {
      for (let i = db.comments.length - 1; i >= 0; i--) {
        if (ids.includes(String(db.comments[i].id))) {
          db.comments.splice(i, 1);
          updated++;
        }
      }
    } else {
      const statusMap = { approve: 'approved', reject: 'rejected', pending: 'pending' };
      const targetStatus = statusMap[action];
      for (let j = 0; j < db.comments.length; j++) {
        if (ids.includes(String(db.comments[j].id))) {
          db.comments[j].status = targetStatus;
          db.comments[j].updatedAt = ts;
          updated++;
        }
      }
    }
    await saveDB(env, db);
    return json({ success: true, updated });
  }
  if (statusMatch && method === 'PATCH') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const body = await readJSON(request);
    const comment = db.comments.find(item => String(item.id) === decodeURIComponent(statusMatch[1]));
    if (!comment) return error('留言不存在', 404);
    if (!['pending', 'approved', 'rejected'].includes(body.status)) return error('状态无效');
    comment.status = body.status;
    comment.updatedAt = now();
    await saveDB(env, db);
    return json(comment);
  }
  if (deleteMatch && method === 'DELETE') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const idx = db.comments.findIndex(item => String(item.id) === decodeURIComponent(deleteMatch[1]));
    if (idx === -1) return error('留言不存在', 404);
    db.comments.splice(idx, 1);
    await saveDB(env, db);
    return json({ message: '删除成功' });
  }
  // 回复留言
  if (replyMatch && method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const comment = db.comments.find(item => String(item.id) === decodeURIComponent(replyMatch[1]));
    if (!comment) return error('留言不存在', 404);
    const body = await readJSON(request);
    const reply = String(body.reply || '').trim();
    if (!reply) return error('回复内容不能为空');
    if (reply.length > 1000) return error('回复内容不能超过 1000 字');
    comment.reply = reply;
    comment.replyAt = now();
    comment.updatedAt = now();
    await saveDB(env, db);
    return json(comment);
  }
  // 删除留言回复
  if (replyMatch && method === 'DELETE') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const comment = db.comments.find(item => String(item.id) === decodeURIComponent(replyMatch[1]));
    if (!comment) return error('留言不存在', 404);
    delete comment.reply;
    delete comment.replyAt;
    comment.updatedAt = now();
    await saveDB(env, db);
    return json({ message: '回复已删除' });
  }
  if (path === '/api/admin/comment-settings' && method === 'GET') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    return json(normalizeCommentSettings(db.settings.commentSettings));
  }
  if (path === '/api/admin/comment-settings' && method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const body = await readJSON(request);
    db.settings.commentSettings = normalizeCommentSettings(body);
    db.settings.updatedAt = now();
    await saveDB(env, db);
    return json(db.settings.commentSettings);
  }
  return null;
}

async function handleFriends(request, env, path, method) {
  const adminMatch = path.match(/^\/api\/admin\/friends\/([^/]+)$/);
  const statusMatch = path.match(/^\/api\/admin\/friends\/([^/]+)\/status$/);
  if (path === '/api/friends' && method === 'GET') {
    const db = await loadDB(env);
    return json(db.friends.filter(friend => friend.status === 'approved' && friend.visible !== false).sort((a, b) => {
      var sa = Number(a.sortOrder);
      var sb = Number(b.sortOrder);
      if (isFinite(sa) && isFinite(sb) && sa !== sb) return sa - sb;
      if (isFinite(sa) && !isFinite(sb)) return -1;
      if (!isFinite(sa) && isFinite(sb)) return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    }));
  }
  if (path === '/api/friends' && method === 'POST') {
    const db = await loadDB(env);
    const form = await readForm(request);
    const name = formString(form, 'name').trim();
    const url = normalizeUrl(formString(form, 'url'));
    const iconUrl = normalizeUrl(formString(form, 'iconUrl'));
    if (!name || !url) return error('站点名称和链接不能为空');
    try { new URL(url); if (iconUrl) new URL(iconUrl); } catch (e) { return error('请输入有效的链接地址'); }
    const avatar = await putUpload(env, form.get('avatar'), 'friends', 1024 * 1024).catch(() => '');
    const friend = {
      id: Date.now().toString(),
      name,
      url,
      description: formString(form, 'description').trim() || '这个朋友还没有留下签名',
      avatar,
      iconUrl,
      sortOrder: 0,
      status: 'pending',
      visible: false,
      createdAt: now(),
      updatedAt: now()
    };
    db.friends.push(friend);
    await saveDB(env, db);
    return json({ message: '友链已提交，请等待后台审核', friend }, 201);
  }
  if (path === '/api/admin/friends' && method === 'GET') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    return json(db.friends.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  }
  if (path === '/api/admin/friends' && method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const form = await readForm(request);
    const name = formString(form, 'name').trim();
    const url = normalizeUrl(formString(form, 'url'));
    const iconUrl = normalizeUrl(formString(form, 'iconUrl'));
    if (!name || !url) return error('站点名称和链接不能为空');
    try { new URL(url); if (iconUrl) new URL(iconUrl); } catch (e) { return error('请输入有效的链接地址'); }
    const finalStatus = ['pending', 'approved', 'rejected'].includes(formString(form, 'status')) ? formString(form, 'status') : 'approved';
    const sortOrderNum = Math.max(0, Math.min(9999, parseInt(formString(form, 'sortOrder'), 10) || 0));
    const friend = {
      id: Date.now().toString(),
      name,
      url,
      description: formString(form, 'description').trim(),
      avatar: await putUpload(env, form.get('avatar'), 'friends', 1024 * 1024).catch(() => ''),
      iconUrl,
      sortOrder: sortOrderNum,
      status: finalStatus,
      visible: finalStatus === 'approved' && formString(form, 'visible') !== 'false',
      createdAt: now(),
      updatedAt: now()
    };
    db.friends.push(friend);
    await saveDB(env, db);
    return json(friend, 201);
  }
  if (adminMatch && method === 'PUT') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const idx = db.friends.findIndex(friend => String(friend.id) === decodeURIComponent(adminMatch[1]));
    if (idx === -1) return error('友链不存在', 404);
    const current = db.friends[idx];
    const form = await readForm(request);
    const nextStatus = ['pending', 'approved', 'rejected'].includes(formString(form, 'status')) ? formString(form, 'status') : current.status;
    const uploadedAvatar = await putUpload(env, form.get('avatar'), 'friends', 1024 * 1024).catch(() => '');
    const formSortOrder = formString(form, 'sortOrder');
    const nextSortOrder = formSortOrder !== '' && formSortOrder !== undefined ? Math.max(0, Math.min(9999, parseInt(formSortOrder, 10) || 0)) : (current.sortOrder || 0);
    const next = {
      ...current,
      name: form.has('name') ? formString(form, 'name').trim() : current.name,
      url: form.has('url') ? normalizeUrl(formString(form, 'url')) : current.url,
      description: form.has('description') ? formString(form, 'description').trim() : current.description,
      avatar: uploadedAvatar || current.avatar,
      iconUrl: form.has('iconUrl') ? normalizeUrl(formString(form, 'iconUrl')) : current.iconUrl,
      sortOrder: nextSortOrder,
      status: nextStatus,
      visible: nextStatus === 'approved' && formString(form, 'visible', String(current.visible)) !== 'false',
      updatedAt: now()
    };
    try { if (next.url) new URL(next.url); if (next.iconUrl) new URL(next.iconUrl); } catch (e) { return error('请输入有效的链接地址'); }
    db.friends[idx] = next;
    await saveDB(env, db);
    return json(next);
  }
  if (statusMatch && method === 'PATCH') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const body = await readJSON(request);
    const friend = db.friends.find(item => String(item.id) === decodeURIComponent(statusMatch[1]));
    if (!friend) return error('友链不存在', 404);
    if (!['pending', 'approved', 'rejected'].includes(body.status)) return error('状态无效');
    friend.status = body.status;
    friend.visible = body.status === 'approved';
    friend.updatedAt = now();
    await saveDB(env, db);
    return json(friend);
  }
  if (adminMatch && method === 'DELETE') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const idx = db.friends.findIndex(friend => String(friend.id) === decodeURIComponent(adminMatch[1]));
    if (idx === -1) return error('友链不存在', 404);
    db.friends.splice(idx, 1);
    await saveDB(env, db);
    return json({ message: '删除成功' });
  }
  return null;
}

async function handleStats(request, env, path, method) {
  if (path !== '/api/admin/stats' || method !== 'GET') return null;
  const user = await requireAuth(request, env);
  if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
  const db = await loadDB(env);
  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86400000);
    const dateStr = date.toISOString().split('T')[0];
    last7Days.push({ date: dateStr, count: db.posts.filter(p => String(p.createdAt || '').split('T')[0] === dateStr).length });
  }
  // 留言统计
  let pendingComments = 0;
  let totalComments = 0;
  if (Array.isArray(db.comments)) {
    totalComments = db.comments.length;
    for (const c of db.comments) {
      if (c.status === 'pending') pendingComments++;
    }
  }
  // 族谱统计
  let pendingGenealogy = 0;
  let totalGenealogy = 0;
  if (Array.isArray(db.genealogy)) {
    totalGenealogy = db.genealogy.length;
    for (const g of db.genealogy) {
      if ((g.reviewStatus || 'approved') === 'pending') pendingGenealogy++;
    }
  }
  // 族谱密码申请统计
  let pendingPwdRequests = 0;
  let totalPwdRequests = 0;
  if (Array.isArray(db.genealogyPasswordRequests)) {
    totalPwdRequests = db.genealogyPasswordRequests.length;
    for (const r of db.genealogyPasswordRequests) {
      if (r.status === 'pending') pendingPwdRequests++;
    }
  }
  // 友链待审核统计
  let pendingFriends = 0;
  if (Array.isArray(db.friends)) {
    for (const f of db.friends) {
      if (f.status === 'pending') pendingFriends++;
    }
  }
  return json({
    totalPosts: db.posts.length,
    publishedPosts: db.posts.filter(p => p.published).length,
    totalViews: db.posts.reduce((sum, p) => sum + Number(p.views || 0), 0),
    totalCategories: db.categories.length,
    totalTags: db.tags.length,
    draftPosts: db.posts.filter(p => !p.published).length,
    pendingSubmissions: db.posts.filter(p => p.submittedBy && (p.reviewStatus || 'pending') === 'pending').length,
    pendingGenealogy: pendingGenealogy,
    totalGenealogy: totalGenealogy,
    pendingComments: pendingComments,
    totalComments: totalComments,
    pendingPwdRequests: pendingPwdRequests,
    totalPwdRequests: totalPwdRequests,
    pendingFriends: pendingFriends,
    totalUsers: (db.users || []).length,
    last7Days
  });
}

// 标签管理
async function handleTags(request, env, path, method) {
  const tagMatch = path.match(/^\/api\/admin\/tags\/(.+)$/);
  if (path === '/api/admin/tags' && method === 'GET') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const countMap = {};
    if (db.tags && db.tags.length) {
      for (const t of db.tags) countMap[t] = 0;
    }
    for (const post of db.posts) {
      const postTags = post.tags || [];
      for (const t of postTags) {
        if (t) countMap[t] = (countMap[t] || 0) + 1;
      }
    }
    return json(Object.keys(countMap).sort().map(name => ({ name, postCount: countMap[name] })));
  }
  if (path === '/api/admin/tags' && method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const body = await readJSON(request);
    const name = String(body.name || '').trim();
    if (!name) return error('标签名称不能为空');
    if (name.length > 20) return error('标签名称不能超过 20 个字符');
    if (!Array.isArray(db.tags)) db.tags = [];
    if (db.tags.includes(name)) return error('标签已存在');
    let exists = false;
    for (const post of db.posts) {
      if ((post.tags || []).includes(name)) { exists = true; break; }
    }
    if (exists) return error('标签已存在');
    db.tags.push(name);
    await saveDB(env, db);
    return json({ name, postCount: 0 }, 201);
  }
  if (tagMatch && method === 'PUT') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const oldName = decodeURIComponent(tagMatch[1]);
    const body = await readJSON(request);
    const newName = String(body.newName || '').trim();
    if (!oldName) return error('标签不存在', 404);
    if (!newName) return error('新标签名称不能为空');
    if (newName.length > 20) return error('标签名称不能超过 20 个字符');
    if (newName === oldName) return json({ name: newName, postCount: 0 });
    let exists = false;
    for (const post of db.posts) {
      if ((post.tags || []).includes(newName)) { exists = true; break; }
    }
    if (!exists && Array.isArray(db.tags) && db.tags.includes(newName)) exists = true;
    if (exists) return error('新标签名称已存在');
    let postCount = 0;
    for (const post of db.posts) {
      const postTags = post.tags || [];
      const idx = postTags.indexOf(oldName);
      if (idx !== -1) {
        postTags[idx] = newName;
        post.tags = postTags;
        post.updatedAt = now();
        postCount++;
      }
    }
    if (Array.isArray(db.tags)) {
      const tagIdx = db.tags.indexOf(oldName);
      if (tagIdx !== -1) db.tags[tagIdx] = newName;
    }
    await saveDB(env, db);
    return json({ name: newName, postCount });
  }
  if (tagMatch && method === 'DELETE') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const name = decodeURIComponent(tagMatch[1]);
    if (!name) return error('标签不存在', 404);
    for (const post of db.posts) {
      const tags = post.tags || [];
      const idx = tags.indexOf(name);
      if (idx !== -1) {
        tags.splice(idx, 1);
        post.tags = tags;
        post.updatedAt = now();
      }
    }
    if (Array.isArray(db.tags)) {
      db.tags = db.tags.filter(t => t !== name);
    }
    await saveDB(env, db);
    return json({ message: '删除成功' });
  }
  return null;
}

// 后台用户管理
async function handleAdminUsers(request, env, path, method, url) {
  const userMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (path === '/api/admin/users' && method === 'GET') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const search = String(url.searchParams.get('search') || '').trim().toLowerCase();
    const page = Math.max(1, parseInt(url.searchParams.get('page')) || 1);
    const pageSize = Math.max(1, parseInt(url.searchParams.get('pageSize')) || 10);
    let users = db.users || [];
    if (search) {
      users = users.filter(u => String(u.username || '').toLowerCase().includes(search));
    }
    const total = users.length;
    const start = (page - 1) * pageSize;
    const paginatedUsers = users.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(start, start + pageSize).map(u => ({
      id: u.id, username: u.username, nickname: u.nickname || '', role: u.role || 'user', createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null, disabled: u.disabled || false
    }));
    return json({ users: paginatedUsers, total, page, pageSize });
  }
  if (path === '/api/admin/users' && method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const body = await readJSON(request);
    const name = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!name || name.length < 3 || name.length > 20) return error('用户名长度需在 3-20 个字符之间');
    if (!password || password.length < 6 || password.length > 32) return error('密码长度需在 6-32 个字符之间');
    if (db.users.some(u => u.username === name)) return error('用户名已存在');
    if (name === (env.ADMIN_USERNAME || 'admin')) return error('用户名已存在');
    const salt = crypto.randomUUID();
    const newUser = {
      id: Date.now().toString(),
      username: name,
      password: await sha256(`${salt}:${password}`),
      salt,
      nickname: String(body.nickname || '').trim().slice(0, 20),
      role: body.role === 'admin' ? 'admin' : 'user',
      createdAt: now(),
      disabled: false,
      lastLoginAt: null
    };
    db.users.push(newUser);
    await saveDB(env, db);
    return json({ id: newUser.id, username: newUser.username, nickname: newUser.nickname || '', role: newUser.role, createdAt: newUser.createdAt, lastLoginAt: newUser.lastLoginAt, disabled: newUser.disabled }, 201);
  }
  if (userMatch && method === 'PUT') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const target = db.users.find(item => String(item.id) === decodeURIComponent(userMatch[1]));
    if (!target) return error('用户不存在', 404);
    const body = await readJSON(request);
    if (body.password !== undefined) {
      const pwd = String(body.password);
      if (pwd.length < 6 || pwd.length > 32) return error('密码长度需在 6-32 个字符之间');
      const salt = crypto.randomUUID();
      target.salt = salt;
      target.password = await sha256(`${salt}:${pwd}`);
    }
    if (body.disabled !== undefined) {
      target.disabled = Boolean(body.disabled);
    }
    if (body.role !== undefined) {
      const newRole = body.role === 'admin' ? 'admin' : 'user';
      if (target.username !== (env.ADMIN_USERNAME || 'admin')) {
        target.role = newRole;
      }
    }
    if (body.nickname !== undefined) {
      target.nickname = String(body.nickname || '').trim().slice(0, 20);
    }
    await saveDB(env, db);
    return json({ id: target.id, username: target.username, nickname: target.nickname || '', role: target.role || 'user', createdAt: target.createdAt, lastLoginAt: target.lastLoginAt || null, disabled: target.disabled || false });
  }
  if (userMatch && method === 'DELETE') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const idx = db.users.findIndex(item => String(item.id) === decodeURIComponent(userMatch[1]));
    if (idx === -1) return error('用户不存在', 404);
    const targetUser = db.users[idx];
    if (targetUser.username === (env.ADMIN_USERNAME || 'admin')) return error('不能删除管理员账号');
    const username = targetUser.username;
    db.likes = (db.likes || []).filter(l => l.username !== username);
    db.favorites = (db.favorites || []).filter(f => f.username !== username);
    db.posts = (db.posts || []).filter(p => p.submittedBy !== username);
    db.users.splice(idx, 1);
    await saveDB(env, db);
    return json({ message: '删除成功' });
  }
  // 批量操作用户
  if (path === '/api/admin/users/batch' && method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const body = await readJSON(request);
    const action = String(body.action || '').trim();
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    if (!['delete', 'disable', 'enable'].includes(action)) return error('无效的操作类型');
    if (!ids.length) return error('请选择要操作的用户');
    const adminUsername = env.ADMIN_USERNAME || 'admin';
    let count = 0;
    if (action === 'delete') {
      const toDelete = db.users.filter(u =>
        ids.includes(String(u.id)) && u.username !== adminUsername
      );
      const usernames = toDelete.map(u => u.username);
      db.likes = (db.likes || []).filter(l => !usernames.includes(l.username));
      db.favorites = (db.favorites || []).filter(f => !usernames.includes(f.username));
      db.posts = (db.posts || []).filter(p => !usernames.includes(p.submittedBy));
      db.users = db.users.filter(u => !ids.includes(String(u.id)) || u.username === adminUsername);
      count = toDelete.length;
    } else if (action === 'disable') {
      for (const u of db.users) {
        if (ids.includes(String(u.id)) && u.username !== adminUsername) {
          u.disabled = true;
          count++;
        }
      }
    } else if (action === 'enable') {
      for (const u of db.users) {
        if (ids.includes(String(u.id))) {
          u.disabled = false;
          count++;
        }
      }
    }
    await saveDB(env, db);
    return json({ success: true, updated: count });
  }
  return null;
}

// 媒体库（R2）
const MIME_MAP = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.bmp': 'image/bmp'
};

function getMimeType(filename) {
  const ext = (filename.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

async function handleMedia(request, env, path, method) {
  if (path === '/api/admin/media' && method === 'GET') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    if (!env.UPLOADS) return error('R2 绑定 UPLOADS 未配置', 500);
    const url = new URL(request.url);
    const folder = String(url.searchParams.get('folder') || '').trim();
    const folders = ['articles', 'friends', 'site'].filter(f => !folder || f === folder);
    let allFiles = [];
    for (const f of folders) {
      const listed = await env.UPLOADS.list({ prefix: f + '/' });
      for (const item of listed.objects) {
        const name = item.key.split('/').pop() || item.key;
        allFiles.push({
          path: '/uploads/' + item.key,
          name,
          size: item.size || 0,
          type: getMimeType(name),
          createdAt: item.uploaded ? new Date(item.uploaded).getTime() : 0,
          folder: f
        });
      }
    }
    allFiles.sort((a, b) => b.createdAt - a.createdAt);
    return json({ files: allFiles, total: allFiles.length });
  }
  if (path === '/api/admin/media' && method === 'DELETE') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    if (!env.UPLOADS) return error('R2 绑定 UPLOADS 未配置', 500);
    const db = await loadDB(env);
    const body = await readJSON(request);
    const filePath = String(body.path || '').trim();
    if (!filePath || !filePath.startsWith('/uploads/')) return error('路径不合法');
    const key = decodeURIComponent(filePath.replace(/^\/uploads\//, ''));
    if (key.includes('..') || key.startsWith('/')) return error('路径不合法');
    await env.UPLOADS.delete(key).catch(() => {});
    // 如果删除的是默认封面或站点 logo，清除引用
    if (db.settings.defaultCover === filePath) {
      db.settings.defaultCover = '';
      db.settings.updatedAt = now();
      await saveDB(env, db);
    }
    return json({ message: '删除成功' });
  }
  return null;
}

// 数据导出
async function handleExport(request, env, path, method) {
  if (path !== '/api/admin/export' || method !== 'GET') return null;
  const user = await requireAuth(request, env);
  if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
  const db = await loadDB(env);
  const exportData = {
    posts: db.posts || [],
    categories: db.categories || [],
    tags: db.tags || [],
    comments: db.comments || [],
    users: (db.users || []).map(u => ({ id: u.id, username: u.username, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, disabled: u.disabled })),
    friends: db.friends || [],
    settings: db.settings || {},
    likes: db.likes || [],
    favorites: db.favorites || [],
    genealogy: db.genealogy || [],
    genealogyPasswordRequests: db.genealogyPasswordRequests || [],
    exportedAt: now(),
    version: '1.0'
  };
  const dateStr = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const filename = 'carson-blog-backup-' + dateStr + '.json';
  return new Response(JSON.stringify(exportData, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + filename + '"'
    }
  });
}

// 缓存与 Cloudflare 配置管理
async function handleCache(request, env, path, method) {
  if (path !== '/api/admin/cache/stats' && path !== '/api/admin/cache/clear' && path !== '/api/admin/cache/purge-all' && path !== '/api/admin/cloudflare/config' && path !== '/api/admin/cloudflare/purge') return null;
  const user = await requireAuth(request, env);
  if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);

  // 缓存统计
  if (path === '/api/admin/cache/stats' && method === 'GET') {
    return json({
      total: 0,
      expired: 0,
      active: 0,
      entries: [],
      mode: 'cloudflare',
      message: 'Cloudflare Worker 版本没有本地内存缓存；静态资源和边缘缓存由 Cloudflare 平台管理。'
    });
  }

  // 清除本地缓存（Worker 版无本地缓存，返回提示）
  if (path === '/api/admin/cache/clear' && method === 'POST') {
    return json({
      message: 'Cloudflare 版本已接收清理请求。应用数据接口实时读取 D1；如需清理边缘缓存，请在 Cloudflare 控制台执行 Purge Cache。',
      cleared: 0,
      mode: 'cloudflare'
    });
  }

  // 获取 Cloudflare 缓存配置
  if (path === '/api/admin/cloudflare/config' && method === 'GET') {
    const db = await loadDB(env);
    return json({
      apiToken: db.settings.cloudflareApiToken || '',
      zoneId: db.settings.cloudflareZoneId || '',
      configured: !!(db.settings.cloudflareApiToken && db.settings.cloudflareZoneId)
    });
  }

  // 保存 Cloudflare 缓存配置
  if (path === '/api/admin/cloudflare/config' && method === 'POST') {
    const db = await loadDB(env);
    const body = await readJSON(request);
    const apiToken = String(body.apiToken || '').trim();
    const zoneId = String(body.zoneId || '').trim();
    db.settings.cloudflareApiToken = apiToken;
    db.settings.cloudflareZoneId = zoneId;
    db.settings.updatedAt = now();
    await saveDB(env, db);
    return json({ message: 'Cloudflare 配置已保存', configured: !!(apiToken && zoneId) });
  }

  // 清除 Cloudflare 边缘缓存
  if (path === '/api/admin/cloudflare/purge' && method === 'POST') {
    const db = await loadDB(env);
    const apiToken = db.settings.cloudflareApiToken || '';
    const zoneId = db.settings.cloudflareZoneId || '';
    if (!apiToken || !zoneId) return error('请先在设置中配置 Cloudflare API Token 和 Zone ID');
    const body = await readJSON(request);
    const purgeEverything = body.purgeEverything !== false;
    const payload = JSON.stringify(purgeEverything ? { purge_everything: true } : { files: Array.isArray(body.files) ? body.files : [] });
    try {
      const cfRes = await fetch('https://api.cloudflare.com/client/v4/zones/' + zoneId + '/purge_cache', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiToken,
          'Content-Type': 'application/json'
        },
        body: payload
      });
      const data = await cfRes.json();
      if (data.success) {
        return json({
          message: purgeEverything ? 'Cloudflare 边缘缓存已全部清除' : 'Cloudflare 指定 URL 缓存已清除',
          success: true,
          resultId: data.result && data.result.id ? data.result.id : ''
        });
      }
      const errMsg = (data.errors && data.errors[0] && data.errors[0].message) || 'Cloudflare API 返回错误';
      return error(errMsg, 500);
    } catch (err) {
      return error('Cloudflare 缓存清除失败：' + (err.message || '未知错误'), 500);
    }
  }

  // 一键清除全部缓存（本地 + Cloudflare）
  if (path === '/api/admin/cache/purge-all' && method === 'POST') {
    const db = await loadDB(env);
    const apiToken = db.settings.cloudflareApiToken || '';
    const zoneId = db.settings.cloudflareZoneId || '';
    if (!apiToken || !zoneId) {
      return json({
        message: '本地缓存已清除（0 条）。Cloudflare 未配置，跳过边缘缓存清除。',
        localCleared: 0,
        cloudflare: 'not_configured'
      });
    }
    try {
      const cfRes = await fetch('https://api.cloudflare.com/client/v4/zones/' + zoneId + '/purge_cache', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ purge_everything: true })
      });
      const data = await cfRes.json();
      if (data.success) {
        return json({
          message: 'Cloudflare 边缘缓存已全部清除',
          localCleared: 0,
          cloudflare: 'success'
        });
      }
      return json({
        message: '本地缓存已清除，Cloudflare 清除失败',
        localCleared: 0,
        cloudflare: 'failed'
      });
    } catch (err) {
      return json({
        message: '本地缓存已清除，Cloudflare 清除失败：' + (err.message || ''),
        localCleared: 0,
        cloudflare: 'failed'
      });
    }
  }
  return null;
}

// 生成随机密码
function generateRandomPassword(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

// 递归删除族谱人物及其所有后代
function deleteGenealogyPerson(db, personId) {
  const toDelete = new Set([personId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of db.genealogy) {
      if (p.parentId && toDelete.has(p.parentId) && !toDelete.has(p.id)) {
        toDelete.add(p.id);
        changed = true;
      }
    }
  }
  db.genealogy = db.genealogy.filter(p => !toDelete.has(p.id));
  return toDelete.size;
}

// 族谱 API
async function handleGenealogy(request, env, path, method, url) {
  // 匹配 /api/admin/genealogy/:id（但不能匹配 /api/admin/genealogy/xxx/yyy）
  const adminPersonMatch = path.match(/^\/api\/admin\/genealogy\/([^/]+)$/);
  // 匹配 /api/admin/genealogy/:id/review
  const reviewMatch = path.match(/^\/api\/admin\/genealogy\/([^/]+)\/review$/);
  // 匹配 /api/admin/genealogy-password-requests/:id
  const passwordRequestMatch = path.match(/^\/api\/admin\/genealogy-password-requests\/([^/]+)$/);

  // ===== 前台 API =====

  // 获取已审核通过的族谱人物列表 + 简介设置
  if (path === '/api/genealogy' && method === 'GET') {
    const db = await loadDB(env);
    const people = db.genealogy.filter(p => !p.reviewStatus || p.reviewStatus === 'approved').map(p => ({
      id: p.id,
      name: p.name,
      generation: p.generation,
      parentId: p.parentId || null,
      spouse: p.spouse || '',
      birthDate: p.birthDate || '',
      title: p.title || '',
      era: p.era || '',
      intro: p.intro || ''
    }));
    return json({
      people,
      intro: db.settings.genealogyIntro || '',
      kicker: db.settings.genealogyKicker || 'Genealogy',
      title: db.settings.genealogyTitle || '麦氏族谱',
      subtitle: db.settings.genealogySubtitle || '',
      maxVisibleLevels: db.settings.genealogyDefaultExpandLevels || 5
    });
  }

  // 验证族谱访问密码
  if (path === '/api/genealogy/verify-password' && method === 'POST') {
    const db = await loadDB(env);
    const body = await readJSON(request);
    const password = String(body.password || '');
    const storedPassword = db.settings.genealogyPassword || '';
    if (!storedPassword) {
      return error('管理员尚未设置族谱访问密码', 400);
    }
    // 检查密码是否已过期（expiresIn 单位为天）
    const createdAt = db.settings.genealogyPasswordCreatedAt || '';
    const expiresIn = parseInt(db.settings.genealogyPasswordExpiresIn) || 0;
    if (createdAt && expiresIn > 0) {
      const createdMs = new Date(createdAt).getTime();
      const expireMs = createdMs + expiresIn * 24 * 60 * 60 * 1000;
      if (Date.now() > expireMs) {
        return json({ error: '密码已过期，请联系管理员获取新密码', expired: true }, 403);
      }
    }
    if (password !== storedPassword) {
      return error('密码错误', 401);
    }
    return json({ success: true, message: '验证成功' });
  }

  // 用户申请访问密码（允许匿名提交，登录用户自动关联账号）
  if (path === '/api/genealogy/request-password' && method === 'POST') {
    const db = await loadDB(env);
    const body = await readJSON(request);
    const name = String(body.name || '').trim();
    const contact = String(body.contact || '').trim();
    const reason = String(body.reason || '').trim();
    if (!name || !contact) return error('姓名和联系方式不能为空');

    // 尝试从请求头获取登录用户信息
    let username = '';
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (token) {
      try {
        const user = await requireFrontUser(request, env);
        if (user) username = user.username || '';
      } catch (e) { /* token 无效则忽略 */ }
    }

    if (!Array.isArray(db.genealogyPasswordRequests)) db.genealogyPasswordRequests = [];
    const request = {
      id: 'gpr' + Date.now().toString() + Math.random().toString(16).slice(2, 6),
      name: name,
      contact: contact,
      reason: reason,
      status: 'pending',
      username: username,
      approvedPassword: '',
      requestedAt: now(),
      reviewedAt: '',
      reviewer: ''
    };
    db.genealogyPasswordRequests.push(request);
    await saveDB(env, db);
    return json({ success: true, message: '申请已提交，请等待管理员审核' });
  }

  // 用户提交族谱人物
  if (path === '/api/user/genealogy' && method === 'POST') {
    const user = await requireFrontUser(request, env);
    if (!user) return error('请先登录', 401);
    const db = await loadDB(env);
    const body = await readJSON(request);
    const name = String(body.name || '').trim();
    if (!name) return error('姓名不能为空');
    if (name.length > 30) return error('姓名不能超过 30 个字符');
    const person = {
      id: 'g' + Date.now().toString() + Math.random().toString(16).slice(2, 6),
      name: name,
      generation: Number(body.generation) || 1,
      parentId: body.parentId ? String(body.parentId) : null,
      spouse: String(body.spouse || '').trim(),
      birthDate: String(body.birthDate || '').trim(),
      title: String(body.title || '').trim(),
      era: String(body.era || '').trim(),
      intro: String(body.intro || '').trim(),
      reviewStatus: 'pending',
      submittedBy: user.username,
      submittedAt: now(),
      createdAt: now(),
      updatedAt: now()
    };
    db.genealogy.push(person);
    await saveDB(env, db);
    return json({ message: '人物信息已提交，请等待管理员审核', person }, 201);
  }

  // 用户查看自己提交的族谱人物
  if (path === '/api/user/genealogy/submissions' && method === 'GET') {
    const user = await requireFrontUser(request, env);
    if (!user) return error('请先登录', 401);
    const db = await loadDB(env);
    const list = (db.genealogy || [])
      .filter(p => p.submittedBy === user.username)
      .sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
    return json(list);
  }

  // 用户查看自己的族谱密码申请记录
  if (path === '/api/user/genealogy-password-requests' && method === 'GET') {
    const user = await requireFrontUser(request, env);
    if (!user) return error('请先登录', 401);
    const db = await loadDB(env);
    const requests = (db.genealogyPasswordRequests || [])
      .filter(r => r.username === user.username)
      .sort((a, b) => new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0))
      .map(r => ({
        id: r.id,
        name: r.name,
        contact: r.contact,
        reason: r.reason,
        status: r.status,
        approvedPassword: r.status === 'approved' ? (r.approvedPassword || '') : '',
        requestedAt: r.requestedAt,
        reviewedAt: r.reviewedAt
      }));
    return json(requests);
  }

  // ===== 后台 API =====

  // 获取所有族谱人物（含待审核）+ 简介设置
  if (path === '/api/admin/genealogy' && method === 'GET') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const people = (db.genealogy || []).map(p => ({
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
    }));
    return json({
      people: people,
      intro: db.settings.genealogyIntro || '',
      kicker: db.settings.genealogyKicker || 'Genealogy',
      title: db.settings.genealogyTitle || '麦氏族谱',
      subtitle: db.settings.genealogySubtitle || '',
      maxVisibleLevels: db.settings.genealogyDefaultExpandLevels || 5
    });
  }

  // 添加族谱人物
  if (path === '/api/admin/genealogy' && method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const body = await readJSON(request);
    const name = String(body.name || '').trim();
    if (!name) return error('人物姓名不能为空');
    if (name.length > 30) return error('姓名不能超过 30 个字符');
    const person = {
      id: 'g' + Date.now().toString() + Math.random().toString(16).slice(2, 6),
      name: name,
      generation: Number(body.generation) || 1,
      parentId: body.parentId ? String(body.parentId) : null,
      spouse: String(body.spouse || '').trim(),
      birthDate: String(body.birthDate || '').trim(),
      title: String(body.title || '').trim(),
      era: String(body.era || '').trim(),
      intro: String(body.intro || '').trim(),
      reviewStatus: 'approved',
      submittedBy: '',
      createdAt: now(),
      updatedAt: now()
    };
    db.genealogy.push(person);
    await saveDB(env, db);
    return json(person, 201);
  }

  // 批量导入族谱数据（替换全部）
  if (path === '/api/admin/genealogy/import' && method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const body = await readJSON(request);
    const people = body.people;
    if (!Array.isArray(people)) return error('数据格式错误：需要 people 数组');
    const cleaned = [];
    for (const p of people) {
      if (!p || typeof p !== 'object') continue;
      const name = String(p.name || '').trim();
      if (!name) continue;
      cleaned.push({
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
      });
    }
    db.genealogy = cleaned;
    await saveDB(env, db);
    return json({ message: '导入成功', count: cleaned.length });
  }

  // 更新族谱简介设置（必须在 adminPersonMatch 之前，否则 intro 会被当作 :id 匹配）
  if (path === '/api/admin/genealogy/intro' && method === 'PUT') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const body = await readJSON(request);
    if (body.intro !== undefined) db.settings.genealogyIntro = String(body.intro || '').trim();
    if (body.kicker !== undefined) db.settings.genealogyKicker = String(body.kicker || '').slice(0, 30);
    if (body.title !== undefined) db.settings.genealogyTitle = String(body.title || '').slice(0, 50);
    if (body.subtitle !== undefined) db.settings.genealogySubtitle = String(body.subtitle || '').slice(0, 200);
    if (body.defaultExpandLevels !== undefined) {
      db.settings.genealogyDefaultExpandLevels = Math.max(1, Number(body.defaultExpandLevels) || 5);
    }
    db.settings.updatedAt = now();
    await saveDB(env, db);
    return json({
      intro: db.settings.genealogyIntro,
      kicker: db.settings.genealogyKicker,
      title: db.settings.genealogyTitle,
      subtitle: db.settings.genealogySubtitle,
      maxVisibleLevels: db.settings.genealogyDefaultExpandLevels
    });
  }

  // 更新族谱人物
  if (adminPersonMatch && method === 'PUT') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const id = decodeURIComponent(adminPersonMatch[1]);
    const idx = db.genealogy.findIndex(p => String(p.id) === id);
    if (idx === -1) return error('人物不存在', 404);
    const body = await readJSON(request);
    const current = db.genealogy[idx];
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return error('人物姓名不能为空');
      current.name = name.slice(0, 30);
    }
    if (body.generation !== undefined) current.generation = Number(body.generation) || 1;
    if (body.parentId !== undefined) {
      const newParent = body.parentId ? String(body.parentId) : null;
      if (newParent && newParent === String(current.id)) return error('不能将自己设为父节点');
      current.parentId = newParent;
    }
    if (body.title !== undefined) current.title = String(body.title).trim();
    if (body.era !== undefined) current.era = String(body.era).trim();
    if (body.spouse !== undefined) current.spouse = String(body.spouse).trim();
    if (body.birthDate !== undefined) current.birthDate = String(body.birthDate).trim();
    if (body.intro !== undefined) current.intro = String(body.intro).trim();
    current.updatedAt = now();
    await saveDB(env, db);
    return json(current);
  }

  // 删除族谱人物（含后代）
  if (adminPersonMatch && method === 'DELETE') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const id = decodeURIComponent(adminPersonMatch[1]);
    const person = db.genealogy.find(p => String(p.id) === id);
    if (!person) return error('人物不存在', 404);
    const deletedCount = deleteGenealogyPerson(db, id);
    await saveDB(env, db);
    return json({ message: '删除成功', removed: deletedCount });
  }

  // 审核族谱人物（通过/驳回）
  if (reviewMatch && method === 'PATCH') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const id = decodeURIComponent(reviewMatch[1]);
    const person = (db.genealogy || []).find(p => String(p.id) === id);
    if (!person) return error('人物不存在', 404);
    const body = await readJSON(request);
    const status = String(body.status || '').trim();
    if (!['pending', 'approved', 'rejected'].includes(status)) return error('审核状态无效');
    person.reviewStatus = status;
    person.reviewedAt = now();
    person.reviewer = user.username || 'admin';
    person.rejectionReason = status === 'rejected' ? String(body.reason || '').trim() : '';
    await saveDB(env, db);
    return json(person);
  }

  // ===== 族谱密码管理 =====

  // 获取族谱密码及状态
  if (path === '/api/admin/genealogy-password' && method === 'GET') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const createdAt = db.settings.genealogyPasswordCreatedAt || '';
    const expiresIn = parseInt(db.settings.genealogyPasswordExpiresIn) || 0;
    let expired = false;
    let expireTime = '';
    let remainingText = '';
    if (createdAt && expiresIn > 0) {
      const createdMs = new Date(createdAt).getTime();
      const expireMs = createdMs + expiresIn * 24 * 60 * 60 * 1000;
      expireTime = new Date(expireMs).toISOString();
      const remainingMs = expireMs - Date.now();
      if (remainingMs <= 0) {
        expired = true;
        remainingText = '已过期';
      } else {
        const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
        remainingText = '剩余 ' + remainingDays + ' 天';
      }
    } else if (createdAt && expiresIn === 0) {
      remainingText = '永不过期';
    }
    return json({
      password: db.settings.genealogyPassword || '',
      createdAt: createdAt,
      expiresIn: expiresIn,
      expireTime: expireTime,
      expired: expired,
      remainingText: remainingText
    });
  }

  // 设置族谱密码
  if (path === '/api/admin/genealogy-password' && method === 'PUT') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const body = await readJSON(request);
    const password = String(body.password || '').trim();
    if (!password) return error('密码不能为空');
    if (password.length < 4 || password.length > 50) return error('密码长度需在 4-50 个字符之间');
    let expiresIn = parseInt(body.expiresIn);
    if (isNaN(expiresIn) || expiresIn < 0) expiresIn = 0;
    db.settings.genealogyPassword = password;
    db.settings.genealogyPasswordCreatedAt = now();
    db.settings.genealogyPasswordExpiresIn = expiresIn;
    db.settings.updatedAt = now();
    await saveDB(env, db);
    return json({ success: true, message: '密码已设置', password: password, expiresIn: expiresIn });
  }

  // 随机生成族谱密码
  if (path === '/api/admin/genealogy-password/generate' && method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const body = await readJSON(request);
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';
    let pwd = '';
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < 8; i++) { pwd += chars[bytes[i] % chars.length]; }
    let expiresIn = parseInt(body.expiresIn);
    if (isNaN(expiresIn) || expiresIn < 0) expiresIn = 0;
    db.settings.genealogyPassword = pwd;
    db.settings.genealogyPasswordCreatedAt = now();
    db.settings.genealogyPasswordExpiresIn = expiresIn;
    db.settings.updatedAt = now();
    await saveDB(env, db);
    return json({ success: true, password: pwd, message: '密码已生成', expiresIn: expiresIn });
  }

  // 删除族谱密码
  if (path === '/api/admin/genealogy-password' && method === 'DELETE') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    db.settings.genealogyPassword = '';
    db.settings.genealogyPasswordCreatedAt = '';
    db.settings.genealogyPasswordExpiresIn = 0;
    db.settings.updatedAt = now();
    await saveDB(env, db);
    return json({ success: true, message: '密码已清除' });
  }

  // ===== 族谱密码申请管理 =====

  // 获取密码申请列表
  if (path === '/api/admin/genealogy-password-requests' && method === 'GET') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const status = String(url.searchParams.get('status') || '').trim();
    let requests = db.genealogyPasswordRequests || [];
    if (['pending', 'approved', 'rejected'].includes(status)) {
      requests = requests.filter(r => r.status === status);
    }
    return json(requests.slice().sort((a, b) => new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0)));
  }

  // 审核密码申请（通过/拒绝）
  if (passwordRequestMatch && method === 'PATCH') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const id = decodeURIComponent(passwordRequestMatch[1]);
    const req = (db.genealogyPasswordRequests || []).find(r => String(r.id) === id);
    if (!req) return error('申请不存在', 404);
    const body = await readJSON(request);
    const status = String(body.status || '').trim();
    if (status !== 'approved' && status !== 'rejected') return error('无效的审核状态');
    req.status = status;
    req.reviewedAt = now();
    req.reviewer = user.username || 'admin';
    if (status === 'approved') {
      req.approvedPassword = db.settings.genealogyPassword || '';
    } else {
      req.approvedPassword = '';
    }
    db.settings.updatedAt = now();
    await saveDB(env, db);
    return json({ success: true, message: status === 'approved' ? '已通过申请' : '已拒绝申请' });
  }

  // 删除密码申请
  if (passwordRequestMatch && method === 'DELETE') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const id = decodeURIComponent(passwordRequestMatch[1]);
    const idx = (db.genealogyPasswordRequests || []).findIndex(r => String(r.id) === id);
    if (idx === -1) return error('申请不存在', 404);
    db.genealogyPasswordRequests.splice(idx, 1);
    await saveDB(env, db);
    return json({ success: true, message: '已删除申请' });
  }

  return null;
}

// 维护模式 API
async function handleMaintenance(request, env, path, method) {
  // 验证维护模式密码
  if (path === '/api/maintenance/verify-password' && method === 'POST') {
    const db = await loadDB(env);
    const body = await readJSON(request);
    const password = String(body.password || '');
    const storedPassword = db.settings.maintenancePassword || '';
    if (!storedPassword || password !== storedPassword) {
      return error('密码错误', 401);
    }
    return json({ success: true });
  }

  // 更新维护模式设置
  if (path === '/api/admin/maintenance' && method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user || user.role !== 'admin') return error('未登录或登录已过期', 401);
    const db = await loadDB(env);
    const body = await readJSON(request);
    if (body.maintenanceMode !== undefined) {
      db.settings.maintenanceMode = !!body.maintenanceMode;
    }
    if (body.maintenancePassword !== undefined) {
      db.settings.maintenancePassword = String(body.maintenancePassword || '').trim();
    }
    if (body.maintenanceMessage !== undefined) {
      db.settings.maintenanceMessage = String(body.maintenanceMessage || '网站维护中，敬请谅解').trim() || '网站维护中，敬请谅解';
    }
    db.settings.updatedAt = now();
    await saveDB(env, db);
    return json({
      maintenanceMode: db.settings.maintenanceMode,
      maintenancePassword: db.settings.maintenancePassword,
      maintenanceMessage: db.settings.maintenanceMessage
    });
  }

  return null;
}

// ===== 维护模式检查 =====
async function checkMaintenance(request, env, path) {
  const db = await loadDB(env);
  const maintenanceMode = db.settings?.maintenanceMode;
  const maintenanceMessage = db.settings?.maintenanceMessage || '网站维护中，敬请谅解';

  // 未开启维护模式，放行
  if (!maintenanceMode) return null;

  // 维护模式验证接口和认证接口放行，确保管理员可以登录
  if (path === '/api/maintenance/verify-password' ||
      path === '/api/auth/login' ||
      path === '/api/auth/verify' ||
      path === '/api/user/login') return null;

  // 管理后台页面放行（前端自己验证）
  if (path.startsWith('/admin/')) return null;

  // 静态页面放行（前端 JS 检查维护模式）
  if (!path.startsWith('/api/') && !path.startsWith('/uploads/')) return null;

  // API 请求：检查是否为管理员
  if (path.startsWith('/api/admin/')) {
    const user = await verifyToken(request, env);
    if (user && user.role === 'admin') return null; // 管理员放行
    return error('网站维护中，请稍后再试', 503);
  }

  // 其他 API：检查是否已验证维护密码
  const verified = request.headers.get('x-maintenance-verified') === 'true';
  if (verified) return null;

  return error(maintenanceMessage, 503);
}

async function handleUploadGet(env, path) {
  const key = decodeURIComponent(path.replace(/^\/uploads\//, ''));
  if (!key || !env.UPLOADS) return error('文件不存在', 404);
  const object = await env.UPLOADS.get(key);
  if (!object) return error('文件不存在', 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers });
}

async function serveAsset(request, env, path) {
  if (!env.ASSETS) return error('静态资源绑定 ASSETS 未配置', 500);
  const url = new URL(request.url);
  if (path === '/') url.pathname = '/index.html';
  else if (path === '/admin') url.pathname = '/admin/index.html';
  else if (!/\.[a-z0-9]+$/i.test(path) && !path.startsWith('/api/') && !path.startsWith('/uploads/')) {
    url.pathname = `${path}.html`;
  }
  return env.ASSETS.fetch(new Request(url.toString(), request));
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: JSON_HEADERS });
    const url = new URL(request.url);
    const path = requestPath(request.url);
    const method = request.method.toUpperCase();

    try {
      // 维护模式检查
      const maintenanceResp = await checkMaintenance(request, env, path);
      if (maintenanceResp) return maintenanceResp;

      if (path.startsWith('/uploads/') && method === 'GET') return handleUploadGet(env, path);

      const handlers = [
        handleAuth,
        handleUsers,
        handlePosts,
        handleSubmissions,
        handleMetaSettings,
        handleCategories,
        handleTags,
        handleAds,
        handleComments,
        handleFriends,
        handleStats,
        handleAdminUsers,
        handleMedia,
        handleExport,
        handleCache,
        handleGenealogy,
        handleMaintenance
      ];

      for (const handler of handlers) {
        const response = await handler(request, env, path, method, url);
        if (response) return response;
      }

      if (path.startsWith('/api/')) return error('接口不存在', 404);
      return serveAsset(request, env, path);
    } catch (err) {
      return error(err.message || '服务器错误', 500);
    }
  }
};
