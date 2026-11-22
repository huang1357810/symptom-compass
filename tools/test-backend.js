/*
 * 后端可展示能力自测：node tools/test-backend.js
 * 覆盖：架构图/API 文档、评测跑批产物、Worker 新接口、内容版本、匿名运营与前端接线。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = p => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
const json = p => JSON.parse(read(p));

const html = read(path.join(ROOT, 'site', 'index.html'));
const worker = read(path.join(ROOT, 'worker', 'index.js'));
const privacy = read(path.join(ROOT, 'site', 'privacy.html'));

const errors = [];
const must = (cond, msg) => { if (!cond) errors.push(msg); };
const has = (text, needle, label) => must(text.indexOf(needle) !== -1, label + ' 缺少 ' + needle);

/* 1. 架构图 */
const arch = read(path.join(ROOT, 'docs', '架构图.md'));
must(arch.length > 0, '缺少 docs/架构图.md');
['```mermaid', '客户端', 'API', '存储', '部署拓扑', '数据流'].forEach(k => {
  must(arch.indexOf(k) !== -1, '架构图缺少 ' + k);
});

/* 2. API 文档 */
const api = read(path.join(ROOT, 'docs', 'API设计.md'));
must(api.length > 0, '缺少 docs/API设计.md');
['/api/triage', '/api/feedback', '/api/feedback/list', '/api/feedback/status', '/api/evals/latest', '/api/metrics/event'].forEach(k => {
  must(api.indexOf(k) !== -1, 'API 文档缺少 ' + k);
});
['400', '401', '404', '405', '429', '503'].forEach(k => {
  must(api.indexOf(k) !== -1, 'API 文档缺少错误码 ' + k);
});

/* 3. 评测产物 */
let evals;
try {
  evals = json(path.join(ROOT, 'docs', 'evals-latest.json'));
} catch (e) {
  errors.push('docs/evals-latest.json 不是合法 JSON');
}
if (evals) {
  must(evals.version === 'eval-v2', '评测版本应为 eval-v2');
  must(evals.total === 18 && evals.red === 18, '危险信号应为 18/18 判红');
  must(evals.redRate === 1, '判红率应为 1');
  must(evals.negatives === 8 && evals.falsePositive === 0, '负样本应为 8 组、0 误报');
  must(evals.caseTotal >= 40, '用例总数应 >= 40');
  must(Array.isArray(evals.categories) && evals.categories.length >= 5, '缺少按类别汇总');
  must(Array.isArray(evals.cases) && evals.cases.length === 18, '红旗用例应为 18');
  must(Array.isArray(evals.negativeCases) && evals.negativeCases.length === 8, '负样本应为 8');
}
const seed = path.join(ROOT, 'worker', 'evals-seed.json');
must(fs.existsSync(seed), '缺少 worker/evals-seed.json');
if (evals && fs.existsSync(seed)) {
  must(read(seed) === read(path.join(ROOT, 'docs', 'evals-latest.json')), 'seed 与 docs 评测结果不一致');
}

/* 4. run-evals 脚本 */
const runEvals = read(path.join(ROOT, 'tools', 'run-evals.js'));
['RED_FLAGS', 'flagsFor', 'computeTriage', 'evals-latest.json', 'evals-seed.json'].forEach(k => {
  must(runEvals.indexOf(k) !== -1, 'run-evals.js 缺少 ' + k);
});

/* 5. Worker 新接口与看板 */
['/api/evals/latest', '/api/evals/publish', '/api/metrics/event', 'handleMetrics', 'readEvals', 'readMetrics'].forEach(k => {
  must(worker.indexOf(k) !== -1, 'worker 缺少 ' + k);
});
['contentVersion', 'fixedVersion', '内容版本', '评测', '运营', '今日', '仅症状数与判红等级'].forEach(k => {
  must(worker.indexOf(k) !== -1, 'worker 缺少 ' + k);
});
must(worker.indexOf("'metrics:' + day") !== -1, '运营计数未按日聚合');

/* 6. 前端接线 */
['CONTENT_VERSION', 'FEEDBACK_API', 'METRICS_API', 'trackEvent', 'symptomCount'].forEach(k => {
  must(html.indexOf(k) !== -1, '前端缺少 ' + k);
});
must(html.indexOf('contentVersion: CONTENT_VERSION') !== -1, '反馈 payload 未带 contentVersion');
must(html.indexOf('fetch(FEEDBACK_API') !== -1, '反馈提交未使用可配置地址');

/* 匿名：trackEvent 只用 symptomCount + level */
const trackStart = html.indexOf('function trackEvent');
const trackEnd = html.indexOf('function fbContext');
const trackFn = trackStart !== -1 && trackEnd !== -1 ? html.slice(trackStart, trackEnd) : '';
must(trackFn.length > 0, '未找到 trackEvent 函数');
['name', 'age', 'chronic', 'photo', 'dir'].forEach(k => {
  if (k === 'name') {
    /* level/symptomCount 中不含 identity；这里检查没有显式字段 */
    must(trackFn.indexOf('userName') === -1 && trackFn.indexOf('patientAge') === -1, 'trackEvent 不应包含身份字段');
  }
});
must(trackFn.indexOf('symptomCount') !== -1 && trackFn.indexOf('level') !== -1, 'trackEvent 字段不完整');
must(trackFn.indexOf('.catch(') !== -1, 'trackEvent 未做静默失败');

