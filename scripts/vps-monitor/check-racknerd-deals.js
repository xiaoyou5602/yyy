#!/usr/bin/env node
/**
 * VPS 官网低价监控
 *
 * 只读取服务商官网，不抓折扣新闻或第三方汇总：
 *   - DediRock Black Friday 官方活动页 + 官方 WHMCS 结账页库存核验
 *   - RackNerd 官方 Specials 页面
 *   - CloudCone 官方 VPS 页面
 *
 * 默认阈值：年付 <= 18 USD；默认关注洛杉矶。
 * 正常运行只在新增现货、重新补货或降价时提醒；每次都会写运行日志和状态报告。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const MAX_PRICE = Number(args.find((a) => a.startsWith('--max-price='))?.split('=')[1] || 18);
const DRY_RUN = args.includes('--dry-run');
const QUIET = args.includes('--quiet');
const CHECK_ALL_LOCATIONS = args.includes('--all-locations');
const ROOT = __dirname;
const STATE_FILE = path.join(ROOT, 'vps-deals-state.json');
const LOG_FILE = path.join(ROOT, 'vps-monitor.log');
const REPORT_FILE = path.join(ROOT, 'last-report.md');
const USER_HOME = process.env.USERPROFILE || 'C:\\Users\\youzi';
const DESKTOP_ALERT_FILE = path.join(USER_HOME, 'Desktop', '🛒VPS新特价.txt');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151 Safari/537.36';

const SOURCES = [
  {
    id: 'dedirock',
    name: 'DediRock',
    url: 'https://dedirock.com/black-friday/',
    scan: scanDediRock,
  },
  {
    id: 'racknerd',
    name: 'RackNerd',
    url: 'https://www.racknerd.com/specials/',
    scan: scanRackNerd,
  },
  {
    id: 'cloudcone',
    name: 'CloudCone',
    url: 'https://cloudcone.com/vps/',
    scan: scanCloudCone,
  },
];

function nowIso() {
  return new Date().toISOString();
}

function localTime() {
  return new Date().toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
}

function output(message) {
  if (!QUIET) console.log(message);
}

function appendLog(message) {
  if (DRY_RUN) return;
  fs.appendFileSync(LOG_FILE, `[${localTime()}] ${message}\r\n`, 'utf8');
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(value) {
  return decodeHtml(String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function absolutize(url, baseUrl) {
  try {
    return new URL(decodeHtml(url), baseUrl).href;
  } catch {
    return decodeHtml(url);
  }
}

function fetchPage(url, options = {}, redirectCount = 0) {
  const timeoutMs = options.timeoutMs || 20000;
  if (redirectCount > 6) return Promise.reject(new Error('重定向次数过多'));

  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(options.cookie ? { Cookie: options.cookie } : {}),
      },
      rejectUnauthorized: true,
    }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        const target = absolutize(response.headers.location, url);
        const newCookies = (response.headers['set-cookie'] || []).map((item) => item.split(';', 1)[0]);
        const cookie = [options.cookie, ...newCookies].filter(Boolean).join('; ');
        fetchPage(target, { ...options, cookie }, redirectCount + 1).then(resolve, reject);
        return;
      }

      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 3_000_000) request.destroy(new Error('页面超过 3 MB，停止读取'));
      });
      response.on('end', () => resolve({ status, url, finalUrl: url, body }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`请求超时 ${timeoutMs}ms`)));
    request.on('error', reject);
  });
}

function lastMatch(text, pattern) {
  const matches = [...text.matchAll(pattern)];
  return matches.length ? matches[matches.length - 1] : null;
}

function uniqueDeals(deals) {
  const map = new Map();
  for (const deal of deals) {
    if (!deal.url || !Number.isFinite(deal.price)) continue;
    map.set(deal.url, deal);
  }
  return [...map.values()];
}

function locationWanted(deal) {
  if (CHECK_ALL_LOCATIONS) return true;
  return /los angeles|\bLA\b/i.test(`${deal.location || ''} ${deal.title || ''} ${deal.url || ''}`);
}

async function scanDediRock(source) {
  const response = await fetchPage(source.url);
  if (response.status !== 200) throw new Error(`活动页 HTTP ${response.status}`);
  const html = response.body;
  const deals = [];
  const linkPattern = /<a\b[^>]*href=["']([^"']*billing\.dedirock\.com\/[^"']*\/store\/[^"']+)["'][^>]*>[\s\S]*?<\/a>/gi;

  let link;
  while ((link = linkPattern.exec(html)) !== null) {
    const url = absolutize(link[1], source.url);
    if (!/promo-vps/i.test(url) || /storage/i.test(url)) continue;

    const before = html.slice(Math.max(0, link.index - 9000), link.index);
    const priceMatch = lastMatch(before, /data-to-value=["']([0-9]+(?:\.[0-9]+)?)["']/gi);
    if (!priceMatch) continue;

    const headings = [...before.matchAll(/<h[2-6][^>]*>([\s\S]*?)<\/h[2-6]>/gi)];
    const title = headings.length ? stripHtml(headings[headings.length - 1][1]) : url.split('/').pop().replace(/-/g, ' ');
    const slug = url.toLowerCase();
    const location = slug.includes('los-angeles') || /\bLA\b/i.test(title) ? 'Los Angeles'
      : slug.includes('new-york') || /\bNY\b/i.test(title) ? 'New York'
        : 'Unknown';

    deals.push({
      key: url,
      provider: source.name,
      sourceUrl: source.url,
      title,
      price: Number(priceMatch[1]),
      billing: 'yearly',
      location,
      url,
      availability: 'unknown',
      verification: 'checkout',
    });
  }

  const filtered = uniqueDeals(deals).filter((deal) => deal.price <= MAX_PRICE && locationWanted(deal));
  for (const deal of filtered) {
    try {
      const checkout = await fetchPage(deal.url);
      const text = stripHtml(checkout.body);
      const soldOut = /out\s*of\s*stock|sold\s*out|currently\s*unavailable|product\s*is\s*not\s*available/i.test(text);
      const configurable = /confproduct|configure|product configuration|order summary/i.test(`${checkout.finalUrl} ${text}`);
      deal.availability = soldOut ? 'soldout' : configurable ? 'available' : 'unknown';
      deal.verification = soldOut ? 'official-checkout-soldout' : configurable ? 'official-checkout' : `official-checkout-unclear-${checkout.status}`;
    } catch (error) {
      deal.availability = 'unknown';
      deal.verification = `checkout-error: ${error.message}`;
    }
  }

  return { deals: filtered, discovered: uniqueDeals(deals).length, status: `官网商品 ${uniqueDeals(deals).length} 个，阈值内 ${filtered.length} 个` };
}

async function scanRackNerd(source) {
  const response = await fetchPage(source.url);
  if (response.status !== 200) throw new Error(`官网 HTTP ${response.status}`);
  const html = response.body;
  const deals = [];
  const linkPattern = /<a\b[^>]*href=["'](https:\/\/my\.racknerd\.com\/cart\.php\?[^"']+)["'][^>]*>\s*Order Now\s*<\/a>/gi;
  let link;
  while ((link = linkPattern.exec(html)) !== null) {
    const before = html.slice(Math.max(0, link.index - 3500), link.index);
    const priceMatch = lastMatch(before, /<span[^>]*class=["']currency["'][^>]*>\s*\$\s*<\/span>\s*([0-9]+(?:\.[0-9]+)?)[\s\S]{0,120}?<span[^>]*class=["']period["'][^>]*>\s*\/year/gi);
    const titleMatch = lastMatch(before, /<h3[^>]*>([\s\S]*?)<\/h3>/gi);
    if (!priceMatch) continue;
    deals.push({
      key: decodeHtml(link[1]),
      provider: source.name,
      sourceUrl: source.url,
      title: titleMatch ? stripHtml(titleMatch[1]) : 'RackNerd VPS',
      price: Number(priceMatch[1]),
      billing: 'yearly',
      location: 'Multiple locations (check LA at checkout)',
      url: decodeHtml(link[1]),
      availability: 'listed',
      verification: 'official-listing',
    });
  }
  const filtered = uniqueDeals(deals).filter((deal) => deal.price <= MAX_PRICE);
  return { deals: filtered, discovered: uniqueDeals(deals).length, status: `官网套餐 ${uniqueDeals(deals).length} 个，阈值内 ${filtered.length} 个` };
}

async function scanCloudCone(source) {
  const response = await fetchPage(source.url);
  if (response.status !== 200) throw new Error(`官网 HTTP ${response.status}`);
  const html = response.body;
  const deals = [];
  const blocks = html.split(/<div[^>]+class=["'][^"']*pricing[^"']*["'][^>]*>/i).slice(1);

  for (const block of blocks) {
    const bounded = block.slice(0, 7000);
    const priceMatch = bounded.match(/Billed\s*(?:<[^>]+>)*\s*\$\s*([0-9]+(?:\.[0-9]+)?)(?:<[^>]+>|&nbsp;|\s)*per\s*year/i);
    if (!priceMatch) continue;
    const titleMatch = bounded.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const hrefMatch = bounded.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]{0,300}?(?:Deploy|Order|Get Started)/i);
    deals.push({
      key: hrefMatch ? absolutize(hrefMatch[1], source.url) : `${source.url}#${stripHtml(titleMatch?.[1] || 'vps')}`,
      provider: source.name,
      sourceUrl: source.url,
      title: stripHtml(titleMatch?.[1] || 'CloudCone VPS'),
      price: Number(priceMatch[1]),
      billing: 'yearly',
      location: /Los Angeles/i.test(html) ? 'Los Angeles' : 'Location shown at checkout',
      url: hrefMatch ? absolutize(hrefMatch[1], source.url) : source.url,
      availability: 'listed',
      verification: 'official-listing',
    });
  }

  const filtered = uniqueDeals(deals).filter((deal) => deal.price <= MAX_PRICE && locationWanted(deal));
  return { deals: filtered, discovered: uniqueDeals(deals).length, status: `官网套餐 ${uniqueDeals(deals).length} 个，阈值内 ${filtered.length} 个` };
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return parsed.version === 2 ? parsed : { version: 2, deals: {}, sources: {}, lastCheck: null };
  } catch {
    return { version: 2, deals: {}, sources: {}, lastCheck: null };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function statusIsAlertable(status) {
  return status === 'available' || status === 'listed';
}

function classifyChanges(deals, previousDeals) {
  const alerts = [];
  for (const deal of deals) {
    const previous = previousDeals[deal.key];
    if (!statusIsAlertable(deal.availability)) continue;

    if (!previous) {
      alerts.push({ ...deal, reason: deal.availability === 'available' ? '新发现并已核验有货' : '官网新上架（结账待人工确认）' });
    } else if (!statusIsAlertable(previous.availability)) {
      alerts.push({ ...deal, reason: '重新补货' });
    } else if (Number(previous.price) > deal.price) {
      alerts.push({ ...deal, reason: `降价 $${previous.price} → $${deal.price}` });
    }
  }
  return alerts;
}

function renderReport({ checks, deals, alerts, errors }) {
  const lines = [
    '# VPS 官网低价监控',
    '',
    `- 检查时间：${localTime()}`,
    `- 阈值：年付 ≤ $${MAX_PRICE}`,
    `- 地区：${CHECK_ALL_LOCATIONS ? '不限' : '洛杉矶'}`,
    `- 官网来源：${SOURCES.map((source) => source.name).join('、')}`,
    '',
    '## 来源状态',
    '',
    ...checks.map((check) => `- ${check.name}：${check.status}`),
  ];

  if (errors.length) {
    lines.push('', '## 抓取错误', '', ...errors.map((error) => `- ${error.source}：${error.message}`));
  }

  lines.push('', '## 当前阈值内套餐', '');
  if (!deals.length) lines.push('- 暂无');
  for (const deal of deals.sort((a, b) => a.price - b.price)) {
    const stock = deal.availability === 'available' ? '✅ 结账页可配置'
      : deal.availability === 'soldout' ? '❌ 售罄'
        : deal.availability === 'listed' ? '🟡 官网在售，结账待确认'
          : '⚪ 库存未知';
    lines.push(`- **$${deal.price}/年** · ${deal.provider} · ${deal.title} · ${deal.location} · ${stock}`);
    lines.push(`  - ${deal.url}`);
  }

  lines.push('', '## 本轮新提醒', '');
  if (!alerts.length) lines.push('- 无');
  for (const deal of alerts) lines.push(`- ${deal.reason}：$${deal.price}/年 · ${deal.provider} · ${deal.title} · ${deal.url}`);
  lines.push('');
  return lines.join('\n');
}

function showToast(title, message) {
  const safeTitle = title.replace(/[<>&]/g, '');
  const safeMessage = message.replace(/[<>&]/g, '');
  const command = [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
    '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
    `$xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text>${safeTitle}</text><text>${safeMessage}</text></binding></visual></toast>')`,
    "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('VPS官网监控').Show($toast)",
  ].join('; ');
  const encoded = Buffer.from(command, 'utf16le').toString('base64');
  execFileSync('powershell.exe', ['-NoProfile', '-EncodedCommand', encoded], { windowsHide: true, timeout: 8000 });
}

function notify(alerts) {
  if (DRY_RUN || !alerts.length) return;
  const body = alerts.map((deal) => [
    `\r\n[${localTime()}] ${deal.reason}`,
    `${deal.provider} · $${deal.price}/年 · ${deal.title} · ${deal.location}`,
    deal.url,
  ].join('\r\n')).join('\r\n');
  fs.appendFileSync(DESKTOP_ALERT_FILE, `${body}\r\n`, 'utf8');

  try {
    const best = alerts.slice().sort((a, b) => a.price - b.price)[0];
    showToast('发现 VPS 官网低价现货', `$${best.price}/年 · ${best.provider} · ${best.title}`);
    appendLog(`通知成功：${alerts.length} 个提醒`);
  } catch (error) {
    appendLog(`通知弹窗失败（桌面文件已写入）：${error.message}`);
  }
}

async function main() {
  if (!Number.isFinite(MAX_PRICE) || MAX_PRICE <= 0) throw new Error('价格阈值必须是正数');
  output(`🔎 VPS 官网监控：年付 ≤ $${MAX_PRICE}，${CHECK_ALL_LOCATIONS ? '不限地区' : '洛杉矶'}`);
  if (DRY_RUN) output('🧪 dry-run：不写状态、不发通知');

  const previous = loadState();
  const checks = [];
  const errors = [];
  const allDeals = [];

  for (const source of SOURCES) {
    try {
      const result = await source.scan(source);
      checks.push({ id: source.id, name: source.name, status: result.status, ok: true });
      allDeals.push(...result.deals);
      output(`✅ ${source.name}：${result.status}`);
    } catch (error) {
      checks.push({ id: source.id, name: source.name, status: `失败：${error.message}`, ok: false });
      errors.push({ source: source.name, message: error.message });
      output(`❌ ${source.name}：${error.message}`);
    }
  }

  if (!checks.some((check) => check.ok)) throw new Error('所有官网来源均抓取失败');

  const deals = uniqueDeals(allDeals);
  const alerts = classifyChanges(deals, previous.deals || {});
  const report = renderReport({ checks, deals, alerts, errors });
  output(`\n${report}`);

  if (!DRY_RUN) {
    fs.writeFileSync(REPORT_FILE, `${report}\n`, 'utf8');
    const nextDeals = {};
    for (const deal of deals) {
      const old = previous.deals?.[deal.key];
      nextDeals[deal.key] = {
        ...deal,
        firstSeen: old?.firstSeen || nowIso(),
        lastChecked: nowIso(),
      };
    }
    saveState({
      version: 2,
      maxPrice: MAX_PRICE,
      locationMode: CHECK_ALL_LOCATIONS ? 'all' : 'los-angeles',
      lastCheck: nowIso(),
      sources: Object.fromEntries(checks.map((check) => [check.id, { ok: check.ok, status: check.status, checkedAt: nowIso() }])),
      deals: nextDeals,
    });
    appendLog(`完成：来源成功 ${checks.filter((check) => check.ok).length}/${checks.length}，阈值内 ${deals.length}，新提醒 ${alerts.length}`);
    notify(alerts);
  }

  if (errors.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`💥 ${error.message}`);
  appendLog(`致命错误：${error.message}`);
  process.exitCode = 1;
});
