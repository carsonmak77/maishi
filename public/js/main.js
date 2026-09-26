/* ============================
   CARSON 博客 - 前台逻辑
   ============================ */

/* ============================================================
   【性能优化模块】请求合并与缓存 / 防抖节流 / 懒加载 / 虚拟列表
   ============================================================ */

/* ----------------------------
   1. request 模块：请求合并(dedupe) + 内存缓存(带 TTL)
   ---------------------------- */
var RequestCache = (function () {
  /** 内存缓存：key -> { data, expireAt } */
  var cache = Object.create(null);
  /** 正在进行中的请求：key -> Promise（用于合并并发相同请求） */
  var inflight = Object.create(null);

  function _makeKey(url, options) {
    // GET 请求才做缓存与合并；POST 等不缓存
    var method = (options && options.method) ? options.method.toUpperCase() : 'GET';
    return method + ':' + url;
  }

  /**
   * 发起请求，自动合并并发相同 GET 请求，并支持内存缓存
   * @param {string} url
   * @param {object} [options] fetch options
   * @param {number} [ttl] 缓存 TTL（毫秒），仅 GET 生效。0 表示不缓存
   */
  function request(url, options, ttl) {
    var opts = options || {};
    var method = (opts.method || 'GET').toUpperCase();
    var key = _makeKey(url, opts);
    ttl = typeof ttl === 'number' ? ttl : 60 * 1000; // 默认 60 秒缓存

    // 维护模式：如果已验证，自动添加 x-maintenance-verified header
    try {
      if (sessionStorage.getItem('maintenanceVerified') === 'true') {
        if (!opts.headers) opts.headers = {};
        opts.headers['x-maintenance-verified'] = 'true';
      }
    } catch (e) { /* sessionStorage 不可用时忽略 */ }

    // 非 GET 请求：直接 fetch，不缓存不合并
    if (method !== 'GET') {
      return fetch(url, opts).then(function (res) { return res; });
    }

    // 命中内存缓存且未过期
    var cached = cache[key];
    if (cached && cached.expireAt > Date.now()) {
      return Promise.resolve(cached.data.clone ? cached.data.clone() : cached.data);
    }
    // 缓存过期则清除
    if (cached) delete cache[key];

    // 已有相同请求在进行中：共享同一个 Promise
    if (inflight[key]) {
      return inflight[key].then(function (res) { return res.clone ? res.clone() : res; });
    }

    // 发起新请求
    var promise = fetch(url, opts).then(function (res) {
      // 缓存 Response（克隆使用）
      if (res.ok && ttl > 0) {
        cache[key] = {
          data: res.clone(),
          expireAt: Date.now() + ttl
        };
      }
      return res;
    }).catch(function (err) {
      // 请求失败时不缓存
      throw err;
    }).finally(function () {
      // 请求结束后从 inflight 中移除（延迟一点，确保所有 then 都已拿到 clone）
      setTimeout(function () { delete inflight[key]; }, 0);
    });

    inflight[key] = promise;
    return promise;
  }

  /** 手动清除缓存（如提交数据后刷新） */
  function clearCache(urlPattern) {
    if (!urlPattern) {
      cache = Object.create(null);
      return;
    }
    Object.keys(cache).forEach(function (k) {
      if (k.indexOf(urlPattern) !== -1) delete cache[k];
    });
  }

  return {
    request: request,
    clearCache: clearCache
  };
})();

/* ----------------------------
   2. 防抖与节流工具函数
   ---------------------------- */

/**
 * 防抖：事件触发后延迟 wait 毫秒执行，期间再次触发则重新计时
 */
function debounce(fn, wait) {
  var timer = null;
  var debounced = function () {
    var ctx = this;
    var args = arguments;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      fn.apply(ctx, args);
    }, wait);
  };
  debounced.cancel = function () {
    if (timer) { clearTimeout(timer); timer = null; }
  };
  debounced.flush = function () {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      fn.apply(this, arguments);
    }
  };
  return debounced;
}

/**
 * 节流（基于 requestAnimationFrame，约 16ms 一次）：
 * 保证在每帧最多执行一次，适合滚动、resize 等高频事件
 */
function throttleRaf(fn) {
  var rafId = null;
  var lastArgs = null;
  var lastCtx = null;
  var throttled = function () {
    lastCtx = this;
    lastArgs = arguments;
    if (rafId != null) return;
    rafId = requestAnimationFrame(function () {
      rafId = null;
      fn.apply(lastCtx, lastArgs);
    });
  };
  throttled.cancel = function () {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };
  return throttled;
}

/* ----------------------------
   3. 图片懒加载：IntersectionObserver + 模糊占位 + 200px 预加载
   ---------------------------- */
var LazyImage = (function () {
  var observer = null;
  var observerCount = 0;

  function _getObserver() {
    if (observer) return observer;
    if (!('IntersectionObserver' in window)) return null;
    observer = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var img = entry.target;
          _loadImage(img);
          obs.unobserve(img);
        }
      });
    }, {
      rootMargin: '200px 0px', // 进入视口前 200px 预加载
      threshold: 0.01
    });
    return observer;
  }

  function _loadImage(img) {
    var src = img.getAttribute('data-src');
    if (!src) return;
    var tmp = new Image();
    tmp.onload = function () {
      img.src = src;
      img.classList.add('lazy-loaded');
      img.removeAttribute('data-src');
    };
    tmp.onerror = function () {
      // 加载失败也移除 data-src，避免重复尝试
      img.removeAttribute('data-src');
      // 触发 error 事件，让外层 fallback 逻辑生效
      if (img.parentNode) {
        var evt = new Event('error', { bubbles: true });
        img.dispatchEvent(evt);
      }
    };
    tmp.src = src;
  }

  /**
   * 将 <img src="占位图" data-src="真实地址"> 加入懒加载观察
   * @param {HTMLImageElement|NodeList|Array} imgs
   */
  function observe(imgs) {
    if (!imgs) return;
    var list = imgs.length !== undefined ? Array.prototype.slice.call(imgs) : [imgs];
    var obs = _getObserver();

    if (!obs) {
      // 不支持 IntersectionObserver：直接加载
      list.forEach(function (img) { _loadImage(img); });
      return;
    }

    list.forEach(function (img) {
      if (!img.getAttribute('data-src')) return;
      if (img._lazyObserved) return;
      img._lazyObserved = true;
      img.classList.add('lazy-image');
      obs.observe(img);
      observerCount++;
    });
  }

  /** 销毁 observer，防止内存泄漏 */
  function destroy() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    observerCount = 0;
  }

  return {
    observe: observe,
    destroy: destroy
  };
})();

/* ----------------------------
   4. 虚拟列表（Virtual List）
   - 仅渲染视口内 + 缓冲区的文章卡片
   - 超过 20 篇时启用；否则 fallback 到原始 renderPostList
   ---------------------------- */
var VirtualList = (function () {
  /**
   * 创建虚拟列表实例
   * @param {object} opts
   *   - container: 容器元素（应有固定高度且可滚动）
   *   - scrollContainer: 滚动容器（默认 window）
   *   - items: 数据数组
   *   - itemHeight: 预估单项高度（px），用于计算偏移
   *   - buffer: 上下缓冲区条数（默认 5）
   *   - renderItem: 渲染单项 HTML 的函数 (item, index) => string
   *   - itemClass: 单项 class，用于事件委托
   *   - threshold: 超过多少条才启用虚拟列表（默认 20）
   */
  function create(opts) {
    var container = opts.container;
    if (!container) return null;

    var items = opts.items || [];
    var threshold = opts.threshold || 20;

    // 未达到阈值：不启用虚拟列表，返回全量渲染
    if (items.length <= threshold) {
      return {
        render: function () {
          container.innerHTML = items.map(function (item, i) {
            return opts.renderItem(item, i);
          }).join('');
        },
        update: function (newItems) {
          items = newItems || [];
          container.innerHTML = items.map(function (item, i) {
            return opts.renderItem(item, i);
          }).join('');
        },
        destroy: function () {},
        isVirtual: false
      };
    }

    var itemHeight = opts.itemHeight || 200;
    var buffer = opts.buffer != null ? opts.buffer : 5;
    var scrollContainer = opts.scrollContainer || window;
    var renderItem = opts.renderItem;

    // 状态
    var scrollTop = 0;
    var viewportHeight = _getViewportHeight();
    var startIndex = 0;
    var endIndex = 0;
    var rafId = null;
    var destroyed = false;

    // 实际高度缓存（根据已渲染项动态调整）
    var measuredHeights = []; // index -> height
    var avgHeight = itemHeight;

    function _getViewportHeight() {
      if (scrollContainer === window) return window.innerHeight;
      return scrollContainer.clientHeight;
    }

    function _getScrollTop() {
      if (scrollContainer === window) return window.pageYOffset || document.documentElement.scrollTop;
      return scrollContainer.scrollTop;
    }

    function _getItemTop(index) {
      // 用已测量高度精确计算，未测量的用预估高度
      var top = 0;
      for (var i = 0; i < index; i++) {
        top += measuredHeights[i] || avgHeight;
      }
      return top;
    }

    function _getTotalHeight() {
      var total = 0;
      for (var i = 0; i < items.length; i++) {
        total += measuredHeights[i] || avgHeight;
      }
      return total;
    }

    function _findStartIndex(scrollTop) {
      // 二分查找：找到第一个顶部在 scrollTop 以下的 item
      var low = 0;
      var high = items.length - 1;
      var result = 0;
      while (low <= high) {
        var mid = Math.floor((low + high) / 2);
        var top = _getItemTop(mid);
        if (top <= scrollTop) {
          result = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      return Math.max(0, result - buffer);
    }

    function _measureItems() {
      // 测量当前已渲染项的实际高度，更新 avgHeight
      var children = container.querySelectorAll('.post-card');
      if (!children.length) return;
      var measuredCount = 0;
      var measuredTotal = 0;
      for (var i = 0; i < children.length; i++) {
        var idx = parseInt(children[i].getAttribute('data-index'), 10);
        if (isNaN(idx)) continue;
        var h = children[i].offsetHeight;
        if (h > 0) {
          measuredHeights[idx] = h;
          measuredCount++;
          measuredTotal += h;
        }
      }
      if (measuredCount > 0) {
        // 加权更新平均高度
        avgHeight = Math.round(measuredTotal / measuredCount * 0.3 + avgHeight * 0.7);
      }
    }

    function _render() {
      if (destroyed) return;
      scrollTop = _getScrollTop();
      viewportHeight = _getViewportHeight();

      // 计算可见范围
      var start = _findStartIndex(scrollTop);
      var end = start;
      var accHeight = 0;
      var startTop = _getItemTop(start);
      while (end < items.length && accHeight < viewportHeight + itemHeight * buffer * 2) {
        accHeight += measuredHeights[end] || avgHeight;
        end++;
      }
      end = Math.min(items.length, end + buffer);

      // 范围未变化则跳过
      if (start === startIndex && end === endIndex) return;
      startIndex = start;
      endIndex = end;

      // 构建 HTML：使用 padding-top 撑起上方偏移
      var offsetY = startTop;
      var totalHeight = _getTotalHeight();
      var bottomPad = totalHeight - _getItemTop(end);

      var html = '<div class="virtual-list-spacer" style="height:' + offsetY + 'px"></div>';
      for (var i = start; i < end; i++) {
        html += renderItem(items[i], i);
      }
      html += '<div class="virtual-list-spacer" style="height:' + bottomPad + 'px"></div>';

      container.innerHTML = html;

      // 下帧测量实际高度
      requestAnimationFrame(_measureItems);
    }

    var onScroll = throttleRaf(function () {
      if (destroyed) return;
      _render();
    });

    var onResize = debounce(function () {
      if (destroyed) return;
      // 重置测量缓存，因为布局可能变化
      measuredHeights = [];
      _render();
    }, 150);

    function _init() {
      // 初始渲染
      _render();
      // 绑定滚动和 resize
      scrollContainer.addEventListener('scroll', onScroll, { passive: true });
      if (scrollContainer === window) {
        window.addEventListener('resize', onResize);
      }
    }

    // 延迟初始化，让浏览器先处理其他首屏任务
    requestAnimationFrame(_init);

    return {
      isVirtual: true,
      update: function (newItems) {
        items = newItems || [];
        measuredHeights = [];
        startIndex = 0;
        endIndex = 0;
        _render();
      },
      destroy: function () {
        destroyed = true;
        onScroll.cancel && onScroll.cancel();
        onResize.cancel && onResize.cancel();
        scrollContainer.removeEventListener('scroll', onScroll);
        if (scrollContainer === window) {
          window.removeEventListener('resize', onResize);
        }
      }
    };
  }

  return { create: create };
})();

/* ----------------------------
   5. 骨架屏生成函数
   ---------------------------- */
function buildSkeletonHTML(count, mode) {
  count = count || 6;
  mode = mode || 'default';
  var html = '';
  for (var i = 0; i < count; i++) {
    html += (
      '<article class="post-card post-card--skeleton">' +
        '<div class="skeleton-line skeleton-line--cover"></div>' +
        '<div class="skeleton-line skeleton-line--title"></div>' +
        '<div class="skeleton-line skeleton-line--text"></div>' +
        '<div class="skeleton-line skeleton-line--meta"></div>' +
      '</article>'
    );
  }
  return html;
}

/* ----------------------------
   6. 分批渲染工具（rAF 分帧渲染大量卡片，不阻塞主线程）
   ---------------------------- */
function renderBatchInFrames(container, items, renderItemFn, batchSize, onComplete) {
  batchSize = batchSize || 10;
  var index = 0;
  var total = items.length;
  var frag = document.createDocumentFragment();
  var htmlParts = [];

  function _nextBatch() {
    var end = Math.min(index + batchSize, total);
    for (var i = index; i < end; i++) {
      htmlParts.push(renderItemFn(items[i], i));
    }
    index = end;

    if (index >= total) {
      // 全部完成：一次性写入
      var temp = document.createElement('div');
      temp.innerHTML = htmlParts.join('');
      while (temp.firstChild) frag.appendChild(temp.firstChild);
      container.innerHTML = '';
      container.appendChild(frag);
      if (onComplete) onComplete();
      return;
    }

    // 下一帧继续
    requestAnimationFrame(_nextBatch);
  }

  requestAnimationFrame(_nextBatch);
}

/* ----------------------------
   7. 内存泄漏防护：全局清理注册中心
   - 所有定时器、observer、事件监听器统一注册，页面卸载时清理
   ---------------------------- */
var CleanupRegistry = (function () {
  var tasks = [];
  var registered = false;

  function _runAll() {
    for (var i = 0; i < tasks.length; i++) {
      try { tasks[i](); } catch (e) { /* 忽略单个清理错误 */ }
    }
    tasks = [];
  }

  function register(fn) {
    if (typeof fn !== 'function') return;
    tasks.push(fn);
    if (!registered) {
      registered = true;
      // pagehide 比 beforeunload 更可靠（支持往返缓存）
      window.addEventListener('pagehide', _runAll);
      // 兜底
      window.addEventListener('beforeunload', _runAll);
    }
  }

  return { register: register };
})();

/* ----------------------------
   8. localStorage 缓存工具（带时间戳）
   ---------------------------- */
var StorageCache = {
  /**
   * 读取带 TTL 的 localStorage 缓存
   * @param {string} key
   * @param {number} maxAge 最大有效期（毫秒），0 表示不过期
   */
  get: function (key, maxAge) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (maxAge && obj.timestamp && Date.now() - obj.timestamp > maxAge) {
        localStorage.removeItem(key);
        return null;
      }
      return obj.data;
    } catch (e) {
      return null;
    }
  },
  /**
   * 写入带时间戳的 localStorage 缓存
   */
  set: function (key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({
        data: data,
        timestamp: Date.now()
      }));
    } catch (e) {
      // localStorage 可能已满或不可用，静默失败
    }
  },
  remove: function (key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }
};

/* ============================================================
   【原有工具函数】
   ============================================================ */

/* ----------------------------
   工具函数
   ---------------------------- */

/**
 * 格式化日期为 "2024年1月15日"
 * @param {string} dateStr ISO 日期字符串
 * @returns {string}
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

/**
 * HTML 转义，防止 XSS（用于卡片中展示纯文本字段）
 */
function escapeHTML(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 轻量级浅层对象比较，替代 JSON.stringify 比较（性能提升 10-100 倍）
 * 仅比较第一层 key，适用于 API 返回的扁平结构对比
 */
function shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  var keysA = Object.keys(a);
  var keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (var i = 0; i < keysA.length; i++) {
    var k = keysA[i];
    if (a[k] !== b[k]) {
      // 数组需要逐项比较
      if (Array.isArray(a[k]) && Array.isArray(b[k])) {
        if (a[k].length !== b[k].length) return false;
        for (var j = 0; j < a[k].length; j++) {
          if (a[k][j] !== b[k][j]) return false;
        }
      } else {
        return false;
      }
    }
  }
  return true;
}

/**
 * 封装 fetch，统一错误处理
 * - 升级：使用 RequestCache 实现请求合并(dedupe) + 内存缓存(默认 60s TTL)
 * - 保持向后兼容：调用方式不变
 * @param {string} url
 * @param {object} [options] fetch options
 * @param {number} [ttl] 缓存 TTL（毫秒），0 表示不缓存，默认 60000ms
 */
async function fetchJSON(url, options, ttl) {
  const res = await RequestCache.request(url, options, ttl);
  if (!res.ok) {
    let msg = '请求失败（' + res.status + '）';
    try {
      const data = await res.json();
      if (data.error) msg = data.error;
    } catch (e) { /* 忽略解析错误 */ }
    // 失败时清除缓存，避免缓存错误响应
    RequestCache.clearCache(url);
    throw new Error(msg);
  }
  return res.json();
}

async function parseResponse(res) {
  var text = await res.text();
  var data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    data = {};
  }
  if (!res.ok) {
    throw new Error(data.error || data.message || '请求失败（' + res.status + '）');
  }
  return data;
}

/**
 * 检查认证错误：如果令牌无效或过期，清除本地登录信息并跳转到登录页
 * 返回 true 表示已处理（调用方应中止后续操作）
 */
function handleAuthError(err) {
  var msg = String(err && err.message || '');
  if (msg.indexOf('登录令牌无效') !== -1 || msg.indexOf('请先登录') !== -1 || msg.indexOf('未登录') !== -1) {
    localStorage.removeItem('frontToken');
    localStorage.removeItem('frontUsername');
    localStorage.removeItem('frontRole');
    showToast('登录已过期，请重新登录');
    setTimeout(function () {
      window.location.href = 'login.html';
    }, 1200);
    return true;
  }
  return false;
}

function decodeFooterText(parts) {
  return parts.map(function (code) { return String.fromCharCode(code); }).join('');
}

// 加密版权品牌名（码点编码存储，避免被直接搜索到）— CARSON
var PROTECTED_FOOTER_BRAND = decodeFooterText([67, 65, 82, 83, 79, 78]);
// 版权解锁码（码点编码存储）— CARSON2026
var FOOTER_UNLOCK_CODE = decodeFooterText([67, 65, 82, 83, 79, 78, 50, 48, 50, 54]);

// 解锁版权保护：在浏览器控制台输入 __unlockFooterProtection('解锁码') 即可临时解除保护
// 解锁后可修改 footer，刷新页面后保护自动恢复
window.__unlockFooterProtection = function (code) {
  if (code === FOOTER_UNLOCK_CODE) {
    window.__footerProtectionUnlocked = true;
    if (window.__globalFooterObserver) {
      window.__globalFooterObserver.disconnect();
      window.__globalFooterObserver = null;
    }
    console.log('版权保护已解锁，可临时修改。刷新页面后恢复保护。');
    return true;
  }
  console.log('解锁码错误，保护未解除。');
  return false;
};

