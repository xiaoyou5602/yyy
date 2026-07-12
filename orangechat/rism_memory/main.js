// Rism 记忆中枢 · main.js
// 运行环境：橘瓣 QuickJS 插件沙箱
// 约束（源码验证过，别改成"现代"写法）：
// - fetch 是宿主注入的同步函数，15s 超时，只支持 GET/POST/PUT/DELETE（无 PATCH）
//   → 一切更新走 Postgres RPC（POST /rest/v1/rpc/xx）
// - 宿主会用正则暴力删除 async/await，所以必须写纯同步风格
// - 插件全局单线程：失败快速返回，绝不重试循环，批量写用单次请求
// - config 是宿主注入的全局变量，每次调用时重读（跟随供体插件模式）

// ==================== 配置 ====================

var CONFIG = {
  url: '',
  key: '',
  assistantId: 'rism',
  bridgeUrl: '',
  bridgeToken: ''
};

function initConfig() {
  CONFIG.url = (config.supabase_url || '').replace(/\/+$/, '');
  CONFIG.key = config.supabase_key || '';
  CONFIG.assistantId = config.assistant_id || 'rism';
  CONFIG.bridgeUrl = (config.bridge_url || '').replace(/\/+$/, '');
  CONFIG.bridgeToken = config.bridge_token || '';
}

function notConfigured() {
  return { success: false, error: 'Supabase 未配置：请在插件设置里填 URL 和 Key' };
}

// ==================== 基础设施 ====================

// Supabase REST 请求。失败时把响应体带回来（供体只给 status，没法调试）
function sbFetch(path, method, body, prefer) {
  var headers = {
    'apikey': CONFIG.key,
    'Authorization': 'Bearer ' + CONFIG.key,
    'Content-Type': 'application/json'
  };
  if (prefer) {
    headers['Prefer'] = prefer;
  }
  var response = fetch(CONFIG.url + path, {
    method: method,
    headers: headers,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    throw new Error('Supabase ' + response.status + ': ' + String(response.body).slice(0, 300));
  }
  var text = response.text();
  if (!text) {
    return null;
  }
  return JSON.parse(text);
}

// 插入一行（或多行数组），返回插入结果
function sbInsert(rows) {
  return sbFetch('/rest/v1/chat_messages', 'POST', rows, 'return=representation');
}

// 查询，queryString 形如 '?memory_type=eq.diary&order=created_at.desc'
function sbSelect(queryString) {
  return sbFetch('/rest/v1/chat_messages' + queryString, 'GET', null, null);
}

// 调 RPC 函数（更新类操作的唯一通道，因为宿主 fetch 不支持 PATCH）
function sbRpc(fn, args) {
  return sbFetch('/rest/v1/rpc/' + fn, 'POST', args || {}, null);
}

// 本地时区的 YYYY-MM-DD（不能用 toISOString——那是 UTC，凌晨会跨天）
function localDate() {
  var d = new Date();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

// 校验/兜底日期参数
function pickDate(s) {
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(String(s))) {
    return String(s);
  }
  return localDate();
}

// AI 传数组参数时可能给真数组，也可能给 JSON 字符串，都接住
function toArray(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Array]') return v;
  if (typeof v === 'string') {
    try {
      var parsed = JSON.parse(v);
      if (Object.prototype.toString.call(parsed) === '[object Array]') return parsed;
    } catch (e) { /* 单个词的字符串 → 包成数组 */ }
    return [v];
  }
  return null;
}

function ok(data) {
  return { success: true, data: data };
}

function fail(e) {
  return { success: false, error: (e && e.message) ? e.message : String(e) };
}

// 统一写入：补 assistant_id / source / role，返回插入的行
function writeRow(fields) {
  var row = {
    assistant_id: CONFIG.assistantId,
    conversation_id: fields.conversation_id || 'manual',
    role: fields.role || 'system',
    content: fields.content,
    memory_type: fields.memory_type,
    source: 'orangechat'
  };
  if (fields.tags) row.tags = fields.tags;
  if (fields.emotion) row.emotion = fields.emotion;
  if (fields.related_date) row.related_date = fields.related_date;
  if (fields.privacy) row.privacy = fields.privacy;
  if (fields.metadata) row.metadata = fields.metadata;
  if (fields.heat !== undefined) row.heat = fields.heat;
  var result = sbInsert(row);
  return (result && result.length) ? result[0] : result;
}

