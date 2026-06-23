/* global fetch, showPage, headerTitle */

let _wbLoaded = false;
window._wbDirty = false;
window._wbModel = "";

function initWorldbook() {
  if (_wbLoaded) {
    loadWorldbookData();
    return;
  }
  _wbLoaded = true;

  // Track dirty state on any input change
  const fields = ["wb-ai-name", "wb-ai-personality", "wb-ai-speaking", "wb-ai-background",
                  "wb-user-name", "wb-user-description", "wb-user-preferences", "wb-rules"];
  for (const id of fields) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", () => { window._wbDirty = true; });
  }

  document.getElementById("wb-save").addEventListener("click", saveWorldbook);
  document.getElementById("wb-cancel").addEventListener("click", () => {
    showPage("chat");
  });

  loadWorldbookData();
}

async function loadWorldbookData() {
  try {
    const model = (typeof settings !== "undefined" && settings.model) ? settings.model : "";
    window._wbModel = model;
    const url = model ? `/api/worldbook?model=${encodeURIComponent(model)}` : "/api/worldbook";
    const res = await fetch(url);
    const data = await res.json();
    window._wbDirty = false;
    document.getElementById("wb-ai-name").value = data.ai?.name || "";
    document.getElementById("wb-ai-personality").value = data.ai?.personality || "";
    document.getElementById("wb-ai-speaking").value = data.ai?.speaking_style || "";
    document.getElementById("wb-ai-background").value = data.ai?.background || "";
    document.getElementById("wb-user-name").value = data.user?.name || "";
    document.getElementById("wb-user-description").value = data.user?.description || "";
    document.getElementById("wb-user-preferences").value = data.user?.preferences || "";
    const rules = Array.isArray(data.rules) ? data.rules.join("\n") : "";
    document.getElementById("wb-rules").value = rules;
  } catch (err) {
    console.error("[worldbook] load error:", err);
  }
}

async function saveWorldbook() {
  const data = {
    ai: {
      name: document.getElementById("wb-ai-name").value.trim(),
      personality: document.getElementById("wb-ai-personality").value.trim(),
      speaking_style: document.getElementById("wb-ai-speaking").value.trim(),
      background: document.getElementById("wb-ai-background").value.trim(),
    },
    user: {
      name: document.getElementById("wb-user-name").value.trim(),
      description: document.getElementById("wb-user-description").value.trim(),
      preferences: document.getElementById("wb-user-preferences").value.trim(),
    },
    rules: document.getElementById("wb-rules").value
      .split("\n")
      .map(s => s.trim())
      .filter(s => s.length > 0),
  };

  try {
    const model = (typeof settings !== "undefined" && settings.model) ? settings.model : "";
    const url = model ? `/api/worldbook?model=${encodeURIComponent(model)}` : "/api/worldbook";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      window._wbDirty = false;
      showToast("世界书已保存");
      const aiName = data.ai.name || "克";
      headerTitle.textContent = aiName;
      document.title = aiName;
      showPage("chat");
    } else {
      const err = await res.json();
      showToast("保存失败: " + (err.error || "未知错误"));
    }
  } catch (err) {
    showToast("保存失败: " + err.message);
  }
}

function showToast(msg) {
  let toast = document.getElementById("wb-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "wb-toast";
    toast.style.cssText = `
      position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
      background:#333;color:#fff;padding:10px 20px;border-radius:8px;
      font-size:14px;z-index:9999;transition:opacity 0.3s;
      font-family:var(--font-body, system-ui);
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = "1";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.opacity = "0"; }, 2000);
}
