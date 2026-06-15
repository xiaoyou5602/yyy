# 组件化重构方案

## 现状

所有页面 HTML 嵌在 `index.html` 一个文件里，CSS 混在 `main.css` 一个文件里。JS 虽然拆了文件，但 DOM 结构散落导致：

- 调参台无法按页面分组——选择器到处飞，改了聊天页可能影响日历页
- 换一个组件（比如日历）要同时改 HTML / CSS / JS 三个位置
- 加新页面只能在 index.html 里继续堆

## 目标结构

```
client/
├── index.html          ← 只留空壳 + <div id="app"> + script 入口
├── css/
│   ├── variables.css   ← :root Design Tokens（全局共享）
│   └── base.css        ← reset / body / scrollbar / 通用动画
├── js/
│   └── app.js          ← 路由 + WebSocket + 设置（轻量，只做调度）
└── components/
    ├── chat/
    │   ├── chat.html   ← JS 模板字符串
    │   ├── chat.css
    │   ├── chat.js
    │   └── tokens.json ← 可调 Design Tokens 声明
    ├── calendar/
    │   ├── calendar.html
    │   ├── calendar.css
    │   ├── calendar.js
    │   └── tokens.json
    ├── memory/
    │   ├── memory.html
    │   ├── memory.css
    │   ├── memory.js
    │   └── tokens.json
    ├── meditation/
    │   ├── meditation.html
    │   ├── meditation.css
    │   ├── meditation.js
    │   └── tokens.json
    ├── graffiti/
    │   ├── graffiti.html
    │   ├── graffiti.css
    │   ├── graffiti.js
    │   └── tokens.json
    ├── pet/
    │   ├── pet.html
    │   ├── pet.css
    │   ├── pet.js
    │   └── tokens.json
    └── tweak/
        ├── tweak.html
        ├── tweak.css
        ├── tweak.js        ← 自动读取各组件 tokens.json 生成控件
        └── tokens.json
```

## 组件规范

每个组件文件夹包含：

| 文件 | 作用 |
|------|------|
| `*.html` | JS 模板字符串，返回 DOM 片段 |
| `*.css` | 组件专属样式，选择器只作用在组件根节点内 |
| `*.js` | 组件逻辑，暴露 `init()` / `destroy()` / `show()` / `hide()` |
| `tokens.json` | 该组件可调的 Design Tokens 声明 |

### tokens.json 格式

```json
{
  "component": "calendar",
  "tokens": [
    {
      "key": "--cal-title-grad-1",
      "label": "标题渐变·起",
      "section": "月标题",
      "type": "color",
      "default": "#c44536"
    },
    {
      "key": "--cal-title-grad-2",
      "label": "标题渐变·中",
      "section": "月标题",
      "type": "color",
      "default": "#e85d3f"
    },
    {
      "key": "--cal-title-grad-3",
      "label": "标题渐变·末",
      "section": "月标题",
      "type": "color",
      "default": "#d4a574"
    },
    {
      "key": "--cal-header-pb",
      "label": "标题与日历格间距",
      "section": "布局",
      "type": "range",
      "min": 4,
      "max": 32,
      "step": 1,
      "unit": "px",
      "default": 12
    },
    {
      "key": "--cal-day-num-size",
      "label": "日期数字字号",
      "section": "日期格",
      "type": "range",
      "min": 12,
      "max": 24,
      "step": 1,
      "unit": "px",
      "default": 16
    },
    {
      "key": "--cal-day-cell-h",
      "label": "日期格最小高度",
      "section": "日期格",
      "type": "range",
      "min": 36,
      "max": 60,
      "step": 2,
      "unit": "px",
      "default": 44
    },
    {
      "key": "--cal-weekday-color",
      "label": "工作日数字颜色",
      "section": "日期格",
      "type": "color",
      "default": "#8FA89B"
    },
    {
      "key": "--cal-weekend-color",
      "label": "周末数字颜色",
      "section": "日期格",
      "type": "color",
      "default": "#D4948A"
    },
    {
      "key": "--cal-panel-bg",
      "label": "计划面板底色",
      "section": "计划面板",
      "type": "color",
      "default": "#FFFFFF"
    },
    {
      "key": "--cal-plan-gap",
      "label": "计划项间距",
      "section": "计划面板",
      "type": "range",
      "min": 2,
      "max": 16,
      "step": 1,
      "unit": "px",
      "default": 6
    },
    {
      "key": "--cal-hub-bg",
      "label": "Hub 卡片底色",
      "section": "快捷入口",
      "type": "color",
      "default": "#FFFFFF"
    }
  ]
}
```

## 调参台怎么用 tokens.json

调参台启动时遍历所有组件的 `tokens.json`，按 `component` + `section` 两级分组渲染控件。每个控件读写对应 CSS 变量。

