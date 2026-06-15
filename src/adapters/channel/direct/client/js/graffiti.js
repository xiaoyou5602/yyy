/* ── Graffiti Engine ── */
const GRAF_COLORS = [
  "#ff0000","#0000ff","#ffff00","#00ff00","#ff6600",
  "#9900ff","#00ffff","#ff00ff","#000000","#ffffff"
];
let grafColor = GRAF_COLORS[0];
let grafCanvas, grafCtx, grafDrawing = false, grafLast = null;
let grafPoints = [], grafDrips = [];
let grafSize = 14, grafDensity = 22;

function initGraffiti() {
  grafCanvas = document.getElementById("graf-canvas");
  if (!grafCanvas) return;
  grafCtx = grafCanvas.getContext("2d");
  resizeGrafCanvas();
  grafPoints = []; grafDrips = []; grafDrawing = false; grafLast = null;
  renderGraffiti();

  if (!grafCanvas._listenersAdded) {
    grafCanvas._listenersAdded = true;
    grafCanvas.addEventListener("mousedown", onGrafDown);
    grafCanvas.addEventListener("mouseup", onGrafUp);
    grafCanvas.addEventListener("mousemove", onGrafMove);
    grafCanvas.addEventListener("mouseleave", onGrafUp);
    grafCanvas.addEventListener("touchstart", onGrafTouchStart, { passive: false });
    grafCanvas.addEventListener("touchend", onGrafTouchEnd, { passive: false });
    grafCanvas.addEventListener("touchmove", onGrafTouchMove, { passive: false });
    grafCanvas.addEventListener("touchcancel", onGrafTouchEnd, { passive: false });
    window.addEventListener("resize", onGrafResize);
  }
}

function onGrafResize() { resizeGrafCanvas(); renderGraffiti(); }

function resizeGrafCanvas() {
  if (!grafCanvas) return;
  grafCanvas.width = window.innerWidth;
  grafCanvas.height = window.innerHeight;
}

const grafColorsEl = document.getElementById("graf-colors");
GRAF_COLORS.forEach(c => {
  const dot = document.createElement("div");
  dot.className = "graf-color" + (c === grafColor ? " active" : "");
  dot.style.background = c;
  if (c === "#ffffff") dot.style.border = "2.5px solid rgba(255,255,255,0.25)";
  dot.addEventListener("click", () => {
    grafColor = c;
    grafColorsEl.querySelectorAll(".graf-color").forEach(d => d.classList.remove("active"));
    dot.classList.add("active");
  });
  grafColorsEl.appendChild(dot);
});

document.getElementById("graf-size").addEventListener("input", (e) => { grafSize = +e.target.value; });
document.getElementById("graf-density").addEventListener("input", (e) => { grafDensity = +e.target.value; });
document.getElementById("graf-clear").addEventListener("click", () => {
  grafPoints = []; grafDrips = [];
  grafCtx.clearRect(0, 0, grafCanvas.width, grafCanvas.height);
});

function pos(e) { return { x: e.clientX, y: e.clientY }; }
function tpos(e) { const t = e.touches[0]; return { x: t.clientX, y: t.clientY }; }

function onGrafDown(e) { grafDrawing = true; grafLast = pos(e); addSpray(pos(e).x, pos(e).y); }
function onGrafUp() { grafDrawing = false; grafLast = null; }
function onGrafMove(e) { if (!grafDrawing || !grafLast) return; const p = pos(e); drawLine(grafLast, p); grafLast = p; }
function onGrafTouchStart(e) { e.preventDefault(); if (e.touches.length > 0) { grafDrawing = true; grafLast = tpos(e); addSpray(grafLast.x, grafLast.y); } }
function onGrafTouchEnd(e) { e.preventDefault(); grafDrawing = false; grafLast = null; }
function onGrafTouchMove(e) { e.preventDefault(); if (!grafDrawing || !grafLast || e.touches.length === 0) return; const p = tpos(e); drawLine(grafLast, p); grafLast = p; }

function drawLine(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dist = Math.sqrt(dx*dx + dy*dy);
  if (dist < 5) { addSpray(b.x, b.y); return; }
  const steps = Math.floor(dist / 2);
  for (let i = 0; i < steps; i++) {
    const r = i / steps;
    addSpray(a.x + dx * r, a.y + dy * r);
  }
  if (Math.random() < 0.02) addDrip(b.x, b.y);
}

function addSpray(x, y) {
  const pts = [];
  for (let i = 0; i < grafDensity; i++) {
    const u = Math.random(), v = Math.random();
    const radius = (grafSize * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)) / 3;
    const angle = Math.random() * Math.PI * 2;
    const px = x + Math.cos(angle) * radius, py = y + Math.sin(angle) * radius;
    const d = Math.sqrt((px - x)*(px - x) + (py - y)*(py - y));
    const sr = 1 - Math.min(1, d / grafSize);
    const size = 0.3 + sr * sr * 2.2;
    const opacity = Math.max(0.7, 0.85 - d / (grafSize * 2));
    pts.push({ x: px, y: py, color: grafColor, size, opacity });
  }
  grafPoints.push(...pts);
  requestAnimationFrame(renderGraffiti);
}

function addDrip(x, y) {
  grafDrips.push({ x, y, color: grafColor, length: Math.random() * 100 + 20, width: Math.random() * 5 + 2, speed: Math.random() * 0.5 + 0.1, currentY: y });
}

function renderGraffiti() {
  if (!grafCtx || !grafCanvas) return;
  grafCtx.clearRect(0, 0, grafCanvas.width, grafCanvas.height);
  for (const p of grafPoints) drawSprayPoint(grafCtx, p);
  for (const d of grafDrips) drawDrip(grafCtx, d);
}

function drawSprayPoint(ctx, p) {
  const hex = p.color;
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  ctx.fillStyle = `rgba(${r},${g},${b},${p.opacity})`;
  ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); ctx.fill();
}

function drawDrip(ctx, d) {
  const len = Math.min(d.currentY - d.y, d.length);
  const bottomY = d.y + len;
  ctx.fillStyle = d.color;
  ctx.beginPath(); ctx.arc(d.x, bottomY, d.width/2, 0, Math.PI*2); ctx.fill();
  ctx.fillRect(d.x - d.width/2, d.y, d.width, len);
}

// Drip animation loop
setInterval(() => {
  if (!grafDrips.length) return;
  let changed = false;
  grafDrips = grafDrips.filter(d => {
    d.currentY += d.speed;
    if (d.currentY - d.y > d.length + 200) return false;
    changed = true; return true;
  });
  if (changed && currentPage === "graffiti") requestAnimationFrame(renderGraffiti);
}, 50);
