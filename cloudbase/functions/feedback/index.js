/**
 * 明辨康途 · 腾讯云 CloudBase 云函数（反馈接口）
 *
 * 路由（HTTP 访问服务把 /api/* 转发到本函数）：
 *   POST /api/feedback                 提交反馈
 *   GET  /api/feedback/list?key=xxx    后台汇总页
 *   POST /api/feedback/status?key=xxx  标记已改进
 *
 * 存储：云数据库集合 feedback
 *   rating / tags / text / page / context / status / improveNote / createdAt / ua / ipHash
 *
 * 环境变量：ADMIN_KEY（后台页与标记接口的鉴权密钥）
 * 说明：@cloudbase/node-sdk 只在 exports.main 内加载，方便用假 DB 做单元测试。
 */
const crypto = require('crypto');
const { summarizeFeedback } = require('./stats');

const COL = 'feedback';
const MAX_TEXT = 300;
const MAX_TAGS = 5;
const MAX_TAG_LEN = 20;
const MAX_PAGE = 40;
const MAX_UA = 200;
const MAX_NOTE = 200;
const RATE_LIMIT = 5;
const RATE_WINDOW = 60 * 1000;
const LIST_LIMIT = 500;

function json(body, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

function html(body, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    body
  };
}

function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .filter(t => typeof t === 'string' && t.trim())
    .map(t => t.trim().slice(0, MAX_TAG_LEN))
    .slice(0, MAX_TAGS);
}

function normalizeContext(ctx) {
  if (!ctx || typeof ctx !== 'object') {
    return { top: null, results: [], symptoms: [], triage: '' };
  }
  const item = (x) => {
    if (!x || typeof x !== 'object') return null;
    const id = str(x.id, 40);
    const name = str(x.name, 60);
    if (!id && !name) return null;
    const score = Number(x.score);
    return { id, name, score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null };
  };
  const results = Array.isArray(ctx.results) ? ctx.results.slice(0, 3).map(item).filter(Boolean) : [];
  const top = item(ctx.top) || results[0] || null;
  const symptoms = Array.isArray(ctx.symptoms)
    ? ctx.symptoms.slice(0, 20).map(s => ({
        id: str(s && s.id, 40),
        label: str(s && s.label, 20)
      })).filter(s => s.id || s.label)
    : [];
  return { top, results, symptoms, triage: str(ctx.triage, 10) };
}

function header(headers, name) {
  if (!headers) return '';
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return String(headers[key] || '');
  }
  return '';
}

function parseBody(event) {
  const raw = event.body || '';
  const bodyText = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
  const type = header(event.headers, 'content-type');
  if (type.indexOf('application/json') !== -1 || bodyText.trim().startsWith('{')) {
    try {
      return { data: JSON.parse(bodyText), form: false };
    } catch (e) {
      return { data: null, form: false };
    }
  }
  const params = new URLSearchParams(bodyText);
  const data = {};
  for (const key of params.keys()) {
    data[key] = params.get(key);
  }
  return { data, form: true };
}

