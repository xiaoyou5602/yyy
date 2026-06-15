/* ── Calendar Component ── */
// 所有 DOM 操作限制在 this.root 内，不跨组件查询

(function() {
  var PLAN_COLORS = ["#E85D3F", "#5B7FFF", "#F5A623", "#4CAF50", "#AB47BC", "#26C6DA"];
  var PLAN_KEY = "withtoge-calendar-plans";

  var HOLIDAYS_2026 = {
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
    var key = String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
    return HOLIDAYS_2026[key] || "";
  }

  function loadPlans() {
    // 从旧 key 迁移数据
    try {
      var oldData = localStorage.getItem("cyberboss-calendar-plans");
      if (oldData) {
        localStorage.setItem(PLAN_KEY, oldData);
        localStorage.removeItem("cyberboss-calendar-plans");
      }
    } catch {}
    try { return JSON.parse(localStorage.getItem(PLAN_KEY) || "{}"); }
    catch { return {}; }
  }
  function savePlans(plans) {
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(plans)); }
    catch {}
  }

  function formatDateStr(year, month, day) {
    var d = new Date(year, month, day);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function createCalendarComponent() {
    var self = this;
    var root = null;
    var state = {
      year: new Date().getFullYear(),
      month: new Date().getMonth(),
      selectedDate: null,
      editingPlanId: null,
      _mounted: false,
      _catInterval: null,
    };
    var planModal = null;

    // ── Template ──
    function template() {
      return '<div class="calendar-root">' +
        '<div class="cal-scroll-wrap">' +
          '<header class="cal-header">' +
            '<button id="cal-back-btn" title="返回聊天">&#8592;</button>' +
            '<h2 class="cal-month-title" id="cal-month-title"></h2>' +
            '<img class="cal-cat" id="cal-cat" src="/clawd-assets/calico-mini-sleep.png" alt="" title="戳戳我">' +
            '<div class="cal-nav-row">' +
              '<button class="cal-nav-btn" id="cal-prev" aria-label="上个月">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>' +
              '</button>' +
              '<button class="cal-today-btn" id="cal-today">今天</button>' +
              '<button class="cal-nav-btn" id="cal-next" aria-label="下个月">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>' +
              '</button>' +
            '</div>' +
          '</header>' +
          '<div class="cal-weekdays">' +
            '<span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>' +
          '</div>' +
          '<div class="calendar-grid" id="calendar-grid"></div>' +
          '<div class="calendar-day-panel" id="calendar-day-panel">' +
            '<div class="cal-panel-header">' +
              '<div><h3 class="cal-panel-date" id="cal-panel-date"></h3></div>' +
              '<button class="cal-add-btn" id="cal-add-plan">+ 添加</button>' +
            '</div>' +
            '<div class="plan-list" id="plan-list"></div>' +
            '<div class="plan-empty" id="plan-empty">' +
              '<div class="plan-empty-icon">&#128221;</div>' +
              '<p class="plan-empty-text">点击日期查看计划<br>点击 + 或右下角按钮添加</p>' +
            '</div>' +
            '<button class="plan-fab" id="plan-fab" title="添加计划">+</button>' +
          '</div>' +
          '<div class="cal-hub">' +
            '<button class="cal-hub-item cal-hub-diary">' +
              '<span class="cal-hub-icon">&#128214;</span>' +
              '<span class="cal-hub-label">日记</span>' +
            '</button>' +
          '</div>' +


          '<div class="cal-mcp-hint" id="cal-mcp-hint">' +
            '<span class="cal-mcp-hint-arrow">&#8594;</span>' +
            '<span>左滑进入娱乐室</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    }

    // ── Render ──
    function renderCalendar() {
      if (!root) return;
      setupCalMcpSwipe();

      var today = new Date();
      var todayStr = formatDateStr(today.getFullYear(), today.getMonth(), today.getDate());
      root.querySelector("#cal-month-title").textContent = state.year + "年" + (state.month + 1) + "月";

      var grid = root.querySelector("#calendar-grid");
      var firstDay = new Date(state.year, state.month, 1).getDay();
      var daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
      var daysInPrevMonth = new Date(state.year, state.month, 0).getDate();
      var plans = loadPlans();

      var html = "";
      for (var i = firstDay - 1; i >= 0; i--) {
        var d = daysInPrevMonth - i;
        html += renderDayCell(state.year, state.month - 1, d, true, todayStr, plans);
      }
      for (var dd = 1; dd <= daysInMonth; dd++) {
        html += renderDayCell(state.year, state.month, dd, false, todayStr, plans);
      }
      var totalCells = firstDay + daysInMonth;
      var remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
      for (var rr = 1; rr <= remaining; rr++) {
        html += renderDayCell(state.year, state.month + 1, rr, true, todayStr, plans);
      }
      grid.innerHTML = html;

      grid.querySelectorAll(".cal-day-cell").forEach(function(cell) {
        cell.addEventListener("click", function() {
          var dateStr = cell.dataset.date;
          if (!dateStr || cell.classList.contains("other-month")) return;
          state.selectedDate = dateStr;
          renderCalendar();
        });
      });

      if (state.selectedDate) selectDate(state.selectedDate);
      else showPlanEmpty();
    }

    function renderDayCell(year, month, day, isOtherMonth, todayStr, plans) {
      var dateStr = formatDateStr(year, month, day);
      var isToday = dateStr === todayStr;
      var isSelected = dateStr === state.selectedDate;
      var dayPlans = plans[dateStr] || [];
      var dots = dayPlans.map(function(p) {
        return '<span class="cal-day-dot" style="background:' + (p.color || PLAN_COLORS[0]) + '"></span>';
      }).join("");

      var dow = new Date(year, month, day).getDay();
      var isWeekend = dow === 0 || dow === 6;
      var holiday = getHoliday(month, day);
      var sub = holiday || (isWeekend ? (dow === 0 ? "周日" : "周六") : "");

      var cls = [
        "cal-day-cell",
        isOtherMonth ? "other-month" : "",
        isToday ? "today" : "",
        isSelected ? "selected" : "",
        isWeekend && !holiday ? "weekend" : "",
      ].filter(Boolean).join(" ");

      return '<div class="' + cls + '" data-date="' + dateStr + '">' +
        '<span class="cal-day-num">' + day + '</span>' +
        (sub ? '<span class="cal-day-sub">' + sub + '</span>' : '<span class="cal-day-sub">&nbsp;</span>') +
        (dots ? '<div class="cal-day-dots">' + dots + '</div>' : "") +
      '</div>';
    }

    function selectDate(dateStr) {
      if (!root) return;
      state.selectedDate = dateStr;
      var parts = dateStr.split("-").map(Number);
      var m = parts[1], d = parts[2];
      var dow = new Date(parts[0], m - 1, d).getDay();
      var weekDayNames = ["周日","周一","周二","周三","周四","周五","周六"];
      root.querySelector("#cal-panel-date").textContent = m + "月" + d + "日 " + weekDayNames[dow];

      var plans = loadPlans();
      var dayPlans = plans[dateStr] || [];
      var list = root.querySelector("#plan-list");
      var empty = root.querySelector("#plan-empty");

      if (dayPlans.length === 0) {
        list.innerHTML = "";
        empty.style.display = "block";
      } else {
        empty.style.display = "none";
        list.innerHTML = dayPlans.map(function(p) {
          return '<div class="plan-item ' + (p.done ? 'done' : '') + '" data-id="' + p.id + '">' +
            '<div class="plan-check" data-toggle="' + p.id + '"></div>' +
            '<div class="plan-color" style="background:' + (p.color || PLAN_COLORS[0]) + '"></div>' +
            '<div class="plan-info">' +
              '<div class="plan-title">' + esc(p.title) + '</div>' +
              (p.time ? '<div class="plan-time">' + esc(p.time) + '</div>' : "") +
            '</div>' +
            '<button class="plan-delete" data-del="' + p.id + '">&times;</button>' +
          '</div>';
        }).join("");

        list.querySelectorAll(".plan-check").forEach(function(chk) {
          chk.addEventListener("click", function(ev) { ev.stopPropagation(); togglePlan(dateStr, chk.dataset.toggle); });
        });
        list.querySelectorAll(".plan-delete").forEach(function(btn) {
          btn.addEventListener("click", function(ev) { ev.stopPropagation(); deletePlan(dateStr, btn.dataset.del); });
        });
        list.querySelectorAll(".plan-item").forEach(function(item) {
          item.addEventListener("click", function() { openPlanModal(dateStr, item.dataset.id); });
        });
      }
    }

    function showPlanEmpty() {
      if (!root) return;
      root.querySelector("#plan-list").innerHTML = "";
      root.querySelector("#plan-empty").style.display = "block";
      root.querySelector("#cal-panel-date").textContent = "";
    }

    // ── Plan CRUD ──
    function ensurePlanModal() {
      if (planModal) return;
      planModal = document.createElement("div");
      planModal.id = "cal-plan-modal";
      planModal.innerHTML =
        '<div id="cal-plan-modal-panel">' +
          '<h3 id="cal-plan-modal-title">添加计划</h3>' +
          '<div class="plan-form-row">' +
            '<label>计划内容</label>' +
            '<input id="cal-plan-input-title" type="text" placeholder="写一个计划…" maxlength="80">' +
          '</div>' +
          '<div class="plan-form-row">' +
            '<label>时间（可选）</label>' +
            '<input id="cal-plan-input-time" type="time">' +
          '</div>' +
          '<div class="plan-form-actions">' +
            '<button id="cal-plan-delete">删除</button>' +
            '<button id="cal-plan-cancel">取消</button>' +
            '<button id="cal-plan-save">保存</button>' +
          '</div>' +
        '</div>';
      planModal.style.cssText = 'display:none;position:fixed;inset:0;z-index:110;background:rgba(45,45,45,0.3);justify-content:center;align-items:flex-end;padding:18px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)';
      planModal.addEventListener("click", function(e) { if (e.target === planModal) closePlanModal(); });
      document.body.appendChild(planModal);

      document.getElementById("cal-plan-cancel").addEventListener("click", closePlanModal);
      document.getElementById("cal-plan-save").addEventListener("click", function() {
        var d = planModal.dataset.date;
        if (d) savePlan(d);
      });
      document.getElementById("cal-plan-delete").addEventListener("click", function() {
        var d = planModal.dataset.date;
        if (state.editingPlanId && d) { deletePlan(d, state.editingPlanId); closePlanModal(); }
      });
    }

    function openPlanModal(dateStr, planId) {
      ensurePlanModal();
      var plans = loadPlans();
      var existing = planId ? (plans[dateStr] || []).find(function(p) { return p.id === planId; }) : null;
      state.editingPlanId = planId || null;

      var panel = document.getElementById("cal-plan-modal-panel");
      if (panel) panel.style.cssText = 'background:var(--surface);border-radius:var(--radius-lg);padding:22px;width:100%;max-width:440px;box-shadow:var(--shadow-lg);margin-bottom:env(safe-area-inset-bottom)';

      document.getElementById("cal-plan-modal-title").textContent = existing ? "编辑计划" : "添加计划";
      document.getElementById("cal-plan-input-title").value = existing ? existing.title : "";
      document.getElementById("cal-plan-input-time").value = existing ? (existing.time || "") : "";
      document.getElementById("cal-plan-delete").style.display = existing ? "block" : "none";
      document.getElementById("cal-plan-delete").style.cssText = existing ? 'background:#fce4ec;color:#d32f2f;display:block;padding:10px 22px;border-radius:var(--radius-full);font-size:14px;font-family:var(--font-body);font-weight:600;border:none;cursor:pointer' : 'display:none';
      document.getElementById("cal-plan-cancel").style.cssText = 'background:var(--bg);color:var(--text);padding:10px 22px;border-radius:var(--radius-full);font-size:14px;font-family:var(--font-body);font-weight:600;border:none;cursor:pointer';
      document.getElementById("cal-plan-save").style.cssText = 'background:var(--accent);color:#fff;padding:10px 22px;border-radius:var(--radius-full);font-size:14px;font-family:var(--font-body);font-weight:600;border:none;cursor:pointer';

      planModal.dataset.date = dateStr;
      planModal.style.display = "flex";
      setTimeout(function() { document.getElementById("cal-plan-input-title").focus(); }, 100);
    }

    function closePlanModal() {
      if (planModal) { planModal.style.display = "none"; state.editingPlanId = null; }
    }

    function savePlan(dateStrFromModal) {
      var dateStr = dateStrFromModal || (planModal ? planModal.dataset.date : null);
      if (!dateStr) return;
      var title = document.getElementById("cal-plan-input-title").value.trim();
      if (!title) return;

      var plans = loadPlans();
      if (!plans[dateStr]) plans[dateStr] = [];

      if (state.editingPlanId) {
        var idx = plans[dateStr].findIndex(function(p) { return p.id === state.editingPlanId; });
        if (idx !== -1) {
          plans[dateStr][idx].title = title;
          plans[dateStr][idx].time = document.getElementById("cal-plan-input-time").value;
        }
      } else {
        plans[dateStr].push({
          id: "pln-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
          title: title,
          time: document.getElementById("cal-plan-input-time").value,
          done: false,
          color: PLAN_COLORS[Math.floor(Math.random() * PLAN_COLORS.length)],
          createdAt: new Date().toISOString(),
        });
      }

      plans[dateStr].sort(function(a, b) { return (a.time || "99:99").localeCompare(b.time || "99:99"); });
      savePlans(plans);
      closePlanModal();
      selectDate(dateStr); renderCalendar();
    }

    function deletePlan(dateStr, planId) {
      var plans = loadPlans();
      if (!plans[dateStr]) return;
      plans[dateStr] = plans[dateStr].filter(function(p) { return p.id !== planId; });
      if (plans[dateStr].length === 0) delete plans[dateStr];
      savePlans(plans);
      selectDate(dateStr); renderCalendar();
    }

    function togglePlan(dateStr, planId) {
      var plans = loadPlans();
      var dayPlans = plans[dateStr];
      if (!dayPlans) return;
      var p = dayPlans.find(function(p) { return p.id === planId; });
      if (p) p.done = !p.done;
      savePlans(plans);
      selectDate(dateStr); renderCalendar();
    }

    // ── Cat ──
    function setupCat() {
      if (!root) return;
      var cat = root.querySelector("#cal-cat");
      if (!cat) return;

      cat.addEventListener("click", function() {
        cat.src = "/clawd-assets/calico-mini-happy.png";
        cat.classList.add("petted");
        setTimeout(function() {
          cat.classList.remove("petted");
          cat.src = "/clawd-assets/calico-mini-sleep.png";
        }, 1000);
      });

      state._catInterval = setInterval(function() {
        var cur = window._componentRegistry && window._componentRegistry.getCurrentName && window._componentRegistry.getCurrentName();
        if (cur !== "calendar" || !cat) return;
        if (Math.random() < 0.3) {
          cat.src = "/clawd-assets/calico-mini-alert.png";
          setTimeout(function() { if (cat) cat.src = "/clawd-assets/calico-mini-sleep.png"; }, 1200);
        }
      }, 15000);
    }

    // ── Meditation Gesture removed ──

    // ── Calendar → MCP left-swipe gesture ──
    function setupCalMcpSwipe() {
      if (!root || state._mcpSwipeAdded) return;
      state._mcpSwipeAdded = true;
      var mcpHint = root.querySelector("#cal-mcp-hint");
      if (!mcpHint) return;

      var swipeStartX = 0;
      var swiping = false;
      var threshold = 60;

      root.addEventListener("touchstart", function(e) {
        swipeStartX = e.touches[0].clientX;
        swiping = true;
      }, { passive: true });

      root.addEventListener("touchmove", function(e) {
        if (!swiping) return;
        var dx = swipeStartX - e.touches[0].clientX;
        if (dx > 10) mcpHint.classList.add("pulling");
        if (dx > threshold) {
          swiping = false;
          mcpHint.classList.remove("pulling");
          if (typeof showPage === "function") showPage("mcp");
        }
      }, { passive: true });

      root.addEventListener("touchend", function() {
        swiping = false;
        mcpHint.classList.remove("pulling");
      });
    }

    // ── Bind events ──
    function bindEvents() {
      if (!root) return;
      root.querySelector("#cal-prev").addEventListener("click", function() {
        state.month--; if (state.month < 0) { state.month = 11; state.year--; }
        state.selectedDate = null; renderCalendar(); showPlanEmpty();
      });
      root.querySelector("#cal-next").addEventListener("click", function() {
        state.month++; if (state.month > 11) { state.month = 0; state.year++; }
        state.selectedDate = null; renderCalendar(); showPlanEmpty();
      });
      root.querySelector("#cal-today").addEventListener("click", function() {
        var now = new Date();
        state.year = now.getFullYear(); state.month = now.getMonth();
        state.selectedDate = formatDateStr(now.getFullYear(), now.getMonth(), now.getDate());
        renderCalendar();
      });
      root.querySelector("#cal-back-btn").addEventListener("click", function() {
        if (typeof showPage === "function") showPage("chat");
      });
      root.querySelector("#cal-add-plan").addEventListener("click", function() {
        if (!state.selectedDate) {
          var now = new Date();
          state.selectedDate = formatDateStr(now.getFullYear(), now.getMonth(), now.getDate());
        }
        openPlanModal(state.selectedDate);
      });
      root.querySelector("#plan-fab").addEventListener("click", function() {
        if (!state.selectedDate) {
          var now = new Date();
          state.selectedDate = formatDateStr(now.getFullYear(), now.getMonth(), now.getDate());
        }
        openPlanModal(state.selectedDate);
      });

      // Hub links
      var diaryBtn = root.querySelector(".cal-hub-diary");
      if (diaryBtn) diaryBtn.addEventListener("click", function() {
        if (typeof window._memoryTab !== "undefined") window._memoryTab = "diary";
        if (typeof showPage === "function") showPage("memory");
      });
    }

    // ── Public API ──
    self.mount = function() {
      // Mount is called once — render template into the container
      var container = document.getElementById("calendar-page");
      if (!container) return;
      container.innerHTML = template();
      root = container.querySelector(".calendar-root");

      bindEvents();
      setupCat();
      renderCalendar();
      state._mounted = true;
    };

    self.unmount = function() {
      if (planModal) { planModal.remove(); planModal = null; }
      if (state._catInterval) { clearInterval(state._catInterval); state._catInterval = null; }
      state._mounted = false;
      root = null;
    };

    self.show = function() {
      if (!state._mounted) self.mount();
      var container = document.getElementById("calendar-page");
      if (container) container.style.display = "flex";
      renderCalendar();
    };

    self.hide = function() {
      var container = document.getElementById("calendar-page");
      if (container) container.style.display = "";
    };

    self.destroy = function() {
      self.unmount();
      var container = document.getElementById("calendar-page");
      if (container) container.innerHTML = "";
    };

    // Expose tokens for tweak panel
    self.tokens = {
      component: "calendar",
      tokens: null,  // loaded async from tokens.json
    };
  }

  // ── Register ──
  var comp = new createCalendarComponent();

  // 异步加载 tokens
  fetch("/components/calendar/tokens.json")
    .then(function(r) { return r.json(); })
    .then(function(data) { comp.tokens = data; })
    .catch(function() {});

  if (window._componentRegistry) {
    window._componentRegistry.register("calendar", comp);
  }

  // 暴露 showPage 可调用的入口
  window._calendarComponent = comp;
})();
