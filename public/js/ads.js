/**
 * 广告位加载与渲染
 * 自动扫描页面上所有 .ad-slot 元素，根据 data-position 向后端请求广告内容并渲染
 */
(function () {
  'use strict';

  var AD_CACHE = null;
  var AD_CACHE_TIME = 0;

  /**
   * 获取广告数据（带缓存，5分钟有效）
   */
  function getAds() {
    var now = Date.now();
    if (AD_CACHE && (now - AD_CACHE_TIME) < 5 * 60 * 1000) {
      return Promise.resolve(AD_CACHE);
    }
    return fetch('/api/ads')
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (data) {
        AD_CACHE = data || [];
        AD_CACHE_TIME = now;
        return AD_CACHE;
      })
      .catch(function () { return []; });
  }

  /**
   * 获取页面名称
   */
  function getPageName() {
    var path = window.location.pathname;
    if (path.endsWith('index.html') || path === '/' || path === '') return 'home';
    if (path.endsWith('genealogy.html')) return 'genealogy';
    if (path.endsWith('friends.html')) return 'friends';
    if (path.endsWith('about.html')) return 'about';
    if (path.endsWith('post.html')) return 'post';
    return 'other';
  }

  /**
   * 渲染广告到指定slot
   */
  function renderAd(slot, ad) {
    // 没有匹配的广告：隐藏广告位，不显示任何内容
    if (!ad || !ad.content) {
      slot.style.display = 'none';
      slot.innerHTML = '';
      return;
    }

    // 有广告内容：显示广告位
    slot.style.display = 'flex';

    var inner = '<div class="ad-slot-inner">';
    if (ad.link) {
      inner += '<a href="' + escapeHtml(ad.link) + '" target="_blank" rel="noopener noreferrer nofollow">';
    }
    if (ad.type === 'image' && ad.imageUrl) {
      inner += '<img src="' + escapeHtml(ad.imageUrl) + '" alt="' + escapeHtml(ad.title || '广告') + '">';
    } else if (ad.type === 'html') {
      inner += ad.content;
    } else {
      // text type
      inner += '<div class="ad-slot-text">' + escapeHtml(ad.content) + '</div>';
    }
    if (ad.link) {
      inner += '</a>';
    }
    if (ad.title && ad.type !== 'html') {
      inner += '<div class="ad-slot-text">' + escapeHtml(ad.title) + '</div>';
    }
    inner += '</div>';
    inner += '<span class="ad-slot-label">广告</span>';

    slot.innerHTML = inner;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * 初始化所有广告位
   */
  function initAds() {
    var slots = document.querySelectorAll('.ad-slot[data-position]');
    if (!slots.length) return;

    var pageName = getPageName();

    getAds().then(function (ads) {
      slots.forEach(function (slot) {
        var position = slot.getAttribute('data-position');
        // 查找匹配的广告
        var matched = null;
        for (var i = 0; i < ads.length; i++) {
          var ad = ads[i];
          if (!ad.active) continue;
          // 匹配位置（精确匹配或通配符）
          if (ad.position === position || ad.position === 'all' || ad.position === pageName + '_all') {
            matched = ad;
            break;
          }
        }
        renderAd(slot, matched);
      });
    });
  }

  // DOM 加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAds);
  } else {
    initAds();
  }

  // 暴露给外部调用
  window.AdSlots = { init: initAds, render: renderAd };
})();
