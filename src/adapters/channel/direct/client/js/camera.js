/* global fetch */

let camStream = null;
let guardInterval = null;

async function initCamera() {
  const preview = document.getElementById("cam-preview");
  const startBtn = document.getElementById("cam-start-btn");
  const captureBtn = document.getElementById("cam-capture-btn");
  const guardToggle = document.getElementById("cam-guard-btn");
  const resultEl = document.getElementById("cam-result");

  if (!preview) return;

  startBtn.onclick = async () => {
    if (camStream) {
      camStream.getTracks().forEach(t => t.stop());
      camStream = null;
      preview.srcObject = null;
      startBtn.textContent = "打开摄像头";
      captureBtn.disabled = true;
      stopGuard();
      return;
    }
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      preview.srcObject = camStream;
      startBtn.textContent = "关闭摄像头";
      captureBtn.disabled = false;
    } catch (err) {
      resultEl.innerHTML = `<span style="color:#e53e3e;">无法访问摄像头: ${err.message}</span>`;
    }
  };

  captureBtn.onclick = () => captureAndAnalyze();

  guardToggle.onclick = () => {
    if (guardInterval) { stopGuard(); guardToggle.textContent = "哨兵模式"; }
    else { startGuard(); guardToggle.textContent = "停止哨兵"; }
  };

  // Cleanup on page leave
  const origShowPage = window._origShowPage;
  window._origShowPage = null;
}

function captureFrame() {
  const video = document.getElementById("cam-preview");
  if (!video || !video.srcObject) return null;
  const canvas = document.getElementById("cam-canvas");
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  canvas.getContext("2d").drawImage(video, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
}

async function captureAndAnalyze() {
  const resultEl = document.getElementById("cam-result");
  const base64 = captureFrame();
  if (!base64) {
    resultEl.innerHTML = "<span style='color:#e53e3e;'>请先打开摄像头</span>";
    return;
  }
  resultEl.innerHTML = "<span>分析中...</span>";
  try {
    const res = await fetch("/api/camera/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64 }),
    });
    const data = await res.json();
    if (data.error) {
      resultEl.innerHTML = `<span style="color:#e53e3e;">${data.error}</span>`;
    } else {
      resultEl.innerHTML = `<div class="cam-result-text">${escHtml(data.description || "无描述")}</div>
        <div class="cam-result-time">${new Date().toLocaleTimeString("zh-CN")}</div>`;
    }
  } catch (err) {
    resultEl.innerHTML = `<span style="color:#e53e3e;">分析失败: ${err.message}</span>`;
  }
}

function startGuard() {
  if (guardInterval) return;
  guardInterval = setInterval(() => { captureAndAnalyze(); }, 30_000);
}

function stopGuard() {
  if (guardInterval) { clearInterval(guardInterval); guardInterval = null; }
}

function escHtml(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
