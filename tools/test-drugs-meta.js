/*
 * 药品元数据核对自测：node tools/test-drugs-meta.js
 *
 * 校验药名库每条都有 drugSource / drugReviewed / drugUpdated，
 * 并生成 docs/药品核对表.md（NMPA 核对列留空，待人工逐条填写）。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  console.error('未找到 script 块');
  process.exit(1);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  m[1] + '\n;globalThis.__out={MED_DICT,CHRONIC_MEDS,CONDITIONS};',
  sandbox,
  { timeout: 8000 }
);
const { MED_DICT, CHRONIC_MEDS, CONDITIONS } = sandbox.__out;

const errors = [];
const catLabel = {};
CHRONIC_MEDS.forEach(c => { catLabel[c.id] = c.label; });

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const reviewedRe = /^待核对$|^已核对（.+）$/;

MED_DICT.forEach(item => {
  const name = item && item.n;
  if (!name) { errors.push('药名为空'); return; }
  if (!item.drugSource || typeof item.drugSource !== 'string') errors.push(name + ' 缺少 drugSource');
  if (!item.drugUpdated || !dateRe.test(item.drugUpdated)) errors.push(name + ' 缺少合法 drugUpdated（YYYY-MM-DD）');
  if (!item.drugReviewed || !reviewedRe.test(item.drugReviewed)) {
    errors.push(name + ' 的 drugReviewed 只能是「待核对」或「已核对（姓名）」，实际：' + item.drugReviewed);
  }
});

/* 从疾病用药说明里取「现有注意事项」 */
const notes = [];
CONDITIONS.forEach(c => {
  (c.meds || []).forEach(x => {
    if (x && x.n && x.note) notes.push({ n: x.n, note: x.note });
  });
});
const noteOf = name => {
  const exact = notes.find(x => x.n === name);
  if (exact) return exact.note;
  const part = notes.find(x => x.n.indexOf(name) >= 0 || name.indexOf(x.n) >= 0);
  return part ? part.note : '—';
};

const md = [
  '# 药品核对表',
  '',
  '> 由 `tools/test-drugs-meta.js` 自动生成，请勿手工修改表格结构。',
  '> 「NMPA 核对结果」与「备注」两列留空，待人工对照国家药监局药品查询逐条填写。',
  '',
  '- 药名库：' + MED_DICT.length + ' 条',
  '- 核对状态：待核对 ' + MED_DICT.filter(x => x.drugReviewed === '待核对').length + ' 条，已核对 ' +
    MED_DICT.filter(x => x.drugReviewed !== '待核对').length + ' 条',
  '',
  '| 通用名 | 类别 | 现有注意事项 | NMPA 核对结果 | 备注 |',
  '| --- | --- | --- | --- | --- |',
  ...MED_DICT.map(x => '| ' + x.n + ' | ' + (catLabel[x.cat] || x.cat) + ' | ' + noteOf(x.n) + ' |  |  |'),
  ''
].join('\n');

const DOC = path.join(ROOT, 'docs', '药品核对表.md');
fs.mkdirSync(path.dirname(DOC), { recursive: true });
fs.writeFileSync(DOC, md, 'utf8');

if (!fs.existsSync(DOC)) {
  errors.push('未生成 docs/药品核对表.md');
} else {
  const text = fs.readFileSync(DOC, 'utf8');
  MED_DICT.forEach(x => {
    if (text.indexOf(x.n) === -1) errors.push('核对表缺少 ' + x.n);
  });
}

if (errors.length) {
  console.error('药品元数据校验失败：\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('药品核对通过：' + MED_DICT.length + ' 条均有来源与更新日期；已更新 docs/药品核对表.md');