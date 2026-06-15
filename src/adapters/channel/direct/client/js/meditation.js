/* ── Meditation ── */
let medTimer = null;
let medStartTime = 0;
let medDuration = 5 * 60;
let medPhase = 0;
let medPhaseTimer = null;
let medRunning = false;
let medIdleTimer = null;
let medIsSitting = true;

const PHASES = [
  { name: "吸气", label: "用鼻子缓慢吸气", duration: 4 },
  { name: "屏息", label: "轻轻屏住呼吸", duration: 4 },
  { name: "呼气", label: "用嘴巴缓缓呼气", duration: 6 },
];

// Cat SVGs
const CAT_DEFAULT = `<svg width="140" height="160" viewBox="0 0 256 280" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="128" cy="262" rx="76" ry="14" fill="rgba(0,0,0,0.035)"/>
  <path d="M172,200 C200,196 210,216 204,236 C198,256 172,260 162,244" fill="none" stroke="#2B2B2B" stroke-width="6" stroke-linecap="round"/>
  <path d="M193,212 C196,208 196,204 194,200" fill="none" stroke="#2B2B2B" stroke-width="3" stroke-linecap="round"/>
  <path d="M202,226 C203,222 202,218 199,214" fill="none" stroke="#2B2B2B" stroke-width="3" stroke-linecap="round"/>
  <path d="M196,244 C195,240 192,237 189,235" fill="none" stroke="#2B2B2B" stroke-width="3" stroke-linecap="round"/>
  <ellipse cx="128" cy="168" rx="58" ry="66" fill="#BDBDBD" stroke="#2B2B2B" stroke-width="6"/>
  <g stroke="#2B2B2B" stroke-width="3" stroke-linecap="round" fill="none">
    <path d="M84,148 C92,140 100,137 108,140"/>
    <path d="M81,162 C89,154 97,151 105,154"/>
    <path d="M83,176 C91,168 99,165 107,168"/>
    <path d="M148,148 C156,140 164,137 172,140"/>
    <path d="M151,162 C159,154 167,151 175,154"/>
    <path d="M149,176 C157,168 165,165 173,168"/>
  </g>
  <circle cx="128" cy="98" r="52" fill="#BDBDBD" stroke="#2B2B2B" stroke-width="6"/>
  <path d="M96,60 L108,48 L120,62 L132,48 L144,60" fill="none" stroke="#2B2B2B" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Left ear -->
  <path d="M90,62 L72,24 L108,54Z" fill="#BDBDBD" stroke="#2B2B2B" stroke-width="6" stroke-linejoin="round"/>
  <path d="M86,56 L78,34 L102,52Z" fill="#D5D5D5"/>
  <!-- Right ear -->
  <path d="M166,62 L184,24 L148,54Z" fill="#BDBDBD" stroke="#2B2B2B" stroke-width="6" stroke-linejoin="round"/>
  <path d="M170,56 L178,34 L154,52Z" fill="#D5D5D5"/>
  <!-- Left eye -->
  <circle cx="104" cy="96" r="18" fill="#FFF" stroke="#2B2B2B" stroke-width="5"/>
  <circle cx="104" cy="98" r="6" fill="#2B2B2B"/>
  <!-- Right eye -->
  <circle cx="152" cy="96" r="17" fill="#FFF" stroke="#2B2B2B" stroke-width="5"/>
  <circle cx="153" cy="97" r="5.5" fill="#2B2B2B"/>
  <path d="M118,124 Q128,134 138,124" fill="none" stroke="#2B2B2B" stroke-width="4" stroke-linecap="round"/>
  <g stroke="#2B2B2B" stroke-width="3.5" stroke-linecap="round" opacity="0.7">
    <line x1="74" y1="114" x2="100" y2="112"/>
    <line x1="73" y1="128" x2="99" y2="124"/>
    <line x1="75" y1="142" x2="101" y2="136"/>
    <line x1="158" y1="112" x2="182" y2="114"/>
    <line x1="159" y1="124" x2="183" y2="128"/>
    <line x1="157" y1="136" x2="181" y2="142"/>
  </g>
  <ellipse cx="104" cy="226" rx="16" ry="10" fill="#FDF6EF" stroke="#2B2B2B" stroke-width="5"/>
  <ellipse cx="152" cy="226" rx="16" ry="10" fill="#FDF6EF" stroke="#2B2B2B" stroke-width="5"/>
  <g stroke="#2B2B2B" stroke-width="2" stroke-linecap="round">
    <line x1="97" y1="228" x2="103" y2="228"/>
    <line x1="99" y1="231" x2="105" y2="231"/>
    <line x1="145" y1="228" x2="151" y2="228"/>
    <line x1="147" y1="231" x2="153" y2="231"/>
  </g>
</svg>`;

