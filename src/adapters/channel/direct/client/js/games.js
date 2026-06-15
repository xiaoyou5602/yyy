/* ── Mini Games ── */
(function () {
  "use strict";
  var currentGame = "wheel";
  var STORAGE_KEY = "withtoge-games";
  var spinning = false;
  var rolling = false;
  var flipping = false;
  var rollingNum = false;
  var wheelAngle = 0;

  /* ── Settings ── */
  var settings = {
    wheel: { speed: 3, options: ["🎁 奖品 A", "🍀 奖品 B", "✨ 奖品 C", "🎈 奖品 D", "🪐 奖品 E", "💎 奖品 F"], weights: [] },
    dice: { faces: 6, count: 1 },
    coin: { count: 1 },
    random: { min: 1, max: 100 }
  };

  function loadSettings() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved) {
        if (saved.wheel) settings.wheel = Object.assign({}, settings.wheel, saved.wheel);
        if (saved.dice) settings.dice = Object.assign({}, settings.dice, saved.dice);
        if (saved.coin) settings.coin = Object.assign({}, settings.coin, saved.coin);
        if (saved.random) settings.random = Object.assign({}, settings.random, saved.random);
      }
    } catch (e) {}
  }

  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) {}
  }

  /* ── Tab switching ── */
  function switchGameTab(game) {
    currentGame = game;
    var tabs = document.querySelectorAll(".games-tab");
    tabs.forEach(function (t) { t.classList.toggle("active", t.dataset.game === game); });
    var panels = document.querySelectorAll(".game-panel");
    panels.forEach(function (p) { p.classList.toggle("active", false); });
    var target = document.getElementById("game-" + game);
    if (target) target.classList.add("active");
    if (game === "wheel") initWheel();
    if (game === "dice") initDice();
    if (game === "coin") initCoin();
    if (game === "random") initRandom();
  }

  /* ═══════════════════ DICE ═══════════════════ */
  var diceResultEl, diceStageEl, diceRollBtn;

  function initDice() {
    diceStageEl = document.getElementById("dice-stage");
    diceResultEl = document.getElementById("dice-result");
    diceRollBtn = document.getElementById("dice-roll-btn");
    renderDiceControls();
    drawDice();
  }

  function drawDice(faceValues) {
    if (!diceStageEl) return;
    var html = '<div class="dice-row">';
    for (var i = 0; i < settings.dice.count; i++) {
      var face = faceValues ? faceValues[i] : 1;
      html += '<div class="die" id="die-' + i + '">' + renderDieFace(face, settings.dice.faces) + '</div>';
    }
    html += '</div>';
    diceStageEl.innerHTML = html;
  }

  function renderDieFace(face, maxFaces) {
    // For standard d6, use dot pattern; for others, show number
    if (maxFaces === 6) {
      var dots = {
        1: [4], 2: [2,6], 3: [2,4,6], 4: [0,2,6,8],
        5: [0,2,4,6,8], 6: [0,2,3,5,6,8]
      };
      var positions = dots[face] || [4];
      var html = '';
      for (var i = 0; i < 9; i++) {
        html += '<div class="dot"' + (positions.indexOf(i) === -1 ? ' style="opacity:0"' : '') + '></div>';
      }
      return html;
    }
    // Number display for non-standard dice
    return '<div style="grid-column:1/4;grid-row:1/4;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;font-family:var(--font-body)">' + face + '</div>';
  }

  function rollDice() {
    if (rolling) return;
    rolling = true;
    diceRollBtn.disabled = true;
    diceResultEl.textContent = "";

    // Pre-compute results
    var results = [];
    for (var i = 0; i < settings.dice.count; i++) {
      results.push(Math.floor(Math.random() * settings.dice.faces) + 1);
    }

    // Animate shaking
    var dieEls = [];
    for (var i2 = 0; i2 < settings.dice.count; i2++) {
      dieEls.push(document.getElementById("die-" + i2));
    }
    dieEls.forEach(function (el) { if (el) el.classList.add("rolling"); });

    // Rapid face changes during shake
    var startTime = Date.now();
    var duration = 800;
    var tick = setInterval(function () {
      var elapsed = Date.now() - startTime;
      if (elapsed >= duration) {
        clearInterval(tick);
        dieEls.forEach(function (el) { if (el) el.classList.remove("rolling"); });
        drawDice(results);
        var total = results.reduce(function (a, b) { return a + b; }, 0);
        var resultStr = results.join(" + ");
        if (settings.dice.count > 1) resultStr += " = " + total;
        diceResultEl.textContent = resultStr;
        rolling = false;
        diceRollBtn.disabled = false;
        return;
      }
      drawDice(settings.dice.count === 1 ? [Math.floor(Math.random() * settings.dice.faces) + 1] : undefined);
      if (settings.dice.count > 1) {
        for (var i3 = 0; i3 < settings.dice.count; i3++) {
          var el = document.getElementById("die-" + i3);
          if (el) el.innerHTML = renderDieFace(Math.floor(Math.random() * settings.dice.faces) + 1, settings.dice.faces);
        }
      }
    }, 60);
  }

  function renderDiceControls() {
    var ctrl = document.querySelector("#dice-controls .game-controls-body");
    if (!ctrl) return;
    ctrl.innerHTML =
      '<label>面数 <select id="dice-faces">' +
      '<option value="4"' + (settings.dice.faces === 4 ? " selected" : "") + '>d4</option>' +
      '<option value="6"' + (settings.dice.faces === 6 ? " selected" : "") + '>d6</option>' +
      '<option value="8"' + (settings.dice.faces === 8 ? " selected" : "") + '>d8</option>' +
      '<option value="10"' + (settings.dice.faces === 10 ? " selected" : "") + '>d10</option>' +
      '<option value="12"' + (settings.dice.faces === 12 ? " selected" : "") + '>d12</option>' +
      '<option value="20"' + (settings.dice.faces === 20 ? " selected" : "") + '>d20</option>' +
      '</select></label>' +
      '<label>个数 <input type="number" id="dice-count" value="' + settings.dice.count + '" min="1" max="10" step="1"></label>';
    document.getElementById("dice-faces").addEventListener("change", function () {
      settings.dice.faces = parseInt(this.value);
      saveSettings(); drawDice(); diceResultEl.textContent = "";
    });
    document.getElementById("dice-count").addEventListener("change", function () {
      var v = Math.max(1, Math.min(10, parseInt(this.value) || 1));
      this.value = v; settings.dice.count = v;
      saveSettings(); drawDice(); diceResultEl.textContent = "";
    });
  }

  /* ═══════════════════ COIN ═══════════════════ */
  var coinEl, coinResultEl, coinFlipBtn;

  function initCoin() {
    coinEl = document.getElementById("coin-el");
    coinResultEl = document.getElementById("coin-result");
    coinFlipBtn = document.getElementById("coin-flip-btn");
    renderCoinControls();
  }

  function flipCoin() {
    if (flipping || !coinEl) return;
    flipping = true;
    coinFlipBtn.disabled = true;
    coinResultEl.textContent = "";

    // Determine results
    var results = [];
    for (var i = 0; i < settings.coin.count; i++) {
      results.push(Math.random() < 0.5 ? "正面" : "反面");
    }

    // Animate
    coinEl.classList.add("flipping");
    coinEl.addEventListener("animationend", function handler() {
      coinEl.removeEventListener("animationend", handler);
      coinEl.classList.remove("flipping");
      if (settings.coin.count === 1) {
        coinResultEl.textContent = results[0];
      } else {
        var heads = results.filter(function (r) { return r === "正面"; }).length;
        coinResultEl.textContent = results.join(" · ") + "  (" + heads + "正 " + (results.length - heads) + "反)";
      }
      flipping = false;
      coinFlipBtn.disabled = false;
    }, { once: true });
  }

  function renderCoinControls() {
    var ctrl = document.querySelector("#coin-controls .game-controls-body");
    if (!ctrl) return;
    ctrl.innerHTML =
      '<label>个数 <input type="number" id="coin-count" value="' + settings.coin.count + '" min="1" max="10" step="1"></label>';
    document.getElementById("coin-count").addEventListener("change", function () {
      var v = Math.max(1, Math.min(10, parseInt(this.value) || 1));
      this.value = v; settings.coin.count = v;
      saveSettings(); coinResultEl.textContent = "";
    });
  }

  /* ═══════════════════ RANDOM ═══════════════════ */
  var randomDisplay, randomResultEl, randomRollBtn;
  var randomHistory = [];

  function initRandom() {
    randomDisplay = document.getElementById("random-display");
    randomResultEl = document.getElementById("random-result");
    randomRollBtn = document.getElementById("random-roll-btn");
    renderRandomControls();
    renderRandomHistory();
  }

  function generateRandom() {
    if (rollingNum) return;
    rollingNum = true;
    randomRollBtn.disabled = true;
    randomResultEl.textContent = "";

    var result = Math.floor(Math.random() * (settings.random.max - settings.random.min + 1)) + settings.random.min;
    randomDisplay.textContent = result;
    randomDisplay.classList.add("rolling");

    // Animate rolling digits
    var startTime = Date.now();
    var duration = 1000;
    var tick = setInterval(function () {
      var elapsed = Date.now() - startTime;
      if (elapsed >= duration) {
        clearInterval(tick);
        randomDisplay.classList.remove("rolling");
        randomDisplay.textContent = result;
        randomResultEl.textContent = "区间 " + settings.random.min + " - " + settings.random.max;
        rollingNum = false;
        randomRollBtn.disabled = false;
        randomHistory.unshift(result);
        if (randomHistory.length > 5) randomHistory.pop();
        renderRandomHistory();
        return;
      }
      var r = Math.floor(Math.random() * (settings.random.max - settings.random.min + 1)) + settings.random.min;
      randomDisplay.textContent = r;
    }, 50);
  }

  function renderRandomHistory() {
    var el = document.getElementById("random-history");
    if (!el) {
      el = document.createElement("div");
      el.className = "random-history";
      el.id = "random-history";
      var stage = document.querySelector("#game-random .game-stage");
      if (stage) stage.parentNode.insertBefore(el, randomResultEl);
    }
    el.innerHTML = randomHistory.map(function (n) { return "<span>" + n + "</span>"; }).join("");
  }

  function renderRandomControls() {
    var ctrl = document.querySelector("#random-controls .game-controls-body");
    if (!ctrl) return;
    ctrl.innerHTML =
      '<div class="ctrl-row"><span class="ctrl-label">最小值</span><input type="number" id="random-min" value="' + settings.random.min + '" step="1"></div>' +
      '<div class="ctrl-row"><span class="ctrl-label">最大值</span><input type="number" id="random-max" value="' + settings.random.max + '" step="1"></div>';
    document.getElementById("random-min").addEventListener("change", function () {
      settings.random.min = parseInt(this.value) || 0;
      if (settings.random.min >= settings.random.max) settings.random.max = settings.random.min + 1;
      document.getElementById("random-max").value = settings.random.max;
      saveSettings(); randomResultEl.textContent = "";
    });
    document.getElementById("random-max").addEventListener("change", function () {
      settings.random.max = parseInt(this.value) || 1;
      if (settings.random.max <= settings.random.min) settings.random.min = settings.random.max - 1;
      document.getElementById("random-min").value = settings.random.min;
      saveSettings(); randomResultEl.textContent = "";
    });
  }

  /* ═══════════════════ WHEEL ═══════════════════ */
  var wheelCanvas, wheelResultEl, wheelSpinBtn;

  function initWheel() {
    wheelCanvas = document.getElementById("wheel-canvas");
    wheelResultEl = document.getElementById("wheel-result");
    wheelSpinBtn = document.getElementById("wheel-spin-btn");
    drawWheel();
    renderWheelControls();
  }

  function drawWheel() {
    if (!wheelCanvas) return;
    var opts = settings.wheel.options.filter(function (o) { return o.trim(); });
    if (opts.length === 0) {
      opts = ["选项 1", "选项 2"];
      settings.wheel.options = opts;
    }
    var dpr = window.devicePixelRatio || 1;
    var size = Math.min(280, wheelCanvas.parentElement.clientWidth || 280);
    wheelCanvas.style.width = size + "px";
    wheelCanvas.style.height = size + "px";
    wheelCanvas.width = size * dpr;
    wheelCanvas.height = size * dpr;
    var ctx = wheelCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var cx = size / 2, cy = size / 2, r = size / 2 - 4;
    var weights = settings.wheel.weights || [];
    var totalWeight = 0;
    var hasWeights = weights.length === opts.length && weights.some(function (w) { return w > 0; });
    if (hasWeights) {
      totalWeight = weights.reduce(function (a, b) { return a + b; }, 0);
    }

    var colors = ["#E85D3F", "#5B7FFF", "#FFB347", "#69D15A", "#FF6B9D", "#4ECDC4", "#FFD93D", "#C084FC", "#0EA5E9", "#F97316", "#8B5CF6", "#10B981"];

    var startAngle = wheelAngle;
    for (var i = 0; i < opts.length; i++) {
      var sliceAngle;
      if (hasWeights) {
        sliceAngle = (weights[i] / totalWeight) * Math.PI * 2;
      } else {
        sliceAngle = (Math.PI * 2) / opts.length;
      }
      var endAngle = startAngle + sliceAngle;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      ctx.strokeStyle = "var(--surface)"; // fallback
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label
      var midAngle = startAngle + sliceAngle / 2;
      var labelR = r * 0.62;
      var tx = cx + Math.cos(midAngle) * labelR;
      var ty = cy + Math.sin(midAngle) * labelR;
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(midAngle + Math.PI / 2);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 11px " + getComputedStyle(document.body).getPropertyValue("--font-body").trim();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      var label = opts[i];
      if (label.length > 6) label = label.substring(0, 5) + "…";
      ctx.fillText(label, 0, 0);
      ctx.restore();

      startAngle = endAngle;
    }

    // Center circle
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = "var(--border)";
    ctx.strokeStyle = "#E8E4DE";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function spinWheel() {
    if (spinning) return;
    spinning = true;
    wheelSpinBtn.disabled = true;
    wheelResultEl.textContent = "";

    var opts = settings.wheel.options.filter(function (o) { return o.trim(); });
    var weights = settings.wheel.weights || [];
    var hasWeights = weights.length === opts.length && weights.some(function (w) { return w > 0; });
    var totalWeight = hasWeights ? weights.reduce(function (a, b) { return a + b; }, 0) : opts.length;

    // Determine winning index based on weights
    var rand = Math.random() * (hasWeights ? totalWeight : opts.length);
    var acc = 0;
    var winIdx = 0;
    for (var i = 0; i < opts.length; i++) {
      acc += hasWeights ? weights[i] : 1;
      if (rand <= acc) { winIdx = i; break; }
    }

    // Calculate target angle: pointer is at top (12 o'clock = -PI/2)
    // We want the winning slice's center at top
    var targetSliceCenter = 0;
    for (var j = 0; j < winIdx; j++) {
      targetSliceCenter += hasWeights ? (weights[j] / totalWeight) * Math.PI * 2 : (Math.PI * 2) / opts.length;
    }
    var sliceAngle = hasWeights ? (weights[winIdx] / totalWeight) * Math.PI * 2 : (Math.PI * 2) / opts.length;
    targetSliceCenter += sliceAngle / 2;

    // Spin multiple full rotations + land on target
    var speed = settings.wheel.speed || 3;
    var extraRotations = (3 + Math.random() * 2) * Math.PI * 2;
    var targetAngle = wheelAngle + extraRotations + (Math.PI * 2 - targetSliceCenter % (Math.PI * 2));
    targetAngle = targetAngle % (Math.PI * 2);

    var startAngle = wheelAngle;
    var totalDelta = targetAngle - startAngle;
    // Ensure it's the shorter direction with enough spin
    while (totalDelta < Math.PI * 6) totalDelta += Math.PI * 2;

    var startTime = null;
    var duration = 3000 + speed * 500;

    function animate(ts) {
      if (!startTime) startTime = ts;
      var elapsed = ts - startTime;
      var progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      var eased = 1 - Math.pow(1 - progress, 3);
      wheelAngle = startAngle + totalDelta * eased;
      drawWheel();
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Done
        wheelAngle = wheelAngle % (Math.PI * 2);
        drawWheel();
        wheelResultEl.textContent = "🎯 " + opts[winIdx];
        spinning = false;
        wheelSpinBtn.disabled = false;
      }
    }
    requestAnimationFrame(animate);
  }

  function renderWheelControls() {
    var ctrl = document.querySelector("#wheel-controls .game-controls-body");
    if (!ctrl) return;
    var optsText = settings.wheel.options.join("\n");
    var speed = settings.wheel.speed || 3;
    ctrl.innerHTML =
      '<label>选项（每行一个）</label>' +
      '<textarea id="wheel-options" rows="5">' + optsText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + '</textarea>' +
      '<label>旋转速度 <input type="range" id="wheel-speed" min="1" max="10" value="' + speed + '"><span id="speed-val">' + speed + '</span></label>' +
      '<label>权重（每行一个数字，留空则均等）</label>' +
      '<textarea id="wheel-weights" rows="3" placeholder="留空 = 均等权重">' + (settings.wheel.weights || []).join("\n") + '</textarea>';

    document.getElementById("wheel-options").addEventListener("input", function () {
      settings.wheel.options = this.value.split("\n");
      saveSettings(); drawWheel(); wheelResultEl.textContent = "";
    });
    document.getElementById("wheel-speed").addEventListener("input", function () {
      settings.wheel.speed = parseInt(this.value);
      document.getElementById("speed-val").textContent = this.value;
      saveSettings();
    });
    document.getElementById("wheel-weights").addEventListener("input", function () {
      var lines = this.value.split("\n").filter(function (l) { return l.trim(); });
      settings.wheel.weights = lines.map(function (l) { return parseFloat(l) || 0; });
      saveSettings(); drawWheel();
    });
  }

  /* ── Bind tab clicks ── */
  function bindTabs() {
    var tabs = document.querySelectorAll(".games-tab");
    tabs.forEach(function (t) {
      t.addEventListener("click", function () { switchGameTab(this.dataset.game); });
    });
  }

  /* ── Public init ── */
  var _binded = false;
  window.initGames = function () {
    bindTabs();
    loadSettings();
    switchGameTab(currentGame);

    if (_binded) return;
    _binded = true;

    var wheelBtn = document.getElementById("wheel-spin-btn");
    if (wheelBtn) wheelBtn.addEventListener("click", spinWheel);

    var diceBtn = document.getElementById("dice-roll-btn");
    if (diceBtn) diceBtn.addEventListener("click", rollDice);

    var coinBtn = document.getElementById("coin-flip-btn");
    if (coinBtn) coinBtn.addEventListener("click", flipCoin);

    var randomBtn = document.getElementById("random-roll-btn");
    if (randomBtn) randomBtn.addEventListener("click", generateRandom);
  };
})();
