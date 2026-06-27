/* ── Calendar + Plans ── */
const PLAN_COLORS = ["#E85D3F", "#5B7FFF", "#F5A623", "#4CAF50", "#AB47BC", "#26C6DA"];
const PLAN_KEY = "cyberboss-calendar-plans";

const HOLIDAYS_2026 = {
  "01-01": "元旦", "01-05": "小寒", "01-20": "大寒",
  "02-04": "立春", "02-14": "情人节", "02-17": "除夕", "02-18": "春节", "02-19": "雨水",
  "03-05": "惊蛰", "03-08": "妇女节", "03-12": "植树节", "03-20": "春分",
  "04-05": "清明", "04-20": "谷雨",
  "05-01": "劳动节", "05-04": "青年节", "05-05": "立夏", "05-10": "母亲节", "05-21": "小满",
  "06-01": "儿童节", "06-05": "芒种", "06-19": "端午", "06-21": "夏至",
  "07-01": "建党节", "07-07": "小暑", "07-22": "大暑",
  "08-01": "建军节", "08-07": "立秋", "08-23": "处暑", "08-31": "七夕",
  "09-07": "白露", "09-10": "教师节", "09-23": "秋分", "09-25": "中秋",
  "10-01": "国庆节", "10-08": "寒露", "10-23": "霜降", "10-29": "重阳",
  "11-07": "立冬", "11-11": "双十一", "11-22": "小雪",
  "12-07": "大雪", "12-21": "冬至", "12-24": "平安夜", "12-25": "圣诞", "12-31": "跨年",
};

