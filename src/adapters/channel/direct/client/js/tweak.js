/* ── Visual Tweak Panel ── */
// Per-page design token editor. Reads token definitions from window._pageTokens,
// scopes CSS property changes to page containers (not just :root).
// Persists tweaks in localStorage so they survive refresh.
//
// 主题分桶（07-10 回退根因 2 的修正）：inline style 永远压过 themes.css 的
// data-theme 规则，所以 tweak 存值按「scope × 主题」分桶——存的是当前主题下的
// 微调补丁。切主题时（themes.js 调 _tweakReapplyZone）先清光该 zone 的 inline
// 变量再换上新主题桶的值，主题规则永远能生效。
(function() {
  var root = document.documentElement;
  var overlay = document.getElementById('tweak-overlay');
  var trigger = document.getElementById('tweak-trigger');
  var body = document.getElementById('tweak-body');
  var tabsEl = null;

  trigger.style.display = 'flex';

  var LS_KEY = 'withtoge-tweak-persist';
  var BASE_BUCKET = 'base';   // 无主题/非 zone scope 的桶名

  // ── State ──
  var currentScope = 'global';   // active tab
  var defaults = {};             // { scopeId: { key: defaultValue } }  当前主题下的默认值
  var current = {};              // { scopeId: { key: currentValue } }  当前主题桶的值
  var persistedAll = {};         // { scopeId: { bucket: { key: val } } }  全部桶
  var sectionOrder = ['色彩','气泡','圆角','间距','字体','页面','头部','底部栏','输入区','发送','壁纸','场景','UI','按钮','日期格','计划面板','月标题','快捷入口','布局','画板','工具栏','日记','标签','类型色','表单','标题','卡片','预览','区块','文字','背景','日历','形状','菜单','遮罩','其他'];

  // ── Scope helpers ──
  function getScopeDef(scopeId) {
    if (window._pageTokens && window._pageTokens[scopeId]) {
      return window._pageTokens[scopeId];
    }
    return null;
  }

  function getScopeTarget(scopeId) {
    if (scopeId === 'global') return document.documentElement;
    var def = getScopeDef(scopeId);
    if (def && def.selector) return document.querySelector(def.selector);
    return document.documentElement;
  }

  function getTokensForScope(scopeId) {
    var def = getScopeDef(scopeId);
    if (!def || !def.tokens) return [];
    return def.tokens;
  }

  // scope 对应的 zone key（zone-* scope 带 zoneKey 字段；暖瓷页 scope 跟 DS 的主题走）
  function getZoneKeyForScope(scopeId) {
    var def = getScopeDef(scopeId);
    if (def && def.zoneKey) return def.zoneKey;
    if (scopeId === 'chat-ds') return 'ds';
    return null;
  }

  // scope 当前所在的主题桶
  function getThemeBucket(scopeId) {
    var zoneKey = getZoneKeyForScope(scopeId);
    if (!zoneKey || typeof window.loadZoneTheme !== 'function') return BASE_BUCKET;
    return window.loadZoneTheme(zoneKey) || BASE_BUCKET;
  }

  // ── 单个 scope 的 defaults 重算（主题切换后 computed 默认值会变）──
  function recalcDefaults(scopeId) {
    defaults[scopeId] = {};
    var tokens = getTokensForScope(scopeId);
    var target = getScopeTarget(scopeId);
    tokens.forEach(function(p) {
      var defVal = p.default;
      if (defVal === undefined || defVal === '') {
        var computed = '';
        try {
          computed = getComputedStyle(target).getPropertyValue(p.key).trim();
        } catch(e) {}
        defVal = computed || (p.type === 'range' ? ((p.min + p.max) / 2) : '');
      }
      if (p.type === 'range' && typeof defVal === 'string') {
        defVal = parseFloat(defVal) || ((p.min + p.max) / 2);
      }
      defaults[scopeId][p.key] = defVal;
    });
  }

  // 从当前主题桶加载 current = defaults + 桶内存值
  function loadCurrentFromBucket(scopeId) {
    current[scopeId] = {};
    var saved = (persistedAll[scopeId] || {})[getThemeBucket(scopeId)] || {};
    getTokensForScope(scopeId).forEach(function(p) {
      var savedVal = saved[p.key];
      if (p.type === 'range' && typeof savedVal === 'string') {
        savedVal = parseFloat(savedVal);
      }
      current[scopeId][p.key] = (savedVal !== undefined) ? savedVal : defaults[scopeId][p.key];
    });
  }

  // ── Init defaults & current from definitions + computed + localStorage ──
  function initState() {
    defaults = {};
    current = {};

    persistedAll = {};
    try { persistedAll = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch(e) {}
    // 旧格式迁移：{scope:{key:val}} → {scope:{base:{key:val}}}（值不是对象说明是旧格式）
    Object.keys(persistedAll).forEach(function(scopeId) {
      var v = persistedAll[scopeId];
      var keys = Object.keys(v || {});
      var isOld = keys.length && keys.some(function(k) {
        return typeof v[k] !== 'object' || v[k] === null;
      });
      if (isOld) {
        var wrapped = {};
        wrapped[BASE_BUCKET] = v;
        persistedAll[scopeId] = wrapped;
      }
    });

    Object.keys(window._pageTokens || {}).forEach(function(scopeId) {
      recalcDefaults(scopeId);
      loadCurrentFromBucket(scopeId);
    });
  }

  // ── Apply ──
  function applyToken(scopeId, key, val, unit) {
    var target = getScopeTarget(scopeId);
    if (!target) return;
    target.style.setProperty(key, val + (unit || ''));
  }

  // 只把「偏离默认值」的项写成 inline——等于默认值的不上 inline，
  // 让 themes.css / main.css 的规则自然生效（inline 最小化原则）
  function applyScope(scopeId) {
    var vals = current[scopeId] || {};
    var defs = defaults[scopeId] || {};
    var tokens = getTokensForScope(scopeId);
    tokens.forEach(function(p) {
      var v = vals[p.key];
      if (v !== undefined && String(v) !== String(defs[p.key])) {
        applyToken(scopeId, p.key, v, p.unit);
      }
    });
  }

  // 清掉 scope 目标元素上本面板管理的全部 inline 变量
  function clearScopeInline(scopeId) {
    var target = getScopeTarget(scopeId);
    if (!target) return;
    getTokensForScope(scopeId).forEach(function(p) {
      target.style.removeProperty(p.key);
    });
  }

  function applyAll() {
    Object.keys(current).forEach(function(scopeId) {
      applyScope(scopeId);
    });
  }

  // ── Persist ──
  function persist() {
    Object.keys(current).forEach(function(scopeId) {
      var bucket = getThemeBucket(scopeId);
      var vals = current[scopeId];
      var defs = defaults[scopeId] || {};
      var diff = {};
      Object.keys(vals).forEach(function(key) {
        // Only persist if different from default
        if (String(vals[key]) !== String(defs[key])) {
          diff[key] = vals[key];
        }
      });
      if (!persistedAll[scopeId]) persistedAll[scopeId] = {};
      if (Object.keys(diff).length) {
        persistedAll[scopeId][bucket] = diff;
      } else {
        delete persistedAll[scopeId][bucket];
        if (!Object.keys(persistedAll[scopeId]).length) delete persistedAll[scopeId];
      }
    });
    try { localStorage.setItem(LS_KEY, JSON.stringify(persistedAll)); } catch(e) {}
  }

  // ── 主题切换钩子（themes.js 的 applyZoneTheme 调用）──
  // 清旧 inline → 按新主题重算默认 → 换上新主题桶的微调 → 面板开着就重绘
  window._tweakReapplyZone = function(zoneKey) {
    Object.keys(window._pageTokens || {}).forEach(function(scopeId) {
      if (getZoneKeyForScope(scopeId) !== zoneKey) return;
      clearScopeInline(scopeId);
      recalcDefaults(scopeId);
      loadCurrentFromBucket(scopeId);
      applyScope(scopeId);
      if (overlay.classList.contains('show') && scopeId === currentScope) {
        buildControls();
      }
    });
  };

  // 外部入口（主题专区滑条等）改了变量时同步面板内存，避免两处显示打架
  window._tweakSyncToken = function(scopeId, key, val) {
    if (current[scopeId] && current[scopeId][key] !== undefined) {
      current[scopeId][key] = val;
      persist();
    }
  };

  // ── Build tab bar ──
  function buildTabs() {
    if (!tabsEl) {
      tabsEl = document.createElement('div');
      tabsEl.className = 'tweak-tabs';
      var header = document.querySelector('#tweak-panel .tweak-header');
      if (header) header.after(tabsEl);
    }

    var html = '';
    var scopeIds = Object.keys(window._pageTokens || {});
    // Always put global first, then the rest in order
    var ordered = ['global'];
    scopeIds.forEach(function(id) { if (id !== 'global') ordered.push(id); });

    ordered.forEach(function(scopeId) {
      var def = getScopeDef(scopeId);
      if (!def) return;
      var label = def.label || scopeId;
      var active = scopeId === currentScope ? ' active' : '';
      html += '<button class="tweak-tab' + active + '" data-scope="' + scopeId + '">' + label + '</button>';
    });

    tabsEl.innerHTML = html;

    tabsEl.querySelectorAll('.tweak-tab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        switchScope(btn.dataset.scope);
      });
    });
  }

  function switchScope(scopeId) {
    currentScope = scopeId;
    if (tabsEl) {
      tabsEl.querySelectorAll('.tweak-tab').forEach(function(b) {
        b.classList.toggle('active', b.dataset.scope === scopeId);
      });
    }
    buildControls();
    updateSaveThemeBtn();
  }

  // Suggest a scope based on current page
  function suggestScope() {
    var page = (typeof currentPage !== 'undefined') ? currentPage : 'chat';
    // 主聊天页 → 定位到当前活跃 zone 的 scope（没有「聊天共享」scope，见 page-tokens.js）
    if (page === 'chat') {
      var zk = (typeof activeZoneKey !== 'undefined' && activeZoneKey) ? activeZoneKey : 'ds';
      if (window._pageTokens && window._pageTokens['zone-' + zk]) return 'zone-' + zk;
      return 'global';
    }
    // Map page names to scope IDs
    var map = {
      memory: 'memory', calendar: 'calendar',
      meditation: 'meditation', graffiti: 'graffiti',
      worldbook: 'worldbook', gifts: 'gifts',
      camera: 'camera', mcp: 'mcp', bookmarks: 'bookmarks',
      bubbletea: 'bubbletea',
      'phone-home': 'phone-home',
      'chat-ds': 'chat-ds'
    };
    var scopeId = map[page] || 'global';
    if (window._pageTokens && window._pageTokens[scopeId]) return scopeId;
    return 'global';
  }

  // ── Build controls for current scope ──
  function buildControls() {
    var tokens = getTokensForScope(currentScope);
    if (!tokens.length) {
      body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px;">该页面暂无微调参数</div>';
      return;
    }

    var defaultsForScope = defaults[currentScope] || {};
    var currentForScope = current[currentScope] || {};

    // Group by section
    var sections = {};
    tokens.forEach(function(p) {
      if (!sections[p.section]) sections[p.section] = [];
      sections[p.section].push(p);
    });

    var html = '';
    // Sort sections by sectionOrder, then remaining alphabetically
    var secKeys = Object.keys(sections).sort(function(a, b) {
      var ai = sectionOrder.indexOf(a), bi = sectionOrder.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    secKeys.forEach(function(sec) {
      var items = sections[sec];
      html += '<div class="tweak-section"><div class="tweak-section-title">' + sec + '</div>';
      items.forEach(function(p) {
        var val = currentForScope[p.key];
        if (val === undefined) val = defaultsForScope[p.key];
        if (val === undefined) val = p.default || '';

        if (p.type === 'color') {
          html += '<div class="tweak-row colors">' +
            '<span class="tweak-label">' + p.label + '</span>' +
            '<input type="color" data-key="' + p.key + '" value="' + val + '">' +
            '<span class="tweak-val" data-key="' + p.key + '">' + val + '</span>' +
          '</div>';
        } else {
          html += '<div class="tweak-row">' +
            '<span class="tweak-label">' + p.label + '</span>' +
            '<input type="range" data-key="' + p.key + '" min="' + p.min + '" max="' + p.max + '" step="' + p.step + '" value="' + val + '">' +
            '<span class="tweak-val" data-key="' + p.key + '">' + val + (p.unit || '') + '</span>' +
          '</div>';
        }
      });
      html += '</div>';
    });
    body.innerHTML = html;

    // Bind range inputs
    body.querySelectorAll('input[type="range"]').forEach(function(inp) {
      inp.addEventListener('input', function() {
        var key = inp.dataset.key;
        var val = parseFloat(inp.value);
        if (!current[currentScope]) current[currentScope] = {};
        current[currentScope][key] = val;
        var p = tokens.find(function(x) { return x.key === key; });
        applyToken(currentScope, key, val, p ? p.unit : '');
        var ve = body.querySelector('.tweak-val[data-key="' + key + '"]');
        if (ve && p) ve.textContent = val + (p.unit || '');
        persist();
      });
    });

    // Bind color inputs
    body.querySelectorAll('input[type="color"]').forEach(function(inp) {
      inp.addEventListener('input', function() {
        var key = inp.dataset.key;
        var val = inp.value;
        if (!current[currentScope]) current[currentScope] = {};
        current[currentScope][key] = val;
        applyToken(currentScope, key, val);
        var ve = body.querySelector('.tweak-val[data-key="' + key + '"]');
        if (ve) ve.textContent = val;
        persist();
      });
    });
  }

  // ── 存为主题卡片（zone scope 限定）──
  // 把当前 zone 的完整视觉快照存成自定义主题：走 themes.js 的 <style> 注入，
  // 与内置主题同机制。存完 zone 直接切到新主题（inline 被清、规则接管，视觉不变）。
  var saveThemeBtn = document.createElement('button');
  saveThemeBtn.className = 'btn btn-copy';
  saveThemeBtn.id = 'tweak-save-theme';
  saveThemeBtn.textContent = '存为主题卡片';
  saveThemeBtn.style.display = 'none';
  var footerEl = document.querySelector('#tweak-panel .tweak-footer');
  if (footerEl) footerEl.insertBefore(saveThemeBtn, footerEl.firstChild);

  function updateSaveThemeBtn() {
    var zoneKey = getZoneKeyForScope(currentScope);
    saveThemeBtn.style.display = (zoneKey && typeof window.saveCustomThemes === 'function') ? '' : 'none';
  }

  saveThemeBtn.addEventListener('click', function() {
    var zoneKey = getZoneKeyForScope(currentScope);
    if (!zoneKey) return;
    var name = prompt('给这套主题起个名字：');
    if (!name || !name.trim()) return;
    name = name.trim().slice(0, 12);

    var vals = current[currentScope] || {};
    var vars = {};
    getTokensForScope(currentScope).forEach(function(p) {
      var v = vals[p.key];
      if (v !== undefined && v !== '') vars[p.key] = v + (p.unit || '');
    });

    var theme = {
      id: 'custom-' + Date.now(),
      name: name,
      preview: {
        bg: 'linear-gradient(135deg, ' + (vars['--zone-bg'] || '#fafaf9') + ', ' + (vars['--bubble-ke'] || '#ffffff') + ')',
        accent: vars['--send-btn-bg'] || vars['--accent'] || '#5989b9'
      },
      vars: vars
    };
    var list = window.loadCustomThemes();
    list.push(theme);
    window.saveCustomThemes(list);

    // zone 切到刚存的主题（reapply 钩子清 inline，注入的规则无缝接管）
    window.saveZoneTheme(zoneKey, theme.id);
    window.applyZoneTheme(zoneKey, theme.id);
    buildControls();
    showToast('已存为主题「' + name + '」✨');
  });

  // ── Open / Close ──
  function open(scopeId) {
    overlay.classList.add('show');
    currentScope = (scopeId && getScopeDef(scopeId)) ? scopeId : suggestScope();
    buildTabs();
    buildControls();
    updateSaveThemeBtn();
  }
  function close() { overlay.classList.remove('show'); }
  window._tweakOpen = open;   // 主题专区「+ 添加」入口用

  trigger.addEventListener('click', open);
  document.getElementById('tweak-close').addEventListener('click', close);
  document.getElementById('tweak-done').addEventListener('click', close);

  // Click outside panel (on dark overlay background) to close
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) close();
  });

  // Esc to close
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && overlay.classList.contains('show')) close();
  });

  // Settings → tweak link (handled here for correct timing)
  var settingsLink = document.getElementById('settings-tweak-link');
  if (settingsLink) {
    settingsLink.addEventListener('click', function(e) {
      e.preventDefault();
      var settingsOverlay = document.getElementById('settings-overlay');
      if (settingsOverlay) settingsOverlay.classList.remove('show');
      open();
    });
  }

  // ── Reset ──
  // 重置 = 清光该 scope 的 inline 变量，回到 CSS 规则本色（当前主题或默认外观）
  document.getElementById('tweak-reset').addEventListener('click', function() {
    var tokens = getTokensForScope(currentScope);
    var defs = defaults[currentScope] || {};
    if (!current[currentScope]) current[currentScope] = {};

    tokens.forEach(function(p) {
      current[currentScope][p.key] = defs[p.key];
    });
    clearScopeInline(currentScope);
    buildControls();
    persist();
  });

  // ── Copy CSS ──
  document.getElementById('tweak-copy').addEventListener('click', function() {
    var tokens = getTokensForScope(currentScope);
    var currentForScope = current[currentScope] || {};
    var defs = defaults[currentScope] || {};

    var changed = [];
    tokens.forEach(function(p) {
      var v = currentForScope[p.key];
      var d = defs[p.key];
      if (v !== undefined && String(v) !== String(d)) {
        changed.push('  ' + p.key + ': ' + v + (p.unit || '') + ';');
      }
    });

    var text;
    if (changed.length) {
      var selector;
      if (currentScope === 'global') {
        selector = ':root';
      } else {
        var def = getScopeDef(currentScope);
        selector = def ? (def.selector || '#' + currentScope + '-page') : '#' + currentScope + '-page';
      }
      text = selector + ' {\n' + changed.join('\n') + '\n}';
    } else {
      text = '// 无变更';
    }

    text = '以下 CSS 变量变更，请帮我应用到 main.css：\n\n```css\n' + text + '\n```';

    navigator.clipboard.writeText(text).then(function() {
      showToast('✔ 已复制 Design Tokens');
    }).catch(function() {
      alert('复制失败，请手动复制');
    });
  });

  // ── Toast ──
  function showToast(msg) {
    var toast = document.getElementById('toast') || document.createElement('div');
    if (!toast.id) {
      toast.id = 'toast';
      toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#2d2d2d;color:#fff;padding:10px 24px;border-radius:20px;font-size:13px;z-index:999;pointer-events:none;transition:opacity 0.25s;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(function(){ toast.style.opacity = '0'; }, 2000);
  }

  // ── Listen for page changes ──
  window.addEventListener('page-changed', function(e) {
    if (!overlay.classList.contains('show')) return;
    var suggested = suggestScope();
    if (suggested !== currentScope) {
      switchScope(suggested);
    }
  });

  window.addEventListener('component-switched', function(e) {
    if (!overlay.classList.contains('show')) return;
    var name = e.detail && e.detail.name;
    if (name && window._pageTokens && window._pageTokens[name] && name !== currentScope) {
      switchScope(name);
    }
  });

  // ── Init ──
  initState();
  applyAll();
})();
