/* ── Page Token Registry ── */
// Each page gets its own scope. Tokens defined here are the defaults;
// the tweak panel binds them to page containers, not :root.
window._pageTokens = {

  global: {
    label: '全局',
    selector: null,  // null = document.documentElement
    tokens: [
      // 色彩
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
      // 圆角
      { key:'--radius-xs', label:'小圆角',   section:'圆角', type:'range', min:2, max:18, step:1, unit:'px' },
      { key:'--radius-sm', label:'中小圆角', section:'圆角', type:'range', min:4, max:26, step:1, unit:'px' },
      { key:'--radius',    label:'默认圆角', section:'圆角', type:'range', min:6, max:36, step:1, unit:'px' },
      { key:'--radius-lg', label:'大圆角',   section:'圆角', type:'range', min:8, max:48, step:1, unit:'px' },
      // 间距
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
      // 字体
      { key:'--font-body-size', label:'正文字号', section:'字体', type:'range', min:12, max:19, step:0.5, unit:'px' },
      { key:'--msg-font-size',  label:'消息字号', section:'字体', type:'range', min:13, max:18, step:0.5, unit:'px' },
      { key:'--h1-font-size',   label:'标题字号', section:'字体', type:'range', min:14, max:26, step:0.5, unit:'px' },
    ]
  },

  // ── 聊天页 ──
  chat: {
    label: '聊天',
    selector: '#chat-page',
    tokens: [
      { key:'--chat-bg', label:'页面背景', section:'页面', type:'color', default:'#fafaf9' },
      { key:'--header-bg', label:'头部底色', section:'头部', type:'color', default:'transparent' },
      { key:'--footer-bg', label:'底部栏底色', section:'底部栏', type:'color', default:'transparent' },
    ]
  },

  // ── 记忆页 ──
  memory: {
    label: '记忆',
    selector: '#memory-page',
    tokens: [
      { key:'--mem-content-bg',   label:'内容区底色',   section:'页面', type:'color', default:'#F7F4EF' },
      { key:'--mem-diary-accent', label:'日记装饰条色', section:'日记', type:'color', default:'#E85D3F' },
      { key:'--mem-chip-active-bg', label:'筛选选中色', section:'标签', type:'color', default:'#E85D3F' },
      { key:'--mem-type-event',   label:'事件标签色',   section:'类型色', type:'color', default:'#4CAF50' },
      { key:'--mem-type-reflection', label:'反思标签色', section:'类型色', type:'color', default:'#5B7FFF' },
      { key:'--mem-type-preference', label:'偏好标签色', section:'类型色', type:'color', default:'#F5A623' },
      { key:'--mem-card-gap',     label:'卡片间距',     section:'布局', type:'range', min:6, max:28, step:1, unit:'px', default:14 },
    ]
  },

  // ── 日历页（运行时由组件 tokens.json 填充）──
  calendar: {
    label: '日历',
    selector: '#calendar-page',
    tokens: [
      { key:'--cal-page-bg',       label:'日历页底色',   section:'页面',   type:'color', default:'#F7F4EF' },
      { key:'--cal-title-grad-1',  label:'月标题渐变起', section:'月标题', type:'color', default:'#c44536' },
      { key:'--cal-title-grad-2',  label:'月标题渐变中', section:'月标题', type:'color', default:'#e85d3f' },
      { key:'--cal-title-grad-3',  label:'月标题渐变末', section:'月标题', type:'color', default:'#d4a574' },
      { key:'--cal-title-size',    label:'月标题字号',   section:'月标题', type:'range', min:20, max:48, step:1, unit:'px', default:32 },
      { key:'--cal-header-pb',     label:'标题格子间距', section:'布局',   type:'range', min:4, max:32, step:1, unit:'px', default:12 },
      { key:'--cal-grid-gap',      label:'日期格间距',   section:'日期格', type:'range', min:1, max:12, step:1, unit:'px', default:4 },
      { key:'--cal-day-cell-h',    label:'日期格最小高', section:'日期格', type:'range', min:36, max:60, step:2, unit:'px', default:44 },
      { key:'--cal-day-radius',    label:'日期格圆角',   section:'日期格', type:'range', min:4, max:24, step:1, unit:'px', default:12 },
      { key:'--cal-day-num-size',  label:'日期数字字号', section:'日期格', type:'range', min:12, max:24, step:1, unit:'px', default:16 },
      { key:'--cal-weekday-color', label:'工作日数字色', section:'日期格', type:'color', default:'#8FA89B' },
      { key:'--cal-weekend-color', label:'周末数字色',   section:'日期格', type:'color', default:'#D4948A' },
      { key:'--cal-panel-bg',      label:'计划面板底色', section:'计划面板',type:'color', default:'#F7F4EF' },
      { key:'--cal-panel-header-pb',label:'面板标题下距', section:'计划面板',type:'range',min:4,max:24,step:1,unit:'px',default:12 },
      { key:'--cal-plan-gap',      label:'计划项间距',   section:'计划面板',type:'range',min:2,max:16,step:1,unit:'px',default:6 },
      { key:'--cal-plan-bg',       label:'计划项底色',   section:'计划面板',type:'color', default:'#FFFFFF' },
      { key:'--cal-hub-bg',        label:'Hub卡片底色',  section:'快捷入口',type:'color', default:'#FFFFFF' },
    ]
  },

  // ── 冥想页 ──
  meditation: {
    label: '冥想',
    selector: '#meditation-page',
    tokens: [
      { key:'--med-bg-start',  label:'背景渐变·起', section:'场景', type:'color', default:'#FEF9F0' },
      { key:'--med-bg-mid',    label:'背景渐变·中', section:'场景', type:'color', default:'#F8EDDF' },
      { key:'--med-bg-end',    label:'背景渐变·末', section:'场景', type:'color', default:'#EEDBC6' },
      { key:'--med-window-start', label:'窗户光·起', section:'场景', type:'color', default:'#FFF8ED' },
      { key:'--med-window-end',   label:'窗户光·末', section:'场景', type:'color', default:'#FFD4A0' },
      { key:'--med-sill-color',   label:'窗台颜色',   section:'场景', type:'color', default:'#D4B896' },
      { key:'--med-rug-color',    label:'地毯颜色',   section:'场景', type:'color', default:'#E8D5C0' },
      { key:'--med-plant-stem',   label:'植物茎色',   section:'场景', type:'color', default:'#A0B88A' },
      { key:'--med-plant-leaf',   label:'植物叶色',   section:'场景', type:'color', default:'#B0C89A' },
      { key:'--med-particle-color', label:'粒子颜色', section:'场景', type:'color', default:'rgba(200,160,100,0.3)' },
      { key:'--med-header-color', label:'头部标题色', section:'UI', type:'color', default:'#8B6F5E' },
      { key:'--med-timer-color', label:'计时器颜色', section:'UI', type:'color', default:'#8B6F5E' },
      { key:'--med-status-text', label:'状态文字色', section:'UI', type:'color', default:'#6B5544' },
      { key:'--med-status-label-color', label:'状态标签色', section:'UI', type:'color', default:'#A89480' },
      { key:'--med-btn-color',   label:'按钮图标色', section:'按钮', type:'color', default:'#8B6F5E' },
      { key:'--med-dur-active-bg',   label:'选中按钮底', section:'按钮', type:'color', default:'#E8A87C' },
      { key:'--med-dur-active-text', label:'选中按钮字', section:'按钮', type:'color', default:'#ffffff' },
      { key:'--med-glass-bg',    label:'毛玻璃底色', section:'UI', type:'color', default:'rgba(255,255,255,0.7)' },
    ]
  },

  // ── 涂鸦页 ──
  graffiti: {
    label: '涂鸦',
    selector: '#graffiti-page',
    tokens: [
      { key:'--graf-bg',        label:'画板底色',     section:'画板', type:'color', default:'#3a3a3a' },
      { key:'--graf-header-bg', label:'头部底色',     section:'头部', type:'color', default:'rgba(30,30,30,0.7)' },
      { key:'--graf-header-text', label:'头部标题色', section:'头部', type:'color', default:'#dddddd' },
      { key:'--graf-back-color',  label:'返回按钮色', section:'头部', type:'color', default:'#aaaaaa' },
      { key:'--graf-toolbar-bg',  label:'工具栏底色', section:'工具栏', type:'color', default:'rgba(30,30,30,0.75)' },
      { key:'--graf-label-color', label:'标签文字色', section:'工具栏', type:'color', default:'#aaaaaa' },
      { key:'--graf-btn-color',   label:'按钮文字色', section:'工具栏', type:'color', default:'#cccccc' },
      { key:'--graf-btn-bg',      label:'按钮底色',   section:'工具栏', type:'color', default:'rgba(255,255,255,0.1)' },
      { key:'--graf-btn-border',  label:'按钮边框色', section:'工具栏', type:'color', default:'rgba(255,255,255,0.15)' },
    ]
  },

  // ── 世界书 ──
  worldbook: {
    label: '世界书',
    selector: '#worldbook-page',
    tokens: [
      { key:'--wb-section-bg',  label:'区块底色',   section:'表单', type:'color', default:'#FFFFFF' },
      { key:'--wb-accent',      label:'标题强调色', section:'标题', type:'color', default:'#E85D3F' },
      { key:'--wb-save-bg',     label:'保存按钮色', section:'按钮', type:'color', default:'#E85D3F' },
      { key:'--wb-input-border', label:'输入框边框', section:'表单', type:'color', default:'#e0ddd6' },
    ]
  },

  // ── 礼物房 ──
  gifts: {
    label: '礼物',
    selector: '#gifts-page',
    tokens: [
      { key:'--gift-card-bg',    label:'礼物卡底色',   section:'卡片', type:'color', default:'#FFFFFF' },
      { key:'--gift-img-bg',     label:'图片区底色',   section:'卡片', type:'color', default:'#f0ede6' },
      { key:'--gift-claim-bg',   label:'领取按钮色',   section:'按钮', type:'color', default:'#E85D3F' },
    ]
  },

  // ── 摄像头 ──
  camera: {
    label: '摄像头',
    selector: '#camera-page',
    tokens: [
      { key:'--cam-preview-bg',  label:'预览区底色', section:'预览', type:'color', default:'#1a1a1a' },
      { key:'--cam-btn-bg',      label:'主要按钮色', section:'按钮', type:'color', default:'#E85D3F' },
    ]
  },

  // ── MCP 娱乐室 ──
  mcp: {
    label: 'MCP',
    selector: '#mcp-page',
    tokens: [
      { key:'--mcp-section-accent', label:'区块标题色', section:'区块', type:'color', default:'#999999' },
      { key:'--mcp-card-bg',        label:'服务器卡底色', section:'卡片', type:'color', default:'#FFFFFF' },
    ]
  },

  // ── 收藏夹 ──
  bookmarks: {
    label: '收藏夹',
    selector: '#bookmarks-page',
    tokens: [
      { key:'--bm-bg',          label:'页面底色',     section:'页面', type:'color', default:'#F7F4EF' },
      { key:'--bm-item-bg',     label:'收藏卡底色',   section:'卡片', type:'color', default:'#ffffff' },
      { key:'--bm-accent',      label:'装饰条色',     section:'卡片', type:'color', default:'#e85d3f' },
      { key:'--bm-count-bg',    label:'数量标签底',   section:'卡片', type:'color', default:'rgba(232,93,63,0.1)' },
      { key:'--bm-count-text',  label:'数量标签字',   section:'卡片', type:'color', default:'#e85d3f' },
      { key:'--bm-date-color',  label:'日期文字色',   section:'文字', type:'color', default:'#888888' },
      { key:'--bm-preview-color', label:'预览文字色', section:'文字', type:'color', default:'#555555' },
      { key:'--bm-you-color',   label:'你的消息色',   section:'文字', type:'color', default:'#e85d3f' },
    ]
  },

  // ── 奶茶记录（运行时由组件 tokens.json 填充）──
  bubbletea: {
    label: '奶茶',
    selector: '#bubbletea-page',
    tokens: [
      { key:'--bt-bg',          label:'页面背景',     section:'背景', type:'color', default:'#FFF9F5' },
      { key:'--bt-surface',     label:'卡片背景',     section:'背景', type:'color', default:'#FFFFFF' },
      { key:'--bt-text',        label:'主文字色',     section:'文字', type:'color', default:'#4A3728' },
      { key:'--bt-text-muted',  label:'次要文字色',   section:'文字', type:'color', default:'#B0A090' },
      { key:'--bt-accent',      label:'强调色',       section:'色彩', type:'color', default:'#D4846A' },
      { key:'--bt-accent-soft', label:'强调色浅底',   section:'色彩', type:'color', default:'#FDF0EA' },
      { key:'--bt-accent2',     label:'辅助绿色',     section:'色彩', type:'color', default:'#A8C8B0' },
      { key:'--bt-cal-today-bg', label:'今日背景',    section:'日历', type:'color', default:'#FDF0EA' },
      { key:'--bt-cal-tea-bg',  label:'奶茶日背景',   section:'日历', type:'color', default:'#FFF0E8' },
      { key:'--bt-radius',      label:'大圆角',       section:'形状', type:'range', min:8, max:32, step:1, unit:'px', default:16 },
      { key:'--bt-radius-sm',   label:'小圆角',       section:'形状', type:'range', min:4, max:20, step:1, unit:'px', default:10 },
    ]
  },

  // ── 小手机主页 ──
  'phone-home': {
    label: '小手机主页',
    selector: '#phone-home-page',
    tokens: [
      { key:'--ph-slate-dark',   label:'深石板色', section:'色彩', type:'color', default:'#1f1f1f' },
      { key:'--ph-focus-blue',   label:'焦点蓝',   section:'色彩', type:'color', default:'#5989b9' },
      { key:'--ph-terracotta',   label:'陶土色',   section:'色彩', type:'color', default:'#cc7b5c' },
      { key:'--ph-ivory-light',  label:'象牙白',   section:'色彩', type:'color', default:'#fafaf7' },
      { key:'--ph-ivory-medium', label:'象牙中',   section:'色彩', type:'color', default:'#f0f0eb' },
    ]
  },

  // ── 侧边栏 ──
  sidebar: {
    label: '侧边栏',
    selector: '#sidebar-drawer',
    tokens: [
      { key:'--side-text',       label:'菜单文字色', section:'菜单', type:'color', default:'#4a3628' },
      { key:'--side-overlay-bg', label:'遮罩底色',   section:'遮罩', type:'color', default:'rgba(45,45,45,0.35)' },
    ]
  }

};
