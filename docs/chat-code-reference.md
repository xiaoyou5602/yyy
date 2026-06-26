# withtoge 聊天记录系统 — 全部相关代码

## 文件清单

| 文件 | 作用 | 行数 |
|---|---|---|
| `src/adapters/channel/direct/client/index.html` | 前端全部逻辑（消息渲染、去重、排序、存储） | ~2900 |
| `src/adapters/channel/direct/index.js` | 服务端消息处理、chunk分片、globalId生成 | ~460 |
| `src/adapters/channel/direct/ws-server.js` | HTTP服务器、WebSocket、/api/messages路由 | ~1770 |
| `src/adapters/channel/shared/message-store.js` | 服务端消息持久化（按天存JSON文件） | ~75 |

---

## 一、服务端消息存储

### message-store.js (完整)

```javascript
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function createMessageStore(stateDir) {
  const storeDir = path.join(stateDir, "chat-history");

  function ensureDir() {
    if (!fs.existsSync(storeDir)) {
      fs.mkdirSync(storeDir, { recursive: true });
    }
  }

  function formatShanghaiDate(date) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(date);
  }

  function getFilePath(dateStr) {
    return path.join(storeDir, `${dateStr}.json`);
  }

  function loadDay(dateStr) {
    const fp = getFilePath(dateStr);
    if (!fs.existsSync(fp)) return [];
    try { return JSON.parse(fs.readFileSync(fp, "utf8")); } catch { return []; }
  }

  function saveDay(dateStr, messages) {
    ensureDir();
    fs.writeFileSync(getFilePath(dateStr), JSON.stringify(messages, null, 2), "utf8");
  }

  return {
    // 保存一条消息：生成服务端id + timestamp（ISO格式）
    save({ channel, from, text, time, images, model, globalId }) {
      const now = new Date();
      const dateStr = formatShanghaiDate(now);
      const messages = loadDay(dateStr);
      messages.push({
        id: `msg-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
        channel, from,
        text: String(text || "").slice(0, 2000),
        time: time || now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        timestamp: now.toISOString(),
        images: Array.isArray(images) ? images.slice(0, 5) : undefined,
        model: typeof model === "string" ? model.trim() : "",
        globalId: globalId || undefined,
      });
      saveDay(dateStr, messages.slice(-500));  // ⚠️ 每天截断500条
    },

    // 加载：读最近N天文件 → 排序 → 按model过滤
    load(days = 7, modelFilter) {
      const all = [];
      for (let i = 0; i < days; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        all.push(...loadDay(formatShanghaiDate(d)));
      }
      all.sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
      if (modelFilter !== undefined && modelFilter !== null) {
        const key = typeof modelFilter === "string" ? modelFilter.trim() : "";
        return all.filter((m) => (m.model || "") === key);
      }
      return all;
    },
  };
}

module.exports = { createMessageStore };
```

---

## 二、服务端消息处理和chunk分片

### index.js — 核心函数

```javascript
// ═══ globalId 生成 ═══
let globalMsgSeq = 0;
function nextGlobalId() {
  // timestamp prefix (base-36) for cross-node rough sortability
  // + random bytes for uniqueness across nodes
  // + sequence for within-process tiebreak
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString("hex");
  return ts + "-" + rand + "-" + String(++globalMsgSeq).padStart(4, "0");
}

// ═══ sendText：保存完整文本到messageStore，然后分片广播 ═══
async sendText({ userId, text, preserveBlock = false, contextToken = "", model = "" }) {
  const content = String(text || "");
  if (!content.trim()) return;
  const m = String(model || "").trim();
  const gid = nextGlobalId();
  
  // 先保存完整文本到服务端存储
  messageStore.save({ channel: "direct", from: "ke", text: content.trim(), model: m, globalId: gid });
  
  const normalized = trimOuterBlankLines(normalizeLineEndings(content));
  if (preserveBlock) {
    wsServer.broadcast({ type: "text", text: normalized, done: true, model: m, globalId: gid });
    return;
  }
  
  // 分片并逐个广播（间隔350ms）
  const chunks = chunkReplyTextForWeixin(normalized, minChunk);
  for (let i = 0; i < chunks.length; i++) {
    wsServer.broadcast({
      type: "text", text: chunks[i],
      chunkIndex: i,
      done: i === chunks.length - 1,
      model: m,
      globalId: i === chunks.length - 1 ? gid : undefined  // ⚠️ 只有最后一个chunk有globalId
    });
    if (i < chunks.length - 1) await sleep(CHUNK_INTERVAL_MS);  // 350ms间隔
  }
}
```

### ws-server.js — /api/messages 路由

```javascript
// GET /api/messages?days=7&model=deepseek-v4-pro
if (urlPath === "/api/messages") {
  const days = Math.min(Number.parseInt(query.days, 10) || 7, 60);
  const modelFilter = query.model !== undefined ? String(query.model).trim() : undefined;
  const messages = messageStore ? messageStore.load(days, modelFilter) : [];
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(messages));
}
```

---

## 三、前端核心代码

### index.html — 存储键

```javascript
const STORAGE_KEY = "withtoge-chat-history";

