/* global fetch, showPage */

async function initMcpPlayroom() {
  loadMcpServers();
}

async function loadMcpServers() {
  try {
    const res = await fetch("/api/mcp/servers");
    const data = await res.json();
    const list = document.getElementById("mcp-server-list");
    if (!Array.isArray(data.servers) || !data.servers.length) {
      list.innerHTML = '<div class="empty-state">还没有 MCP 服务器<br>点击下方按钮添加</div>';
      return;
    }
    list.innerHTML = data.servers.map(s => `
      <div class="mcp-server-card">
        <div class="mcp-server-info">
          <div class="mcp-server-name">${escHtml(s.name)}</div>
          <div class="mcp-server-url">${escHtml(s.command || s.url || "")}</div>
        </div>
        <div class="mcp-server-status ${s.enabled ? 'online' : 'offline'}">
          ${s.enabled ? '已启用' : '已禁用'}
        </div>
        <button class="mcp-server-del" onclick="deleteMcpServer('${escHtml(s.name)}')" title="删除">&times;</button>
      </div>
    `).join("");

    // Also update action log if any
  } catch (err) {
    console.error("[mcp] load error:", err);
  }
}

async function addMcpServer() {
  const name = document.getElementById("mcp-add-name").value.trim();
  const command = document.getElementById("mcp-add-command").value.trim();
  if (!name || !command) {
    showMcpToast("请填写名称和命令");
    return;
  }
  try {
    const res = await fetch("/api/mcp/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, command }),
    });
    if (res.ok) {
      document.getElementById("mcp-add-name").value = "";
      document.getElementById("mcp-add-command").value = "";
      addMcpLog({ server: name, tool: "config", status: "added", detail: "服务器已添加" });
      loadMcpServers();
    } else {
      const err = await res.json();
      showMcpToast("添加失败: " + (err.error || ""));
    }
  } catch (err) {
    showMcpToast("添加失败: " + err.message);
  }
}

async function deleteMcpServer(name) {
  if (!confirm(`确定删除 "${name}"？`)) return;
  try {
    await fetch(`/api/mcp/servers/${encodeURIComponent(name)}`, { method: "DELETE" });
    addMcpLog({ server: name, tool: "config", status: "removed", detail: "服务器已删除" });
    loadMcpServers();
  } catch (err) {
    showMcpToast("删除失败: " + err.message);
  }
}

function addMcpLog(entry) {
  const log = document.getElementById("mcp-action-log");
  if (!log) return;
  const item = document.createElement("div");
  item.className = "mcp-log-item";
  const time = new Date().toLocaleTimeString("zh-CN");
  item.innerHTML = `<span class="mcp-log-time">${time}</span>
    <span class="mcp-log-status ${entry.status}">${entry.status}</span>
    <span class="mcp-log-server">${escHtml(entry.server)}</span>
    <span class="mcp-log-detail">${escHtml(entry.detail || entry.tool || "")}</span>`;
  log.prepend(item);
  // Keep max 50 entries
  while (log.children.length > 50) log.lastChild.remove();
}

function showMcpToast(msg) {
  let toast = document.getElementById("mcp-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "mcp-toast";
    toast.style.cssText = "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;z-index:9999;transition:opacity 0.3s;font-family:var(--font-body,system-ui);";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = "1";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.opacity = "0"; }, 2000);
}

function escHtml(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// MCP → calendar right-swipe gesture
(function() {
  var swipeStartX = 0;
  var swiping = false;
  var threshold = 60;
  var page = document.getElementById("mcp-page");
  if (!page) return;

  page.addEventListener("touchstart", function(e) {
    swipeStartX = e.touches[0].clientX;
    swiping = true;
  }, { passive: true });

  page.addEventListener("touchmove", function(e) {
    if (!swiping) return;
    var dx = swipeStartX - e.touches[0].clientX;
    if (dx < -threshold) {
      swiping = false;
      if (typeof showPage === "function") showPage("calendar");
    }
  }, { passive: true });

  page.addEventListener("touchend", function() {
    swiping = false;
  });
})();
