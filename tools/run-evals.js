/*
 * 服务端评测跑批：node tools/run-evals.js
 *
 * 类别：
 *   1. 危险信号（全部要求判红）
 *   2. 问卷加权（按阈值断言绿/黄/红）
 *   3. 年龄分支（<1 岁发热必须红；老人不误判）
 *   4. 用药冲突（复用 AGE_MED_RULES / safetyCheck）
 *   5. 负样本（常见轻症不得判红）
 *
 * 输出：
 *   - docs/evals-latest.json    对外产物
 *   - worker/evals-seed.json    Worker 打包兜底
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'site', 'index.html');
const OUT_DOC = path.join(ROOT, 'docs', 'evals-latest.json');
const OUT_SEED = path.join(ROOT, 'worker', 'evals-seed.json');

const EVAL_VERSION = 'eval-v2';
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
  m[1] + '\n;globalThis.__out = { RED_FLAGS, SYMPTOMS, flagsFor, computeTriage, safetyCheck };',
  sandbox,
  { timeout: 5000 }
);
const { RED_FLAGS, SYMPTOMS, flagsFor, computeTriage, safetyCheck } = sandbox.__out;

const labelOf = id => (SYMPTOMS[id] ? SYMPTOMS[id].label : id);

const SAMPLE = [{ id: 'cold', name: '普通感冒', dept: '普通内科', tag: '', score: 0.6, meds: [] }];

function reset(sel, ans, age) {
  vm.runInContext('selected.clear();', sandbox);
  sel.forEach(id => vm.runInContext('selected.add(' + JSON.stringify(id) + ');', sandbox));
  vm.runInContext('Object.keys(answers).forEach(function (k) { delete answers[k]; });', sandbox);
  Object.keys(ans).forEach(k => {
    vm.runInContext('answers[' + JSON.stringify(k) + '] = ' + ans[k] + ';', sandbox);
  });
  vm.runInContext('patientAge = ' + (age === null ? 'null' : age) + ';', sandbox);
}

/* 1. 危险信号 */
const redflagCases = RED_FLAGS.map(f => {
  const combo = f.mode === 'all' ? f.ids.slice() : [f.ids[0]];
  reset(combo, {}, 30);
  const hits = flagsFor(new Set(combo));
  const triage = computeTriage([], hits);
  return {
    title: f.title,
    input: combo.map(labelOf).join(' + '),
    level: triage.level,
    ok: triage.level === 'red'
  };
});
const red = redflagCases.filter(c => c.ok).length;
const redRate = redflagCases.length ? Number((red / redflagCases.length).toFixed(4)) : 0;

/* 2. 问卷加权 */
const weightedDefs = [
  { name: '全部轻微', ans: { duration: 0, fever: 0, activity: 0 }, expect: 'green' },
  { name: '4–7 天 + 低热', ans: { duration: 2, fever: 1, activity: 0 }, expect: 'green' },
  { name: '4–7 天 + 中度发热', ans: { duration: 2, fever: 2, activity: 0 }, expect: 'yellow' },
  { name: '4–7 天 + 中度发热 + 影响工作', ans: { duration: 2, fever: 2, activity: 1 }, expect: 'yellow' },
  { name: '超过 1 周 + 高热 + 影响工作', ans: { duration: 3, fever: 3, activity: 1 }, expect: 'yellow' },
  { name: '超过 1 周 + 高热 + 卧床', ans: { duration: 3, fever: 3, activity: 2 }, expect: 'red' },
  { name: '高热 + 卧床', ans: { duration: 0, fever: 3, activity: 2 }, expect: 'yellow' },
  { name: '超过 1 周 + 卧床', ans: { duration: 3, fever: 0, activity: 2 }, expect: 'yellow' }
];

const weightedCases = weightedDefs.map(d => {
  reset(['fatigue'], d.ans, 30);
  const triage = computeTriage(SAMPLE, []);
  return {
    name: d.name,
    score: d.ans,
    expect: d.expect,
    level: triage.level,
    ok: triage.level === d.expect
  };
});

/* 3. 年龄分支 */
const ageCases = [
  { name: '6 个月发热', age: 0.5, sel: ['fever'], ans: {}, expect: 'red' },
  { name: '老人轻症不误判为红', age: 75, sel: ['fatigue'], ans: { duration: 0, fever: 0, activity: 0 }, expect: 'green' },
  { name: '儿童中度症状', age: 10, sel: ['fever'], ans: { duration: 1, fever: 2, activity: 1 }, expect: 'yellow' }
].map(d => {
  reset(d.sel, d.ans, d.age);
  const triage = computeTriage(SAMPLE, []);
  return { name: d.name, age: d.age, expect: d.expect, level: triage.level, ok: triage.level === d.expect };
});

