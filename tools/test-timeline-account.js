/*
 * 账号时间轴自测：node tools/test-timeline-account.js
 *
 * 假 KV + vm 加载真实 worker/index.js：
 *   未登录 401、登录后可读写、按账号隔离、注销级联删除时间轴。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

if (!globalThis.crypto) globalThis.crypto = require('crypto').webcrypto;

const ROOT = path.join(__dirname, '..');

function makeKV() {
  const map = new Map();
  return {
    map,
    async get(k) { return map.has(k) ? map.get(k) : null; },
    async put(k, v) { map.set(k, String(v)); },
    async delete(k) { map.delete(k); },
    async list(opts) {
      const prefix = (opts && opts.prefix) || '';
      const all = Array.from(map.keys()).filter(k => k.indexOf(prefix) === 0).sort();
      return { keys: all.map(name => ({ name })), list_complete: true };
    }
  };
}

(async () => {
  const auth = await import(pathToFileURL(path.join(ROOT, 'worker', 'auth.mjs')).href);
  const { summarizeFeedback } = await import(pathToFileURL(path.join(ROOT, 'worker', 'feedback-stats.mjs')).href);
  const { validateEvals } = await import(pathToFileURL(path.join(ROOT, 'worker', 'evals-schema.mjs')).href);
  const evalsSeed = JSON.parse(fs.readFileSync(path.join(ROOT, 'worker', 'evals-seed.json'), 'utf8'));

  let src = fs.readFileSync(path.join(ROOT, 'worker', 'index.js'), 'utf8');
  src = src.replace(/^import \{ summarizeFeedback \} from '\.\/feedback-stats\.mjs';$/m, '');
  src = src.replace(/^import \{ validateEvals \} from '\.\/evals-schema\.mjs';$/m, '');
  src = src.replace(/^import \{[\s\S]*?\} from '\.\/auth\.mjs';$/m, '');
  src = src.replace(/^import evalsSeed from '\.\/evals-seed\.json';$/m, '');
  src = src.replace(/^import \{ extractSymptoms \} from '\.\/nlu-llm\.mjs';$/m, '');
  src = src.replace('export default {', 'globalThis.__worker = {');

  const sandbox = Object.assign({}, globalThis, {
    URL: globalThis.URL, Response: globalThis.Response, Request: globalThis.Request,
    Headers: globalThis.Headers, crypto: globalThis.crypto,
    TextEncoder: globalThis.TextEncoder, TextDecoder: globalThis.TextDecoder,
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    summarizeFeedback, validateEvals, evalsSeed,
    extractSymptoms: async () => null,
    register: auth.register, login: auth.login, logout: auth.logout, me: auth.me,
    recover: auth.recover, deleteAccount: auth.deleteAccount,
    resolveFeedbackOwner: auth.resolveFeedbackOwner,
    listUsers: auth.listUsers, userFeedback: auth.userFeedback,
    timelineGet: auth.timelineGet, timelineAppend: auth.timelineAppend, timelineClear: auth.timelineClear,
    getCookie: auth.getCookie, sessionCookie: auth.sessionCookie,
    clearCookie: auth.clearCookie, jsonNoStore: auth.jsonNoStore,
    __worker: null
  });
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { timeout: 10000 });

  const worker = sandbox.__worker;
  const kv = makeKV();
  const env = { FEEDBACK_KV: kv, ADMIN_KEY: 'k', ASSETS: { fetch: async () => new Response('static') } };

  const call = (p, opts) => worker.fetch(new Request('https://example.com' + p, opts), env);
  const post = (p, body, cookie) => call(p, {
    method: 'POST',
    headers: Object.assign(
      { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' },
      cookie ? { Cookie: 'mb_session=' + cookie } : {}
    ),
    body: JSON.stringify(body)
  });
  const cookieOf = res => {
    const m = String(res.headers.get('Set-Cookie') || '').match(/mb_session=([^;]+)/);
    return m ? m[1] : '';
  };

  const errors = [];
  const ok = (name, cond, detail) => {
    if (!cond) errors.push(name + (detail ? '：' + detail : ''));
  };

  /* 1. 未登录全部 401 */
  for (const method of ['GET', 'POST', 'DELETE']) {
    const r = await call('/api/timeline', method === 'GET'
      ? { method: 'GET' }
      : { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    ok('未登录 ' + method + ' 返回 401', r.status === 401, 'HTTP ' + r.status);
  }

  /* 2. 注册并登录 */
  const reg = await post('/api/auth/register', { username: 'tl_user', password: 'password123', agree: true });
  const token = cookieOf(reg);
  ok('注册后拿到会话 Cookie', typeof token === 'string' && token.length > 0);

  /* 3. POST 单条 */
  const one = await post('/api/timeline', {
    date: '2026-01-01',
    entry: { score: 3, source: 'auto', level: 'green', sym: ['fever'], symptoms: { fever: 3 } }
  }, token);
  const oneData = await one.json();
  ok('登录后可追加一条', one.ok && oneData.ok && oneData.timeline.days['2026-01-01'].score === 3,
    JSON.stringify(oneData.timeline && oneData.timeline.days));

  /* 4. 批量合并：同日取高分、症状并集 */
  const batch = await post('/api/timeline', {
    days: {
      '2026-01-01': { score: 5, source: 'auto', level: 'yellow', sym: ['cough'], symptoms: { cough: 4 } },
      '2026-01-02': { score: 2, source: 'manual', level: '', sym: ['headache'], symptoms: { headache: 2 } }
    }
  }, token);
  const batchData = await batch.json();
  const d1 = batchData.timeline.days['2026-01-01'];
  ok('同日合并取较高分', d1.score === 5, JSON.stringify(d1));
  ok('同日症状取并集', d1.sym.indexOf('fever') >= 0 && d1.sym.indexOf('cough') >= 0, JSON.stringify(d1.sym));
  ok('症状分值保留最大值', d1.symptoms.fever === 3 && d1.symptoms.cough === 4, JSON.stringify(d1.symptoms));
  ok('新增日期写入', batchData.timeline.days['2026-01-02'].source === 'manual');

  /* 5. GET 读回 */
  const got = await call('/api/timeline', { headers: { Cookie: 'mb_session=' + token } });
  const gotData = await got.json();
  ok('GET 可读回时间轴', got.ok && gotData.timeline.days['2026-01-01'] && gotData.timeline.days['2026-01-02']);

  /* 6. 账号隔离 */
  const reg2 = await post('/api/auth/register', { username: 'tl_user2', password: 'password123', agree: true });
  const token2 = cookieOf(reg2);
  const got2 = await call('/api/timeline', { headers: { Cookie: 'mb_session=' + token2 } });
  const got2Data = await got2.json();
  ok('不同账号时间轴隔离', Object.keys(got2Data.timeline.days).length === 0,
    JSON.stringify(got2Data.timeline.days));

  /* 7. DELETE 清空 */
  const del = await call('/api/timeline', { method: 'DELETE', headers: { Cookie: 'mb_session=' + token } });
  const got3 = await call('/api/timeline', { headers: { Cookie: 'mb_session=' + token } });
  const got3Data = await got3.json();
  ok('DELETE 清空时间轴', del.ok && Object.keys(got3Data.timeline.days).length === 0);

  /* 8. 注销级联删除时间轴 */
  await post('/api/timeline', {
    days: { '2026-02-01': { score: 4, sym: ['rash'], symptoms: { rash: 4 } } }
  }, token);
  const userIdMatch = Array.from(kv.map.keys()).find(k => k.indexOf('timeline:') === 0);
  const userId = userIdMatch ? userIdMatch.slice('timeline:'.length) : '';
  ok('注销前时间轴已落库', !!userId && !!(await kv.get('timeline:' + userId)));

  const delAccount = await post('/api/account/delete', {}, token);
  ok('注销成功', delAccount.ok);
  ok('注销级联删除时间轴', (await kv.get('timeline:' + userId)) === null);
  const afterDel = await call('/api/timeline', { headers: { Cookie: 'mb_session=' + token } });
  ok('注销后旧会话失效（401）', afterDel.status === 401, 'HTTP ' + afterDel.status);

  if (errors.length) {
    console.error('账号时间轴校验失败：\n  ' + errors.join('\n  '));
    process.exit(1);
  }
  console.log('账号时间轴 15/15 通过（401 / 读写 / 合并去重 / 账号隔离 / 清空 / 注销级联）');
})();