function renderProtectedFooter() {
  var footer = document.querySelector('footer.footer');
  if (!footer) {
    footer = document.createElement('footer');
    footer.className = 'footer';
    document.body.appendChild(footer);
  }
  footer.id = 'globalFooter';
  footer.setAttribute('data-protected-footer', '1');
  // 品牌名使用模块级常量（码点编码存储，避免明文）
  var brand = PROTECTED_FOOTER_BRAND;
  var year = decodeFooterText([50, 48, 50, 54]);

  // 不再替换整个 innerHTML，改为只追加/更新版权信息，保留工具栏按钮的事件监听
  var divider = footer.querySelector('.footer-divider');
  var line1 = footer.querySelector('.global-footer-line');
  var line2 = footer.querySelector('#customFooterLine');

  if (!divider) {
    divider = document.createElement('div');
    divider.className = 'footer-divider';
    footer.appendChild(divider);
  }
  if (!line1) {
    line1 = document.createElement('p');
    line1.className = 'global-footer-line';
    footer.appendChild(line1);
  }
  line1.innerHTML = '© ' + year + ' Powered by ' +
    '<a href="https://520816.xyz" target="_blank" rel="noopener noreferrer">' + brand + '</a>';

  if (!line2) {
    line2 = document.createElement('p');
    line2.className = 'custom-footer-line';
    line2.id = 'customFooterLine';
    footer.appendChild(line2);
  }
  applyCustomFooterText(window.__customFooterText || '');
}

function applyCustomFooterText(text) {
  window.__customFooterText = text || '';
  var line = document.getElementById('customFooterLine');
  if (!line) return;
  if (window.__customFooterText) {
    line.textContent = window.__customFooterText;
    line.style.display = '';
  } else {
    line.textContent = '';
    line.style.display = 'none';
  }
}

function protectGlobalFooter() {
  renderProtectedFooter();
  if (window.__globalFooterObserver) return;

  // 防重入标志，避免 MutationObserver 无限循环
  var isRendering = false;
  // 仅监听 footer 自身的子节点变化和文本变化，不再监听整个 body 子树
  window.__globalFooterObserver = new MutationObserver(function (mutations) {
    if (isRendering) return;
    // 已解锁则不再强制恢复，允许临时修改
    if (window.__footerProtectionUnlocked) return;
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (m.type === 'childList' || m.type === 'characterData') {
        var footer = document.querySelector('footer.footer[data-protected-footer="1"]');
        if (!footer || !footer.textContent.includes(PROTECTED_FOOTER_BRAND)) {
          isRendering = true;
          renderProtectedFooter();
          isRendering = false;
          return;
        }
      }
    }
  });

  var footerEl = document.querySelector('footer.footer[data-protected-footer="1"]');
  if (footerEl) {
    window.__globalFooterObserver.observe(footerEl, {
      childList: true,
      characterData: true,
      subtree: false
    });
  }

  // 兜底：定时检查 footer 是否还在（轻量，2 秒一次）
  if (!window.__footerCheckTimer) {
    window.__footerCheckTimer = setInterval(function () {
      var footer = document.querySelector('footer.footer[data-protected-footer="1"]');
      if (!footer || !footer.textContent.includes('麦氏乡村')) {
        renderProtectedFooter();
        // 重新绑定 observer 到新 footer
        var newFooter = document.querySelector('footer.footer[data-protected-footer="1"]');
        if (newFooter && window.__globalFooterObserver) {
          window.__globalFooterObserver.observe(newFooter, {
            childList: true,
            characterData: true,
            subtree: false
          });
        }
      }
    }, 2000);
  }
}

/* ----------------------------
   站点设置与前台账号
   ---------------------------- */

/* ----------------------------
   维护模式（临时访问）玻璃弹窗
   ---------------------------- */
function checkMaintenanceMode(settings) {
  // 后台页面不受维护模式影响
  if (window.location.pathname.startsWith('/admin')) return;

  var maintenanceMode = settings.maintenanceMode === true || settings.maintenanceMode === 'true';
  if (!maintenanceMode) {
    // 维护模式关闭时，清除验证状态
    sessionStorage.removeItem('maintenanceVerified');
    // 如果之前有遮罩层，移除它
    var oldOverlay = document.getElementById('maintenanceOverlay');
    if (oldOverlay) {
      oldOverlay.remove();
      document.body.style.overflow = '';
    }
    return;
  }

  // 已验证过（本次会话）
  if (sessionStorage.getItem('maintenanceVerified') === 'true') {
    return;
  }

  // 已登录用户（管理员或普通用户）不受维护模式影响，只有游客需要输密码
  var frontToken = localStorage.getItem('frontToken');
  var frontRole = localStorage.getItem('frontRole');
  if (frontToken && (frontRole === 'admin' || frontRole === 'user')) {
    return;
  }
  // 如果有 token 但不确定角色，通过 API 验证（异步，先显示弹窗，验证通过后关闭）
  if (frontToken && !frontRole) {
    fetch('/api/user/me', {
      headers: { 'Authorization': 'Bearer ' + frontToken }
    }).then(function (res) {
      if (res.ok) return res.json();
      throw new Error('unauthorized');
    }).then(function (user) {
      // 任何有效登录用户（管理员或普通用户）都直接关闭弹窗
      if (user && (user.role === 'admin' || user.role === 'user')) {
        var overlay = document.getElementById('maintenanceOverlay');
        if (overlay) {
          overlay.remove();
          document.body.style.overflow = '';
        }
        sessionStorage.setItem('maintenanceVerified', 'true');
        localStorage.setItem('frontRole', user.role);
      }
    }).catch(function () {
      // token 无效，继续显示弹窗
    });
  }

  // 显示维护模式玻璃弹窗
  showMaintenanceGate(settings.maintenanceMessage || '网站维护中，敬请谅解');
}

function showMaintenanceGate(message) {
  // 如果已经显示了就不重复创建
  if (document.getElementById('maintenanceOverlay')) return;

  var overlay = document.createElement('div');
  overlay.id = 'maintenanceOverlay';
  overlay.className = 'maintenance-overlay';
  overlay.innerHTML =
    '<div class="maintenance-gate">' +
      '<div class="maintenance-icon">🔧</div>' +
      '<h2 class="maintenance-title">网站维护中</h2>' +
      '<p class="maintenance-message">' + escapeHTML(message) + '</p>' +
      '<form class="maintenance-form" id="maintenanceForm">' +
        '<input type="password" class="maintenance-input" id="maintenancePassword" placeholder="请输入访问密码" autocomplete="off">' +
        '<button type="submit" class="maintenance-btn" id="maintenanceSubmitBtn">进入网站</button>' +
      '</form>' +
      '<p class="maintenance-error" id="maintenanceError"></p>' +
    '</div>';

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  // 聚焦输入框
  setTimeout(function () {
    var input = document.getElementById('maintenancePassword');
    if (input) input.focus();
  }, 100);

  // 表单提交
  var form = document.getElementById('maintenanceForm');
  if (form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var input = document.getElementById('maintenancePassword');
      var btn = document.getElementById('maintenanceSubmitBtn');
      var errEl = document.getElementById('maintenanceError');
      var password = input ? input.value.trim() : '';
      if (!password) {
        if (errEl) { errEl.textContent = '请输入访问密码'; }
        return;
      }
      if (btn) { btn.disabled = true; btn.textContent = '验证中...'; }
      if (errEl) { errEl.textContent = ''; }
      try {
        var res = await fetch('/api/maintenance/verify-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: password })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || '密码错误');
        sessionStorage.setItem('maintenanceVerified', 'true');
        overlay.style.animation = 'fadeIn 0.25s ease reverse';
        setTimeout(function () {
          overlay.remove();
          document.body.style.overflow = '';
        }, 200);
      } catch (err) {
        if (errEl) { errEl.textContent = err.message || '验证失败'; }
        // 抖动效果
        var gate = document.querySelector('.maintenance-gate');
        if (gate) {
          gate.style.animation = 'none';
          gate.offsetHeight; // 触发 reflow
          gate.style.animation = 'shake 0.4s ease';
        }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '进入网站'; }
      }
    });
  }
}

// 抖动动画
var styleEl = document.createElement('style');
styleEl.textContent = '@keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-8px)} 40%,80%{transform:translateX(8px)} }';
document.head.appendChild(styleEl);

async function initSiteSettings() {
  try {
    // 先从 localStorage 读取缓存（10 分钟内有效），实现秒开
    var cachedSettings = StorageCache.get('cache_settings', 10 * 60 * 1000);
    if (cachedSettings) {
      _applySiteSettings(cachedSettings);
    }

    // 发起网络请求获取最新设置
    const settings = await fetchJSON('/api/settings', undefined, 5 * 60 * 1000); // 内存缓存 5 分钟
    // 写入 localStorage（10 分钟）
    StorageCache.set('cache_settings', settings);
    // 如果和缓存相同则跳过（避免重复渲染）
    if (!cachedSettings || !shallowEqual(cachedSettings, settings)) {
      _applySiteSettings(settings);
    }
  } catch (e) {
    // 设置加载失败时保留默认 Logo（如果有缓存则已经显示了）
  }
}

/**
 * 合并初始化：一次请求获取 settings + meta，替代分别请求 /api/settings 和 /api/meta
 * 减少首页 API 往返次数（3 → 2），通过网络预加载进一步加速
 */
async function initBootstrap() {
  try {
    const data = await fetchJSON('/api/bootstrap', undefined, 5 * 60 * 1000);
    // 应用站点设置
    var cachedSettings = StorageCache.get('cache_settings', 10 * 60 * 1000);
    StorageCache.set('cache_settings', data.settings);
    if (!cachedSettings || !shallowEqual(cachedSettings, data.settings)) {
      _applySiteSettings(data.settings);
    }
    // 应用分类栏
    var cachedMeta = StorageCache.get('cache_meta', 10 * 60 * 1000);
    StorageCache.set('cache_meta', data.meta);
    if (!cachedMeta || !shallowEqual(cachedMeta.categories, data.meta.categories)) {
      renderCategoryBar(data.meta.categories || []);
    }
  } catch (e) {
    // 回退到独立加载
    initSiteSettings();
    loadCategories();
  }
}

/** 应用站点设置到 DOM（抽离为独立函数，供缓存和网络两条路径共用） */
function _applySiteSettings(settings) {
    const siteName = settings.siteName || '麦氏乡村';
    const siteSubtitle = settings.siteSubtitle || '记录麦氏家族族谱传承、乡村风貌与乡亲故事';
    
    // 更新页面标题
    document.title = siteName + ' - ' + siteSubtitle;
    
    // 更新 Logo 显示
    document.querySelectorAll('.site-logo').forEach(function (logo) {
      logo.classList.toggle('has-custom-logo', !!settings.logo);
      logo.innerHTML = (settings.logo ? '<img class="site-logo-img" src="' + escapeHTML(settings.logo) + '" alt="' + escapeHTML(siteName) + 'Logo">' : '') +
        '<span class="site-logo-text">' + escapeHTML(siteName) + '</span>';
    });
    
    // 更新 meta description
    if (settings.description) {
      document.querySelectorAll('meta[name="description"]').forEach(function (meta) {
        meta.setAttribute('content', settings.description);
      });
    }
    
    // 更新底部文字
    applyCustomFooterText(settings.footerText || '');

    // 动态渲染导航链接
    renderNavLinks(settings.navLinks || []);

    // 保存默认封面图到全局 state，供文章列表渲染使用
    state.defaultCover = settings.defaultCover || '';
    // 保存显示模式
    state.displayMode = settings.displayMode || 'default';

    // 维护模式检查
    checkMaintenanceMode(settings);
}

function renderNavLinks(navLinks) {
  if (!navLinks || !navLinks.length) return;
  var visibleLinks = navLinks.filter(function (link) { return link.visible !== false; });
  if (!visibleLinks.length) return;

  // 更新桌面端导航
  var desktopNav = document.querySelector('.nav-links');
  if (desktopNav) {
    var currentPath = window.location.pathname.split('/').pop() || 'index.html';
    desktopNav.innerHTML = visibleLinks.map(function (link) {
      var isActive = link.url === currentPath || (currentPath === '' && link.url === 'index.html');
      return '<a href="' + escapeHTML(link.url) + '"' + (isActive ? ' class="active"' : '') + '>' + escapeHTML(link.name) + '</a>';
    }).join('');
  }

  // 更新手机端底部导航
  var mobileTabbar = document.querySelector('.mobile-tabbar');
  if (mobileTabbar) {
    var currentPath2 = window.location.pathname.split('/').pop() || 'index.html';
    // 保留原始图标映射逻辑：根据 URL 推断 tab key
    var iconMap = {
      'index.html': '⌂',
      'genealogy.html': '▲',
      'articles.html': '☰',
      'friends.html': '♡',
      'about.html': '○'
    };
    mobileTabbar.innerHTML = visibleLinks.map(function (link) {
      var icon = iconMap[link.url] || '◉';
      var isActive = link.url === currentPath2 || (currentPath2 === '' && link.url === 'index.html');
      return '<a class="mobile-tabbar-item' + (isActive ? ' active' : '') + '" href="' + escapeHTML(link.url) + '" data-tab="' + escapeHTML(link.url.replace('.html', '')) + '">' +
        '<span class="mobile-tabbar-icon">' + icon + '</span>' +
        '<span>' + escapeHTML(link.name) + '</span>' +
      '</a>';
    }).join('');
  }
}

async function refreshFrontRole() {
  var token = localStorage.getItem('frontToken');
  if (!token) return;
  try {
    var res = await fetch('/api/user/me', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) return;
    var data = await res.json();
    var newRole = data.role || 'user';
    var oldRole = localStorage.getItem('frontRole') || 'user';
    if (newRole !== oldRole) {
      localStorage.setItem('frontRole', newRole);
      initFrontAuthActions();
    }
  } catch (e) { /* 忽略网络错误，使用已存储的 role */ }
}

function initFrontAuthActions() {
  const actions = document.getElementById('authActions');
  if (!actions) return;
  const username = localStorage.getItem('frontUsername');
  const role = localStorage.getItem('frontRole') || 'user';
  if (username) {
    const initial = (username.charAt(0) || 'U').toUpperCase();
    var adminLink = role === 'admin'
      ? '<a href="/admin/login.html">后台管理</a>'
      : '';
    actions.innerHTML =
      '<div class="user-menu" id="userMenu">' +
        '<button class="user-avatar-btn" id="userAvatarBtn" type="button" aria-label="用户菜单" aria-expanded="false">' +
          escapeHTML(initial) +
        '</button>' +
        '<div class="user-dropdown" id="userDropdown">' +
          '<div class="user-dropdown-name">你好，' + escapeHTML(username) + '</div>' +
          '<a href="profile.html">个人中心</a>' +
          adminLink +
          '<button type="button" id="frontLogoutBtn">退出</button>' +
        '</div>' +
      '</div>';

    const menu = document.getElementById('userMenu');
    const avatarBtn = document.getElementById('userAvatarBtn');
    const dropdown = document.getElementById('userDropdown');
    if (avatarBtn && dropdown && menu) {
      avatarBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        const isOpen = menu.classList.toggle('open');
        avatarBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });
      document.addEventListener('click', function (e) {
        if (!menu.contains(e.target)) {
          menu.classList.remove('open');
          avatarBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }

    const logoutBtn = document.getElementById('frontLogoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        localStorage.removeItem('frontToken');
        localStorage.removeItem('frontUsername');
        localStorage.removeItem('frontRole');
        window.location.href = 'index.html';
      });
    }
  } else {
    actions.innerHTML = '<a class="auth-link auth-link-primary" href="login.html">登录</a>';
  }
}

function initProfilePage() {
  const profileName = document.getElementById('profileName');
  const profileAvatar = document.getElementById('profileAvatarLarge');
  if (!profileName || !profileAvatar) return;
  const username = localStorage.getItem('frontUsername');
  const token = localStorage.getItem('frontToken');
  if (!username || !token) {
    localStorage.removeItem('frontToken');
    localStorage.removeItem('frontUsername');
    localStorage.removeItem('frontRole');
    window.location.href = 'login.html';
    return;
  }
  profileName.textContent = username;
  profileAvatar.textContent = (username.charAt(0) || 'U').toUpperCase();

  // 加载昵称
  loadUserNickname(token);

  // 加载族谱密码申请记录
  loadUserGenoPasswordRequests(token);

  // 刷新按钮
  var refreshGenoPwdBtn = document.getElementById('refreshGenoPwdBtn');
  if (refreshGenoPwdBtn) {
    refreshGenoPwdBtn.addEventListener('click', function () {
      loadUserGenoPasswordRequests(token);
    });
  }

  // 昵称表单提交
  var nicknameForm = document.getElementById('nicknameForm');
  if (nicknameForm) {
    nicknameForm.addEventListener('submit', function (e) {
      e.preventDefault();
      saveNickname(token);
    });
  }
}

async function loadUserNickname(token) {
  try {
    var res = await fetch('/api/user/me', {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!res.ok) return;
    var data = await res.json();
    var input = document.getElementById('nicknameInput');
    if (input && data.nickname) {
      input.value = data.nickname;
    }
    // 如果角色是 admin，提示可直接发布
    var profileDesc = document.querySelector('.auth-card-desc');
    if (profileDesc && data.role === 'admin') {
      profileDesc.textContent = '你是管理员，投稿后会直接发布到前台，无需审核。你也可以在后台管理文章和族谱。';
    }
  } catch (err) {
    // 静默失败
  }
}

async function saveNickname(token) {
  var input = document.getElementById('nicknameInput');
  var msg = document.getElementById('nicknameMsg');
  var btn = document.getElementById('saveNicknameBtn');
  if (!input) return;
  var nickname = input.value.trim();
  if (msg) { msg.textContent = ''; msg.style.color = ''; }
  if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }
  try {
    var res = await fetch('/api/user/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      body: JSON.stringify({ nickname: nickname })
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || '保存失败');
    if (msg) { msg.textContent = '昵称已保存'; msg.style.color = 'var(--theme-primary)'; }
    localStorage.setItem('frontNickname', data.nickname || '');
  } catch (err) {
    if (msg) { msg.textContent = err.message || '保存失败'; msg.style.color = '#f5222d'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '保存昵称'; }
  }
}

