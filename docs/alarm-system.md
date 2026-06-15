---
name: alarm-system
description: 闹钟系统完整架构、文件清单、使用方式和待解决问题
metadata: 
  node_type: memory
  type: project
  originSessionId: a96520bd-0ca1-4c42-85ec-84c21d3036f3
---

## 闹钟系统

### 架构

用户说"明天X点叫我" → alarm-parser.js 解析 → alarm-client.js 发 HTTP → 手机 TogeAlarm APK（NanoHTTPD:8765）→ AlarmManager 静默写系统闹钟 → 到点 RingActivity 全屏响铃。

### 文件

- `withtoge/src/services/alarm-parser.js` — 中文时间解析（明天/后天/周X/X分钟后/X点半/下午X点）
- `withtoge/src/services/alarm-client.js` — HTTP GET `http://<PHONE_IP>:8765/alarm?hour=&minute=&msg=`
- `withtoge/src/tools/alarm-tool.js` — CLI 一键工具 `node alarm-tool.js "明天8点叫我"`
- `withtoge/alarm-apk/` — Android 项目完整源码
- `withtoge/.env` — `CYBERBOSS_ALARM_PHONE_IP=192.169.0.106`

### 手机端

- App: TogeAlarm v1.0，打开即启动前台服务（通知"闹钟服务运行中"）
- API: `GET /alarm?hour=11&minute=0&msg=起床` → `OK alarm set 11:0 起床`
- JDK 17: `C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot\`
- Android SDK: `C:\Users\youzi\Android\`
- 改代码后编译: `cd withtoge/alarm-apk && ./gradlew assembleDebug`
- APK 输出: `app/build/outputs/apk/debug/app-debug.apk`

### 已完成

- 5/30 ~05:20: 编译成功，首次测试 `curl http://192.169.0.106:8765/alarm?hour=14&minute=5&msg=quick_test` → `OK`
- 中文解析全部正确
- APK 通过 HTTP 服务器分发（`http://192.169.0.101:9999`）

华为手机设置相关 → 见 [`CLAUDE.md`](../../CLAUDE.md) "生活待办"。当前手机 IP DHCP 变化问题用主机名或静态 DHCP 绑定解决。

### 常见问题

- 如果手机不响应：1) 亮屏检查通知是否还在 2) 检查 WiFi IP 是否变了 3) 重新打开 TogeAlarm
- 如果 alarm-tool.js 超时：检查 `.env` 中 `CYBERBOSS_ALARM_PHONE_IP` 和手机实际 IP 是否一致