const CAT_SLEEPY = `<svg width="140" height="160" viewBox="0 0 256 280" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="128" cy="262" rx="76" ry="14" fill="rgba(0,0,0,0.035)"/>
  <path d="M172,200 C198,208 208,228 202,248 C196,266 178,270 168,262" fill="none" stroke="#2B2B2B" stroke-width="6" stroke-linecap="round"/>
  <path d="M196,222 C201,228 202,236 199,242" fill="none" stroke="#2B2B2B" stroke-width="3" stroke-linecap="round"/>
  <path d="M194,252 C192,258 188,262 183,264" fill="none" stroke="#2B2B2B" stroke-width="3" stroke-linecap="round"/>
  <ellipse cx="128" cy="168" rx="58" ry="66" fill="#BDBDBD" stroke="#2B2B2B" stroke-width="6"/>
  <g stroke="#2B2B2B" stroke-width="3" stroke-linecap="round" fill="none">
    <path d="M84,148 C92,140 100,137 108,140"/>
    <path d="M81,162 C89,154 97,151 105,154"/>
    <path d="M83,176 C91,168 99,165 107,168"/>
    <path d="M148,148 C156,140 164,137 172,140"/>
    <path d="M151,162 C159,154 167,151 175,154"/>
    <path d="M149,176 C157,168 165,165 173,168"/>
  </g>
  <circle cx="128" cy="98" r="52" fill="#BDBDBD" stroke="#2B2B2B" stroke-width="6"/>
  <path d="M96,60 L108,48 L120,62 L132,48 L144,60" fill="none" stroke="#2B2B2B" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Left ear -->
  <path d="M90,62 L72,24 L108,54Z" fill="#BDBDBD" stroke="#2B2B2B" stroke-width="6" stroke-linejoin="round"/>
  <path d="M86,56 L78,34 L102,52Z" fill="#D5D5D5"/>
  <!-- Right ear -->
  <path d="M166,62 L184,24 L148,54Z" fill="#BDBDBD" stroke="#2B2B2B" stroke-width="6" stroke-linejoin="round"/>
  <path d="M170,56 L178,34 L154,52Z" fill="#D5D5D5"/>
  <path d="M86,96 Q104,108 122,96" fill="none" stroke="#2B2B2B" stroke-width="5" stroke-linecap="round"/>
  <path d="M134,96 Q152,108 170,96" fill="none" stroke="#2B2B2B" stroke-width="5" stroke-linecap="round"/>
  <path d="M123,126 Q128,130 133,126" fill="none" stroke="#2B2B2B" stroke-width="3" stroke-linecap="round"/>
  <g stroke="#2B2B2B" stroke-width="3.5" stroke-linecap="round" opacity="0.7">
    <line x1="74" y1="114" x2="100" y2="112"/>
    <line x1="73" y1="128" x2="99" y2="124"/>
    <line x1="75" y1="142" x2="101" y2="136"/>
    <line x1="158" y1="112" x2="182" y2="114"/>
    <line x1="159" y1="124" x2="183" y2="128"/>
    <line x1="157" y1="136" x2="181" y2="142"/>
  </g>
  <ellipse cx="104" cy="226" rx="16" ry="10" fill="#FDF6EF" stroke="#2B2B2B" stroke-width="5"/>
  <ellipse cx="152" cy="226" rx="16" ry="10" fill="#FDF6EF" stroke="#2B2B2B" stroke-width="5"/>
  <g stroke="#2B2B2B" stroke-width="2" stroke-linecap="round">
    <line x1="97" y1="228" x2="103" y2="228"/>
    <line x1="99" y1="231" x2="105" y2="231"/>
    <line x1="145" y1="228" x2="151" y2="228"/>
    <line x1="147" y1="231" x2="153" y2="231"/>
  </g>
</svg>`;

