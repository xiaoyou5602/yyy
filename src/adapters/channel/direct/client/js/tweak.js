/* ── Visual Tweak Panel ── */
// Per-page design token editor. Reads token definitions from window._pageTokens,
// scopes CSS property changes to page containers (not just :root).
// Persists tweaks in localStorage so they survive refresh.
(function() {
  var root = document.documentElement;
  var overlay = document.getElementById('tweak-overlay');
  var trigger = document.getElementById('tweak-trigger');
  var body = document.getElementById('tweak-body');
  var tabsEl = null;

  trigger.style.display = 'flex';

  var LS_KEY = 'withtoge-tweak-persist';

  // ── State ──
  var currentScope = 'global';   // active tab
  var defaults = {};             // { scopeId: { key: defaultValue } }
  var current = {};              // { scopeId: { key: currentValue } }
  var sectionOrder = ['色彩','气泡','圆角','间距','字体','页面','头部','底部栏','场景','UI','按钮','日期格','计划面板','月标题','快捷入口','布局','画板','工具栏','日记','标签','类型色','表单','标题','卡片','预览','区块','文字','背景','日历','形状','菜单','遮罩','其他'];

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

  // ── Init defaults & current from definitions + computed + localStorage ──
  function initState() {
    defaults = {};
    current = {};

    var persisted = {};
    try { persisted = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch(e) {}

    var scopes = Object.keys(window._pageTokens || {});
    scopes.forEach(function(scopeId) {
      defaults[scopeId] = {};
      current[scopeId] = {};

      var tokens = getTokensForScope(scopeId);
      var target = getScopeTarget(scopeId);
      var saved = persisted[scopeId] || {};

      tokens.forEach(function(p) {
        // determine default: explicit default || read from computed style || sensible fallback
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

        // current = saved || default
        var savedVal = saved[p.key];
        if (p.type === 'range' && typeof savedVal === 'string') {
          savedVal = parseFloat(savedVal);
        }
        current[scopeId][p.key] = (savedVal !== undefined) ? savedVal : defVal;
      });
    });
  }

  // ── Apply ──
  function applyToken(scopeId, key, val, unit) {
    var target = getScopeTarget(scopeId);
    if (!target) return;
    target.style.setProperty(key, val + (unit || ''));
  }

  function applyScope(scopeId) {
    var vals = current[scopeId] || {};
    var tokens = getTokensForScope(scopeId);
    tokens.forEach(function(p) {
      if (vals[p.key] !== undefined) {
        applyToken(scopeId, p.key, vals[p.key], p.unit);
      }
    });
  }

  function applyAll() {
    Object.keys(current).forEach(function(scopeId) {
      applyScope(scopeId);
    });
  }

  // ── Persist ──
  function persist() {
    var data = {};
    Object.keys(current).forEach(function(scopeId) {
      data[scopeId] = {};
      var vals = current[scopeId];
      var defs = defaults[scopeId] || {};
      Object.keys(vals).forEach(function(key) {
        var v = vals[key];
        var d = defs[key];
        // Only persist if different from default
        if (String(v) !== String(d)) {
          data[scopeId][key] = v;
        }
      });
      if (Object.keys(data[scopeId]).length === 0) delete data[scopeId];
    });
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch(e) {}
  }

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
  }

  // Suggest a scope based on current page
  function suggestScope() {
    var page = (typeof currentPage !== 'undefined') ? currentPage : 'chat';
    // Map page names to scope IDs
    var map = {
      chat: 'chat', memory: 'memory', calendar: 'calendar',
      meditation: 'meditation', graffiti: 'graffiti',
      worldbook: 'worldbook', gifts: 'gifts',
      camera: 'camera', mcp: 'mcp', bookmarks: 'bookmarks',
      bubbletea: 'bubbletea'
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

  // ── Open / Close ──
  function open() {
    overlay.classList.add('show');
    currentScope = suggestScope();
    buildTabs();
    buildControls();
  }
  function close() { overlay.classList.remove('show'); }

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
  document.getElementById('tweak-reset').addEventListener('click', function() {
    var tokens = getTokensForScope(currentScope);
    var defs = defaults[currentScope] || {};
    if (!current[currentScope]) current[currentScope] = {};

    tokens.forEach(function(p) {
      current[currentScope][p.key] = defs[p.key];
      applyToken(currentScope, p.key, defs[p.key], p.unit);
    });
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