function getStorageKey() {
  const m = (settings.model || "").trim();
  return m ? `withtoge-chat-history-${m}` : STORAGE_KEY;
}
// 实际键如: "withtoge-chat-history-deepseek-v4-pro"
// 或:      "withtoge-chat-history-claude-opus-4-6"
```

### index.html — model过滤

```javascript
function msgMatchesModel(msg) {
  const msgModel = String(msg.model || "").trim();
  const curModel = (settings.model || "").trim();
  if (!msgModel || !curModel) return false;  // ⚠️ 任一方空→丢弃消息
  return msgModel === curModel;
}
```

### index.html — 全局变量

```javascript
let history = [];            // 当前消息数组
let initHistoryDone = false; // 初始加载完成标志
let streamingMsgEl = null;   // 当前流的DOM元素
let currentChunkGroupId = null; // 当前chunk组ID
let _msgIdx = 0;             // 消息ID计数器（每次页面加载重置）
```

### index.html — 关键函数

```javascript
// ═══ 消息去重键生成 ═══
function msgDedupKeys(m) {
  var keys = [];
  if (m.globalId) keys.push(m.globalId);
  if (m.id) keys.push(m.id);
  // 始终包含 timestamp|text 指纹作为跨源桥接（localStorage↔服务端）
  keys.push((m.timestamp || "") + "|" + (m.text || "").slice(0, 60));
  return keys;
}

// ═══ 消息排序 ═══
function cmpMsg(a, b) {
  var ta = a.timestamp || "";
  var tb = b.timestamp || "";
  if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;  // ISO时间戳优先
  ta = a.time || "";
  tb = b.time || "";
  if (ta !== tb) return ta < tb ? -1 : 1;              // HH:MM降级
  if (a.globalId && b.globalId) return a.globalId < b.globalId ? -1 : 1;
  return 0;
}

// ═══ 渲染消息到DOM ═══
function renderMsg(msg, save = true) {
  const div = document.createElement("div");
  div.className = `msg ${msg.from === "you" ? "you" : "ke"}`;
  // ⚠️ 每次渲染生成新ID，同一消息不同渲染有不同ID
  const msgId = msg.id || `msg-${Date.now()}-${_msgIdx++}-${Math.random().toString(36).slice(2,6)}`;
  div.setAttribute("data-msg-id", msgId);
  if (!msg.id) msg.id = msgId;
  // ... 构建innerHTML ...
  messagesEl.appendChild(div);
  scrollBottom();
  if (save) { history.push(msg); saveHistory(history); }  // save=true时保存
  return div;
}

function saveHistory(h) {
  try { localStorage.setItem(getStorageKey(), JSON.stringify(h.slice(-500))); } catch {}
}
```

### index.html — initHistory（页面加载时运行）

```javascript
async function initHistory() {
  // 1. 从服务端API加载消息
  let serverMsgs = [];
  try {
    const m = (settings.model || "").trim();
    const q = `?days=7&model=${encodeURIComponent(m)}`;
    const res = await fetch(`/api/messages${q}`);
    if (res.ok) serverMsgs = await res.json();
  } catch {}

  // 2. 从localStorage加载当前模型的消息
  let localMsgs = [];
  try {
    localMsgs = JSON.parse(localStorage.getItem(getStorageKey()) || "[]");
  } catch { localMsgs = []; }

  // 3. 合并去重（服务端优先：[...serverMsgs, ...localMsgs]）
  const seen = new Set();
  const merged = [];
  for (const m of [...serverMsgs, ...localMsgs]) {
    var keys = msgDedupKeys(m);
    if (keys.some(function(k) { return seen.has(k); })) continue;
    keys.forEach(function(k) { seen.add(k); });
    merged.push(m);
  }
  
  merged.sort(cmpMsg);

  // 4. 如果有chunk持久化数据，移除对应的完整消息
  // ...

  // 5. 按当前model过滤
  history = merged.filter(m => !m.model || m.model === cur);
  
  // 6. 渲染（save=false，不保存到localStorage）
  for (const m of history) renderMsg(m, false);
  
  initHistoryDone = true;
  syncHistoryFromServer();
}