const CAT_HAPPY = `<svg width="140" height="160" viewBox="0 0 256 280" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="128" cy="262" rx="76" ry="14" fill="rgba(0,0,0,0.035)"/>
  <path d="M172,200 C200,188 214,168 208,144 C204,128 192,120 184,118" fill="none" stroke="#2B2B2B" stroke-width="6" stroke-linecap="round"/>
  <path d="M202,178 C206,172 207,164 204,157" fill="none" stroke="#2B2B2B" stroke-width="3" stroke-linecap="round"/>
  <path d="M208,154 C207,147 204,141 200,135" fill="none" stroke="#2B2B2B" stroke-width="3" stroke-linecap="round"/>
  <ellipse cx="128" cy="168" rx="58" ry="66" fill="#BDBDBD" stroke="#2B2B2B" stroke-width="6"/>
  <g stroke="#2B2B2B" stroke-width="3" stroke-linecap="round" fill="none">
    <path d="M84,148 C92,140 100,137 108,140"/>
    <path d="M81,162 C89,154 97,151 105,154"/>
    <path d="M83,176 C91,168 99,165 107,168"/>
    <path d="M148,148 C156,140 164,137 172,140"/>
    <path d="M151,162 C159,154 167,151 175,154"/>
    <path d="M149,176 C157,168 165,165 173,168"/>
  </g>
  <circle cx="128" cy="98" r="52" fill="#BDBDBD" stroke="#2B2B2B" stroke-width="6"/>
  <path d="M96,60 L108,48 L120,62 L132,48 L144,60" fill="none" stroke="#2B2B2B" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Left ear -->
  <path d="M90,62 L72,24 L108,54Z" fill="#BDBDBD" stroke="#2B2B2B" stroke-width="6" stroke-linejoin="round"/>
  <path d="M86,56 L78,34 L102,52Z" fill="#D5D5D5"/>
  <!-- Right ear -->
  <path d="M166,62 L184,24 L148,54Z" fill="#BDBDBD" stroke="#2B2B2B" stroke-width="6" stroke-linejoin="round"/>
  <path d="M170,56 L178,34 L154,52Z" fill="#D5D5D5"/>
  <path d="M86,102 Q104,86 122,102" fill="none" stroke="#2B2B2B" stroke-width="5" stroke-linecap="round"/>
  <path d="M134,102 Q152,86 170,102" fill="none" stroke="#2B2B2B" stroke-width="5" stroke-linecap="round"/>
  <path d="M114,122 Q128,136 142,122" fill="none" stroke="#2B2B2B" stroke-width="4" stroke-linecap="round"/>
  <g stroke="#2B2B2B" stroke-width="3.5" stroke-linecap="round" opacity="0.7">
    <line x1="74" y1="114" x2="100" y2="112"/>
    <line x1="73" y1="128" x2="99" y2="124"/>
    <line x1="75" y1="142" x2="101" y2="136"/>
    <line x1="158" y1="112" x2="182" y2="114"/>
    <line x1="159" y1="124" x2="183" y2="128"/>
    <line x1="157" y1="136" x2="181" y2="142"/>
  </g>
  <ellipse cx="104" cy="226" rx="16" ry="10" fill="#FDF6EF" stroke="#2B2B2B" stroke-width="5"/>
  <ellipse cx="152" cy="226" rx="16" ry="10" fill="#FDF6EF" stroke="#2B2B2B" stroke-width="5"/>
  <g stroke="#2B2B2B" stroke-width="2" stroke-linecap="round">
    <line x1="97" y1="228" x2="103" y2="228"/>
    <line x1="99" y1="231" x2="105" y2="231"/>
    <line x1="145" y1="228" x2="151" y2="228"/>
    <line x1="147" y1="231" x2="153" y2="231"/>
  </g>
</svg>`;

