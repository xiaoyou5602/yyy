/* ── Design Token Editor ── */
(function() {
  var root = document.documentElement;
  var overlay = document.getElementById('tweak-overlay');
  var trigger = document.getElementById('tweak-trigger');
  var body = document.getElementById('tweak-body');

  trigger.style.display = 'flex';

  var PARAMS = [
    // ── 色彩 ──
    { key:'--bg',              label:'背景色',      section:'色彩', type:'color' },
    { key:'--surface',         label:'卡片底色',    section:'色彩', type:'color' },
    { key:'--text',            label:'正文色',      section:'色彩', type:'color' },
    { key:'--text-muted',      label:'次要文字',    section:'色彩', type:'color' },
    { key:'--text-subtle',     label:'提示文字',    section:'色彩', type:'color' },
    { key:'--accent',          label:'主题色',      section:'色彩', type:'color' },
    { key:'--accent-soft',     label:'主题浅底',    section:'色彩', type:'color' },
    { key:'--accent-cool',     label:'冷调强调',    section:'色彩', type:'color' },
    { key:'--accent-cool-soft',label:'冷调浅底',    section:'色彩', type:'color' },
    { key:'--bubble-you',      label:'你的气泡',    section:'气泡', type:'color' },
    { key:'--bubble-you-text', label:'你的字色',    section:'气泡', type:'color' },
    { key:'--bubble-ke',       label:'克的气泡',    section:'气泡', type:'color' },
    { key:'--bubble-ke-text',  label:'克的字色',    section:'气泡', type:'color' },
    { key:'--border',          label:'边框色',      section:'色彩', type:'color' },
    { key:'--border-soft',     label:'浅边框',      section:'色彩', type:'color' },

    // ── 圆角 ──
    { key:'--radius-xs', label:'小圆角',   section:'圆角', type:'range', min:2, max:18, step:1, unit:'px' },
    { key:'--radius-sm', label:'中小圆角', section:'圆角', type:'range', min:4, max:26, step:1, unit:'px' },
    { key:'--radius',    label:'默认圆角', section:'圆角', type:'range', min:6, max:36, step:1, unit:'px' },
    { key:'--radius-lg', label:'大圆角',   section:'圆角', type:'range', min:8, max:48, step:1, unit:'px' },

    // ── 间距（全局 Design Tokens） ──
    { key:'--msg-gap',       label:'消息间距',   section:'间距', type:'range', min:2, max:28, step:1, unit:'px' },
    { key:'--msg-padding-x', label:'消息内边距', section:'间距', type:'range', min:6, max:28, step:1, unit:'px' },
    { key:'--header-pt',     label:'头部上距',   section:'间距', type:'range', min:4, max:28, step:1, unit:'px' },
    { key:'--header-pb',     label:'头部下距',   section:'间距', type:'range', min:4, max:28, step:1, unit:'px' },
    { key:'--body-max-w',    label:'页面最大宽', section:'间距', type:'range', min:400, max:900, step:10, unit:'px' },
    { key:'--input-min-h',   label:'输入栏高度', section:'间距', type:'range', min:34, max:60, step:1, unit:'px' },
    { key:'--send-btn-size', label:'发送按钮',   section:'间距', type:'range', min:32, max:56, step:1, unit:'px' },
    { key:'--pet-size',      label:'小螃蟹大小', section:'间距', type:'range', min:32, max:80, step:2, unit:'px' },
    { key:'--bubble-max-w',  label:'气泡最大宽', section:'间距', type:'range', min:60, max:95, step:1, unit:'%' },
    { key:'--footer-pb',     label:'底部安全距', section:'间距', type:'range', min:0, max:24, step:1, unit:'px' },

    // ── 字体 ──
    { key:'--font-body-size', label:'正文字号', section:'字体', type:'range', min:12, max:19, step:0.5, unit:'px' },
    { key:'--msg-font-size',  label:'消息字号', section:'字体', type:'range', min:13, max:18, step:0.5, unit:'px' },
    { key:'--h1-font-size',   label:'标题字号', section:'字体', type:'range', min:14, max:26, step:0.5, unit:'px' },
  ];

  var defaults = {};
  var current = {};

  function readDefault(key, def) {
    var v = getComputedStyle(root).getPropertyValue(key).trim();
    if (!v) return def.min !== undefined ? (def.min + (def.max - def.min) / 2) : '#000';
    if (def.type === 'range') return parseFloat(v);
    return v;
  }

  PARAMS.forEach(function(p) {
    defaults[p.key] = readDefault(p.key, p);
    current[p.key] = defaults[p.key];
  });

  function applyParam(key, val) {
    var p = PARAMS.find(function(x){ return x.key === key; });
    if (!p) return;
    root.style.setProperty(key, val + (p.unit || ''));
  }

  function buildUI() {
    var sections = {};
    PARAMS.forEach(function(p) {
      if (!sections[p.section]) sections[p.section] = [];
      sections[p.section].push(p);
    });

    var html = '';
    var secOrder = ['色彩','气泡','圆角','间距','字体'];
    secOrder.forEach(function(sec) {
      var items = sections[sec];
      if (!items) return;
      html += '<div class="tweak-section"><div class="tweak-section-title">'+sec+'</div>';
      items.forEach(function(p) {
        if (p.type === 'color') {
          html += '<div class="tweak-row colors">'+
            '<span class="tweak-label">'+p.label+'</span>'+
            '<input type="color" data-key="'+p.key+'" value="'+current[p.key]+'">'+
            '<span class="tweak-val" data-key="'+p.key+'">'+current[p.key]+'</span>'+
          '</div>';
        } else {
          html += '<div class="tweak-row">'+
            '<span class="tweak-label">'+p.label+'</span>'+
            '<input type="range" data-key="'+p.key+'" min="'+p.min+'" max="'+p.max+'" step="'+p.step+'" value="'+current[p.key]+'">'+
            '<span class="tweak-val" data-key="'+p.key+'">'+current[p.key]+(p.unit||'')+'</span>'+
          '</div>';
        }
      });
      html += '</div>';
    });
    body.innerHTML = html;

    body.querySelectorAll('input[type="range"]').forEach(function(inp) {
      inp.addEventListener('input', function() {
        var key = inp.dataset.key;
        var val = parseFloat(inp.value);
        current[key] = val;
        applyParam(key, val);
        var ve = body.querySelector('.tweak-val[data-key="'+key+'"]');
        var p = PARAMS.find(function(x){ return x.key === key; });
        if (ve && p) ve.textContent = val + (p.unit||'');
      });
    });

    body.querySelectorAll('input[type="color"]').forEach(function(inp) {
      inp.addEventListener('input', function() {
        var key = inp.dataset.key;
        current[key] = inp.value;
        applyParam(key, inp.value);
        var ve = body.querySelector('.tweak-val[data-key="'+key+'"]');
        if (ve) ve.textContent = inp.value;
      });
    });
  }

  function open() { overlay.classList.add('show'); buildUI(); }
  function close() { overlay.classList.remove('show'); }

  trigger.addEventListener('click', open);
  document.getElementById('tweak-close').addEventListener('click', close);
  document.getElementById('tweak-done').addEventListener('click', close);

  // Esc to close
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && overlay.classList.contains('show')) close();
  });

  // Reset
  document.getElementById('tweak-reset').addEventListener('click', function() {
    PARAMS.forEach(function(p) {
      current[p.key] = defaults[p.key];
      applyParam(p.key, defaults[p.key]);
    });
    buildUI();
  });

  // Copy CSS for Claude
  document.getElementById('tweak-copy').addEventListener('click', function() {
    var changed = [];
    PARAMS.forEach(function(p) {
      var v = current[p.key];
      var d = defaults[p.key];
      if (String(v) !== String(d)) {
        changed.push('  '+p.key+': '+v+(p.unit||'')+';');
      }
    });

    var text;
    if (changed.length) {
      text = ':root {\n'+changed.join('\n')+'\n}';
    } else {
      text = '// 无变更';
    }

    text = '以下 CSS 变量变更，请帮我应用到 main.css 的 :root 块：\n\n```css\n'+text+'\n```';

    navigator.clipboard.writeText(text).then(function() {
      var toast = document.getElementById('toast') || document.createElement('div');
      if (!toast.id) { toast.id = 'toast'; toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#2d2d2d;color:#fff;padding:10px 24px;border-radius:20px;font-size:13px;z-index:999;pointer-events:none;transition:opacity 0.25s;'; document.body.appendChild(toast); }
      toast.textContent = '✔ 已复制 Design Tokens';
      toast.style.opacity = '1';
      clearTimeout(toast._t);
      toast._t = setTimeout(function(){ toast.style.opacity = '0'; }, 2000);
    }).catch(function() {
      alert('复制失败，请手动复制');
    });
  });

  // Apply initial values
  PARAMS.forEach(function(p) {
    applyParam(p.key, current[p.key]);
  });
})();
