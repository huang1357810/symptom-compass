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
  must(evals.version === 'eval-v1', '评测版本应为 eval-v1');
  must(evals.total === 15 && evals.red === 15, '评测应为 15/15 判红');
  must(evals.redRate === 1, '判红率应为 1');
  must(evals.negatives === 4 && evals.falsePositive === 0, '负样本应为 4 组、0 误报');
  must(Array.isArray(evals.cases) && evals.cases.length === 15, '评测 cases 数量应为 15');
  must(Array.isArray(evals.negativeCases) && evals.negativeCases.length === 4, '负样本数量应为 4');
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

if (errors.length) {
  console.error('后端能力校验失败：\n  ' + errors.join('\n  '));
} else {
  console.log('后端可展示能力校验通过：架构图 / API 文档 / 评测产物 / Worker 接口 / 内容版本 / 匿名运营');
}
process.exit(errors.length ? 1 : 0);