const CAT_SPACED = `<svg width="140" height="160" viewBox="0 0 256 280" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="128" cy="262" rx="76" ry="14" fill="rgba(0,0,0,0.035)"/>
  <path d="M172,200 C200,196 210,216 204,236 C198,256 172,260 162,244" fill="none" stroke="#2B2B2B" stroke-width="6" stroke-linecap="round"/>
  <path d="M193,212 C196,208 196,204 194,200" fill="none" stroke="#2B2B2B" stroke-width="3" stroke-linecap="round"/>
  <path d="M202,226 C203,222 202,218 199,214" fill="none" stroke="#2B2B2B" stroke-width="3" stroke-linecap="round"/>
  <path d="M196,244 C195,240 192,237 189,235" fill="none" stroke="#2B2B2B" stroke-width="3" stroke-linecap="round"/>
  <ellipse cx="128" cy="168" rx="58" ry="66" fill="#BDBDBD" stroke="#2B2B2B" stroke-width="6"/>
  <g stroke="#2B2B2B" stroke-width="3" stroke-linecap="round" fill="none">
    <path d="M84,148 C92,140 100,137 108,140"/>
    <path d="M81,162 C89,154 97,151 105,154"/>
    <path d="M83,176 C91,168 99,165 107,168"/>
    <path d="M148,148 C156,140 164,137 172,140"/>
    <path d="M151,162 C159,154 167,151 175,154"/>
    <path d="M149,176 C157,168 165,165 173,168"/>
  </g>
  <circle cx="128" cy="98" r="52" fill="#BDBDBD" stroke="#2B2B2B" stroke-width="6"/>
  <path d="M96,60 L108,48 L120,62 L132,48 L144,60" fill="none" stroke="#2B2B2B" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Left ear -->
  <path d="M90,62 L72,24 L108,54Z" fill="#BDBDBD" stroke="#2B2B2B" stroke-width="6" stroke-linejoin="round"/>
  <path d="M86,56 L78,34 L102,52Z" fill="#D5D5D5"/>
  <!-- Right ear -->
  <path d="M166,62 L184,24 L148,54Z" fill="#BDBDBD" stroke="#2B2B2B" stroke-width="6" stroke-linejoin="round"/>
  <path d="M170,56 L178,34 L154,52Z" fill="#D5D5D5"/>
  <circle cx="104" cy="96" r="18" fill="#FFF" stroke="#2B2B2B" stroke-width="5"/>
  <circle cx="152" cy="96" r="17" fill="#FFF" stroke="#2B2B2B" stroke-width="5"/>
  <circle cx="102" cy="98" r="6" fill="#2B2B2B"/>
  <circle cx="157" cy="97" r="4.5" fill="#2B2B2B"/>
  <path d="M120,126 Q126,130 132,124" fill="none" stroke="#2B2B2B" stroke-width="3" stroke-linecap="round"/>
  <g stroke="#2B2B2B" stroke-width="3.5" stroke-linecap="round" opacity="0.7">
    <line x1="74" y1="114" x2="100" y2="112"/>
    <line x1="73" y1="128" x2="99" y2="124"/>
    <line x1="75" y1="142" x2="101" y2="136"/>
    <line x1="158" y1="112" x2="182" y2="114"/>
    <line x1="159" y1="124" x2="183" y2="128"/>
    <line x1="157" y1="136" x2="181" y2="142"/>
  </g>
  <ellipse cx="104" cy="226" rx="16" ry="10" fill="#FDF6EF" stroke="#2B2B2B" stroke-width="5"/>
  <ellipse cx="152" cy="226" rx="16" ry="10" fill="#FDF6EF" stroke="#2B2B2B" stroke-width="5"/>
  <g stroke="#2B2B2B" stroke-width="2" stroke-linecap="round">
    <line x1="97" y1="228" x2="103" y2="228"/>
    <line x1="99" y1="231" x2="105" y2="231"/>
    <line x1="145" y1="228" x2="151" y2="228"/>
    <line x1="147" y1="231" x2="153" y2="231"/>
  </g>
</svg>`;

