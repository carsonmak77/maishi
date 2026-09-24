// 底部工具栏功能
(function() {
  'use strict';

  // 主题颜色配置
  const themeColors = {
    green: { primary: '#07C160', hover: '#06ad56', light: '#e8f8f0' },
    blue: { primary: '#1890ff', hover: '#40a9ff', light: '#e6f7ff' },
    purple: { primary: '#722ed1', hover: '#9254de', light: '#f9f0ff' },
    orange: { primary: '#fa8c16', hover: '#ffa940', light: '#fff7e6' },
    red: { primary: '#f5222d', hover: '#ff4d4f', light: '#fff1f0' },
    cyan: { primary: '#13c2c2', hover: '#36cfc9', light: '#e6fffb' }
  };
  const colorOrder = ['green', 'blue', 'purple', 'orange', 'red', 'cyan'];

  // 英文翻译字典（key = 原始中文，value = 英文翻译）
  const enDict = {
    // 导航栏
    '首页': 'Home',
    '文章': 'Articles',
    '朋友们': 'Friends',
    '关于': 'About',
    '登录': 'Login',
    '搜索文章...': 'Search articles...',
    '搜索': 'Search',

    // 首页
    '最新文章': 'Latest Articles',
    '查看更多': 'View More',
    '阅读全文': 'Read More',
    '暂无文章': 'No articles yet',
    '暂无摘要': 'No summary',

    // 文章页
    '全部文章': 'All Articles',
    '这里展示所有已发布的普通文章；网站首页只展示后台勾选"首页显示"的文章。': 'This page shows all published articles. The homepage only displays articles marked as "Show on Homepage".',
    '全部': 'All',
    '未分类': 'Uncategorized',

    // 朋友们页
    '这里收集了一些有趣、真诚、持续创作的个人站点。欢迎互换友链，一起让独立博客保持热闹。': 'A collection of interesting, sincere, and actively maintained personal blogs. Welcome to exchange friend links and keep the independent blogging community alive.',
    '友情链接': 'Friend Links',
    '只显示审核通过的友链': 'Only showing approved links',
    '正在加载友链...': 'Loading friend links...',
    '申请友链': 'Apply for Friend Link',
    '提交后需后台审核，通过后才会展示': 'Submission requires admin approval before display',
    '站点名称': 'Site Name',
    '站点链接': 'Site URL',
    '一句话介绍': 'One-line Introduction',
    '写一句你的网站签名': 'Write a signature for your site',
    '小图标链接': 'Icon URL',
    '可填写站点 favicon 或头像图片链接；如果同时上传头像，将优先显示上传头像。': 'You can provide favicon or avatar URL; if avatar is uploaded, it takes priority.',
    '小头像图片': 'Avatar Image',
    '支持 PNG、JPG、GIF、WEBP、SVG，大小不得大于 1MB。': 'Supports PNG, JPG, GIF, WEBP, SVG, max 1MB.',
    '提交审核': 'Submit for Review',
    '暂无审核通过的友链': 'No approved friend links yet',

    // 关于页
    '正在加载关于页面...': 'Loading about page...',
    '关于页面加载失败：': 'Failed to load about page: ',
    '重新加载': 'Reload',

    // 文章详情
    '点赞': 'Like',
    '已点赞': 'Liked',
    '收藏': 'Favorite',
    '已收藏': 'Favorited',
    '分享': 'Share',
    '返回': 'Back',
    '返回首页': 'Back to Home',
    '网站公告': 'Announcement',
    '置顶': 'Pinned',

    // 留言区
    '文章留言': 'Article Comments',
    '留言反馈': 'Feedback',
    '主页留言': 'Home Comments',
    '欢迎留下想法，触碰审核关键词的留言会在管理员通过后显示。': 'Feel free to leave your thoughts. Comments containing review keywords will be displayed after admin approval.',
    '游客昵称（可选）': 'Nickname (optional)',
    '写下你的留言...': 'Write your comment...',
    '提交留言': 'Submit Comment',
    '正在加载留言...': 'Loading comments...',
    '暂无留言，来做第一个留言的人吧。': 'No comments yet. Be the first to leave a comment!',
    '留言加载失败：': 'Failed to load comments: ',
    '留言发布成功': 'Comment posted successfully',
    '请输入留言内容': 'Please enter comment content',
    '表情': 'Emoji',

    // 登录/注册
    '登录中...': 'Logging in...',
    '登录成功，正在返回首页...': 'Login successful, redirecting to homepage...',
    '登录失败': 'Login failed',
    '请先登录后查看投稿。': 'Please login to view your posts.',
    '请先登录后再上传图片': 'Please login to upload images',
    '注册中...': 'Registering...',
    '注册成功，正在返回首页...': 'Registration successful, redirecting to homepage...',
    '注册失败': 'Registration failed',
    '注册': 'Register',

    // 投稿
    '正在加载投稿...': 'Loading submissions...',
    '投稿加载失败：': 'Failed to load submissions: ',
    '还没有投稿，写下第一篇吧。': 'No submissions yet. Write your first one!',
    '已通过': 'Approved',
    '不通过': 'Rejected',
    '待审核': 'Pending',
    '查看文章': 'View Article',
    '无标题投稿': 'Untitled Submission',
    '投稿': 'Submission',
    '原因：': 'Reason: ',
    '请填写标题和正文': 'Please fill in title and content',
    '提交中...': 'Submitting...',
    '投稿已提交，请等待审核': 'Submission submitted, awaiting review',
    '投稿提交失败': 'Submission failed',
    '提交投稿': 'Submit',

    // 点赞 / 收藏
    '正在加载点赞...': 'Loading likes...',
    '正在加载收藏...': 'Loading favorites...',
    '点赞加载失败：': 'Failed to load likes: ',
    '收藏加载失败：': 'Failed to load favorites: ',
    '还没有点赞文章': 'No liked articles yet',
    '还没有收藏文章': 'No favorited articles yet',
    '请先登录后查看点赞。': 'Please login to view your likes.',
    '请先登录后查看收藏。': 'Please login to view your favorites.',
    '点赞成功': 'Liked',
    '已取消点赞': 'Like removed',
    '收藏成功': 'Favorited',
    '已取消收藏': 'Favorite removed',
    '操作失败': 'Operation failed',
    '登录后可在个人中心查看点赞记录': 'Login to view your likes in profile',
    '登录后可在个人中心查看收藏记录': 'Login to view your favorites in profile',
    '登录已过期，请重新登录': 'Login expired, please log in again',

    // 底部工具栏
    '主题颜色': 'Theme Color',
    '语言': 'Language',
    '夜间模式': 'Dark Mode',

    // 手机端底部导航
    '主页': 'Home',

    // 其他
    '例如：某某的博客': 'e.g., My Blog'
  };

  // 初始化
  var _delegated = false;
  function init() {
    initThemeColor();
    initDarkMode();
    initLanguage();
    // 页面加载时应用已保存的语言设置
    applyLanguage();
    // 使用事件委托，避免按钮被重新创建后事件丢失
    if (!_delegated) {
      _delegated = true;
      document.addEventListener('click', function(e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        if (btn.id === 'themeColorBtn') { cycleThemeColor(); }
        else if (btn.id === 'darkModeBtn') { toggleDarkMode(); }
        else if (btn.id === 'languageBtn') { toggleLanguage(); }
      });
    }
    // 暴露调试接口
    window.__toolbarDebug = {
      init: init,
      applyThemeColor: applyThemeColor,
      cycleThemeColor: cycleThemeColor,
      toggleDarkMode: toggleDarkMode,
      toggleLanguage: toggleLanguage,
      applyLanguage: applyLanguage,
      themeColors: themeColors,
      colorOrder: colorOrder
    };
  }

  // ============================
  // 主题颜色 - 直接点击循环切换
  // ============================

  function initThemeColor() {
    const savedColor = localStorage.getItem('themeColor') || 'green';
    applyThemeColor(savedColor);
  }

  function cycleThemeColor() {
    const currentColor = localStorage.getItem('themeColor') || 'green';
    const currentIndex = colorOrder.indexOf(currentColor);
    const nextIndex = (currentIndex + 1) % colorOrder.length;
    const nextColor = colorOrder[nextIndex];

    applyThemeColor(nextColor);
    showColorToast(nextColor);
  }

  function showColorToast(colorName) {
    const colorNames = { green: '绿色', blue: '蓝色', purple: '紫色', orange: '橙色', red: '红色', cyan: '青色' };
    const colorNamesEn = { green: 'Green', blue: 'Blue', purple: 'Purple', orange: 'Orange', red: 'Red', cyan: 'Cyan' };

    let toast = document.querySelector('.language-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'language-toast';
      document.body.appendChild(toast);
    }

    const lang = localStorage.getItem('language') || 'zh';
    const nameMap = lang === 'en' ? colorNamesEn : colorNames;
    toast.textContent = lang === 'zh' ? '主题颜色：' + nameMap[colorName] : 'Theme: ' + nameMap[colorName];
    toast.classList.add('show');

    setTimeout(function() {
      toast.classList.remove('show');
    }, 1500);
  }

  function applyThemeColor(colorName) {
    const color = themeColors[colorName];
    if (!color) return;

    // 设置 --theme-primary 系列变量，保持与 CSS 变量链和 anti-flicker 脚本一致
    document.documentElement.style.setProperty('--theme-primary', color.primary);
    document.documentElement.style.setProperty('--theme-primary-hover', color.hover);
    document.documentElement.style.setProperty('--theme-primary-light', color.light);
    // 清除可能残留的 --wechat-green 内联样式，让 CSS 变量链生效
    document.documentElement.style.removeProperty('--wechat-green');
    document.documentElement.style.removeProperty('--wechat-green-hover');
    document.documentElement.style.removeProperty('--wechat-green-light');
    document.documentElement.setAttribute('data-theme-color', colorName);
    localStorage.setItem('themeColor', colorName);
  }

  // ============================
  // 暗黑模式
  // ============================

  function initDarkMode() {
    const savedMode = localStorage.getItem('darkMode') || 'light';
    applyDarkMode(savedMode);
  }

  function applyDarkMode(mode) {
    if (mode === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      updateDarkModeIcon('dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      updateDarkModeIcon('light');
    }
    localStorage.setItem('darkMode', mode);
  }

  function toggleDarkMode() {
    const currentMode = localStorage.getItem('darkMode') || 'light';
    applyDarkMode(currentMode === 'dark' ? 'light' : 'dark');
  }

  function updateDarkModeIcon(mode) {
    const darkBtn = document.getElementById('darkModeBtn');
    if (!darkBtn) return;

    if (mode === 'dark') {
      darkBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
    } else {
      darkBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
    }
  }

  // ============================
  // 语言切换
  // ============================

  function initLanguage() {
    // 事件委托在 init() 中统一处理
  }

  function toggleLanguage() {
    const currentLang = localStorage.getItem('language') || 'zh';
    const newLang = currentLang === 'zh' ? 'en' : 'zh';
    localStorage.setItem('language', newLang);
    applyLanguage();
    showLanguageToast(newLang);
  }

  function showLanguageToast(lang) {
    let toast = document.querySelector('.language-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'language-toast';
      document.body.appendChild(toast);
    }

    toast.textContent = lang === 'zh' ? '已切换为中文' : 'Switched to English';
    toast.classList.add('show');

    setTimeout(function() {
      toast.classList.remove('show');
    }, 2000);
  }

  // ============================
  // 翻译核心逻辑
  // ============================

  /**
   * 给元素设置 data-i18n 属性（保存原始中文），然后翻译。
   * 这样切换回中文时可以用 data-i18n 的原始值恢复。
   */
  function markAndTranslate(el, prop, chineseText) {
    // 保存原始中文（只保存一次）
    if (!el.getAttribute('data-i18n')) {
      el.setAttribute('data-i18n', chineseText);
    }

    var lang = localStorage.getItem('language') || 'zh';
    if (lang === 'en') {
      var original = el.getAttribute('data-i18n');
      el[prop] = enDict[original] || original;
    } else {
      // 中文模式：恢复原始中文
      el[prop] = el.getAttribute('data-i18n') || chineseText;
    }
  }

  function applyLanguage() {
    var lang = localStorage.getItem('language') || 'zh';

    // 1. 翻译导航栏链接
    document.querySelectorAll('.nav-links a').forEach(function(link) {
      markAndTranslate(link, 'textContent', link.textContent.trim());
    });

    // 2. 翻译登录/注册链接
    document.querySelectorAll('.auth-link').forEach(function(link) {
      markAndTranslate(link, 'textContent', link.textContent.trim());
    });

    // 3. 翻译 placeholder
    document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(function(input) {
      markAndTranslate(input, 'placeholder', input.getAttribute('placeholder'));
    });

    // 4. 翻译按钮 title
    document.querySelectorAll('button[title]').forEach(function(btn) {
      markAndTranslate(btn, 'title', btn.getAttribute('title'));
    });

    // 5. 翻译手机端底部导航
    document.querySelectorAll('.mobile-tabbar-item span').forEach(function(span) {
      markAndTranslate(span, 'textContent', span.textContent.trim());
    });

    // 6. 翻译页面标题（page-hero h1）
    var pageTitle = document.querySelector('.page-hero h1');
    if (pageTitle) {
      markAndTranslate(pageTitle, 'textContent', pageTitle.textContent.trim());
    }

    // 7. 翻译页面描述（page-hero p）
    var pageDesc = document.querySelector('.page-hero p');
    if (pageDesc) {
      markAndTranslate(pageDesc, 'textContent', pageDesc.textContent.trim());
    }

    // 8. 翻译 page-kicker
    var pageKicker = document.querySelector('.page-kicker');
    if (pageKicker) {
      markAndTranslate(pageKicker, 'textContent', pageKicker.textContent.trim());
    }

    // 9. 翻译友链表单标签
    document.querySelectorAll('.friend-submit-form label').forEach(function(label) {
      // 保留 <span>*</span> 等子元素
      var original = label.getAttribute('data-i18n') || label.textContent.trim().replace(/\s*\*\s*$/, '');
      if (!label.getAttribute('data-i18n')) {
        label.setAttribute('data-i18n', original);
      }
      var star = label.querySelector('span');
      var starHTML = star ? ' ' + star.outerHTML : '';
      if (lang === 'en') {
        label.innerHTML = (enDict[original] || original) + starHTML;
      } else {
        label.innerHTML = original + starHTML;
      }
    });

    // 10. 翻译提示文本
    document.querySelectorAll('.form-tip, .section-title-row span').forEach(function(el) {
      markAndTranslate(el, 'textContent', el.textContent.trim());
    });

    // 11. 更新 HTML lang 属性
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

    // 12. 重新渲染动态内容
    if (window.refreshDynamicContent) {
      window.refreshDynamicContent();
    }
  }

  // ============================
  // 暴露翻译函数供 main.js 使用
  // ============================

  /**
   * 翻译一段中文文本
   */
  window.translateText = function(text) {
    var lang = localStorage.getItem('language') || 'zh';
    if (lang === 'en') {
      return enDict[text] || text;
    }
    return text;
  };

  /**
   * 给动态创建的元素标记 data-i18n 并翻译
   * 用法: markI18n(element, 'textContent') 或 markI18n(element, 'placeholder')
   */
  window.markI18n = markAndTranslate;

  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