// 加载用户的族谱密码申请记录
async function loadUserGenoPasswordRequests(token) {
  var container = document.getElementById('genoPwdRequestList');
  if (!container) return;
  container.innerHTML = '<div class="loading"><div class="spinner"></div><p>正在加载...</p></div>';
  try {
    var res = await fetch('/api/user/genealogy-password-requests', {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!res.ok) {
      if (res.status === 401) {
        container.innerHTML = '<p style="text-align:center;color:#999;padding:20px;">请先登录后查看</p>';
        return;
      }
      throw new Error('加载失败');
    }
    var list = await res.json();
    if (!list || !list.length) {
      container.innerHTML = '<p style="text-align:center;color:#999;padding:20px;">暂无申请记录，<a href="genealogy.html" class="auth-link">去申请族谱访问密码</a></p>';
      return;
    }
    container.innerHTML = list.map(function (item) {
      var statusText = '';
      var statusClass = '';
      if (item.status === 'pending') {
        statusText = '待审核';
        statusClass = 'color-orange';
      } else if (item.status === 'approved') {
        statusText = '已通过';
        statusClass = 'color-green';
      } else if (item.status === 'rejected') {
        statusText = '已拒绝';
        statusClass = 'color-red';
      }
      var reqTime = item.requestedAt ? new Date(item.requestedAt).toLocaleString('zh-CN') : '';
      var passwordHtml = '';
      if (item.status === 'approved' && item.approvedPassword) {
        passwordHtml = '<div class="geno-pwd-approved">' +
          '<span class="geno-pwd-label">访问密码：</span>' +
          '<span class="geno-pwd-value">' + escapeHTML(item.approvedPassword) + '</span>' +
          '<button class="btn btn-sm btn-ghost geno-pwd-copy" data-pwd="' + escapeHTML(item.approvedPassword) + '">复制</button>' +
          '</div>';
      }
      return '<div class="geno-pwd-item">' +
        '<div class="geno-pwd-header">' +
          '<span class="geno-pwd-name">' + escapeHTML(item.name) + '</span>' +
          '<span class="geno-pwd-status ' + statusClass + '">' + statusText + '</span>' +
        '</div>' +
        '<div class="geno-pwd-info">' +
          '<span>联系方式：' + escapeHTML(item.contact) + '</span>' +
          '<span>申请时间：' + reqTime + '</span>' +
        '</div>' +
        (item.reason ? '<div class="geno-pwd-reason">申请理由：' + escapeHTML(item.reason) + '</div>' : '') +
        passwordHtml +
        '</div>';
    }).join('');
    // 绑定复制按钮
    var copyBtns = container.querySelectorAll('.geno-pwd-copy');
    copyBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var pwd = btn.getAttribute('data-pwd') || '';
        if (pwd) {
          navigator.clipboard.writeText(pwd).then(function () {
            var originalText = btn.textContent;
            btn.textContent = '已复制';
            setTimeout(function () { btn.textContent = originalText; }, 1500);
          }).catch(function () {});
        }
      });
    });
  } catch (err) {
    container.innerHTML = '<p style="text-align:center;color:#f5222d;padding:20px;">' + escapeHTML(err.message || '加载失败') + '</p>';
  }
}

function getSubmissionStatusText(status) {
  if (status === 'approved') return t('已通过');
  if (status === 'rejected') return t('不通过');
  return t('待审核');
}

async function loadMySubmissions() {
  const list = document.getElementById('submissionList');
  if (!list) return;
  const token = localStorage.getItem('frontToken') || '';
  if (!token) {
    list.innerHTML = '<div class="empty"><p>' + t('请先登录后查看投稿。') + '</p></div>';
    return;
  }
  list.innerHTML = '<div class="loading"><div class="spinner"></div><p>' + t('正在加载投稿...') + '</p></div>';
  try {
    const res = await fetch('/api/user/submissions', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const submissions = await parseResponse(res);
    renderMySubmissions(submissions || []);
  } catch (err) {
    if (handleAuthError(err)) return;
    list.innerHTML = '<div class="error-tip"><p>' + t('投稿加载失败：') + escapeHTML(err.message) + '</p></div>';
  }
}

function renderMySubmissions(submissions) {
  const list = document.getElementById('submissionList');
  if (!list) return;
  if (!submissions.length) {
    list.innerHTML = '<div class="empty"><p>' + t('还没有投稿，写下第一篇吧。') + '</p></div>';
    return;
  }
  list.innerHTML = submissions.map(function (item) {
    const status = item.reviewStatus || (item.published ? 'approved' : 'pending');
    const statusText = getSubmissionStatusText(status);
    const statusClass = status === 'approved' ? 'approved' : (status === 'rejected' ? 'rejected' : 'pending');
    const link = status === 'approved' && item.published
      ? '<a class="auth-link" href="post.html?id=' + encodeURIComponent(item.id) + '">' + t('查看文章') + '</a>'
      : '';
    return (
      '<article class="submission-item">' +
        '<div class="submission-item-main">' +
          '<div class="submission-title-row">' +
            '<h3>' + escapeHTML(item.title || t('无标题投稿')) + '</h3>' +
            '<span class="submission-status ' + statusClass + '">' + statusText + '</span>' +
          '</div>' +
          '<p>' + escapeHTML(item.summary || t('暂无摘要')) + '</p>' +
          '<div class="submission-meta">' + formatDate(item.submittedAt || item.createdAt) + ' · ' + escapeHTML(item.category || t('投稿')) + '</div>' +
          (item.rejectionReason ? '<div class="submission-reason">' + t('原因：') + escapeHTML(item.rejectionReason) + '</div>' : '') +
        '</div>' +
        link +
      '</article>'
    );
  }).join('');
}

function initSubmissionForm() {
  const form = document.getElementById('submissionForm');
  if (!form) return;
  const btn = document.getElementById('submissionSubmitBtn');
  const msg = document.getElementById('submissionMsg');
  const refreshBtn = document.getElementById('refreshSubmissionsBtn');

  // 初始化 DZ 富文本编辑器（与后台写文章编辑器一致）
  var dzEditorInstance = null;
  var wrap = document.getElementById('dzEditorWrap');
  var textarea = document.getElementById('submissionContent');
  if (wrap && textarea && typeof window.DzEditor !== 'undefined') {
    dzEditorInstance = new window.DzEditor({
      container: wrap,
      textarea: textarea,
      placeholder: '请输入投稿正文，支持富文本排版...',
      onUploadImage: async function (file) {
        var token = localStorage.getItem('frontToken') || '';
        if (!token) throw new Error('请先登录后再上传图片');
        var formData = new FormData();
        formData.append('image', file);
        var res = await fetch('/api/user/uploads/images', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token },
          body: formData
        });
        var data = await parseResponse(res);
        return { url: data.url, html: data.html };
      }
    });
  }

  function setMsg(text, type) {
    if (!msg) return;
    msg.textContent = text || '';
    msg.className = 'friend-submit-msg' + (type ? ' ' + type : '');
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const token = localStorage.getItem('frontToken') || '';
    if (!token) {
      window.location.href = 'login.html';
      return;
    }
    // 提交前同步编辑器内容到 textarea
    if (dzEditorInstance) {
      dzEditorInstance.sync();
    }
    const data = {
      title: document.getElementById('submissionTitle').value.trim(),
      category: document.getElementById('submissionCategory').value.trim() || '投稿',
      tags: document.getElementById('submissionTags').value.trim(),
      summary: document.getElementById('submissionSummary').value.trim(),
      content: document.getElementById('submissionContent').value.trim()
    };
    if (!data.title || !data.content) {
      setMsg('请填写标题和正文', 'error');
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = '提交中...';
    }
    setMsg('', '');
    try {
      const res = await fetch('/api/user/submissions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token
        },
        body: JSON.stringify(data)
      });
      const result = await parseResponse(res);
      form.reset();
      if (dzEditorInstance) {
        dzEditorInstance.setContent('');
      }
      setMsg(result.message || '投稿已提交，请等待审核', 'success');
      loadMySubmissions();
    } catch (err) {
      setMsg(err.message || '投稿提交失败', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '提交投稿';
      }
    }
  });

  if (refreshBtn) refreshBtn.addEventListener('click', loadMySubmissions);
  loadMySubmissions();
}

// ----------------------------
// 个人中心：点赞 / 收藏列表
// ----------------------------

async function loadMyLikes() {
  var list = document.getElementById('myLikesList');
  if (!list) return;
  var token = localStorage.getItem('frontToken') || '';
  if (!token) {
    list.innerHTML = '<div class="empty"><p>' + t('请先登录后查看点赞。') + '</p></div>';
    return;
  }
  list.innerHTML = '<div class="loading"><div class="spinner"></div><p>' + t('正在加载点赞...') + '</p></div>';
  try {
    var res = await fetch('/api/user/likes', {
      headers: { Authorization: 'Bearer ' + token }
    });
    var posts = await parseResponse(res);
    renderInteractionList(list, posts || [], 'like');
  } catch (err) {
    if (handleAuthError(err)) return;
    list.innerHTML = '<div class="error-tip"><p>' + t('点赞加载失败：') + escapeHTML(err.message) + '</p></div>';
  }
}

async function loadMyFavorites() {
  var list = document.getElementById('myFavoritesList');
  if (!list) return;
  var token = localStorage.getItem('frontToken') || '';
  if (!token) {
    list.innerHTML = '<div class="empty"><p>' + t('请先登录后查看收藏。') + '</p></div>';
    return;
  }
  list.innerHTML = '<div class="loading"><div class="spinner"></div><p>' + t('正在加载收藏...') + '</p></div>';
  try {
    var res = await fetch('/api/user/favorites', {
      headers: { Authorization: 'Bearer ' + token }
    });
    var posts = await parseResponse(res);
    renderInteractionList(list, posts || [], 'favorite');
  } catch (err) {
    if (handleAuthError(err)) return;
    list.innerHTML = '<div class="error-tip"><p>' + t('收藏加载失败：') + escapeHTML(err.message) + '</p></div>';
  }
}

function renderInteractionList(container, posts, type) {
  if (!posts.length) {
    var emptyText = type === 'like' ? t('还没有点赞文章') : t('还没有收藏文章');
    container.innerHTML = '<div class="empty"><p>' + emptyText + '</p></div>';
    return;
  }
  container.innerHTML = posts.map(function (post) {
    var tagsHTML = (post.tags || []).map(function (tag) {
      return '<span class="post-detail-tag">#' + escapeHTML(tag) + '</span>';
    }).join('');
    return (
      '<article class="interaction-item" data-id="' + escapeHTML(String(post.id)) + '">' +
        '<div class="interaction-item-main">' +
          '<div class="interaction-title-row">' +
            '<h3>' + escapeHTML(post.title || '') + '</h3>' +
            '<span class="interaction-type-badge ' + type + '">' + (type === 'like' ? '赞' : '藏') + '</span>' +
          '</div>' +
          (post.summary ? '<p>' + escapeHTML(post.summary) + '</p>' : '') +
          '<div class="interaction-meta">' +
            '<span>' + escapeHTML(post.category || '未分类') + '</span>' +
            '<span class="meta-divider">·</span>' +
            '<span>' + formatDate(post.createdAt) + '</span>' +
            '<span class="meta-divider">·</span>' +
            '<span>' + (post.views || 0) + ' 次浏览</span>' +
            (tagsHTML ? '<span class="post-detail-tags">' + tagsHTML + '</span>' : '') +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }).join('');

  // 使用事件委托：只在容器上绑定一次点击事件
  if (!container._delegated) {
    container._delegated = true;
    container.addEventListener('click', function (e) {
      var item = e.target.closest('.interaction-item');
      if (!item) return;
      var id = item.getAttribute('data-id');
      if (id) window.location.href = 'post.html?id=' + encodeURIComponent(id);
    });
  }
}

function initInteractionRefresh() {
  var refreshLikesBtn = document.getElementById('refreshLikesBtn');
  var refreshFavoritesBtn = document.getElementById('refreshFavoritesBtn');
  if (refreshLikesBtn) refreshLikesBtn.addEventListener('click', loadMyLikes);
  if (refreshFavoritesBtn) refreshFavoritesBtn.addEventListener('click', loadMyFavorites);
}

function initFrontAuthForms() {
  const loginForm = document.getElementById('frontLoginForm');
  const registerForm = document.getElementById('frontRegisterForm');

  async function submitAuth(url, username, password) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password })
    });
    return parseResponse(res);
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const btn = document.getElementById('frontLoginBtn');
      const msg = document.getElementById('frontLoginMsg');
      const username = document.getElementById('loginUsername').value.trim();
      const password = document.getElementById('loginPassword').value;
      btn.disabled = true;
      btn.textContent = t('登录中...');
      msg.className = 'front-auth-msg';
      msg.textContent = '';
      try {
        const data = await submitAuth('/api/user/login', username, password);
        localStorage.setItem('frontToken', data.token);
        localStorage.setItem('frontUsername', data.username);
        localStorage.setItem('frontRole', data.role || 'user');
        msg.className = 'front-auth-msg success';
        msg.textContent = t('登录成功，正在返回首页...');
        setTimeout(function () { window.location.href = 'index.html'; }, 600);
      } catch (err) {
        msg.className = 'front-auth-msg error';
        msg.textContent = err.message || t('登录失败');
      } finally {
        btn.disabled = false;
        btn.textContent = t('登录');
      }
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const btn = document.getElementById('frontRegisterBtn');
      const msg = document.getElementById('frontRegisterMsg');
      const username = document.getElementById('registerUsername').value.trim();
      const password = document.getElementById('registerPassword').value;
      btn.disabled = true;
      btn.textContent = t('注册中...');
      msg.className = 'front-auth-msg';
      msg.textContent = '';
      try {
        const data = await submitAuth('/api/user/register', username, password);
        localStorage.setItem('frontToken', data.token);
        localStorage.setItem('frontUsername', data.username);
        localStorage.setItem('frontRole', data.role || 'user');
        msg.className = 'front-auth-msg success';
        msg.textContent = t('注册成功，正在返回首页...');
        setTimeout(function () { window.location.href = 'index.html'; }, 600);
      } catch (err) {
        msg.className = 'front-auth-msg error';
        msg.textContent = err.message || t('注册失败');
      } finally {
        btn.disabled = false;
        btn.textContent = t('注册');
      }
    });
  }
}

async function loadAboutPage() {
  const container = document.getElementById('aboutPage');
  if (!container) return;
  try {
    const about = await fetchJSON('/api/about');
    const title = about.title || '关于本站';
    document.title = title + ' - 麦氏乡村';
    container.innerHTML =
      '<section class="page-hero">' +
        '<p class="page-kicker">' + escapeHTML(about.kicker || 'About') + '</p>' +
        '<h1>' + escapeHTML(title) + '</h1>' +
        (about.summary ? '<p>' + escapeHTML(about.summary) + '</p>' : '') +
      '</section>' +
      '<div class="about-html-content">' + (about.content || '') + '</div>';
  } catch (err) {
    container.innerHTML =
      '<div class="error-tip">' +
        '<p>' + t('关于页面加载失败：') + escapeHTML(err.message) + '</p>' +
        '<button class="btn-primary retry-btn" onclick="loadAboutPage()">' + t('重新加载') + '</button>' +
      '</div>';
  }
}

/* ----------------------------
   首页逻辑
   ---------------------------- */

// 当前筛选状态
const state = {
  category: '',   // 当前选中的分类，空字符串表示「全部」
  search: '',     // 当前搜索关键词
  defaultCover: '', // 后台设置的默认封面图（无封面文章的全局封面）
  displayMode: 'default' // 前台显示模式：default|list|grid|waterfall|magazine
};

/**
 * 加载分类标签并渲染分类栏
 * 升级：localStorage 缓存（10分钟），首屏秒开
 */
async function loadCategories() {
  const bar = document.getElementById('categoryBar');
  if (!bar) return;

  // 先读缓存
  var cachedMeta = StorageCache.get('cache_meta', 10 * 60 * 1000);
  if (cachedMeta && cachedMeta.categories) {
    renderCategoryBar(cachedMeta.categories || []);
  }

  try {
    const meta = await fetchJSON('/api/meta', undefined, 5 * 60 * 1000); // 内存缓存 5 分钟
    StorageCache.set('cache_meta', meta);
    // 如果和缓存相同则跳过渲染
    if (cachedMeta && shallowEqual(cachedMeta.categories, meta.categories)) {
      return;
    }
    renderCategoryBar(meta.categories || []);
  } catch (e) {
    // 分类加载失败时至少渲染「全部」
    if (!cachedMeta) {
      renderCategoryBar([]);
    }
  }
}

/**
 * 渲染分类筛选标签栏
 */
function renderCategoryBar(categories) {
  const bar = document.getElementById('categoryBar');
  if (!bar) return;
  const all = [t('全部')].concat(categories);
  bar.innerHTML = all.map(function (cat) {
    const isActive = (cat === t('全部') && state.category === '') || cat === state.category;
    return '<button class="category-tag' + (isActive ? ' active' : '') +
      '" data-category="' + (cat === t('全部') ? '' : escapeHTML(cat)) + '">' +
      escapeHTML(cat) + '</button>';
  }).join('');

  // 使用事件委托：只在容器上绑定一次点击事件
  if (!bar._delegated) {
    bar._delegated = true;
    bar.addEventListener('click', function (e) {
      var tag = e.target.closest('.category-tag');
      if (!tag) return;
      state.category = tag.getAttribute('data-category');
      // 切换分类时清空搜索框，避免筛选条件叠加混乱
      state.search = '';
      var searchInput = document.getElementById('searchInput');
      if (searchInput) searchInput.value = '';
      // 更新激活态
      bar.querySelectorAll('.category-tag').forEach(function (el) { el.classList.remove('active'); });
      tag.classList.add('active');
      loadPosts();
    });
  }
}

/**
 * 加载文章列表并渲染
 * 升级：
 *   - 首屏先显示骨架屏，提升感知速度
 *   - 优先从 localStorage 缓存读取旧数据（5分钟内有效），实现秒开
 *   - 同时发起网络请求，拿到新数据后替换
 */
async function loadPosts() {
  const app = document.getElementById('app');
  if (!app) return;

  // 拼接查询参数
  // 注意：对 category 和 search 额外 encodeURIComponent 一次（双重编码）
  // 原因：沙箱代理会解码 percent-encoded 中文字符为原始 UTF-8 字节，导致 Node.js HTTP parser 返回 400
  // 双重编码后：代理解码一层 → Express 解码一层 → 得到原始中文
  const params = new URLSearchParams();
  if (app.getAttribute('data-home-only') === 'true') params.append('home', '1');
  if (state.category) params.append('category', encodeURIComponent(state.category));
  if (state.search) params.append('search', encodeURIComponent(state.search));
  const query = params.toString();
  const url = '/api/posts' + (query ? '?' + query : '');
  const cacheKey = 'cache_posts_' + query; // localStorage 缓存 key

  // ---- 策略1：优先显示骨架屏（首屏视觉反馈） ----
  if (!app._hasRendered) {
    app.innerHTML = buildSkeletonHTML(6, state.displayMode);
  }

  // ---- 策略2：localStorage 缓存秒开（5 分钟内有效） ----
  var cachedPosts = StorageCache.get(cacheKey, 5 * 60 * 1000);
  if (cachedPosts && cachedPosts.length) {
    // 有缓存：立即渲染缓存数据，让用户先看到内容
    renderPostList(cachedPosts);
    app._hasRendered = true;
  }

  // ---- 策略3：发起网络请求获取最新数据 ----
  try {
    // 搜索请求不做内存缓存（用户期望最新结果），其他请求缓存 30 秒
    var ttl = state.search ? 0 : 30 * 1000;
    const posts = await fetchJSON(url, undefined, ttl);

    // 写入 localStorage 缓存（5分钟）
    StorageCache.set(cacheKey, posts);

    // 与缓存相同则跳过渲染（避免不必要的 DOM 操作）
    if (cachedPosts && cachedPosts.length === posts.length && shallowEqual(cachedPosts, posts)) {
      return;
    }

    renderPostList(posts);
    app._hasRendered = true;
  } catch (e) {
    // 网络失败时，清除该请求的缓存，避免下次仍返回错误缓存
    StorageCache.remove(cacheKey);
    RequestCache.clearCache(url);
    // 如果已有缓存数据则继续显示缓存，不显示错误
    if (cachedPosts && cachedPosts.length) {
      // 已经显示了缓存，静默失败即可
      return;
    }
    app.innerHTML =
      '<div class="error-tip">' +
        '<p>加载失败：' + escapeHTML(e.message) + '</p>' +
        '<button class="btn-primary retry-btn" onclick="loadPosts()">重新加载</button>' +
      '</div>';
  }
}