const CAT_THINK = `<svg width="140" height="160" viewBox="0 0 256 280" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="128" cy="262" rx="76" ry="14" fill="rgba(0,0,0,0.035)"/>
  <path d="M172,200 C200,196 210,216 204,236 C198,256 172,260 162,244" fill="none" stroke="#2B2B2B" stroke-width="6" stroke-linecap="round"/>
  <path d="M193,212 C196,208 196,204 194,200" fill="none" stroke="#2B2B2B" stroke-width="3" stroke-linecap="round"/>
  <path d="M202,226 C203,222 202,218 199,214" fill="none" stroke="#2B2B2B" stroke-width="3" stroke-linecap="round"/>
  <path d="M196,244 C195,240 192,237 189,235" fill="none" stroke="#2B2B2B" stroke-width="3" stroke-linecap="round"/>
  <ellipse cx="128" cy="168" rx="58" ry="66" fill="#BDBDBD" stroke="#2B2B2B" stroke-width="6"/>
  <g stroke="#2B2B2B" stroke-width="3" stroke-linecap="round" fill="none">
    <path d="M84,148 C92,140 100,137 108,140"/>
    <path d="M81,162 C89,154 97,151 105,154"/>
    <path d="M83,176 C91,168 99,165 107,168"/>
    <path d="M148,148 C156,140 164,137 172,140"/>
    <path d="M151,162 C159,154 167,151 175,154"/>
    <path d="M149,176 C157,168 165,165 173,168"/>
  </g>
  <circle cx="128" cy="98" r="52" fill="#BDBDBD" stroke="#2B2B2B" stroke-width="6"/>
  <path d="M96,60 L108,48 L120,62 L132,48 L144,60" fill="none" stroke="#2B2B2B" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Left ear -->
  <path d="M90,62 L72,24 L108,54Z" fill="#BDBDBD" stroke="#2B2B2B" stroke-width="6" stroke-linejoin="round"/>
  <path d="M86,56 L78,34 L102,52Z" fill="#D5D5D5"/>
  <!-- Right ear -->
  <path d="M166,62 L184,24 L148,54Z" fill="#BDBDBD" stroke="#2B2B2B" stroke-width="6" stroke-linejoin="round"/>
  <path d="M170,56 L178,34 L154,52Z" fill="#D5D5D5"/>
  <circle cx="104" cy="94" r="18" fill="#FFF" stroke="#2B2B2B" stroke-width="5"/>
  <circle cx="152" cy="94" r="17" fill="#FFF" stroke="#2B2B2B" stroke-width="5"/>
  <circle cx="108" cy="92" r="6" fill="#2B2B2B"/>
  <circle cx="157" cy="91" r="5.5" fill="#2B2B2B"/>
  <path d="M122,124 Q128,130 134,122" fill="none" stroke="#2B2B2B" stroke-width="4" stroke-linecap="round"/>
  <g stroke="#2B2B2B" stroke-width="3.5" stroke-linecap="round" opacity="0.7">
    <line x1="74" y1="114" x2="100" y2="112"/>
    <line x1="73" y1="128" x2="99" y2="124"/>
    <line x1="75" y1="142" x2="101" y2="136"/>
    <line x1="158" y1="112" x2="182" y2="114"/>
    <line x1="159" y1="124" x2="183" y2="128"/>
    <line x1="157" y1="136" x2="181" y2="142"/>
  </g>
  <ellipse cx="104" cy="226" rx="16" ry="10" fill="#FDF6EF" stroke="#2B2B2B" stroke-width="5"/>
  <ellipse cx="152" cy="226" rx="16" ry="10" fill="#FDF6EF" stroke="#2B2B2B" stroke-width="5"/>
  <g stroke="#2B2B2B" stroke-width="2" stroke-linecap="round">
    <line x1="97" y1="228" x2="103" y2="228"/>
    <line x1="99" y1="231" x2="105" y2="231"/>
    <line x1="145" y1="228" x2="151" y2="228"/>
    <line x1="147" y1="231" x2="153" y2="231"/>
  </g>
</svg>`;

