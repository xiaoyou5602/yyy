/* ── Desktop Clawd Crab Pet ── */
const CLAWD_ASSETS = {
  idle:     "/clawd-assets/clawd-mini-idle.svg",
  alert:    "/clawd-assets/clawd-mini-alert.svg",
  happy:    "/clawd-assets/clawd-happy.svg",
  music:    "/clawd-assets/clawd-headphones-groove.svg",
  peek:     "/clawd-assets/clawd-mini-peek.svg",
  sleep:    "/clawd-assets/clawd-mini-sleep.svg",
  enter:    "/clawd-assets/clawd-mini-enter.svg",
  typing:   "/clawd-assets/clawd-mini-typing.svg",
  crabwalk: "/clawd-assets/clawd-mini-crabwalk.svg",
};

// Use active zone's pet elements (multi-zone support)
function getActivePet() {
  const key = (typeof activeZoneKey !== "undefined") ? activeZoneKey : "ds";
  const z = (typeof zones !== "undefined" && zones[key]) ? zones[key] : null;
  if (z && z.deskPet) return { el: z.deskPet, body: z.deskPet.querySelector(".desk-pet-body"), shadow: z.deskPet.querySelector(".desk-pet-shadow") };
  // Fallback for pre-zone initialization
  const el = document.querySelector(".chat-zone:not([style*=\"display: none\"]) .desk-pet") || document.getElementById("desk-pet-ds");
  return { el, body: el ? el.querySelector(".desk-pet-body") : null, shadow: el ? el.querySelector(".desk-pet-shadow") : null };
}
let _pet = getActivePet();
let petEl = _pet.el;
let petBody = _pet.body;
let petShadow = _pet.shadow;

// Use <object> — enables eye tracking via contentDocument
const petObj = document.createElement("object");
petObj.type = "image/svg+xml";
petObj.style.width = "100%";
petObj.style.height = "100%";
petObj.style.pointerEvents = "none";
petObj.style.display = "block";
petBody.appendChild(petObj);

let currentPetState = "enter";
let petStateCls = null;
let petWalkX = 0;
let petWalking = false;
let petWalkDir = 1;

// ── Pet state ──
const PET_SVG_MAP = { typing: "music" };
function petSet(assetKey, cls) {
  currentPetState = assetKey || "idle";
  petStateCls = cls || (assetKey === "typing" ? "typing" : null);
  const svgKey = PET_SVG_MAP[assetKey] || assetKey;
  petObj.data = CLAWD_ASSETS[svgKey] || CLAWD_ASSETS.idle;
  petEl.classList.remove("hop", "wiggle", "pinch", "typing", "flip");
  if (petStateCls) petEl.classList.add(petStateCls);
}

// ── Init: enter → idle ──
petObj.data = CLAWD_ASSETS.enter;
setTimeout(() => petSet("idle"), 1200);

// ── Eye tracking ──
function trackEyes(ex, ey) {
  if (!petObj.contentDocument) return;
  const eyes = petObj.contentDocument.getElementById("eyes-js");
  if (!eyes) return;
  const petRect = petEl.getBoundingClientRect();
  const cx = petRect.left + petRect.width / 2;
  const cy = petRect.top + petRect.height / 2;
  // SVG viewBox is 26x26 rendered at 64px — 1 SVG unit ≈ 2.5 screen px
  // Eyes are 1x2 px in SVG space — keep movement subtle (±0.5 max)
  const dx = Math.max(-0.5, Math.min(0.5, (ex - cx) / 120));
  const dy = Math.max(-0.5, Math.min(0.5, (ey - cy) / 120));
  eyes.setAttribute("transform", `translate(${dx},${dy})`);
}

document.addEventListener("mousemove", (e) => {
  trackEyes(e.clientX, e.clientY);
});

document.addEventListener("touchmove", (e) => {
  if (e.touches.length) trackEyes(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: true });

// Keep pet above the growing input area
const footerEl = document.querySelector("footer");
if (footerEl) {
  new ResizeObserver(() => {
    const h = footerEl.offsetHeight;
    if (h) document.documentElement.style.setProperty("--footer-h", h + "px");
  }).observe(footerEl);
}

// ── Typing reaction ──
let petTypingTimer = null;
if (inputEl) inputEl.addEventListener("input", () => {
  if (currentPetState !== "typing") petSet("typing");
  clearTimeout(petTypingTimer);
  petTypingTimer = setTimeout(() => petSet("idle"), 2000);
});

// ── Send reaction ──
const origSend = send;
send = function() {
  const text = inputEl.value.trim();
  const hasContent = pendingFiles.length > 0;
  if ((!text && !hasContent) || !ws || ws.readyState !== WebSocket.OPEN) return;
  petSet("happy");
  setTimeout(() => { petSet("idle"); }, 1500);
  origSend();
};
sendBtn.removeEventListener("click", origSend);
sendBtn.addEventListener("click", send);

// ── Click reaction ──
petEl.addEventListener("click", () => {
  petSet("peek", "pinch");
  setTimeout(() => { petEl.classList.remove("pinch"); petSet("idle"); }, 600);
});

// ── Random walk ──
let petAnimTimer = null;

function doWalk() {
  if (petWalking) return;
  petWalking = true;

  const maxWalk = Math.min(window.innerWidth - 120, 280);
  const dist = 60 + Math.random() * Math.min(maxWalk - 60, 160);
  petWalkDir = Math.random() < 0.5 ? 1 : -1;
  const walkDist = dist * petWalkDir;

  petObj.data = CLAWD_ASSETS.crabwalk;
  currentPetState = "crabwalk";

  if (petWalkDir === -1) petEl.classList.add("flip");
  petEl.classList.add("walk-right");
  petEl.style.setProperty("--walk-x", walkDist + "px");
  petWalkX = walkDist;

  const pauseMs = 1500 + Math.random() * 3000;
  setTimeout(() => {
    petEl.style.setProperty("--walk-x", "0px");
    petWalkX = 0;
    setTimeout(() => {
      petEl.classList.remove("walk-right", "flip");
      petWalking = false;
      petSet("idle");
      scheduleWalk();
    }, 2500);
  }, 2500 + pauseMs);
}

function scheduleWalk() {
  const delay = 10000 + Math.random() * 20000;
  clearTimeout(petAnimTimer);
  petAnimTimer = setTimeout(doWalk, delay);
}
scheduleWalk();

// ── Random idle fidgets ──
function schedulePetFidget() {
  const delay = 6000 + Math.random() * 8000;
  clearTimeout(petAnimTimer);
  petAnimTimer = setTimeout(() => {
    if (petWalking) { schedulePetFidget(); return; }
    const r = Math.random();
    if (r < 0.3) {
      petSet("alert", "wiggle");
      setTimeout(() => { if (!petWalking) petSet("idle"); }, 800);
    } else if (r < 0.5) {
      petSet("happy");
      setTimeout(() => { if (!petWalking) petSet("idle"); }, 1500);
    }
    schedulePetFidget();
  }, delay);
}
schedulePetFidget();
