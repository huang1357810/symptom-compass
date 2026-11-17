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

/* 极简限流：同一 IP 每分钟最多 5 条（依赖 KV，未配置时跳过） */
async function rateLimited(env, ip) {
  if (!env.FEEDBACK_KV) return false;
  const bucket = 'rl:' + ip + ':' + Math.floor(Date.now() / 60000);
  const cur = Number(await env.FEEDBACK_KV.get(bucket)) || 0;
  if (cur >= 5) return true;
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
  const key = url.searchParams.get('key') || '';
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
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
  if (!id) return json({ ok: false, error: 'missing_id' }, 400);

  const list = await env.FEEDBACK_KV.list({ prefix: 'fb:', limit: 500 });
  const hit = list.keys.find(k => k.name.endsWith(':' + id));
  if (!hit) return json({ ok: false, error: 'not_found' }, 404);

  const raw = await env.FEEDBACK_KV.get(hit.name);
  let rec = {};
  try { rec = raw ? JSON.parse(raw) : {}; } catch (e) { rec = {}; }
  rec.status = status;
  rec.improveNote = note;
  rec.updatedAt = Date.now();

  await env.FEEDBACK_KV.put(hit.name, JSON.stringify(rec), {
    metadata: { rating: rec.rating || 0, ts: rec.ts || 0 }
  });

  return Response.redirect(url.origin + '/api/feedback/list?key=' + encodeURIComponent(key), 303);
}

async function handleList(url, env) {
  const key = url.searchParams.get('key') || '';
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return new Response('需要管理密钥：/api/feedback/list?key=你的ADMIN_KEY', {
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

  const list = await env.FEEDBACK_KV.list({ prefix: 'fb:', limit: 500 });
  const items = [];
  for (const k of list.keys) {
    const v = await env.FEEDBACK_KV.get(k.name);
    if (v) items.push(JSON.parse(v));
  }
  items.sort((a, b) => b.ts - a.ts);

  const avg = items.length ? (items.reduce((s, i) => s + i.rating, 0) / items.length).toFixed(2) : '-';
  const dist = [0, 0, 0, 0, 0];
  items.forEach(i => { dist[i.rating - 1]++; });

  const rows = items.map(i => {
    const d = new Date(i.ts + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16);
    const ctx = i.context || {};
    const top = ctx.top && ctx.top.name ? ctx.top.name : '—';
    const syms = (ctx.symptoms || []).map(s => s.label || s.id).slice(0, 5).join('、');
    const improved = i.status === 'improved';
    return `<tr>
      <td>${d}</td>
      <td>${'★'.repeat(i.rating)}${'☆'.repeat(5 - i.rating)}</td>
      <td>${escapeHtml((i.tags || []).join('、'))}</td>
      <td>${escapeHtml(i.text || '')}</td>
      <td class="ctx"><b>${escapeHtml(top)}</b>${syms ? '<br><span class="sym">' + escapeHtml(syms) + '</span>' : ''}</td>
      <td class="st">${improved ? '已改进' : '待改进'}${i.improveNote ? '<br><span class="sym">' + escapeHtml(i.improveNote) + '</span>' : ''}</td>
      <td>
        <form method="post" action="/api/feedback/status?key=${encodeURIComponent(key)}">
          <input type="hidden" name="id" value="${escapeHtml(i.id)}">
          <select name="status">
            <option value="open"${improved ? '' : ' selected'}>待改进</option>
            <option value="improved"${improved ? ' selected' : ''}>已改进</option>
          </select>
          <input name="note" placeholder="改进说明" value="${escapeHtml(i.improveNote || '')}">
          <button type="submit">保存</button>
        </form>
      </td>
    </tr>`;
  }).join('');

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
</style></head><body>
<h1>明辨康途 · 反馈汇总</h1>
<p class="stat">共 ${items.length} 条 ｜ 平均 ${avg} 分 ｜ 分布 5★${dist[4]} 4★${dist[3]} 3★${dist[2]} 2★${dist[1]} 1★${dist[0]}</p>
<table><thead><tr><th>时间</th><th>评分</th><th>标签</th><th>建议</th><th>对应病症</th><th>改进</th><th>操作</th></tr></thead>
<tbody>${rows || '<tr><td colspan="7">还没有反馈</td></tr>'}</tbody></table>
</body></html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/feedback') return handleFeedback(request, env);
    if (url.pathname === '/api/feedback/list') return handleList(url, env);
    if (url.pathname === '/api/feedback/status') return handleStatus(request, url, env);

    /* 其余请求交给静态资源 */
    return env.ASSETS.fetch(request);
  }
};
