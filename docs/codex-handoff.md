# CyberBoss 项目交接文档

## 当前状态

系统能启动，9726 端口 HTTP 200，但网页端 WebSocket 显示"连接中"无法连接。微信端正常通信。

## 想要完成的目标

1. **网页端实时消息显示**：消息不实时推送，强制刷新后才出现
2. **日历组件化**：代码已写好（components/calendar/ + component-registry.js），无法验证
3. **视觉调参台升级**：CSS 变量化 + Design Tokens，部分代码已写好

## 完整的排查过程（含弯路）

### 第一天（6/1 晚 ~ 6/2 凌晨）

22:00 系统正常运行。之后做了以下改动，问题开始出现：

**1. 日历组件化**
- 从 index.html 删掉日历 HTML → 空 div
- 加了 component-registry.js + calendar.js + calendar.css
- 忘记删 `cal-back-btn` 的 addEventListener → JS 报错 → WebSocket 代码在后面没执行 → 页面"连接中"
- 修复：删掉 cal-back-btn 事件绑定 → WebSocket 恢复连接
- **教训**：删除 DOM 元素时检查事件绑定

**2. 进程管理改动（全在服务端）**
- `shell: false → true`：spawn `.cmd` 必须走 `shell: true`，Git 原版是 `shell: false`
- `cleanupOrphanedChildPids()`：启动时清僵尸进程。**后来发现是多实例互杀的元凶**
- `uncaughtException → process.exit(1)`：导致 guardian 无限重启风暴
- `ensureClient` alive 检查：claude 死后自动重 spawn
- EADDRINUSE try/catch：端口冲突时跳过而非崩溃。**制造了僵尸实例**
- ipc-server error handler：EACCES 不再崩进程
- ws-server promise reject：EADDRINUSE 不再绕过 try/catch

**3. 守护进程风暴**
- 症状：node 进程数从正常 15 暴涨到 49
- 根因：`uncaughtException → exit(1)` → guardian 3 秒重启 → `cleanupOrphaned` 杀旧实例的 claude → 新实例的 claude 也被杀 → 循环
- 修复：删除 uncaughtException handler + 删除 cleanupOrphaned

**4. 误杀 IDE 端 Claude**
- 用了 `taskkill //F //IM node.exe` → 杀了所有 node 进程包括 IDE
- 教训已写入 CLAUDE.md

**5. Claude 反复死亡**
- 症状：spawn 成功 → 立即退出，日志 "SessionEnd hook failed"
- 根因A：Git 原版 `acceptReportedSessionId` 发现 session 不匹配时调用 `rejectUnexpectedSessionId → close()` 直接杀 claude
- 根因B：`attachClientToThread` 传了旧 `--resume sessionId`，claude 找不到 → 新 session → 但流程已经乱了
- 修复A：改为接受新 session 继续运行（`session replaced` 日志）
- 修复B：不再传旧 sessionId 给新 spawn 的 claude

**6. EADDRINUSE 僵尸实例**
- 症状：端口被占时 try/catch 让进程继续跑但不带 web server → 浏览器连到无 claude 的僵尸 → 永远"连接中"
- 修复：移除 channel server 的 EADDRINUSE try/catch → 端口冲突时直接崩 → guardian 干净重启

**7. 端口风暴（未彻底解决）**
- 症状：崩溃 → guardian 3 秒后重启 → 旧进程的 9726 还没释放 → 新实例 EADDRINUSE → 崩 → 循环
- 3 秒太短，TCP 端口释放可能需要更长时间（尤其 Windows 上）
- `kill-bridge.ps1` 只杀命令行含 `cyberboss` 的进程，孤儿 cmd.exe/claude.exe 漏网
- 偶尔出现 30-49 个 node 进程同时存在
- 尝试过：`cleanupOrphanedChildPids`（多实例互杀，已删）、longer wait（手工等 15 秒能解决）

**8. 孤儿窗口（未彻底解决）**
- `shell: true` spawn `claude.cmd` → Windows 上进程树为 `node → cmd.exe → claude.exe`
- 父进程（node）崩溃/被杀时，cmd.exe 和 claude.exe 不跟着死
- 这些孤儿继续占用端口或资源，下次启动时冲突
- `process-client.js` 的 `close()` 方法（line 347-364）在正常关闭时用 `taskkill /F /T /PID` 杀进程树，但**崩溃路径不经过 close()**
- 尝试过：`resolveCmdToExe()` 直调 `.exe` 砍掉 cmd.exe 中间层（`shell: false`），但 spawn `.cmd` 必须 `shell: true`，回退了

### 已确认的修复（5 个文件，已验证有效）

| 文件 | 修复内容 |
|------|---------|
| `process-client.js:236-240` | session 不匹配时接受新 session，不再杀 claude |
| `process-client.js:70` | `shell: true`（spawn .cmd 必须） |
| `index.js:45` | `ensureClient` 检查 `existing.alive`，死 claude 自动重 spawn |
| `ipc-server.js:63` | `server.on("error")` 防 EACCES 崩进程 |
| `ws-server.js:217` | `start()` promise 加 `server.once("error", reject)` |

### 已确认有害并删除的改动

| 改动 | 原因 |
|------|------|
| `cleanupOrphanedChildPids` | 多实例下互杀端口占用者 |
| `uncaughtException → exit(1)` | 触发 guardian 重启风暴 |
| `channel server EADDRINUSE try/catch` | 制造无 web server 的僵尸实例 |
| `resolveCmdToExe + shell:false` | 收益不抵风险，等价于 shell:true |

## 已解决的问题（2026-06-09 更新）

1. ~~**网页端"连接中"**~~：已解决。通过 Cloudflare Named Tunnel ingress 规则替代 `--url` 参数，WebSocket 双向通信正常。

2. ~~**端口风暴**~~：已解决。guardian 重启用退避递增，不再短时间循环。

3. ~~**孤儿进程**~~：已解决。`shell:false` + `resolveCmdToExe` + PID 追踪。

## 关键文件路径

```
src/core/app.js                      ← 主应用逻辑
src/adapters/runtime/claudecode/
  ├── process-client.js               ← Claude 进程管理
  ├── index.js                        ← Claude 运行时适配器
  └── ipc-server.js                   ← IPC 通信
src/adapters/channel/
  ├── dual/index.js                   ← 双通道（微信+网页）
  └── direct/
      ├── index.js                    ← 网页端适配器
      └── ws-server.js                ← WebSocket 服务
src/adapters/channel/direct/client/
  ├── index.html                      ← 网页前端
  ├── css/main.css
  └── js/tweak.js
```

## 备份

`docs/backup-20260601/` — 292KB，全部改动代码
`docs/2026-06-02-review.md` — 改动审查清单

## 启动方式

```bash
cd C:/Users/youzi/withtoge
npm run safe          # 守护模式启动
powershell -ExecutionPolicy Bypass -File kill-bridge.ps1  # 停止
```

网页端：http://127.0.0.1:9726