async function loadAnnouncements() {
  const section = document.getElementById('announcementSection');
  if (!section) return;

  // 先读 localStorage 缓存（5 分钟）
  var cachedAnnouncements = StorageCache.get('cache_announcements', 5 * 60 * 1000);
  if (cachedAnnouncements && cachedAnnouncements.length) {
    renderAnnouncements(cachedAnnouncements);
  } else {
    section.innerHTML =
      '<div class="announcement-card announcement-loading">' +
        '<div class="spinner"></div>' +
        '<p>正在加载网站公告...</p>' +
      '</div>';
  }

  try {
    const announcements = await fetchJSON('/api/announcements?limit=5', undefined, 60 * 1000); // 内存缓存 1 分钟
    StorageCache.set('cache_announcements', announcements || []);
    if (cachedAnnouncements && shallowEqual(cachedAnnouncements, announcements)) {
      return;
    }
    renderAnnouncements(announcements || []);
  } catch (e) {
    if (!cachedAnnouncements) {
      section.innerHTML = '';
    }
  }
}

function renderAnnouncements(announcements) {
  const section = document.getElementById('announcementSection');
  if (!section) return;
  if (!announcements.length) {
    section.innerHTML = '';
    return;
  }
  section.innerHTML =
    '<div class="announcement-card">' +
      '<div class="announcement-header">' +
        '<span class="announcement-icon">公告</span>' +
        '<div>' +
          '<h2>网站公告</h2>' +
          '<p>这里显示站点通知，与普通文章列表分开展示。</p>' +
        '</div>' +
      '</div>' +
      '<div class="announcement-list">' +
        announcements.map(function (item) {
          return (
            '<article class="announcement-item" data-id="' + escapeHTML(String(item.id)) + '">' +
              '<div class="announcement-title-row">' +
                (item.pinned ? '<span class="post-pin-badge">置顶</span>' : '') +
                '<h3>' + escapeHTML(item.title || '无标题公告') + '</h3>' +
              '</div>' +
              (item.summary ? '<p>' + escapeHTML(item.summary) + '</p>' : '') +
              '<div class="announcement-meta">' + formatDate(item.createdAt) + ' · ' + (item.views || 0) + ' 次浏览</div>' +
            '</article>'
          );
        }).join('') +
      '</div>' +
    '</div>';

  // 使用事件委托：只需在容器上绑定一次点击事件，避免每次渲染重复绑定导致监听器泄漏
  if (!section._clickDelegated) {
    section._clickDelegated = true;
    section.addEventListener('click', function (e) {
      var item = e.target.closest('.announcement-item');
      if (!item) return;
      var id = item.getAttribute('data-id');
      if (id) window.location.href = 'post.html?id=' + encodeURIComponent(id);
    });
  }
}

/**
 * 封面样式池：无封面图文章从中「随机抽取」或「自定义」选取
 *   - theme  : 跟随主题色（默认）
 *   - aurora : 极光（蓝紫）
 *   - sunset : 日落（橙红）
 *   - sea    : 深海（青蓝）
 *   - dusk   : 暮色（紫粉）
 *   - forest : 森林（绿青）
 *   - starry : 星空（深蓝靛）
 *   - warm   : 暖阳（黄橙）
 */
var COVER_STYLES = ['theme', 'aurora', 'sunset', 'sea', 'dusk', 'forest', 'starry', 'warm'];

/**
 * 解析文章的封面样式
 *   - 自定义：post.coverStyle 为 COVER_STYLES 中的有效值时直接使用
 *   - 随机  ：否则按 post.id（回退 title）做哈希，稳定抽取一种样式
 */
function resolveCoverStyle(post) {
  var custom = (post && typeof post.coverStyle === 'string') ? post.coverStyle.trim() : '';
  if (custom && COVER_STYLES.indexOf(custom) !== -1) return custom;
  var seed = String((post && post.id) || (post && post.title) || '');
  var hash = 0;
  for (var i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return COVER_STYLES[hash % COVER_STYLES.length];
}

/**
 * 生成无封面图文章的占位封面卡片 HTML
 */
function makeCoverPlaceholder(post) {
  var style = resolveCoverStyle(post);
  var initial = (post.title || 'A').trim().charAt(0) || 'A';
  return (
    '<div class="post-card-cover post-card-cover--placeholder cover-style-' + escapeHTML(style) + '">' +
      '<span class="post-card-cover__deco post-card-cover__deco--1"></span>' +
      '<span class="post-card-cover__deco post-card-cover__deco--2"></span>' +
      '<span class="post-card-cover__initial">' + escapeHTML(initial) + '</span>' +
      (post.category ? '<span class="post-card-cover__cat">' + escapeHTML(post.category) + '</span>' : '') +
    '</div>'
  );
}

/**
 * 渲染文章列表卡片（根据后台设置的 displayMode 选择布局）
 * 升级：
 *   - 超过 20 篇时自动启用虚拟列表（Virtual List）
 *   - 保留原始全量渲染作为 fallback
 *   - 渲染后激活 IntersectionObserver 图片懒加载
 */
var _virtualListInstance = null; // 虚拟列表实例全局引用

function renderPostList(posts) {
  const app = document.getElementById('app');
  if (!app) return;

  if (!posts || posts.length === 0) {
    // 销毁旧虚拟列表
    if (_virtualListInstance) {
      _virtualListInstance.destroy();
      _virtualListInstance = null;
    }
    app.innerHTML =
      '<div class="empty">' +
        '<p>' + t('暂无文章') + '</p>' +
      '</div>';
    return;
  }

  // 切换容器布局类
  var mode = state.displayMode || 'default';
  var layoutClass = 'post-list layout-' + mode;
  app.className = layoutClass;

  // 根据模式选择渲染器函数
  var renderItemFn = _getItemRenderer(mode);

  // 判断是否启用虚拟列表：仅在 articles.html 页面（非首页）且文章数 > 20 时启用
  var isArticlesPage = app.getAttribute('data-home-only') !== 'true';
  var useVirtual = isArticlesPage && posts.length > 20 && 'IntersectionObserver' in window;

  if (useVirtual) {
    // 销毁旧实例
    if (_virtualListInstance) {
      _virtualListInstance.destroy();
      _virtualListInstance = null;
    }
    // 创建新虚拟列表
    _virtualListInstance = VirtualList.create({
      container: app,
      items: posts,
      itemHeight: _estimateItemHeight(mode),
      buffer: 5,
      threshold: 20,
      renderItem: function (item, index) {
        var html = renderItemFn(item, index);
        // 在 article.post-card 上注入 data-index 属性（用于高度测量）
        return html.replace(
          /class="post-card([^"]*)"/,
          'class="post-card$1" data-index="' + index + '"'
        );
      }
    });

    // 虚拟列表渲染后延迟激活懒加载
    requestAnimationFrame(function () {
      _activateLazyImages(app);
    });
  } else {
    // 非虚拟列表：全量渲染（保留原有行为）
    if (_virtualListInstance) {
      _virtualListInstance.destroy();
      _virtualListInstance = null;
    }

    var html = '';
    switch (mode) {
      case 'list':
        html = renderListLayout(posts);
        break;
      case 'grid':
        html = renderGridLayout(posts);
        break;
      case 'waterfall':
        html = renderWaterfallLayout(posts);
        break;
      case 'magazine':
        html = renderMagazineLayout(posts);
        break;
      default:
        html = renderDefaultLayout(posts);
        break;
    }

    // 使用 requestAnimationFrame 让浏览器批量处理布局变更，减少渲染卡顿
    requestAnimationFrame(function () {
      app.innerHTML = html;
      // 渲染后立即激活图片懒加载
      _activateLazyImages(app);
    });
  }

  // 使用事件委托：只需在容器上绑定一次点击事件
  // （如果尚未绑定过）
  if (!app._clickDelegated) {
    app._clickDelegated = true;
    app.addEventListener('click', function (e) {
      var card = e.target.closest('.post-card');
      if (!card) return;
      var id = card.getAttribute('data-id');
      if (id) window.location.href = 'post.html?id=' + encodeURIComponent(id);
    });
    // 封面图加载失败时回退为占位卡片（事件委托，捕获阶段）
    app.addEventListener('error', function (e) {
      var img = e.target;
      if (!img || !img.classList || !img.classList.contains('post-card-cover')) return;
      var style = img.getAttribute('data-style') || 'theme';
      var initial = img.getAttribute('data-initial') || 'A';
      var cat = img.getAttribute('data-cat') || '';
      var ph = document.createElement('div');
      ph.className = 'post-card-cover post-card-cover--placeholder cover-style-' + style;
      ph.innerHTML =
        '<span class="post-card-cover__deco post-card-cover__deco--1"></span>' +
        '<span class="post-card-cover__deco post-card-cover__deco--2"></span>' +
        '<span class="post-card-cover__initial">' + escapeHTML(initial) + '</span>' +
        (cat ? '<span class="post-card-cover__cat">' + escapeHTML(cat) + '</span>' : '');
      if (img.parentNode) img.parentNode.replaceChild(ph, img);
    }, true);
  }
}

/** 获取指定模式的单项渲染函数（供虚拟列表使用） */
function _getItemRenderer(mode) {
  switch (mode) {
    case 'list':
      return function (post, i) { return renderListLayout([post]); };
    case 'grid':
      return function (post, i) { return renderGridLayout([post]); };
    case 'waterfall':
      return function (post, i) { return renderWaterfallLayout([post]); };
    case 'magazine':
      // magazine 模式首篇特殊，这里简化为默认 grid
      return function (post, i) {
        return i === 0 ? renderMagazineLayout([post]) : renderGridLayout([post]);
      };
    default:
      return function (post, i) { return renderDefaultLayout([post]); };
  }
}

/** 估算不同布局模式下单项高度（供虚拟列表使用） */
function _estimateItemHeight(mode) {
  switch (mode) {
    case 'list': return 160;
    case 'grid': return 280;
    case 'waterfall': return 320;
    case 'magazine': return 260;
    default: return 240;
  }
}

/** 激活容器内所有懒加载图片 */
function _activateLazyImages(container) {
  if (!container) return;
  var imgs = container.querySelectorAll('img[data-src]');
  if (imgs.length) {
    LazyImage.observe(imgs);
  }
}

/* ---- 封面与公共片段生成 ---- */

// 生成封面 HTML（图片或占位卡片）
// 升级：使用 IntersectionObserver 懒加载，data-src 存真实地址，src 用低质量占位图
function buildCoverHTML(post, extraClass) {
  var cls = extraClass ? (' ' + extraClass) : '';
  var coverSrc = post.firstImage || post.cover || state.defaultCover || '';
  if (coverSrc) {
    // 懒加载：src 为模糊占位（1px 透明 base64），真实地址放 data-src
    // 加载完成后添加 lazy-loaded 类实现淡入效果
    return (
      '<img class="post-card-cover' + cls + ' lazy-image" ' +
      'src="data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 4 3\'><rect width=\'100%\' height=\'100%\' fill=\'%23f0f0f0\'/></svg>" ' +
      'data-src="' + escapeHTML(coverSrc) + '" ' +
      'alt="' + escapeHTML(post.title) + '" ' +
      'data-style="' + escapeHTML(resolveCoverStyle(post)) + '" ' +
      'data-initial="' + escapeHTML((post.title || 'A').trim().charAt(0) || 'A') + '" ' +
      'data-cat="' + escapeHTML(post.category || '') + '">'
    );
  }
  // 占位卡片也需要带上 extraClass
  var placeholder = makeCoverPlaceholder(post);
  if (extraClass) {
    placeholder = placeholder.replace('post-card-cover--placeholder', 'post-card-cover--placeholder ' + extraClass);
  }
  return placeholder;
}

// 生成标签 HTML
function buildTagsHTML(post) {
  return (post.tags || []).map(function (tag) {
    return '<span class="post-detail-tag">#' + escapeHTML(tag) + '</span>';
  }).join('');
}

// 生成元信息行 HTML
function buildMetaHTML(post) {
  return (
    '<div class="post-card-meta">' +
      '<span class="post-card-category">' + escapeHTML(post.category || '未分类') + '</span>' +
      '<span class="meta-divider">·</span>' +
      '<span class="post-card-meta-item">' + formatDate(post.createdAt) + '</span>' +
      '<span class="meta-divider">·</span>' +
      '<span class="post-card-meta-item">' + (post.views || 0) + ' 次浏览</span>' +
    '</div>'
  );
}

/* ---- 默认模式（当前封面卡片纵向列表） ---- */
function renderDefaultLayout(posts) {
  return posts.map(function (post) {
    var coverHTML = buildCoverHTML(post);
    var tagsHTML = buildTagsHTML(post);
    return (
      '<article class="post-card" data-id="' + escapeHTML(post.id) + '">' +
        coverHTML +
        '<div class="post-card-title-row">' +
          (post.pinned ? '<span class="post-pin-badge">置顶</span>' : '') +
          '<h2 class="post-card-title">' + escapeHTML(post.title) + '</h2>' +
        '</div>' +
        (post.summary ? '<p class="post-card-summary">' + escapeHTML(post.summary) + '</p>' : '') +
        '<div class="post-card-meta">' +
          '<span class="post-card-category">' + escapeHTML(post.category || '未分类') + '</span>' +
          '<span class="meta-divider">·</span>' +
          '<span class="post-card-meta-item">' + formatDate(post.createdAt) + '</span>' +
          '<span class="meta-divider">·</span>' +
          '<span class="post-card-meta-item">' + (post.views || 0) + ' 次浏览</span>' +
          (tagsHTML ? '<span class="post-detail-tags">' + tagsHTML + '</span>' : '') +
        '</div>' +
      '</article>'
    );
  }).join('');
}

/* ---- 传统列表模式（图文左右排列） ---- */
function renderListLayout(posts) {
  return posts.map(function (post, i) {
    var coverHTML = buildCoverHTML(post, 'post-card-cover--list');
    var tagsHTML = buildTagsHTML(post);
    return (
      '<article class="post-card post-card--list" data-id="' + escapeHTML(post.id) + '">' +
        '<div class="post-card--list-cover">' +
          coverHTML +
        '</div>' +
        '<div class="post-card--list-body">' +
          '<div class="post-card-title-row">' +
            (post.pinned ? '<span class="post-pin-badge">置顶</span>' : '') +
            '<h2 class="post-card-title">' + escapeHTML(post.title) + '</h2>' +
          '</div>' +
          (post.summary ? '<p class="post-card-summary">' + escapeHTML(post.summary) + '</p>' : '') +
          '<div class="post-card-meta">' +
            '<span class="post-card-category">' + escapeHTML(post.category || '未分类') + '</span>' +
            '<span class="meta-divider">·</span>' +
            '<span class="post-card-meta-item">' + formatDate(post.createdAt) + '</span>' +
            '<span class="meta-divider">·</span>' +
            '<span class="post-card-meta-item">' + (post.views || 0) + ' 次浏览</span>' +
            (tagsHTML ? '<span class="post-detail-tags">' + tagsHTML + '</span>' : '') +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }).join('');
}

/* ---- 固定网格卡片模式（等大网格） ---- */
function renderGridLayout(posts) {
  return posts.map(function (post) {
    var coverHTML = buildCoverHTML(post, 'post-card-cover--grid');
    var tagsHTML = buildTagsHTML(post);
    return (
      '<article class="post-card post-card--grid" data-id="' + escapeHTML(post.id) + '">' +
        coverHTML +
        '<div class="post-card--grid-body">' +
          '<div class="post-card-title-row">' +
            (post.pinned ? '<span class="post-pin-badge">置顶</span>' : '') +
            '<h2 class="post-card-title">' + escapeHTML(post.title) + '</h2>' +
          '</div>' +
          (post.summary ? '<p class="post-card-summary post-card-summary--grid">' + escapeHTML(post.summary) + '</p>' : '') +
          '<div class="post-card-meta">' +
            '<span class="post-card-meta-item">' + formatDate(post.createdAt) + '</span>' +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }).join('');
}

/* ---- 瀑布流模式（不等高流式排列） ---- */
function renderWaterfallLayout(posts) {
  // 用 CSS columns 实现瀑布流，直接输出卡片即可
  return posts.map(function (post) {
    var coverHTML = buildCoverHTML(post, 'post-card-cover--waterfall');
    var tagsHTML = buildTagsHTML(post);
    return (
      '<article class="post-card post-card--waterfall" data-id="' + escapeHTML(post.id) + '">' +
        coverHTML +
        '<div class="post-card-title-row">' +
          (post.pinned ? '<span class="post-pin-badge">置顶</span>' : '') +
          '<h2 class="post-card-title">' + escapeHTML(post.title) + '</h2>' +
        '</div>' +
        (post.summary ? '<p class="post-card-summary">' + escapeHTML(post.summary) + '</p>' : '') +
        '<div class="post-card-meta">' +
          '<span class="post-card-category">' + escapeHTML(post.category || '未分类') + '</span>' +
          '<span class="meta-divider">·</span>' +
          '<span class="post-card-meta-item">' + formatDate(post.createdAt) + '</span>' +
        '</div>' +
      '</article>'
    );
  }).join('');
}

/* ---- 杂志混合布局模式（大图特写 + 小图列表） ---- */
function renderMagazineLayout(posts) {
  if (posts.length === 0) return '';
  var html = '';

  // 第一篇文章作为大图特写
  var feature = posts[0];
  var featureCover = buildCoverHTML(feature, 'post-card-cover--magazine-feature');
  var featureTags = buildTagsHTML(feature);
  html += (
    '<article class="post-card post-card--magazine-feature" data-id="' + escapeHTML(feature.id) + '">' +
      '<div class="post-card--magazine-feature-cover">' +
        featureCover +
        '<div class="post-card--magazine-feature-overlay">' +
          '<div class="post-card-title-row">' +
            (feature.pinned ? '<span class="post-pin-badge">置顶</span>' : '') +
            '<h2 class="post-card-title post-card-title--magazine-feature">' + escapeHTML(feature.title) + '</h2>' +
          '</div>' +
          (feature.summary ? '<p class="post-card-summary post-card-summary--magazine-feature">' + escapeHTML(feature.summary) + '</p>' : '') +
          '<div class="post-card-meta">' +
            '<span class="post-card-category">' + escapeHTML(feature.category || '未分类') + '</span>' +
            '<span class="meta-divider">·</span>' +
            '<span class="post-card-meta-item">' + formatDate(feature.createdAt) + '</span>' +
            '<span class="meta-divider">·</span>' +
            '<span class="post-card-meta-item">' + (feature.views || 0) + ' 次浏览</span>' +
            (featureTags ? '<span class="post-detail-tags">' + featureTags + '</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</article>'
  );

  // 其余文章作为小图卡片网格
  var rest = posts.slice(1);
  if (rest.length > 0) {
    html += '<div class="magazine-grid">';
    rest.forEach(function (post) {
      var coverHTML = buildCoverHTML(post, 'post-card-cover--magazine-small');
      var tagsHTML = buildTagsHTML(post);
      html += (
        '<article class="post-card post-card--magazine-small" data-id="' + escapeHTML(post.id) + '">' +
          coverHTML +
          '<div class="post-card--grid-body">' +
            '<div class="post-card-title-row">' +
              (post.pinned ? '<span class="post-pin-badge">置顶</span>' : '') +
              '<h2 class="post-card-title">' + escapeHTML(post.title) + '</h2>' +
            '</div>' +
            (post.summary ? '<p class="post-card-summary post-card-summary--grid">' + escapeHTML(post.summary) + '</p>' : '') +
            '<div class="post-card-meta">' +
              '<span class="post-card-meta-item">' + formatDate(post.createdAt) + '</span>' +
            '</div>' +
          '</div>' +
        '</article>'
      );
    });
    html += '</div>';
  }

  return html;
}

/* ----------------------------
   搜索功能
   ---------------------------- */

function initSearch() {
  const input = document.getElementById('searchInput');
  const btn = document.getElementById('searchBtn');
  if (!input) return;

  function doSearch() {
    state.search = input.value.trim();
    // 搜索时清除分类选中态
    state.category = '';
    const bar = document.getElementById('categoryBar');
    if (bar) {
      bar.querySelectorAll('.category-tag').forEach(function (el) { el.classList.remove('active'); });
      const allTag = bar.querySelector('.category-tag[data-category=""]');
      if (allTag) allTag.classList.add('active');
    }
    loadPosts();
  }

  // 搜索防抖：用户输入时延迟 300ms 触发搜索，避免每次按键都发请求
  var debouncedSearch = debounce(doSearch, 300);
  input.addEventListener('input', function () {
    debouncedSearch();
  });

  // 回车触发搜索（立即执行，跳过防抖延迟）
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      debouncedSearch.cancel();
      doSearch();
    }
  });

  // 搜索按钮触发
  if (btn) {
    btn.addEventListener('click', function () {
      debouncedSearch.cancel();
      doSearch();
    });
  }

  // 注册清理：页面卸载时取消防抖定时器
  CleanupRegistry.register(function () {
    debouncedSearch.cancel();
  });
}