// 精简返回给模型的行（省 token：砍掉空字段和内部字段）
function slim(rows) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var s = { id: r.id, content: r.content, created_at: r.created_at };
    if (r.memory_type) s.type = r.memory_type;
    if (r.related_date) s.date = r.related_date;
    if (r.tags && r.tags.length) s.tags = r.tags;
    if (r.emotion && r.emotion.length) s.emotion = r.emotion;
    if (r.heat !== undefined && r.heat !== null) s.heat = r.heat;
    if (r.privacy && r.privacy !== 'normal') s.privacy = r.privacy;
    if (r.metadata) s.metadata = r.metadata;
    out.push(s);
  }
  return out;
}

// ==================== 📔 日记 ====================

function diary_write(params) {
  initConfig();
  if (!CONFIG.url || !CONFIG.key) return notConfigured();
  if (!params.content) return { success: false, error: 'content is required' };
  try {
    var row = writeRow({
      content: params.content,
      memory_type: 'diary',
      related_date: pickDate(params.date),
      emotion: toArray(params.emotion)
    });
    return ok({ id: row.id, date: row.related_date, saved: true });
  } catch (e) {
    return fail(e);
  }
}

function diary_read(params) {
  initConfig();
  if (!CONFIG.url || !CONFIG.key) return notConfigured();
  try {
    var date = pickDate(params && params.date);
    var rows = sbSelect('?memory_type=eq.diary&related_date=eq.' + date + '&order=created_at.asc');
    return ok({ date: date, entries: slim(rows) });
  } catch (e) {
    return fail(e);
  }
}

function diary_search(params) {
  initConfig();
  if (!CONFIG.url || !CONFIG.key) return notConfigured();
  if (!params.query) return { success: false, error: 'query is required' };
  try {
    var limit = params.limit || 10;
    var rows = sbSelect('?memory_type=eq.diary&content=ilike.*' + encodeURIComponent(params.query) +
      '*&order=created_at.desc&limit=' + limit);
    return ok(slim(rows));
  } catch (e) {
    return fail(e);
  }
}

// ==================== 🌙 梦境 ====================

function dream_write(params) {
  initConfig();
  if (!CONFIG.url || !CONFIG.key) return notConfigured();
  if (!params.content) return { success: false, error: 'content is required' };
  try {
    var row = writeRow({
      content: params.content,
      memory_type: 'dream',
      related_date: pickDate(params.date)
    });
    return ok({ id: row.id, date: row.related_date, saved: true });
  } catch (e) {
    return fail(e);
  }
}

function dream_read(params) {
  initConfig();
  if (!CONFIG.url || !CONFIG.key) return notConfigured();
  try {
    var query;
    if (params && params.date && /^\d{4}-\d{2}-\d{2}$/.test(String(params.date))) {
      query = '?memory_type=eq.dream&related_date=eq.' + params.date + '&order=created_at.asc';
    } else {
      var limit = (params && params.limit) || 5;
      query = '?memory_type=eq.dream&order=created_at.desc&limit=' + limit;
    }
    return ok(slim(sbSelect(query)));
  } catch (e) {
    return fail(e);
  }
}

// ==================== 💌 信件 ====================

function letter_write(params) {
  initConfig();
  if (!CONFIG.url || !CONFIG.key) return notConfigured();
  if (!params.content) return { success: false, error: 'content is required' };
  try {
    var row = writeRow({
      content: params.content,
      memory_type: 'letter',
      related_date: localDate(),
      metadata: params.title ? { title: params.title } : null
    });
    return ok({ id: row.id, saved: true });
  } catch (e) {
    return fail(e);
  }
}

function letter_read(params) {
  initConfig();
  if (!CONFIG.url || !CONFIG.key) return notConfigured();
  try {
    var limit = (params && params.limit) || 3;
    var rows = sbSelect('?memory_type=eq.letter&order=created_at.desc&limit=' + limit);
    return ok(slim(rows));
  } catch (e) {
    return fail(e);
  }
}

// ==================== ✅ 待办 ====================

function todo_write(params) {
  initConfig();
  if (!CONFIG.url || !CONFIG.key) return notConfigured();
  if (!params.content) return { success: false, error: 'content is required' };
  try {
    var meta = { status: 'pending', priority: params.priority || 'normal' };
    if (params.due_date && /^\d{4}-\d{2}-\d{2}$/.test(String(params.due_date))) {
      meta.due_date = params.due_date;
    }
    var row = writeRow({
      content: params.content,
      memory_type: 'todo',
      metadata: meta
    });
    return ok({ id: row.id, saved: true });
  } catch (e) {
    return fail(e);
  }
}

function todo_list(params) {
  initConfig();
  if (!CONFIG.url || !CONFIG.key) return notConfigured();
  try {
    var status = (params && params.status) || 'pending';
    var query = '?memory_type=eq.todo&order=created_at.desc&limit=50';
    if (status !== 'all') {
      query += '&metadata->>status=eq.' + encodeURIComponent(status);
    }
    return ok(slim(sbSelect(query)));
  } catch (e) {
    return fail(e);
  }
}

