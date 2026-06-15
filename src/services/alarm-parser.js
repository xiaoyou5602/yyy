const TIMEZONE_OFFSET = "+08:00";

// Map Chinese number words to digits
const CN_NUM = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

const DAY_PERIOD = {
  早上: 0, 上午: 0, 中午: 12,
  下午: 12, 傍晚: 12, 晚上: 12, 半夜: 0, 凌晨: 0,
};

const WEEKDAY_CN = {
  周一: 1, 周二: 2, 周三: 3, 周四: 4, 周五: 5, 周六: 6, 周日: 7, 星期天: 7,
  星期一: 1, 星期二: 2, 星期三: 3, 星期四: 4, 星期五: 5, 星期六: 6, 星期日: 7,
};

const MSG_TRIGGERS = /(?:叫|喊|提醒|提个醒)(?:我|一下)?[：:]?(.*?)$/;
const ACTION_VERBS = /(?:起床|起来|醒|上课|开会|出门|吃饭|睡觉|下班|去|走|出发)$/;

/**
 * Parse Chinese natural language alarm request.
 * Returns { hour, minute, msg, dueAtMs, error }
 *
 * Examples:
 *   "明天11点叫我"          → tomorrow 11:00
 *   "下午3点半提醒我开会"    → today 15:30, msg: "开会"
 *   "20分钟后"              → now + 20min
 *   "后天早上8点起床"        → day after tomorrow 08:00, msg: "起床"
 *   "每天8点"              → next 08:00 occurrence
 *   "周一早上9点"           → next Monday 09:00
 */
function parseAlarm(input) {
  const raw = String(input || "").trim();
  if (!raw) return { error: "空的闹钟请求" };

  // ── Phase 1: extract date ──
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let targetDate = null;
  let remaining = raw;

  // "每天" recurring → treat as today (next occurrence logic handles it)
  const isDaily = /^每天/.test(remaining);
  if (isDaily) remaining = remaining.slice(2);

  // "明天" / "后天" / "今天"
  const dayShift = { 今天: 0, 明天: 1, 后天: 2, 大后天: 3 };
  for (const [word, shift] of Object.entries(dayShift)) {
    if (remaining.includes(word)) {
      targetDate = new Date(today);
      targetDate.setDate(today.getDate() + shift);
      remaining = remaining.replace(word, "");
      break;
    }
  }

  // Weekday: "周一" / "星期三" etc.
  if (!targetDate) {
    for (const [word, dow] of Object.entries(WEEKDAY_CN)) {
      if (remaining.includes(word)) {
        targetDate = new Date(today);
        const todayDow = today.getDay() || 7; // Sunday = 7
        let diff = dow - todayDow;
        if (diff <= 0) diff += 7;
        targetDate.setDate(today.getDate() + diff);
        remaining = remaining.replace(word, "");
        break;
      }
    }
  }

  // Specific date: "5月30号" / "5/30"
  if (!targetDate) {
    const dateMatch = remaining.match(/(\d{1,2})月(\d{1,2})[号日]/);
    if (dateMatch) {
      targetDate = new Date(now.getFullYear(), parseInt(dateMatch[1]) - 1, parseInt(dateMatch[2]));
      if (targetDate < today) targetDate.setFullYear(targetDate.getFullYear() + 1);
      remaining = remaining.replace(dateMatch[0], "");
    }
  }

  // Fallback: assume today
  if (!targetDate) targetDate = new Date(today);

  // "相对时间" — "20分钟后" / "2小时后" / "半小时后"
  const relativeMin = remaining.match(/(\d+)\s*分钟?后/);
  const relativeHour = remaining.match(/(\d+)\s*小时?后/);
  if (relativeMin || relativeHour) {
    let ms = 0;
    if (relativeHour) ms += parseInt(relativeHour[1]) * 60 * 60_000;
    if (relativeMin) ms += parseInt(relativeMin[1]) * 60_000;
    if (remaining.includes("半") && remaining.includes("小时")) ms += 30 * 60_000;
    // Strip the relative time phrase before extracting message
    let msgRemaining = remaining.replace(/\d+\s*(分钟?|小时?|半小?时?)后/, "").trim();
    const dueAt = new Date(Date.now() + ms);
    return {
      hour: dueAt.getHours(),
      minute: dueAt.getMinutes(),
      msg: extractMessage(msgRemaining) || "闹钟",
      dueAtMs: dueAt.getTime(),
      date: dateStr(dueAt),
    };
  }

  // Convert Chinese number words to arabic digits before time extraction
  remaining = convertChineseNumbers(remaining);

  // ── Phase 2: extract time ──
  let hour = 0;
  let minute = 0;

  // Time period shift: "下午" / "晚上" / "早上"
  let periodShift = 0;
  for (const [word, shift] of Object.entries(DAY_PERIOD)) {
    if (remaining.includes(word)) {
      periodShift = shift;
      remaining = remaining.replace(word, "");
      break;
    }
  }

  // "X点半" → X:30
  const halfMatch = remaining.match(/(\d{1,2})点半/);
  if (halfMatch) {
    hour = parseInt(halfMatch[1]);
    minute = 30;
    remaining = remaining.replace(halfMatch[0], "");
  } else {
    // "X点Y分" → X:Y
    const timeMatch = remaining.match(/(\d{1,2})点(\d{1,2})分?/);
    if (timeMatch) {
      hour = parseInt(timeMatch[1]);
      minute = parseInt(timeMatch[2]);
      remaining = remaining.replace(timeMatch[0], "");
    } else {
      // "X点" → X:00
      const hourMatch = remaining.match(/(\d{1,2})点/);
      if (hourMatch) {
        hour = parseInt(hourMatch[1]);
        remaining = remaining.replace(hourMatch[0], "");
      }
    }
  }

  // Apply period shift (e.g. 下午3点 → 15:00), but not if already > 12
  if (periodShift && hour < 12) {
    hour += periodShift;
  }

  // ── Phase 3: extract message ──
  let msg = extractMessage(remaining);

  // ── Phase 4: build final result ──
  const dueAt = new Date(targetDate);
  dueAt.setHours(hour, minute, 0, 0);

  // If daily and time already passed today, push to tomorrow
  if (isDaily && dueAt <= now) {
    dueAt.setDate(dueAt.getDate() + 1);
  }

  // If target date + time is in the past (and not explicitly today), push to next valid
  // For "明天/后天", trust the user's intent. Only auto-push if today resulted.
  if (!isDaily && !raw.includes("明天") && !raw.includes("后天") && !raw.includes("今天")
    && !raw.match(/(\d)月/) && !targetDateWasShifted(raw)) {
    if (dueAt <= now) {
      // If time mentioned but passed today, assume today still → push to same time today
      // Only push forward if the input feels like "today" (no explicit weekday either)
      const hasExplicitDay = Object.keys(WEEKDAY_CN).some(w => raw.includes(w));
      if (!hasExplicitDay && hour > 0) {
        dueAt.setDate(dueAt.getDate() + 1);
      }
    }
  }

  if (!hour && !minute && !relativeMin && !relativeHour) {
    return { error: "没找到时间。试试 '明天11点叫我' 或 '20分钟后提醒我'" };
  }

  return {
    hour: dueAt.getHours(),
    minute: dueAt.getMinutes(),
    msg: msg || "闹钟",
    dueAtMs: dueAt.getTime(),
    date: dateStr(dueAt),
    isDaily,
  };
}

