# 嵌入新页面（标准流程）

> 把 Gemini / 其他工具生成的独立 HTML 接入 App。案例：小手机主页、DS 聊天页。

## 文件拆法

每个页面拆独立文件，和其他页面一致：

```
js/xxx.js        ← 页面逻辑（IIFE，暴露 window.xxxInit / window.xxxDestroy）
css/xxx.css      ← 页面样式（量少可放 main.css 但加注释分隔）
```

HTML 放 `index.html` 的 `<body>` 内，和 `#chat-page` / `#memory-page` **平级**（不是嵌套）。

## CSS 7 条

1. **变量加前缀**：Gemini 的 `--bg` → `--ph-bg`，定义在 `#xxx-page {}` 上，不用 `:root`
2. **别用 `* { margin:0; padding:0 }`**——会炸 App 样式。最多留 `box-sizing: border-box`
3. **`position:fixed` 用 `top/right/bottom/left:0`**，不用 `inset`（Android WebView 兼容）
4. **SVG 属性不用 `var()`**——`stroke="var(--x)"` 无效，改 `style="stroke:var(--x)"`
5. **桌面端加 `max-width`**（Gemini 按 412px 设计），否则全屏拉伸
6. **Flex 子元素加 `min-height:0`**，否则 `overflow:auto` 部分 WebView 失效
7. **改完 run 括号平衡检查**——`node -e "..."` 一秒钟，Edit 工具常吞 `}`

## JS 接入

```js
// IIFE 暴露 API
;(function () {
  window.xxxInit = function () {
    /* 渲染 */
  }
  window.xxxDestroy = function () {
    /* 清理 */
  }
})()
```

`showPage()` 里加 case。需要动画：CSS `@keyframes` + `setTimeout` 清理 class，**保存 timeout ID + clearTimeout 防竞态**。

入口：侧边栏或更多面板 → `showPage('xxx')`。
调参台：`page-tokens.js` 加 scope + `tweak.js` `suggestScope()` 加映射。

## 调试

- **前端改动不重启**，刷新即可。手机缓存清不掉就 bump CSS/JS 版本号 `?v=N`
- **Console 逐行日志**：`phInit` 每一步加 `console.log('①')`，一秒定位崩溃