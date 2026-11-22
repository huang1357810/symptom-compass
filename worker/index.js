/**
 * 明辨康途 · Cloudflare Worker
 *
 * 职责：
 *   1. 托管 site/ 下的静态页面（ASSETS 绑定）
 *   2. 接收患者反馈：POST /api/feedback
 *   3. 查看反馈列表：GET /api/feedback/list?key=<ADMIN_KEY>
 *
 * 存储：KV 绑定 FEEDBACK_KV（未配置时接口返回 503，前端会降级为本地保存）
 */

import { summarizeFeedback } from './feedback-stats.mjs';
import { validateEvals } from './evals-schema.mjs';
import evalsSeed from './evals-seed.json';

const MAX_TEXT = 300;
const MAX_TAGS = 5;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/* 管理密钥：Header X-Admin-Key 优先，?key= 兼容但 deprecated */
function adminKeyFrom(request, url) {
  const header = request.headers.get('X-Admin-Key');
  if (header) return header.trim();
  return (url.searchParams.get('key') || '').trim();
}

function isAdmin(request, url, env) {
  const provided = adminKeyFrom(request, url);
  return !!env.ADMIN_KEY && provided === env.ADMIN_KEY;
}

/* 反馈上下文：记录这次分析对应的可能方向与症状，便于定位问题 */
function normalizeContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return { top: null, results: [], symptoms: [], triage: '' };

  const item = (x) => {
    if (!x || typeof x !== 'object') return null;
    const id = str(x.id, 40);
    const name = str(x.name, 60);
    if (!id && !name) return null;
    const n = Number(x.score);
    return { id, name, score: Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null };
  };

  const results = Array.isArray(ctx.results) ? ctx.results.slice(0, 3).map(item).filter(Boolean) : [];
  const top = item(ctx.top) || results[0] || null;
  const symptoms = Array.isArray(ctx.symptoms)
    ? ctx.symptoms.slice(0, 20).map(x => ({
        id: str(x && x.id, 40),
        label: str(x && x.label, 20)
      })).filter(x => x.id || x.label)
    : [];

  return { top, results, symptoms, triage: str(ctx.triage, 10) };
}

/* IP 只用于限流：加盐 SHA-256 前 16 位；不保存明文，也不用于识别个人 */
async function hashIp(ip, env) {
  const salt = (env && env.IP_SALT) || 'mingbian-kangtu-ip-v1';
  const data = new TextEncoder().encode(salt + '|' + ip);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

/* 极简限流：默认同一 IP 每分钟最多 5 条（依赖 KV，未配置时跳过） */
async function rateLimited(env, ip, limit = 5) {
  if (!env.FEEDBACK_KV) return false;
  const hashed = await hashIp(ip, env);
  const bucket = 'rl:' + hashed + ':' + Math.floor(Date.now() / 60000);
  const cur = Number(await env.FEEDBACK_KV.get(bucket)) || 0;
  if (cur >= limit) return true;
  await env.FEEDBACK_KV.put(bucket, String(cur + 1), { expirationTtl: 120 });
  return false;
}

async function handleFeedback(request, env) {
  if (request.method === 'OPTIONS') return json({ ok: true });
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'bad_json' }, 400);
  }

  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return json({ ok: false, error: 'bad_rating' }, 400);
  }

  const tags = Array.isArray(body.tags)
    ? body.tags.filter(t => typeof t === 'string').slice(0, MAX_TAGS).map(t => t.slice(0, 20))
    : [];

  const text = typeof body.text === 'string' ? body.text.slice(0, MAX_TEXT) : '';
  const context = normalizeContext(body.context);

  if (!env.FEEDBACK_KV) {
    /* 没配 KV 时也要让前端知道"没存上"，才能提示用户 */
    return json({ ok: false, error: 'no_store' }, 503);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (await rateLimited(env, ip)) return json({ ok: false, error: 'too_many' }, 429);

  const ts = Date.now();
  const id = ts.toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const record = {
    id,
    ts,
    rating,
    tags,
    text,
    page: typeof body.page === 'string' ? body.page.slice(0, 40) : '',
    contentVersion: str(body.contentVersion, 20),
    context,
    status: 'open',
    improveNote: '',
    updatedAt: 0,
    ua: (request.headers.get('User-Agent') || '').slice(0, 120),
    country: (request.headers.get('CF-IPCountry') || '').slice(0, 4)
  };

  await env.FEEDBACK_KV.put('fb:' + ts + ':' + id, JSON.stringify(record), {
    metadata: { rating, ts }
  });

  return json({ ok: true, id });
}