/* ----------------------------
   手机端底部导航
   ---------------------------- */

function initMobileTabbar() {
  const tabbar = document.querySelector('.mobile-tabbar');
  if (!tabbar) return;

  const path = window.location.pathname.split('/').pop() || 'index.html';
  const hash = window.location.hash;
  let activeTab = 'home';

  if (path === 'articles.html' || path === 'post.html' || hash === '#articles') {
    activeTab = 'articles';
  } else if (path === 'friends.html') {
    activeTab = 'friends';
  } else if (path === 'about.html') {
    activeTab = 'about';
  }

  tabbar.querySelectorAll('.mobile-tabbar-item').forEach(function (item) {
    item.classList.toggle('active', item.getAttribute('data-tab') === activeTab);
  });
}

/* ----------------------------
   友链页面逻辑
   ---------------------------- */

async function loadFriends() {
  const grid = document.getElementById('friendGrid');
  if (!grid) return;

  // 先读 localStorage 缓存（10 分钟）
  var cachedFriends = StorageCache.get('cache_friends', 10 * 60 * 1000);
  if (cachedFriends && cachedFriends.length) {
    renderFriends(cachedFriends);
  } else {
    grid.innerHTML =
      '<div class="loading">' +
        '<div class="spinner"></div>' +
        '<p>正在加载友链...</p>' +
      '</div>';
  }

  try {
    const friends = await fetchJSON('/api/friends', undefined, 2 * 60 * 1000); // 内存缓存 2 分钟
    StorageCache.set('cache_friends', friends || []);
    if (cachedFriends && JSON.stringify(cachedFriends) === JSON.stringify(friends)) {
      return;
    }
    renderFriends(friends || []);
  } catch (e) {
    if (cachedFriends && cachedFriends.length) return; // 有缓存则静默失败
    grid.innerHTML =
      '<div class="error-tip">' +
        '<p>友链加载失败：' + escapeHTML(e.message) + '</p>' +
        '<button class="btn-primary retry-btn" onclick="loadFriends()">重新加载</button>' +
      '</div>';
  }
}

function renderFriends(friends) {
  const grid = document.getElementById('friendGrid');
  if (!grid) return;
  if (!friends.length) {
    grid.innerHTML = '<div class="empty"><p>暂无审核通过的友链</p></div>';
    return;
  }

  grid.innerHTML = friends.map(function (friend) {
    var icon = friend.avatar || friend.iconUrl || '';
    var avatar = icon
      // 升级：使用 IntersectionObserver 懒加载
      ? '<img class="friend-avatar lazy-image" src="data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 1 1\'><rect width=\'100%\' height=\'100%\' fill=\'%23f0f0f0\'/></svg>" data-src="' + escapeHTML(icon) + '" alt="' + escapeHTML(friend.name || '友链') + '头像">'
      : '<div class="friend-avatar avatar-placeholder">' + escapeHTML((friend.name || '友').slice(0, 1).toUpperCase()) + '</div>';
    return (
      '<a class="friend-card" href="' + escapeHTML(friend.url || '#') + '" target="_blank" rel="noopener noreferrer">' +
        avatar +
        '<div class="friend-info">' +
          '<h3>' + escapeHTML(friend.name || '未命名站点') + '</h3>' +
          '<p>' + escapeHTML(friend.description || '这个朋友还没有留下签名') + '</p>' +
        '</div>' +
      '</a>'
    );
  }).join('');

  // 渲染后激活懒加载
  requestAnimationFrame(function () {
    _activateLazyImages(grid);
  });
}

function initFriendSubmit() {
  const form = document.getElementById('friendSubmitForm');
  if (!form) return;
  const avatarInput = document.getElementById('friendAvatar');
  const submitBtn = document.getElementById('friendSubmitBtn');
  const msg = document.getElementById('friendSubmitMsg');

  function setMsg(text, type) {
    if (!msg) return;
    msg.textContent = text || '';
    msg.className = 'friend-submit-msg' + (type ? ' ' + type : '');
  }

  if (avatarInput) {
    avatarInput.addEventListener('change', function () {
      const file = avatarInput.files && avatarInput.files[0];
      if (file && file.size > 1024 * 1024) {
        avatarInput.value = '';
        setMsg('头像图片不能大于 1MB', 'error');
      } else {
        setMsg('', '');
      }
    });
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const file = avatarInput && avatarInput.files && avatarInput.files[0];
    if (file && file.size > 1024 * 1024) {
      setMsg('头像图片不能大于 1MB', 'error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '提交中...';
    }
    setMsg('', '');

    try {
      const formData = new FormData(form);
      const res = await fetch('/api/friends', {
        method: 'POST',
        body: formData
      });
      const data = await parseResponse(res);
      form.reset();
      setMsg(data.message || '已提交，请等待审核', 'success');
    } catch (err) {
      setMsg(err.message || '提交失败，请稍后再试', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '提交审核';
      }
    }
  });
}

/* ----------------------------
   文章详情页逻辑
   ---------------------------- */

/**
 * 从 URL 参数获取文章 id
 */
function getPostIdFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

/**
 * 加载并渲染文章详情
 */
async function loadPostDetail() {
  const container = document.getElementById('postDetail');
  if (!container) return;

  const id = getPostIdFromURL();
  if (!id) {
    container.innerHTML =
      '<div class="error-tip">' +
        '<p>未指定文章 ID</p>' +
        '<a class="btn-primary retry-btn" href="index.html">返回首页</a>' +
      '</div>';
    return;
  }

  // 加载状态
  container.innerHTML =
    '<div class="loading">' +
      '<div class="spinner"></div>' +
      '<p>正在加载文章...</p>' +
    '</div>';

  try {
    const post = await fetchJSON('/api/posts/' + encodeURIComponent(id));
    renderPostDetail(post);
  } catch (e) {
    container.innerHTML =
      '<div class="error-tip">' +
        '<p>加载失败：' + escapeHTML(e.message) + '</p>' +
        '<a class="btn-primary retry-btn" href="index.html">返回首页</a>' +
      '</div>';
  }
}

/**
 * 渲染文章详情
 */
function renderPostDetail(post) {
  const container = document.getElementById('postDetail');
  if (!container) return;

  // 文档标题同步文章标题
  document.title = (post.title || '文章详情') + ' - 麦氏乡村';

  var tagsHTML = (post.tags || []).map(function (tag) {
    return '<span class="post-detail-tag">#' + escapeHTML(tag) + '</span>';
  }).join('');

  // 获取本地存储的点赞和收藏状态
  var postId = post.id || '';
  var likedPosts = JSON.parse(localStorage.getItem('likedPosts') || '[]');
  var favoritedPosts = JSON.parse(localStorage.getItem('favoritedPosts') || '[]');
  var isLiked = likedPosts.includes(postId);
  var isFavorited = favoritedPosts.includes(postId);

  container.innerHTML =
    '<button class="back-btn" onclick="history.back()">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<polyline points="15 18 9 12 15 6"></polyline>' +
      '</svg>' +
      '返回' +
    '</button>' +
    '<div class="post-detail-title-row">' +
      (post.announcement ? '<span class="post-pin-badge announcement-detail-badge">网站公告</span>' : '') +
      (post.pinned ? '<span class="post-pin-badge">置顶</span>' : '') +
      '<h1 class="post-detail-title">' + escapeHTML(post.title || '') + '</h1>' +
    '</div>' +
    '<div class="post-detail-meta">' +
      '<span class="post-card-category">' + escapeHTML(post.category || '未分类') + '</span>' +
      '<span class="post-detail-author">' + escapeHTML(post.author || 'Admin') + '</span>' +
      '<span class="meta-divider">·</span>' +
      '<span>' + formatDate(post.createdAt) + '</span>' +
      '<span class="meta-divider">·</span>' +
      '<span>' + (post.views || 0) + ' 次浏览</span>' +
      (tagsHTML ? '<span class="post-detail-tags">' + tagsHTML + '</span>' : '') +
    '</div>' +
    // 文章正文：content 为受信任的 HTML（后台编辑器产出），直接渲染
    '<div class="post-content">' + (post.content || '') + '</div>' +
    // 点赞、收藏、分享按钮
    '<div class="post-actions-bar">' +
      '<button class="post-action-btn" id="likeBtn" data-post-id="' + escapeHTML(postId) + '" data-liked="' + (isLiked ? 'true' : 'false') + '">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="' + (isLiked ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>' +
        '</svg>' +
        '<span>' + (isLiked ? t('已点赞') : t('点赞')) + '</span>' +
      '</button>' +
      '<button class="post-action-btn" id="favoriteBtn" data-post-id="' + escapeHTML(postId) + '" data-favorited="' + (isFavorited ? 'true' : 'false') + '">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="' + (isFavorited ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>' +
        '</svg>' +
        '<span>' + (isFavorited ? t('已收藏') : t('收藏')) + '</span>' +
      '</button>' +
      '<button class="post-action-btn" id="shareBtn" data-post-id="' + escapeHTML(postId) + '">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<circle cx="18" cy="5" r="3"></circle>' +
          '<circle cx="6" cy="12" r="3"></circle>' +
          '<circle cx="18" cy="19" r="3"></circle>' +
          '<line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>' +
          '<line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>' +
        '</svg>' +
        '<span>' + t('分享') + '</span>' +
      '</button>' +
    '</div>' +
    '<div class="post-detail-footer">' +
      '<a class="btn-primary" href="index.html">返回首页</a>' +
    '</div>' +
    '<div class="comment-section" id="postCommentSection" data-target-type="post" data-post-id="' + escapeHTML(String(post.id || '')) + '">' +
    '</div>';

  // 为文章正文图片添加懒加载与淡入效果
  var postContent = container.querySelector('.post-content');
  if (postContent) {
    var detailImages = postContent.querySelectorAll('img');
    if (detailImages.length) {
      detailImages.forEach(function (img) {
        // 将真实 src 移到 data-src，替换为模糊占位
        var realSrc = img.getAttribute('src');
        if (realSrc && !img.hasAttribute('data-src')) {
          img.setAttribute('data-src', realSrc);
          img.setAttribute('src', 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 4 3\'><rect width=\'100%\' height=\'100%\' fill=\'%23f0f0f0\'/></svg>');
          img.classList.add('lazy-image');
        }
      });
      // 使用统一的 LazyImage 模块（IntersectionObserver + 200px 预加载）
      LazyImage.observe(postContent.querySelectorAll('img[data-src]'));
    }
    // 注入淡入样式（仅注入一次）
    if (!document.getElementById('post-img-lazy-style')) {
      var styleEl = document.createElement('style');
      styleEl.id = 'post-img-lazy-style';
      styleEl.textContent =
        '.lazy-image{opacity:0;filter:blur(8px);transition:opacity .4s ease, filter .4s ease;will-change:opacity,filter}' +
        '.lazy-image.lazy-loaded{opacity:1;filter:blur(0)}' +
        '.post-card--skeleton{background:transparent!important;box-shadow:none!important;padding:0!important}' +
        '.skeleton-line{background:linear-gradient(90deg,#f0f0f0 25%,#e0e0e0 37%,#f0f0f0 63%);background-size:400% 100%;animation:skeleton-shine 1.4s ease infinite;border-radius:4px}' +
        '.skeleton-line--cover{width:100%;height:180px;margin-bottom:12px;border-radius:8px}' +
        '.skeleton-line--title{width:70%;height:20px;margin-bottom:8px}' +
        '.skeleton-line--text{width:100%;height:14px;margin-bottom:6px}' +
        '.skeleton-line--text:last-of-type{width:60%}' +
        '.skeleton-line--meta{width:40%;height:12px;margin-top:8px}' +
        '@keyframes skeleton-shine{0%{background-position:100% 50%}100%{background-position:0 50%}}' +
        '[data-theme="dark"] .skeleton-line{background:linear-gradient(90deg,#2a2a2a 25%,#333 37%,#2a2a2a 63%);background-size:400% 100%}' +
        '[data-theme="dark"] .lazy-image{filter:blur(8px) brightness(0.8)}';
      document.head.appendChild(styleEl);
    }
  }

  // 绑定点赞、收藏、分享事件
  initPostActions(postId);
  initCommentSection(document.getElementById('postCommentSection'));
}

/**
 * 初始化文章详情页的点赞、收藏、分享功能
 */
function initPostActions(postId) {
  var likeBtn = document.getElementById('likeBtn');
  var favoriteBtn = document.getElementById('favoriteBtn');
  var shareBtn = document.getElementById('shareBtn');

  var token = localStorage.getItem('frontToken') || '';
  var isLoggedIn = !!token;

  // 登录用户：从服务器加载初始点赞/收藏状态
  if (isLoggedIn) {
    syncInteractionStatus(postId);
  }

  if (likeBtn) {
    likeBtn.addEventListener('click', function() {
      if (isLoggedIn) {
        toggleLikeServer(postId, likeBtn);
      } else {
        toggleLikeLocal(postId, likeBtn);
      }
    });
  }

  if (favoriteBtn) {
    favoriteBtn.addEventListener('click', function() {
      if (isLoggedIn) {
        toggleFavoriteServer(postId, favoriteBtn);
      } else {
        toggleFavoriteLocal(postId, favoriteBtn);
      }
    });
  }

  if (shareBtn) {
    shareBtn.addEventListener('click', function() {
      var url = window.location.href;
      var title = document.title;

      if (navigator.share) {
        navigator.share({
          title: title,
          url: url
        }).catch(function(err) {
          copyToClipboard(url);
        });
      } else {
        copyToClipboard(url);
      }
    });
  }
}

// 登录用户：从服务器同步点赞/收藏状态到按钮
async function syncInteractionStatus(postId) {
  try {
    var token = localStorage.getItem('frontToken') || '';
    var res = await fetch('/api/user/interactions', {
      headers: { Authorization: 'Bearer ' + token }
    });
    var data = await parseResponse(res);
    var likedPostIds = data.likedPostIds || [];
    var favoritedPostIds = data.favoritedPostIds || [];
    var likeBtn = document.getElementById('likeBtn');
    var favoriteBtn = document.getElementById('favoriteBtn');

    // 将 localStorage 中有但服务器没有的点赞/收藏同步到服务器
    var localLiked = JSON.parse(localStorage.getItem('likedPosts') || '[]');
    var localFavorited = JSON.parse(localStorage.getItem('favoritedPosts') || '[]');
    var pendingLikes = localLiked.filter(function(id) { return likedPostIds.indexOf(id) === -1; });
    var pendingFavorites = localFavorited.filter(function(id) { return favoritedPostIds.indexOf(id) === -1; });
    if (pendingLikes.length) {
      pendingLikes.forEach(function(id) {
        fetch('/api/user/likes/' + encodeURIComponent(id), {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token }
        }).catch(function() {});
      });
      likedPostIds = likedPostIds.concat(pendingLikes);
    }
    if (pendingFavorites.length) {
      pendingFavorites.forEach(function(id) {
        fetch('/api/user/favorites/' + encodeURIComponent(id), {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token }
        }).catch(function() {});
      });
      favoritedPostIds = favoritedPostIds.concat(pendingFavorites);
    }

    if (likeBtn) {
      var isLiked = likedPostIds.indexOf(postId) !== -1;
      likeBtn.setAttribute('data-liked', isLiked ? 'true' : 'false');
      likeBtn.querySelector('svg').setAttribute('fill', isLiked ? 'currentColor' : 'none');
      likeBtn.querySelector('span').textContent = isLiked ? t('已点赞') : t('点赞');
    }

    if (favoriteBtn) {
      var isFavorited = favoritedPostIds.indexOf(postId) !== -1;
      favoriteBtn.setAttribute('data-favorited', isFavorited ? 'true' : 'false');
      favoriteBtn.querySelector('svg').setAttribute('fill', isFavorited ? 'currentColor' : 'none');
      favoriteBtn.querySelector('span').textContent = isFavorited ? t('已收藏') : t('收藏');
    }
  } catch (e) {
    if (handleAuthError(e)) return;
    // 非认证错误时回退到 localStorage
    applyLocalInteractionStatus(postId);
  }
}

// 未登录用户：从 localStorage 应用状态到按钮
function applyLocalInteractionStatus(postId) {
  var likedPosts = JSON.parse(localStorage.getItem('likedPosts') || '[]');
  var favoritedPosts = JSON.parse(localStorage.getItem('favoritedPosts') || '[]');
  var likeBtn = document.getElementById('likeBtn');
  var favoriteBtn = document.getElementById('favoriteBtn');

  if (likeBtn) {
    var isLiked = likedPosts.indexOf(postId) !== -1;
    likeBtn.setAttribute('data-liked', isLiked ? 'true' : 'false');
    likeBtn.querySelector('svg').setAttribute('fill', isLiked ? 'currentColor' : 'none');
    likeBtn.querySelector('span').textContent = isLiked ? t('已点赞') : t('点赞');
  }

  if (favoriteBtn) {
    var isFavorited = favoritedPosts.indexOf(postId) !== -1;
    favoriteBtn.setAttribute('data-favorited', isFavorited ? 'true' : 'false');
    favoriteBtn.querySelector('svg').setAttribute('fill', isFavorited ? 'currentColor' : 'none');
    favoriteBtn.querySelector('span').textContent = isFavorited ? t('已收藏') : t('收藏');
  }
}

// 登录用户：通过服务器切换点赞
async function toggleLikeServer(postId, likeBtn) {
  var token = localStorage.getItem('frontToken') || '';
  var svg = likeBtn.querySelector('svg');
  var span = likeBtn.querySelector('span');
  likeBtn.disabled = true;
  try {
    var res = await fetch('/api/user/likes/' + encodeURIComponent(postId), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token }
    });
    var data = await parseResponse(res);
    if (data.liked) {
      likeBtn.setAttribute('data-liked', 'true');
      svg.setAttribute('fill', 'currentColor');
      span.textContent = t('已点赞');
    } else {
      likeBtn.setAttribute('data-liked', 'false');
      svg.setAttribute('fill', 'none');
      span.textContent = t('点赞');
    }
    // 同步到 localStorage，保持登录/登出后状态一致
    updateLocalInteraction('likedPosts', postId, data.liked);
    showToast(data.message || (data.liked ? '点赞成功' : '已取消点赞'));
  } catch (e) {
    if (handleAuthError(e)) return;
    showToast(e.message || '操作失败');
  } finally {
    likeBtn.disabled = false;
  }
}

