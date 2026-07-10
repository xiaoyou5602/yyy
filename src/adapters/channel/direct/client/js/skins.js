/* ═══ Skin Registry — 聊天渲染皮肤系统（阶段2）═══ */
// 一个皮肤 = 「消息数据 → DOM 节点」的一组纯函数。引擎（index.html 内联）负责
// 往哪个 zone 插、滚动跟随、history 读写、data-msg-id 分配；皮肤只画 DOM。
//
// 铁律：皮肤绝不碰 ws、绝不碰 localStorage、绝不自己发请求。
//
// ── 皮肤接口 ──
//   renderMessage(msg)                  单条消息 → .msg 根节点（含 thinking 静态块）
//                                       （chunks 拆分是引擎策略，皮肤永远只收单条）
//   renderSticker(msg)                  贴纸消息 → .msg 根节点
//   buildThinking(turnId, {phase,text}) 流式思考块 → .thinking-inline 节点
//   createStreamContainer(turnId, data) 流式占位消息容器 → .msg 根节点
//   ensureBubble(msgEl, text)           在流式容器里补气泡，成功返回 true
//
// ── DOM 契约（引擎查询依赖，皮肤必须提供这些锚点）──
//   .msg / .msg.ke / .msg.you        消息根（选择模式、收藏、指纹提取都查它）
//   .msg-bubble                      气泡文本容器（流式复用判断、thinking 指纹）
//   .msg-inner                       ke 消息内层（thinking 块插入锚点）
//   .thinking-inline[data-turn-id]   思考块根（label 更新、tool 态切换按它查）
//   .thinking-inline-label / -body / -arrow / .thinking-dot   思考块内部件
//   .time                            时间戳
// 换结构的皮肤必须保住这些 class 锚点，否则流式更新/搜索/收藏会失明。

(function() {
  window._skins = {};
  window.registerSkin = function(name, impl) { window._skins[name] = impl; };

  /* ── default 皮肤私有工具（与引擎的同名函数保持一致，勿单边改动）── */
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

  var HEART_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>';

  /* ── default 皮肤：现有暖瓷渲染原样搬入（阶段2，界面零变化）── */
  window.registerSkin("default", {

    renderMessage: function(msg) {
      // 已完成的 COT 条目：静态可折叠思考块，不是气泡
      if (msg.from === "thinking") {
        var tdiv = document.createElement("div");
        tdiv.className = "msg ke";
        var inline = document.createElement("div");
        inline.className = "thinking-inline";
        if (msg.turnId) inline.dataset.turnId = msg.turnId;
        inline.innerHTML = '<div class="thinking-row">'
          + '<div class="thinking-avatar">' + HEART_SVG + '</div>'
          + '<div class="thinking-inline-header"><span class="thinking-inline-arrow">▼</span> <span class="thinking-inline-label">已思考完毕</span></div>'
          + '</div>';
        var tbody = document.createElement("div");
        tbody.className = "thinking-inline-body";
        tbody.textContent = msg.text || "";
        inline.appendChild(tbody);
        tdiv.appendChild(inline);
        return tdiv;
      }
      var div = document.createElement("div");
      div.className = "msg " + (msg.from === "you" ? "you" : "ke");
      if (msg.from === "ke") {
        var html = '<div class="msg-inner">'
          + '<div class="avatar-sm"><img src="/icon.png" alt="克"></div>'
          + '<div class="msg-bubble">' + esc(msg.text);
        if (msg.images && msg.images.length > 0) html += renderImageTags(msg.images);
        html += '<div class="time">' + (msg.time || now()) + '</div></div></div>';
        div.innerHTML = html;
      } else {
        var html2 = esc(msg.text);
        if (msg.images && msg.images.length > 0) html2 += renderImageTags(msg.images);
        html2 += '<div class="time">' + (msg.time || now()) + '</div>';
        div.innerHTML = html2;
      }
      return div;
    },

    renderSticker: function(msg) {
      var div = document.createElement("div");
      div.className = "msg " + (msg.from === "you" ? "you" : "ke");
      var src = "/api/stickers/" + escAttr(msg.stickerId) + ".gif";
      var desc = escAttr(msg.desc || "");
      if (msg.from === "ke") {
        div.innerHTML = '<div class="msg-inner"><div class="avatar-sm"><img src="/icon.png" alt="克"></div><div class="msg-bubble sticker-bubble"><img src="' + src + '" alt="' + desc + '" class="sticker-gif"><div class="time">' + (msg.time || now()) + '</div></div></div>';
      } else {
        div.innerHTML = '<img src="' + src + '" alt="' + desc + '" class="sticker-gif"><div class="time">' + (msg.time || now()) + '</div>';
      }
      return div;
    },

    buildThinking: function(turnId, data) {
      var inline = document.createElement("div");
      inline.className = "thinking-inline";
      inline.dataset.turnId = turnId;
      if (data.phase === "tooling") inline.classList.add("thinking-tool-active");

      var row = document.createElement("div");
      row.className = "thinking-row";

      var avatar = document.createElement("div");
      avatar.className = "thinking-avatar";
      avatar.innerHTML = HEART_SVG;

      var header = document.createElement("div");
      header.className = "thinking-inline-header";
      var isFinal = (data.phase === "final");
      var labelText = data.phase === "tooling" ? "正在调用工具..." : (isFinal ? "已思考完毕" : "思考中...");
      header.innerHTML = '<span class="thinking-inline-arrow"' + (isFinal ? '' : ' style="display:none"') + '>▼</span> <span class="thinking-inline-label">' + labelText + '</span>' + (isFinal ? '' : ' <span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span>');

      row.appendChild(avatar);
      row.appendChild(header);
      inline.appendChild(row);

      var body = document.createElement("div");
      body.className = "thinking-inline-body";
      body.textContent = data.text || "";
      inline.appendChild(body);
      return inline;
    },

    createStreamContainer: function(turnId, data) {
      var div = document.createElement("div");
      div.className = "msg ke";
      var inline = data ? this.buildThinking(turnId, data) : null;
      var inner = document.createElement("div");
      inner.className = "msg-inner";
      div.appendChild(inner);
      if (inline) div.insertBefore(inline, inner);
      return div;
    },

    ensureBubble: function(msgEl, text) {
      var inner = msgEl.querySelector(".msg-inner");
      if (!inner) return false;
      var bubble = document.createElement("div");
      bubble.className = "msg-bubble";
      bubble.innerHTML = esc(text) + '<div class="time">' + now() + '</div>';
      inner.appendChild(bubble);
      return true;
    }
  });
})();