/* 7. 隐私页已同步匿名统计 */
['匿名', '症状数量', '判红等级'].forEach(k => {
  must(privacy.indexOf(k) !== -1, '隐私页缺少匿名统计说明：' + k);
});

/* 8. 管理密钥改为 Secret，Header 优先 */
const wrangler = read(path.join(ROOT, 'wrangler.jsonc'));
must(wrangler.indexOf('mbkt-admin-2026') === -1, 'wrangler.jsonc 仍含明文 ADMIN_KEY');
must(wrangler.indexOf('wrangler secret put ADMIN_KEY') !== -1, 'wrangler.jsonc 缺少 secret 说明');
must(worker.indexOf('X-Admin-Key') !== -1, 'worker 缺少 Header 鉴权');
must(worker.indexOf('isAdmin(') !== -1, 'worker 缺少 isAdmin 统一鉴权');
must(worker.indexOf('deprecated') !== -1, 'worker 未标记 query key deprecated');
must(html.indexOf('mergeRedFlags') !== -1, '前端缺少远端红旗并集');

/* 9. 文档一致性 */
const readme = read(path.join(ROOT, 'README.md'));
['cloudbase/', 'pack-cloudbase.js', 'test-cloudbase-fn.js', 'config.example.js'].forEach(k => {
  must(readme.indexOf(k) === -1, 'README 仍引用已移除文件：' + k);
});
must(readme.indexOf('workers.dev') !== -1, 'README 线上地址未切到 Workers');
must(readme.indexOf('v2.10') !== -1, 'README 缺少版本 v2.10');
must(arch.indexOf('symptom-self-check.netlify.app') === -1, '架构图仍把 Netlify 当当前线上');
must(arch.indexOf('workers.dev') !== -1, '架构图缺少 Workers 地址');
must(api.indexOf('v2.10') !== -1, 'API 文档缺少版本 v2.10');
must(api.indexOf('X-Admin-Key') !== -1, 'API 文档缺少 Header 鉴权说明');

const readme02 = read(path.join(ROOT, 'readme', '02_部署运行步骤.md'));
must(readme02.indexOf('Cloudflare Workers（当前）') !== -1, 'readme/02 标题不符合要求');
must(readme02.indexOf('历史方案') !== -1, 'readme/02 未把 Netlify 标为历史方案');
must(readme02.indexOf('v2.10') !== -1, 'readme/02 缺少版本 v2.10');

const pkgPath = path.join(ROOT, 'package.json');
must(fs.existsSync(pkgPath), '缺少 package.json');
if (fs.existsSync(pkgPath)) {
  const p = JSON.parse(read(pkgPath));
  must(p.name === 'mingbian-kangtu', 'package.json name 不一致');
  must(p.version === '2.10.0', 'package.json version 应为 2.10.0');
}

/* 10. SW 与云端副本一致 */
const swSite = read(path.join(ROOT, 'site', 'sw.js'));
const swCloud = read(path.join(ROOT, 'cloud', 'functiongraph', 'sw.js'));
must(swSite === swCloud, 'site/sw.js 与 cloud/functiongraph/sw.js 不一致');
const swVer = /mingbian-kangtu-v(\d+)/.exec(swSite);
must(swVer !== null && Number(swVer[1]) >= 11, 'sw.js 缓存版本应 >= v11');
must(swSite.indexOf('isHome') !== -1, 'sw.js 未限制仅首页写 index.html 缓存');

/* 11. 批 2：转义 / schema / IP 哈希 / 问卷 / 超时 loading */
['renderUrgent', 'resetAnswers'].forEach(k => {
  must(html.indexOf(k) !== -1, '前端缺少 ' + k);
});
must(html.indexOf('AbortController') !== -1, '前端缺少远端分诊超时控制');
must(html.indexOf('10000') !== -1, '超时时间应为 10000ms');
must(html.indexOf('分析中') !== -1, '缺少分析中 loading 文案');

must(worker.indexOf('IP_SALT') !== -1, 'worker 未使用 IP_SALT 加盐');
must(worker.indexOf('SHA-256') !== -1, 'worker 未使用 SHA-256');
must(worker.indexOf('subtle.digest') !== -1, 'worker 未使用 crypto.subtle');
must(worker.indexOf('evals-schema.mjs') !== -1, 'worker 未引用评测 schema 校验');
must(fs.existsSync(path.join(ROOT, 'worker', 'evals-schema.mjs')), '缺少 worker/evals-schema.mjs');
must(privacy.indexOf('不用于识别个人') !== -1, '隐私页缺少 IP 哈希用途说明');

/* 12. 批 3：管理端健壮性与大字模式 */
['badRecords', 'list_complete', 'cursor', '2000', 'caseTotal'].forEach(k => {
  must(worker.indexOf(k) !== -1, 'worker 缺少 ' + k);
});
must(html.indexOf('large-text') !== -1, '前端缺少大字模式样式');
must(html.indexOf('--ui-scale:1.15') !== -1, '大字模式未放大 15%');

if (errors.length) {
  console.error('后端能力校验失败：\n  ' + errors.join('\n  '));
} else {
  console.log('后端可展示能力校验通过：架构图 / API 文档 / 评测产物 / Worker 接口 / 内容版本 / 匿名运营');
}
process.exit(errors.length ? 1 : 0);