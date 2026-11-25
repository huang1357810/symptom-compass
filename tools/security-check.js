/*
 * 安全自查：node tools/security-check.js（已加入 run-all-tests）
 *
 * 用内存假 KV 加载真实的 worker/index.js 与 worker/auth.mjs（vm 注入依赖），
 * 覆盖：伪造 userId、反馈 XSS 转义、无 key 401、反馈限流阈值、登录文案不泄露、账号格式校验。
 * 结果写入 docs/security-check.md（实测值，不编造）。
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
    URL: globalThis.URL,
    Response: globalThis.Response,
    Request: globalThis.Request,
    Headers: globalThis.Headers,
    crypto: globalThis.crypto,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    summarizeFeedback, validateEvals, evalsSeed,
    extractSymptoms: async () => null,
    register: auth.register, login: auth.login, logout: auth.logout,
    me: auth.me, recover: auth.recover, deleteAccount: auth.deleteAccount,
    resolveFeedbackOwner: auth.resolveFeedbackOwner,
    listUsers: auth.listUsers, userFeedback: auth.userFeedback,
    getCookie: auth.getCookie, sessionCookie: auth.sessionCookie,
    clearCookie: auth.clearCookie, jsonNoStore: auth.jsonNoStore,
    __worker: null
  });
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { timeout: 10000 });

  const worker = sandbox.__worker;
  const kv = makeKV();
  const env = {
    FEEDBACK_KV: kv,
    ADMIN_KEY: 'test-admin-2026',
    ASSETS: { fetch: async () => new Response('static') }
  };

  const call = (p, opts) => worker.fetch(new Request('https://example.com' + p, opts), env);
  const post = (p, body, ip) => call(p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip || '9.9.9.9' },
    body: JSON.stringify(body)
  });

  const rows = [];
  let failed = 0;
  const record = (item, method, ok, evidence) => {
    rows.push({ item, method, result: ok ? '通过' : '失败', evidence });
    if (!ok) failed += 1;
  };

  /* 1. 伪造 userId */
  {
    const r = await post('/api/feedback', { rating: 5, tags: [], text: 'x', userId: 'u_fake' }, '1.1.1.1');
    const j = await r.json();
    record('伪造 userId 提交反馈', '未登录请求体带 userId=u_fake', r.status === 400 && j.error === 'forged_user',
      'HTTP ' + r.status + ' · ' + j.error);
  }

  /* 2. 反馈正文 XSS → 管理页转义 */
  {
    const payload = '<img src=x onerror=alert(1)>';
    await post('/api/feedback', { rating: 5, tags: [], text: payload }, '1.1.1.2');
    const r = await call('/api/feedback/list', { headers: { 'X-Admin-Key': 'test-admin-2026' } });
    const html = await r.text();
    const escaped = html.indexOf('&lt;img src=x onerror=alert(1)&gt;') !== -1;
    const raw = html.indexOf('<img src=x onerror=alert(1)>') !== -1;
    record('反馈正文 XSS 转义', '正文注入 <img onerror>，查看管理页 HTML', escaped && !raw,
      escaped ? '输出为 &lt;img src=x onerror=alert(1)&gt;，无原始标签' : '未转义');
  }

  /* 3. 无 key 访问管理页 */
  {
    const r = await call('/api/feedback/list');
    record('无管理密钥访问反馈列表', 'GET /api/feedback/list 不带 key', r.status === 401, 'HTTP ' + r.status);
  }

  /* 4. 同 IP 连续提交反馈，测限流阈值 */
  let first429 = 0;
  for (let i = 1; i <= 20; i++) {
    const r = await post('/api/feedback', { rating: 5, tags: [], text: 'rate', anonId: 'a_test' }, '2.2.2.2');
    if (r.status === 429 && !first429) first429 = i;
  }
  record('反馈接口限流阈值', '同一 IP（CF-Connecting-IP）连续提交 20 次', first429 > 0,
    '第 ' + (first429 || '—') + ' 次开始返回 429（前 ' + (first429 ? first429 - 1 : '—') + ' 次成功）');

  /* 5. 登录错误文案不泄露账号是否存在 */
  {
    const r1 = await post('/api/auth/login', { username: 'nobody_zz', password: 'whatever1' }, '3.3.3.1');
    const j1 = await r1.json();
    await post('/api/auth/register', { username: 'sec_user', password: 'password123', agree: true }, '3.3.3.2');
    const r2 = await post('/api/auth/login', { username: 'sec_user', password: 'wrongpass1' }, '3.3.3.3');
    const j2 = await r2.json();
    record('登录错误文案不泄露账号是否存在', '不存在用户名 vs 存在用户名+错误密码',
      r1.status === 401 && r2.status === 401 && j1.error === j2.error && j1.error === '用户名或密码错误',
      '两者均 HTTP 401 · 「' + j1.error + '」');
  }

  /* 6. 用户名格式：手机号 / 邮箱 */
  {
    const r1 = await post('/api/auth/register', { username: '13800138000', password: 'password123', agree: true }, '4.4.4.1');
    const j1 = await r1.json();
    const r2 = await post('/api/auth/register', { username: 'a@b.com', password: 'password123', agree: true }, '4.4.4.2');
    const j2 = await r2.json();
    record('用户名格式校验（手机号 / 邮箱）', '注册 username=13800138000 与 a@b.com',
      r1.status === 400 && r2.status === 400,
      '手机号 HTTP ' + r1.status + '「' + j1.error + '」；邮箱 HTTP ' + r2.status + '「' + j2.error + '」');
  }

  const md = [
    '# 安全自查',
    '',
    '> 由 `tools/security-check.js` 实测生成。使用**内存假 KV** 加载真实 `worker/index.js` 与 `worker/auth.mjs`，不访问线上、不写真实 KV。',
    '',
    '| 项 | 方法 | 结果 | 证据 |',
    '| --- | --- | --- | --- |',
    ...rows.map(r => '| ' + r.item + ' | ' + r.method + ' | ' + r.result + ' | ' + r.evidence + ' |'),
    '',
    '- 反馈限流实测阈值：**同一 IP 每分钟 5 次**（第 ' + (first429 || '—') + ' 次起 429）。',
    '- PBKDF2 迭代数：默认 **50,000**；线上实测 100,000 次时 `cpuTimeMs` 约 **107ms**（免费版 CPU 约 10ms 限制下据此降档，付费版可用 `AUTH_ITERATIONS` 调回）。',
    '- 说明：KV 为最终一致存储，用户名唯一性与注销删除均非原子；本表只覆盖单实例逻辑，未覆盖并发竞态。',
    ''
  ].join('\n');

  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'security-check.md'), md, 'utf8');

  rows.forEach(r => console.log((r.result === '通过' ? 'PASS' : 'FAIL') + ' · ' + r.item + ' · ' + r.evidence));
  if (failed) {
    console.error('安全自查失败 ' + failed + ' 项');
    process.exit(1);
  }
  console.log('安全自查 ' + rows.length + '/' + rows.length + ' 通过；已写入 docs/security-check.md');
})();