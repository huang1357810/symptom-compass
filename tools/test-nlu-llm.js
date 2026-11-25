/*
 * LLM 症状抽取自测：node tools/test-nlu-llm.js（全部 mock fetch，不调真实 API）
 *
 * 覆盖：白名单过滤/去重/最多 8、JSON 非法回退、超时回退、超长/换行截断、
 * 模型返回病名不进入结果、symptom-ids 与 site 一致。
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

if (!globalThis.crypto) globalThis.crypto = require('crypto').webcrypto;

const ROOT = path.join(__dirname, '..');
const origFetch = globalThis.fetch;

function okResponse(contentObj) {
  return {
    ok: true,
    status: 200,
    async json() {
      return { choices: [{ message: { content: typeof contentObj === 'string' ? contentObj : JSON.stringify(contentObj) } }] };
    }
  };
}

(async () => {
  const nlu = await import(pathToFileURL(path.join(ROOT, 'worker', 'nlu-llm.mjs')).href);
  const llm = await import(pathToFileURL(path.join(ROOT, 'worker', 'llm.mjs')).href);

  const errors = [];
  const ok = (name, cond, detail) => { if (!cond) errors.push(name + (detail ? '：' + detail : '')); };
  const env = { LLM_API_KEY: 'test-key' };   /* 无 FEEDBACK_KV → 不缓存，避免干扰 */

  /* 1. 正常返回：过滤白名单、去重、最多 8 */
  globalThis.fetch = async () => okResponse({
    symptoms: ['fever', 'fever', 'not_a_real_id', '普通感冒', 'sore_throat'],
    negated: ['high_fever', 'fever', 'unknown_x']
  });
  let r = await nlu.extractSymptoms(env, '发烧嗓子疼');
  ok('正常返回可解析', !!r);
  ok('过滤非白名单 id', r && r.symptoms.indexOf('not_a_real_id') === -1 && r.symptoms.indexOf('普通感冒') === -1);
  ok('去重', r && r.symptoms.filter(x => x === 'fever').length === 1);
  ok('保留合法 id', r && r.symptoms.indexOf('fever') !== -1 && r.symptoms.indexOf('sore_throat') !== -1, JSON.stringify(r && r.symptoms));
  ok('negated 也过滤白名单', r && r.negated.indexOf('unknown_x') === -1);

  /* 最多 8 个 */
  const many = ['fever', 'high_fever', 'chills', 'fatigue', 'headache', 'nausea', 'vomiting', 'diarrhea', 'constipation', 'rash'];
  globalThis.fetch = async () => okResponse({ symptoms: many, negated: [] });
  r = await nlu.extractSymptoms(env, 'lots');
  ok('最多返回 8 个', r && r.symptoms.length === 8, r && r.symptoms.length);

  /* 2. JSON 非法 → null */
  globalThis.fetch = async () => okResponse('这不是 JSON');
  r = await nlu.extractSymptoms(env, '坏 JSON');
  ok('JSON 非法返回 null（上层回退）', r === null);

  /* 3. 超时 → 空（callLLM 返回 timeout，extractSymptoms 返回 null） */
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
  r = await nlu.extractSymptoms(env, '超时');
  ok('超时返回 null（上层回退）', r === null);
  ok('失败重试 1 次（共 2 次调用）', calls === 2, 'calls=' + calls);

  /* 3b. 401 → http_401，且不重试（评测脚本据此返回退出码 1） */
  let calls401 = 0;
  globalThis.fetch = async () => { calls401 += 1; return { ok: false, status: 401, async json() { return {}; } }; };
  const r401 = await llm.callLLM(env, [{ role: 'user', content: 'x' }]);
  ok('401 返回 http_401', r401.ok === false && r401.error === 'http_401', JSON.stringify(r401));
  ok('401 不重试（仅 1 次）', calls401 === 1, 'calls=' + calls401);

  /* 4. 文本含换行/超长 → 规范化截断 */
  ok('换行被压成空格', nlu.normalizeText('发\n烧\n头\t疼').indexOf('\n') === -1, nlu.normalizeText('发\n烧\n头\t疼'));
  ok('超长截断到 200', nlu.normalizeText('a'.repeat(500)).length === 200);

  let capturedBody = null;
  globalThis.fetch = async (url, opts) => { capturedBody = JSON.parse(opts.body); return okResponse({ symptoms: ['fever'], negated: [] }); };
  await nlu.extractSymptoms(env, '发\n烧'.concat('x'.repeat(300)));
  const userMsg = capturedBody ? capturedBody.messages[capturedBody.messages.length - 1].content : '';
  ok('发给模型的文本已去换行', userMsg.indexOf('\n') === -1, JSON.stringify(userMsg.slice(0, 20)));
  ok('发给模型的文本 ≤200 字', userMsg.length <= 200, userMsg.length);

  /* 5. 病名不进结果 */
  globalThis.fetch = async () => okResponse({ symptoms: ['普通感冒', '流感', 'fever'], negated: [] });
  r = await nlu.extractSymptoms(env, '可能感冒了发烧');
  ok('模型返回病名被过滤', r && r.symptoms.indexOf('普通感冒') === -1 && r.symptoms.indexOf('流感') === -1, JSON.stringify(r && r.symptoms));
  ok('合法症状保留', r && r.symptoms.indexOf('fever') !== -1);

  /* 6. symptom-ids 与 site 一致 */
  const html = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  const vm = require('vm');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(m[1] + '\n;globalThis.__out={SYMPTOM_IDS};', sandbox, { timeout: 8000 });
  const siteIds = sandbox.__out.SYMPTOM_IDS.slice().sort().join(',');
  const workerIds = nlu.symptomsListForTest ? nlu.symptomsListForTest().slice().sort().join(',') : '';
  /* 通过导入 symptom-ids 模块比对 */
  const idModule = await import(pathToFileURL(path.join(ROOT, 'worker', 'symptom-ids.mjs')).href);
  ok('worker 症状白名单与 site 一致', idModule.SYMPTOM_IDS.slice().sort().join(',') === siteIds);
  ok('白名单为 84 个', idModule.SYMPTOM_IDS.length === 84, idModule.SYMPTOM_IDS.length);

  globalThis.fetch = origFetch;

  if (errors.length) {
    console.error('LLM 症状抽取校验失败：\n  ' + errors.join('\n  '));
    process.exit(1);
  }
  console.log('LLM 症状抽取 19/19 通过（白名单/去重/最多8/JSON非法/超时重试/401不重试/截断/病名过滤/白名单一致）');
})();