// Idle cat behavior: randomly sit/stand
// Idle cat: cycle through mood states with weighted random
const CAT_STATES = [
  { svg: CAT_DEFAULT, cls: "sitting", weight: 40 },
  { svg: CAT_SLEEPY,  cls: "sleepy",  weight: 15 },
  { svg: CAT_HAPPY,   cls: "happy",   weight: 15 },
  { svg: CAT_SPACED,  cls: "spaced",  weight: 15 },
  { svg: CAT_THINK,   cls: "think",   weight: 15 },
];
function pickCatState() {
  const total = CAT_STATES.reduce((s, st) => s + st.weight, 0);
  let r = Math.random() * total;
  for (const st of CAT_STATES) {
    r -= st.weight;
    if (r <= 0) return st;
  }
  return CAT_STATES[0];
}
function scheduleIdleBehavior() {
  if (medRunning) return;
  const delay = 20000 + Math.random() * 40000;
  medIdleTimer = setTimeout(() => {
    if (medRunning) { scheduleIdleBehavior(); return; }
    const st = pickCatState();
    const cat = document.getElementById("med-cat");
    cat.innerHTML = st.svg;
    cat.className = "med-cat-wrap " + st.cls;
    scheduleIdleBehavior();
  }, delay);
}

function initMeditation() {
  if (medRunning) return;
  document.getElementById("med-phase").textContent = "准备开始";
  document.getElementById("med-status-label").textContent = "";
  document.getElementById("med-status-dot").className = "med-status-dot";
  document.getElementById("med-timer").textContent = formatMedTime(medDuration);
  // Cat to sitting pose
  const cat = document.getElementById("med-cat");
  cat.innerHTML = CAT_DEFAULT;
  cat.className = "med-cat-wrap sitting";
  if (medIdleTimer) { clearTimeout(medIdleTimer); medIdleTimer = null; }
  scheduleIdleBehavior();
}

function formatMedTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function startMeditation() {
  medRunning = true;
  medStartTime = Date.now();
  medPhase = 0;
  if (medIdleTimer) { clearTimeout(medIdleTimer); medIdleTimer = null; }
  // Force cat into meditation pose
  const cat = document.getElementById("med-cat");
  cat.innerHTML = CAT_DEFAULT;
  cat.className = "med-cat-wrap sitting";

  document.getElementById("med-play").innerHTML = `<svg width="220" height="72" viewBox="0 0 260 80" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="fish-shadow2" x="-10%" y="-20%" width="130%" height="160%">
      <feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#000" flood-opacity="0.12"/>
    </filter>
  </defs>
  <path d="M228,40
           L252,18
           C244,25 238,32 234,36
           C180,28 120,22 52,26
           C34,27 22,33 16,40
           C22,47 34,53 52,54
           C120,58 180,52 234,44
           C238,48 244,55 252,62
           L228,40 Z"
        fill="#D4956A" filter="url(#fish-shadow2)"/>
  <text x="130" y="46" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="18" font-weight="600" fill="#fff" letter-spacing="4">停止</text>
</svg>`;
  updatePhaseUI();
  runPhase();

  medTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - medStartTime) / 1000);
    const remaining = Math.max(0, medDuration - elapsed);
    document.getElementById("med-timer").textContent = formatMedTime(remaining);
    if (remaining <= 0) {
      stopMeditation();
    }
  }, 500);
}

