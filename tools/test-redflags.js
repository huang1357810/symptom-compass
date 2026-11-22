/*
 * 危险信号评测集：node tools/test-redflags.js
 *
 * 目标：用一张表证明「所有危险信号都会被一票判红，且普通症状不会被误判为红」。
 * 同时把结果写入 docs/危险信号评测表.md，供评委/答辩直接查看。
 *
 * 该测试随 CI 的 tools/test-*.js 循环执行；文档内容固定（不含运行时时间），
 * 因此重复运行不会产生 git diff。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'site', 'index.html');
const DOC = path.join(ROOT, 'docs', '危险信号评测表.md');

const html = fs.readFileSync(HTML, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  console.error('未找到 script 块');
  process.exit(1);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  m[1] + '\n;globalThis.__out = { RED_FLAGS, SYMPTOMS, flagsFor, computeTriage, scoreConditions };',
  sandbox,
  { timeout: 5000 }
);
const { RED_FLAGS, SYMPTOMS, flagsFor, computeTriage } = sandbox.__out;

/* 避免「1 岁以下婴儿发热」分支干扰 */
vm.runInContext('patientAge = 30;', sandbox);

const labelOf = id => (SYMPTOMS[id] ? SYMPTOMS[id].label : id);
const comboOf = f => (f.mode === 'all' ? f.ids.slice() : [f.ids[0]]);

const rows = [];
let hit = 0;
RED_FLAGS.forEach((f, i) => {
  const combo = comboOf(f);
  const set = new Set(combo);
  const hits = flagsFor(set);
  const triage = computeTriage([], hits);
  const matched = hits.some(h => h.title === f.title);
  const isRed = triage.level === 'red';
  if (matched && isRed) hit += 1;
  rows.push({
    index: i + 1,
    title: f.title,
    input: combo.map(labelOf).join(' + '),
    level: triage.level,
    ok: matched && isRed,
    matched,
    isRed
  });
});

/* 负样本：常见轻症组合，不应被判红 */
const negatives = [
  ['fatigue'],
  ['sore_throat', 'runny_nose'],
  ['headache'],
  ['diarrhea', 'abdominal_pain']
];

let falsePositive = 0;
const negRows = negatives.map((combo, i) => {
  const hits = flagsFor(new Set(combo));
  const triage = computeTriage([], hits);
  const isRed = triage.level === 'red';
  if (isRed) falsePositive += 1;
  return {
    index: i + 1,
    input: combo.map(labelOf).join(' + '),
    level: triage.level,
    falsePositive: isRed
  };
});

/* 生成 Markdown（内容固定，避免 CI 每次产生 diff） */
const md = [
  '# 危险信号评测表',
  '',
  '> 由 `tools/test-redflags.js` 自动生成，随 CI 每次重跑；请勿手工修改。',
  '',
  '- 评测集版本：v1（2026-11-22）',
  '- 危险信号：' + RED_FLAGS.length + ' 条',
  '- 命中并判红：' + hit + ' 条（' + hit + ' / ' + RED_FLAGS.length + '）',
  '- 负样本：' + negatives.length + ' 组',
  '- 误判为红：' + falsePositive + ' 组',
  '',
  '## 危险信号',
  '',
  '| # | 危险信号 | 触发输入 | 判定 | 结果 |',
  '| --- | --- | --- | --- | --- |',
  ...rows.map(r =>
    '| ' + r.index + ' | ' + r.title + ' | ' + r.input + ' | ' + r.level + ' | ' +
    (r.ok ? '通过' : (r.matched ? '未判红' : '未命中')) + ' |'
  ),
  '',
  '## 负样本（不应判红）',
  '',
  '| # | 输入 | 判定 | 是否误报 |',
  '| --- | --- | --- | --- |',
  ...negRows.map(r =>
    '| ' + r.index + ' | ' + r.input + ' | ' + r.level + ' | ' + (r.falsePositive ? '误报' : '正常') + ' |'
  ),
  ''
].join('\n');

fs.mkdirSync(path.dirname(DOC), { recursive: true });
fs.writeFileSync(DOC, md, 'utf8');

/* 断言 */
const errors = [];
if (hit !== RED_FLAGS.length) {
  errors.push('危险信号命中不足：' + hit + ' / ' + RED_FLAGS.length);
}
rows.filter(r => !r.ok).forEach(r => {
  errors.push('未正确判红：' + r.title + '（matched=' + r.matched + ', level=' + r.level + '）');
});
if (falsePositive > 0) {
  errors.push('负样本被误判为红：' + falsePositive + ' 组');
}
if (!fs.existsSync(DOC)) {
  errors.push('未生成 docs/危险信号评测表.md');
} else {
  const text = fs.readFileSync(DOC, 'utf8');
  RED_FLAGS.forEach(f => {
    if (text.indexOf(f.title) === -1) errors.push('评测表缺少 ' + f.title);
  });
}

if (errors.length) {
  console.error('危险信号评测失败：\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('危险信号 ' + hit + '/' + RED_FLAGS.length + ' 全部判红；负样本 ' +
  negatives.length + ' 组，误报 ' + falsePositive + '；已更新 docs/危险信号评测表.md');