// 登录用户：通过服务器切换收藏
async function toggleFavoriteServer(postId, favoriteBtn) {
  var token = localStorage.getItem('frontToken') || '';
  var svg = favoriteBtn.querySelector('svg');
  var span = favoriteBtn.querySelector('span');
  favoriteBtn.disabled = true;
  try {
    var res = await fetch('/api/user/favorites/' + encodeURIComponent(postId), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token }
    });
    var data = await parseResponse(res);
    if (data.favorited) {
      favoriteBtn.setAttribute('data-favorited', 'true');
      svg.setAttribute('fill', 'currentColor');
      span.textContent = t('已收藏');
    } else {
      favoriteBtn.setAttribute('data-favorited', 'false');
      svg.setAttribute('fill', 'none');
      span.textContent = t('收藏');
    }
    // 同步到 localStorage，保持登录/登出后状态一致
    updateLocalInteraction('favoritedPosts', postId, data.favorited);
    showToast(data.message || (data.favorited ? '收藏成功' : '已取消收藏'));
  } catch (e) {
    if (handleAuthError(e)) return;
    showToast(e.message || '操作失败');
  } finally {
    favoriteBtn.disabled = false;
  }
}

// 工具函数：更新 localStorage 中的点赞/收藏状态
function updateLocalInteraction(key, postId, isActive) {
  var arr = JSON.parse(localStorage.getItem(key) || '[]');
  var idx = arr.indexOf(postId);
  if (isActive && idx === -1) {
    arr.push(postId);
  } else if (!isActive && idx !== -1) {
    arr.splice(idx, 1);
  }
  localStorage.setItem(key, JSON.stringify(arr));
}

// 未登录用户：通过 localStorage 切换点赞
function toggleLikeLocal(postId, likeBtn) {
  var likedPosts = JSON.parse(localStorage.getItem('likedPosts') || '[]');
  var isLiked = likedPosts.indexOf(postId) !== -1;
  var svg = likeBtn.querySelector('svg');
  var span = likeBtn.querySelector('span');

  if (isLiked) {
    likedPosts = likedPosts.filter(function(id) { return id !== postId; });
    likeBtn.setAttribute('data-liked', 'false');
    svg.setAttribute('fill', 'none');
    span.textContent = t('点赞');
  } else {
    likedPosts.push(postId);
    likeBtn.setAttribute('data-liked', 'true');
    svg.setAttribute('fill', 'currentColor');
    span.textContent = t('已点赞');
    showToast('登录后可在个人中心查看点赞记录');
  }
  localStorage.setItem('likedPosts', JSON.stringify(likedPosts));
}

// 未登录用户：通过 localStorage 切换收藏
function toggleFavoriteLocal(postId, favoriteBtn) {
  var favoritedPosts = JSON.parse(localStorage.getItem('favoritedPosts') || '[]');
  var isFavorited = favoritedPosts.indexOf(postId) !== -1;
  var svg = favoriteBtn.querySelector('svg');
  var span = favoriteBtn.querySelector('span');

  if (isFavorited) {
    favoritedPosts = favoritedPosts.filter(function(id) { return id !== postId; });
    favoriteBtn.setAttribute('data-favorited', 'false');
    svg.setAttribute('fill', 'none');
    span.textContent = t('收藏');
  } else {
    favoritedPosts.push(postId);
    favoriteBtn.setAttribute('data-favorited', 'true');
    svg.setAttribute('fill', 'currentColor');
    span.textContent = t('已收藏');
    showToast('登录后可在个人中心查看收藏记录');
  }
  localStorage.setItem('favoritedPosts', JSON.stringify(favoritedPosts));
}

/**
 * 复制文本到剪贴板
 */
function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(function() {
      showToast('链接已复制到剪贴板');
    }).catch(function() {
      fallbackCopyToClipboard(text);
    });
  } else {
    fallbackCopyToClipboard(text);
  }
}

function fallbackCopyToClipboard(text) {
  var textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.top = '0';
  textArea.style.left = '0';
  textArea.style.width = '2em';
  textArea.style.height = '2em';
  textArea.style.padding = '0';
  textArea.style.border = 'none';
  textArea.style.outline = 'none';
  textArea.style.boxShadow = 'none';
  textArea.style.background = 'transparent';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    document.execCommand('copy');
    showToast('链接已复制到剪贴板');
  } catch (err) {
    showToast('复制失败，请手动复制链接');
  }

  document.body.removeChild(textArea);
}

/**
 * 显示提示信息
 */
function showToast(message) {
  var toast = document.createElement('div');
  toast.className = 'toast-message';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(function() {
    toast.classList.add('show');
  }, 10);

  setTimeout(function() {
    toast.classList.remove('show');
    setTimeout(function() {
      document.body.removeChild(toast);
    }, 300);
  }, 2000);
}

// 翻译辅助函数
function t(text) {
  return window.translateText ? window.translateText(text) : text;
}

// 暴露刷新动态内容函数供 toolbar.js 调用
window.refreshDynamicContent = function() {
  // 重新渲染文章列表（如果在文章列表页）
  if (document.getElementById('app')) {
    loadPosts();
  }
  // 重新渲染留言区
  document.querySelectorAll('.comment-section[data-ready="1"]').forEach(function(section) {
    section.dataset.ready = '0';
    initCommentSection(section);
  });
};

/* ----------------------------
   留言区逻辑
   ---------------------------- */

function getFrontUser() {
  return {
    token: localStorage.getItem('frontToken') || '',
    username: localStorage.getItem('frontUsername') || ''
  };
}

const wechatEmojiList = [
  '😀', '😄', '😊', '😉', '😍', '😘', '😋', '😎',
  '😢', '😭', '😡', '😳', '😴', '😷', '🤔', '😅',
  '👍', '👎', '👏', '🙏', '💪', '👌', '🤝', '🙌',
  '❤️', '💔', '🌹', '🎉', '🎁', '🔥', '⭐', '☕'
];

function renderWechatEmojiPicker() {
  return '<div class="emoji-picker" data-role="emoji-picker">' +
    wechatEmojiList.map(function (emoji) {
      return '<button type="button" class="emoji-item" data-emoji="' + escapeHTML(emoji) + '">' + escapeHTML(emoji) + '</button>';
    }).join('') +
    '</div>';
}

function insertTextAtCursor(textarea, text) {
  if (!textarea) return;
  var start = textarea.selectionStart || 0;
  var end = textarea.selectionEnd || 0;
  var value = textarea.value || '';
  textarea.value = value.slice(0, start) + text + value.slice(end);
  var nextPos = start + text.length;
  textarea.focus();
  textarea.setSelectionRange(nextPos, nextPos);
}

function renderCommentShell(section) {
  if (!section || section.dataset.ready === '1') return;
  const targetType = section.getAttribute('data-target-type') || 'home';
  const sectionId = section.id;
  const title = targetType === 'post' ? t('文章留言') : (sectionId === 'aboutCommentSection' ? t('留言反馈') : t('主页留言'));
  const user = getFrontUser();
  section.dataset.page = '1';
  section.dataset.ready = '1';
  section.innerHTML =
    '<div class="comment-header">' +
      '<div>' +
        '<h2>' + title + '</h2>' +
        '<p>' + t('欢迎留下想法，触碰审核关键词的留言会在管理员通过后显示。') + '</p>' +
      '</div>' +
    '</div>' +
    '<form class="comment-form" data-role="comment-form">' +
      (!user.username ? '<input type="text" class="comment-input" name="authorName" maxlength="30" placeholder="' + t('游客昵称（可选）') + '">' : '<div class="comment-user-tip">' + t('当前以「') + escapeHTML(user.username) + t('」身份留言') + '</div>') +
      '<textarea class="comment-textarea" name="content" maxlength="1000" placeholder="' + t('写下你的留言...') + '" required></textarea>' +
      '<div class="emoji-toolbar">' +
        '<button type="button" class="emoji-toggle" data-role="emoji-toggle">表情</button>' +
        renderWechatEmojiPicker() +
      '</div>' +
      '<div class="comment-actions">' +
        '<button type="submit" class="btn-primary">' + t('提交留言') + '</button>' +
        '<span class="comment-msg" data-role="comment-msg"></span>' +
      '</div>' +
    '</form>' +
    '<div class="comment-list" data-role="comment-list">' +
      '<div class="loading"><div class="spinner"></div><p>' + t('正在加载留言...') + '</p></div>' +
    '</div>' +
    '<div class="comment-pagination" data-role="comment-pagination"></div>';
}

async function loadCommentsForSection(section, page) {
  if (!section) return;
  page = Math.max(1, Number(page) || 1);
  section.dataset.page = String(page);
  const list = section.querySelector('[data-role="comment-list"]');
  const pager = section.querySelector('[data-role="comment-pagination"]');
  if (list) {
    list.innerHTML = '<div class="loading"><div class="spinner"></div><p>' + t('正在加载留言...') + '</p></div>';
  }
  if (pager) pager.innerHTML = '';

  const targetType = section.getAttribute('data-target-type') || 'home';
  const postId = section.getAttribute('data-post-id') || '';
  const params = new URLSearchParams({ targetType: targetType, page: String(page) });
  if (targetType === 'post') params.append('postId', postId);

  try {
    const data = await fetchJSON('/api/comments?' + params.toString());
    renderComments(section, data);
  } catch (err) {
    if (list) list.innerHTML = '<div class="error-tip"><p>' + t('留言加载失败：') + escapeHTML(err.message) + '</p></div>';
  }
}

function renderComments(section, data) {
  const list = section.querySelector('[data-role="comment-list"]');
  const pager = section.querySelector('[data-role="comment-pagination"]');
  const comments = data.comments || [];
  if (!list || !pager) return;

  if (!comments.length) {
    list.innerHTML = '<div class="empty comment-empty"><p>' + t('暂无留言，来做第一个留言的人吧。') + '</p></div>';
  } else {
    list.innerHTML = comments.map(function (comment) {
      return (
        '<div class="comment-item">' +
          '<div class="comment-avatar">' + escapeHTML((comment.authorName || '游').slice(0, 1).toUpperCase()) + '</div>' +
          '<div class="comment-body">' +
            '<div class="comment-meta">' +
              '<span class="comment-author">' + escapeHTML(comment.authorName || '游客') + '</span>' +
              '<span>' + formatDate(comment.createdAt) + '</span>' +
            '</div>' +
            '<div class="comment-content">' + escapeHTML(comment.content || '') + '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  if ((data.totalPages || 1) <= 1) {
    pager.innerHTML = '';
    return;
  }
  var current = Number(data.page) || 1;
  var totalPages = Number(data.totalPages) || 1;
  pager.innerHTML =
    '<button class="comment-page-btn" data-page="' + (current - 1) + '"' + (current <= 1 ? ' disabled' : '') + '>上一页</button>' +
    '<span class="comment-page-info">第 ' + current + ' / ' + totalPages + ' 页，共 ' + (data.total || 0) + ' 条</span>' +
    '<button class="comment-page-btn" data-page="' + (current + 1) + '"' + (current >= totalPages ? ' disabled' : '') + '>下一页</button>';
}

function initCommentSection(section) {
  if (!section) return;
  renderCommentShell(section);
  const form = section.querySelector('[data-role="comment-form"]');
  const msg = section.querySelector('[data-role="comment-msg"]');
  const pager = section.querySelector('[data-role="comment-pagination"]');
  const targetType = section.getAttribute('data-target-type') || 'home';
  const postId = section.getAttribute('data-post-id') || '';
  const emojiToggle = section.querySelector('[data-role="emoji-toggle"]');
  const emojiPicker = section.querySelector('[data-role="emoji-picker"]');
  const commentTextarea = form ? form.elements.content : null;

  if (emojiToggle && emojiPicker && emojiPicker.dataset.bound !== '1') {
    emojiPicker.dataset.bound = '1';
    emojiToggle.addEventListener('click', function () {
      emojiPicker.classList.toggle('show');
    });
    emojiPicker.addEventListener('click', function (e) {
      const emojiBtn = e.target.closest('.emoji-item');
      if (!emojiBtn) return;
      insertTextAtCursor(commentTextarea, emojiBtn.getAttribute('data-emoji') || '');
    });
  }

  if (form && form.dataset.bound !== '1') {
    form.dataset.bound = '1';
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const user = getFrontUser();
      const btn = form.querySelector('button[type="submit"]');
      const content = form.elements.content.value.trim();
      const authorName = form.elements.authorName ? form.elements.authorName.value.trim() : '';
      if (!content) {
        if (msg) msg.textContent = '请输入留言内容';
        return;
      }
      if (btn) {
        btn.disabled = true;
        btn.textContent = '提交中...';
      }
      if (msg) {
        msg.className = 'comment-msg';
        msg.textContent = '';
      }
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (user.token) headers.Authorization = 'Bearer ' + user.token;
        const res = await fetch('/api/comments', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ targetType: targetType, postId: postId, authorName: authorName, content: content })
        });
        const data = await parseResponse(res);
        form.reset();
        if (msg) {
          msg.className = 'comment-msg success';
          msg.textContent = data.message || '留言发布成功';
        }
        loadCommentsForSection(section, 1);
      } catch (err) {
        if (msg) {
          msg.className = 'comment-msg error';
          msg.textContent = err.message || '提交失败';
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '提交留言';
        }
      }
    });
  }

  if (pager && pager.dataset.bound !== '1') {
    pager.dataset.bound = '1';
    pager.addEventListener('click', function (e) {
      const btn = e.target.closest('.comment-page-btn');
      if (!btn || btn.disabled) return;
      loadCommentsForSection(section, Number(btn.getAttribute('data-page')) || 1);
    });
  }

  loadCommentsForSection(section, Number(section.dataset.page) || 1);
}

/* ----------------------------
   族谱金字塔页面
   ---------------------------- */

// 构建父子树：parentId -> [people]
function buildGenealogyTree(people) {
  var byParent = {};
  var i;
  for (i = 0; i < people.length; i++) {
    var p = people[i];
    var key = p.parentId || '__root__';
    if (!byParent[key]) byParent[key] = [];
    byParent[key].push(p);
  }
  Object.keys(byParent).forEach(function (k) {
    byParent[k].sort(function (a, b) {
      return (a.generation || 0) - (b.generation || 0) || (a.name || '').localeCompare(b.name || '');
    });
  });
  return byParent;
}

/* ---- 大树图谱状态 ---- */
var genoPeople = [];
var genoByParent = {};
var genoExpanded = {};       // { id: true } 已展开的节点
var genoPersonMap = {};      // id -> person
var genoCardW = 170;
var genoCardH = 108;
var genoHGap = 28;
var genoVGap = 72;

/* 构建树节点（含children） */
function buildGenoTree() {
  var roots = genoByParent['__root__'] || [];
  if (!roots.length) {
    var sorted = genoPeople.slice().sort(function (a, b) { return (a.generation || 99) - (b.generation || 99); });
    roots = sorted.length ? [sorted[0]] : [];
  }
  function makeNode(person) {
    var kids = genoByParent[person.id] || [];
    var childNodes = [];
    for (var i = 0; i < kids.length; i++) {
      childNodes.push(makeNode(kids[i]));
    }
    return { person: person, children: childNodes };
  }
  if (!roots.length) return null;
  return makeNode(roots[0]);
}

/* 递归计算子树宽度 */
function calcSubtreeWidth(node) {
  if (!node.children.length || !genoExpanded[node.person.id]) {
    node._w = genoCardW;
    return genoCardW;
  }
  var w = 0;
  for (var i = 0; i < node.children.length; i++) {
    w += calcSubtreeWidth(node.children[i]);
    if (i < node.children.length - 1) w += genoHGap;
  }
  node._w = Math.max(genoCardW, w);
  return node._w;
}

/* 分配坐标（x为节点中心，y为节点顶部） */
function assignGenoPositions(node, centerX, depth) {
  node._x = centerX;
  node._y = depth * (genoCardH + genoVGap);
  if (!node.children.length || !genoExpanded[node.person.id]) return;
  var totalCW = 0;
  for (var i = 0; i < node.children.length; i++) {
    totalCW += node.children[i]._w;
    if (i < node.children.length - 1) totalCW += genoHGap;
  }
  var cursor = centerX - totalCW / 2;
  for (var j = 0; j < node.children.length; j++) {
    var child = node.children[j];
    var childCenter = cursor + child._w / 2;
    assignGenoPositions(child, childCenter, depth + 1);
    cursor += child._w + genoHGap;
  }
}

/* 收集所有可见节点 */
function collectVisibleNodes(node, arr) {
  arr.push(node);
  if (node.children.length && genoExpanded[node.person.id]) {
    for (var i = 0; i < node.children.length; i++) {
      collectVisibleNodes(node.children[i], arr);
    }
  }
}

/* 收集所有可见连接（parent -> child） */
function collectVisibleEdges(node, arr) {
  if (node.children.length && genoExpanded[node.person.id]) {
    for (var i = 0; i < node.children.length; i++) {
      arr.push({ parent: node, child: node.children[i] });
      collectVisibleEdges(node.children[i], arr);
    }
  }
}

/* 限制可见节点数为20，超出时自动折叠最早的节点 */
var genoLastExpanded = null; // 记录最后展开的节点，避免被立即折叠
var genoShowAll = false; // 是否显示所有节点（全部展开时启用）

function enforceVisibleLimit(tree, maxNodes) {
  // 如果启用了"全部展开"模式，则不限制节点数
  if (genoShowAll) return;
  
  var nodes = [];
  collectVisibleNodes(tree, nodes);
  if (nodes.length <= maxNodes) return;
  
  // 按世代+插入顺序排序，最早的节点排在前面
  var sorted = nodes.slice().sort(function (a, b) {
    var ga = a.person.generation || 0;
    var gb = b.person.generation || 0;
    if (ga !== gb) return ga - gb;
    return (a.person.id || 0) - (b.person.id || 0);
  });
  
  // 折叠最早的节点直到只剩 maxNodes，但保护最后展开的节点
  var toRemove = sorted.length - maxNodes;
  var removed = 0;
  for (var i = 0; i < sorted.length && removed < toRemove; i++) {
    var node = sorted[i];
    // 跳过最后展开的节点
    if (genoLastExpanded && node.person.id === genoLastExpanded) continue;
    // 只折叠有子节点且已展开的
    if (node.children && node.children.length && genoExpanded[node.person.id]) {
      delete genoExpanded[node.person.id];
      removed++;
    }
  }
}

/* 渲染单张卡片 */
function renderGenoCard(person) {
  var safeName = escapeHTML(person.name || '');
  var safeTitle = person.title ? escapeHTML(person.title) : '';
  var safeBirth = person.birthDate ? escapeHTML(person.birthDate) : '';
  var gen = person.generation || '';
  var children = genoByParent[person.id] || [];
  var hasChildren = children.length > 0;
  var isExpanded = !!genoExpanded[person.id];

  var html = '<div class="geno-tree-card" data-id="' + escapeHTML(String(person.id)) + '">';
  html += '<div class="geno-tree-card-inner" data-action="detail" data-id="' + escapeHTML(String(person.id)) + '">';
  html += '<div class="geno-tree-card-top">';
  html += '<span class="geno-tree-gen">第' + escapeHTML(String(gen)) + '世</span>';
  if (safeTitle) html += '<span class="geno-tree-title">' + safeTitle + '</span>';
  html += '</div>';
  html += '<div class="geno-tree-name">' + safeName + '</div>';
  if (safeBirth) html += '<div class="geno-tree-date">' + safeBirth + '</div>';
  html += '</div>';
  if (hasChildren) {
    html += '<button type="button" class="geno-tree-toggle" data-action="toggle" data-id="' + escapeHTML(String(person.id)) + '">' + (isExpanded ? '−' : '+') + '</button>';
  }
  html += '</div>';
  return html;
}