initHistory(); // 页面加载时立即调用
```

### index.html — syncHistoryFromServer（服务端同步）

```javascript
async function syncHistoryFromServer() {
  // 从服务端API加载消息
  let serverMsgs = [];
  const q = `?days=7&model=${encodeURIComponent(settings.model)}`;
  const res = await fetch(`/api/messages${q}`, { cache: "no-store" });
  if (res.ok) serverMsgs = await res.json();
  
  // 构建seen-set：history数组 + DOM已有元素
  const seen = new Set();
  for (const m of history) {
    msgDedupKeys(m).forEach(function(k) { seen.add(k); });
  }
  document.querySelectorAll(".msg[data-msg-id]").forEach(function(el) {
    var id = el.getAttribute("data-msg-id");
    if (id) seen.add(id);
  });

  // 过滤缺失消息
  const missing = [];
  for (const m of serverMsgs) {
    var keys = msgDedupKeys(m);
    if (keys.some(function(k) { return seen.has(k); })) continue;
    keys.forEach(function(k) { seen.add(k); });
    missing.push(m);
  }
  
  // 渲染缺失消息（save=true → 保存到localStorage）
  for (const m of missing) {
    renderMsg(m, true);  // ⚠️ 这里会调用saveHistory → 写入localStorage
  }
}
```

### index.html — switchModelHistory（模型切换时运行）

```javascript
function switchModelHistory() {
  const msgs = document.getElementById("messages");
  msgs.innerHTML = "";
  let localMsgs = [];
  try { localMsgs = JSON.parse(localStorage.getItem(getStorageKey()) || "[]"); } catch {}
  history = localMsgs.slice();  // 填充history以便去重
  for (const m of localMsgs) renderMsg(m, false);
  scrollBottom();
}

// 模型切换时：
// selectSidebarModel → switchModelHistory → 300ms → syncHistoryFromServer
```

### index.html — WebSocket消息处理

```javascript
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  switch (msg.type) {
  case "text":
    if (msg.done) saveMessageToModelStorage(msg);  // 存到另一个localStorage键
    if (!msgMatchesModel(msg)) break;  // model不匹配→丢弃
    
    // 生成chunk组ID用于持久化
    const isFirst = (!msg.chunkIndex || msg.chunkIndex === 0);
    if (isFirst) {
      currentChunkGroupId = 'cg-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
    }
    
    if (/* thinking placeholder存在 */) {
      // 补气泡 + 推入history
      history.push({ from:"ke", text:msg.text, time:now(), chunkGroupId, chunkIndex });
      saveHistory(history);
    } else {
      var chunkData = {
        from:"ke", text:msg.text, time:now(),
        chunkGroupId: currentChunkGroupId,
        chunkIndex: msg.chunkIndex || 0
      };
      if (msg.done && msg.globalId) chunkData.globalId = msg.globalId;
      renderMsg(chunkData, true);  // save=true → 推入history并写入localStorage
    }
    
    if (msg.done) {
      notify(msg.text);
      currentChunkGroupId = null;
    }
    break;
  }
};

// WebSocket连接
function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    online(true);
    if (initHistoryDone) syncHistoryFromServer();  // 等待initHistory完成
  };
}
```

### index.html — 发送消息

```javascript
function send() {
  const text = inputEl.value.trim();
  const payload = {
    type: "message",
    messageId: `m-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    text, model: settings.model
  };
  ws.send(JSON.stringify(payload));
  
  // 先渲染用户消息 → renderMsg默认save=true → 写入history+localStorage
  renderMsg({
    from: "you",
    text: label,
    time: now(),  // ⚠️ 只有time(HH:MM)，没有timestamp
  });
}
```

---

## 四、关键数据流

```
用户发消息:
  send() → renderMsg({from:"you", time:now()}, true) → 写入localStorage
  WebSocket → 服务端

服务端处理:
  enqueueMessage() → messageStore.save(from:"you") → 存JSON文件(带ISO timestamp)
  AI回复 → sendText() → messageStore.save(from:"ke", 完整文本)
  → 分片 → 逐个ws broadcast(chunk, chunkIndex, globalId仅最后一片)

前端接收:
  ws.onmessage "text" → msgMatchesModel过滤 → renderMsg(chunkData, true)
  → 写入history + localStorage

页面加载:
  initHistory() → /api/messages + localStorage → 合并去重 → 渲染
  → initHistoryDone=true → syncHistoryFromServer()

模型切换:
  switchModelHistory() → 从localStorage加载 → 渲染
  → 300ms后 syncHistoryFromServer()
```

## 五、已知问题

1. **renderMsg每次生成新ID** — 同一消息渲染两次产生两个不同ID，基于ID的去重永久失效
2. **save=true导致syncHistoryFromServer覆盖localStorage** — 如果竞态时history为空，所有服务端消息被写入localStorage
3. **用户消息无timestamp** — send()渲染时只有time(HH:MM)，与messageStore保存的ISO timestamp不一致
4. **msgMatchesModel严格匹配** — 任一方model为空返回false，实时消息可能被丢弃
5. **history截断500条** — saveHistory + saveMessageToModelStorage + saveDay 三重截断
6. **服务端只存完整文本** — chunks不被持久化，刷新后多气泡变单气泡