function todo_complete(params) {
  initConfig();
  if (!CONFIG.url || !CONFIG.key) return notConfigured();
  if (!params.id) return { success: false, error: 'id is required' };
  try {
    return sbRpc('complete_todo', { todo_id: Number(params.id) });
  } catch (e) {
    return fail(e);
  }
}

// ==================== 🧋 奶茶 ====================

function bubbletea_write(params) {
  initConfig();
  if (!CONFIG.url || !CONFIG.key) return notConfigured();
  if (!params.brand || !params.name) {
    return { success: false, error: 'brand and name are required' };
  }
  try {
    var meta = { brand: params.brand, name: params.name };
    if (params.rating !== undefined && params.rating !== null) meta.rating = Number(params.rating);
    if (params.sugar) meta.sugar = params.sugar;
    if (params.ice) meta.ice = params.ice;
    if (params.toppings) meta.toppings = params.toppings;
    if (params.note) meta.note = params.note;
    var summary = params.brand + ' ' + params.name +
      (meta.rating !== undefined ? '，评分 ' + meta.rating : '') +
      (params.note ? '，' + params.note : '');
    var row = writeRow({
      content: summary,
      memory_type: 'bubbletea',
      related_date: localDate(),
      metadata: meta
    });
    return ok({ id: row.id, saved: true });
  } catch (e) {
    return fail(e);
  }
}

function bubbletea_search(params) {
  initConfig();
  if (!CONFIG.url || !CONFIG.key) return notConfigured();
  try {
    var limit = (params && params.limit) || 10;
    var query = '?memory_type=eq.bubbletea&order=created_at.desc&limit=' + limit;
    if (params && params.query) {
      query += '&content=ilike.*' + encodeURIComponent(params.query) + '*';
    }
    return ok(slim(sbSelect(query)));
  } catch (e) {
    return fail(e);
  }
}

// ==================== 📅 时间轴 ====================

function timeline_write(params) {
  initConfig();
  if (!CONFIG.url || !CONFIG.key) return notConfigured();
  if (!params.title || !params.start_at) {
    return { success: false, error: 'title and start_at are required' };
  }
  try {
    var meta = { start_at: params.start_at };
    if (params.end_at) meta.end_at = params.end_at;
    if (params.category) meta.category = params.category;
    if (params.note) meta.note = params.note;
    var relatedDate = /^\d{4}-\d{2}-\d{2}/.test(String(params.start_at))
      ? String(params.start_at).slice(0, 10)
      : localDate();
    var row = writeRow({
      content: params.title,
      memory_type: 'timeline_event',
      related_date: relatedDate,
      metadata: meta
    });
    return ok({ id: row.id, saved: true });
  } catch (e) {
    return fail(e);
  }
}

function timeline_read(params) {
  initConfig();
  if (!CONFIG.url || !CONFIG.key) return notConfigured();
  try {
    var from = pickDate(params && params.from_date);
    var to = (params && params.to_date && /^\d{4}-\d{2}-\d{2}$/.test(String(params.to_date)))
      ? String(params.to_date)
      : from;
    var rows = sbSelect('?memory_type=eq.timeline_event&related_date=gte.' + from +
      '&related_date=lte.' + to + '&order=related_date.asc&limit=100');
    return ok({ from: from, to: to, events: slim(rows) });
  } catch (e) {
    return fail(e);
  }
}

// ==================== 🧠 通用记忆 ====================

var MEMORY_TYPES = ['memo', 'lore', 'xp_note'];

function memory_write(params) {
  initConfig();
  if (!CONFIG.url || !CONFIG.key) return notConfigured();
  if (!params.content) return { success: false, error: 'content is required' };
  try {
    var type = params.memory_type;
    if (!type || MEMORY_TYPES.indexOf(type) === -1) {
      type = 'memo';
    }
    var privacy = params.privacy;
    if (privacy !== 'intimate' && privacy !== 'private') {
      privacy = 'normal';
    }
    var row = writeRow({
      content: params.content,
      memory_type: type,
      tags: toArray(params.tags),
      emotion: toArray(params.emotion),
      privacy: privacy,
      related_date: localDate()
    });
    return ok({ id: row.id, type: type, saved: true });
  } catch (e) {
    return fail(e);
  }
}

