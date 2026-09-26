/**
 * 广告位加载与渲染
 * 自动扫描页面上所有 .ad-slot 元素，根据 data-position 向后端请求广告内容并渲染
 * 支持同一位置投放多条广告：按后台设置的展示时长（staySeconds，默认 5 秒）自动轮播切换
 */
(function () {
  'use strict';

  var AD_CACHE = null;
  var AD_CACHE_TIME = 0;
  var FADE_MS = 250;
  var DEFAULT_STAY_SECONDS = 5;

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
   * 读取广告展示时长（秒），范围 1~600，非法回退默认 5 秒
   */
  function staySecondsOf(ad) {
    var n = parseInt(ad && ad.staySeconds, 10);
    if (isNaN(n) || n < 1) n = DEFAULT_STAY_SECONDS;
    if (n > 600) n = 600;
    return n;
  }

  /**
   * 渲染广告到指定slot
   */
  function renderAd(slot, ad) {
    // 没有匹配的广告：隐藏广告位，不显示任何内容
    // 图片广告以 imageUrl 为准（content 为空也照常渲染）
    var hasContent = ad && (ad.content || (ad.type === 'image' && ad.imageUrl));
    if (!hasContent) {
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
      // 图片广告：三端统一按后台设置的固定宽高显示
      var w = parseInt(ad.imgWidth, 10);
      var h = parseInt(ad.imgHeight, 10);
      var style = '';
      if (w > 0 && h > 0) {
        style = ' class="ad-img-fixed" style="width:' + w + 'px;height:' + h + 'px;"';
      }
      inner += '<img src="' + escapeHtml(ad.imageUrl) + '" alt="' + escapeHtml(ad.title || '广告') + '"' + style + '>';
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

  /**
   * 广告位轮播：淡出 → 换内容 → 淡入，按当前广告的展示时长调度下一条
   */
  function swapSlot(slot, ad) {
    slot.classList.add('ad-fade-out');
    setTimeout(function () {
      renderAd(slot, ad);
      slot.classList.remove('ad-fade-out');
    }, FADE_MS);
  }

  function rotateSlot(slot, ads, idx) {
    clearTimeout(slot.__adTimer);
    var ad = ads[idx % ads.length];
    swapSlot(slot, ad);
    slot.__adTimer = setTimeout(function () {
      rotateSlot(slot, ads, idx + 1);
    }, staySecondsOf(ad) * 1000);
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
   * 浮漂小图广告（全站漂浮）
   * 取 position === 'float' 的启用图片广告（支持多条轮播），固定在屏幕角落显示，
   * 自带 × 关闭按钮，关闭后本次会话内不再显示。
   */
  var FLOAT_CLOSED_KEY = 'maishi_float_ad_closed';

  function floatMediaHtml(ad) {
    var html = '';
    if (ad.link) {
      html += '<a class="maishi-float-ad-link" href="' + escapeHtml(ad.link) + '" target="_blank" rel="noopener noreferrer nofollow">';
    }
    html += '<img src="' + escapeHtml(ad.imageUrl) + '" alt="' + escapeHtml(ad.title || '广告') + '">';
    if (ad.link) {
      html += '</a>';
    }
    return html;
  }

  function rotateFloat(box, ads, idx) {
    clearTimeout(box.__adTimer);
    var ad = ads[idx % ads.length];
    var media = box.querySelector('.maishi-float-ad-media');
    if (media) {
      media.classList.add('ad-fade-out');
      setTimeout(function () {
        media.innerHTML = floatMediaHtml(ad);
        media.classList.remove('ad-fade-out');
      }, FADE_MS);
    }
    box.__adTimer = setTimeout(function () {
      rotateFloat(box, ads, idx + 1);
    }, staySecondsOf(ad) * 1000);
  }

  function initFloatAd() {
    // 页面上已存在则不重复创建
    if (document.getElementById('maishiFloatAd')) return;

    getAds().then(function (ads) {
      if (!ads || !ads.length) return;
      var floatAds = [];
      for (var i = 0; i < ads.length; i++) {
        if (ads[i].active && ads[i].position === 'float' && ads[i].type === 'image' && ads[i].imageUrl) {
          floatAds.push(ads[i]);
        }
      }
      if (!floatAds.length) return;

      // 用户本次会话已关闭过浮漂则不再显示
      try {
        if (sessionStorage.getItem(FLOAT_CLOSED_KEY)) return;
      } catch (e) { /* 隐私模式下忽略 */ }

      var ad = floatAds[0];
      var w = parseInt(ad.imgWidth, 10);
      var h = parseInt(ad.imgHeight, 10);
      if (!(w > 0)) w = 120;
      if (!(h > 0)) h = 120;

      var box = document.createElement('div');
      box.id = 'maishiFloatAd';
      box.className = 'maishi-float-ad';
      box.style.setProperty('--fad-w', w + 'px');
      box.style.setProperty('--fad-h', h + 'px');

      var html = '<div class="maishi-float-ad-media">' + floatMediaHtml(ad) + '</div>';
      html += '<button type="button" class="maishi-float-ad-close" aria-label="关闭广告">&times;</button>';
      html += '<span class="maishi-float-ad-label">广告</span>';
      box.innerHTML = html;

      // 关闭按钮：阻止冒泡，不触发广告跳转；整个浮漂本会话不再显示
      var closeBtn = box.querySelector('.maishi-float-ad-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          clearTimeout(box.__adTimer);
          if (box.parentNode) box.parentNode.removeChild(box);
          try { sessionStorage.setItem(FLOAT_CLOSED_KEY, 'all'); } catch (e) { /* 忽略 */ }
        });
      }

      document.body.appendChild(box);

      // 多条浮漂广告时自动轮播
      if (floatAds.length > 1) {
        box.__adTimer = setTimeout(function () {
          rotateFloat(box, floatAds, 1);
        }, staySecondsOf(ad) * 1000);
      }
    });
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
        // 收集匹配该位置的全部广告（同位置可叠加多条，按创建顺序轮播）
        var matchedList = [];
        for (var i = 0; i < ads.length; i++) {
          var ad = ads[i];
          if (!ad.active) continue;
          if (ad.position === 'float') continue; // 浮漂广告单独处理
          // 匹配位置（精确匹配或通配符）
          if (ad.position === position || ad.position === 'all' || ad.position === pageName + '_all') {
            matchedList.push(ad);
          }
        }
        if (!matchedList.length) {
          renderAd(slot, null);
        } else if (matchedList.length === 1) {
          clearTimeout(slot.__adTimer);
          renderAd(slot, matchedList[0]);
        } else {
          rotateSlot(slot, matchedList, 0);
        }
      });
    });
  }

  // DOM 加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initAds();
      initFloatAd();
    });
  } else {
    initAds();
    initFloatAd();
  }

  // 暴露给外部调用
  window.AdSlots = { init: initAds, render: renderAd, initFloat: initFloatAd };
})();
