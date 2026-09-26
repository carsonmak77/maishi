/* ============================================================
   CARSON 管理后台 - 核心逻辑
   ============================================================ */

(function () {
  'use strict';

  /* -------------------- 工具函数 -------------------- */

  /**
   * 格式化日期为 YYYY-MM-DD HH:mm
   */
  function formatDate(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /**
   * 从对象中按优先键取值（兼容多种字段命名）
   */
  function pick(obj, keys, fallback) {
    for (var i = 0; i < keys.length; i++) {
      if (obj[keys[i]] !== undefined && obj[keys[i]] !== null) {
        return obj[keys[i]];
      }
    }
    return fallback === undefined ? 0 : fallback;
  }

  /**
   * HTML 转义，防止 XSS
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Toast 提示
   */
  var toastTimer = null;
  function showToast(msg) {
    var toast = document.getElementById('toast');
    if (!toast) {
      alert(msg);
      return;
    }
    toast.textContent = msg;
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('show');
    }, 2500);
  }

  /**
   * 根据数组生成标签 HTML
   */
  function renderTagsHtml(tags) {
    if (!tags || !tags.length) return '<span style="color:#ccc">-</span>';
    return tags.map(function (t) {
      return '<span class="tag-item">' + escapeHtml(t) + '</span>';
    }).join('');
  }


  function decodeProtectedText(parts) {
    return parts.map(function (code) { return String.fromCharCode(code); }).join('');
  }

  // 加密版权品牌名（码点编码存储，避免被直接搜索到）— CARSON
  var PROTECTED_ADMIN_BRAND = decodeProtectedText([67, 65, 82, 83, 79, 78]);
  // 版权解锁码（码点编码存储）— CARSON2026
  var ADMIN_FOOTER_UNLOCK_CODE = decodeProtectedText([67, 65, 82, 83, 79, 78, 50, 48, 50, 54]);

  // 解锁版权保护：在浏览器控制台输入 __unlockAdminFooterProtection('解锁码') 即可临时解除保护
  // 解锁后可修改 footer，刷新页面后保护自动恢复
  window.__unlockAdminFooterProtection = function (code) {
    if (code === ADMIN_FOOTER_UNLOCK_CODE) {
      window.__adminFooterProtectionUnlocked = true;
      if (window.__adminFooterObserver) {
        window.__adminFooterObserver.disconnect();
        window.__adminFooterObserver = null;
      }
      console.log('后台版权保护已解锁，可临时修改。刷新页面后恢复保护。');
      return true;
    }
    console.log('解锁码错误，保护未解除。');
    return false;
  };

  function renderAdminProtectedFooter() {
    var footer = document.getElementById('adminProtectedFooter');
    if (!footer) {
      footer = document.createElement('footer');
      footer.id = 'adminProtectedFooter';
      footer.className = 'admin-protected-footer';
      document.body.appendChild(footer);
    }
    footer.setAttribute('data-protected-footer', '1');
    // 品牌名使用模块级常量（码点编码存储，避免明文）
    var brand = PROTECTED_ADMIN_BRAND;
    var year = decodeProtectedText([50, 48, 50, 54]);
    footer.innerHTML = '© ' + year + ' Powered by ' +
      '<a href="https://520816.xyz" target="_blank" rel="noopener noreferrer">' + brand + '</a>' +
      ' ｜管理系统';
  }

  function protectAdminFooter() {
    renderAdminProtectedFooter();
    if (window.__adminFooterObserver) return;
    // 防重入标志，避免 MutationObserver 无限循环
    var isRendering = false;
    window.__adminFooterObserver = new MutationObserver(function () {
      if (isRendering) return;
      // 已解锁则不再强制恢复，允许临时修改
      if (window.__adminFooterProtectionUnlocked) return;
      var footer = document.getElementById('adminProtectedFooter');
      if (!footer || !footer.textContent.includes(PROTECTED_ADMIN_BRAND)) {
        isRendering = true;
        renderAdminProtectedFooter();
        isRendering = false;
      }
    });
    window.__adminFooterObserver.observe(document.body, { childList: true, subtree: true });
  }

  /* -------------------- API 请求封装 -------------------- */

  /**
   * 统一 API 请求，自动携带 token
   * @param {string} url  请求地址
   * @param {string} method  HTTP 方法
   * @param {object|null} body  请求体
   * @returns {Promise<object>}
   */
  async function apiRequest(url, method, body) {
    method = method || 'GET';
    var token = localStorage.getItem('token');
    var headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
    var options = { method: method, headers: headers };
    if (body !== undefined && body !== null) {
      options.body = JSON.stringify(body);
    }

    var res;
    try {
      res = await fetch(url, options);
    } catch (err) {
      throw new Error('网络请求失败，请检查网络连接');
    }

    // 401 处理：区分"登录接口凭据错误"和"后台 token 过期"
    if (res.status === 401) {
      // 登录接口的 401 是凭据错误，不应清除 token 或跳转，直接返回错误信息
      if (url === '/api/auth/login') {
        var text401 = await res.text();
        var err401 = {};
        try { err401 = text401 ? JSON.parse(text401) : {}; } catch (e) {}
        throw new Error(err401.error || err401.message || '用户名或密码错误');
      }

      // 其他接口的 401 表示 token 过期，清除并跳转登录页
      localStorage.removeItem('token');
      localStorage.removeItem('username');
      // 避免在登录页重复跳转
      if (!window.location.pathname.endsWith('login.html')) {
        showToast('登录已过期，请重新登录');
        setTimeout(function () {
          window.location.href = 'login.html';
        }, 800);
      }
      throw new Error('登录已过期');
    }

    var data;
    var text = await res.text();
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      data = {};
    }

    if (!res.ok) {
      var msg = data.message || data.error || data.msg || ('请求失败 (' + res.status + ')');
      throw new Error(msg);
    }
    return data;
  }

  /**
   * 表单上传请求，自动携带 token，不设置 Content-Type 以便浏览器生成 multipart 边界
   */
  async function apiFormRequest(url, method, formData) {
    method = method || 'POST';
    var token = localStorage.getItem('token');
    var headers = {};
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }

    var res;
    try {
      res = await fetch(url, {
        method: method,
        headers: headers,
        body: formData
      });
    } catch (err) {
      throw new Error('网络请求失败，请检查网络连接');
    }

    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('username');
      showToast('登录已过期，请重新登录');
      setTimeout(function () {
        window.location.href = 'login.html';
      }, 800);
      throw new Error('Unauthorized');
    }

    var text = await res.text();
    var data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      data = {};
    }

    if (!res.ok) {
      throw new Error(data.error || data.message || ('请求失败 (' + res.status + ')'));
    }
    return data;
  }

  /* -------------------- 认证相关 -------------------- */

  function getToken() {
    return localStorage.getItem('token');
  }

  function isLoggedIn() {
    return !!getToken();
  }

  /**
   * 页面加载时校验 token
   */
  async function checkAuth() {
    var token = getToken();
    if (!token) {
      window.location.href = 'login.html';
      return false;
    }
    try {
      var data = await apiRequest('/api/auth/verify', 'GET');
      if (data && data.valid) {
        return true;
      }
      window.location.href = 'login.html';
      return false;
    } catch (e) {
      // verify 失败时 apiRequest 内部已处理跳转
      return false;
    }
  }

  /**
   * 退出登录
   */
  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    window.location.href = 'login.html';
  }

  /* -------------------- 登录页逻辑 -------------------- */

  function initLoginPage() {
    var form = document.getElementById('loginForm');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var usernameInput = document.getElementById('username');
      var passwordInput = document.getElementById('password');
      var loginBtn = document.getElementById('loginBtn');

      var username = usernameInput.value.trim();
      var password = passwordInput.value;

      if (!username || !password) {
        showToast('请输入用户名和密码');
        return;
      }

      loginBtn.disabled = true;
      loginBtn.textContent = '登录中...';

      try {
        var data = await apiRequest('/api/auth/login', 'POST', {
          username: username,
          password: password
        });
        if (data && data.token) {
          localStorage.setItem('token', data.token);
          localStorage.setItem('username', data.username || username);
          showToast('登录成功');
          setTimeout(function () {
            window.location.href = 'index.html';
          }, 500);
        } else {
          showToast(data.message || '登录失败');
          loginBtn.disabled = false;
          loginBtn.textContent = '登 录';
        }
      } catch (err) {
        showToast(err.message || '登录失败');
        loginBtn.disabled = false;
        loginBtn.textContent = '登 录';
      }
    });
  }

  /* -------------------- 后台管理逻辑 -------------------- */

  // 当前编辑的文章 ID（null 表示新建）
  var editingPostId = null;
  // 分类缓存
  var cachedCategories = [];
  // DZ 论坛风格编辑器实例
  var dzEditorInstance = null;

  /**
   * 显示某个页面，隐藏其他
   */
  function showPage(page, postId) {
    var pages = document.querySelectorAll('.page');
    pages.forEach(function (p) { p.classList.remove('active'); });

    var target = document.getElementById('page-' + page);
    if (target) {
      target.classList.add('active');
    }

    // 更新导航高亮
    var navItems = document.querySelectorAll('.sidebar-nav .nav-item');
    navItems.forEach(function (n) { n.classList.remove('active'); });
    var activeNav = document.querySelector('.sidebar-nav .nav-item[data-page="' + page + '"]');
    if (activeNav) {
      activeNav.classList.add('active');
    }

    // 更新标题
    var titleMap = {
      dashboard: '仪表盘',
      posts: '文章管理',
      editor: postId ? '编辑文章' : '写文章',
      categories: '分类管理',
      tags: '标签管理',
      friends: '友链管理',
      comments: '留言管理',
      users: '用户管理',
      genealogy: '族谱管理',
      submissions: '投稿审核',
      cache: '缓存管理',
      media: '媒体库',
      ads: '广告管理',
      settings: '网站设置'
    };
    var pageTitleEl = document.getElementById('pageTitle');
    if (pageTitleEl) {
      pageTitleEl.textContent = titleMap[page] || '';
    }

    // 按页面加载数据
    if (page === 'dashboard') {
      loadDashboard();
    } else if (page === 'posts') {
      ensurePostsCategories();
      loadPosts();
    } else if (page === 'editor') {
      loadEditor(postId || null);
    } else if (page === 'categories') {
      clearCategoryForm();
      loadCategoriesAdmin();
    } else if (page === 'tags') {
      clearTagForm();
      loadTagsAdmin();
    } else if (page === 'friends') {
      clearFriendForm();
      loadFriends();
    } else if (page === 'comments') {
      loadCommentSettings();
      loadComments();
    } else if (page === 'users') {
      loadUsers();
    } else if (page === 'genealogy') {
      clearGenealogyForm();
      loadGenealogy();
      loadGenoPassword();
      loadGenoPwdRequests();
    } else if (page === 'submissions') {
      loadSubmissions();
    } else if (page === 'cache') {
      loadCacheStats();
      loadCloudflareConfig();
    } else if (page === 'media') {
      loadMediaLibrary();
    } else if (page === 'ads') {
      loadAds();
    } else if (page === 'settings') {
      loadSiteSettings();
    }

    // 移动端关闭侧边栏
    closeSidebar();
  }

  /* ---------- 仪表盘 ---------- */

  async function loadDashboard() {
    // 加载统计数据
    var statGrid = document.getElementById('statGrid');
    if (statGrid) {
      statGrid.innerHTML = '<div class="loading"><div class="spinner"></div><br>加载统计中...</div>';
    }
    try {
      var stats = await apiRequest('/api/admin/stats', 'GET');
      renderStats(stats || {});
      renderReviewCenter(stats || {});
    } catch (err) {
      if (statGrid) {
        statGrid.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>统计数据加载失败</p></div>';
      }
      var rcGrid = document.getElementById('reviewCenterGrid');
      if (rcGrid) rcGrid.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>审核数据加载失败</p></div>';
    }

    // 加载最近文章
    var recentList = document.getElementById('recentList');
    if (recentList) {
      recentList.innerHTML = '<li class="loading"><div class="spinner"></div><br>加载中...</li>';
    }
    try {
      var postsResult = await apiRequest('/api/admin/posts', 'GET');
      var recentPostsData = (postsResult && postsResult.posts) ? postsResult.posts : (Array.isArray(postsResult) ? postsResult : []);
      renderRecentPosts(recentPostsData || []);
    } catch (err) {
      if (recentList) {
        recentList.innerHTML = '<li class="empty-state"><div class="empty-icon">📄</div><p>暂无文章数据</p></li>';
      }
    }
  }

  function renderStats(stats) {
    var statGrid = document.getElementById('statGrid');
    if (!statGrid) return;

    var total = pick(stats, ['totalPosts', 'total', 'posts', 'count']);
    var published = pick(stats, ['publishedPosts', 'published', 'publishedCount']);
    var views = pick(stats, ['totalViews', 'views', 'totalView', 'viewCount']);
    var categories = pick(stats, ['totalCategories', 'categories', 'categoryCount']);
    var tags = pick(stats, ['totalTags', 'tags', 'tagCount']);
    var pendingSubmissions = pick(stats, ['pendingSubmissions', 'pendingSubmissionCount']);
    var pendingGenealogy = pick(stats, ['pendingGenealogy', 'pendingGenealogyCount']);
    var drafts = pick(stats, ['draftPosts', 'drafts', 'draftCount']);
    if (!drafts && total && published) {
      drafts = total - published;
      if (isNaN(drafts) || drafts < 0) drafts = 0;
    }

    var cards = [
      { icon: '📄', label: '总文章数', value: total, bg: '#E8F8EF' },
      { icon: '📢', label: '已发布', value: published, bg: '#E8F8EF' },
      { icon: '📝', label: '草稿', value: drafts, bg: '#FFF3E0' },
      { icon: '🧾', label: '待审核投稿', value: pendingSubmissions, bg: '#FFF7E6' },
      { icon: '🌳', label: '族谱待审核', value: pendingGenealogy, bg: '#FFF7E6' },
      { icon: '👁', label: '总浏览量', value: views, bg: '#E8F8EF' },
      { icon: '📁', label: '总分类', value: categories, bg: '#F0F5FF' },
      { icon: '🏷', label: '总标签', value: tags, bg: '#FFF1F0' }
    ];

    statGrid.innerHTML = cards.map(function (c) {
      return (
        '<div class="stat-card">' +
          '<div class="stat-icon" style="background:' + c.bg + '">' + c.icon + '</div>' +
          '<div class="stat-body">' +
            '<div class="stat-value">' + escapeHtml(String(c.value)) + '</div>' +
            '<div class="stat-label">' + c.label + '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderReviewCenter(stats) {
    var grid = document.getElementById('reviewCenterGrid');
    var hint = document.getElementById('reviewCenterHint');
    if (!grid) return;

    var pendingGen = pick(stats, ['pendingGenealogy']) || 0;
    var totalGen = pick(stats, ['totalGenealogy']) || 0;
    var pendingPwd = pick(stats, ['pendingPwdRequests']) || 0;
    var totalPwd = pick(stats, ['totalPwdRequests']) || 0;
    var pendingSub = pick(stats, ['pendingSubmissions']) || 0;
    var totalSub = pick(stats, ['totalPosts']) || 0;
    var pendingCmt = pick(stats, ['pendingComments']) || 0;
    var totalCmt = pick(stats, ['totalComments']) || 0;

    var hasPending = (pendingGen + pendingPwd + pendingSub + pendingCmt) > 0;
    if (hint) {
      hint.textContent = hasPending ? '有 ' + (pendingGen + pendingPwd + pendingSub + pendingCmt) + ' 项待处理' : '全部已处理';
      hint.style.color = hasPending ? '#e8590c' : '#52c41a';
    }

    var items = [
      {
        icon: '🌳',
        title: '族谱人数',
        pending: pendingGen,
        total: totalGen,
        jump: 'genealogy',
        emptyMsg: '暂无族谱数据'
      },
      {
        icon: '🔑',
        title: '族谱密码申请',
        pending: pendingPwd,
        total: totalPwd,
        jump: 'genealogy',
        emptyMsg: '暂无密码申请'
      },
      {
        icon: '📝',
        title: '投稿审核',
        pending: pendingSub,
        total: totalSub,
        jump: 'submissions',
        emptyMsg: '暂无投稿'
      },
      {
        icon: '💬',
        title: '留言审核',
        pending: pendingCmt,
        total: totalCmt,
        jump: 'comments',
        emptyMsg: '暂无留言'
      }
    ];

    grid.innerHTML = items.map(function (item) {
      var badgeClass = item.pending > 0 ? 'review-badge review-badge-pending' : 'review-badge review-badge-ok';
      var statusText = item.pending > 0 ? item.pending + ' 待审核' : '全部通过';
      var totalText = item.total > 0 ? '共 ' + item.total + ' 条' : item.emptyMsg;
      return (
        '<div class="review-card" data-jump="' + item.jump + '">' +
          '<div class="review-card-header">' +
            '<span class="review-icon">' + item.icon + '</span>' +
            '<span class="review-title">' + escapeHtml(item.title) + '</span>' +
            '<span class="' + badgeClass + '">' + statusText + '</span>' +
          '</div>' +
          '<div class="review-card-body">' +
            '<span class="review-total">' + escapeHtml(totalText) + '</span>' +
            '<span class="review-action">前往处理 →</span>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderRecentPosts(posts) {
    var recentList = document.getElementById('recentList');
    if (!recentList) return;

    if (!posts.length) {
      recentList.innerHTML = '<li class="empty-state"><div class="empty-icon">📄</div><p>还没有文章，去写一篇吧</p></li>';
      return;
    }

    var recent = posts.slice(0, 6);
    recentList.innerHTML = recent.map(function (p) {
      return (
        '<li>' +
          '<span class="recent-title">' + escapeHtml(p.title || '无标题') + '</span>' +
          '<span class="recent-meta">' + (p.published ? '已发布' : '草稿') + ' · ' + formatDate(p.createdAt) + '</span>' +
        '</li>'
      );
    }).join('');
  }

  /* ---------- 文章列表 ---------- */

  var postsCurrentPage = 1;
  var postsPageSize = 20;
  var postsSearchTimer = null;

  async function loadPosts() {
    var tbody = document.getElementById('postsTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="8"><div class="loading"><div class="spinner"></div><br>加载中...</div></td></tr>';
    }
    var params = new URLSearchParams();
    params.append('page', postsCurrentPage);
    params.append('pageSize', postsPageSize);
    var search = document.getElementById('postsSearchInput')?.value || '';
    var category = document.getElementById('postsCategoryFilter')?.value || '';
    var status = document.getElementById('postsStatusFilter')?.value || 'all';
    if (search) params.append('search', search);
    if (category) params.append('category', category);
    if (status && status !== 'all') params.append('status', status);
    try {
      var query = params.toString();
      var result = await apiRequest('/api/admin/posts' + (query ? '?' + query : ''), 'GET');
      var posts = (result && result.posts) ? result.posts : (Array.isArray(result) ? result : []);
      var total = (result && result.total !== undefined) ? result.total : posts.length;
      var page = (result && result.page) ? result.page : postsCurrentPage;
      var pageSize = (result && result.pageSize) ? result.pageSize : postsPageSize;
      var totalPages = (result && result.totalPages !== undefined) ? result.totalPages : Math.ceil(total / pageSize);
      renderPostTable(posts || []);
      renderPostsPagination(total, page, pageSize);
      updatePostsCount(total);
      // 重置全选状态
      var selectAll = document.getElementById('selectAllPosts');
      if (selectAll) selectAll.checked = false;
      updatePostsBulkActionBar();
    } catch (err) {
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">⚠️</div><p>' + escapeHtml(err.message) + '</p></div></td></tr>';
      }
      renderPostsPagination(0, 1, postsPageSize);
      updatePostsCount(0);
    }
  }

  function updatePostsCount(total) {
    var el = document.getElementById('postsCount');
    if (el) el.textContent = '共 ' + total + ' 篇';
  }

  function renderPostsPagination(total, page, pageSize) {
    var paginationEl = document.getElementById('postsPagination');
    if (!paginationEl) return;
    var totalPages = Math.ceil(total / pageSize);
    if (totalPages <= 1) {
      paginationEl.innerHTML = '';
      return;
    }
    var html = '<div class="pagination-inner">';
    html += '<span class="pagination-info">第 ' + page + ' / ' + totalPages + ' 页，共 ' + total + ' 条</span>';
    html += '<div class="pagination-buttons">';
    // 首页
    html += '<button class="btn btn-sm btn-ghost" data-page="1"' + (page === 1 ? ' disabled' : '') + '>首页</button>';
    // 上一页
    html += '<button class="btn btn-sm btn-ghost" data-page="' + (page - 1) + '"' + (page === 1 ? ' disabled' : '') + '>上一页</button>';
    // 页码按钮
    var startPage = Math.max(1, page - 2);
    var endPage = Math.min(totalPages, page + 2);
    for (var i = startPage; i <= endPage; i++) {
      html += '<button class="btn btn-sm ' + (i === page ? 'btn-primary' : 'btn-ghost') + '" data-page="' + i + '">' + i + '</button>';
    }
    // 下一页
    html += '<button class="btn btn-sm btn-ghost" data-page="' + (page + 1) + '"' + (page === totalPages ? ' disabled' : '') + '>下一页</button>';
    // 末页
    html += '<button class="btn btn-sm btn-ghost" data-page="' + totalPages + '"' + (page === totalPages ? ' disabled' : '') + '>末页</button>';
    html += '</div></div>';
    paginationEl.innerHTML = html;

    // 绑定分页按钮事件
    var buttons = paginationEl.querySelectorAll('button[data-page]');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var targetPage = parseInt(btn.getAttribute('data-page'));
        if (targetPage && targetPage !== page) {
          postsCurrentPage = targetPage;
          loadPosts();
        }
      });
    });
  }

  function getSelectedPostIds() {
    var tbody = document.getElementById('postsTableBody');
    if (!tbody) return [];
    var checkboxes = tbody.querySelectorAll('input.post-checkbox:checked');
    var ids = [];
    checkboxes.forEach(function (cb) {
      var id = cb.getAttribute('data-id');
      if (id) ids.push(id);
    });
    return ids;
  }

  function toggleSelectAllPosts() {
    var selectAll = document.getElementById('selectAllPosts');
    var tbody = document.getElementById('postsTableBody');
    if (!selectAll || !tbody) return;
    var checkboxes = tbody.querySelectorAll('input.post-checkbox');
    checkboxes.forEach(function (cb) {
      cb.checked = selectAll.checked;
    });
    updatePostsBulkActionBar();
  }

  function updatePostsBulkActionBar() {
    var ids = getSelectedPostIds();
    var bar = document.getElementById('postsBulkActionBar');
    var countEl = document.getElementById('postsSelectedCount');
    if (bar) {
      bar.style.display = ids.length > 0 ? 'flex' : 'none';
    }
    if (countEl) {
      countEl.textContent = ids.length;
    }
    // 更新全选复选框状态
    var selectAll = document.getElementById('selectAllPosts');
    var tbody = document.getElementById('postsTableBody');
    if (selectAll && tbody) {
      var allCheckboxes = tbody.querySelectorAll('input.post-checkbox');
      if (allCheckboxes.length > 0) {
        selectAll.checked = ids.length === allCheckboxes.length;
      } else {
        selectAll.checked = false;
      }
    }
  }

  async function bulkPostAction(action) {
    var ids = getSelectedPostIds();
    if (!ids.length) {
      showToast('请先选择要操作的文章');
      return;
    }
    var actionText = {
      'delete': '删除',
      'publish': '发布',
      'draft': '设为草稿',
      'pin': '置顶',
      'unpin': '取消置顶'
    };
    var confirmMsg = '确定要' + (actionText[action] || action) + '选中的 ' + ids.length + ' 篇文章吗？';
    if (action === 'delete') {
      confirmMsg += '此操作不可恢复。';
    }
    if (!confirm(confirmMsg)) return;
    try {
      var result = await apiRequest('/api/admin/posts/batch', 'POST', { action: action, ids: ids });
      showToast('操作成功，已处理 ' + (result.updated || 0) + ' 篇文章');
      loadPosts();
    } catch (err) {
      showToast(err.message || '操作失败');
    }
  }

  function doPostSearch() {
    if (postsSearchTimer) {
      clearTimeout(postsSearchTimer);
    }
    postsSearchTimer = setTimeout(function () {
      postsCurrentPage = 1;
      loadPosts();
    }, 300);
  }

  async function togglePostPin(id, pinned) {
    try {
      await apiRequest('/api/admin/posts/' + encodeURIComponent(id), 'PUT', { pinned: pinned });
      showToast(pinned ? '文章已置顶' : '已取消置顶');
      loadPosts();
    } catch (err) {
      showToast(err.message || '操作失败');
    }
  }

  function fillPostsCategoryFilter(categories) {
    var select = document.getElementById('postsCategoryFilter');
    if (!select) return;
    var currentVal = select.value;
    var html = '<option value="">全部分类</option>';
    categories.forEach(function (c) {
      html += '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>';
    });
    select.innerHTML = html;
    select.value = currentVal;
  }

  var postsCategoriesLoaded = false;
  async function ensurePostsCategories() {
    if (postsCategoriesLoaded && cachedCategories && cachedCategories.length) {
      fillPostsCategoryFilter(cachedCategories);
      return;
    }
    try {
      var meta = await apiRequest('/api/meta', 'GET');
      cachedCategories = (meta && meta.categories) || [];
      postsCategoriesLoaded = true;
      categoriesLoaded = true;
      fillPostsCategoryFilter(cachedCategories);
    } catch (err) {
      fillPostsCategoryFilter([]);
    }
  }

  function renderPostTable(posts) {
    var tbody = document.getElementById('postsTableBody');
    if (!tbody) return;

    if (!posts.length) {
      tbody.innerHTML = (
        '<tr><td colspan="8"><div class="empty-state">' +
        '<div class="empty-icon">📄</div>' +
        '<p>暂无文章，点击右上角"写文章"开始创作</p>' +
        '</div></td></tr>'
      );
      return;
    }

    tbody.innerHTML = posts.map(function (p) {
      var statusBadge = p.published
        ? '<span class="badge badge-published">已发布</span>'
        : '<span class="badge badge-draft">草稿</span>';
      var typeBadges = '';
      if (p.pinned) typeBadges += '<span class="badge badge-pinned">置顶</span>';
      if (p.showOnHome) typeBadges += '<span class="badge badge-home">首页</span>';
      if (p.announcement) typeBadges += '<span class="badge badge-announcement">公告</span>';
      var categoryBadge = p.category
        ? '<span class="badge badge-category">' + escapeHtml(p.category) + '</span>'
        : '<span style="color:#ccc">-</span>';

      return (
        '<tr>' +
          '<td><input type="checkbox" class="post-checkbox" data-id="' + escapeHtml(String(p.id)) + '"></td>' +
          '<td><div class="table-title-cell">' + escapeHtml(p.title || '无标题') + '</div><div class="post-type-badges">' + typeBadges + '</div></td>' +
          '<td>' + categoryBadge + '</td>' +
          '<td>' + renderTagsHtml(p.tags) + '</td>' +
          '<td>' + (p.views || 0) + '</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td style="white-space:nowrap">' + formatDate(p.createdAt) + '</td>' +
          '<td>' +
            '<div class="row-actions">' +
              '<button class="btn btn-sm btn-ghost btn-post-view" data-id="' + escapeHtml(String(p.id)) + '" data-published="' + (p.published ? '1' : '0') + '">查看</button>' +
              '<button class="btn btn-sm btn-ghost btn-edit" data-id="' + escapeHtml(String(p.id)) + '">编辑</button>' +
              (p.pinned
                ? '<button class="btn btn-sm btn-ghost btn-post-unpin" data-id="' + escapeHtml(String(p.id)) + '">取消置顶</button>'
                : '<button class="btn btn-sm btn-ghost btn-post-pin" data-id="' + escapeHtml(String(p.id)) + '">置顶</button>'
              ) +
              '<button class="btn btn-sm btn-danger btn-delete" data-id="' + escapeHtml(String(p.id)) + '" data-title="' + escapeHtml(p.title || '') + '">删除</button>' +
            '</div>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  /* ---------- 文章编辑 ---------- */

  /**
   * 初始化 DZ 论坛风格编辑器（仅初始化一次，复用实例）
   */
  function initDzEditor() {
    var wrap = document.getElementById('dzEditorWrap');
    var textarea = document.getElementById('postContent');
    if (!wrap || !textarea || typeof window.DzEditor === 'undefined') return null;
    if (!dzEditorInstance) {
      dzEditorInstance = new window.DzEditor({
        container: wrap,
        textarea: textarea,
        placeholder: '请输入文章内容，支持富文本排版...',
        onUploadImage: async function (file) {
          var formData = new FormData();
          formData.append('image', file);
          var data = await apiFormRequest('/api/admin/uploads/images', 'POST', formData);
          return { url: data.url, html: data.html };
        }
      });
    }
    return dzEditorInstance;
  }

  /**
   * 加载编辑器：有 id 为编辑，无 id 为新建
   */
  async function loadEditor(postId) {
    editingPostId = postId || null;

    // 先确保分类已加载
    await ensureCategories();

    var editorTitle = document.getElementById('editorTitle');
    var form = document.getElementById('postForm');
    if (form) form.reset();
    resetPostSaveButton();

    // 初始化 DZ 编辑器
    var dzEditor = initDzEditor();

    if (postId) {
      if (editorTitle) editorTitle.textContent = '编辑文章';
      try {
        var post = await apiRequest('/api/admin/posts/' + encodeURIComponent(postId), 'GET');
        fillForm(post);
      } catch (err) {
        showToast(err.message || '加载文章失败');
        showPage('posts');
      }
    } else {
      if (editorTitle) editorTitle.textContent = '写文章';
      clearForm();
    }
  }

  /**
   * 确保分类下拉数据已加载
   */
  var categoriesLoaded = false;
  async function ensureCategories() {
    if (categoriesLoaded) {
      fillCategorySelect(cachedCategories);
      return;
    }
    try {
      var meta = await apiRequest('/api/meta', 'GET');
      cachedCategories = (meta && meta.categories) || [];
      categoriesLoaded = true;
      fillCategorySelect(cachedCategories);
    } catch (err) {
      fillCategorySelect([]);
    }
  }

  function fillCategorySelect(categories) {
    var select = document.getElementById('postCategory');
    if (!select) return;
    var currentVal = select.value;
    var html = '<option value="">请选择分类</option>';
    categories.forEach(function (c) {
      html += '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>';
    });
    select.innerHTML = html;
    select.value = currentVal;
  }

  function fillForm(post) {
    document.getElementById('postId').value = post.id || '';
    document.getElementById('postTitle').value = post.title || '';
    document.getElementById('postCategory').value = post.category || '';
    document.getElementById('postTags').value = (post.tags || []).join(', ');
    document.getElementById('postSummary').value = post.summary || '';
    document.getElementById('postCoverUrl').value = post.cover || '';
    renderCoverPreview(post.cover || '');
    // 同步内容到 DZ 编辑器（若已初始化）
    if (dzEditorInstance) {
      dzEditorInstance.setContent(post.content || '');
    } else {
      document.getElementById('postContent').value = post.content || '';
    }
    document.getElementById('postPublished').checked = post.published !== false;
    document.getElementById('postPinned').checked = !!post.pinned;
    document.getElementById('postShowOnHome').checked = post.showOnHome === true;
    document.getElementById('postAnnouncement').checked = !!post.announcement;
    updatePublishLabel();
  }

  function clearForm() {
    document.getElementById('postId').value = '';
    document.getElementById('postTitle').value = '';
    document.getElementById('postCategory').value = '';
    document.getElementById('postTags').value = '';
    document.getElementById('postSummary').value = '';
    document.getElementById('postCoverUrl').value = '';
    renderCoverPreview('');
    // 清空 DZ 编辑器内容
    if (dzEditorInstance) {
      dzEditorInstance.setContent('');
    } else {
      document.getElementById('postContent').value = '';
    }
    document.getElementById('postPublished').checked = true;
    document.getElementById('postPinned').checked = false;
    document.getElementById('postShowOnHome').checked = false;
    document.getElementById('postAnnouncement').checked = false;
    updatePublishLabel();
  }

  function updatePublishLabel() {
    var checkbox = document.getElementById('postPublished');
    var label = document.getElementById('publishLabel');
    if (checkbox && label) {
      label.textContent = checkbox.checked ? '已发布' : '草稿';
    }
  }

  function resetPostSaveButton() {
    var saveBtn = document.getElementById('saveBtn');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = '保存文章';
    }
  }

  function collectFormData() {
    // 先同步 DZ 编辑器内容到隐藏 textarea
    if (dzEditorInstance) dzEditorInstance.sync();
    var tagsRaw = document.getElementById('postTags').value.trim();
    var tags = tagsRaw
      ? tagsRaw.split(/[,，]/).map(function (t) { return t.trim(); }).filter(function (t) { return t; })
      : [];

    return {
      title: document.getElementById('postTitle').value.trim(),
      summary: document.getElementById('postSummary').value.trim(),
      content: document.getElementById('postContent').value,
      cover: document.getElementById('postCoverUrl').value.trim(),
      author: localStorage.getItem('username') || 'Admin',
      category: document.getElementById('postCategory').value,
      tags: tags,
      published: document.getElementById('postPublished').checked,
      pinned: document.getElementById('postPinned').checked,
      showOnHome: document.getElementById('postShowOnHome').checked,
      announcement: document.getElementById('postAnnouncement').checked
    };
  }

  function insertTextToTextarea(textarea, text) {
    if (!textarea) return;
    var start = textarea.selectionStart || textarea.value.length;
    var end = textarea.selectionEnd || textarea.value.length;
    var value = textarea.value || '';
    textarea.value = value.slice(0, start) + text + value.slice(end);
    var nextPos = start + text.length;
    textarea.focus();
    textarea.setSelectionRange(nextPos, nextPos);
  }

  async function uploadArticleImage(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('文章图片不能大于 5MB');
      return;
    }
    var formData = new FormData();
    formData.append('image', file);
    try {
      var data = await apiFormRequest('/api/admin/uploads/images', 'POST', formData);
      var html = data.html || ('<p><img src="' + data.url + '" alt="文章图片"></p>');
      // 优先插入 DZ 编辑器，否则回退到 textarea
      if (dzEditorInstance) {
        var contentEl = dzEditorInstance.area;
        contentEl.focus();
        document.execCommand('insertHTML', false, '\n' + html + '\n');
        dzEditorInstance.sync();
      } else {
        insertTextToTextarea(document.getElementById('postContent'), '\n' + html + '\n');
      }
      showToast('图片已上传并插入正文');
    } catch (err) {
      showToast(err.message || '图片上传失败');
    }
  }

  function renderCoverPreview(url) {
    var preview = document.getElementById('coverPreview');
    if (!preview) return;
    if (url) {
      preview.innerHTML = '<img src="' + escapeHtml(url) + '" alt="封面预览">';
    } else {
      preview.innerHTML = '';
    }
  }

  async function uploadCoverImage(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('封面图片不能大于 5MB');
      return;
    }
    var formData = new FormData();
    formData.append('image', file);
    try {
      var data = await apiFormRequest('/api/admin/uploads/images', 'POST', formData);
      var url = data.url || '';
      var urlInput = document.getElementById('postCoverUrl');
      if (urlInput) {
        urlInput.value = url;
        renderCoverPreview(url);
      }
      showToast('封面图片上传成功');
    } catch (err) {
      showToast(err.message || '封面上传失败');
    }
  }

  // 赞助二维码上传：上传成功后把 URL 回填到对应输入框，前台固定显示 120×120
  async function uploadSponsorQr(file, inputId) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('赞助图片不能大于 5MB');
      return;
    }
    var formData = new FormData();
    formData.append('image', file);
    try {
      var data = await apiFormRequest('/api/admin/uploads/images', 'POST', formData);
      var url = data.url || '';
      var urlInput = document.getElementById(inputId);
      if (urlInput) urlInput.value = url;
      showToast('赞助图片上传成功');
    } catch (err) {
      showToast(err.message || '赞助图片上传失败');
    }
  }

  async function savePost(e) {
    if (e) e.preventDefault();

    var data = collectFormData();
    if (!data.title) {
      showToast('请输入文章标题');
      return;
    }
    if (!data.content) {
      showToast('请输入文章内容');
      return;
    }

    var saveBtn = document.getElementById('saveBtn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = '保存中...';
    }

    try {
      if (editingPostId) {
        await apiRequest('/api/admin/posts/' + encodeURIComponent(editingPostId), 'PUT', data);
        showToast('文章更新成功');
      } else {
        await apiRequest('/api/admin/posts', 'POST', data);
        showToast('文章创建成功');
      }
      setTimeout(function () {
        showPage('posts');
      }, 600);
    } catch (err) {
      showToast(err.message || '保存失败');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '保存文章';
      }
    }
  }

  /* ---------- 删除文章 ---------- */

  var pendingDeleteId = null;

  function openDeleteModal(id, title) {
    pendingDeleteId = id;
    var desc = document.getElementById('deleteDesc');
    if (desc) {
      desc.textContent = '确定要删除「' + (title || '该文章') + '」吗？此操作不可恢复。';
    }
    var modal = document.getElementById('deleteModal');
    if (modal) modal.classList.add('show');
  }

  function closeDeleteModal() {
    pendingDeleteId = null;
    var modal = document.getElementById('deleteModal');
    if (modal) modal.classList.remove('show');
  }

  async function confirmDelete() {
    if (!pendingDeleteId) return;
    var confirmBtn = document.getElementById('confirmDelete');
    if (confirmBtn) {
      confirmBtn.textContent = '删除中...';
      confirmBtn.disabled = true;
    }
    try {
      await apiRequest('/api/admin/posts/' + encodeURIComponent(pendingDeleteId), 'DELETE');
      showToast('删除成功');
      closeDeleteModal();
      loadPosts();
    } catch (err) {
      showToast(err.message || '删除失败');
    } finally {
      if (confirmBtn) {
        confirmBtn.textContent = '确定删除';
        confirmBtn.disabled = false;
      }
    }
  }

  /* ---------- 友链管理 ---------- */

  var cachedFriends = [];
  var editingFriendId = null;

  function getFriendStatusText(status) {
    if (status === 'approved') return '审核通过';
    if (status === 'rejected') return '审核不通过';
    return '待审核';
  }

  function getFriendStatusClass(status) {
    if (status === 'approved') return 'badge-published';
    if (status === 'rejected') return 'badge-rejected';
    return 'badge-draft';
  }

  async function loadFriends() {
    var tbody = document.getElementById('friendsTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="loading"><div class="spinner"></div><br>加载中...</div></td></tr>';
    }
    try {
      cachedFriends = await apiRequest('/api/admin/friends', 'GET') || [];
      renderFriendsTable(cachedFriends);
    } catch (err) {
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">⚠️</div><p>' + escapeHtml(err.message) + '</p></div></td></tr>';
      }
    }
  }

  function renderFriendsTable(friends) {
    var tbody = document.getElementById('friendsTableBody');
    if (!tbody) return;

    if (!friends.length) {
      tbody.innerHTML = (
        '<tr><td colspan="6"><div class="empty-state">' +
        '<div class="empty-icon">🤝</div>' +
        '<p>暂无友链，可以在上方添加或等待用户提交</p>' +
        '</div></td></tr>'
      );
      return;
    }

    tbody.innerHTML = friends.map(function (friend, index) {
      var icon = friend.avatar || friend.iconUrl || '';
      var avatar = icon
        ? '<img class="admin-friend-avatar" src="' + escapeHtml(icon) + '" alt="' + escapeHtml(friend.name || '友链') + '头像">'
        : '<span class="admin-friend-avatar avatar-placeholder-small">' + escapeHtml((friend.name || '友').slice(0, 1).toUpperCase()) + '</span>';
      var statusBadge = '<span class="badge ' + getFriendStatusClass(friend.status) + '">' + getFriendStatusText(friend.status) + '</span>';
      return (
        '<tr>' +
          '<td class="friend-order-cell">' + (index + 1) + '</td>' +
          '<td class="friend-order-cell">' + escapeHtml(String(friend.sortOrder || 0)) + '</td>' +
          '<td>' +
            '<div class="friend-site-cell">' +
              avatar +
              '<div class="friend-site-info">' +
                '<div class="friend-site-name">' + escapeHtml(friend.name || '未命名站点') + '</div>' +
                '<div class="friend-site-desc">' + escapeHtml(friend.description || '-') + '</div>' +
              '</div>' +
            '</div>' +
          '</td>' +
          '<td><a href="' + escapeHtml(friend.url || '#') + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(friend.url || '-') + '</a></td>' +
          '<td>' + statusBadge + '</td>' +
          '<td style="white-space:nowrap">' + formatDate(friend.createdAt) + '</td>' +
          '<td>' +
            '<div class="row-actions">' +
              '<button class="btn btn-sm btn-primary btn-friend-approve" data-id="' + escapeHtml(String(friend.id)) + '">通过</button>' +
              '<button class="btn btn-sm btn-ghost btn-friend-reject" data-id="' + escapeHtml(String(friend.id)) + '">不通过</button>' +
              '<button class="btn btn-sm btn-ghost btn-friend-edit" data-id="' + escapeHtml(String(friend.id)) + '">编辑</button>' +
              '<button class="btn btn-sm btn-danger btn-friend-delete" data-id="' + escapeHtml(String(friend.id)) + '">删除</button>' +
            '</div>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function clearFriendForm() {
    editingFriendId = null;
    var form = document.getElementById('friendForm');
    if (form) form.reset();
    var idInput = document.getElementById('friendId');
    if (idInput) idInput.value = '';
    var status = document.getElementById('friendStatus');
    if (status) status.value = 'approved';
    var title = document.getElementById('friendEditorTitle');
    if (title) title.textContent = '添加友链';
    renderFriendAvatarPreview('');
  }

  function renderFriendAvatarPreview(avatar) {
    var preview = document.getElementById('friendAvatarPreview');
    if (!preview) return;
    if (!avatar) {
      preview.innerHTML = '<span class="form-help">当前没有头像，保存时可上传新的小头像。</span>';
      return;
    }
    preview.innerHTML = '<img src="' + escapeHtml(avatar) + '" alt="当前友链头像"><span>当前头像</span>';
  }

  function fillFriendForm(friend) {
    editingFriendId = friend.id;
    document.getElementById('friendId').value = friend.id || '';
    document.getElementById('friendName').value = friend.name || '';
    document.getElementById('friendUrl').value = friend.url || '';
    document.getElementById('friendDescription').value = friend.description || '';
    document.getElementById('friendIconUrl').value = friend.iconUrl || '';
    document.getElementById('friendStatus').value = friend.status || 'pending';
    document.getElementById('friendSortOrder').value = friend.sortOrder || 0;
    document.getElementById('friendAvatar').value = '';
    var title = document.getElementById('friendEditorTitle');
    if (title) title.textContent = '编辑友链';
    renderFriendAvatarPreview(friend.avatar || '');
  }

  function collectFriendFormData() {
    var avatar = document.getElementById('friendAvatar');
    var file = avatar && avatar.files && avatar.files[0];
    if (file && file.size > 1024 * 1024) {
      throw new Error('头像图片不能大于 1MB');
    }
    var formData = new FormData();
    formData.append('name', document.getElementById('friendName').value.trim());
    formData.append('url', document.getElementById('friendUrl').value.trim());
    formData.append('description', document.getElementById('friendDescription').value.trim());
    formData.append('iconUrl', document.getElementById('friendIconUrl').value.trim());
    formData.append('status', document.getElementById('friendStatus').value);
    formData.append('visible', document.getElementById('friendStatus').value === 'approved' ? 'true' : 'false');
    formData.append('sortOrder', document.getElementById('friendSortOrder').value || '0');
    if (file) formData.append('avatar', file);
    return formData;
  }

  async function saveFriend(e) {
    if (e) e.preventDefault();
    var saveBtn = document.getElementById('saveFriendBtn');
    try {
      var name = document.getElementById('friendName').value.trim();
      var url = document.getElementById('friendUrl').value.trim();
      if (!name || !url) {
        showToast('请填写站点名称和链接');
        return;
      }

      var formData = collectFriendFormData();
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';
      }

      if (editingFriendId) {
        await apiFormRequest('/api/admin/friends/' + encodeURIComponent(editingFriendId), 'PUT', formData);
        showToast('友链更新成功');
      } else {
        await apiFormRequest('/api/admin/friends', 'POST', formData);
        showToast('友链添加成功');
      }
      clearFriendForm();
      loadFriends();
    } catch (err) {
      showToast(err.message || '保存失败');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '保存友链';
      }
    }
  }

  async function updateFriendStatus(id, status) {
    try {
      await apiRequest('/api/admin/friends/' + encodeURIComponent(id) + '/status', 'PATCH', { status: status });
      showToast(status === 'approved' ? '已审核通过' : '已设为审核不通过');
      loadFriends();
    } catch (err) {
      showToast(err.message || '操作失败');
    }
  }

  async function deleteFriend(id) {
    if (!confirm('确定要删除这条友链吗？此操作不可恢复。')) return;
    try {
      await apiRequest('/api/admin/friends/' + encodeURIComponent(id), 'DELETE');
      showToast('友链删除成功');
      if (editingFriendId === id) clearFriendForm();
      loadFriends();
    } catch (err) {
      showToast(err.message || '删除失败');
    }
  }

  /* ---------- 用户管理 ---------- */

  var userPage = 1;
  var userPageSize = 10;
  var userSearchKeyword = '';
  var userTotal = 0;
  var cachedUsers = [];
  var editingUserId = null;
  var pendingDeleteUserId = null;

  async function loadUsers() {
    var tbody = document.getElementById('usersTableBody');
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7"><div class="loading"><div class="spinner"></div><br>加载中...</div></td></tr>';
      }
    try {
      var params = '?page=' + userPage + '&pageSize=' + userPageSize;
      if (userSearchKeyword) {
        params += '&search=' + encodeURIComponent(userSearchKeyword);
      }
      var data = await apiRequest('/api/admin/users' + params, 'GET');
      cachedUsers = data.users || [];
      userTotal = data.total || 0;
      renderUsersTable(cachedUsers);
      renderUsersPagination();
    } catch (err) {
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">⚠️</div><p>' + escapeHtml(err.message) + '</p></div></td></tr>';
      }
      var pagination = document.getElementById('usersPagination');
      if (pagination) pagination.innerHTML = '';
    }
  }

  function renderUsersTable(users) {
    var tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    if (!users.length) {
      tbody.innerHTML = (
        '<tr><td colspan="8"><div class="empty-state">' +
        '<div class="empty-icon">👤</div>' +
        '<p>暂无用户</p>' +
        '</div></td></tr>'
      );
      return;
    }

    tbody.innerHTML = users.map(function (user) {
      var statusBadge = user.disabled
        ? '<span class="badge badge-disabled">已禁用</span>'
        : '<span class="badge badge-active">正常</span>';
      var toggleBtnText = user.disabled ? '启用' : '禁用';
      var toggleBtnClass = user.disabled ? 'btn-ghost' : 'btn-danger';
      var roleBadge = user.role === 'admin'
        ? '<span class="badge badge-active" style="background:var(--theme-primary-light);color:var(--theme-primary);">管理员</span>'
        : '<span class="badge">普通用户</span>';
      var roleBtnText = user.role === 'admin' ? '取消管理员' : '设为管理员';
      var roleBtnClass = user.role === 'admin' ? 'btn-ghost' : 'btn-primary';
      return (
        '<tr>' +
          '<td><input type="checkbox" class="user-checkbox" data-id="' + escapeHtml(String(user.id)) + '"></td>' +
          '<td>' + escapeHtml(user.username) + '</td>' +
          '<td>' + escapeHtml(user.nickname || '—') + '</td>' +
          '<td>' + roleBadge + '</td>' +
          '<td style="white-space:nowrap">' + formatDate(user.createdAt) + '</td>' +
          '<td style="white-space:nowrap">' + formatDate(user.lastLoginAt) + '</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td>' +
            '<div class="row-actions">' +
              '<button class="btn btn-sm btn-ghost btn-user-edit" data-id="' + escapeHtml(String(user.id)) + '">编辑</button>' +
              '<button class="btn btn-sm ' + roleBtnClass + ' btn-user-role" data-id="' + escapeHtml(String(user.id)) + '" data-role="' + (user.role === 'admin' ? 'admin' : 'user') + '">' + roleBtnText + '</button>' +
              '<button class="btn btn-sm ' + toggleBtnClass + ' btn-user-toggle" data-id="' + escapeHtml(String(user.id)) + '" data-disabled="' + (user.disabled ? '1' : '0') + '">' + toggleBtnText + '</button>' +
              '<button class="btn btn-sm btn-danger btn-user-delete" data-id="' + escapeHtml(String(user.id)) + '" data-username="' + escapeHtml(user.username) + '">删除</button>' +
            '</div>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
    updateUsersBulkActionBar();
  }

  function getSelectedUserIds() {
    var checkboxes = document.querySelectorAll('.user-checkbox:checked');
    var ids = [];
    for (var i = 0; i < checkboxes.length; i++) {
      ids.push(checkboxes[i].getAttribute('data-id'));
    }
    return ids;
  }

  function updateUsersBulkActionBar() {
    var bar = document.getElementById('usersBulkActionBar');
    var countEl = document.getElementById('usersSelectedCount');
    if (!bar || !countEl) return;
    var ids = getSelectedUserIds();
    countEl.textContent = ids.length;
    bar.style.display = ids.length > 0 ? 'flex' : 'none';
  }

  async function bulkUserAction(action) {
    var ids = getSelectedUserIds();
    if (!ids.length) {
      showToast('请先选择用户');
      return;
    }
    if (!confirm('确定要对选中的 ' + ids.length + ' 个用户执行此操作吗？')) return;
    try {
      await apiRequest('/api/admin/users/batch', 'POST', { ids: ids, action: action });
      showToast('操作成功');
      loadUsers();
    } catch (err) {
      showToast(err.message || '操作失败');
    }
  }

  function renderUsersPagination() {
    var pagination = document.getElementById('usersPagination');
    if (!pagination) return;

    var totalPages = Math.ceil(userTotal / userPageSize);
    if (totalPages <= 1) {
      pagination.innerHTML = '';
      return;
    }

    var html = '';
    html += '<button class="page-btn" data-page="prev"' + (userPage <= 1 ? ' disabled' : '') + '>上一页</button>';

    // 显示页码
    var startPage = Math.max(1, userPage - 2);
    var endPage = Math.min(totalPages, userPage + 2);
    if (startPage > 1) {
      html += '<button class="page-btn" data-page="1">1</button>';
      if (startPage > 2) {
        html += '<span class="page-info">...</span>';
      }
    }
    for (var i = startPage; i <= endPage; i++) {
      html += '<button class="page-btn' + (i === userPage ? ' active' : '') + '" data-page="' + i + '">' + i + '</button>';
    }
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        html += '<span class="page-info">...</span>';
      }
      html += '<button class="page-btn" data-page="' + totalPages + '">' + totalPages + '</button>';
    }

    html += '<button class="page-btn" data-page="next"' + (userPage >= totalPages ? ' disabled' : '') + '>下一页</button>';
    html += '<span class="page-info">共 ' + userTotal + ' 条</span>';

    pagination.innerHTML = html;
  }

  function showAddUserModal() {
    editingUserId = null;
    var title = document.getElementById('userModalTitle');
    if (title) title.textContent = '添加用户';
    var usernameInput = document.getElementById('userModalUsername');
    if (usernameInput) {
      usernameInput.value = '';
      usernameInput.disabled = false;
    }
    var passwordInput = document.getElementById('userModalPassword');
    if (passwordInput) {
      passwordInput.value = '';
      passwordInput.placeholder = '请输入密码（6-32个字符）';
      passwordInput.required = true;
    }
    var nicknameInput = document.getElementById('userModalNickname');
    if (nicknameInput) nicknameInput.value = '';
    var roleSelect = document.getElementById('userModalRole');
    if (roleSelect) roleSelect.value = 'user';
    openUserModal();
  }

  function showEditUserModal(userId) {
    var user = cachedUsers.find(function (u) { return String(u.id) === String(userId); });
    if (!user) return;

    editingUserId = userId;
    var title = document.getElementById('userModalTitle');
    if (title) title.textContent = '编辑用户';
    var usernameInput = document.getElementById('userModalUsername');
    if (usernameInput) {
      usernameInput.value = user.username;
      usernameInput.disabled = true;
    }
    var passwordInput = document.getElementById('userModalPassword');
    if (passwordInput) {
      passwordInput.value = '';
      passwordInput.placeholder = '留空则不修改密码（6-32个字符）';
      passwordInput.required = false;
    }
    var nicknameInput = document.getElementById('userModalNickname');
    if (nicknameInput) nicknameInput.value = user.nickname || '';
    var roleSelect = document.getElementById('userModalRole');
    if (roleSelect) roleSelect.value = user.role === 'admin' ? 'admin' : 'user';
    openUserModal();
  }

  function openUserModal() {
    var modal = document.getElementById('userModal');
    if (modal) modal.classList.add('show');
  }

  function closeUserModal() {
    editingUserId = null;
    var modal = document.getElementById('userModal');
    if (modal) modal.classList.remove('show');
  }

  async function saveUser() {
    var username = document.getElementById('userModalUsername').value.trim();
    var password = document.getElementById('userModalPassword').value;
    var nickname = document.getElementById('userModalNickname').value.trim();
    var role = document.getElementById('userModalRole').value;
    var saveBtn = document.getElementById('saveUserBtn');

    if (!editingUserId) {
      // 新建用户
      if (!username || username.length < 3 || username.length > 20) {
        showToast('用户名长度需在 3-20 个字符之间');
        return;
      }
      if (!password || password.length < 6 || password.length > 32) {
        showToast('密码长度需在 6-32 个字符之间');
        return;
      }
    } else {
      // 编辑用户
      if (password && (password.length < 6 || password.length > 32)) {
        showToast('密码长度需在 6-32 个字符之间');
        return;
      }
    }

    try {
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';
      }

      if (editingUserId) {
        var body = {};
        if (password) body.password = password;
        if (nickname !== undefined) body.nickname = nickname;
        if (role !== undefined) body.role = role;
        await apiRequest('/api/admin/users/' + encodeURIComponent(editingUserId), 'PUT', body);
        showToast('用户更新成功');
      } else {
        await apiRequest('/api/admin/users', 'POST', { username: username, password: password, nickname: nickname, role: role });
        showToast('用户添加成功');
      }
      closeUserModal();
      loadUsers();
    } catch (err) {
      showToast(err.message || '保存失败');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '保存';
      }
    }
  }

  async function toggleUserRole(userId, currentRole) {
    var newRole = currentRole === 'admin' ? 'user' : 'admin';
    try {
      await apiRequest('/api/admin/users/' + encodeURIComponent(userId), 'PUT', { role: newRole });
      showToast(newRole === 'admin' ? '已设为管理员，该用户可直接发布文章' : '已取消管理员权限');
      loadUsers();
    } catch (err) {
      showToast(err.message || '操作失败');
    }
  }

  async function toggleUserStatus(userId, disabled) {
    try {
      await apiRequest('/api/admin/users/' + encodeURIComponent(userId), 'PUT', { disabled: disabled });
      showToast(disabled ? '已禁用用户' : '已启用用户');
      loadUsers();
    } catch (err) {
      showToast(err.message || '操作失败');
    }
  }

  function openDeleteUserModal(userId, username) {
    pendingDeleteUserId = userId;
    var desc = document.getElementById('deleteUserDesc');
    if (desc) {
      desc.textContent = '确定要删除用户「' + (username || '该用户') + '」吗？该用户的点赞、收藏和投稿也会被清除，此操作不可恢复。';
    }
    var modal = document.getElementById('deleteUserModal');
    if (modal) modal.classList.add('show');
  }

  function closeDeleteUserModal() {
    pendingDeleteUserId = null;
    var modal = document.getElementById('deleteUserModal');
    if (modal) modal.classList.remove('show');
  }

  async function confirmDeleteUser() {
    if (!pendingDeleteUserId) return;
    var confirmBtn = document.getElementById('confirmDeleteUser');
    if (confirmBtn) {
      confirmBtn.textContent = '删除中...';
      confirmBtn.disabled = true;
    }
    try {
      await apiRequest('/api/admin/users/' + encodeURIComponent(pendingDeleteUserId), 'DELETE');
      showToast('删除成功');
      closeDeleteUserModal();
      loadUsers();
    } catch (err) {
      showToast(err.message || '删除失败');
    } finally {
      if (confirmBtn) {
        confirmBtn.textContent = '确定删除';
        confirmBtn.disabled = false;
      }
    }
  }

  /* ---------- 族谱管理 ---------- */

  var cachedGenealogy = [];
  var editingGenealogyId = null;

  async function loadGenealogy() {
    var tbody = document.getElementById('genealogyTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="11"><div class="loading"><div class="spinner"></div><br>加载中...</div></td></tr>';
    }
    try {
      var data = await apiRequest('/api/admin/genealogy', 'GET');
      cachedGenealogy = data.people || [];
      // 填充族谱标题及简介
      var introInput = document.getElementById('genealogyIntroInput');
      if (introInput) introInput.value = data.intro || '';
      var kickerInput = document.getElementById('genealogyKickerInput');
      if (kickerInput) kickerInput.value = data.kicker || 'Genealogy';
      var titleInput = document.getElementById('genealogyTitleInput');
      if (titleInput) titleInput.value = data.title || '麦氏族谱';
      var subtitleInput = document.getElementById('genealogySubtitleInput');
      if (subtitleInput) subtitleInput.value = data.subtitle || '';
      var expandLevelsInput = document.getElementById('genealogyExpandLevelsInput');
      if (expandLevelsInput) expandLevelsInput.value = data.maxVisibleLevels || 5;
      renderGenealogyTable(cachedGenealogy);
      updateGenealogyParentSelect(cachedGenealogy);
    } catch (err) {
      if (tbody) {
      tbody.innerHTML = '<tr><td colspan="11"><div class="empty-state"><div class="empty-icon">⚠️</div><p>' + escapeHtml(err.message) + '</p></div></td></tr>';
      }
    }
  }

  /* ===== 族谱密码管理 ===== */
  async function loadGenoPassword() {
    try {
      var data = await apiRequest('/api/admin/genealogy-password', 'GET');
      var input = document.getElementById('genealogyPasswordInput');
      if (input) input.value = data.password || '';
      var expiresInSelect = document.getElementById('genealogyPasswordExpiresIn');
      if (expiresInSelect) expiresInSelect.value = String(data.expiresIn || 0);
      // 显示密码状态
      var statusEl = document.getElementById('genoPwdStatus');
      if (statusEl) {
        if (!data.password) {
          statusEl.style.display = 'none';
        } else {
          statusEl.style.display = 'block';
          var createdAt = data.createdAt ? new Date(data.createdAt).toLocaleString('zh-CN') : '';
          var expireTime = data.expireTime ? new Date(data.expireTime).toLocaleString('zh-CN') : '';
          if (data.expired) {
            statusEl.style.background = '#fff1f0';
            statusEl.style.color = '#f5222d';
            statusEl.style.border = '1px solid #ffa39e';
            statusEl.innerHTML = '<strong>已过期</strong> · 创建于 ' + createdAt + ' · 用户无法使用此密码访问';
          } else if (data.expiresIn > 0) {
            statusEl.style.background = '#e8f8f0';
            statusEl.style.color = '#07C160';
            statusEl.style.border = '1px solid #87d068';
            statusEl.innerHTML = '<strong>' + data.remainingText + '</strong> · 创建于 ' + createdAt + ' · 过期于 ' + expireTime;
          } else {
            statusEl.style.background = '#e6f7ff';
            statusEl.style.color = '#1890ff';
            statusEl.style.border = '1px solid #91d5ff';
            statusEl.innerHTML = '<strong>永不过期</strong> · 创建于 ' + createdAt;
          }
        }
      }
    } catch (err) {
      console.error('加载族谱密码失败:', err);
    }
  }

  async function saveGenoPassword() {
    var input = document.getElementById('genealogyPasswordInput');
    var msg = document.getElementById('genoPwdMsg');
    var btn = document.getElementById('saveGenoPwdBtn');
    var expiresInSelect = document.getElementById('genealogyPasswordExpiresIn');
    if (!input) return;
    var password = input.value.trim();
    if (!password) {
      if (msg) { msg.textContent = '密码不能为空'; msg.style.color = '#f5222d'; }
      return;
    }
    if (password.length < 4 || password.length > 50) {
      if (msg) { msg.textContent = '密码长度需在 4-50 个字符之间'; msg.style.color = '#f5222d'; }
      return;
    }
    var expiresIn = expiresInSelect ? parseInt(expiresInSelect.value) : 0;
    if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }
    if (msg) { msg.textContent = ''; }
    try {
      await apiRequest('/api/admin/genealogy-password', 'PUT', { password: password, expiresIn: expiresIn });
      if (msg) {
        var expiryText = expiresIn > 0 ? '有效期 ' + expiresIn + ' 天' : '永不过期';
        msg.textContent = '密码已保存（' + expiryText + '）';
        msg.style.color = '#07C160';
      }
      loadGenoPassword();
    } catch (err) {
      if (msg) { msg.textContent = err.message || '保存失败'; msg.style.color = '#f5222d'; }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '保存密码'; }
    }
  }

  async function generateGenoPassword() {
    var input = document.getElementById('genealogyPasswordInput');
    var msg = document.getElementById('genoPwdMsg');
    var btn = document.getElementById('generateGenoPwdBtn');
    var expiresInSelect = document.getElementById('genealogyPasswordExpiresIn');
    var expiresIn = expiresInSelect ? parseInt(expiresInSelect.value) : 0;
    if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }
    if (msg) { msg.textContent = ''; }
    try {
      var data = await apiRequest('/api/admin/genealogy-password/generate', 'POST', { expiresIn: expiresIn });
      if (input) input.value = data.password || '';
      if (msg) {
        var expiryText = expiresIn > 0 ? '有效期 ' + expiresIn + ' 天' : '永不过期';
        msg.textContent = '已随机生成新密码：' + (data.password || '') + '（' + expiryText + '）';
        msg.style.color = '#07C160';
      }
      loadGenoPassword();
    } catch (err) {
      if (msg) { msg.textContent = err.message || '生成失败'; msg.style.color = '#f5222d'; }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '随机生成'; }
    }
  }

  async function clearGenoPassword() {
    var msg = document.getElementById('genoPwdMsg');
    var btn = document.getElementById('clearGenoPwdBtn');
    if (!confirm('确定要清除族谱访问密码吗？清除后用户无需密码即可访问族谱。')) return;
    if (btn) { btn.disabled = true; btn.textContent = '清除中...'; }
    if (msg) { msg.textContent = ''; }
    try {
      await apiRequest('/api/admin/genealogy-password', 'DELETE');
      var input = document.getElementById('genealogyPasswordInput');
      if (input) input.value = '';
      if (msg) { msg.textContent = '密码已清除，族谱页面无需密码即可访问'; msg.style.color = '#07C160'; }
      loadGenoPassword();
    } catch (err) {
      if (msg) { msg.textContent = err.message || '清除失败'; msg.style.color = '#f5222d'; }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '清除密码'; }
    }
  }

  function copyGenoPassword() {
    var input = document.getElementById('genealogyPasswordInput');
    var msg = document.getElementById('genoPwdMsg');
    var pwd = input ? input.value.trim() : '';
    if (!pwd) {
      if (msg) { msg.textContent = '当前没有密码可复制'; msg.style.color = '#fa8c16'; }
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(pwd).then(function () {
        if (msg) { msg.textContent = '密码已复制到剪贴板'; msg.style.color = '#07C160'; }
        showToast('密码已复制');
      }).catch(function () {
        fallbackCopyPwd(pwd, msg);
      });
    } else {
      fallbackCopyPwd(pwd, msg);
    }
  }

  function fallbackCopyPwd(text, msg) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); if (msg) { msg.textContent = '密码已复制到剪贴板'; msg.style.color = '#07C160'; } } catch (e) {}
    document.body.removeChild(ta);
  }

  async function loadGenoPwdRequests() {
    var tbody = document.getElementById('genoPwdReqTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;"><div class="loading"><div class="spinner"></div></div></td></tr>';
    try {
      var list = await apiRequest('/api/admin/genealogy-password-requests', 'GET');
      if (!list || !list.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999;padding:20px;">暂无申请</td></tr>';
        return;
      }
      tbody.innerHTML = list.map(function (r) {
        var statusBadge = '';
        if (r.status === 'pending') {
          statusBadge = '<span style="color:#fa8c16;font-weight:600;">待审核</span>';
        } else if (r.status === 'approved') {
          statusBadge = '<span style="color:#07C160;font-weight:600;">已通过</span>';
        } else if (r.status === 'rejected') {
          statusBadge = '<span style="color:#f5222d;font-weight:600;">已拒绝</span>';
        }
        var actions = '';
        if (r.status === 'pending') {
          actions = '<button class="btn btn-sm btn-primary btn-pwd-approve" data-id="' + escapeHtml(r.id) + '">通过</button> ' +
                    '<button class="btn btn-sm btn-danger btn-pwd-reject" data-id="' + escapeHtml(r.id) + '">拒绝</button>';
        }
        actions += ' <button class="btn btn-sm btn-ghost btn-pwd-delete" data-id="' + escapeHtml(r.id) + '">删除</button>';
        var time = r.requestedAt ? new Date(r.requestedAt).toLocaleString('zh-CN') : '';
        return '<tr>' +
          '<td>' + escapeHtml(r.name || '') + '</td>' +
          '<td>' + escapeHtml(r.contact || '') + '</td>' +
          '<td style="max-width:200px;word-break:break-all;">' + escapeHtml(r.reason || '-') + '</td>' +
          '<td style="white-space:nowrap;">' + time + '</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td style="white-space:nowrap;">' + actions + '</td>' +
          '</tr>';
      }).join('');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#f5222d;padding:20px;">' + escapeHtml(err.message || '加载失败') + '</td></tr>';
    }
  }

  async function reviewGenoPwdRequest(id, status) {
    try {
      await apiRequest('/api/admin/genealogy-password-requests/' + id, 'PATCH', { status: status });
      loadGenoPwdRequests();
    } catch (err) {
      alert(err.message || '操作失败');
    }
  }

  async function deleteGenoPwdRequest(id) {
    if (!confirm('确认删除此申请？')) return;
    try {
      await apiRequest('/api/admin/genealogy-password-requests/' + id, 'DELETE');
      loadGenoPwdRequests();
    } catch (err) {
      alert(err.message || '删除失败');
    }
  }

  function renderGenealogyTable(people) {
    var tbody = document.getElementById('genealogyTableBody');
    if (!tbody) return;
    /* 状态筛选 */
    var filterEl = document.getElementById('genealogyStatusFilter');
    var filterStatus = filterEl ? filterEl.value : '';
    if (filterStatus) {
      people = people.filter(function (p) {
        return (p.reviewStatus || 'approved') === filterStatus;
      });
    }
    /* 世代筛选 */
    var genFilterEl = document.getElementById('genealogyGenFilter');
    var filterGen = genFilterEl ? genFilterEl.value : '';
    if (filterGen) {
      people = people.filter(function (p) {
        return String(p.generation) === filterGen;
      });
    }
    /* 搜索筛选 */
    var searchEl = document.getElementById('genealogySearchInput');
    var keyword = searchEl ? searchEl.value.trim().toLowerCase() : '';
    if (keyword) {
      people = people.filter(function (p) {
        var name = (p.name || '').toLowerCase();
        var title = (p.title || '').toLowerCase();
        var spouse = (p.spouse || '').toLowerCase();
        var era = (p.era || '').toLowerCase();
        var intro = (p.intro || '').toLowerCase();
        return name.indexOf(keyword) >= 0 || title.indexOf(keyword) >= 0 || spouse.indexOf(keyword) >= 0 || era.indexOf(keyword) >= 0 || intro.indexOf(keyword) >= 0;
      });
    }
    /* 更新批量删除按钮可见性 */
    var batchBtn = document.getElementById('batchDeleteGenealogyBtn');
    if (batchBtn) batchBtn.style.display = people.length > 0 ? '' : 'none';

    if (!people.length) {
      tbody.innerHTML = '<tr><td colspan="11"><div class="empty-state"><div class="empty-icon">📜</div><p>暂无族谱人物，请在上方添加。</p></div></td></tr>';
      return;
    }
    // 按 generation 排序
    var sorted = people.slice().sort(function (a, b) {
      return (a.generation || 0) - (b.generation || 0) || (a.name || '').localeCompare(b.name || '');
    });
    tbody.innerHTML = sorted.map(function (p) {
      var parent = people.find(function (pp) { return String(pp.id) === String(p.parentId); });
      /* 从全量数据查找父亲名 */
      if (!parent) parent = cachedGenealogy.find(function (pp) { return String(pp.id) === String(p.parentId); });
      var parentName = parent ? escapeHtml(parent.name) : '—';
      var spouse = p.spouse ? escapeHtml(p.spouse) : '—';
      var birthDate = p.birthDate ? escapeHtml(p.birthDate) : '—';
      var intro = p.intro ? escapeHtml(p.intro.length > 30 ? p.intro.slice(0, 30) + '...' : p.intro) : '—';
      var reviewStatus = p.reviewStatus || 'approved';
      var statusBadge = '';
      if (reviewStatus === 'pending') {
        statusBadge = '<span class="badge badge-warning">待审核</span>';
      } else if (reviewStatus === 'approved') {
        statusBadge = '<span class="badge badge-success">已通过</span>';
      } else if (reviewStatus === 'rejected') {
        statusBadge = '<span class="badge badge-danger">已驳回</span>';
      }
      var submitter = p.submittedBy ? '<div style="font-size:11px;color:#999;">提交：' + escapeHtml(p.submittedBy) + '</div>' : '';
      var actions = '<div class="row-actions">' +
        '<button class="btn btn-sm btn-ghost btn-genealogy-edit" data-id="' + escapeHtml(String(p.id)) + '">编辑</button>' +
        '<button class="btn btn-sm btn-ghost btn-genealogy-detail" data-id="' + escapeHtml(String(p.id)) + '">详情</button>';
      if (reviewStatus === 'pending') {
        actions += '<button class="btn btn-sm btn-primary btn-genealogy-approve" data-id="' + escapeHtml(String(p.id)) + '">通过</button>';
        actions += '<button class="btn btn-sm btn-danger btn-genealogy-reject" data-id="' + escapeHtml(String(p.id)) + '">驳回</button>';
      }
      actions += '<button class="btn btn-sm btn-danger btn-genealogy-delete" data-id="' + escapeHtml(String(p.id)) + '" data-name="' + escapeHtml(p.name) + '">删除</button>';
      actions += '</div>';
      return (
        '<tr>' +
          '<td><input type="checkbox" class="geno-row-check" data-id="' + escapeHtml(String(p.id)) + '" data-name="' + escapeHtml(p.name) + '"></td>' +
          '<td><strong>' + escapeHtml(p.name) + '</strong>' + submitter + '</td>' +
          '<td>第' + escapeHtml(String(p.generation || 1)) + '世</td>' +
          '<td>' + parentName + '</td>' +
          '<td>' + spouse + '</td>' +
          '<td>' + birthDate + '</td>' +
          '<td>' + escapeHtml(p.title || '—') + '</td>' +
          '<td>' + escapeHtml(p.era || '—') + '</td>' +
          '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(p.intro || '') + '">' + intro + '</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td>' + actions + '</td>' +
        '</tr>'
      );
    }).join('');
    /* 更新统计 */
    updateGenealogyStats();
  }

  /* 统计概览 */
  function updateGenealogyStats() {
    var total = cachedGenealogy.length;
    var generations = {};
    var pending = 0;
    var branches = 0;
    for (var i = 0; i < cachedGenealogy.length; i++) {
      var p = cachedGenealogy[i];
      var gen = p.generation || 1;
      if (!generations[gen]) generations[gen] = 0;
      generations[gen]++;
      var rs = p.reviewStatus || 'approved';
      if (rs === 'pending') pending++;
    }
    /* 分支数 = 第2世人数（始祖的直接子代数） */
    var gen2 = cachedGenealogy.filter(function (p) { return (p.generation || 1) === 2; });
    branches = gen2.length;

    var el;
    if ((el = document.getElementById('genoStatTotal'))) el.textContent = total;
    if ((el = document.getElementById('genoStatGens'))) el.textContent = Object.keys(generations).length;
    if ((el = document.getElementById('genoStatPending'))) el.textContent = pending;
    if ((el = document.getElementById('genoStatBranches'))) el.textContent = branches;

    /* 填充世代筛选 */
    var genFilter = document.getElementById('genealogyGenFilter');
    if (genFilter) {
      var currentVal = genFilter.value;
      var gens = Object.keys(generations).map(Number).sort(function (a, b) { return a - b; });
      var html = '<option value="">全部世代</option>';
      for (var g = 0; g < gens.length; g++) {
        html += '<option value="' + gens[g] + '">第' + gens[g] + '世（' + generations[gens[g]] + '人）</option>';
      }
      genFilter.innerHTML = html;
      genFilter.value = currentVal;
    }
  }

  /* 人物详情弹窗 */
  function showGenealogyDetail(personId) {
    var person = cachedGenealogy.find(function (p) { return String(p.id) === String(personId); });
    if (!person) return;
    var parent = cachedGenealogy.find(function (p) { return String(p.id) === String(person.parentId); });
    var children = cachedGenealogy.filter(function (p) { return String(p.parentId) === String(personId); });

    var reviewStatus = person.reviewStatus || 'approved';
    var statusText = reviewStatus === 'pending' ? '待审核' : (reviewStatus === 'approved' ? '已通过' : '已驳回');

    var html = '<div style="font-size:14px;line-height:1.8;">';
    html += '<div style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid #eee;">';
    html += '<span style="font-size:20px;font-weight:700;">' + escapeHtml(person.name) + '</span>';
    if (person.title) html += ' <span style="color:#1890ff;">[' + escapeHtml(person.title) + ']</span>';
    html += ' <span style="color:#999;">第' + escapeHtml(String(person.generation || 1)) + '世</span>';
    html += ' <span class="badge ' + (reviewStatus === 'pending' ? 'badge-warning' : (reviewStatus === 'approved' ? 'badge-success' : 'badge-danger')) + '">' + statusText + '</span>';
    html += '</div>';
    html += '<table style="width:100%;font-size:13px;">';
    html += '<tr><td style="color:#999;width:80px;vertical-align:top;">父亲</td><td>' + (parent ? escapeHtml(parent.name) + '（第' + escapeHtml(String(parent.generation || 1)) + '世）' : '无（始祖）') + '</td></tr>';
    html += '<tr><td style="color:#999;vertical-align:top;">配偶</td><td>' + escapeHtml(person.spouse || '—') + '</td></tr>';
    html += '<tr><td style="color:#999;vertical-align:top;">生辰</td><td>' + escapeHtml(person.birthDate || '—') + '</td></tr>';
    html += '<tr><td style="color:#999;vertical-align:top;">年代</td><td>' + escapeHtml(person.era || '—') + '</td></tr>';
    html += '<tr><td style="color:#999;vertical-align:top;">子嗣</td><td>';
    if (children.length) {
      html += children.length + '人：';
      for (var i = 0; i < children.length; i++) {
        if (i > 0) html += '、';
        html += escapeHtml(children[i].name);
      }
    } else {
      html += '无';
    }
    html += '</td></tr>';
    html += '<tr><td style="color:#999;vertical-align:top;">简介</td><td style="white-space:pre-wrap;">' + escapeHtml(person.intro || '—') + '</td></tr>';
    if (person.submittedBy) {
      html += '<tr><td style="color:#999;vertical-align:top;">提交者</td><td>' + escapeHtml(person.submittedBy) + '</td></tr>';
    }
    html += '</table>';
    html += '</div>';

    /* 使用内置的 modal */
    var modal = document.getElementById('genealogyDetailModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'genealogyDetailModal';
      modal.className = 'modal-overlay';
      modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;';
      modal.innerHTML = '<div style="background:#fff;border-radius:12px;max-width:560px;width:90%;max-height:80vh;overflow-y:auto;padding:24px;box-shadow:0 8px 32px rgba(0,0,0,0.2);">' +
        '<div style="display:flex;justify-content:space-end;margin-bottom:8px;">' +
        '<button id="genealogyDetailClose" style="border:none;background:none;font-size:20px;cursor:pointer;color:#999;padding:4px 8px;">&times;</button>' +
        '</div>' +
        '<div id="genealogyDetailContent"></div>' +
        '</div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', function (e) {
        if (e.target === modal || e.target.id === 'genealogyDetailClose') {
          modal.style.display = 'none';
        }
      });
    }
    document.getElementById('genealogyDetailContent').innerHTML = html;
    modal.style.display = 'flex';
  }

  /* 批量删除 */
  async function batchDeleteGenealogy() {
    var checkboxes = document.querySelectorAll('.geno-row-check:checked');
    if (!checkboxes.length) {
      showToast('请先勾选要删除的人物');
      return;
    }
    var ids = [];
    var names = [];
    for (var i = 0; i < checkboxes.length; i++) {
      ids.push(checkboxes[i].getAttribute('data-id'));
      names.push(checkboxes[i].getAttribute('data-name'));
    }
    if (!confirm('确定要删除以下 ' + ids.length + ' 位人物吗？\n\n' + names.join('、') + '\n\n其后代也会被删除，此操作不可恢复。')) return;
    var successCount = 0;
    var failCount = 0;
    for (var j = 0; j < ids.length; j++) {
      try {
        await apiRequest('/api/admin/genealogy/' + encodeURIComponent(ids[j]), 'DELETE');
        successCount++;
      } catch (err) {
        failCount++;
      }
    }
    if (successCount) showToast('已删除 ' + successCount + ' 位人物' + (failCount ? '，' + failCount + ' 位失败' : ''));
    if (editingGenealogyId && ids.indexOf(editingGenealogyId) >= 0) clearGenealogyForm();
    loadGenealogy();
  }

  function updateGenealogyParentSelect(people) {
    var select = document.getElementById('genealogyParent');
    if (!select) return;
    var currentVal = select.value;
    var html = '<option value="">无（始祖）</option>';
    var sorted = people.slice().sort(function (a, b) {
      return (a.generation || 0) - (b.generation || 0) || (a.name || '').localeCompare(b.name || '');
    });
    for (var i = 0; i < sorted.length; i++) {
      var p = sorted[i];
      // 编辑时排除自己和后代（避免循环引用），简化处理：排除自己
      if (editingGenealogyId && String(p.id) === String(editingGenealogyId)) continue;
      html += '<option value="' + escapeHtml(String(p.id)) + '">第' + escapeHtml(String(p.generation || 1)) + '世 · ' + escapeHtml(p.name) + '</option>';
    }
    select.innerHTML = html;
    select.value = currentVal;
  }

  function clearGenealogyForm() {
    editingGenealogyId = null;
    var titleEl = document.getElementById('genealogyFormTitle');
    if (titleEl) titleEl.textContent = '添加人物';
    var form = document.getElementById('genealogyForm');
    if (form) form.reset();
    var genInput = document.getElementById('genealogyGeneration');
    if (genInput) genInput.value = '1';
    var editId = document.getElementById('genealogyEditId');
    if (editId) editId.value = '';
    updateGenealogyParentSelect(cachedGenealogy);
  }

  function showEditGenealogyForm(personId) {
    var person = cachedGenealogy.find(function (p) { return String(p.id) === String(personId); });
    if (!person) return;
    editingGenealogyId = personId;
    var titleEl = document.getElementById('genealogyFormTitle');
    if (titleEl) titleEl.textContent = '编辑人物';
    document.getElementById('genealogyEditId').value = person.id;
    document.getElementById('genealogyName').value = person.name || '';
    document.getElementById('genealogyGeneration').value = person.generation || 1;
    document.getElementById('genealogyTitle').value = person.title || '';
    document.getElementById('genealogyEra').value = person.era || '';
    document.getElementById('genealogySpouse').value = person.spouse || '';
    document.getElementById('genealogyBirthDate').value = person.birthDate || '';
    document.getElementById('genealogyIntro').value = person.intro || '';
    updateGenealogyParentSelect(cachedGenealogy);
    document.getElementById('genealogyParent').value = person.parentId || '';
  }

  async function saveGenealogyPerson() {
    var name = document.getElementById('genealogyName').value.trim();
    var generation = parseInt(document.getElementById('genealogyGeneration').value) || 1;
    var parentId = document.getElementById('genealogyParent').value || null;
    var title = document.getElementById('genealogyTitle').value.trim();
    var era = document.getElementById('genealogyEra').value.trim();
    var spouse = document.getElementById('genealogySpouse').value.trim();
    var birthDate = document.getElementById('genealogyBirthDate').value.trim();
    var intro = document.getElementById('genealogyIntro').value.trim();
    var saveBtn = document.getElementById('saveGenealogyBtn');

    if (!name) {
      showToast('人物姓名不能为空');
      return;
    }
    if (name.length > 30) {
      showToast('姓名不能超过 30 个字符');
      return;
    }

    try {
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '保存中...'; }
      var body = { name: name, generation: generation, parentId: parentId, spouse: spouse, birthDate: birthDate, title: title, era: era, intro: intro };
      if (editingGenealogyId) {
        await apiRequest('/api/admin/genealogy/' + encodeURIComponent(editingGenealogyId), 'PUT', body);
        showToast('人物更新成功');
      } else {
        await apiRequest('/api/admin/genealogy', 'POST', body);
        showToast('人物添加成功');
      }
      clearGenealogyForm();
      loadGenealogy();
    } catch (err) {
      showToast(err.message || '保存失败');
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '保存人物'; }
    }
  }

  async function deleteGenealogyPerson(personId, personName) {
    if (!confirm('确定要删除人物「' + (personName || '') + '」吗？其后代人物也会被删除，此操作不可恢复。')) return;
    try {
      await apiRequest('/api/admin/genealogy/' + encodeURIComponent(personId), 'DELETE');
      showToast('删除成功');
      if (editingGenealogyId && String(editingGenealogyId) === String(personId)) {
        clearGenealogyForm();
      }
      loadGenealogy();
    } catch (err) {
      showToast(err.message || '删除失败');
    }
  }

  async function reviewGenealogyPerson(personId, status) {
    var person = cachedGenealogy.find(function (p) { return String(p.id) === String(personId); });
    var name = person ? person.name : '';
    var reason = '';
    if (status === 'rejected') {
      reason = prompt('请输入驳回原因（可选）：') || '';
    } else {
      if (!confirm('确定要通过人物「' + name + '」的审核吗？通过后将在族谱页面显示。')) return;
    }
    try {
      await apiRequest('/api/admin/genealogy/' + encodeURIComponent(personId) + '/review', 'PATCH', { status: status, reason: reason });
      showToast(status === 'approved' ? '审核通过' : '已驳回');
      loadGenealogy();
    } catch (err) {
      showToast(err.message || '操作失败');
    }
  }

  async function saveGenealogyIntro() {
    var intro = document.getElementById('genealogyIntroInput').value;
    var kicker = document.getElementById('genealogyKickerInput').value;
    var title = document.getElementById('genealogyTitleInput').value;
    var subtitle = document.getElementById('genealogySubtitleInput').value;
    var expandLevels = document.getElementById('genealogyExpandLevelsInput').value;
    var btn = document.getElementById('saveGenealogyIntroBtn');
    try {
      if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }
      await apiRequest('/api/admin/genealogy/intro', 'PUT', {
        intro: intro,
        kicker: kicker,
        title: title,
        subtitle: subtitle,
        defaultExpandLevels: expandLevels
      });
      showToast('族谱标题及简介已保存');
    } catch (err) {
      showToast(err.message || '保存失败');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '保存'; }
    }
  }

  /* ---------- 分类管理 ---------- */

  var editingCategoryName = '';

  async function loadCategoriesAdmin() {
    var tbody = document.getElementById('categoriesTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="3"><div class="loading"><div class="spinner"></div><br>加载中...</div></td></tr>';
    }
    try {
      var categories = await apiRequest('/api/admin/categories', 'GET') || [];
      renderCategoriesTable(categories);
    } catch (err) {
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="3"><div class="empty-state"><div class="empty-icon">⚠️</div><p>' + escapeHtml(err.message) + '</p></div></td></tr>';
      }
    }
  }

  function renderCategoriesTable(categories) {
    var tbody = document.getElementById('categoriesTableBody');
    if (!tbody) return;
    if (!categories.length) {
      tbody.innerHTML = '<tr><td colspan="3"><div class="empty-state"><div class="empty-icon">📁</div><p>暂无分类，请在上方添加</p></div></td></tr>';
      return;
    }
    tbody.innerHTML = categories.map(function (cat) {
      return (
        '<tr>' +
          '<td><span class="badge badge-category">' + escapeHtml(cat.name) + '</span></td>' +
          '<td>' + (cat.postCount || 0) + '</td>' +
          '<td>' +
            '<div class="row-actions">' +
              '<button class="btn btn-sm btn-ghost btn-category-edit" data-name="' + escapeHtml(cat.name) + '">编辑</button>' +
              '<button class="btn btn-sm btn-danger btn-category-delete" data-name="' + escapeHtml(cat.name) + '" data-count="' + (cat.postCount || 0) + '">删除</button>' +
            '</div>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function clearCategoryForm() {
    editingCategoryName = '';
    var input = document.getElementById('categoryNameInput');
    var hidden = document.getElementById('editingCategoryName');
    var title = document.getElementById('categoryEditorTitle');
    var btn = document.getElementById('saveCategoryBtn');
    if (input) input.value = '';
    if (hidden) hidden.value = '';
    if (title) title.textContent = '添加分类';
    if (btn) btn.textContent = '保存分类';
  }

  async function saveCategory(e) {
    if (e) e.preventDefault();
    var input = document.getElementById('categoryNameInput');
    var btn = document.getElementById('saveCategoryBtn');
    var name = input ? input.value.trim() : '';
    if (!name) {
      showToast('请输入分类名称');
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = '保存中...';
    }
    try {
      if (editingCategoryName) {
        await apiRequest('/api/admin/categories/' + encodeURIComponent(editingCategoryName), 'PUT', { name: name });
        showToast('分类已更新');
      } else {
        await apiRequest('/api/admin/categories', 'POST', { name: name });
        showToast('分类已添加');
      }
      categoriesLoaded = false;
      clearCategoryForm();
      loadCategoriesAdmin();
    } catch (err) {
      showToast(err.message || '保存失败');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = editingCategoryName ? '更新分类' : '保存分类';
      }
    }
  }

  function editCategory(name) {
    editingCategoryName = name;
    var input = document.getElementById('categoryNameInput');
    var hidden = document.getElementById('editingCategoryName');
    var title = document.getElementById('categoryEditorTitle');
    var btn = document.getElementById('saveCategoryBtn');
    if (input) {
      input.value = name;
      input.focus();
    }
    if (hidden) hidden.value = name;
    if (title) title.textContent = '编辑分类';
    if (btn) btn.textContent = '更新分类';
  }

  async function deleteCategory(name, postCount) {
    if (Number(postCount) > 0) {
      showToast('该分类下还有文章，不能删除。请先修改文章分类。');
      return;
    }
    if (!confirm('确定要删除分类「' + name + '」吗？')) return;
    try {
      await apiRequest('/api/admin/categories/' + encodeURIComponent(name), 'DELETE');
      showToast('分类删除成功');
      categoriesLoaded = false;
      if (editingCategoryName === name) clearCategoryForm();
      loadCategoriesAdmin();
    } catch (err) {
      showToast(err.message || '删除失败');
    }
  }

  /* ---------- 标签管理 ---------- */

  var editingTagName = '';

  async function loadTagsAdmin() {
    var tbody = document.getElementById('tagsTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="3"><div class="loading"><div class="spinner"></div><br>加载中...</div></td></tr>';
    }
    try {
      var tags = await apiRequest('/api/admin/tags', 'GET') || [];
      renderTagsTable(tags);
    } catch (err) {
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="3"><div class="empty-state"><div class="empty-icon">⚠️</div><p>' + escapeHtml(err.message) + '</p></div></td></tr>';
      }
    }
  }

  function renderTagsTable(tags) {
    var tbody = document.getElementById('tagsTableBody');
    if (!tbody) return;
    if (!tags.length) {
      tbody.innerHTML = '<tr><td colspan="3"><div class="empty-state"><div class="empty-icon">🏷️</div><p>暂无标签，请在上方添加</p></div></td></tr>';
      return;
    }
    tbody.innerHTML = tags.map(function (tag) {
      return (
        '<tr>' +
          '<td><span class="tag-item">' + escapeHtml(tag.name) + '</span></td>' +
          '<td>' + (tag.postCount || 0) + '</td>' +
          '<td>' +
            '<div class="row-actions">' +
              '<button class="btn btn-sm btn-ghost btn-tag-edit" data-name="' + escapeHtml(tag.name) + '">编辑</button>' +
              '<button class="btn btn-sm btn-danger btn-tag-delete" data-name="' + escapeHtml(tag.name) + '" data-count="' + (tag.postCount || 0) + '">删除</button>' +
            '</div>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function clearTagForm() {
    editingTagName = '';
    var input = document.getElementById('tagNameInput');
    var hidden = document.getElementById('editingTagName');
    var title = document.getElementById('tagEditorTitle');
    var btn = document.getElementById('saveTagBtn');
    if (input) input.value = '';
    if (hidden) hidden.value = '';
    if (title) title.textContent = '添加标签';
    if (btn) btn.textContent = '保存标签';
  }

  async function saveTag(e) {
    if (e) e.preventDefault();
    var input = document.getElementById('tagNameInput');
    var btn = document.getElementById('saveTagBtn');
    var name = input ? input.value.trim() : '';
    if (!name) {
      showToast('请输入标签名称');
      return;
    }
    if (name.length > 20) {
      showToast('标签名称不能超过 20 个字符');
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = '保存中...';
    }
    try {
      if (editingTagName) {
        await apiRequest('/api/admin/tags/' + encodeURIComponent(editingTagName), 'PUT', { newName: name });
        showToast('标签已更新');
      } else {
        await apiRequest('/api/admin/tags', 'POST', { name: name });
        showToast('标签已添加');
      }
      clearTagForm();
      loadTagsAdmin();
    } catch (err) {
      showToast(err.message || '保存失败');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = editingTagName ? '更新标签' : '保存标签';
      }
    }
  }

  function editTag(name) {
    editingTagName = name;
    var input = document.getElementById('tagNameInput');
    var hidden = document.getElementById('editingTagName');
    var title = document.getElementById('tagEditorTitle');
    var btn = document.getElementById('saveTagBtn');
    if (input) {
      input.value = name;
      input.focus();
    }
    if (hidden) hidden.value = name;
    if (title) title.textContent = '编辑标签';
    if (btn) btn.textContent = '更新标签';
  }

  async function deleteTag(name) {
    if (!confirm('确定要删除标签「' + name + '」吗？该标签将从所有文章中移除。')) return;
    try {
      await apiRequest('/api/admin/tags/' + encodeURIComponent(name), 'DELETE');
      showToast('标签删除成功');
      if (editingTagName === name) clearTagForm();
      loadTagsAdmin();
    } catch (err) {
      showToast(err.message || '删除失败');
    }
  }

  /* ---------- 留言管理 ---------- */

  function getCommentStatusText(status) {
    if (status === 'approved') return '已通过';
    if (status === 'rejected') return '不通过';
    return '待审核';
  }

  function getCommentStatusClass(status) {
    if (status === 'approved') return 'badge-published';
    if (status === 'rejected') return 'badge-rejected';
    return 'badge-draft';
  }

  function getCommentTargetText(comment) {
    if (comment.targetType === 'home') return '主页留言区';
    return comment.targetTitle || '文章留言区';
  }

  async function loadCommentSettings() {
    try {
      var settings = await apiRequest('/api/admin/comment-settings', 'GET');
      var homeInput = document.getElementById('homepagePageSize');
      var postInput = document.getElementById('postPageSize');
      var keywordsInput = document.getElementById('blockedKeywords');
      if (homeInput) homeInput.value = settings.homepagePageSize || 5;
      if (postInput) postInput.value = settings.postPageSize || 10;
      if (keywordsInput) keywordsInput.value = (settings.blockedKeywords || []).join('\n');
    } catch (err) {
      showToast(err.message || '留言设置加载失败');
    }
  }

  async function saveCommentSettings(e) {
    if (e) e.preventDefault();
    var btn = document.getElementById('saveCommentSettingsBtn');
    var data = {
      homepagePageSize: Number(document.getElementById('homepagePageSize').value) || 5,
      postPageSize: Number(document.getElementById('postPageSize').value) || 10,
      blockedKeywords: document.getElementById('blockedKeywords').value
    };
    if (btn) {
      btn.disabled = true;
      btn.textContent = '保存中...';
    }
    try {
      await apiRequest('/api/admin/comment-settings', 'POST', data);
      showToast('留言设置保存成功');
    } catch (err) {
      showToast(err.message || '保存失败');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '保存留言设置';
      }
    }
  }

  async function loadComments() {
    var tbody = document.getElementById('commentsTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7"><div class="loading"><div class="spinner"></div><br>加载中...</div></td></tr>';
    }
    var params = new URLSearchParams();
    var status = document.getElementById('commentStatusFilter')?.value || '';
    var targetType = document.getElementById('commentTargetFilter')?.value || '';
    if (status) params.append('status', status);
    if (targetType) params.append('targetType', targetType);
    try {
      var query = params.toString();
      var comments = await apiRequest('/api/admin/comments' + (query ? '?' + query : ''), 'GET');
      renderCommentsTable(comments || []);
      // 重置全选状态
      var selectAll = document.getElementById('selectAllComments');
      if (selectAll) selectAll.checked = false;
      updateCommentsBulkActionBar();
    } catch (err) {
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">⚠️</div><p>' + escapeHtml(err.message) + '</p></div></td></tr>';
      }
    }
  }

  function renderCommentsTable(comments) {
    var tbody = document.getElementById('commentsTableBody');
    if (!tbody) return;
    if (!comments.length) {
      tbody.innerHTML = (
        '<tr><td colspan="7"><div class="empty-state">' +
        '<div class="empty-icon">💬</div>' +
        '<p>暂无留言</p>' +
        '</div></td></tr>'
      );
      return;
    }

    tbody.innerHTML = comments.map(function (comment) {
      var statusBadge = '<span class="badge ' + getCommentStatusClass(comment.status) + '">' + getCommentStatusText(comment.status) + '</span>';
      var keywordHtml = (comment.matchedKeywords || []).length
        ? '<div class="comment-keywords">触碰关键词：' + escapeHtml(comment.matchedKeywords.join('、')) + '</div>'
        : '';
      var replyHtml = '';
      if (comment.reply) {
        replyHtml = (
          '<div class="comment-reply-box">' +
            '<div class="comment-reply-label">管理员回复 <span class="comment-reply-time">' + formatDate(comment.replyAt) + '</span>' +
              '<button class="btn btn-link btn-reply-delete" data-id="' + escapeHtml(String(comment.id)) + '">删除回复</button>' +
            '</div>' +
            '<div class="comment-reply-content">' + escapeHtml(comment.reply) + '</div>' +
          '</div>'
        );
      }
      var replyBtn = comment.reply
        ? '<button class="btn btn-sm btn-ghost btn-comment-reply" data-id="' + escapeHtml(String(comment.id)) + '">修改回复</button>'
        : '<button class="btn btn-sm btn-ghost btn-comment-reply" data-id="' + escapeHtml(String(comment.id)) + '">回复</button>';
      return (
        '<tr>' +
          '<td><input type="checkbox" class="comment-checkbox" data-id="' + escapeHtml(String(comment.id)) + '"></td>' +
          '<td><div class="comment-content-cell">' + escapeHtml(comment.content || '') + '</div>' + keywordHtml + replyHtml + '</td>' +
          '<td>' + escapeHtml(comment.authorName || '游客') + '</td>' +
          '<td><div class="comment-target-cell">' + escapeHtml(getCommentTargetText(comment)) + '</div></td>' +
          '<td>' + statusBadge + '</td>' +
          '<td style="white-space:nowrap">' + formatDate(comment.createdAt) + '</td>' +
          '<td>' +
            '<div class="row-actions">' +
              replyBtn +
              '<button class="btn btn-sm btn-primary btn-comment-approve" data-id="' + escapeHtml(String(comment.id)) + '">通过</button>' +
              '<button class="btn btn-sm btn-ghost btn-comment-pending" data-id="' + escapeHtml(String(comment.id)) + '">待审</button>' +
              '<button class="btn btn-sm btn-ghost btn-comment-reject" data-id="' + escapeHtml(String(comment.id)) + '">不通过</button>' +
              '<button class="btn btn-sm btn-danger btn-comment-delete" data-id="' + escapeHtml(String(comment.id)) + '">删除</button>' +
            '</div>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function getSelectedCommentIds() {
    var tbody = document.getElementById('commentsTableBody');
    if (!tbody) return [];
    var checkboxes = tbody.querySelectorAll('input.comment-checkbox:checked');
    var ids = [];
    checkboxes.forEach(function (cb) {
      var id = cb.getAttribute('data-id');
      if (id) ids.push(id);
    });
    return ids;
  }

  function toggleSelectAllComments() {
    var selectAll = document.getElementById('selectAllComments');
    var tbody = document.getElementById('commentsTableBody');
    if (!selectAll || !tbody) return;
    var checkboxes = tbody.querySelectorAll('input.comment-checkbox');
    checkboxes.forEach(function (cb) {
      cb.checked = selectAll.checked;
    });
    updateCommentsBulkActionBar();
  }

  function updateCommentsBulkActionBar() {
    var ids = getSelectedCommentIds();
    var bar = document.getElementById('commentsBulkActionBar');
    var countEl = document.getElementById('commentsSelectedCount');
    if (bar) {
      bar.style.display = ids.length > 0 ? 'flex' : 'none';
    }
    if (countEl) {
      countEl.textContent = ids.length;
    }
    // 更新全选复选框状态
    var selectAll = document.getElementById('selectAllComments');
    var tbody = document.getElementById('commentsTableBody');
    if (selectAll && tbody) {
      var allCheckboxes = tbody.querySelectorAll('input.comment-checkbox');
      if (allCheckboxes.length > 0) {
        selectAll.checked = ids.length === allCheckboxes.length;
      } else {
        selectAll.checked = false;
      }
    }
  }

  async function bulkCommentAction(action) {
    var ids = getSelectedCommentIds();
    if (!ids.length) {
      showToast('请先选择要操作的留言');
      return;
    }
    var actionText = {
      'approve': '通过',
      'reject': '不通过',
      'pending': '设为待审核',
      'delete': '删除'
    };
    var confirmMsg = '确定要' + (actionText[action] || action) + '选中的 ' + ids.length + ' 条留言吗？';
    if (action === 'delete') {
      confirmMsg += '此操作不可恢复。';
    }
    if (!confirm(confirmMsg)) return;
    try {
      var result = await apiRequest('/api/admin/comments/batch', 'POST', { action: action, ids: ids });
      showToast('操作成功，已处理 ' + (result.updated || 0) + ' 条留言');
      loadComments();
    } catch (err) {
      showToast(err.message || '操作失败');
    }
  }

  async function updateCommentStatus(id, status) {
    try {
      await apiRequest('/api/admin/comments/' + encodeURIComponent(id) + '/status', 'PATCH', { status: status });
      showToast('留言状态已更新');
      loadComments();
    } catch (err) {
      showToast(err.message || '操作失败');
    }
  }

  async function deleteComment(id) {
    if (!confirm('确定要删除这条留言吗？此操作不可恢复。')) return;
    try {
      await apiRequest('/api/admin/comments/' + encodeURIComponent(id), 'DELETE');
      showToast('留言删除成功');
      loadComments();
    } catch (err) {
      showToast(err.message || '删除失败');
    }
  }

  /* ---------- 留言回复 ---------- */

  var currentReplyCommentId = '';

  function openReplyModal(id, existingReply) {
    currentReplyCommentId = id;
    var textarea = document.getElementById('replyTextarea');
    var modal = document.getElementById('replyModal');
    if (textarea) textarea.value = existingReply || '';
    if (modal) modal.classList.add('show');
    if (textarea) setTimeout(function () { textarea.focus(); }, 100);
  }

  function closeReplyModal() {
    var modal = document.getElementById('replyModal');
    if (modal) modal.classList.remove('show');
    currentReplyCommentId = '';
  }

  async function submitReply() {
    if (!currentReplyCommentId) return;
    var textarea = document.getElementById('replyTextarea');
    var reply = textarea ? textarea.value.trim() : '';
    if (!reply) {
      showToast('请输入回复内容');
      return;
    }
    try {
      await apiRequest('/api/admin/comments/' + encodeURIComponent(currentReplyCommentId) + '/reply', 'POST', { reply: reply });
      showToast('回复成功');
      closeReplyModal();
      loadComments();
    } catch (err) {
      showToast(err.message || '回复失败');
    }
  }

  async function deleteReply(id) {
    if (!confirm('确定要删除这条回复吗？')) return;
    try {
      await apiRequest('/api/admin/comments/' + encodeURIComponent(id) + '/reply', 'DELETE');
      showToast('回复已删除');
      loadComments();
    } catch (err) {
      showToast(err.message || '删除失败');
    }
  }

  /* ---------- 投稿审核 ---------- */

  function getSubmissionStatusText(status) {
    if (status === 'approved') return '已通过';
    if (status === 'rejected') return '不通过';
    return '待审核';
  }

  function getSubmissionStatusClass(status) {
    if (status === 'approved') return 'badge-published';
    if (status === 'rejected') return 'badge-rejected';
    return 'badge-draft';
  }

  var cachedSubmissions = [];

  async function loadSubmissions() {
    var tbody = document.getElementById('submissionsTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="loading"><div class="spinner"></div><br>加载中...</div></td></tr>';
    }
    var status = document.getElementById('submissionStatusFilter')?.value || '';
    var query = status ? '?status=' + encodeURIComponent(status) : '';
    try {
      var submissions = await apiRequest('/api/admin/submissions' + query, 'GET');
      cachedSubmissions = submissions || [];
      renderSubmissionsTable(cachedSubmissions);
    } catch (err) {
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">⚠️</div><p>' + escapeHtml(err.message) + '</p></div></td></tr>';
      }
    }
  }

  function renderSubmissionsTable(submissions) {
    var tbody = document.getElementById('submissionsTableBody');
    if (!tbody) return;
    if (!submissions.length) {
      tbody.innerHTML = (
        '<tr><td colspan="6"><div class="empty-state">' +
        '<div class="empty-icon">📝</div>' +
        '<p>暂无用户投稿</p>' +
        '</div></td></tr>'
      );
      return;
    }

    tbody.innerHTML = submissions.map(function (item) {
      var status = item.reviewStatus || (item.published ? 'approved' : 'pending');
      var badge = '<span class="badge ' + getSubmissionStatusClass(status) + '">' + getSubmissionStatusText(status) + '</span>';
      var summary = item.summary ? '<div class="submission-summary-cell">' + escapeHtml(item.summary) + '</div>' : '';
      var viewBtn = item.published
        ? '<button class="btn btn-sm btn-ghost btn-submission-view" data-id="' + escapeHtml(String(item.id)) + '">前台查看</button>'
        : '';
      return (
        '<tr>' +
          '<td><div class="table-title-cell">' + escapeHtml(item.title || '无标题投稿') + '</div>' + summary + '</td>' +
          '<td>' + escapeHtml(item.submittedBy || item.author || '-') + '</td>' +
          '<td><span class="badge badge-category">' + escapeHtml(item.category || '投稿') + '</span></td>' +
          '<td>' + badge + '</td>' +
          '<td style="white-space:nowrap">' + formatDate(item.submittedAt || item.createdAt) + '</td>' +
          '<td>' +
            '<div class="row-actions">' +
              '<button class="btn btn-sm btn-ghost btn-submission-preview" data-id="' + escapeHtml(String(item.id)) + '">预览</button>' +
              '<button class="btn btn-sm btn-primary btn-submission-approve" data-id="' + escapeHtml(String(item.id)) + '">通过并发布</button>' +
              '<button class="btn btn-sm btn-ghost btn-submission-reject" data-id="' + escapeHtml(String(item.id)) + '">不通过</button>' +
              viewBtn +
            '</div>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  async function updateSubmissionStatus(id, status) {
    var reason = '';
    if (status === 'rejected') {
      reason = prompt('请输入不通过原因（可留空）：') || '';
    }
    try {
      await apiRequest('/api/admin/submissions/' + encodeURIComponent(id) + '/status', 'PATCH', {
        status: status,
        reason: reason
      });
      showToast(status === 'approved' ? '投稿已通过并发布' : '投稿状态已更新');
      loadSubmissions();
      loadDashboard();
    } catch (err) {
      showToast(err.message || '操作失败');
    }
  }

  var currentPreviewSubmissionId = null;

  function showSubmissionPreview(item) {
    currentPreviewSubmissionId = item.id;
    var modal = document.getElementById('submissionPreviewModal');
    var titleEl = document.getElementById('submissionPreviewTitle');
    var metaEl = document.getElementById('submissionPreviewMeta');
    var contentEl = document.getElementById('submissionPreviewContent');
    if (!modal || !titleEl || !contentEl) return;

    titleEl.textContent = item.title || '无标题投稿';
    var metaParts = [];
    if (item.submittedBy || item.author) metaParts.push('投稿人: ' + escapeHtml(item.submittedBy || item.author));
    if (item.category) metaParts.push('分类: ' + escapeHtml(item.category));
    if (item.submittedAt || item.createdAt) metaParts.push('时间: ' + formatDate(item.submittedAt || item.createdAt));
    metaEl.innerHTML = metaParts.join(' · ');

    var content = item.content || item.summary || '<p style="color:#999;">暂无内容</p>';
    contentEl.innerHTML = content;

    modal.classList.add('active');
  }

  function closeSubmissionPreview() {
    var modal = document.getElementById('submissionPreviewModal');
    if (modal) modal.classList.remove('active');
    currentPreviewSubmissionId = null;
  }

  /* ---------- 网站设置 ---------- */

  function renderSiteLogoPreview(logo) {
    var preview = document.getElementById('siteLogoPreview');
    if (!preview) return;
    if (!logo) {
      preview.innerHTML = '<span class="form-help">当前未上传网站 Logo，将使用默认微信绿图标。</span>';
      return;
    }
    preview.innerHTML = '<img src="' + escapeHtml(logo) + '" alt="当前网站Logo"><span>当前网站 Logo</span>';
  }

  function renderDefaultCoverPreview(url) {
    var preview = document.getElementById('defaultCoverPreview');
    if (!preview) return;
    if (url) {
      preview.innerHTML = '<img src="' + escapeHtml(url) + '" alt="默认封面预览">';
    } else {
      preview.innerHTML = '<span class="form-help">当前未设置默认封面图，无封面文章将使用样式卡片。</span>';
    }
  }

  async function uploadDefaultCover(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('默认封面图片不能大于 5MB');
      return;
    }
    var formData = new FormData();
    formData.append('image', file);
    try {
      var data = await apiFormRequest('/api/admin/uploads/default-cover', 'POST', formData);
      var url = data.url || '';
      var urlInput = document.getElementById('defaultCoverUrl');
      if (urlInput) {
        urlInput.value = url;
        renderDefaultCoverPreview(url);
      }
      showToast('默认封面上传成功');
    } catch (err) {
      showToast(err.message || '默认封面上传失败');
    }
  }

  async function loadSiteSettings() {
    try {
      var settings = await apiRequest('/api/settings', 'GET');
      var nameInput = document.getElementById('siteNameInput');
      var subtitleInput = document.getElementById('siteSubtitleInput');
      var descriptionInput = document.getElementById('siteDescriptionInput');
      var footerInput = document.getElementById('footerTextInput');
      if (nameInput) nameInput.value = settings.siteName || '麦氏乡村';
      if (subtitleInput) subtitleInput.value = settings.siteSubtitle || '记录麦氏家族族谱传承、乡村风貌与乡亲故事';
      if (descriptionInput) descriptionInput.value = settings.description || '';
      if (footerInput) footerInput.value = settings.footerText || '';
      renderSiteLogoPreview(settings.logo || '');
      // 默认封面图
      var defaultCoverInput = document.getElementById('defaultCoverUrl');
      if (defaultCoverInput) defaultCoverInput.value = settings.defaultCover || '';
      renderDefaultCoverPreview(settings.defaultCover || '');
      // 显示模式
      var mode = settings.displayMode || 'default';
      var radio = document.querySelector('input[name="displayMode"][value="' + mode + '"]');
      if (radio) radio.checked = true;
      // 维护模式
      var mtToggle = document.getElementById('maintenanceModeToggle');
      var mtPwdGroup = document.getElementById('maintenancePasswordGroup');
      var mtMsgGroup = document.getElementById('maintenanceMessageGroup');
      var mtPwdInput = document.getElementById('maintenancePasswordInput');
      var mtMsgInput = document.getElementById('maintenanceMessageInput');
      if (mtToggle) {
        mtToggle.checked = settings.maintenanceMode === true || settings.maintenanceMode === 'true';
        if (mtPwdGroup) mtPwdGroup.style.display = mtToggle.checked ? 'block' : 'none';
        if (mtMsgGroup) mtMsgGroup.style.display = mtToggle.checked ? 'block' : 'none';
        mtToggle.addEventListener('change', function () {
          if (mtPwdGroup) mtPwdGroup.style.display = mtToggle.checked ? 'block' : 'none';
          if (mtMsgGroup) mtMsgGroup.style.display = mtToggle.checked ? 'block' : 'none';
        });
      }
      if (mtPwdInput) mtPwdInput.value = settings.maintenancePassword || '';
      if (mtMsgInput) mtMsgInput.value = settings.maintenanceMessage || '网站维护中，敬请谅解';
      // 加载导航链接
      renderNavLinks(settings.navLinks || []);
    } catch (err) {
      showToast(err.message || '网站设置加载失败');
    }
    loadAboutSettings();
    loadContactSettings();
  }

  async function saveSiteSettings(e) {
    if (e) e.preventDefault();
    var logoInput = document.getElementById('siteLogoInput');
    var file = logoInput && logoInput.files && logoInput.files[0];
    if (file && file.size > 1024 * 1024) {
      showToast('网站 Logo 不能大于 1MB');
      return;
    }

    var formData = new FormData();
    formData.append('siteName', document.getElementById('siteNameInput').value.trim() || '麦氏乡村');
    formData.append('siteSubtitle', document.getElementById('siteSubtitleInput').value.trim());
    formData.append('description', document.getElementById('siteDescriptionInput').value.trim());
    formData.append('footerText', document.getElementById('footerTextInput').value.trim());
    if (file) formData.append('logo', file);
    // 默认封面图 URL
    var defaultCoverInput = document.getElementById('defaultCoverUrl');
    if (defaultCoverInput) formData.append('defaultCover', defaultCoverInput.value.trim());
    // 显示模式
    var modeRadio = document.querySelector('input[name="displayMode"]:checked');
    formData.append('displayMode', modeRadio ? modeRadio.value : 'default');
    // 维护模式
    var mtToggle = document.getElementById('maintenanceModeToggle');
    var mtPwdInput = document.getElementById('maintenancePasswordInput');
    var mtMsgInput = document.getElementById('maintenanceMessageInput');
    if (mtToggle) formData.append('maintenanceMode', mtToggle.checked ? 'true' : 'false');
    if (mtPwdInput) formData.append('maintenancePassword', mtPwdInput.value.trim());
    if (mtMsgInput) formData.append('maintenanceMessage', mtMsgInput.value.trim());

    var btn = document.getElementById('saveSiteSettingsBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '保存中...';
    }

    try {
      var settings = await apiFormRequest('/api/admin/settings', 'POST', formData);
      showToast('网站设置保存成功');
      if (logoInput) logoInput.value = '';
      renderSiteLogoPreview(settings.logo || '');
      renderDefaultCoverPreview(settings.defaultCover || '');
    } catch (err) {
      showToast(err.message || '保存失败');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '保存设置';
      }
    }
  }

  async function loadAboutSettings() {
    try {
      var about = await apiRequest('/api/about', 'GET');
      var kickerInput = document.getElementById('aboutKickerInput');
      var titleInput = document.getElementById('aboutTitleInput');
      var summaryInput = document.getElementById('aboutSummaryInput');
      var contentInput = document.getElementById('aboutContentInput');
      if (kickerInput) kickerInput.value = about.kicker || 'About';
      if (titleInput) titleInput.value = about.title || '关于本站';
      if (summaryInput) summaryInput.value = about.summary || '';
      if (contentInput) contentInput.value = about.content || '';
    } catch (err) {
      showToast(err.message || '关于页面加载失败');
    }
  }

  async function saveAboutSettings(e) {
    if (e) e.preventDefault();
    var btn = document.getElementById('saveAboutSettingsBtn');
    var data = {
      kicker: document.getElementById('aboutKickerInput').value.trim(),
      title: document.getElementById('aboutTitleInput').value.trim(),
      summary: document.getElementById('aboutSummaryInput').value.trim(),
      content: document.getElementById('aboutContentInput').value
    };
    if (btn) {
      btn.disabled = true;
      btn.textContent = '保存中...';
    }
    try {
      await apiRequest('/api/admin/about', 'POST', data);
      showToast('关于页面保存成功');
    } catch (err) {
      showToast(err.message || '保存失败');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '保存关于页面';
      }
    }
  }

  /* ---------- 联系方式管理 ---------- */

  async function loadContactSettings() {
    try {
      var about = await apiRequest('/api/about', 'GET');
      var c = about.contact || {};
      var el;
      if ((el = document.getElementById('contactEmailInput'))) el.value = c.email || '';
      if ((el = document.getElementById('contactWechatInput'))) el.value = c.wechat || '';
      if ((el = document.getElementById('contactQQInput'))) el.value = c.qq || '';
      if ((el = document.getElementById('contactPhoneInput'))) el.value = c.phone || '';
      if ((el = document.getElementById('contactAddressInput'))) el.value = c.address || '';
      // 同时加载赞助设置
      var s = about.sponsor || {};
      if ((el = document.getElementById('sponsorDescInput'))) el.value = s.description || '';
      if ((el = document.getElementById('sponsorWechatQrInput'))) el.value = s.wechatQr || '';
      if ((el = document.getElementById('sponsorAlipayQrInput'))) el.value = s.alipayQr || '';
      if ((el = document.getElementById('sponsorThirdQrInput'))) el.value = s.thirdQr || '';
      if ((el = document.getElementById('sponsorCodeInput'))) el.value = s.code || '';
    } catch (err) {
      showToast(err.message || '联系方式加载失败');
    }
  }

  async function saveContactSettings(e) {
    if (e) e.preventDefault();
    var btn = document.getElementById('saveContactSettingsBtn');
    var data = {
      email: document.getElementById('contactEmailInput').value.trim(),
      wechat: document.getElementById('contactWechatInput').value.trim(),
      qq: document.getElementById('contactQQInput').value.trim(),
      phone: document.getElementById('contactPhoneInput').value.trim(),
      address: document.getElementById('contactAddressInput').value.trim()
    };
    if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }
    try {
      await apiRequest('/api/admin/contact', 'POST', data);
      showToast('联系方式保存成功');
    } catch (err) {
      showToast(err.message || '保存失败');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '保存联系方式'; }
    }
  }

  async function saveSponsorSettings(e) {
    if (e) e.preventDefault();
    var btn = document.getElementById('saveSponsorSettingsBtn');
    var data = {
      description: document.getElementById('sponsorDescInput').value.trim(),
      wechatQr: document.getElementById('sponsorWechatQrInput').value.trim(),
      alipayQr: document.getElementById('sponsorAlipayQrInput').value.trim(),
      thirdQr: document.getElementById('sponsorThirdQrInput').value.trim(),
      code: document.getElementById('sponsorCodeInput').value.trim()
    };
    if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }
    try {
      await apiRequest('/api/admin/sponsor', 'POST', data);
      showToast('赞助设置保存成功');
    } catch (err) {
      showToast(err.message || '保存失败');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '保存赞助设置'; }
    }
  }

  /* ---------- 导航菜单管理 ---------- */

  function renderNavLinks(navLinks) {
    var container = document.getElementById('navLinksContainer');
    if (!container) return;
    if (!navLinks.length) {
      navLinks = [
        { name: '首页', url: 'index.html', visible: true },
        { name: '文章', url: 'articles.html', visible: true },
        { name: '朋友们', url: 'friends.html', visible: true },
        { name: '关于', url: 'about.html', visible: true }
      ];
    }
    container.innerHTML = navLinks.map(function (link, i) {
      return (
        '<div class="nav-link-row" data-index="' + i + '">' +
          '<span class="nav-link-drag" title="拖动排序">⋮⋮</span>' +
          '<input type="text" class="form-input nav-link-name" value="' + escapeHtml(link.name || '') + '" placeholder="导航名称" maxlength="20">' +
          '<input type="text" class="form-input nav-link-url" value="' + escapeHtml(link.url || '') + '" placeholder="链接地址（如 articles.html）">' +
          '<label class="nav-link-visible">' +
            '<input type="checkbox"' + (link.visible !== false ? ' checked' : '') + '>' +
            '显示' +
          '</label>' +
          '<button class="btn btn-sm btn-danger nav-link-remove">删除</button>' +
        '</div>'
      );
    }).join('');
  }

  function collectNavLinks() {
    var container = document.getElementById('navLinksContainer');
    if (!container) return [];
    var rows = container.querySelectorAll('.nav-link-row');
    var links = [];
    rows.forEach(function (row) {
      var nameInput = row.querySelector('.nav-link-name');
      var urlInput = row.querySelector('.nav-link-url');
      var visibleInput = row.querySelector('.nav-link-visible input');
      if (nameInput && urlInput && nameInput.value.trim()) {
        links.push({
          name: nameInput.value.trim(),
          url: urlInput.value.trim() || 'index.html',
          visible: visibleInput ? visibleInput.checked : true
        });
      }
    });
    return links;
  }

  async function saveNavLinks() {
    var btn = document.getElementById('saveNavLinksBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '保存中...';
    }
    try {
      var links = collectNavLinks();
      var formData = new FormData();
      formData.append('navLinks', JSON.stringify(links));
      await apiFormRequest('/api/admin/settings', 'POST', formData);
      showToast('导航菜单保存成功');
    } catch (err) {
      showToast(err.message || '保存失败');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '保存导航菜单';
      }
    }
  }

  function addNavLinkRow() {
    var container = document.getElementById('navLinksContainer');
    if (!container) return;
    var idx = container.querySelectorAll('.nav-link-row').length;
    var div = document.createElement('div');
    div.className = 'nav-link-row';
    div.setAttribute('data-index', idx);
    div.innerHTML =
      '<span class="nav-link-drag" title="拖动排序">⋮⋮</span>' +
      '<input type="text" class="form-input nav-link-name" value="" placeholder="导航名称" maxlength="20">' +
      '<input type="text" class="form-input nav-link-url" value="" placeholder="链接地址（如 articles.html）">' +
      '<label class="nav-link-visible">' +
        '<input type="checkbox" checked>显示' +
      '</label>' +
      '<button class="btn btn-sm btn-danger nav-link-remove">删除</button>';
    container.appendChild(div);
  }

  /* ---------- 侧边栏（移动端） ---------- */

  function openSidebar() {
    var sidebar = document.getElementById('sidebar');
    var mask = document.getElementById('sidebarMask');
    if (sidebar) sidebar.classList.add('open');
    if (mask) mask.classList.add('show');
  }

  function closeSidebar() {
    var sidebar = document.getElementById('sidebar');
    var mask = document.getElementById('sidebarMask');
    if (sidebar) sidebar.classList.remove('open');
    if (mask) mask.classList.remove('show');
  }

  /* ---------- 事件绑定 ---------- */

  function bindAdminEvents() {
    // 侧边栏导航（事件委托）
    var sidebarNav = document.getElementById('sidebarNav');
    if (sidebarNav) {
      sidebarNav.addEventListener('click', function (e) {
        var item = e.target.closest('.nav-item');
        if (!item) return;
        var page = item.getAttribute('data-page');
        if (page) {
          showPage(page, null);
        }
      });
    }

    // 退出登录
    var logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        if (confirm('确定要退出登录吗？')) {
          logout();
        }
      });
    }

    // 网站前台入口
    var viewFrontendBtn = document.getElementById('viewFrontendBtn');
    if (viewFrontendBtn) {
      viewFrontendBtn.addEventListener('click', function () {
        window.open('/', '_blank');
      });
    }

    // 缓存管理按钮
    var refreshCacheBtn = document.getElementById('refreshCacheBtn');
    if (refreshCacheBtn) {
      refreshCacheBtn.addEventListener('click', loadCacheStats);
    }
    var clearAllCacheBtn = document.getElementById('clearAllCacheBtn');
    if (clearAllCacheBtn) {
      clearAllCacheBtn.addEventListener('click', function () { clearCache('all'); });
    }
    var clearPostsCacheBtn = document.getElementById('clearPostsCacheBtn');
    if (clearPostsCacheBtn) {
      clearPostsCacheBtn.addEventListener('click', function () { clearCache('posts'); });
    }
    var clearCommentsCacheBtn = document.getElementById('clearCommentsCacheBtn');
    if (clearCommentsCacheBtn) {
      clearCommentsCacheBtn.addEventListener('click', function () { clearCache('comments'); });
    }
    var clearFriendsCacheBtn = document.getElementById('clearFriendsCacheBtn');
    if (clearFriendsCacheBtn) {
      clearFriendsCacheBtn.addEventListener('click', function () { clearCache('friends'); });
    }
    var clearSettingsCacheBtn = document.getElementById('clearSettingsCacheBtn');
    if (clearSettingsCacheBtn) {
      clearSettingsCacheBtn.addEventListener('click', function () { clearCache('settings'); });
    }

    // 一键清除全部缓存（本地 + Cloudflare）
    var purgeAllCacheBtn = document.getElementById('purgeAllCacheBtn');
    if (purgeAllCacheBtn) {
      purgeAllCacheBtn.addEventListener('click', purgeAllCache);
    }

    // Cloudflare 配置保存
    var cfConfigForm = document.getElementById('cloudflareConfigForm');
    if (cfConfigForm) {
      cfConfigForm.addEventListener('submit', function (e) {
        e.preventDefault();
        saveCloudflareConfig();
      });
    }

    // 测试 Cloudflare 缓存清除
    var testCfPurgeBtn = document.getElementById('testCfPurgeBtn');
    if (testCfPurgeBtn) {
      testCfPurgeBtn.addEventListener('click', purgeCloudflareCache);
    }

    // 跳转按钮（data-jump）
    document.addEventListener('click', function (e) {
      var jumpBtn = e.target.closest('[data-jump]');
      if (jumpBtn) {
        var target = jumpBtn.getAttribute('data-jump');
        showPage(target, null);
      }
    });

    // 文章表格操作（事件委托）
    var tbody = document.getElementById('postsTableBody');
    if (tbody) {
      tbody.addEventListener('click', function (e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        var id = btn.getAttribute('data-id');
        if (btn.classList.contains('btn-edit')) {
          showPage('editor', id);
        } else if (btn.classList.contains('btn-delete')) {
          var title = btn.getAttribute('data-title') || '';
          openDeleteModal(id, title);
        } else if (btn.classList.contains('btn-post-view')) {
          var published = btn.getAttribute('data-published') === '1';
          if (published) {
            window.open('/post.html?id=' + encodeURIComponent(id), '_blank');
          } else {
            showPage('editor', id);
          }
        } else if (btn.classList.contains('btn-post-pin')) {
          togglePostPin(id, true);
        } else if (btn.classList.contains('btn-post-unpin')) {
          togglePostPin(id, false);
        }
      });
      // 复选框点击事件
      tbody.addEventListener('change', function (e) {
        if (e.target.classList.contains('post-checkbox')) {
          updatePostsBulkActionBar();
        }
      });
    }

    // 文章全选
    var selectAllPosts = document.getElementById('selectAllPosts');
    if (selectAllPosts) {
      selectAllPosts.addEventListener('change', toggleSelectAllPosts);
    }

    // 文章搜索
    var postsSearchInput = document.getElementById('postsSearchInput');
    if (postsSearchInput) {
      postsSearchInput.addEventListener('input', doPostSearch);
    }

    // 文章分类筛选
    var postsCategoryFilter = document.getElementById('postsCategoryFilter');
    if (postsCategoryFilter) {
      postsCategoryFilter.addEventListener('change', function () {
        postsCurrentPage = 1;
        loadPosts();
      });
    }

    // 文章状态筛选
    var postsStatusFilter = document.getElementById('postsStatusFilter');
    if (postsStatusFilter) {
      postsStatusFilter.addEventListener('change', function () {
        postsCurrentPage = 1;
        loadPosts();
      });
    }

    // 文章批量操作按钮
    var bulkPublishBtn = document.getElementById('bulkPublishBtn');
    if (bulkPublishBtn) {
      bulkPublishBtn.addEventListener('click', function () { bulkPostAction('publish'); });
    }
    var bulkDraftBtn = document.getElementById('bulkDraftBtn');
    if (bulkDraftBtn) {
      bulkDraftBtn.addEventListener('click', function () { bulkPostAction('draft'); });
    }
    var bulkPinBtn = document.getElementById('bulkPinBtn');
    if (bulkPinBtn) {
      bulkPinBtn.addEventListener('click', function () { bulkPostAction('pin'); });
    }
    var bulkUnpinBtn = document.getElementById('bulkUnpinBtn');
    if (bulkUnpinBtn) {
      bulkUnpinBtn.addEventListener('click', function () { bulkPostAction('unpin'); });
    }
    var bulkDeletePostsBtn = document.getElementById('bulkDeletePostsBtn');
    if (bulkDeletePostsBtn) {
      bulkDeletePostsBtn.addEventListener('click', function () { bulkPostAction('delete'); });
    }

    // 友链表格操作（事件委托）
    var friendsTbody = document.getElementById('friendsTableBody');
    if (friendsTbody) {
      friendsTbody.addEventListener('click', function (e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        var id = btn.getAttribute('data-id');
        if (!id) return;

        if (btn.classList.contains('btn-friend-approve')) {
          updateFriendStatus(id, 'approved');
        } else if (btn.classList.contains('btn-friend-reject')) {
          updateFriendStatus(id, 'rejected');
        } else if (btn.classList.contains('btn-friend-edit')) {
          var friend = cachedFriends.find(function (item) { return String(item.id) === String(id); });
          if (friend) {
            fillFriendForm(friend);
            document.getElementById('page-friends').scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        } else if (btn.classList.contains('btn-friend-delete')) {
          deleteFriend(id);
        }
      });
    }

    // 族谱管理 - 表单提交
    var genealogyForm = document.getElementById('genealogyForm');
    if (genealogyForm) {
      genealogyForm.addEventListener('submit', function (e) {
        e.preventDefault();
        saveGenealogyPerson();
      });
    }

    var resetGenealogyFormBtn = document.getElementById('resetGenealogyForm');
    if (resetGenealogyFormBtn) {
      resetGenealogyFormBtn.addEventListener('click', clearGenealogyForm);
    }

    var refreshGenealogyBtn = document.getElementById('refreshGenealogyBtn');
    if (refreshGenealogyBtn) {
      refreshGenealogyBtn.addEventListener('click', loadGenealogy);
    }

    // 导出族谱JSON
    var exportBtn = document.getElementById('exportGenealogyBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        if (!cachedGenealogy.length) {
          showToast('暂无族谱数据可导出', 'warning');
          return;
        }
        var exportData = {
          type: 'genealogy',
          exportedAt: new Date().toISOString(),
          count: cachedGenealogy.length,
          people: cachedGenealogy.map(function (p) {
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
          })
        };
        var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        var d = new Date();
        var ts = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        a.download = 'genealogy-' + ts + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('已导出 ' + cachedGenealogy.length + ' 条族谱数据', 'success');
      });
    }

    // 导入族谱JSON
    var importBtn = document.getElementById('importGenealogyBtn');
    var importFile = document.getElementById('importGenealogyFile');
    if (importBtn && importFile) {
      importBtn.addEventListener('click', function () {
        importFile.click();
      });
      importFile.addEventListener('change', async function (e) {
        var file = e.target.files[0];
        if (!file) return;
        try {
          var text = await file.text();
          var data = JSON.parse(text);
          var people = Array.isArray(data) ? data : (data.people || []);
          if (!people.length) {
            showToast('文件中没有有效的族谱数据', 'error');
            return;
          }
          if (!confirm('导入将替换当前全部 ' + cachedGenealogy.length + ' 条族谱数据，确定继续？\n\n文件包含 ' + people.length + ' 条数据，导入后不可撤销。')) {
            importFile.value = '';
            return;
          }
          var result = await apiRequest('/api/admin/genealogy/import', 'POST', { people: people });
          showToast(result.message + '（共 ' + result.count + ' 人）', 'success');
          await loadGenealogy();
        } catch (err) {
          showToast('导入失败：' + err.message, 'error');
        }
        importFile.value = '';
      });
    }

    // 族谱简介表单提交
    var genealogyIntroForm = document.getElementById('genealogyIntroForm');
    if (genealogyIntroForm) {
      genealogyIntroForm.addEventListener('submit', function (e) {
        e.preventDefault();
        saveGenealogyIntro();
      });
    }

    // 族谱表格操作（事件委托）
    var genealogyTbody = document.getElementById('genealogyTableBody');
    if (genealogyTbody) {
      genealogyTbody.addEventListener('click', function (e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        var id = btn.getAttribute('data-id');
        if (!id) return;

        if (btn.classList.contains('btn-genealogy-edit')) {
          showEditGenealogyForm(id);
          document.getElementById('page-genealogy').querySelector('.panel:nth-child(2)').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (btn.classList.contains('btn-genealogy-detail')) {
          showGenealogyDetail(id);
        } else if (btn.classList.contains('btn-genealogy-delete')) {
          var name = btn.getAttribute('data-name') || '';
          deleteGenealogyPerson(id, name);
        } else if (btn.classList.contains('btn-genealogy-approve')) {
          reviewGenealogyPerson(id, 'approved');
        } else if (btn.classList.contains('btn-genealogy-reject')) {
          reviewGenealogyPerson(id, 'rejected');
        }
      });
    }

    // 族谱状态筛选
    var genoStatusFilter = document.getElementById('genealogyStatusFilter');
    if (genoStatusFilter) {
      genoStatusFilter.addEventListener('change', function () {
        renderGenealogyTable(cachedGenealogy);
      });
    }

    // 族谱搜索
    var genoSearchInput = document.getElementById('genealogySearchInput');
    if (genoSearchInput) {
      var genoSearchTimer = null;
      genoSearchInput.addEventListener('input', function () {
        clearTimeout(genoSearchTimer);
        genoSearchTimer = setTimeout(function () {
          renderGenealogyTable(cachedGenealogy);
        }, 300);
      });
    }

    // 族谱世代筛选
    var genoGenFilter = document.getElementById('genealogyGenFilter');
    if (genoGenFilter) {
      genoGenFilter.addEventListener('change', function () {
        renderGenealogyTable(cachedGenealogy);
      });
    }

    // 批量删除
    var batchDelBtn = document.getElementById('batchDeleteGenealogyBtn');
    if (batchDelBtn) {
      batchDelBtn.addEventListener('click', batchDeleteGenealogy);
    }

    // 全选/取消全选
    var genoSelectAll = document.getElementById('genealogySelectAll');
    if (genoSelectAll) {
      genoSelectAll.addEventListener('change', function () {
        var checkboxes = document.querySelectorAll('.geno-row-check');
        for (var i = 0; i < checkboxes.length; i++) {
          checkboxes[i].checked = genoSelectAll.checked;
        }
      });
    }

    // 族谱密码管理
    var saveGenoPwdBtn = document.getElementById('saveGenoPwdBtn');
    if (saveGenoPwdBtn) {
      saveGenoPwdBtn.addEventListener('click', saveGenoPassword);
    }
    var generateGenoPwdBtn = document.getElementById('generateGenoPwdBtn');
    if (generateGenoPwdBtn) {
      generateGenoPwdBtn.addEventListener('click', generateGenoPassword);
    }
    var clearGenoPwdBtn = document.getElementById('clearGenoPwdBtn');
    if (clearGenoPwdBtn) {
      clearGenoPwdBtn.addEventListener('click', clearGenoPassword);
    }
    var copyGenoPwdBtn = document.getElementById('copyGenoPwdBtn');
    if (copyGenoPwdBtn) {
      copyGenoPwdBtn.addEventListener('click', copyGenoPassword);
    }
    var refreshGenoPwdBtn = document.getElementById('refreshGenoPwdBtn');
    if (refreshGenoPwdBtn) {
      refreshGenoPwdBtn.addEventListener('click', function () {
        loadGenoPassword();
        loadGenoPwdRequests();
      });
    }
    var refreshGenoPwdReqsBtn = document.getElementById('refreshGenoPwdReqsBtn');
    if (refreshGenoPwdReqsBtn) {
      refreshGenoPwdReqsBtn.addEventListener('click', loadGenoPwdRequests);
    }
    // 密码申请表格操作（事件委托）
    var pwdReqTbody = document.getElementById('genoPwdReqTableBody');
    if (pwdReqTbody) {
      pwdReqTbody.addEventListener('click', function (e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        var id = btn.getAttribute('data-id');
        if (!id) return;
        if (btn.classList.contains('btn-pwd-approve')) {
          reviewGenoPwdRequest(id, 'approved');
        } else if (btn.classList.contains('btn-pwd-reject')) {
          reviewGenoPwdRequest(id, 'rejected');
        } else if (btn.classList.contains('btn-pwd-delete')) {
          deleteGenoPwdRequest(id);
        }
      });
    }

    // 用户管理 - 添加用户按钮
    var addUserBtn = document.getElementById('addUserBtn');
    if (addUserBtn) {
      addUserBtn.addEventListener('click', showAddUserModal);
    }

    // 用户管理 - 搜索
    var userSearchBtn = document.getElementById('userSearchBtn');
    if (userSearchBtn) {
      userSearchBtn.addEventListener('click', function () {
        userSearchKeyword = document.getElementById('userSearchInput').value.trim();
        userPage = 1;
        loadUsers();
      });
    }
    var userSearchInput = document.getElementById('userSearchInput');
    if (userSearchInput) {
      userSearchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          userSearchKeyword = userSearchInput.value.trim();
          userPage = 1;
          loadUsers();
        }
      });
    }

    // 用户表格操作（事件委托）
    var usersTbody = document.getElementById('usersTableBody');
    if (usersTbody) {
      usersTbody.addEventListener('click', function (e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        var id = btn.getAttribute('data-id');
        if (!id) return;

        if (btn.classList.contains('btn-user-edit')) {
          showEditUserModal(id);
        } else if (btn.classList.contains('btn-user-role')) {
          var role = btn.getAttribute('data-role') || 'user';
          toggleUserRole(id, role);
        } else if (btn.classList.contains('btn-user-toggle')) {
          var isDisabled = btn.getAttribute('data-disabled') === '1';
          toggleUserStatus(id, !isDisabled);
        } else if (btn.classList.contains('btn-user-delete')) {
          var username = btn.getAttribute('data-username') || '';
          openDeleteUserModal(id, username);
        }
      });
      usersTbody.addEventListener('change', function (e) {
        if (e.target.classList.contains('user-checkbox')) {
          updateUsersBulkActionBar();
        }
      });
    }

    // 用户全选
    var selectAllUsers = document.getElementById('selectAllUsers');
    if (selectAllUsers) {
      selectAllUsers.addEventListener('change', function () {
        var checkboxes = document.querySelectorAll('.user-checkbox');
        for (var i = 0; i < checkboxes.length; i++) {
          checkboxes[i].checked = selectAllUsers.checked;
        }
        updateUsersBulkActionBar();
      });
    }

    // 用户批量操作
    var bulkEnableUsersBtn = document.getElementById('bulkEnableUsersBtn');
    if (bulkEnableUsersBtn) {
      bulkEnableUsersBtn.addEventListener('click', function () { bulkUserAction('enable'); });
    }
    var bulkDisableUsersBtn = document.getElementById('bulkDisableUsersBtn');
    if (bulkDisableUsersBtn) {
      bulkDisableUsersBtn.addEventListener('click', function () { bulkUserAction('disable'); });
    }
    var bulkDeleteUsersBtn = document.getElementById('bulkDeleteUsersBtn');
    if (bulkDeleteUsersBtn) {
      bulkDeleteUsersBtn.addEventListener('click', function () { bulkUserAction('delete'); });
    }

    // 用户分页（事件委托）
    var usersPagination = document.getElementById('usersPagination');
    if (usersPagination) {
      usersPagination.addEventListener('click', function (e) {
        var btn = e.target.closest('.page-btn');
        if (!btn || btn.disabled) return;
        var page = btn.getAttribute('data-page');
        var totalPages = Math.ceil(userTotal / userPageSize);
        if (page === 'prev') {
          if (userPage > 1) userPage--;
        } else if (page === 'next') {
          if (userPage < totalPages) userPage++;
        } else {
          userPage = parseInt(page) || 1;
        }
        loadUsers();
      });
    }

    // 用户编辑弹窗
    var closeUserModalBtn = document.getElementById('closeUserModal');
    if (closeUserModalBtn) {
      closeUserModalBtn.addEventListener('click', closeUserModal);
    }
    var cancelUserModalBtn = document.getElementById('cancelUserModal');
    if (cancelUserModalBtn) {
      cancelUserModalBtn.addEventListener('click', closeUserModal);
    }
    var saveUserBtn = document.getElementById('saveUserBtn');
    if (saveUserBtn) {
      saveUserBtn.addEventListener('click', saveUser);
    }
    var userModal = document.getElementById('userModal');
    if (userModal) {
      userModal.addEventListener('click', function (e) {
        if (e.target === userModal) closeUserModal();
      });
    }
    var userForm = document.getElementById('userForm');
    if (userForm) {
      userForm.addEventListener('submit', function (e) {
        e.preventDefault();
        saveUser();
      });
    }

    // 删除用户确认弹窗
    var cancelDeleteUserBtn = document.getElementById('cancelDeleteUser');
    if (cancelDeleteUserBtn) {
      cancelDeleteUserBtn.addEventListener('click', closeDeleteUserModal);
    }
    var confirmDeleteUserBtn = document.getElementById('confirmDeleteUser');
    if (confirmDeleteUserBtn) {
      confirmDeleteUserBtn.addEventListener('click', confirmDeleteUser);
    }
    var deleteUserModal = document.getElementById('deleteUserModal');
    if (deleteUserModal) {
      deleteUserModal.addEventListener('click', function (e) {
        if (e.target === deleteUserModal) closeDeleteUserModal();
      });
    }

    // 留言表格操作（事件委托）
    var commentsTbody = document.getElementById('commentsTableBody');
    if (commentsTbody) {
      commentsTbody.addEventListener('click', function (e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        var id = btn.getAttribute('data-id');
        if (!id) return;
        if (btn.classList.contains('btn-comment-approve')) {
          updateCommentStatus(id, 'approved');
        } else if (btn.classList.contains('btn-comment-pending')) {
          updateCommentStatus(id, 'pending');
        } else if (btn.classList.contains('btn-comment-reject')) {
          updateCommentStatus(id, 'rejected');
        } else if (btn.classList.contains('btn-comment-delete')) {
          deleteComment(id);
        } else if (btn.classList.contains('btn-comment-reply')) {
          // 获取现有回复内容
          var row = btn.closest('tr');
          var replyContent = '';
          var replyEl = row.querySelector('.comment-reply-content');
          if (replyEl) replyContent = replyEl.textContent || '';
          openReplyModal(id, replyContent);
        } else if (btn.classList.contains('btn-reply-delete')) {
          deleteReply(id);
        }
      });
      // 复选框点击事件
      commentsTbody.addEventListener('change', function (e) {
        if (e.target.classList.contains('comment-checkbox')) {
          updateCommentsBulkActionBar();
        }
      });
    }

    // 留言全选
    var selectAllComments = document.getElementById('selectAllComments');
    if (selectAllComments) {
      selectAllComments.addEventListener('change', toggleSelectAllComments);
    }

    // 留言批量操作按钮
    var bulkApproveCommentsBtn = document.getElementById('bulkApproveCommentsBtn');
    if (bulkApproveCommentsBtn) {
      bulkApproveCommentsBtn.addEventListener('click', function () { bulkCommentAction('approve'); });
    }
    var bulkRejectCommentsBtn = document.getElementById('bulkRejectCommentsBtn');
    if (bulkRejectCommentsBtn) {
      bulkRejectCommentsBtn.addEventListener('click', function () { bulkCommentAction('reject'); });
    }
    var bulkPendingCommentsBtn = document.getElementById('bulkPendingCommentsBtn');
    if (bulkPendingCommentsBtn) {
      bulkPendingCommentsBtn.addEventListener('click', function () { bulkCommentAction('pending'); });
    }
    var bulkDeleteCommentsBtn = document.getElementById('bulkDeleteCommentsBtn');
    if (bulkDeleteCommentsBtn) {
      bulkDeleteCommentsBtn.addEventListener('click', function () { bulkCommentAction('delete'); });
    }

    // 投稿审核表格操作（事件委托）
    var submissionsTbody = document.getElementById('submissionsTableBody');
    if (submissionsTbody) {
      submissionsTbody.addEventListener('click', function (e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        var id = btn.getAttribute('data-id');
        if (!id) return;
        if (btn.classList.contains('btn-submission-approve')) {
          updateSubmissionStatus(id, 'approved');
        } else if (btn.classList.contains('btn-submission-reject')) {
          updateSubmissionStatus(id, 'rejected');
        } else if (btn.classList.contains('btn-submission-view')) {
          window.open('/post.html?id=' + encodeURIComponent(id), '_blank');
        } else if (btn.classList.contains('btn-submission-preview')) {
          var subItem = cachedSubmissions.find(function (s) { return String(s.id) === String(id); });
          if (subItem) {
            showSubmissionPreview(subItem);
          } else {
            showToast('无法加载投稿内容', 'error');
          }
        }
      });
    }

    // 分类表格操作（事件委托）
    var categoriesTbody = document.getElementById('categoriesTableBody');
    if (categoriesTbody) {
      categoriesTbody.addEventListener('click', function (e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        var name = btn.getAttribute('data-name') || '';
        if (!name) return;
        if (btn.classList.contains('btn-category-edit')) {
          editCategory(name);
        } else if (btn.classList.contains('btn-category-delete')) {
          deleteCategory(name, btn.getAttribute('data-count') || 0);
        }
      });
    }

    // 删除弹窗
    var cancelBtn = document.getElementById('cancelDelete');
    if (cancelBtn) cancelBtn.addEventListener('click', closeDeleteModal);

    var confirmBtn = document.getElementById('confirmDelete');
    if (confirmBtn) confirmBtn.addEventListener('click', confirmDelete);

    var deleteModal = document.getElementById('deleteModal');
    if (deleteModal) {
      deleteModal.addEventListener('click', function (e) {
        if (e.target === deleteModal) closeDeleteModal();
      });
    }

    // 回复弹窗
    var cancelReplyBtn = document.getElementById('cancelReply');
    if (cancelReplyBtn) cancelReplyBtn.addEventListener('click', closeReplyModal);

    var confirmReplyBtn = document.getElementById('confirmReply');
    if (confirmReplyBtn) confirmReplyBtn.addEventListener('click', submitReply);

    var replyModal = document.getElementById('replyModal');
    if (replyModal) {
      replyModal.addEventListener('click', function (e) {
        if (e.target === replyModal) closeReplyModal();
      });
    }

    // 媒体库
    var refreshMediaBtn = document.getElementById('refreshMediaBtn');
    if (refreshMediaBtn) {
      refreshMediaBtn.addEventListener('click', loadMediaLibrary);
    }

    var uploadMediaBtn = document.getElementById('uploadMediaBtn');
    var mediaUploadInput = document.getElementById('mediaUploadInput');
    if (uploadMediaBtn && mediaUploadInput) {
      uploadMediaBtn.addEventListener('click', function () {
        mediaUploadInput.click();
      });
      mediaUploadInput.addEventListener('change', function () {
        var file = mediaUploadInput.files && mediaUploadInput.files[0];
        if (file) {
          uploadMediaFile(file);
          mediaUploadInput.value = '';
        }
      });
    }

    var mediaFolderFilter = document.getElementById('mediaFolderFilter');
    if (mediaFolderFilter) {
      mediaFolderFilter.addEventListener('change', loadMediaLibrary);
    }

    var mediaGrid = document.getElementById('mediaGrid');
    if (mediaGrid) {
      mediaGrid.addEventListener('click', function (e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        var path = btn.getAttribute('data-path') || '';
        if (!path) return;
        if (btn.classList.contains('btn-media-copy')) {
          copyMediaLink(path);
        } else if (btn.classList.contains('btn-media-delete')) {
          deleteMedia(path);
        }
      });
    }

    // 数据导出
    var exportDataBtn = document.getElementById('exportDataBtn');
    if (exportDataBtn) {
      exportDataBtn.addEventListener('click', exportData);
    }

    // 广告管理
    var createAdBtn = document.getElementById('createAdBtn');
    if (createAdBtn) {
      createAdBtn.addEventListener('click', function () { openAdModal(null); });
    }
    var refreshAdsBtn = document.getElementById('refreshAdsBtn');
    if (refreshAdsBtn) {
      refreshAdsBtn.addEventListener('click', loadAds);
    }
    var adModalClose = document.getElementById('adModalClose');
    if (adModalClose) {
      adModalClose.addEventListener('click', closeAdModal);
    }
    var adCancelBtn = document.getElementById('adCancelBtn');
    if (adCancelBtn) {
      adCancelBtn.addEventListener('click', closeAdModal);
    }
    var adSaveBtn = document.getElementById('adSaveBtn');
    if (adSaveBtn) {
      adSaveBtn.addEventListener('click', saveAd);
    }
    var adTypeSelect = document.getElementById('adType');
    if (adTypeSelect) {
      adTypeSelect.addEventListener('change', toggleAdFormFields);
    }
    var adEditModal = document.getElementById('adEditModal');
    if (adEditModal) {
      adEditModal.addEventListener('click', function (e) {
        if (e.target === adEditModal) closeAdModal();
      });
    }
    var adsTableBody = document.getElementById('adsTableBody');
    if (adsTableBody) {
      adsTableBody.addEventListener('click', function (e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        var id = btn.getAttribute('data-id');
        if (!id) return;
        if (btn.classList.contains('btn-edit-ad')) {
          apiRequest('/api/admin/ads', 'GET').then(function (ads) {
            var ad = (ads || []).find(function (a) { return a.id === id; });
            if (ad) openAdModal(ad);
          }).catch(function () { showToast('获取广告信息失败'); });
        } else if (btn.classList.contains('btn-toggle-ad')) {
          var active = btn.getAttribute('data-active') === 'true';
          toggleAd(id, active);
        } else if (btn.classList.contains('btn-delete-ad')) {
          deleteAd(id);
        }
      });
    }

    // 表单提交
    var postForm = document.getElementById('postForm');
    if (postForm) {
      postForm.addEventListener('submit', savePost);
    }

    var articleImageInput = document.getElementById('articleImageInput');
    if (articleImageInput) {
      articleImageInput.addEventListener('change', function () {
        var file = articleImageInput.files && articleImageInput.files[0];
        uploadArticleImage(file);
        articleImageInput.value = '';
      });
    }

    var categoryForm = document.getElementById('categoryForm');
    if (categoryForm) {
      categoryForm.addEventListener('submit', saveCategory);
    }

    var resetCategoryBtn = document.getElementById('resetCategoryForm');
    if (resetCategoryBtn) {
      resetCategoryBtn.addEventListener('click', clearCategoryForm);
    }

    var refreshCategoriesBtn = document.getElementById('refreshCategoriesBtn');
    if (refreshCategoriesBtn) {
      refreshCategoriesBtn.addEventListener('click', loadCategoriesAdmin);
    }

    // 标签表单提交
    var tagForm = document.getElementById('tagForm');
    if (tagForm) {
      tagForm.addEventListener('submit', saveTag);
    }

    var resetTagBtn = document.getElementById('resetTagForm');
    if (resetTagBtn) {
      resetTagBtn.addEventListener('click', clearTagForm);
    }

    var refreshTagsBtn = document.getElementById('refreshTagsBtn');
    if (refreshTagsBtn) {
      refreshTagsBtn.addEventListener('click', loadTagsAdmin);
    }

    // 标签表格操作（事件委托）
    var tagsTbody = document.getElementById('tagsTableBody');
    if (tagsTbody) {
      tagsTbody.addEventListener('click', function (e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        var name = btn.getAttribute('data-name') || '';
        if (!name) return;
        if (btn.classList.contains('btn-tag-edit')) {
          editTag(name);
        } else if (btn.classList.contains('btn-tag-delete')) {
          deleteTag(name);
        }
      });
    }

    // 友链表单提交
    var friendForm = document.getElementById('friendForm');
    if (friendForm) {
      friendForm.addEventListener('submit', saveFriend);
    }

    var resetFriendBtn = document.getElementById('resetFriendForm');
    if (resetFriendBtn) {
      resetFriendBtn.addEventListener('click', clearFriendForm);
    }

    var refreshFriendsBtn = document.getElementById('refreshFriendsBtn');
    if (refreshFriendsBtn) {
      refreshFriendsBtn.addEventListener('click', loadFriends);
    }

    var commentSettingsForm = document.getElementById('commentSettingsForm');
    if (commentSettingsForm) {
      commentSettingsForm.addEventListener('submit', saveCommentSettings);
    }

    var refreshCommentsBtn = document.getElementById('refreshCommentsBtn');
    if (refreshCommentsBtn) {
      refreshCommentsBtn.addEventListener('click', loadComments);
    }

    var commentStatusFilter = document.getElementById('commentStatusFilter');
    if (commentStatusFilter) {
      commentStatusFilter.addEventListener('change', loadComments);
    }

    var commentTargetFilter = document.getElementById('commentTargetFilter');
    if (commentTargetFilter) {
      commentTargetFilter.addEventListener('change', loadComments);
    }

    var refreshSubmissionsBtn = document.getElementById('refreshSubmissionsBtn');
    if (refreshSubmissionsBtn) {
      refreshSubmissionsBtn.addEventListener('click', loadSubmissions);
    }

    var submissionStatusFilter = document.getElementById('submissionStatusFilter');
    if (submissionStatusFilter) {
      submissionStatusFilter.addEventListener('change', loadSubmissions);
    }

    var friendAvatarInput = document.getElementById('friendAvatar');
    if (friendAvatarInput) {
      friendAvatarInput.addEventListener('change', function () {
        var file = friendAvatarInput.files && friendAvatarInput.files[0];
        if (file && file.size > 1024 * 1024) {
          friendAvatarInput.value = '';
          showToast('头像图片不能大于 1MB');
        }
      });
    }

    var siteSettingsForm = document.getElementById('siteSettingsForm');
    if (siteSettingsForm) {
      siteSettingsForm.addEventListener('submit', saveSiteSettings);
    }

    var aboutSettingsForm = document.getElementById('aboutSettingsForm');
    if (aboutSettingsForm) {
      aboutSettingsForm.addEventListener('submit', saveAboutSettings);
    }

    var contactSettingsForm = document.getElementById('contactSettingsForm');
    if (contactSettingsForm) {
      contactSettingsForm.addEventListener('submit', saveContactSettings);
    }

    var sponsorSettingsForm = document.getElementById('sponsorSettingsForm');
    if (sponsorSettingsForm) {
      sponsorSettingsForm.addEventListener('submit', saveSponsorSettings);
    }

    // 赞助二维码图片上传（微信 / 支付宝）
    var sponsorWechatQrFile = document.getElementById('sponsorWechatQrFile');
    if (sponsorWechatQrFile) {
      sponsorWechatQrFile.addEventListener('change', function () {
        var file = sponsorWechatQrFile.files && sponsorWechatQrFile.files[0];
        if (file) {
          uploadSponsorQr(file, 'sponsorWechatQrInput');
          sponsorWechatQrFile.value = '';
        }
      });
    }
    var sponsorAlipayQrFile = document.getElementById('sponsorAlipayQrFile');
    if (sponsorAlipayQrFile) {
      sponsorAlipayQrFile.addEventListener('change', function () {
        var file = sponsorAlipayQrFile.files && sponsorAlipayQrFile.files[0];
        if (file) {
          uploadSponsorQr(file, 'sponsorAlipayQrInput');
          sponsorAlipayQrFile.value = '';
        }
      });
    }
    var sponsorThirdQrFile = document.getElementById('sponsorThirdQrFile');
    if (sponsorThirdQrFile) {
      sponsorThirdQrFile.addEventListener('change', function () {
        var file = sponsorThirdQrFile.files && sponsorThirdQrFile.files[0];
        if (file) {
          uploadSponsorQr(file, 'sponsorThirdQrInput');
          sponsorThirdQrFile.value = '';
        }
      });
    }

    var siteLogoInput = document.getElementById('siteLogoInput');
    if (siteLogoInput) {
      siteLogoInput.addEventListener('change', function () {
        var file = siteLogoInput.files && siteLogoInput.files[0];
        if (file && file.size > 1024 * 1024) {
          siteLogoInput.value = '';
          showToast('网站 Logo 不能大于 1MB');
        }
      });
    }

    // 封面图上传
    var postCoverInput = document.getElementById('postCoverInput');
    if (postCoverInput) {
      postCoverInput.addEventListener('change', function () {
        var file = postCoverInput.files && postCoverInput.files[0];
        if (file) {
          uploadCoverImage(file);
          postCoverInput.value = '';
        }
      });
    }

    // 默认封面图上传（站点设置）
    var defaultCoverInput = document.getElementById('defaultCoverInput');
    if (defaultCoverInput) {
      defaultCoverInput.addEventListener('change', function () {
        var file = defaultCoverInput.files && defaultCoverInput.files[0];
        if (file) {
          uploadDefaultCover(file);
          defaultCoverInput.value = '';
        }
      });
    }
    // 默认封面 URL 输入实时预览
    var defaultCoverUrlInput = document.getElementById('defaultCoverUrl');
    if (defaultCoverUrlInput) {
      var defCoverDebounce = null;
      defaultCoverUrlInput.addEventListener('input', function () {
        if (defCoverDebounce) clearTimeout(defCoverDebounce);
        defCoverDebounce = setTimeout(function () {
          renderDefaultCoverPreview(defaultCoverUrlInput.value.trim());
        }, 300);
      });
    }

    // 封面 URL 输入实时预览
    var postCoverUrlInput = document.getElementById('postCoverUrl');
    if (postCoverUrlInput) {
      var coverDebounce = null;
      postCoverUrlInput.addEventListener('input', function () {
        if (coverDebounce) clearTimeout(coverDebounce);
        coverDebounce = setTimeout(function () {
          renderCoverPreview(postCoverUrlInput.value.trim());
        }, 300);
      });
    }

    // 导航菜单管理
    var addNavLinkBtn = document.getElementById('addNavLinkBtn');
    if (addNavLinkBtn) {
      addNavLinkBtn.addEventListener('click', addNavLinkRow);
    }

    var saveNavLinksBtn = document.getElementById('saveNavLinksBtn');
    if (saveNavLinksBtn) {
      saveNavLinksBtn.addEventListener('click', saveNavLinks);
    }

    // 导航项删除（事件委托）
    var navLinksContainer = document.getElementById('navLinksContainer');
    if (navLinksContainer) {
      navLinksContainer.addEventListener('click', function (e) {
        var btn = e.target.closest('.nav-link-remove');
        if (!btn) return;
        var row = btn.closest('.nav-link-row');
        if (row) row.remove();
      });
    }

    // 发布开关
    var publishCheckbox = document.getElementById('postPublished');
    if (publishCheckbox) {
      publishCheckbox.addEventListener('change', updatePublishLabel);
    }

    // 移动端菜单
    var menuToggle = document.getElementById('menuToggle');
    if (menuToggle) {
      menuToggle.addEventListener('click', openSidebar);
    }
    var mask = document.getElementById('sidebarMask');
    if (mask) {
      mask.addEventListener('click', closeSidebar);
    }

    // ESC 关闭弹窗
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeDeleteModal();
        closeSubmissionPreview();
        closeSidebar();
      }
    });

    // 投稿预览弹窗
    var closeSubPreviewBtn = document.getElementById('closeSubmissionPreview');
    if (closeSubPreviewBtn) {
      closeSubPreviewBtn.addEventListener('click', closeSubmissionPreview);
    }
    var subPreviewModal = document.getElementById('submissionPreviewModal');
    if (subPreviewModal) {
      subPreviewModal.addEventListener('click', function (e) {
        if (e.target === subPreviewModal) closeSubmissionPreview();
      });
    }
    var previewApproveBtn = document.getElementById('previewApproveBtn');
    if (previewApproveBtn) {
      previewApproveBtn.addEventListener('click', function () {
        if (currentPreviewSubmissionId) {
          updateSubmissionStatus(currentPreviewSubmissionId, 'approved');
          closeSubmissionPreview();
        }
      });
    }
    var previewRejectBtn = document.getElementById('previewRejectBtn');
    if (previewRejectBtn) {
      previewRejectBtn.addEventListener('click', function () {
        if (currentPreviewSubmissionId) {
          updateSubmissionStatus(currentPreviewSubmissionId, 'rejected');
          closeSubmissionPreview();
        }
      });
    }
  }

  /**
   * 更新顶栏用户信息
   */
  function updateUserInfo() {
    var username = localStorage.getItem('username') || 'Admin';
    var usernameDisplay = document.getElementById('usernameDisplay');
    if (usernameDisplay) usernameDisplay.textContent = username;
    var userAvatar = document.getElementById('userAvatar');
    if (userAvatar) userAvatar.textContent = (username.charAt(0) || 'A').toUpperCase();
  }

  /* -------------------- Cloudflare 缓存管理 -------------------- */

  // 加载 Cloudflare 配置
  async function loadCloudflareConfig() {
    var statusEl = document.getElementById('cfConfigStatus');
    var tokenInput = document.getElementById('cfApiToken');
    var zoneInput = document.getElementById('cfZoneId');
    if (!tokenInput || !zoneInput) return;
    try {
      var data = await apiRequest('/api/admin/cloudflare/config', 'GET');
      if (data.apiToken) tokenInput.value = data.apiToken;
      if (data.zoneId) zoneInput.value = data.zoneId;
      if (statusEl) {
        if (data.configured) {
          statusEl.textContent = '已配置';
          statusEl.style.cssText = 'font-size:12px;padding:4px 10px;border-radius:4px;background:#e8f8f0;color:#07C160;';
        } else {
          statusEl.textContent = '未配置';
          statusEl.style.cssText = 'font-size:12px;padding:4px 10px;border-radius:4px;background:#fff1f0;color:#f5222d;';
        }
      }
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = '加载失败';
        statusEl.style.cssText = 'font-size:12px;padding:4px 10px;border-radius:4px;background:#fff1f0;color:#f5222d;';
      }
    }
  }

  // 保存 Cloudflare 配置
  async function saveCloudflareConfig() {
    var tokenInput = document.getElementById('cfApiToken');
    var zoneInput = document.getElementById('cfZoneId');
    var btn = document.getElementById('saveCfConfigBtn');
    if (!tokenInput || !zoneInput) return;
    var apiToken = tokenInput.value.trim();
    var zoneId = zoneInput.value.trim();
    if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }
    try {
      var res = await apiRequest('/api/admin/cloudflare/config', 'POST', { apiToken: apiToken, zoneId: zoneId });
      showToast(res.message || '配置已保存');
      loadCloudflareConfig();
    } catch (err) {
      showToast(err.message || '保存失败');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '保存配置'; }
    }
  }

  // 一键清除全部缓存（本地 + Cloudflare）
  async function purgeAllCache() {
    if (!confirm('确定要一键清除全部缓存吗？\n将同时清除本地服务器缓存和 Cloudflare 边缘缓存。')) return;
    var btn = document.getElementById('purgeAllCacheBtn');
    var resultEl = document.getElementById('purgeAllResult');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span style="font-size:18px;">⏳</span> 正在清除...'; }
    if (resultEl) { resultEl.innerHTML = '<p style="color:var(--text-secondary);">正在清除缓存，请稍候...</p>'; }
    try {
      var res = await apiRequest('/api/admin/cache/purge-all', 'POST', {});
      if (resultEl) {
        var color = res.cloudflare === 'success' ? '#07C160' : '#fa8c16';
        resultEl.innerHTML = '<div style="padding:12px 16px;border-radius:8px;background:var(--bg-alt);border:1px solid var(--border-color);">' +
          '<p style="color:' + color + ';font-weight:600;margin-bottom:4px;">' + escapeHtml(res.message || '缓存已清除') + '</p>' +
          '<p style="color:var(--text-secondary);font-size:13px;">本地缓存：' + (res.localCleared || 0) + ' 条 | Cloudflare：' +
          (res.cloudflare === 'success' ? '已清除' : res.cloudflare === 'not_configured' ? '未配置' : '清除失败') + '</p>' +
          '</div>';
      }
      showToast(res.message || '缓存已清除');
      loadCacheStats();
    } catch (err) {
      if (resultEl) {
        resultEl.innerHTML = '<p style="color:var(--danger);">' + escapeHtml(err.message || '清除失败') + '</p>';
      }
      showToast(err.message || '清除失败');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<span style="font-size:18px;">⚡</span> 一键清除全部缓存'; }
    }
  }

  // 单独清除 Cloudflare 缓存（测试用）
  async function purgeCloudflareCache() {
    if (!confirm('确定要清除 Cloudflare 边缘缓存吗？')) return;
    var btn = document.getElementById('testCfPurgeBtn');
    if (btn) { btn.disabled = true; btn.textContent = '清除中...'; }
    try {
      var res = await apiRequest('/api/admin/cloudflare/purge', 'POST', { purgeEverything: true });
      showToast(res.message || 'Cloudflare 缓存已清除');
      loadCacheStats();
    } catch (err) {
      showToast(err.message || 'Cloudflare 缓存清除失败');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '测试清除 Cloudflare 缓存'; }
    }
  }

  /* -------------------- 本地缓存管理 -------------------- */

  async function loadCacheStats() {
    var grid = document.getElementById('cacheStatsGrid');
    var entries = document.getElementById('cacheEntries');
    if (grid) {
      grid.innerHTML = '<div class="loading"><div class="spinner"></div><br>加载中...</div>';
    }
    if (entries) {
      entries.innerHTML = '<p style="color:var(--text-secondary);">加载中...</p>';
    }
    try {
      var stats = await apiRequest('/api/admin/cache/stats', 'GET');
      renderCacheStats(stats || {});
    } catch (err) {
      if (grid) {
        grid.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>缓存数据加载失败</p></div>';
      }
      if (entries) {
        entries.innerHTML = '<p style="color:var(--danger);">' + escapeHtml(err.message || '加载失败') + '</p>';
      }
    }
  }

  function renderCacheStats(stats) {
    var grid = document.getElementById('cacheStatsGrid');
    if (grid) {
      var cards = [
        { label: '总缓存数', value: stats.total || 0 },
        { label: '活跃缓存', value: stats.active || 0 },
        { label: '已过期', value: stats.expired || 0 }
      ];
      grid.innerHTML = cards.map(function (c) {
        return '<div class="cache-stat-card">' +
          '<div class="stat-value">' + c.value + '</div>' +
          '<div class="stat-label">' + escapeHtml(c.label) + '</div>' +
        '</div>';
      }).join('');
    }

    var entries = document.getElementById('cacheEntries');
    if (entries) {
      var list = stats.entries || [];
      if (!list.length) {
        entries.innerHTML = '<p style="color:var(--text-secondary);">当前没有任何缓存条目</p>';
      } else {
        entries.innerHTML = list.map(function (entry) {
          var ttlSec = Math.round((entry.expireIn || 0) / 1000);
          return '<div class="cache-entry-item">' +
            '<span class="cache-key">' + escapeHtml(entry.key) + '</span>' +
            '<span class="cache-ttl">' + ttlSec + 's</span>' +
          '</div>';
        }).join('');
      }
    }
  }

  async function clearCache(scope) {
    if (!confirm(scope === 'all' ? '确定要清除全部缓存吗？' : '确定要清除该分类缓存吗？')) return;
    try {
      var body = { scope: scope || 'all' };
      var res = await apiRequest('/api/admin/cache/clear', 'POST', body);
      showToast(res.message || '缓存已清除（清除 ' + (res.cleared || 0) + ' 条）');
      loadCacheStats();
    } catch (err) {
      showToast(err.message || '清除失败');
    }
  }

  /* ---------- 媒体库 ---------- */

  function formatFileSize(bytes) {
    if (!bytes || bytes < 1024) return (bytes || 0) + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  async function loadMediaLibrary() {
    var grid = document.getElementById('mediaGrid');
    if (grid) {
      grid.innerHTML = '<div class="loading"><div class="spinner"></div><br>加载中...</div>';
    }
    var folder = document.getElementById('mediaFolderFilter')?.value || '';
    var query = folder ? '?folder=' + encodeURIComponent(folder) : '';
    try {
      var data = await apiRequest('/api/admin/media' + query, 'GET');
      renderMediaGrid(data.files || []);
    } catch (err) {
      if (grid) {
        grid.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>' + escapeHtml(err.message) + '</p></div>';
      }
    }
  }

  function renderMediaGrid(files) {
    var grid = document.getElementById('mediaGrid');
    if (!grid) return;
    if (!files.length) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🖼️</div><p>暂无文件</p></div>';
      return;
    }
    grid.innerHTML = files.map(function (file) {
      var isImage = file.type && file.type.startsWith('image/');
      var thumbHtml = isImage
        ? '<img src="' + escapeHtml(file.path) + '" alt="' + escapeHtml(file.name) + '" loading="lazy">'
        : '<div class="media-placeholder">📄</div>';
      return (
        '<div class="media-item">' +
          '<div class="media-thumb">' + thumbHtml + '</div>' +
          '<div class="media-info">' +
            '<div class="media-name" title="' + escapeHtml(file.name) + '">' + escapeHtml(file.name) + '</div>' +
            '<div class="media-meta">' + formatFileSize(file.size) + ' · ' + formatDate(file.createdAt) + '</div>' +
          '</div>' +
          '<div class="media-actions">' +
            '<button class="btn btn-sm btn-ghost btn-media-copy" data-path="' + escapeHtml(file.path) + '">复制链接</button>' +
            '<button class="btn btn-sm btn-danger btn-media-delete" data-path="' + escapeHtml(file.path) + '">删除</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function copyMediaLink(path) {
    var url = window.location.origin + path;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        showToast('链接已复制到剪贴板');
      }, function () {
        showToast('复制失败，请手动复制');
      });
    } else {
      var input = document.createElement('textarea');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      try {
        document.execCommand('copy');
        showToast('链接已复制到剪贴板');
      } catch (e) {
        showToast('复制失败，请手动复制');
      }
      document.body.removeChild(input);
    }
  }

  async function deleteMedia(path) {
    if (!confirm('确定要删除这个文件吗？此操作不可恢复。')) return;
    try {
      await apiRequest('/api/admin/media', 'DELETE', { path: path });
      showToast('删除成功');
      loadMediaLibrary();
    } catch (err) {
      showToast(err.message || '删除失败');
    }
  }

  async function uploadMediaFile(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('文件大小不能超过 5MB');
      return;
    }
    var progress = document.getElementById('mediaUploadProgress');
    if (progress) progress.style.display = 'block';
    try {
      var formData = new FormData();
      formData.append('image', file);
      var result = await apiFormRequest('/api/admin/uploads/images', 'POST', formData);
      showToast('上传成功');
      loadMediaLibrary();
    } catch (err) {
      showToast(err.message || '上传失败');
    } finally {
      if (progress) progress.style.display = 'none';
    }
  }

  /* ---------- 广告管理 ---------- */

  var adPositionLabels = {
    'home_top': '首页顶部横幅',
    'home_bottom': '首页底部横幅',
    'home_sidebar': '首页侧边栏',
    'post_top': '文章页顶部',
    'post_bottom': '文章页底部',
    'genealogy_top': '族谱页顶部',
    'friends_top': '友链页顶部',
    'about_top': '关于页顶部',
    'float': '浮动小图（全站漂浮）',
    'all': '全站通投'
  };

  var adTypeLabels = {
    'image': '图片广告',
    'html': 'HTML代码',
    'text': '文字广告'
  };

  var adFormatLabels = {
    'banner': '横幅',
    'rectangle': '矩形'
  };

  async function loadAds() {
    var tbody = document.getElementById('adsTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-tertiary);">加载中...</td></tr>';
    try {
      var ads = await apiRequest('/api/admin/ads', 'GET');
      renderAdsTable(ads || []);
      renderAdsStats(ads || []);
    } catch (err) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--danger);">' + (err.message || '加载失败') + '</td></tr>';
    }
  }

  function renderAdsStats(ads) {
    var total = ads.length;
    var active = ads.filter(function (a) { return a.active; }).length;
    var inactive = total - active;
    var totalClicks = ads.reduce(function (sum, a) { return sum + Number(a.clicks || 0); }, 0);
    var el;
    if ((el = document.getElementById('adsTotalCount'))) el.textContent = total;
    if ((el = document.getElementById('adsActiveCount'))) el.textContent = active;
    if ((el = document.getElementById('adsInactiveCount'))) el.textContent = inactive;
    if ((el = document.getElementById('adsTotalClicks'))) el.textContent = totalClicks;
  }

  function renderAdsTable(ads) {
    var tbody = document.getElementById('adsTableBody');
    if (!tbody) return;
    if (!ads.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-tertiary);">暂无广告，点击"新建广告"添加</td></tr>';
      return;
    }
    tbody.innerHTML = ads.map(function (ad) {
      var posLabel = adPositionLabels[ad.position] || ad.position;
      var typeLabel = adTypeLabels[ad.type] || ad.type;
      var formatLabel = adFormatLabels[ad.format] || ad.format || '横幅';
      var statusBadge = ad.active
        ? '<span class="badge badge-success">启用</span>'
        : '<span class="badge badge-secondary">停用</span>';
      var created = ad.createdAt ? new Date(ad.createdAt).toLocaleString('zh-CN') : '-';
      var titleDisplay = ad.title || '(未命名)';
      return '<tr>'
        + '<td>' + escapeHtml(titleDisplay) + '</td>'
        + '<td>' + escapeHtml(posLabel) + '</td>'
        + '<td>' + escapeHtml(typeLabel) + '</td>'
        + '<td>' + escapeHtml(formatLabel) + '</td>'
        + '<td>' + statusBadge + '</td>'
        + '<td>' + Number(ad.clicks || 0) + '</td>'
        + '<td style="font-size:12px;color:var(--text-tertiary);">' + escapeHtml(created) + '</td>'
        + '<td>'
        + '<div style="display:flex;gap:4px;">'
        + '<button class="btn btn-sm btn-ghost btn-edit-ad" data-id="' + escapeHtml(ad.id) + '" title="编辑">✏️</button>'
        + '<button class="btn btn-sm btn-ghost btn-toggle-ad" data-id="' + escapeHtml(ad.id) + '" data-active="' + ad.active + '" title="' + (ad.active ? '停用' : '启用') + '">' + (ad.active ? '⏸️' : '▶️') + '</button>'
        + '<button class="btn btn-sm btn-ghost btn-delete-ad" data-id="' + escapeHtml(ad.id) + '" title="删除">🗑️</button>'
        + '</div>'
        + '</td>'
        + '</tr>';
    }).join('');
  }

  function openAdModal(ad) {
    var modal = document.getElementById('adEditModal');
    if (!modal) return;
    var titleEl = document.getElementById('adModalTitle');
    if (titleEl) titleEl.textContent = ad ? '编辑广告' : '新建广告';

    document.getElementById('adEditId').value = ad ? ad.id : '';
    document.getElementById('adTitle').value = ad ? (ad.title || '') : '';
    document.getElementById('adPosition').value = ad ? ad.position : 'home_top';
    document.getElementById('adType').value = ad ? ad.type : 'image';
    document.getElementById('adFormat').value = ad ? (ad.format || 'banner') : 'banner';
    document.getElementById('adActive').value = ad ? String(ad.active) : 'true';
    document.getElementById('adStaySeconds').value = ad && ad.staySeconds ? ad.staySeconds : '';
    document.getElementById('adImageUrl').value = ad ? (ad.imageUrl || '') : '';
    document.getElementById('adImgWidth').value = ad && ad.imgWidth ? ad.imgWidth : '';
    document.getElementById('adImgHeight').value = ad && ad.imgHeight ? ad.imgHeight : '';
    document.getElementById('adLink').value = ad ? (ad.link || '') : '';
    document.getElementById('adContent').value = ad ? (ad.content || '') : '';
    document.getElementById('adTextContent').value = ad && ad.type === 'text' ? (ad.content || '') : '';

    toggleAdFormFields();
    modal.style.display = 'flex';
  }

  function closeAdModal() {
    var modal = document.getElementById('adEditModal');
    if (modal) modal.style.display = 'none';
  }

  function toggleAdFormFields() {
    var type = document.getElementById('adType').value;
    var imageGroup = document.getElementById('adImageGroup');
    var linkGroup = document.getElementById('adLinkGroup');
    var contentGroup = document.getElementById('adContentGroup');
    var textGroup = document.getElementById('adTextGroup');
    if (imageGroup) imageGroup.style.display = type === 'image' ? '' : 'none';
    if (linkGroup) linkGroup.style.display = type === 'image' || type === 'text' ? '' : 'none';
    if (contentGroup) contentGroup.style.display = type === 'html' ? '' : 'none';
    if (textGroup) textGroup.style.display = type === 'text' ? '' : 'none';
  }

  async function saveAd() {
    var id = document.getElementById('adEditId').value;
    var data = {
      title: document.getElementById('adTitle').value.trim(),
      position: document.getElementById('adPosition').value,
      type: document.getElementById('adType').value,
      format: document.getElementById('adFormat').value,
      active: document.getElementById('adActive').value === 'true',
      staySeconds: document.getElementById('adStaySeconds').value.trim(),
      imageUrl: document.getElementById('adImageUrl').value.trim(),
      imgWidth: document.getElementById('adImgWidth').value.trim(),
      imgHeight: document.getElementById('adImgHeight').value.trim(),
      link: document.getElementById('adLink').value.trim()
    };

    var type = data.type;
    if (type === 'html') {
      data.content = document.getElementById('adContent').value.trim();
    } else if (type === 'text') {
      data.content = document.getElementById('adTextContent').value.trim();
    }

    if (!data.position || !data.type) {
      showToast('广告位置和类型必填');
      return;
    }

    var btn = document.getElementById('adSaveBtn');
    if (btn) btn.disabled = true;
    try {
      if (id) {
        await apiRequest('/api/admin/ads/' + encodeURIComponent(id), 'PUT', data);
        showToast('广告更新成功');
      } else {
        await apiRequest('/api/admin/ads', 'POST', data);
        showToast('广告创建成功');
      }
      closeAdModal();
      loadAds();
    } catch (err) {
      showToast(err.message || '保存失败');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function toggleAd(id, currentActive) {
    try {
      await apiRequest('/api/admin/ads/' + encodeURIComponent(id), 'PUT', { active: !currentActive });
      showToast(currentActive ? '广告已停用' : '广告已启用');
      loadAds();
    } catch (err) {
      showToast(err.message || '操作失败');
    }
  }

  async function deleteAd(id) {
    if (!confirm('确定要删除这个广告吗？')) return;
    try {
      await apiRequest('/api/admin/ads/' + encodeURIComponent(id), 'DELETE');
      showToast('删除成功');
      loadAds();
    } catch (err) {
      showToast(err.message || '删除失败');
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------- 数据导出 ---------- */

  function exportData() {
    var token = localStorage.getItem('token');
    var url = '/api/admin/export';
    // 使用 fetch 下载文件
    fetch(url, {
      headers: { 'Authorization': 'Bearer ' + (token || '') }
    }).then(function (res) {
      if (res.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        showToast('登录已过期，请重新登录');
        setTimeout(function () { window.location.href = 'login.html'; }, 800);
        return;
      }
      if (!res.ok) {
        showToast('导出失败');
        return;
      }
      return res.blob().then(function (blob) {
        var disp = res.headers.get('Content-Disposition') || '';
        var filename = 'carson-blog-backup.json';
        var match = disp.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = match[1];
        var a = document.createElement('a');
        var url = URL.createObjectURL(blob);
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('数据导出成功');
      });
    }).catch(function () {
      showToast('导出失败，请检查网络连接');
    });
  }

  /* -------------------- 初始化 -------------------- */

  async function initAdmin() {
    updateUserInfo();
    bindAdminEvents();
    // 默认显示仪表盘
    showPage('dashboard');
  }

  document.addEventListener('DOMContentLoaded', async function () {
    protectAdminFooter();
    var isLoginPage = document.body.classList.contains('login-page');

    if (isLoginPage) {
      // 登录页：若已登录则跳转后台
      var token = getToken();
      if (token) {
        try {
          var data = await apiRequest('/api/auth/verify', 'GET');
          if (data && data.valid) {
            window.location.href = 'index.html';
            return;
          }
        } catch (e) {
          // verify 失败（token 过期/无效）：apiRequest 已清除 token，留在登录页即可
          // 不在此处做任何跳转，避免循环重定向
        }
      }
      initLoginPage();
    } else {
      // 后台页：校验登录
      var valid = await checkAuth();
      if (valid) {
        initAdmin();
      }
    }
  });
})();
