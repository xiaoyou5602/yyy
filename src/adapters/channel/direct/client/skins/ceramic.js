/* ═══ Ceramic 皮肤 — 暖瓷页渲染的回收（阶段4）═══ */
// 从 chat-ds.js 的私有渲染回收成标准皮肤。与 default 的真实差异只有消息组结构：
// 时间戳挂在气泡外下方（暖瓷辨识度细节），其余（thinking 块、流式容器、补气泡）
// 直接继承 default——两边样式 06/29 就统一成同一套 Gemini 暖瓷设计了。
// 观感差异（细滚条、thinking 限高）在 ceramic.css，选择器全走 .skin-ceramic 前缀。
//
// 铁律照旧：只拿数据画 DOM，不碰 ws / localStorage / 请求。
// DOM 契约锚点（.msg/.msg-bubble/.msg-inner/.thinking-*/.time）全部保留。

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

  var base = window._skins && window._skins["default"];
  if (!base) return;

  window.registerSkin("ceramic", Object.assign({}, base, {

    renderMessage: function(msg) {
      // thinking 静态块与 default 完全同构，直接走基类
      if (msg.from === "thinking") return base.renderMessage(msg);

      var div = document.createElement("div");
      div.className = "msg " + (msg.from === "you" ? "you" : "ke");
      var time = '<span class="time">' + (msg.time || now()) + "</span>";
      if (msg.from === "ke") {
        var html = '<div class="msg-inner">'
          + '<div class="avatar-sm"><img src="/icon.png" alt="克"></div>'
          + '<div class="msg-bubble">' + esc(msg.text);
        if (msg.images && msg.images.length > 0) html += renderImageTags(msg.images);
        html += "</div></div>" + time;   // 时间在气泡外——暖瓷特征
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
      var bubble = '<div class="msg-bubble sticker-bubble"><img src="' + src + '" alt="' + desc + '" class="sticker-gif"></div>';
      if (msg.from === "ke") {
        div.innerHTML = '<div class="msg-inner"><div class="avatar-sm"><img src="/icon.png" alt="克"></div>' + bubble + "</div>" + time;
      } else {
        div.innerHTML = bubble + time;
      }
      return div;
    }

    // buildThinking / createStreamContainer / ensureBubble 继承 default：
    // 流式容器是 .msg.ke > .msg-inner 结构，ensureBubble 往 inner 里补 .msg-bubble，
    // ceramic.css 按同一契约上妆。
  }));
})();