function getHoliday(month, day) {
  const key = `${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return HOLIDAYS_2026[key] || "";
}

let calState = {
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  selectedDate: null,
  editingPlanId: null,
};

function loadPlans() {
  try { return JSON.parse(localStorage.getItem(PLAN_KEY) || "{}"); }
  catch { return {}; }
}
function savePlans(plans) {
  try { localStorage.setItem(PLAN_KEY, JSON.stringify(plans)); }
  catch {}
}

function renderCalendar() {
  setupCalMedGesture();
  const { year, month } = calState;
  const today = new Date();
  const todayStr = formatDateStr(today.getFullYear(), today.getMonth(), today.getDate());

  document.getElementById("cal-month-title").textContent = `${year}年${month + 1}月`;

  const grid = document.getElementById("calendar-grid");
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const plans = loadPlans();

  let html = "";
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    html += renderDayCell(year, month - 1, d, true, todayStr, plans);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    html += renderDayCell(year, month, d, false, todayStr, plans);
  }
  const totalCells = firstDay + daysInMonth;
  const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let d = 1; d <= remaining; d++) {
    html += renderDayCell(year, month + 1, d, true, todayStr, plans);
  }

  grid.innerHTML = html;

  grid.querySelectorAll(".cal-day-cell").forEach(cell => {
    cell.addEventListener("click", () => {
      const dateStr = cell.dataset.date;
      if (!dateStr || cell.classList.contains("other-month")) return;
      selectDate(dateStr); renderCalendar();
    });
  });

  if (calState.selectedDate) selectDate(calState.selectedDate);
  else showPlanEmpty();
}

function renderDayCell(year, month, day, isOtherMonth, todayStr, plans) {
  const dateStr = formatDateStr(year, month, day);
  const isToday = dateStr === todayStr;
  const isSelected = dateStr === calState.selectedDate;
  const dayPlans = plans[dateStr] || [];
  const dots = dayPlans.map(p =>
    `<span class="cal-day-dot" style="background:${p.color || PLAN_COLORS[0]}"></span>`
  ).join("");

  const dow = new Date(year, month, day).getDay();
  const isWeekend = dow === 0 || dow === 6;
  const holiday = getHoliday(month, day);
  const sub = holiday || (isWeekend ? (dow === 0 ? "周日" : "周六") : "");

  const cls = [
    "cal-day-cell",
    isOtherMonth ? "other-month" : "",
    isToday ? "today" : "",
    isSelected ? "selected" : "",
    isWeekend && !holiday ? "weekend" : "",
  ].filter(Boolean).join(" ");

  return `<div class="${cls}" data-date="${dateStr}">
    <span class="cal-day-num">${day}</span>
    ${sub ? `<span class="cal-day-sub">${sub}</span>` : `<span class="cal-day-sub">&nbsp;</span>`}
    ${dots ? `<div class="cal-day-dots">${dots}</div>` : ""}
  </div>`;
}

function selectDate(dateStr) {
  calState.selectedDate = dateStr;
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  const weekDayNames = ["周日","周一","周二","周三","周四","周五","周六"];
  document.getElementById("cal-panel-date").textContent = `${m}月${d}日 ${weekDayNames[dow]}`;

  const plans = loadPlans();
  const dayPlans = plans[dateStr] || [];
  const list = document.getElementById("plan-list");
  const empty = document.getElementById("plan-empty");

  if (dayPlans.length === 0) {
    list.innerHTML = "";
    empty.style.display = "block";
  } else {
    empty.style.display = "none";
    list.innerHTML = dayPlans.map(p => `
      <div class="plan-item ${p.done ? 'done' : ''}" data-id="${p.id}">
        <div class="plan-check" data-toggle="${p.id}"></div>
        <div class="plan-color" style="background:${p.color || PLAN_COLORS[0]}"></div>
        <div class="plan-info">
          <div class="plan-title">${esc(p.title)}</div>
          ${p.time ? `<div class="plan-time">${esc(p.time)}</div>` : ""}
        </div>
        <button class="plan-delete" data-del="${p.id}">&times;</button>
      </div>
    `).join("");

    list.querySelectorAll(".plan-check").forEach(chk => {
      chk.addEventListener("click", (ev) => { ev.stopPropagation(); togglePlan(dateStr, chk.dataset.toggle); });
    });
    list.querySelectorAll(".plan-delete").forEach(btn => {
      btn.addEventListener("click", (ev) => { ev.stopPropagation(); deletePlan(dateStr, btn.dataset.del); });
    });
    list.querySelectorAll(".plan-item").forEach(item => {
      item.addEventListener("click", () => openPlanModal(dateStr, item.dataset.id));
    });
  }
}

	/* ── Calendar Cat ── */
	const calCat = document.getElementById('cal-cat');
	if (calCat) {
	  calCat.addEventListener('click', () => {
	    calCat.src = '/clawd-assets/calico-mini-happy.png';
	    calCat.classList.add('petted');
	    setTimeout(() => {
	      calCat.classList.remove('petted');
	      calCat.src = '/clawd-assets/calico-mini-sleep.png';
	    }, 1000);
	  });
	  // Random cat stretches
	  setInterval(() => {
	    if (currentPage !== 'calendar') return;
	    if (Math.random() < 0.3) {
	      calCat.src = '/clawd-assets/calico-mini-alert.png';
	      setTimeout(() => { calCat.src = '/clawd-assets/calico-mini-sleep.png'; }, 1200);
	    }
	  }, 15000);
	}

/* ── Calendar → Meditation scroll-up gesture ── */
function setupCalMedGesture() {
  if (calState._gestureListenersAdded) return;
  calState._gestureListenersAdded = true;
  const wrap = document.getElementById('cal-scroll-wrap');
  const hint = document.getElementById('cal-med-hint');
  if (!wrap || !hint) return;

  let pullStart = 0;
  let pulling = false;
  const threshold = 60;

  // Touch pull-up
  wrap.addEventListener('touchstart', (e) => {
    if (wrap.scrollTop <= 0) {
      pullStart = e.touches[0].clientY;
      pulling = true;
    }
  }, { passive: true });

  wrap.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - pullStart;
    if (dy > 10) {
      hint.classList.add('pulling');
    }
    if (dy > threshold) {
      pulling = false;
      hint.classList.remove('pulling');
      showPage('meditation');
    }
  }, { passive: true });

  wrap.addEventListener('touchend', () => {
    pulling = false;
    hint.classList.remove('pulling');
  });

  // Mouse wheel at top
  wrap.addEventListener('wheel', (e) => {
    if (wrap.scrollTop <= 0 && e.deltaY < 0) {
      hint.classList.add('pulling');
      if (!wrap._wheelCount) wrap._wheelCount = 0;
      wrap._wheelCount += Math.abs(e.deltaY);
      if (wrap._wheelCount > threshold) {
        wrap._wheelCount = 0;
        hint.classList.remove('pulling');
        showPage('meditation');
      }
      clearTimeout(wrap._wheelTimer);
      wrap._wheelTimer = setTimeout(() => {
        wrap._wheelCount = 0;
        hint.classList.remove('pulling');
      }, 400);
    }
  }, { passive: true });
}

function showPlanEmpty() {
  document.getElementById("plan-list").innerHTML = "";
  document.getElementById("plan-empty").style.display = "block";
  document.getElementById("cal-panel-date").textContent = "";
}

function formatDateStr(year, month, day) {
  const d = new Date(year, month, day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const calPrevBtn = document.getElementById("cal-prev");
const calNextBtn = document.getElementById("cal-next");
const calTodayBtn = document.getElementById("cal-today");
if (calPrevBtn) calPrevBtn.addEventListener("click", () => {
  calState.month--;
  if (calState.month < 0) { calState.month = 11; calState.year--; }
  calState.selectedDate = null;
  renderCalendar();
  showPlanEmpty();
});
if (calNextBtn) calNextBtn.addEventListener("click", () => {
  calState.month++;
  if (calState.month > 11) { calState.month = 0; calState.year++; }
  calState.selectedDate = null;
  renderCalendar();
  showPlanEmpty();
});
if (calTodayBtn) calTodayBtn.addEventListener("click", () => {
  const now = new Date();
  calState.year = now.getFullYear();
  calState.month = now.getMonth();
  calState.selectedDate = formatDateStr(now.getFullYear(), now.getMonth(), now.getDate());
  renderCalendar();
});

/* ── Plan modal ── */
let planModal = null;
function ensurePlanModal() {
  if (planModal) return;
  planModal = document.createElement("div");
  planModal.id = "plan-modal";
  planModal.innerHTML = `
    <div id="plan-modal-panel">
      <h3 id="plan-modal-title">添加计划</h3>
      <div class="plan-form-row">
        <label>计划内容</label>
        <input id="plan-input-title" type="text" placeholder="写一个计划…" maxlength="80">
      </div>
      <div class="plan-form-row">
        <label>时间（可选）</label>
        <input id="plan-input-time" type="time">
      </div>
      <div class="plan-form-actions">
        <button id="plan-delete">删除</button>
        <button id="plan-cancel">取消</button>
        <button id="plan-save">保存</button>
      </div>
    </div>`;
  document.body.appendChild(planModal);

  planModal.addEventListener("click", (e) => { if (e.target === planModal) closePlanModal(); });
  document.getElementById("plan-cancel").addEventListener("click", closePlanModal);
  document.getElementById("plan-save").addEventListener("click", () => {
    const d = planModal.dataset.date;
    if (d) savePlan(d);
  });
  document.getElementById("plan-delete").addEventListener("click", () => {
    const d = planModal.dataset.date;
    if (calState.editingPlanId && d) { deletePlan(d, calState.editingPlanId); closePlanModal(); }
  });
}

function openPlanModal(dateStr, planId) {
  ensurePlanModal();
  const plans = loadPlans();
  const existing = planId ? (plans[dateStr] || []).find(p => p.id === planId) : null;
  calState.editingPlanId = planId || null;

  document.getElementById("plan-modal-title").textContent = existing ? "编辑计划" : "添加计划";
  document.getElementById("plan-input-title").value = existing ? existing.title : "";
  document.getElementById("plan-input-time").value = existing ? (existing.time || "") : "";
  document.getElementById("plan-delete").style.display = existing ? "block" : "none";
  planModal.dataset.date = dateStr;
  planModal.classList.add("show");
  setTimeout(() => document.getElementById("plan-input-title").focus(), 100);
}

function closePlanModal() {
  if (planModal) { planModal.classList.remove("show"); calState.editingPlanId = null; }
}

function savePlan(dateStrFromModal) {
  const dateStr = dateStrFromModal || (planModal ? planModal.dataset.date : null);
  if (!dateStr) return;
  const title = document.getElementById("plan-input-title").value.trim();
  if (!title) return;

  const plans = loadPlans();
  if (!plans[dateStr]) plans[dateStr] = [];

  if (calState.editingPlanId) {
    const idx = plans[dateStr].findIndex(p => p.id === calState.editingPlanId);
    if (idx !== -1) {
      plans[dateStr][idx].title = title;
      plans[dateStr][idx].time = document.getElementById("plan-input-time").value;
    }
  } else {
    plans[dateStr].push({
      id: "pln-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      title,
      time: document.getElementById("plan-input-time").value,
      done: false,
      color: PLAN_COLORS[Math.floor(Math.random() * PLAN_COLORS.length)],
      createdAt: new Date().toISOString(),
    });
  }

  plans[dateStr].sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
  savePlans(plans);
  closePlanModal();
  selectDate(dateStr); renderCalendar();
}

function deletePlan(dateStr, planId) {
  const plans = loadPlans();
  if (!plans[dateStr]) return;
  plans[dateStr] = plans[dateStr].filter(p => p.id !== planId);
  if (plans[dateStr].length === 0) delete plans[dateStr];
  savePlans(plans);
  selectDate(dateStr); renderCalendar();
}

function togglePlan(dateStr, planId) {
  const plans = loadPlans();
  const dayPlans = plans[dateStr];
  if (!dayPlans) return;
  const p = dayPlans.find(p => p.id === planId);
  if (p) p.done = !p.done;
  savePlans(plans);
  selectDate(dateStr); renderCalendar();
}

const calAddPlanBtn = document.getElementById("cal-add-plan");
const planFabBtn = document.getElementById("plan-fab");
if (calAddPlanBtn) calAddPlanBtn.addEventListener("click", () => {
  if (!calState.selectedDate) {
    const now = new Date();
    calState.selectedDate = formatDateStr(now.getFullYear(), now.getMonth(), now.getDate());
  }
  openPlanModal(calState.selectedDate);
});
if (planFabBtn) planFabBtn.addEventListener("click", () => {
  if (!calState.selectedDate) {
    const now = new Date();
    calState.selectedDate = formatDateStr(now.getFullYear(), now.getMonth(), now.getDate());
  }
  openPlanModal(calState.selectedDate);
});