```
组件 A tokens      组件 B tokens        组件 C tokens
     │                   │                    │
     └───────────────────┴────────────────────┘
                         │
                   调参台自动合并
                         │
              ┌──────────┼──────────┐
              │          │          │
           聊天页     日历页     记忆页
           (可切页实时预览效果)
```

加新组件时，只需新建文件夹 + 写 tokens.json，调参台自动识别。

## 分步实施

### 第 1 步：抽日历组件（先验证模式）

- 从 index.html 切出日历 HTML → `calendar.html`（JS 模板字符串）
- 从 main.css 切出日历 CSS → `calendar.css`
- calendar.js 已独立，加 `init()` / `show()` / `hide()` 接口
- 写 `tokens.json`，全局 `:root` 加对应的 CSS 变量
- index.html 留 `<div id="calendar-page">` 空壳，calendar.js 启动时自己渲染

### 第 2 步：改调参台

- 读取各组件 tokens.json
- UI 改为 `组件 → 分区 → 控件` 三级结构
- 面板右侧加组件切换标签

### 第 3 步：逐个抽其余组件

按聊天页 → 记忆页 → 涂鸦页 → 桌宠的顺序

### 第 4 步：重构 main.css

剩下的全局样式拆成 `variables.css` + `base.css`

---

## 日历组件具体可调项

基于现有 CSS 分析：

| 区域 | 控件 | CSS 变量 | 默认值 |
|------|------|----------|--------|
| 月标题 | 渐变起色 | `--cal-title-grad-1` | `#c44536` |
| 月标题 | 渐变中色 | `--cal-title-grad-2` | `#e85d3f` |
| 月标题 | 渐变末色 | `--cal-title-grad-3` | `#d4a574` |
| 月标题 | 标题字号 | `--cal-title-size` | `32px` |
| 月标题 | 与日历格间距 | `--cal-header-pb` | `12px` |
| 日期格 | 最小高度 | `--cal-day-cell-h` | `44px` |
| 日期格 | 圆角 | `--cal-day-radius` | `12px` |
| 日期格 | 数字字号 | `--cal-day-num-size` | `16px` |
| 日期格 | 工作日数字色 | `--cal-weekday-color` | `#8FA89B` |
| 日期格 | 周末数字色 | `--cal-weekend-color` | `#D4948A` |
| 日期格 | 今日/选中底色 | 复用 `--accent` | `#E85D3F` |
| 计划面板 | 面板底色 | `--cal-panel-bg` | `#FFFFFF` |
| 计划面板 | 计划项间距 | `--cal-plan-gap` | `6px` |
| 计划面板 | 计划项底色 | `--cal-plan-bg` | `#FFFFFF` |
| 快捷入口 | Hub 卡片底色 | `--cal-hub-bg` | `#FFFFFF` |
| 快捷入口 | 小猫图片 | `--cal-cat-img` | `url(...)` |

---

## 附录 A：当前前端代码

### A.1 index.html（页面 DOM 结构）

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>克</title>
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#F7F4EF">
<link rel="stylesheet" href="/css/main.css">
</head>
<body>

<!-- ═══ CHAT PAGE ═══ -->
<div id="chat-page" class="show">
  <header>
    <button id="menu-btn" title="日历">&#9776;</button>
    <h1 id="header-title">克</h1>
    <div class="status-wrap">
      <div id="status-dot"></div>
      <span id="status-text">连接中…</span>
    </div>
    <button id="search-btn" title="搜索记录">
      <svg>...</svg>
    </button>
    <button id="settings-btn" title="设置">&#9881;</button>
  </header>

  <div id="messages"></div>
  <div id="typing-indicator">...</div>
  <div id="image-preview"></div>

  <!-- 桌宠螃蟹 -->
  <div class="desk-pet" id="desk-pet">
    <div class="desk-pet-body" id="desk-pet-body"></div>
    <div class="desk-pet-shadow"></div>
  </div>

  <footer>
    <textarea id="input" rows="1" placeholder="说点什么…"></textarea>
    <input type="file" id="file-input" multiple hidden>
    <button id="image-btn" title="添加图片或文件">+</button>
    <button id="send-btn" disabled>发送</button>
  </footer>
</div>

<!-- ═══ MEMORY PAGE ═══ -->
<div id="memory-page">
  <header>
    <button id="back-btn" title="返回聊天">&#8592;</button>
    <h1>记忆</h1>
    <div style="flex:1"></div>
  </header>
  <div id="memory-tabs">
    <button class="active" data-tab="diary">日记</button>
    <button data-tab="rollups">周报</button>
    <button data-tab="memory">记忆碎片</button>
  </div>
  <div id="memory-content"><div class="empty-state">加载中…</div></div>
</div>

