/* ── Bubble Tea Component ── */
(function() {
  var SUGAR_OPTIONS = ["", "全糖", "七分糖", "五分糖", "三分糖", "无糖"];
  var ICE_OPTIONS = ["", "正常冰", "少冰", "去冰", "常温", "热"];
  var TOPPING_OPTIONS = ["珍珠", "脆波波", "椰果", "奶盖", "仙草", "红豆", "芋泥", "布丁", "冰淇淋", "奥利奥"];

  function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  function formatDateStr(year, month, day) {
    return year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  }

  function createBubbleTeaComponent() {
    var self = this;
    var root = null;
    var state = {
      year: new Date().getFullYear(),
      month: new Date().getMonth(),
      selectedDate: null,
      records: [],
      _mounted: false
    };
    var modalOverlay = null;

    // ── icon: single point to swap later ──
    function teaIcon() { return "🧋"; }

    // ── API ──
    function fetchRecords() {
      var days = 180;
      return fetch("/api/bubbletea?days=" + days)
        .then(function(r) { return r.ok ? r.json() : []; })
        .catch(function() { return []; });
    }

    function saveRecord(data) {
      return fetch("/api/bubbletea", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      }).then(function(r) { return r.ok ? r.json() : null; });
    }

    // ── Template ──
    function template() {
      return '<div class="bt-root">' +
        '<header class="bt-header">' +
          '<button id="bt-back-btn" title="返回">←</button>' +
          '<h1>奶茶记录</h1>' +
          '<button class="bt-add-btn" id="bt-add-btn" title="添加奶茶">+</button>' +
        '</header>' +
        '<div class="bt-body">' +
          '<div class="bt-cal">' +
            '<div class="bt-cal-nav">' +
              '<button id="bt-prev">◀</button>' +
              '<span class="bt-cal-month" id="bt-cal-month"></span>' +
              '<button id="bt-next">▶</button>' +
            '</div>' +
            '<div class="bt-cal-weekdays">' +
              '<span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>' +
            '</div>' +
            '<div class="bt-cal-grid" id="bt-cal-grid"></div>' +
          '</div>' +
          '<div class="bt-day-panel" id="bt-day-panel">' +
            '<div class="bt-day-header">' +
              '<span class="bt-day-date" id="bt-day-date">选一个日期</span>' +
            '</div>' +
            '<div id="bt-tea-list"></div>' +
          '</div>' +
          '<div class="bt-stats" id="bt-stats"></div>' +
        '</div>' +
      '</div>';
    }

    // ── Render calendar ──
    function renderCalendar() {
      if (!root) return;
      var today = new Date();
      var todayStr = formatDateStr(today.getFullYear(), today.getMonth(), today.getDate());
      root.querySelector("#bt-cal-month").textContent = state.year + "年" + (state.month + 1) + "月";

      var grid = root.querySelector("#bt-cal-grid");
      var firstDay = new Date(state.year, state.month, 1).getDay();
      var daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
      var daysInPrev = new Date(state.year, state.month, 0).getDate();

      // Build tea date set
      var teaDates = {};
      for (var i = 0; i < state.records.length; i++) {
        teaDates[state.records[i].date] = true;
      }

      var html = "";
      // prev month tail
      for (var i = firstDay - 1; i >= 0; i--) {
        var d = daysInPrev - i;
        html += renderCell(state.year, state.month - 1, d, true, todayStr, teaDates);
      }
      // current month
      for (var dd = 1; dd <= daysInMonth; dd++) {
        html += renderCell(state.year, state.month, dd, false, todayStr, teaDates);
      }
      // next month head
      var total = firstDay + daysInMonth;
      var rem = total % 7 === 0 ? 0 : 7 - (total % 7);
      for (var rr = 1; rr <= rem; rr++) {
        html += renderCell(state.year, state.month + 1, rr, true, todayStr, teaDates);
      }
      grid.innerHTML = html;

      grid.querySelectorAll(".bt-cal-cell").forEach(function(cell) {
        cell.addEventListener("click", function() {
          var ds = cell.dataset.date;
          if (!ds || cell.classList.contains("other-month")) return;
          state.selectedDate = ds;
          renderCalendar();
          renderDayPanel();
        });
      });
    }

    function renderCell(year, month, day, other, todayStr, teaDates) {
      var dateStr = formatDateStr(year, month, day);
      var cls = ["bt-cal-cell"];
      if (other) cls.push("other-month");
      if (dateStr === todayStr) cls.push("today");
      if (dateStr === state.selectedDate) cls.push("selected");
      var hasTea = teaDates[dateStr];
      if (hasTea) cls.push("has-tea");
      return '<div class="' + cls.join(" ") + '" data-date="' + dateStr + '">' +
        '<span class="bt-date-num">' + day + '</span>' +
        (hasTea ? '<span class="bt-tea-dot">' + teaIcon() + '</span>' : '') +
      '</div>';
    }

    // ── Render day panel ──
    function renderDayPanel() {
      if (!root) return;
      if (!state.selectedDate) {
        root.querySelector("#bt-day-date").textContent = "选一个日期";
        root.querySelector("#bt-tea-list").innerHTML = '<div class="bt-day-empty">👆 点击日历上的日期查看奶茶</div>';
        return;
      }

      var parts = state.selectedDate.split("-").map(Number);
      var dow = new Date(parts[0], parts[1] - 1, parts[2]).getDay();
      var weekNames = ["周日","周一","周二","周三","周四","周五","周六"];
      root.querySelector("#bt-day-date").textContent = parts[1] + "月" + parts[2] + "日 " + weekNames[dow];

      var dayRecords = state.records.filter(function(r) { return r.date === state.selectedDate; });
      var list = root.querySelector("#bt-tea-list");

      if (!dayRecords.length) {
        list.innerHTML = '<div class="bt-day-empty">这天还没喝奶茶~<br>点右上角 + 添加</div>';
        return;
      }

      list.innerHTML = '<div class="bt-tea-list">' + dayRecords.map(renderTeaCard).join("") + '</div>';
    }

    function renderTeaCard(r) {
      var stars = r.rating > 0 ? "⭐".repeat(Math.min(r.rating, 5)) : "";
      var tags = [];
      if (r.sugar) tags.push('<span class="bt-tea-tag">' + esc(r.sugar) + '</span>');
      if (r.ice) tags.push('<span class="bt-tea-tag green">' + esc(r.ice) + '</span>');
      if (r.toppings && r.toppings.length) {
        for (var t = 0; t < r.toppings.length; t++) {
          tags.push('<span class="bt-tea-tag green">' + esc(r.toppings[t]) + '</span>');
        }
      }

      return '<div class="bt-tea-card">' +
        '<div class="bt-tea-icon">' + teaIcon() + '</div>' +
        '<div class="bt-tea-info">' +
          '<div class="bt-tea-title">' + (r.brand ? esc(r.brand) + " · " : "") + esc(r.name) + '</div>' +
          (tags.length ? '<div class="bt-tea-meta">' + tags.join("") + '</div>' : '') +
          (stars ? '<div class="bt-tea-rating">' + stars + '</div>' : '') +
          (r.notes ? '<div class="bt-tea-notes">' + esc(r.notes) + '</div>' : '') +
        '</div>' +
        (r.time ? '<div class="bt-tea-time">' + esc(r.time) + '</div>' : '') +
      '</div>';
    }

    // ── Stats ──
    function renderStats() {
      if (!root) return;
      var now = new Date();
      var thisMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
      var monthCount = 0;
      var totalCount = state.records.length;
      for (var i = 0; i < state.records.length; i++) {
        if ((state.records[i].date || "").startsWith(thisMonth)) monthCount++;
      }
      root.querySelector("#bt-stats").innerHTML =
        '<span>本月 <strong>' + monthCount + '</strong> 杯</span>' +
        '<span>总共 <strong>' + totalCount + '</strong> 杯</span>';
    }

    // ── Add modal ──
    function openModal() {
      if (!modalOverlay) createModal();
      modalOverlay.classList.add("show");
      modalOverlay.querySelector("#bt-form-date").value = state.selectedDate || formatDateStr(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
      modalOverlay.querySelector("#bt-form-time").value = "";
      modalOverlay.querySelector("#bt-form-brand").value = "";
      modalOverlay.querySelector("#bt-form-name").value = "";
      modalOverlay.querySelector("#bt-form-sugar").value = "";
      modalOverlay.querySelector("#bt-form-ice").value = "";
      modalOverlay.querySelector("#bt-form-toppings").value = "";
      modalOverlay.querySelector("#bt-form-rating").value = "0";
      modalOverlay.querySelector("#bt-form-notes").value = "";
      modalOverlay.querySelector("#bt-form-name").focus();
    }

    function closeModal() {
      if (modalOverlay) modalOverlay.classList.remove("show");
    }

    function createModal() {
      modalOverlay = document.createElement("div");
      modalOverlay.className = "bt-modal-overlay";
      modalOverlay.addEventListener("click", function(e) { if (e.target === modalOverlay) closeModal(); });

      var sugarOpts = SUGAR_OPTIONS.map(function(s) { return '<option value="' + s + '">' + (s || "糖度（可选）") + '</option>'; }).join("");
      var iceOpts = ICE_OPTIONS.map(function(s) { return '<option value="' + s + '">' + (s || "冰量（可选）") + '</option>'; }).join("");

      modalOverlay.innerHTML =
        '<div class="bt-modal">' +
          '<h3>🧋 记录一杯奶茶</h3>' +
          '<div class="bt-form-row">' +
            '<label>日期</label>' +
            '<input id="bt-form-date" type="date">' +
          '</div>' +
          '<div class="bt-form-row">' +
            '<label>时间（可选）</label>' +
            '<input id="bt-form-time" type="time">' +
          '</div>' +
          '<div class="bt-form-inline">' +
            '<div class="bt-form-row"><label>品牌</label><input id="bt-form-brand" type="text" placeholder="喜茶/霸王茶姬…" maxlength="30"></div>' +
            '<div class="bt-form-row"><label>饮品名 *</label><input id="bt-form-name" type="text" placeholder="多肉葡萄…" maxlength="40" required></div>' +
          '</div>' +
          '<div class="bt-form-inline">' +
            '<div class="bt-form-row"><label>糖度</label><select id="bt-form-sugar">' + sugarOpts + '</select></div>' +
            '<div class="bt-form-row"><label>冰量</label><select id="bt-form-ice">' + iceOpts + '</select></div>' +
          '</div>' +
          '<div class="bt-form-row">' +
            '<label>小料（逗号分隔）</label>' +
            '<input id="bt-form-toppings" type="text" placeholder="珍珠, 脆波波…" maxlength="60">' +
            '<div style="font-size:11px;color:var(--bt-text-muted);margin-top:4px;">常用: ' + TOPPING_OPTIONS.join(" / ") + '</div>' +
          '</div>' +
          '<div class="bt-form-row">' +
            '<label>评分</label>' +
            '<select id="bt-form-rating">' +
              '<option value="0">未评分</option>' +
              '<option value="1">⭐ 1</option><option value="2">⭐ 2</option>' +
              '<option value="3">⭐ 3</option><option value="4">⭐ 4</option>' +
              '<option value="5">⭐ 5</option>' +
            '</select>' +
          '</div>' +
          '<div class="bt-form-row">' +
            '<label>备注</label>' +
            '<textarea id="bt-form-notes" placeholder="好喝吗？有什么想记的…" maxlength="200"></textarea>' +
          '</div>' +
          '<div class="bt-form-actions">' +
            '<button class="bt-form-cancel" id="bt-form-cancel">取消</button>' +
            '<button class="bt-form-save" id="bt-form-save">保存</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(modalOverlay);

      modalOverlay.querySelector("#bt-form-cancel").addEventListener("click", closeModal);
      modalOverlay.querySelector("#bt-form-save").addEventListener("click", submitRecord);
    }

    function submitRecord() {
      if (!modalOverlay) return;
      var date = modalOverlay.querySelector("#bt-form-date").value.trim();
      var name = modalOverlay.querySelector("#bt-form-name").value.trim();
      if (!date || !name) return;

      var toppingsRaw = modalOverlay.querySelector("#bt-form-toppings").value.trim();
      var toppings = toppingsRaw ? toppingsRaw.split(/[,，、]/).map(function(s) { return s.trim(); }).filter(Boolean) : [];

      var data = {
        date: date,
        time: modalOverlay.querySelector("#bt-form-time").value,
        brand: modalOverlay.querySelector("#bt-form-brand").value.trim(),
        name: name,
        sugar: modalOverlay.querySelector("#bt-form-sugar").value,
        ice: modalOverlay.querySelector("#bt-form-ice").value,
        toppings: toppings,
        rating: Number(modalOverlay.querySelector("#bt-form-rating").value) || 0,
        notes: modalOverlay.querySelector("#bt-form-notes").value.trim(),
        recordedBy: "toge"
      };

      saveRecord(data).then(function(record) {
        if (record) {
          state.records.push(record);
          state.records.sort(function(a, b) {
            return (b.date + (b.time || "99:99")).localeCompare(a.date + (a.time || "99:99"));
          });
          state.selectedDate = date;
          state.year = Number(date.split("-")[0]);
          state.month = Number(date.split("-")[1]) - 1;
          closeModal();
          renderCalendar();
          renderDayPanel();
          renderStats();
        }
      });
    }

    // ── Bind events ──
    function bindEvents() {
      if (!root) return;
      root.querySelector("#bt-back-btn").addEventListener("click", function() {
        if (typeof showPage === "function") showPage("chat");
      });
      root.querySelector("#bt-add-btn").addEventListener("click", openModal);
      root.querySelector("#bt-prev").addEventListener("click", function() {
        state.month--;
        if (state.month < 0) { state.month = 11; state.year--; }
        state.selectedDate = null;
        renderCalendar();
        renderDayPanel();
      });
      root.querySelector("#bt-next").addEventListener("click", function() {
        state.month++;
        if (state.month > 11) { state.month = 0; state.year++; }
        state.selectedDate = null;
        renderCalendar();
        renderDayPanel();
      });
    }

    // ── Public API ──
    self.mount = function() {
      var container = document.getElementById("bubbletea-page");
      if (!container) return;
      container.innerHTML = template();
      root = container.querySelector(".bt-root");
      bindEvents();
      state._mounted = true;
    };

    self.show = function() {
      if (!state._mounted) self.mount();
      var container = document.getElementById("bubbletea-page");
      if (container) container.classList.add("show");
      // Load records and render
      fetchRecords().then(function(records) {
        state.records = records || [];
        if (!state.selectedDate) {
          var now = new Date();
          state.selectedDate = formatDateStr(now.getFullYear(), now.getMonth(), now.getDate());
        }
        renderCalendar();
        renderDayPanel();
        renderStats();
      });
    };

    self.hide = function() {
      var container = document.getElementById("bubbletea-page");
      if (container) container.classList.remove("show");
    };

    self.unmount = function() {
      if (modalOverlay) { modalOverlay.remove(); modalOverlay = null; }
      state._mounted = false;
      root = null;
    };

    self.destroy = function() {
      self.unmount();
      var container = document.getElementById("bubbletea-page");
      if (container) container.innerHTML = "";
    };

    self.tokens = {
      component: "bubbletea",
      tokens: null
    };
  }

  // ── Register ──
  var comp = new createBubbleTeaComponent();

  fetch("/components/bubbletea/tokens.json")
    .then(function(r) { return r.json(); })
    .then(function(data) { comp.tokens = data; })
    .catch(function() {});

  if (window._componentRegistry) {
    window._componentRegistry.register("bubbletea", comp);
  }

  window._bubbleTeaComponent = comp;
})();
