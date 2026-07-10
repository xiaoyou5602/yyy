/* ═══ ChatNest 皮肤 — 仿 Claude 官方 APP（来源：github ugui3u/chatnest）═══ */
// toge 挑的开源前端，只取聊天页面视觉。官端特征：
//   · 用户消息 = serif 字体气泡（22px 圆角，右对齐）
//   · Claude 消息 = 无气泡，serif 排版直接落在纸面上
//   · thinking = 时钟图标 + 灰色单行摘要 + chevron 展开（trace-row）
//   · 消息下方操作排（复制）；时间戳不显示（数据仍在 DOM，CSS 隐藏）
// DOM 契约锚点全部保留（.msg/.msg-bubble/.msg-inner/.thinking-*/.time）。
// 铁律照旧：只拿数据画 DOM。复制按钮走引擎的 .msg-action-copy 通用委托。

(function() {
  function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML.replace(/\n/g, "<br>"); }
  function escAttr(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
  function now() { return new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }); }
  function renderImageTags(images) {
    if (!images || !images.length) return "";
    var cls = images.length === 1 ? "single" : "";
    return '<div class="img-wrap">' + images.map(function(img) {
      var src = img.thumb || (img.path ? "/api/media/" + img.path : "") || (img.data ? "data:" + (img.contentType || "image/png") + ";base64," + img.data : "");
      return src ? '<img src="' + src + '" class="' + cls + '" alt="图片" loading="lazy">' : "";
    }).join("") + "</div>";
  }

  var CLOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15 14"></polyline></svg>';
  var COPY_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>';

  var ACTIONS_HTML = '<div class="message-actions"><button class="action-button msg-action-copy" title="复制">' + COPY_SVG + '</button></div>';

  var base = window._skins && window._skins["default"];
  if (!base) return;

  // trace-row 风格思考块：时钟 + 摘要行 + chevron；契约 class 全保留
  function buildTrace(turnId, phase, text) {
    var inline = document.createElement("div");
    inline.className = "thinking-inline cn-trace";
    if (turnId) inline.dataset.turnId = turnId;
    if (phase === "tooling") inline.classList.add("thinking-tool-active");

    var row = document.createElement("div");
    row.className = "thinking-row cn-trace-summary";

    var avatar = document.createElement("div");
    avatar.className = "thinking-avatar cn-trace-clock";
    avatar.innerHTML = CLOCK_SVG;

    var header = document.createElement("div");
    header.className = "thinking-inline-header";
    var isFinal = (phase === "final" || phase === undefined);
    var labelText = phase === "tooling" ? "正在调用工具..." : (isFinal ? "已思考完毕" : "思考中...");
    header.innerHTML = '<span class="thinking-inline-label">' + labelText + '</span>'
      + (isFinal ? '' : ' <span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span>')
      + '<span class="thinking-inline-arrow"' + (isFinal ? '' : ' style="display:none"') + '>▼</span>';

    row.appendChild(avatar);
    row.appendChild(header);
    inline.appendChild(row);

    var body = document.createElement("div");
    body.className = "thinking-inline-body";
    body.textContent = text || "";
    inline.appendChild(body);
    return inline;
  }

  window.registerSkin("chatnest", Object.assign({}, base, {

    renderMessage: function(msg) {
      // 历史 COT：静态 trace 行（默认折叠靠 CSS）
      if (msg.from === "thinking") {
        var tdiv = document.createElement("div");
        tdiv.className = "msg ke";
        tdiv.appendChild(buildTrace(msg.turnId || "", "final", msg.text || ""));
        return tdiv;
      }
      var div = document.createElement("div");
      div.className = "msg " + (msg.from === "you" ? "you" : "ke");
      var time = '<span class="time">' + (msg.time || now()) + "</span>";
      if (msg.from === "ke") {
        // 官端：Claude 无气泡直接排版；正文尾部挂操作排
        var html = '<div class="msg-inner">'
          + '<div class="avatar-sm"><img src="/icon.png" alt="克"></div>'
          + '<div class="msg-bubble">' + esc(msg.text);
        if (msg.images && msg.images.length > 0) html += renderImageTags(msg.images);
        html += "</div></div>" + ACTIONS_HTML + time;
        div.innerHTML = html;
      } else {
        var html2 = '<div class="msg-bubble">' + esc(msg.text);
        if (msg.images && msg.images.length > 0) html2 += renderImageTags(msg.images);
        html2 += "</div>" + time;
        div.innerHTML = html2;
      }
      return div;
    },

    renderSticker: function(msg) {
      var div = document.createElement("div");
      div.className = "msg " + (msg.from === "you" ? "you" : "ke");
      var src = "/api/stickers/" + escAttr(msg.stickerId) + ".gif";
      var desc = escAttr(msg.desc || "");
      var time = '<span class="time">' + (msg.time || now()) + "</span>";
      var img = '<img src="' + src + '" alt="' + desc + '" class="sticker-gif">';
      if (msg.from === "ke") {
        div.innerHTML = '<div class="msg-inner"><div class="avatar-sm"><img src="/icon.png" alt="克"></div><div class="msg-bubble sticker-bubble">' + img + "</div></div>" + time;
      } else {
        div.innerHTML = '<div class="msg-bubble sticker-bubble">' + img + "</div>" + time;
      }
      return div;
    },

    buildThinking: function(turnId, data) {
      return buildTrace(turnId, data.phase, data.text);
    }

    // createStreamContainer / ensureBubble 继承 default（结构同契约，
    // ensureBubble 补出的 .msg-bubble 由 chatnest.css 画成无气泡排版）。
  }));
})();