<!-- ═══ CALENDAR PAGE ═══ -->
<div id="calendar-page">
  <div class="cal-scroll-wrap" id="cal-scroll-wrap">
    <header class="cal-header">
      <button id="cal-back-btn" title="返回聊天">&#8592;</button>
      <h2 class="cal-month-title heading-serif" id="cal-month-title"></h2>
      <img class="cal-cat" id="cal-cat" src="/clawd-assets/calico-mini-sleep.png">
      <div class="cal-nav-row">
        <button class="cal-nav-btn" id="cal-prev">◀</button>
        <button class="cal-today-btn" id="cal-today">今天</button>
        <button class="cal-nav-btn" id="cal-next">▶</button>
      </div>
    </header>
    <div class="cal-weekdays">
      <span>日</span><span>一</span><span>二</span><span>三</span>
      <span>四</span><span>五</span><span>六</span>
    </div>
    <div id="calendar-grid" class="calendar-grid"></div>
    <div id="calendar-day-panel" class="calendar-day-panel">
      <div class="cal-panel-header">
        <div>
          <h3 class="cal-panel-date" id="cal-panel-date"></h3>
        </div>
        <button class="cal-add-btn" id="cal-add-plan">+ 添加</button>
      </div>
      <div id="plan-list" class="plan-list"></div>
      <div class="plan-empty" id="plan-empty">...</div>
      <button class="plan-fab" id="plan-fab" title="添加计划">+</button>
    </div>
    <div class="cal-hub">
      <button class="cal-hub-item" onclick="showPage('graffiti')">🎨 涂鸦</button>
      <button class="cal-hub-item" onclick="...">📖 日记</button>
    </div>
  </div>
</div>

<!-- 冥想页、涂鸦页、设置面板、调参台、搜索面板省略 -->
</body>
</html>
```

**问题**：所有页面 DOM 平铺在一个文件里。聊天页的 `<header>`、记忆页的 `<header>`、日历的 `<header class="cal-header">` 都在同一层级，CSS 靠标签选择器 `header { }` 和 `.cal-header { }` 区分。加新页面 = 继续往这个文件堆 HTML。

---

### A.2 main.css 关键部分

#### :root 变量（全局 Design Tokens 起点）

```css
:root {
  --bg: #F7F4EF;
  --surface: #FFFFFF;
  --text: #2D2D2D;
  --text-muted: #8E8E93;
  --text-subtle: #B0B0B6;
  --accent: #E85D3F;
  --accent-soft: #FEF0EB;
  --accent-cool: #5B7FFF;
  --accent-cool-soft: #EEF1FE;
  --bubble-you: #E85D3F;
  --bubble-you-text: #FFFFFF;
  --bubble-ke: #F0EDE7;
  --bubble-ke-text: #2D2D2D;
  --border: #E8E4DE;
  --border-soft: #F0EDE6;
  --shadow-xs: 0 1px 2px rgba(0,0,0,0.03);
  --shadow-sm: 0 2px 8px rgba(0,0,0,0.06);
  --shadow-md: 0 4px 20px rgba(0,0,0,0.10);
  --shadow-lg: 0 8px 40px rgba(0,0,0,0.14);
  --radius-xs: 8px;
  --radius-sm: 12px;
  --radius: 18px;
  --radius-lg: 24px;
  --radius-full: 9999px;
  --font-display: Georgia, "Noto Serif SC", serif;
  --font-body: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  /* 最近加的 spacing/typography tokens */
  --msg-gap: 12px;
  --msg-padding-x: 16px;
  --header-pt: 12px;
  --header-pb: 12px;
  --body-max-w: 680px;
  --input-min-h: 44px;
  --send-btn-size: 44px;
  --pet-size: 64px;
  --bubble-max-w: 78%;
  --footer-pb: 8px;
  --font-body-size: 15px;
  --msg-font-size: 14.5px;
  --h1-font-size: 17px;
}
```

#### 聊天页 header（硬编码色，不可调）

```css
header {
  display: flex; align-items: center; gap: 10px;
  padding: var(--header-pt) 20px var(--header-pb) 20px;
  background: #FDF5EC;  /* ← 硬编码暖米色！调参台改不了 */
  flex-shrink: 0; user-select: none;
  border-bottom: 1px solid rgba(232,93,63,0.08);
}
header h1 {
  font-size: var(--h1-font-size); font-weight: 600; flex: 1;
}
```

#### 聊天页消息区

```css
#messages {
  flex: 1; overflow-y: auto;
  padding: 20px var(--msg-padding-x);
  display: flex; flex-direction: column; gap: var(--msg-gap);
}
.msg {
  max-width: var(--bubble-max-w); padding: 9px 14px;
  border-radius: var(--radius);
  line-height: 1.25; font-size: var(--msg-font-size);
}
.msg.you {
  align-self: flex-end; width: fit-content;
  background: var(--bubble-you); color: var(--bubble-you-text);
  border-bottom-right-radius: 6px;
}
```

#### 输入栏 & 桌宠

```css
footer {
  padding: 0 12px calc(var(--footer-pb) + env(safe-area-inset-bottom));
  flex-shrink: 0; display: flex; gap: 8px; align-items: flex-end;
}
#input {
  flex: 1; resize: none; min-height: var(--input-min-h); max-height: 120px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-full); padding: 11px 20px;
}
#send-btn {
  height: var(--send-btn-size); min-width: var(--send-btn-size);
  border: none; border-radius: 50%;
  background: var(--accent); color: #fff;
}
.desk-pet {
  position: absolute; bottom: 50px; left: 12px;
  width: var(--pet-size); height: var(--pet-size);
  cursor: pointer; z-index: 2;
}
```

#### 日历页 CSS（~220 行，以下是代表性片段）

```css
#calendar-page { background: var(--bg); }

