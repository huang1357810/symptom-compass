/*
 * 故障降级自测：node tools/test-degrade.js（已加入 run-all-tests）
 *
 * 覆盖 4 项：
 *   1. 断网：天气提示块隐藏，分诊纯函数仍可用
 *   2. /api/feedback 500：提示可重试，且不清空已选症状
 *   3. KV 不可用：后台 503，前端不抛错、走本地保存
 *   4. 清 Cookie：自动降级游客，反馈带 anonId
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

if (!globalThis.crypto) globalThis.crypto = require('crypto').webcrypto;

const ROOT = path.join(__dirname, '..');

function mockEl() {
  return {
    classList: { add() {}, remove() {}, toggle() {} },
    style: {}, dataset: {}, value: '', textContent: '', innerHTML: '',
    disabled: false, hidden: false, open: false, className: '',
    setAttribute() {}, getAttribute() { return null; },
    scrollIntoView() {}, addEventListener() {}, appendChild() {},
    querySelectorAll() { return []; }, querySelector() { return mockEl(); }
  };
}

function makeStorage(init) {
  const mem = Object.assign({}, init || {});
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem(k, v) { mem[k] = String(v); },
    removeItem(k) { delete mem[k]; },
    _mem: mem
  };
}

async function loadWorker() {
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
    getCookie: auth.getCookie, sessionCookie: auth.sessionCookie,
    clearCookie: auth.clearCookie, jsonNoStore: auth.jsonNoStore,
    __worker: null
  });
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { timeout: 10000 });
  return sandbox.__worker;
}

async function loadFrontend() {
  const html = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('未找到 script 块');

  const els = {};
  const calls = [];
  const storage = makeStorage({ 'mingbian.envCity.v1': '杭州' });

  const sandbox = {
    console, Date, Math, JSON, Set, Map, Array, Object, String, Number, Promise,
    setTimeout, clearTimeout, AbortController: globalThis.AbortController,
    Response: globalThis.Response, Request: globalThis.Request, Headers: globalThis.Headers,
    TextEncoder: globalThis.TextEncoder,
    localStorage: storage,
    location: { search: '', href: '' },
    history: { replaceState() {} },
    navigator: {},
    alert() {}, confirm() { return true; },
    document: {
      getElementById(id) { if (!els[id]) els[id] = mockEl(); return els[id]; },
      querySelector() { return mockEl(); },
      querySelectorAll() { return []; },
      addEventListener() {},
      createElement() { return mockEl(); }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  let fetchImpl = async () => new Response('{"ok":false}', { status: 500, headers: { 'Content-Type': 'application/json' } });
  sandbox.fetch = function (url, opts) {
    calls.push({ url: String(url), opts: opts || {} });
    return fetchImpl(url, opts);
  };

  vm.createContext(sandbox);
  vm.runInContext(
    m[1] + '\n;globalThis.__out={fbSubmit,initAccount,initWeatherTips,scoreConditions,selected,lastResults,accountMe};',
    sandbox,
    { timeout: 10000 }
  );

  return { sandbox, els, calls, storage, setFetch(fn) { fetchImpl = fn; } };
}

(async () => {
  const errors = [];
  const ok = (name, cond, detail) => {
    if (!cond) errors.push(name + (detail ? '：' + detail : ''));
  };

  /* ---------- 1. 断网：天气隐藏，分诊可用 ---------- */
  const fe = await loadFrontend();
  fe.setFetch(async () => { throw new Error('offline'); });
  await vm.runInContext('initWeatherTips()', fe.sandbox).catch(() => {});
  await new Promise(r => setTimeout(r, 50));
  ok('断网时天气提示块隐藏', fe.els.envTips && fe.els.envTips.hidden === true,
    'hidden=' + (fe.els.envTips && fe.els.envTips.hidden));
  const results = vm.runInContext('scoreConditions(new Set(["sore_throat","fever"]))', fe.sandbox);
  ok('断网时分诊纯函数仍可用', Array.isArray(results) && results.length > 0, '结果数=' + (results && results.length));

  /* ---------- 2. 反馈 500：提示重试，不清空已选 ---------- */
  vm.runInContext('selected.clear(); selected.add("fever"); selected.add("sore_throat"); fbRating=5; fbTags.clear();', fe.sandbox);
  fe.setFetch(async () => new Response('{"ok":false,"error":"http 500"}', {
    status: 500, headers: { 'Content-Type': 'application/json' }
  }));
  await vm.runInContext('fbSubmit()', fe.sandbox);
  ok('反馈 500 时提示可重试', String(fe.els.fbStatus.textContent || '').indexOf('重试') !== -1,
    '状态文案：' + fe.els.fbStatus.textContent);
  ok('反馈失败不清空已选症状', vm.runInContext('selected.has("fever")', fe.sandbox) === true);

  /* ---------- 3. KV 不可用：后台 503，前端无感 ---------- */
  const worker = await loadWorker();
  const noKvEnv = { FEEDBACK_KV: null, ADMIN_KEY: 'k', ASSETS: { fetch: async () => new Response('static') } };
  const r503 = await worker.fetch(new Request('https://example.com/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '7.7.7.7' },
    body: JSON.stringify({ rating: 5, tags: [], text: 'x' })
  }), noKvEnv);
  ok('KV 不可用时后台返回 503', r503.status === 503, 'HTTP ' + r503.status);

  fe.setFetch(async () => new Response('{"ok":false,"error":"no_store"}', {
    status: 503, headers: { 'Content-Type': 'application/json' }
  }));
  let threw = false;
  try { await vm.runInContext('fbSubmit()', fe.sandbox); } catch (e) { threw = true; }
  ok('KV 不可用时前端不抛错', threw === false);
  ok('KV 不可用时走本地保存', String(fe.els.fbStatus.textContent || '').indexOf('重试') !== -1,
    '状态文案：' + fe.els.fbStatus.textContent);

  /* ---------- 4. 清 Cookie：游客模式 + anonId ---------- */
  fe.setFetch(async (url) => {
    if (String(url).indexOf('/api/auth/me') !== -1) {
      return new Response('{"ok":false,"error":"unauthorized"}', { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{"ok":true,"id":"t1"}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  await vm.runInContext('initAccount()', fe.sandbox);
  await new Promise(r => setTimeout(r, 30));
  ok('清 Cookie 后降级为游客', vm.runInContext('accountMe === null', fe.sandbox) === true);

  fe.calls.length = 0;
  vm.runInContext('fbSubmit()', fe.sandbox);
  await new Promise(r => setTimeout(r, 30));
  const fbCall = fe.calls.find(c => c.url.indexOf('/api/feedback') !== -1);
  let body = {};
  try { body = JSON.parse(fbCall.opts.body); } catch (e) {}
  ok('游客反馈带 anonId', typeof body.anonId === 'string' && body.anonId.length > 0, JSON.stringify(body.anonId || ''));
  ok('游客反馈不带 userId', body.userId === undefined, JSON.stringify(body.userId || ''));

  if (errors.length) {
    console.error('降级演练失败：\n  ' + errors.join('\n  '));
    process.exit(1);
  }
  console.log('降级演练 9/9 通过（断网天气 / 反馈 500 / KV 503 / 清 Cookie 游客 + anonId）');
})();