function memory_search(params) {
  initConfig();
  if (!CONFIG.url || !CONFIG.key) return notConfigured();
  if (!params.query) return { success: false, error: 'query is required' };
  try {
    var limit = params.limit || 10;
    var query = '?content=ilike.*' + encodeURIComponent(params.query) + '*';
    if (params.memory_type) {
      query += '&memory_type=eq.' + encodeURIComponent(params.memory_type);
    } else if (!params.include_conversation) {
      query += '&memory_type=neq.conversation';
    }
    if (!params.include_private) {
      query += '&privacy=eq.normal';
    }
    query += '&order=heat.desc,created_at.desc&limit=' + limit;
    return ok(slim(sbSelect(query)));
  } catch (e) {
    return fail(e);
  }
}

function memory_recall_recent(params) {
  initConfig();
  if (!CONFIG.url || !CONFIG.key) return notConfigured();
  try {
    var limit = (params && params.limit) || 20;
    var query = '?order=created_at.desc&limit=' + limit;
    if (params && params.conversation_id) {
      query = '?conversation_id=eq.' + encodeURIComponent(params.conversation_id) + query.replace('?', '&');
    } else if (!(params && params.include_conversation)) {
      query += '&memory_type=neq.conversation';
    }
    var rows = sbSelect(query);
    rows.reverse();
    return ok(slim(rows));
  } catch (e) {
    return fail(e);
  }
}

function memory_heat_boost(params) {
  initConfig();
  if (!CONFIG.url || !CONFIG.key) return notConfigured();
  if (!params.id) return { success: false, error: 'id is required' };
  try {
    var amount = (params.amount !== undefined && params.amount !== null) ? Number(params.amount) : 1;
    return sbRpc('boost_memory_heat', { mem_id: Number(params.id), amount: amount });
  } catch (e) {
    return fail(e);
  }
}

// ==================== 🖥️ VPS 桥 ====================

function bridgeFetch(path, method, body) {
  if (!CONFIG.bridgeUrl || !CONFIG.bridgeToken) {
    throw new Error('VPS 桥未配置：请在插件设置里填 bridge_url 和 bridge_token');
  }
  var response = fetch(CONFIG.bridgeUrl + path, {
    method: method || 'GET',
    headers: {
      'Authorization': 'Bearer ' + CONFIG.bridgeToken,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    throw new Error('Bridge ' + response.status + ': ' + String(response.body).slice(0, 300));
  }
  return response.json();
}

function vps_status() {
  initConfig();
  try {
    return ok(bridgeFetch('/api/bridge/status', 'GET', null));
  } catch (e) {
    return fail(e);
  }
}

function vps_restart(params) {
  initConfig();
  try {
    var service = (params && params.service) || 'cyberboss';
    return ok(bridgeFetch('/api/bridge/restart', 'POST', { service: service }));
  } catch (e) {
    return fail(e);
  }
}

function vps_logs(params) {
  initConfig();
  try {
    var service = (params && params.service) || 'cyberboss';
    var lines = (params && params.lines) || 50;
    return ok(bridgeFetch('/api/bridge/logs?service=' + encodeURIComponent(service) +
      '&lines=' + lines, 'GET', null));
  } catch (e) {
    return fail(e);
  }
}

// ==================== ⏰ hooks ====================

// 每日维护（manifest 里 schedule: 凌晨 4 点）：
// 只做热力衰减。消息同步交给原生外置记忆，梦境触发走原生主动消息，插件不越界
function onDailyCron(event) {
  initConfig();
  if (!CONFIG.url || !CONFIG.key) {
    return { success: false, error: 'not configured' };
  }
  try {
    var result = sbRpc('decay_memory_heat', {});
    console.log('[rism_memory] daily decay: ' + JSON.stringify(result));
    return { success: true, decay: result };
  } catch (e) {
    console.error('[rism_memory] daily decay failed: ' + ((e && e.message) || e));
    return fail(e);
  }
}

// ==================== 导出 ====================

exports.diary_write = diary_write;
exports.diary_read = diary_read;
exports.diary_search = diary_search;
exports.dream_write = dream_write;
exports.dream_read = dream_read;
exports.letter_write = letter_write;
exports.letter_read = letter_read;
exports.todo_write = todo_write;
exports.todo_list = todo_list;
exports.todo_complete = todo_complete;
exports.bubbletea_write = bubbletea_write;
exports.bubbletea_search = bubbletea_search;
exports.timeline_write = timeline_write;
exports.timeline_read = timeline_read;
exports.memory_write = memory_write;
exports.memory_search = memory_search;
exports.memory_recall_recent = memory_recall_recent;
exports.memory_heat_boost = memory_heat_boost;
exports.vps_status = vps_status;
exports.vps_restart = vps_restart;
exports.vps_logs = vps_logs;
exports.onDailyCron = onDailyCron;