/* 标记反馈是否已改进（管理端表单提交） */
async function handleStatus(request, url, env) {
  const key = (url.searchParams.get('key') || '').trim();
  if (!isAdmin(request, url, env)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405);
  }
  if (!env.FEEDBACK_KV) {
    return json({ ok: false, error: 'no_store' }, 503);
  }

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return json({ ok: false, error: 'bad_form' }, 400);
  }

  const id = str(form.get('id'), 60);
  const status = form.get('status') === 'improved' ? 'improved' : 'open';
  const note = str(form.get('note'), 200);
  const fixedVersionInput = str(form.get('fixedVersion'), 20);
  if (!id) return json({ ok: false, error: 'missing_id' }, 400);

  const list = await env.FEEDBACK_KV.list({ prefix: 'fb:', limit: 500 });
  const hit = list.keys.find(k => k.name.endsWith(':' + id));
  if (!hit) return json({ ok: false, error: 'not_found' }, 404);

  const raw = await env.FEEDBACK_KV.get(hit.name);
  let rec = {};
  try { rec = raw ? JSON.parse(raw) : {}; } catch (e) { rec = {}; }
  rec.status = status;
  rec.improveNote = note;
  rec.fixedVersion = status === 'improved'
    ? (fixedVersionInput || str(rec.contentVersion, 20))
    : '';
  rec.updatedAt = Date.now();

  await env.FEEDBACK_KV.put(hit.name, JSON.stringify(rec), {
    metadata: { rating: rec.rating || 0, ts: rec.ts || 0 }
  });

  return Response.redirect(url.origin + '/api/feedback/list?key=' + encodeURIComponent(key), 303);
}

/* ---------- 评测 / 运营统计 ---------- */

function todayKey() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

async function readEvals(env) {
  if (env.FEEDBACK_KV) {
    const raw = await env.FEEDBACK_KV.get('evals:latest');
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {
        /* 损坏时回退 seed */
      }
    }
  }
  return evalsSeed;
}

async function readMetrics(env, day) {
  const empty = { total: 0, red: 0, yellow: 0, green: 0 };
  if (!env.FEEDBACK_KV) return empty;
  const raw = await env.FEEDBACK_KV.get('metrics:' + day);
  if (!raw) return empty;
  try {
    return Object.assign(empty, JSON.parse(raw));
  } catch (e) {
    return empty;
  }
}

/* GET /api/evals/latest：KV 优先，否则用打包内置的 seed */
async function handleEvals(env) {
  return json(await readEvals(env));
}

/* POST /api/evals/publish?key=ADMIN_KEY：把评测结果写入 KV */
async function handleEvalsPublish(request, url, env) {
  if (!isAdmin(request, url, env)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405);
  }
  if (!env.FEEDBACK_KV) return json({ ok: false, error: 'no_store' }, 503);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'bad_json' }, 400);
  }
  const checked = validateEvals(body);
  if (!checked.ok) {
    return json({ ok: false, error: checked.error }, 400);
  }

  await env.FEEDBACK_KV.put('evals:latest', JSON.stringify(checked.value));
  return json({ ok: true });
}

/*
 * POST /api/metrics/event：匿名运营事件
 * 只接收 { symptomCount, level }，按日聚合计数；
 * 不存症状名、方向、身份，也不写逐条记录。
 */
async function handleMetrics(request, env) {
  if (request.method === 'OPTIONS') return json({ ok: true });
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'bad_json' }, 400);
  }

  const level = (body && (body.level === 'red' || body.level === 'yellow' || body.level === 'green'))
    ? body.level
    : '';
  const count = Number(body && body.symptomCount);
  if (!level || !Number.isInteger(count) || count < 0 || count > 40) {
    return json({ ok: false, error: 'bad_event' }, 400);
  }
  if (!env.FEEDBACK_KV) return json({ ok: false, error: 'no_store' }, 503);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (await rateLimited(env, 'm:' + ip, 60)) {
    return json({ ok: false, error: 'too_many' }, 429);
  }

  const day = todayKey();
  const cur = await readMetrics(env, day);
  cur.total += 1;
  cur[level] += 1;
  await env.FEEDBACK_KV.put('metrics:' + day, JSON.stringify(cur), {
    expirationTtl: 90 * 24 * 3600
  });

  return json({ ok: true });
}