function updatePhaseUI() {
  const phase = PHASES[medPhase];
  document.getElementById("med-phase").textContent = phase.name;
  document.getElementById("med-status-label").textContent = phase.label;
  const dot = document.getElementById("med-status-dot");
  const cat = document.getElementById("med-cat");

  dot.className = "med-status-dot";
  if (medPhase === 0) {
    dot.classList.add("inhale");
    cat.className = "med-cat-wrap sitting breathing-in";
  } else if (medPhase === 1) {
    dot.classList.add("hold");
    cat.className = "med-cat-wrap sitting breathing-hold";
  } else {
    dot.classList.add("exhale");
    cat.className = "med-cat-wrap sitting breathing-out";
  }
}

function runPhase() {
  if (!medRunning) return;
  updatePhaseUI();
  const phase = PHASES[medPhase];

  medPhaseTimer = setTimeout(() => {
    medPhase = (medPhase + 1) % 3;
    runPhase();
  }, phase.duration * 1000);
}

function stopMeditation() {
  medRunning = false;
  if (medTimer) { clearInterval(medTimer); medTimer = null; }
  if (medPhaseTimer) { clearTimeout(medPhaseTimer); medPhaseTimer = null; }
  document.getElementById("med-play").innerHTML = `<svg width="220" height="72" viewBox="0 0 260 80" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="fish-shadow" x="-10%" y="-20%" width="130%" height="160%">
      <feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#000" flood-opacity="0.12"/>
    </filter>
  </defs>
  <!-- Fish body silhouette -->
  <path d="M228,40
           L252,18
           C244,25 238,32 234,36
           C180,28 120,22 52,26
           C34,27 22,33 16,40
           C22,47 34,53 52,54
           C120,58 180,52 234,44
           C238,48 244,55 252,62
           L228,40 Z"
        fill="#1a1a1a" filter="url(#fish-shadow)"/>
  <!-- "开始专注" text centered -->
  <text x="130" y="46" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="18" font-weight="600" fill="#fff" letter-spacing="4">开始专注</text>
</svg>`;
  document.getElementById("med-phase").textContent = "完成";
  document.getElementById("med-status-label").textContent = "做得很好";
  document.getElementById("med-status-dot").className = "med-status-dot";
  const cat = document.getElementById("med-cat");
  cat.className = "med-cat-wrap sitting";
  cat.innerHTML = CAT_DEFAULT;
  medIsSitting = true;
  scheduleIdleBehavior();
}

function resetMeditation() {
  stopMeditation();
  medDuration = 5 * 60;
  document.querySelectorAll(".med-dur").forEach(d => d.classList.remove("active"));
  const def = document.querySelector(".med-dur[data-min='5']");
  if (def) def.classList.add("active");
  initMeditation();
}

document.getElementById("med-play").addEventListener("click", () => {
  if (medRunning) {
    stopMeditation();
  } else {
    startMeditation();
  }
});

document.getElementById("med-skip").addEventListener("click", () => {
  if (!medRunning) return;
  if (medPhaseTimer) { clearTimeout(medPhaseTimer); medPhaseTimer = null; }
  medPhase = (medPhase + 1) % 3;
  runPhase();
});

document.getElementById("med-reset").addEventListener("click", resetMeditation);

document.getElementById("med-durations").addEventListener("click", (e) => {
  const dur = e.target.closest(".med-dur");
  if (!dur || medRunning) return;
  document.querySelectorAll(".med-dur").forEach(d => d.classList.remove("active"));
  dur.classList.add("active");
  medDuration = parseInt(dur.dataset.min) * 60;
  document.getElementById("med-timer").textContent = formatMedTime(medDuration);
});

// Init cat on page load
initMeditation();