/* 4. 用药冲突（复用 AGE_MED_RULES） */
const medDefs = [
  { name: '18 岁以下 + 阿司匹林', age: 10, med: '阿司匹林', expect: 'red' },
  { name: '6 个月以下 + 布洛芬', age: 0.4, med: '布洛芬', expect: 'red' },
  { name: '65 岁以上 + 布洛芬', age: 70, med: '布洛芬', expect: 'yellow' },
  { name: '2 岁以下 + 氯苯那敏', age: 1.5, med: '氯苯那敏', expect: 'red' },
  { name: '12 岁以下 + 甲硝唑', age: 10, med: '甲硝唑', expect: 'yellow' }
];

const medsCases = medDefs.map(d => {
  const items = safetyCheck(d.age, new Set(), [{ meds: [{ n: d.med, note: '' }] }]);
  return {
    name: d.name,
    expect: d.expect,
    hits: items.length,
    ok: items.some(i => i.level === d.expect)
  };
});

/* 5. 负样本 */
const negatives = [
  ['fatigue'],
  ['sore_throat', 'runny_nose'],
  ['headache'],
  ['diarrhea', 'abdominal_pain'],
  ['insomnia'],
  ['rash'],
  ['constipation'],
  ['back_pain']
].map(combo => {
  reset(combo, {}, 30);
  const triage = computeTriage([], flagsFor(new Set(combo)));
  return {
    input: combo.map(labelOf).join(' + '),
    level: triage.level,
    falsePositive: triage.level === 'red'
  };
});
const falsePositive = negatives.filter(n => n.falsePositive).length;

/* 汇总 */
const categories = [
  { id: 'redflags', label: '危险信号', total: redflagCases.length, pass: red, red: red, fp: 0 },
  { id: 'weighted', label: '问卷加权', total: weightedCases.length, pass: weightedCases.filter(c => c.ok).length, red: weightedCases.filter(c => c.level === 'red').length, fp: 0 },
  { id: 'age', label: '年龄分支', total: ageCases.length, pass: ageCases.filter(c => c.ok).length, red: ageCases.filter(c => c.level === 'red').length, fp: 0 },
  { id: 'meds', label: '用药冲突', total: medsCases.length, pass: medsCases.filter(c => c.ok).length, red: 0, fp: 0 },
  { id: 'negatives', label: '负样本', total: negatives.length, pass: negatives.filter(n => !n.falsePositive).length, red: 0, fp: falsePositive }
];
const caseTotal = categories.reduce((sum, c) => sum + c.total, 0);

const result = {
  version: EVAL_VERSION,
  generatedAt: GENERATED_AT,
  total: redflagCases.length,
  red,
  redRate,
  negatives: negatives.length,
  falsePositive,
  falsePositiveRate: negatives.length ? Number((falsePositive / negatives.length).toFixed(4)) : 0,
  caseTotal,
  categories,
  cases: redflagCases,
  negativeCases: negatives,
  weightedCases,
  ageCases,
  medsCases
};

fs.mkdirSync(path.dirname(OUT_DOC), { recursive: true });
fs.mkdirSync(path.dirname(OUT_SEED), { recursive: true });
fs.writeFileSync(OUT_DOC, JSON.stringify(result, null, 2) + '\n', 'utf8');
fs.writeFileSync(OUT_SEED, JSON.stringify(result, null, 2) + '\n', 'utf8');

const failed = categories.filter(c => c.pass < c.total);
if (failed.length || falsePositive > 0) {
  console.error('评测未通过：');
  failed.forEach(c => console.error('  ' + c.label + ' ' + c.pass + '/' + c.total));
  if (falsePositive > 0) console.error('  负样本误报 ' + falsePositive);
  process.exit(1);
}

console.log('评测通过：' + caseTotal + ' 条用例 ｜ 危险信号 ' + red + '/' + redflagCases.length +
  ' 判红 ｜ 负样本 ' + negatives.length + ' 组，误报 ' + falsePositive);
console.log('已写入 docs/evals-latest.json 与 worker/evals-seed.json');