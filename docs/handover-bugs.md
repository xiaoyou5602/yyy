# withtoge 聊天记录 Bug 交接文档

## 项目结构

```
withtoge/
├── src/adapters/channel/direct/
│   ├── client/
│   │   └── index.html          ← 前端（全部逻辑在一个文件里）
│   ├── index.js                ← 服务端：消息处理、chunk分片、globalId生成
│   └── ws-server.js            ← HTTP + WebSocket 服务器、messageStore、API路由
├── src/adapters/channel/shared/
│   └── message-store.js        ← 服务端消息持久化（按天存JSON文件）
├── test/
│   └── verify-chat-fix.js      ← Playwright自动化测试（新增）
└── package.json
```

## 架构要点

- **前端**：单文件 vanilla JS（[index.html](src/adapters/channel/direct/client/index.html)），约2900行，WebSocket通信
- **消息流**：你发消息 → WebSocket → Node.js → 调用DeepSeek/Claude API → 回复分片(chunk)广播回前端
- **存储**：服务端按天存JSON文件(`stateDir/chat-history/YYYY-MM-DD.json`)；前端localStorage存最近500条
- **双节点**：本地Windows + 东京VPS各跑一份cyberboss，cloudflared隧道负载均衡

## 三个原始Bug

### Bug 1: 聊天记录丢失
**现象**：刷新页面后部分聊天记录消失  
**根因分析**：
1. `switchModelHistory()` (index.html 约1107行) 切换模型时只从localStorage加载，不调服务端API → 服务端独有的消息在切换模型时消失
2. 三重截断：`saveHistory`截断500条、`saveMessageToModelStorage`截断500条、服务端`saveDay`每文件截断500条
3. 双节点messageStore各自独立 → cloudflared路由到不同节点时看到不同的消息库

### Bug 2: 时间错序
**现象**：聊天记录中对话顺序不对，有些对话跑到最前面  
**根因分析**：
1. `cmpMsg()` (index.html 约1863行) 排序用 `a.time`（格式"HH:MM"，无日期）→ 不同天的同一时间排在一起
2. `globalId` 字典序不稳定

### Bug 3: 重复气泡
**现象**：相同对话气泡重复出现  
**根因分析**：
1. `syncHistoryFromServer()` 在`switchModelHistory`清空history数组后运行，history为空 → 所有服务端消息被当成"新增"追加
2. `renderMsg()` 每次生成新ID，去重键变化
3. WebSocket重连和模型切换竞态

## 已尝试的修改（当前代码状态）

### index.html 改动：
1. **新增 `msgDedupKeys(m)`** — 返回多个候选去重键（globalId, id, timestamp|text）
2. **重写 `syncHistoryFromServer()`** — 去重时同时检查`history`数组和DOM已有元素
3. **修改 `switchModelHistory()`** — 渲染前 `history = localMsgs.slice()` 而非清空
4. **修改 `cmpMsg()`** — 排序优先用timestamp(ISO)而非time(HH:MM)
5. **WebSocket text handler** — 所有chunk都持久化（带chunkGroupId+chunkIndex）
6. **修改 `initHistory()`** — 过滤掉被chunk覆盖的服务端完整消息
7. **新增 `initHistoryDone` 标志** — 防止syncHistoryFromServer在initHistory完成前竞态运行

### index.js 改动：
8. **修改 `nextGlobalId()`** — 从 `EPOCH:SEQ` 改为 `timestamp(36进制)-random(6hex)-seq`

### 新增测试：
9. `test/verify-chat-fix.js` — Playwright自动化测试（基本加载、模型切换去重、chunk持久化）

## 引入的新Bug

**用户消息出现两遍**：修改后 `syncHistoryFromServer` 运行更频繁，用户消息在客户端的渲染ID和服务端的存储ID格式不同去重失败。

## 当前部署状态

- GitHub: git@github.com:xiaoyou5602/yyy.git
- VPS: 103.85.25.226:25790, /opt/withtoge/, systemctl restart cyberboss
- 本地: npm run safe (guardian自动管理)