function ipHash(event) {
  const raw = header(event.headers, 'x-forwarded-for') || header(event.headers, 'client-ip');
  const ip = String(raw).split(',')[0].trim() || 'unknown';
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

function fmtTime(value) {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return '—';
  return new Date(t + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16);
}

function renderList(key, items) {
  const stats = summarizeFeedback(items);
  const pending = items.filter(i => i.status !== 'improved').length;
  const improved = items.filter(i => i.status === 'improved').length;

  const distRows = [5, 4, 3, 2, 1].map(star => {
    const n = stats.dist[star - 1];
    const pct = stats.total ? Math.round(n / stats.total * 100) : 0;
    return '<div class="drow"><span class="dstar">' + star + '★</span>' +
      '<span class="dbar"><i style="width:' + pct + '%"></i></span>' +
      '<span class="dnum">' + n + '</span></div>';
  }).join('');

  const lowRows = stats.lowTop.length
    ? stats.lowTop.map(g =>
        '<tr><td>' + escapeHtml(g.name) + '</td><td>' + g.low + '</td><td>' + g.total + '</td><td>' + g.avg + '</td></tr>'
      ).join('')
    : '<tr><td colspan="4">还没有 1–2 星的低分反馈</td></tr>';

  const rows = items.map(i => {
    const ctx = i.context || {};
    const top = ctx.top && ctx.top.name ? ctx.top.name : '—';
    const syms = (ctx.symptoms || []).map(s => s.label || s.id).slice(0, 5).join('、');
    const done = i.status === 'improved';
    return '<tr>' +
      '<td>' + fmtTime(i.createdAt || i.ts) + '</td>' +
      '<td>' + '★'.repeat(i.rating || 0) + '☆'.repeat(5 - (i.rating || 0)) + '</td>' +
      '<td>' + escapeHtml((i.tags || []).join('、')) + '</td>' +
      '<td>' + escapeHtml(i.text || '') + '</td>' +
      '<td class="ctx"><b>' + escapeHtml(top) + '</b>' +
        (syms ? '<br><span class="sym">' + escapeHtml(syms) + '</span>' : '') + '</td>' +
      '<td class="st">' + (done ? '已改进' : '待改进') +
        (i.improveNote ? '<br><span class="sym">' + escapeHtml(i.improveNote) + '</span>' : '') + '</td>' +
      '<td>' +
        '<form method="post" action="/api/feedback/status?key=' + encodeURIComponent(key) + '">' +
          '<input type="hidden" name="id" value="' + escapeHtml(String(i._id || i.id || '')) + '">' +
          '<select name="status">' +
            '<option value="open"' + (done ? '' : ' selected') + '>待改进</option>' +
            '<option value="improved"' + (done ? ' selected' : '') + '>已改进</option>' +
          '</select>' +
          '<input name="note" placeholder="改进说明" value="' + escapeHtml(i.improveNote || '') + '">' +
          '<button type="submit">保存</button>' +
        '</form>' +
      '</td>' +
    '</tr>';
  }).join('');

  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<title>明辨康途 · 反馈（' + items.length + ' 条）</title>' +
    '<style>' +
    'body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;margin:24px;color:#103b38;background:#f4faf9}' +
    'h1{font-size:18px} .stat{color:#5d7b78;font-size:13px;margin-bottom:14px}' +
    'table{border-collapse:collapse;width:100%;background:#fff;font-size:13px}' +
    'th,td{border:1px solid #dde9e7;padding:8px 10px;text-align:left;vertical-align:top}' +
    'th{background:#eaf7f4} td:nth-child(1){white-space:nowrap;color:#5d7b78}' +
    '.ctx b{color:#0b6f68} .sym{color:#7b9694;font-size:12px}' +
    'form{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:0}' +
    'select,input{font-size:12px;padding:2px 4px;border:1px solid #dde9e7;border-radius:4px}' +
    'button{font-size:12px;padding:3px 8px;border:1px solid #b9ded8;background:#eaf8f5;color:#0b6f68;border-radius:4px;cursor:pointer}' +
    '.dash{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:0 0 18px}' +
    '@media (max-width:760px){.dash{grid-template-columns:1fr}}' +
    '.panel{background:#fff;border:1px solid #dde9e7;border-radius:10px;padding:12px 14px}' +
    '.panel h2{font-size:14px;margin:0 0 10px}' +
    '.drow{display:flex;align-items:center;gap:8px;margin:6px 0;font-size:12px;color:#5d7b78}' +
    '.dstar{width:26px;text-align:right;color:#8a5a00}' +
    '.dbar{flex:1;height:10px;background:#eef6f4;border-radius:6px;overflow:hidden}' +
    '.dbar i{display:block;height:100%;background:linear-gradient(90deg,#7fd0c6,#0e8f86);border-radius:6px}' +
    '.dnum{width:34px;text-align:right;color:#103b38}' +
    'table.small{font-size:12px} table.small th,table.small td{padding:6px 8px}' +
    '</style></head><body>' +
    '<h1>明辨康途 · 反馈汇总</h1>' +
    '<p class="stat">共 ' + stats.total + ' 条 ｜ 平均 ' + (stats.total ? stats.avg.toFixed(2) : '-') +
      ' 分 ｜ 待改进 ' + pending + ' 条 ｜ 已改进 ' + improved + ' 条</p>' +
    '<div class="dash">' +
      '<div class="panel"><h2>评分分布</h2>' + distRows + '</div>' +
      '<div class="panel"><h2>低分病症 Top5（1–2 星）</h2>' +
        '<table class="small"><thead><tr><th>病症</th><th>低分</th><th>总数</th><th>均分</th></tr></thead>' +
        '<tbody>' + lowRows + '</tbody></table>' +
      '</div>' +
    '</div>' +
    '<table><thead><tr><th>时间</th><th>评分</th><th>标签</th><th>建议</th><th>对应病症</th><th>改进</th><th>操作</th></tr></thead>' +
    '<tbody>' + (rows || '<tr><td colspan="7">还没有反馈</td></tr>') + '</tbody></table>' +
    '</body></html>';
}

function createHandler(options) {
  const store = options && options.store;
  if (!store) throw new Error('store is required');
  const adminKey = options.adminKey !== undefined ? options.adminKey : process.env.ADMIN_KEY;
  const now = options.now || (() => Date.now());

  return async function handler(event) {
    const e = event || {};
    const method = String(e.httpMethod || e.method || 'GET').toUpperCase();
    const path = String(e.path || '/');
    const query = e.queryStringParameters || {};
    const headers = e.headers || {};

    if (path === '/api/feedback') {
      if (method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

      const parsed = parseBody(e);
      const body = parsed.data;
      if (!body || typeof body !== 'object') return json({ ok: false, error: 'invalid_body' }, 400);

      const rating = Number(body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return json({ ok: false, error: 'invalid_rating' }, 400);
      }

      const iph = ipHash(e);
      const recent = await store.countRecent(iph, now() - RATE_WINDOW);
      if (recent >= RATE_LIMIT) return json({ ok: false, error: 'rate_limited' }, 429);

      const record = {
        rating,
        tags: normalizeTags(body.tags),
        text: str(body.text, MAX_TEXT),
        page: str(body.page, MAX_PAGE),
        context: normalizeContext(body.context),
        status: 'open',
        improveNote: '',
        createdAt: new Date(now()),
        ua: header(headers, 'user-agent').slice(0, MAX_UA),
        ipHash: iph
      };
      const id = await store.insert(record);
      return json({ ok: true, id });
    }

    if (path === '/api/feedback/list') {
      if (!adminKey) return json({ ok: false, error: 'admin_key_not_configured' }, 401);
      const key = String(query.key || '');
      if (key !== adminKey) return json({ ok: false, error: 'unauthorized' }, 401);
      const items = await store.list(LIST_LIMIT);
      return html(renderList(key, items));
    }

    if (path === '/api/feedback/status') {
      if (!adminKey) return json({ ok: false, error: 'admin_key_not_configured' }, 401);
      const key = String(query.key || '');
      if (key !== adminKey) return json({ ok: false, error: 'unauthorized' }, 401);
      if (method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

      const parsed = parseBody(e);
      const body = parsed.data || {};
      const id = str(String(body.id || ''), 80);
      const status = body.status === 'improved' ? 'improved' : 'open';
      const note = str(body.note, MAX_NOTE);
      if (!id) return json({ ok: false, error: 'missing_id' }, 400);

      const row = await store.findById(id);
      if (!row) return json({ ok: false, error: 'not_found' }, 404);
      await store.update(id, { status, improveNote: note, updatedAt: new Date(now()) });

      if (parsed.form) {
        return {
          statusCode: 303,
          headers: { Location: '/api/feedback/list?key=' + encodeURIComponent(key) },
          body: ''
        };
      }
      return json({ ok: true });
    }

    return json({ ok: false, error: 'not_found' }, 404);
  };
}

/** 把 CloudBase 数据库包装成可测试的 store 接口 */
function cloudbaseStore(db) {
  const command = db.command;
  return {
    async countRecent(ipHash, sinceMs) {
      const res = await db.collection(COL).where({
        ipHash,
        createdAt: command.gte(new Date(sinceMs))
      }).count();
      return res.total || 0;
    },
    async insert(record) {
      const res = await db.collection(COL).add(record);
      return res.id || '';
    },
    async list(limit) {
      const res = await db.collection(COL).orderBy('createdAt', 'desc').limit(limit).get();
      return res.data || [];
    },
    async findById(id) {
      const res = await db.collection(COL).doc(id).get();
      const data = res.data || [];
      return data.length ? data[0] : null;
    },
    async update(id, patch) {
      await db.collection(COL).doc(id).update(patch);
    }
  };
}

exports.createHandler = createHandler;
exports.cloudbaseStore = cloudbaseStore;
exports.renderList = renderList;
exports.normalizeContext = normalizeContext;

exports.main = async function main(event) {
  // 只在真实环境加载 SDK，单元测试不会被触发
  const tcb = require('@cloudbase/node-sdk');
  const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV });
  const db = app.database();
  const handler = createHandler({
    store: cloudbaseStore(db),
    adminKey: process.env.ADMIN_KEY
  });
  return handler(event);
};