async function handleList(request, url, env) {
  const key = (url.searchParams.get('key') || '').trim();
  if (!isAdmin(request, url, env)) {
    return new Response('需要管理密钥：用 Header X-Admin-Key 或 /api/feedback/list?key=（已 deprecated）', {
      status: 401,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
  if (!env.FEEDBACK_KV) {
    return new Response('尚未配置 FEEDBACK_KV 存储', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  /* 最多读取 2000 条；坏记录跳过并计数，避免一条脏数据拖垮后台 */
  const items = [];
  let badRecords = 0;
  let cursor = undefined;
  let pages = 0;

  while (pages < 4 && items.length < 2000) {
    const opts = { prefix: 'fb:', limit: 500 };
    if (cursor) opts.cursor = cursor;
    const page = await env.FEEDBACK_KV.list(opts);
    for (const k of page.keys) {
      const v = await env.FEEDBACK_KV.get(k.name);
      if (!v) continue;
      try {
        const rec = JSON.parse(v);
        if (rec && typeof rec === 'object') {
          items.push(rec);
        } else {
          badRecords += 1;
        }
      } catch (e) {
        badRecords += 1;
      }
    }
    pages += 1;
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }
  items.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const stats = summarizeFeedback(items);
  const evals = await readEvals(env);
  const day = todayKey();
  const metrics = await readMetrics(env, day);
  const redPct = metrics.total ? Math.round(metrics.red / metrics.total * 100) : 0;

  const rows = items.map(i => {
    const d = new Date(i.ts + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16);
    const ctx = i.context || {};
    const top = ctx.top && ctx.top.name ? ctx.top.name : '—';
    const syms = (ctx.symptoms || []).map(s => s.label || s.id).slice(0, 5).join('、');
    const improved = i.status === 'improved';
    const fixLabel = improved
      ? ('已改进' + (i.fixedVersion ? '（' + escapeHtml(i.fixedVersion) + '）' : ''))
      : '待改进';
    return `<tr>
      <td>${d}</td>
      <td>${'★'.repeat(i.rating)}${'☆'.repeat(5 - i.rating)}</td>
      <td>${escapeHtml((i.tags || []).join('、'))}</td>
      <td>${escapeHtml(i.text || '')}</td>
      <td class="ctx"><b>${escapeHtml(top)}</b>${syms ? '<br><span class="sym">' + escapeHtml(syms) + '</span>' : ''}</td>
      <td>${escapeHtml(i.contentVersion || '—')}</td>
      <td class="st">${fixLabel}${i.improveNote ? '<br><span class="sym">' + escapeHtml(i.improveNote) + '</span>' : ''}</td>
      <td>
        <form method="post" action="/api/feedback/status?key=${encodeURIComponent(key)}">
          <input type="hidden" name="id" value="${escapeHtml(i.id)}">
          <select name="status">
            <option value="open"${improved ? '' : ' selected'}>待改进</option>
            <option value="improved"${improved ? ' selected' : ''}>已改进</option>
          </select>
          <input name="fixedVersion" placeholder="修正版本" size="6" value="${escapeHtml(i.fixedVersion || i.contentVersion || '')}">
          <input name="note" placeholder="改进说明" value="${escapeHtml(i.improveNote || '')}">
          <button type="submit">保存</button>
        </form>
      </td>
    </tr>`;
  }).join('');

  const distRows = [5, 4, 3, 2, 1].map(star => {
    const n = stats.dist[star - 1];
    const pct = stats.total ? Math.round(n / stats.total * 100) : 0;
    return `<div class="drow"><span class="dstar">${star}★</span>` +
      `<span class="dbar"><i style="width:${pct}%"></i></span>` +
      `<span class="dnum">${n}</span></div>`;
  }).join('');

  const lowRows = stats.lowTop.length
    ? stats.lowTop.map(g =>
        `<tr><td>${escapeHtml(g.name)}</td><td>${g.low}</td><td>${g.total}</td><td>${g.avg}</td></tr>`
      ).join('')
    : '<tr><td colspan="4">还没有 1–2 星的低分反馈</td></tr>';

  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>明辨康途 · 反馈（${items.length} 条）</title>
<style>
body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;margin:24px;color:#103b38;background:#f4faf9}
h1{font-size:18px} .stat{color:#5d7b78;font-size:13px;margin-bottom:14px}
table{border-collapse:collapse;width:100%;background:#fff;font-size:13px}
th,td{border:1px solid #dde9e7;padding:8px 10px;text-align:left;vertical-align:top}
th{background:#eaf7f4} td:nth-child(1){white-space:nowrap;color:#5d7b78}
.ctx b{color:#0b6f68} .sym{color:#7b9694;font-size:12px}
form{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:0}
select,input{font-size:12px;padding:2px 4px;border:1px solid #dde9e7;border-radius:4px}
button{font-size:12px;padding:3px 8px;border:1px solid #b9ded8;background:#eaf8f5;color:#0b6f68;border-radius:4px;cursor:pointer}

.dash{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:0 0 18px}
@media (max-width:760px){.dash{grid-template-columns:1fr}}
.panel{background:#fff;border:1px solid #dde9e7;border-radius:10px;padding:12px 14px}
.panel h2{font-size:14px;margin:0 0 10px}
.drow{display:flex;align-items:center;gap:8px;margin:6px 0;font-size:12px;color:#5d7b78}
.dstar{width:26px;text-align:right;color:#8a5a00}
.dbar{flex:1;height:10px;background:#eef6f4;border-radius:6px;overflow:hidden}
.dbar i{display:block;height:100%;background:linear-gradient(90deg,#7fd0c6,#0e8f86);border-radius:6px}
.dnum{width:34px;text-align:right;color:#103b38}
table.small{font-size:12px}
table.small th,table.small td{padding:6px 8px}
.kv{font-size:12.5px;color:#5d7b78;margin:4px 0}
.kv b{color:#103b38;font-size:13px}
</style></head><body>
<h1>明辨康途 · 反馈汇总</h1>
<p class="stat">共 ${stats.total} 条 ｜ 平均 ${stats.total ? stats.avg.toFixed(2) : '-'} 分 ｜ 待改进 ${items.filter(i => i.status !== 'improved').length} 条 ｜ 已改进 ${items.filter(i => i.status === 'improved').length} 条 ｜ 坏记录 ${badRecords} 条</p>

<div class="dash">
  <div class="panel">
    <h2>评分分布</h2>
    ${distRows}
  </div>
  <div class="panel">
    <h2>低分病症 Top5（1–2 星）</h2>
    <table class="small"><thead><tr><th>病症</th><th>低分</th><th>总数</th><th>均分</th></tr></thead>
    <tbody>${lowRows}</tbody></table>
  </div>
  <div class="panel">
    <h2>评测（${escapeHtml(evals.version || 'eval')}）</h2>
    <div class="kv">危险信号 <b>${evals.red || 0}/${evals.total || 0}</b>（判红率 ${Math.round((evals.redRate || 0) * 100)}%）</div>
    <div class="kv">用例 <b>${evals.caseTotal || evals.total || 0}</b> 条 ｜ 误报 ${evals.falsePositive || 0}/${evals.negatives || 0}</div>
    <div class="kv">最近运行：${escapeHtml(evals.generatedAt || '—')}</div>
  </div>
  <div class="panel">
    <h2>运营（今日 ${day}）</h2>
    <div class="kv">查询量 <b>${metrics.total}</b></div>
    <div class="kv">判红率 <b>${redPct}%</b>（红 ${metrics.red} / 黄 ${metrics.yellow} / 绿 ${metrics.green}）</div>
    <div class="kv sym">仅症状数与判红等级，不含身份</div>
  </div>
</div>
<table><thead><tr><th>时间</th><th>评分</th><th>标签</th><th>建议</th><th>对应病症</th><th>内容版本</th><th>改进</th><th>操作</th></tr></thead>
<tbody>${rows || '<tr><td colspan="8">还没有反馈</td></tr>'}</tbody></table>
</body></html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/feedback') return handleFeedback(request, env);
    if (url.pathname === '/api/feedback/list') return handleList(request, url, env);
    if (url.pathname === '/api/feedback/status') return handleStatus(request, url, env);
    if (url.pathname === '/api/evals/latest') return handleEvals(env);
    if (url.pathname === '/api/evals/publish') return handleEvalsPublish(request, url, env);
    if (url.pathname === '/api/metrics/event') return handleMetrics(request, env);

    /* 其余请求交给静态资源 */
    return env.ASSETS.fetch(request);
  }
};