function extractMessage(remaining) {
  let text = remaining.trim()
    .replace(/^(要|请|帮我|给我|记得)/, "")
    .replace(/^(叫我|喊我|提醒我|提醒|叫我一声)[。.！!]*/, "")
    .trim();

  // Extract message after trigger words
  const triggerMatch = text.match(MSG_TRIGGERS);
  if (triggerMatch && triggerMatch[1]) {
    return triggerMatch[1].trim();
  }

  // Check if remaining is an action verb → use it as msg
  const actionMatch = text.match(ACTION_VERBS);
  if (actionMatch) {
    return actionMatch[0];
  }

  if (text && text.length < 30) return text;
  return "闹钟";
}

function convertChineseNumbers(text) {
  // Convert Chinese number words near 点/分/半 to arabic digits
  // "四"=4, "十"=10, "十二"=12, "二十"=20, "二十三"=23
  // Matches patterns like "四点", "十点半", "二十三点十分"
  return text.replace(
    /([零一二两三四五六七八九十]{1,3})点(半|([零一二两三四五六七八九])分?)?/g,
    (match, hourCn, _rest, minCn) => {
      const h = cnWordToNum(hourCn);
      if (minCn) {
        const m = cnDigitToNum(minCn);
        return h + "点" + m + "分";
      }
      return h + match.slice(hourCn.length);
    }
  );
}

function cnWordToNum(word) {
  // "十二" → 12, "二十" → 20, "四" → 4
  if (word === "十") return 10;
  const parts = word.split("十");
  if (parts.length === 2) {
    const tens = parts[0] ? cnDigitToNum(parts[0]) : 1;
    const ones = parts[1] ? cnDigitToNum(parts[1]) : 0;
    return tens * 10 + ones;
  }
  return cnDigitToNum(word);
}

function cnDigitToNum(d) {
  return CN_NUM[d] ?? parseInt(d);
}

function targetDateWasShifted(raw) {
  return Object.keys(WEEKDAY_CN).some(w => raw.includes(w));
}

function dateStr(d) {
  return [
    d.getFullYear(),
    "-",
    String(d.getMonth() + 1).padStart(2, "0"),
    "-",
    String(d.getDate()).padStart(2, "0"),
  ].join("");
}

/**
 * Entry point: parse input, return ready-to-send alarm payload.
 */
function parse(input) {
  const result = parseAlarm(input);
  if (result.error) return { error: result.error };
  return {
    hour: result.hour,
    minute: result.minute,
    msg: result.msg,
    date: result.date,
    dueAtMs: result.dueAtMs,
    phoneUrl: (ip) =>
      `http://${ip}:8765/alarm?hour=${result.hour}&minute=${result.minute}&msg=${encodeURIComponent(result.msg)}`,
  };
}

module.exports = { parse, parseAlarm };
