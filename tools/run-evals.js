/*
 * 服务端评测跑批：node tools/run-evals.js
 *
 * 跑 15 条危险信号 + 4 组负样本，输出 JSON：
 *   - docs/evals-latest.json    对外产物（可提交、可给评委看）
 *   - worker/evals-seed.json    Worker 打包兜底（KV 未发布时后台也能展示）
 *
 * 内容固定（generatedAt 使用评测集日期），CI 重跑不产生 diff。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'site', 'index.html');
const OUT_DOC = path.join(ROOT, 'docs', 'evals-latest.json');
const OUT_SEED = path.join(ROOT, 'worker', 'evals-seed.json');

const EVAL_VERSION = 'eval-v1';
const GENERATED_AT = '2026-11-22';

const html = fs.readFileSync(HTML, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  console.error('未找到 script 块');
  process.exit(1);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  m[1] + '\n;globalThis.__out = { RED_FLAGS, SYMPTOMS, flagsFor, computeTriage };',
  sandbox,
  { timeout: 5000 }
);
const { RED_FLAGS, SYMPTOMS, flagsFor, computeTriage } = sandbox.__out;

vm.runInContext('patientAge = 30;', sandbox);

const labelOf = id => (SYMPTOMS[id] ? SYMPTOMS[id].label : id);
const comboOf = f => (f.mode === 'all' ? f.ids.slice() : [f.ids[0]]);

const cases = RED_FLAGS.map(f => {
  const combo = comboOf(f);
  const hits = flagsFor(new Set(combo));
  const triage = computeTriage([], hits);
  return {
    title: f.title,
    input: combo.map(labelOf).join(' + '),
    level: triage.level,
    ok: triage.level === 'red'
  };
});

const negatives = [
  ['fatigue'],
  ['sore_throat', 'runny_nose'],
  ['headache'],
  ['diarrhea', 'abdominal_pain']
].map(combo => {
  const triage = computeTriage([], flagsFor(new Set(combo)));
  return {
    input: combo.map(labelOf).join(' + '),
    level: triage.level,
    falsePositive: triage.level === 'red'
  };
});

const red = cases.filter(c => c.ok).length;
const falsePositive = negatives.filter(n => n.falsePositive).length;

const result = {
  version: EVAL_VERSION,
  generatedAt: GENERATED_AT,
  total: cases.length,
  red,
  redRate: cases.length ? Number((red / cases.length).toFixed(4)) : 0,
  negatives: negatives.length,
  falsePositive,
  falsePositiveRate: negatives.length ? Number((falsePositive / negatives.length).toFixed(4)) : 0,
  cases,
  negativeCases: negatives
};

fs.mkdirSync(path.dirname(OUT_DOC), { recursive: true });
fs.mkdirSync(path.dirname(OUT_SEED), { recursive: true });
fs.writeFileSync(OUT_DOC, JSON.stringify(result, null, 2) + '\n', 'utf8');
fs.writeFileSync(OUT_SEED, JSON.stringify(result, null, 2) + '\n', 'utf8');

if (red !== cases.length || falsePositive > 0) {
  console.error('评测未通过：判红 ' + red + '/' + cases.length + '，误报 ' + falsePositive);
  process.exit(1);
}

console.log('评测通过：危险信号 ' + red + '/' + cases.length + ' 判红；负样本 ' +
  negatives.length + ' 组，误报 ' + falsePositive);
console.log('已写入 docs/evals-latest.json 与 worker/evals-seed.json');