.cal-header {
  display: flex; align-items: center; gap: 10px;
  padding: 18px 20px 12px;
  background: transparent;
}

.cal-month-title {
  font-size: 32px; font-weight: 700;
  background: linear-gradient(135deg, #c44536 0%, #e85d3f 60%, #d4a574 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  /* ↑ 渐变三色全硬编码 */
}

.calendar-grid {
  display: grid; grid-template-columns: repeat(7, 1fr);
  gap: 4px; padding: 0 12px;
}

.cal-day-cell {
  aspect-ratio: 1; border-radius: var(--radius-sm);
  cursor: pointer; min-height: 44px; /* ← 硬编码 */
}

.cal-day-num {
  font-size: 16px; font-weight: 600;
  color: #8FA89B;  /* ← 工作日颜色硬编码 */
}

.cal-day-cell.weekend .cal-day-num { color: #D4948A; }
.cal-day-cell.today { background: var(--accent); }

.calendar-day-panel {
  padding: 0 20px 20px;
  background: var(--bg);  /* ← 复用全局 --bg */
}

.plan-list { display: flex; flex-direction: column; gap: 6px; }

.plan-item {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; border-radius: var(--radius);
  background: var(--surface); border: 1px solid var(--border-soft);
}

.cal-hub-item {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  gap: 8px; padding: 18px 12px; border-radius: var(--radius);
  background: var(--surface);  /* ← 复用全局 */
}
```

**问题**：日历页的硬编码值（`#c44536`、`#8FA89B`、`#D4948A`、`44px`、`32px` 等）没有对应的 CSS 变量，调参台完全摸不到。渐变三色和月标题字号只能改源码。

---

### A.3 当前 tweak.js（展示问题）

```js
// 旧版 PARAMS 片段 —— 间距/字号用硬编码选择器注入 CSS
var PARAMS = [
  // 色彩 —— ✅ 已经是 CSS 变量，全局生效
  { key:'--bg', label:'背景色', section:'色彩', type:'color' },

  // 间距 —— ❌ 用 css 字段注入选择器，只命中聊天页
  { key:'msg-gap', label:'消息间距', section:'间距', type:'range',
    min:2, max:28, css:'#messages{ gap:V; }' },
  { key:'msg-padding', label:'消息内边距', section:'间距', type:'range',
    min:6, max:28, css:'#messages{ padding-left:V; padding-right:V; }' },
  { key:'header-pt', label:'头部上距', section:'间距', type:'range',
    min:4, max:28, css:'header{ padding-top:V; }' },
  { key:'pet-size', label:'小螃蟹大小', section:'间距', type:'range',
    min:32, max:80, css:'.desk-pet{ width:V; height:V; }' },
  // ...
];
```

**问题**：
1. 间距/字号控件的 `css` 字段使用硬编码选择器（`#messages`、`header`、`.desk-pet`），只命中聊天页
2. 改聊天页的 `header` padding 会同时影响记忆页的 `header`（因为用的都是 `header` 标签选择器）
3. 日历页完全没有自己的控件——`cal-month-title` 的渐变、`cal-day-num` 的颜色全是硬编码
4. 没有按页面/组件分组，所有控件平铺在一起

---

### A.4 日历 JS 结构（calendar.js ~386 行）

关键函数：
- `renderCalendar()` — 渲染日历 grid + 绑定事件 + 小猫动画
- `renderDayCell()` — 渲染单个日期格（含 today/selected/weekend/other-month 逻辑 + 农历）
- `selectDate()` — 点击日期 → 渲染当日计划列表
- `openPlanModal()` / `closePlanModal()` / `savePlan()` / `deletePlan()` — 计划 CRUD
- `setupCalMedGesture()` — 日历页上滑进入冥想的手势

**问题**：JS 已独立成文件，但大量引用 `document.getElementById()` 直接操作 DOM。组件化后应改为操作自己渲染的 DOM 片段内的元素。