/* 渲染大树图谱 */
function renderGenealogyTree(data) {
  var container = document.getElementById('genealogyPyramid');
  if (!container) return;
  genoPeople = data.people || [];
  genoByParent = buildGenealogyTree(genoPeople);
  genoPersonMap = {};
  for (var i = 0; i < genoPeople.length; i++) {
    genoPersonMap[genoPeople[i].id] = genoPeople[i];
  }
  /* 同步到 window 供内联脚本访问 */
  window.genoPeople = genoPeople;
  window.genoByParent = genoByParent;
  window.genoPersonMap = genoPersonMap;
  window.genoExpanded = genoExpanded;

  var countEl = document.getElementById('genealogyCount');
  if (countEl) countEl.textContent = '共 ' + genoPeople.length + ' 位先祖';

  if (!genoPeople.length) {
    container.innerHTML = '<div class="empty"><p>族谱暂无人物，请在后台族谱管理中添加。</p></div>';
    return;
  }

  var tree = buildGenoTree();
  if (!tree) {
    container.innerHTML = '<div class="empty"><p>族谱数据异常，未找到始祖。</p></div>';
    return;
  }

  /* 响应式卡片尺寸 */
  var winW = window.innerWidth || document.documentElement.clientWidth || 0;
  if (winW <= 640) {
    genoCardW = 120; genoCardH = 80; genoHGap = 16; genoVGap = 50;
  } else if (winW <= 1024) {
    genoCardW = 150; genoCardH = 100; genoHGap = 20; genoVGap = 64;
  } else {
    genoCardW = 170; genoCardH = 108; genoHGap = 28; genoVGap = 72;
  }

  /* 限制可见节点数为20（所有设备） */
  enforceVisibleLimit(tree, 20);

  calcSubtreeWidth(tree);
  assignGenoPositions(tree, tree._w / 2, 0);

  var nodes = [];
  collectVisibleNodes(tree, nodes);
  var edges = [];
  collectVisibleEdges(tree, edges);

  var minX = Infinity, maxX = -Infinity, maxY = 0;
  for (var n = 0; n < nodes.length; n++) {
    var nd = nodes[n];
    if (nd._x - genoCardW / 2 < minX) minX = nd._x - genoCardW / 2;
    if (nd._x + genoCardW / 2 > maxX) maxX = nd._x + genoCardW / 2;
    if (nd._y + genoCardH > maxY) maxY = nd._y + genoCardH;
  }
  var totalW = maxX - minX + 40;
  var totalH = maxY + 40;
  var offsetX = -minX + 20;

  /* SVG 连接线 */
  var svgW = totalW;
  var svgH = totalH;
  var svgPaths = '';
  for (var e = 0; e < edges.length; e++) {
    var pn = edges[e].parent;
    var cn = edges[e].child;
    var px = pn._x + offsetX;
    var py = pn._y + genoCardH;
    var cx = cn._x + offsetX;
    var cy = cn._y;
    var midY = (py + cy) / 2;
    var d = 'M ' + px + ',' + py + ' C ' + px + ',' + midY + ' ' + cx + ',' + midY + ' ' + cx + ',' + cy;
    svgPaths += '<path d="' + d + '" class="geno-tree-line" />';
  }

  var html = '<div class="geno-tree-scroll" id="genoTreeScroll">';
  html += '<div class="geno-tree-canvas" id="genoTreeCanvas" style="width:' + totalW + 'px;height:' + totalH + 'px;position:relative;">';
  html += '<svg class="geno-tree-svg" width="' + svgW + '" height="' + svgH + '" style="position:absolute;left:0;top:0;pointer-events:none;">';
  html += svgPaths;
  html += '</svg>';

  for (var c = 0; c < nodes.length; c++) {
    var node = nodes[c];
    var left = node._x - genoCardW / 2 + offsetX;
    var top = node._y;
    html += '<div class="geno-tree-card-wrap" style="position:absolute;left:' + left + 'px;top:' + top + 'px;width:' + genoCardW + 'px;">';
    html += renderGenoCard(node.person);
    html += '</div>';
  }

  html += '</div>';
  html += '</div>';
  // 缩放控件
  html += '<div class="geno-zoom-controls" id="genoZoomControls">';
  html += '<button class="geno-zoom-btn" id="genoZoomIn" title="放大">+</button>';
  html += '<button class="geno-zoom-btn" id="genoZoomOut" title="缩小">−</button>';
  html += '<button class="geno-zoom-btn" id="genoZoomReset" title="重置" style="font-size:14px;">⟲</button>';
  html += '</div>';
  html += '<div class="geno-zoom-hint" id="genoZoomHint"></div>';
  container.innerHTML = html;

  bindGenoTreeEvents(container);
  initGenoZoom();
}

/* 缩放平移功能 */
var genoZoomScale = 1;
var genoZoomPanX = 0;
var genoZoomPanY = 0;
var genoZoomDragging = false;
var genoZoomDragStartX = 0;
var genoZoomDragStartY = 0;
var genoZoomHintTimer = null;

function initGenoZoom() {
  var canvas = document.getElementById('genoTreeCanvas');
  var scroll = document.getElementById('genoTreeScroll');
  if (!canvas || !scroll) return;

  var zoomInBtn = document.getElementById('genoZoomIn');
  var zoomOutBtn = document.getElementById('genoZoomOut');
  var zoomResetBtn = document.getElementById('genoZoomReset');

  function applyTransform() {
    canvas.style.transform = 'translate(' + genoZoomPanX + 'px,' + genoZoomPanY + 'px) scale(' + genoZoomScale + ')';
  }

  function showHint(text) {
    var hint = document.getElementById('genoZoomHint');
    if (hint) {
      hint.textContent = text;
      hint.classList.add('show');
      clearTimeout(genoZoomHintTimer);
      genoZoomHintTimer = setTimeout(function() { hint.classList.remove('show'); }, 1500);
    }
  }

  function zoomTo(scale, cx, cy) {
    var oldScale = genoZoomScale;
    genoZoomScale = Math.max(0.1, Math.min(5, scale));
    if (cx !== undefined && cy !== undefined) {
      genoZoomPanX = cx - (cx - genoZoomPanX) * (genoZoomScale / oldScale);
      genoZoomPanY = cy - (cy - genoZoomPanY) * (genoZoomScale / oldScale);
    }
    applyTransform();
    showHint(Math.round(genoZoomScale * 100) + '%');
  }

  if (zoomInBtn) zoomInBtn.addEventListener('click', function() { zoomTo(genoZoomScale * 1.3); });
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', function() { zoomTo(genoZoomScale / 1.3); });
  if (zoomResetBtn) zoomResetBtn.addEventListener('click', function() {
    genoZoomScale = 1; genoZoomPanX = 0; genoZoomPanY = 0;
    applyTransform();
    showHint('100%');
  });

  // 鼠标滚轮缩放
  scroll.addEventListener('wheel', function(e) {
    e.preventDefault();
    var rect = scroll.getBoundingClientRect();
    var cx = e.clientX - rect.left;
    var cy = e.clientY - rect.top;
    var delta = e.deltaY > 0 ? 0.9 : 1.1;
    zoomTo(genoZoomScale * delta, cx, cy);
  }, { passive: false });

  // 鼠标拖拽平移
  scroll.addEventListener('mousedown', function(e) {
    if (e.target.closest('.geno-tree-card') || e.target.closest('.geno-zoom-controls') || e.target.closest('.geno-zoom-btn')) return;
    genoZoomDragging = true;
    genoZoomDragStartX = e.clientX - genoZoomPanX;
    genoZoomDragStartY = e.clientY - genoZoomPanY;
    scroll.style.cursor = 'grabbing';
    e.preventDefault();
  });

  document.addEventListener('mousemove', function(e) {
    if (!genoZoomDragging) return;
    genoZoomPanX = e.clientX - genoZoomDragStartX;
    genoZoomPanY = e.clientY - genoZoomDragStartY;
    applyTransform();
  });

  document.addEventListener('mouseup', function() {
    if (genoZoomDragging) {
      genoZoomDragging = false;
      scroll.style.cursor = 'grab';
    }
  });

  // 触摸支持
  var lastTouchDist = 0;
  var lastTouchCenter = null;

  scroll.addEventListener('touchstart', function(e) {
    if (e.touches.length === 1) {
      genoZoomDragging = true;
      genoZoomDragStartX = e.touches[0].clientX - genoZoomPanX;
      genoZoomDragStartY = e.touches[0].clientY - genoZoomPanY;
    } else if (e.touches.length === 2) {
      genoZoomDragging = false;
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist = Math.sqrt(dx * dx + dy * dy);
      lastTouchCenter = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2
      };
    }
  }, { passive: true });

  scroll.addEventListener('touchmove', function(e) {
    if (e.touches.length === 1 && genoZoomDragging) {
      genoZoomPanX = e.touches[0].clientX - genoZoomDragStartX;
      genoZoomPanY = e.touches[0].clientY - genoZoomDragStartY;
      applyTransform();
    } else if (e.touches.length === 2) {
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (lastTouchDist > 0) {
        var rect = scroll.getBoundingClientRect();
        var cx = lastTouchCenter.x - rect.left;
        var cy = lastTouchCenter.y - rect.top;
        zoomTo(genoZoomScale * (dist / lastTouchDist), cx, cy);
      }
      lastTouchDist = dist;
    }
  }, { passive: true });

  scroll.addEventListener('touchend', function() {
    genoZoomDragging = false;
    lastTouchDist = 0;
    lastTouchCenter = null;
  });

  scroll.style.cursor = 'grab';
  applyTransform();
}

/* 手机端缩进列表视图（苏式世系降级版） */
function renderMobileGenealogyList(container) {
  var tree = buildGenoTree();
  if (!tree) {
    container.innerHTML = '<div class="empty"><p>族谱数据异常，未找到始祖。</p></div>';
    return;
  }

  var html = '<div class="geno-mobile-list">';
  html += renderMobileTreeNode(tree, 0);
  html += '</div>';
  container.innerHTML = html;

  bindGenoTreeEvents(container);
}

function renderMobileTreeNode(node, depth) {
  var person = node.person;
  var safeName = escapeHTML(person.name || '');
  var safeTitle = person.title ? escapeHTML(person.title) : '';
  var gen = person.generation || '';
  var children = node.children || [];
  var hasChildren = children.length > 0;
  var isExpanded = !!genoExpanded[person.id];

  var indent = depth * 24;
  var html = '<div class="geno-mobile-item" data-depth="' + depth + '" style="margin-left:' + indent + 'px;">';
  html += '<div class="geno-mobile-card" data-action="detail" data-id="' + escapeHTML(String(person.id)) + '">';
  html += '<div class="geno-mobile-info">';
  html += '<span class="geno-mobile-gen">' + escapeHTML(String(gen)) + '</span>';
  html += '<span class="geno-mobile-name">' + safeName + '</span>';
  if (safeTitle) html += '<span class="geno-mobile-title">' + safeTitle + '</span>';
  html += '</div>';
  if (hasChildren) {
    html += '<button type="button" class="geno-mobile-toggle" data-action="toggle" data-id="' + escapeHTML(String(person.id)) + '">' + (isExpanded ? '−' : '+') + '</button>';
  }
  html += '</div>';
  html += '</div>';

  if (hasChildren && isExpanded) {
    for (var i = 0; i < children.length; i++) {
      html += renderMobileTreeNode(children[i], depth + 1);
    }
  }

  return html;
}

/* 事件绑定 */
function bindGenoTreeEvents(container) {
  container.addEventListener('click', function (e) {
    var target = e.target.closest('[data-action]');
    if (!target) return;
    
    var action = target.getAttribute('data-action');
    var id = target.getAttribute('data-id');

    if (action === 'toggle') {
      e.stopPropagation(); // 阻止冒泡，避免触发卡片的 detail 事件
      var wasExpanded = !!genoExpanded[id];
      if (wasExpanded) {
        delete genoExpanded[id];
        genoLastExpanded = null;
      } else {
        genoExpanded[id] = true;
        genoLastExpanded = id;
      }
      renderGenealogyTree({ people: genoPeople });
    } else if (action === 'detail') {
      // 如果点击的是 toggle 按钮内部，不触发 detail
      if (e.target.closest('.geno-mobile-toggle')) return;
      showGenoDetailModal(id);
    }
  });
}

/* 详情弹窗（齿录：生卒、配偶、迁徙） */
function showGenoDetailModal(id) {
  var person = genoPersonMap[id];
  if (!person) return;
  var overlay = document.getElementById('genealogyDetailOverlay');
  var body = document.getElementById('genealogyDetailBody');
  if (!overlay || !body) return;

  var safeName = escapeHTML(person.name || '');
  var safeTitle = person.title ? escapeHTML(person.title) : '';
  var safeEra = person.era ? escapeHTML(person.era) : '';
  var safeBirth = person.birthDate ? escapeHTML(person.birthDate) : '不详';
  var safeDeath = person.deathDate ? escapeHTML(person.deathDate) : '不详';
  var safeSpouse = person.spouse ? escapeHTML(person.spouse) : '不详';
  var safeMigration = person.migration ? escapeHTML(person.migration) : '不详';
  var safeIntro = person.intro ? escapeHTML(person.intro) : '暂无简介。';
  var gen = person.generation || '';

  var parent = null;
  for (var i = 0; i < genoPeople.length; i++) {
    if (String(genoPeople[i].id) === String(person.parentId)) { parent = genoPeople[i]; break; }
  }
  var parentName = parent ? escapeHTML(parent.name) : '无（始祖）';

  var html = '<div class="geno-modal-name">' + safeName + '</div>';
  html += '<div class="geno-modal-tags">';
  html += '<span class="geno-modal-tag gen">第' + escapeHTML(String(gen)) + '世</span>';
  if (safeTitle) html += '<span class="geno-modal-tag title-tag">' + safeTitle + '</span>';
  if (safeEra) html += '<span class="geno-modal-tag era">' + safeEra + '</span>';
  html += '</div>';
  html += '<div class="geno-modal-info">';
  html += '<div class="geno-modal-row"><span class="label">生辰</span><span class="value">' + safeBirth + '</span></div>';
  html += '<div class="geno-modal-row"><span class="label">卒日</span><span class="value">' + safeDeath + '</span></div>';
  html += '<div class="geno-modal-row"><span class="label">配偶</span><span class="value">' + safeSpouse + '</span></div>';
  html += '<div class="geno-modal-row"><span class="label">父亲</span><span class="value">' + parentName + '</span></div>';
  html += '<div class="geno-modal-row"><span class="label">迁徙</span><span class="value">' + safeMigration + '</span></div>';
  html += '</div>';
  html += '<div class="geno-modal-intro">' + safeIntro + '</div>';

  body.innerHTML = html;
  overlay.classList.add('active');
}

/* 全部展开 / 折叠 */
function expandAllGenealogy(expand) {
  if (expand) {
    // 全部展开：启用"显示所有"模式，绕过 20 节点限制
    genoShowAll = true;
    for (var i = 0; i < genoPeople.length; i++) {
      var p = genoPeople[i];
      var kids = genoByParent[p.id];
      if (kids && kids.length > 0) {
        genoExpanded[p.id] = true;
      }
    }
  } else {
    // 全部折叠：关闭"显示所有"模式，恢复 20 节点限制
    genoShowAll = false;
    genoExpanded = {};
    /* 折叠时保留始祖展开 */
    var roots = genoByParent['__root__'] || [];
    if (roots.length) genoExpanded[roots[0].id] = true;
  }
  renderGenealogyTree({ people: genoPeople });
}

/* 窗口缩放重绘 */
var genoResizeTimer = null;
window.addEventListener('resize', function () {
  if (!genoPeople.length) return;
  clearTimeout(genoResizeTimer);
  genoResizeTimer = setTimeout(function () {
    renderGenealogyTree({ people: genoPeople });
  }, 300);
});

async function loadGenealogy() {
  var introEl = document.getElementById('genealogyIntro');
  var container = document.getElementById('genealogyPyramid');
  if (!container) return;
  container.innerHTML = '<div class="loading"><div class="spinner"></div><p>正在加载族谱...</p></div>';
  try {
    var res = await fetch('/api/genealogy');
    if (!res.ok) throw new Error('族谱加载失败');
    var data = await res.json();
    if (introEl) {
      introEl.innerHTML = data.intro
        ? '<p class="genealogy-intro-text">' + escapeHTML(data.intro) + '</p>'
        : '';
    }
    var kickerEl = document.getElementById('genealogyKicker');
    var titleEl = document.getElementById('genealogyTitle');
    var subtitleEl = document.getElementById('genealogySubtitle');
    if (kickerEl && data.kicker) kickerEl.textContent = data.kicker;
    if (titleEl && data.title) titleEl.textContent = data.title;
    if (subtitleEl) subtitleEl.textContent = data.subtitle || '';

    genoExpanded = {};
    /* 默认展开始祖 */
    var roots = (data.people || []).filter(function (p) { return !p.parentId; });
    if (roots.length) genoExpanded[roots[0].id] = true;

    renderGenealogyTree(data);

    /* 初始化分支筛选 */
    initBranchFilter();

    var expandAllBtn = document.querySelector('.genealogy-expand-all');
    var collapseAllBtn = document.querySelector('.genealogy-collapse-all');
    if (expandAllBtn) expandAllBtn.addEventListener('click', function () { expandAllGenealogy(true); });
    if (collapseAllBtn) collapseAllBtn.addEventListener('click', function () { expandAllGenealogy(false); });

    /* 关闭弹窗 */
    var closeBtn = document.getElementById('genealogyDetailClose');
    if (closeBtn) closeBtn.addEventListener('click', function () {
      var ov = document.getElementById('genealogyDetailOverlay');
      if (ov) ov.classList.remove('active');
    });
    var overlay = document.getElementById('genealogyDetailOverlay');
    if (overlay) overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.classList.remove('active');
    });
  } catch (err) {
    container.innerHTML = '<div class="error-tip"><p>族谱加载失败：' + escapeHTML(err.message) + '</p>' +
      '<button class="btn-primary retry-btn" onclick="loadGenealogy()">重新加载</button></div>';
  }
}

/* ---- 族谱人名搜索（仅搜索族谱页面人名） ---- */
var genoSearchTimer = null;
var genoSearchInitialized = false;
/* 显式挂载到 window 确保全局可访问 */
window.genoPeople = genoPeople;
window.genoByParent = genoByParent;
window.genoExpanded = genoExpanded;
window.genoPersonMap = genoPersonMap;

function initGenealogySearch() {
  if (genoSearchInitialized) return;
  var input = document.getElementById('genoSearchInput');
  var clearBtn = document.getElementById('genoSearchClear');
  var resultsEl = document.getElementById('genoSearchResults');
  var searchBtn = document.getElementById('genoSearchBtn');
  if (!input || !resultsEl) return;
  genoSearchInitialized = true;

  function onSearchInput() {
    var val = input.value.trim();
    if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';
    clearTimeout(genoSearchTimer);
    genoSearchTimer = setTimeout(function () { doGenealogySearch(val); }, 250);
  }

  /* 监听多种事件确保兼容 */
  input.addEventListener('input', onSearchInput);
  input.addEventListener('keyup', onSearchInput);
  input.addEventListener('change', onSearchInput);

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(genoSearchTimer);
      doGenealogySearch(input.value.trim());
    }
  });

  /* 搜索按钮 */
  if (searchBtn) {
    searchBtn.addEventListener('click', function () {
      doGenealogySearch(input.value.trim());
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      input.value = '';
      clearBtn.style.display = 'none';
      resultsEl.style.display = 'none';
      resultsEl.innerHTML = '';
      document.querySelectorAll('.geno-tree-card.geno-search-match').forEach(function (c) {
        c.classList.remove('geno-search-match');
      });
    });
  }
}

function doGenealogySearch(keyword) {
  var resultsEl = document.getElementById('genoSearchResults');
  if (!resultsEl) return;

  if (!keyword) {
    resultsEl.style.display = 'none';
    resultsEl.innerHTML = '';
    document.querySelectorAll('.geno-tree-card.geno-search-match').forEach(function (c) {
      c.classList.remove('geno-search-match');
    });
    return;
  }

  /* 确保 genoPeople 已加载 */
  if (!genoPeople || !genoPeople.length) {
    resultsEl.style.display = 'block';
    resultsEl.innerHTML = '<div class="geno-search-empty">族谱数据正在加载中，请稍候...</div>';
    return;
  }

  var lower = keyword.toLowerCase();
  var matches = genoPeople.filter(function (p) {
    var name = (p.name || '').toLowerCase();
    return name.indexOf(lower) !== -1;
  });

  if (!matches.length) {
    resultsEl.style.display = 'block';
    resultsEl.innerHTML = '<div class="geno-search-empty">未找到匹配「' + escapeHTML(keyword) + '」的族谱人物</div>';
    /* 清除高亮 */
    document.querySelectorAll('.geno-tree-card.geno-search-match').forEach(function (c) {
      c.classList.remove('geno-search-match');
    });
    return;
  }

  resultsEl.style.display = 'flex';
  resultsEl.innerHTML = matches.map(function (p) {
    var name = escapeHTML(p.name || '');
    var lowerName = (p.name || '').toLowerCase();
    var idx = lowerName.indexOf(lower);
    if (idx >= 0) {
      var before = escapeHTML(p.name.slice(0, idx));
      var matched = escapeHTML(p.name.slice(idx, idx + keyword.length));
      var after = escapeHTML(p.name.slice(idx + keyword.length));
      name = before + '<span class="geno-search-highlight">' + matched + '</span>' + after;
    }
    var meta = [];
    if (p.generation) meta.push('第' + escapeHTML(String(p.generation)) + '世');
    if (p.title) meta.push(escapeHTML(p.title));
    if (p.era) meta.push(escapeHTML(p.era));
    return '<div class="geno-search-result-item" data-id="' + escapeHTML(String(p.id)) + '">' +
      '<span class="geno-search-result-name">' + name + '</span>' +
      (meta.length ? '<span class="geno-search-result-meta">' + meta.join(' · ') + '</span>' : '') +
      '</div>';
  }).join('');

  resultsEl.querySelectorAll('.geno-search-result-item').forEach(function (item) {
    item.addEventListener('click', function () {
      var id = this.getAttribute('data-id');
      focusGenealogyPerson(id);
    });
  });

  /* 在树中高亮并展开到匹配人物的路径 */
  highlightSearchMatches(matches);
}

function highlightSearchMatches(matches) {
  if (!matches.length) return;
  var matchIds = {};
  for (var i = 0; i < matches.length; i++) {
    matchIds[matches[i].id] = true;
    /* 展开祖先链 */
    var p = matches[i];
    while (p && p.parentId) {
      genoExpanded[p.parentId] = true;
      var parent = genoPersonMap[p.parentId];
      if (!parent) break;
      p = parent;
    }
  }
  renderGenealogyTree({ people: genoPeople });

  /* 高亮匹配的卡片 */
  setTimeout(function () {
    var cards = document.querySelectorAll('.geno-tree-card');
    cards.forEach(function (card) {
      var id = card.getAttribute('data-id');
      if (matchIds[id]) {
        card.classList.add('geno-search-match');
      } else {
        card.classList.remove('geno-search-match');
      }
    });
  }, 50);
}

function focusGenealogyPerson(id) {
  var person = genoPersonMap[id];
  if (!person) return;
  /* 展开祖先链 */
  var p = person;
  while (p && p.parentId) {
    genoExpanded[p.parentId] = true;
    p = genoPersonMap[p.parentId];
  }
  renderGenealogyTree({ people: genoPeople });
  /* 滚动到卡片 */
  setTimeout(function () {
    var card = document.querySelector('.geno-tree-card[data-id="' + id + '"]');
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      card.classList.add('geno-search-match');
      setTimeout(function () { card.classList.remove('geno-search-match'); }, 2000);
    }
  }, 100);
  /* 显示详情 */
  showGenoDetailModal(id);
}

/* 初始化分支筛选下拉框 */
function initBranchFilter() {
  var select = document.getElementById('genoBranchFilter');
  if (!select) return;

  /* 找出所有分支起点（generation >= 3 且 parentId 存在的人物） */
  var branches = [];
  for (var i = 0; i < genoPeople.length; i++) {
    var p = genoPeople[i];
    if (p.generation >= 3 && p.parentId && p.title && p.title.indexOf('支') !== -1) {
      branches.push(p);
    }
  }

  /* 按世代排序 */
  branches.sort(function (a, b) {
    return (a.generation || 0) - (b.generation || 0);
  });

  /* 填充下拉框 */
  var html = '<option value="">全部分支</option>';
  for (var j = 0; j < branches.length; j++) {
    var b = branches[j];
    html += '<option value="' + escapeHTML(String(b.id)) + '">';
    html += '第' + escapeHTML(String(b.generation)) + '世 · ' + escapeHTML(b.name);
    if (b.title) html += ' (' + escapeHTML(b.title) + ')';
    html += '</option>';
  }
  select.innerHTML = html;

  /* 绑定筛选事件 */
  select.addEventListener('change', function () {
    var branchId = select.value;
    if (!branchId) {
      /* 显示全部 */
      renderGenealogyTree({ people: genoPeople });
    } else {
      /* 筛选指定分支及其后代 */
      var filtered = filterBranch(branchId);
      renderGenealogyTree({ people: filtered });
    }
  });
}

/* 筛选指定分支及其所有后代 */
function filterBranch(branchId) {
  var result = [];
  var branchPerson = genoPersonMap[branchId];
  if (!branchPerson) return genoPeople;

  /* 添加该分支人物 */
  result.push(branchPerson);

  /* 递归添加所有后代 */
  function addDescendants(parentId) {
    var children = genoByParent[parentId] || [];
    for (var i = 0; i < children.length; i++) {
      result.push(children[i]);
      addDescendants(children[i].id);
    }
  }
  addDescendants(branchId);

  return result;
}

/* ---- 族谱人物提交（用户提交，待审核） ---- */
var genoSubmitInitialized = false;

function initGenealogySubmit() {
  if (genoSubmitInitialized) return;
  var addBtn = document.getElementById('genoAddShowBtn');
  var form = document.getElementById('genoSubmitForm');
  var toggleBtn = document.getElementById('genoSubmitToggle');
  if (!addBtn) return;
  genoSubmitInitialized = true;

  /* 添加按钮点击 */
  addBtn.addEventListener('click', function () {
    var token = localStorage.getItem('frontToken');
    var username = localStorage.getItem('frontUsername');
    if (!token || !username) {
      /* 未登录：跳转登录页 */
      window.location.href = 'login.html';
      return;
    }
    /* 已登录：显示提交表单 */
    var section = document.getElementById('genealogySubmitSection');
    var loginHint = document.getElementById('genealogyLoginHint');
    var toggleWrap = document.getElementById('genoAddToggleWrap');
    if (section) {
      section.style.display = 'block';
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (loginHint) loginHint.style.display = 'none';
    if (toggleWrap) toggleWrap.style.display = 'none';
    /* 填充父亲下拉框 */
    updateGenoSubmitParentSelect();
  });

  /* 表单提交 */
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitGenealogyPerson();
    });
  }

  /* 收起按钮 */
  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      var section = document.getElementById('genealogySubmitSection');
      var toggleWrap = document.getElementById('genoAddToggleWrap');
      if (section) section.style.display = 'none';
      if (toggleWrap) toggleWrap.style.display = 'block';
    });
  }

  /* 页面加载后检查登录状态，更新提示 */
  var token = localStorage.getItem('frontToken');
  var username = localStorage.getItem('frontUsername');
  if (!token || !username) {
    /* 未登录：显示登录提示 */
    var loginHint = document.getElementById('genealogyLoginHint');
    if (loginHint) loginHint.style.display = 'block';
  }
}

function updateGenoSubmitParentSelect() {
  var select = document.getElementById('genoSubmitParent');
  if (!select) return;
  var html = '<option value="">无（始祖）</option>';
  var sorted = genoPeople.slice().sort(function (a, b) {
    return (a.generation || 0) - (b.generation || 0) || (a.name || '').localeCompare(b.name || '');
  });
  for (var i = 0; i < sorted.length; i++) {
    var p = sorted[i];
    html += '<option value="' + escapeHTML(String(p.id)) + '">第' + escapeHTML(String(p.generation || 1)) + '世 · ' + escapeHTML(p.name) + '</option>';
  }
  select.innerHTML = html;
}

async function submitGenealogyPerson() {
  var token = localStorage.getItem('frontToken');
  if (!token) {
    window.location.href = 'login.html';
    return;
  }
  var nameEl = document.getElementById('genoSubmitName');
  var name = nameEl ? nameEl.value.trim() : '';
  var generation = parseInt((document.getElementById('genoSubmitGeneration') || {}).value) || 1;
  var parentId = (document.getElementById('genoSubmitParent') || {}).value || null;
  var spouse = ((document.getElementById('genoSubmitSpouse') || {}).value || '').trim();
  var title = ((document.getElementById('genoSubmitTitleField') || {}).value || '').trim();
  var birthDate = ((document.getElementById('genoSubmitBirthDate') || {}).value || '').trim();
  var era = ((document.getElementById('genoSubmitEra') || {}).value || '').trim();
  var intro = ((document.getElementById('genoSubmitIntro') || {}).value || '').trim();
  var statusEl = document.getElementById('genoSubmitStatus');
  var btn = document.getElementById('genoSubmitBtn');

  if (!name) {
    if (statusEl) { statusEl.textContent = '请输入人物姓名'; statusEl.className = 'geno-submit-status error'; }
    return;
  }
  if (name.length > 30) {
    if (statusEl) { statusEl.textContent = '姓名不能超过 30 个字符'; statusEl.className = 'geno-submit-status error'; }
    return;
  }

  try {
    if (btn) { btn.disabled = true; btn.textContent = '提交中...'; }
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'geno-submit-status'; }
    var res = await fetch('/api/user/genealogy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        name: name, generation: generation, parentId: parentId,
        spouse: spouse, title: title, birthDate: birthDate, era: era, intro: intro
      })
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || '提交失败');
    if (statusEl) {
      statusEl.textContent = data.message || '提交成功';
      statusEl.className = 'geno-submit-status success';
    }
    /* 清空表单 */
    var form = document.getElementById('genoSubmitForm');
    if (form) form.reset();
    var genInput = document.getElementById('genoSubmitGeneration');
    if (genInput) genInput.value = '1';
    /* 如果是管理员角色直接通过，刷新族谱 */
    if (data.person && data.person.reviewStatus === 'approved') {
      loadGenealogy();
    }
  } catch (err) {
    if (statusEl) { statusEl.textContent = err.message || '提交失败'; statusEl.className = 'geno-submit-status error'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '提交审核'; }
  }
}

/* ----------------------------
   族谱密码访问门
   ---------------------------- */
function initGenealogyPasswordGate() {
  if (window.__genoGateReady) return;
  window.__genoGateReady = true;
  var gate = document.getElementById('genoGate');
  var content = document.getElementById('genoContent');
  if (!gate || !content) return;

  // 管理员免密码
  var token = localStorage.getItem('frontToken');
  var role = localStorage.getItem('frontRole');
  if (token && role === 'admin') {
    gate.style.display = 'none';
    content.style.display = 'block';
    return;
  }

  // 已验证过（本次会话）
  if (sessionStorage.getItem('genoVerified') === 'true') {
    gate.style.display = 'none';
    content.style.display = 'block';
    return;
  }

  // 显示密码门
  gate.style.display = 'block';
  content.style.display = 'none';

  // 密码验证表单
  var form = document.getElementById('genoGateForm');
  var gateMsg = document.getElementById('genoGateMsg');
  if (form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var password = document.getElementById('genoGatePassword').value;
      var btn = document.getElementById('genoGateBtn');
      if (btn) { btn.disabled = true; btn.textContent = '验证中...'; }
      if (gateMsg) { gateMsg.textContent = ''; gateMsg.className = 'front-auth-msg'; }
      try {
        var res = await fetch('/api/genealogy/verify-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: password })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || '密码验证失败');
        sessionStorage.setItem('genoVerified', 'true');
        gate.style.display = 'none';
        content.style.display = 'block';
        // 密码验证通过后重新渲染大树图谱（确保布局计算正确）
        setTimeout(function () { loadGenealogy(); }, 50);
      } catch (err) {
        if (gateMsg) { gateMsg.textContent = err.message; gateMsg.className = 'front-auth-msg error'; }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '验证密码'; }
      }
    });
  }

  // 申请密码链接
  var requestBtn = document.getElementById('genoGateRequestBtn');
  var requestForm = document.getElementById('genoGateRequestForm');
  if (requestBtn && requestForm) {
    requestBtn.addEventListener('click', function () {
      requestForm.style.display = requestForm.style.display === 'block' ? 'none' : 'block';
    });
  }

  // 提交申请
  var reqForm = document.getElementById('genoRequestForm');
  var reqMsg = document.getElementById('genoRequestMsg');
  if (reqForm) {
    reqForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var name = document.getElementById('genoRequestName').value.trim();
      var contact = document.getElementById('genoRequestContact').value.trim();
      var reason = document.getElementById('genoRequestReason').value.trim();
      var btn = document.getElementById('genoRequestBtn');
      if (!name || !contact) {
        if (reqMsg) { reqMsg.textContent = '姓名和联系方式不能为空'; reqMsg.className = 'front-auth-msg error'; }
        return;
      }
      if (btn) { btn.disabled = true; btn.textContent = '提交中...'; }
      if (reqMsg) { reqMsg.textContent = ''; reqMsg.className = 'front-auth-msg'; }
      try {
        // 登录用户携带 token，申请会自动关联账号
        var userToken = localStorage.getItem('frontToken');
        var reqHeaders = { 'Content-Type': 'application/json' };
        if (userToken) reqHeaders['Authorization'] = 'Bearer ' + userToken;
        var res = await fetch('/api/genealogy/request-password', {
          method: 'POST',
          headers: reqHeaders,
          body: JSON.stringify({ name: name, contact: contact, reason: reason })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || '申请提交失败');
        if (reqMsg) { reqMsg.textContent = data.message || '申请已提交'; reqMsg.className = 'front-auth-msg success'; }
        reqForm.reset();
      } catch (err) {
        if (reqMsg) { reqMsg.textContent = err.message; reqMsg.className = 'front-auth-msg error'; }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '提交申请'; }
      }
    });
  }
}

/* ----------------------------
   页面初始化入口
   ---------------------------- */

function onDomReady(fn) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn);
  } else {
    fn();
  }
}

onDomReady(function () {
  // 加载站点 Logo / 名称
  initSiteSettings();

  // 初始化前台注册登录按钮与表单
  initFrontAuthActions();
  initFrontAuthForms();

  // 初始化手机端底部导航
  initMobileTabbar();

  // 初始化搜索功能（两个页面都有搜索框）
  initSearch();

  // 根据页面元素判断当前页面
  if (document.getElementById('app')) {
    // 首页：使用合并接口获取 settings + meta，减少 API 往返
    initBootstrap().then(function () {
      // bootstrap 完成后只需加载文章列表和公告
      Promise.all([
        loadAnnouncements(),
        loadPosts()
      ]).catch(function () {});
    }).catch(function () {
      // 失败时回退到独立加载
      Promise.all([
        loadAnnouncements(),
        loadCategories(),
        loadPosts()
      ]).catch(function () {});
    });
    initCommentSection(document.getElementById('homeCommentSection'));
  } else if (document.getElementById('postDetail')) {
    // 详情页
    loadPostDetail();
  } else if (document.getElementById('friendGrid')) {
    // 友链页
    loadFriends();
    initFriendSubmit();
  } else if (document.getElementById('genealogyPage')) {
    // 族谱金字塔页
    // 先初始化密码门，验证通过后才加载族谱内容
    initGenealogyPasswordGate();
    // 独立初始化搜索和提交功能（不依赖 loadGenealogy 的异步结果）
    initGenealogySearch();
    initGenealogySubmit();
    // 只有在密码门未启用或已验证时才加载族谱
    var genoGate = document.getElementById('genoGate');
    var genoVerified = sessionStorage.getItem('genoVerified') === 'true';
    var isAdmin = localStorage.getItem('frontRole') === 'admin' && localStorage.getItem('frontToken');
    if (!genoGate || genoGate.style.display === 'none' || genoVerified || isAdmin) {
      try {
        loadGenealogy();
      } catch (err) {
        console.error('[族谱] 加载失败:', err);
      }
    }
  } else if (document.getElementById('aboutPage')) {
    // 关于页
    loadAboutPage();
    initCommentSection(document.getElementById('aboutCommentSection'));
  }
  protectGlobalFooter();

  // ---------- 族谱函数挂载到 window（确保内联脚本可访问） ----------
  window.initGenealogySearch = initGenealogySearch;
  window.initGenealogySubmit = initGenealogySubmit;
  window.doGenealogySearch = doGenealogySearch;
  window.focusGenealogyPerson = focusGenealogyPerson;
  window.showGenoDetailModal = showGenoDetailModal;
  window.renderGenealogyTree = renderGenealogyTree;
  window.loadGenealogy = loadGenealogy;
  window.updateGenoSubmitParentSelect = updateGenoSubmitParentSelect;
  window.submitGenealogyPerson = submitGenealogyPerson;
  window.initGenealogyPasswordGate = initGenealogyPasswordGate;

  // ---------- 内存泄漏防护：注册全局清理 ----------
  CleanupRegistry.register(function () {
    // 清理图片懒加载 observer
    LazyImage.destroy();
  });
  CleanupRegistry.register(function () {
    // 清理虚拟列表实例
    if (_virtualListInstance) {
      _virtualListInstance.destroy();
      _virtualListInstance = null;
    }
  });
  CleanupRegistry.register(function () {
    // 清理 footer 定时器和 observer
    if (window.__footerCheckTimer) {
      clearInterval(window.__footerCheckTimer);
      window.__footerCheckTimer = null;
    }
    if (window.__globalFooterObserver) {
      window.__globalFooterObserver.disconnect();
      window.__globalFooterObserver = null;
    }
  });
  // 站点 Logo 的全局 footer observer 也在清理范围内

  // ---------- 延迟加载非关键功能（用户交互、个人页等） ----------
  // 使用 requestIdleCallback 在浏览器空闲时执行，不阻塞首屏渲染
  var _deferredInit = function () {
    refreshFrontRole();
    initProfilePage();
    initSubmissionForm();
    initInteractionRefresh();
    loadMyLikes();
    loadMyFavorites();
  };
  if (window.requestIdleCallback) {
    window.requestIdleCallback(_deferredInit, { timeout: 3000 });
  } else {
    setTimeout(_deferredInit, 100);
  }
});
