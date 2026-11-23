/*
 * 回归测试：node tools/test-regression.js
 *
 * 锁定 8 个典型输入的「症状 id」与「排第一的方向名称」，防止关键阴性、
 * 红旗条件化等改动无意改变用户看到的首位方向。只锁名称与 id，不锁百分比。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'site', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  console.error('未找到 script 块');
  process.exit(1);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(m[1] + '\n;globalThis.__out={parseSymptoms,scoreConditions,flagsFor};', sandbox, { timeout: 8000 });
const { parseSymptoms, scoreConditions, flagsFor } = sandbox.__out;

/* 改动前的基线（2026-11-22 实测；2026-11-23 细化危险信号约束） */
const BASELINE = [
  { text: '咽痛+发热', ids: ['sore_throat', 'fever'], top1: '急性咽炎 / 扁桃体炎' },
  { text: '腹泻+恶心', ids: ['diarrhea', 'nausea'], top1: '急性胃肠炎' },
  /* 危险信号输入：只要求症状 id 不变且仍命中红旗，不约束结果列表 Top1 */
  { text: '胸痛+气短', ids: ['chest_pain', 'dyspnea'], redFlag: true },
  { text: '头痛+恶心', ids: ['headache', 'nausea'], top1: '偏头痛' },
  { text: '咳嗽+黄痰', ids: ['dry_cough', 'sputum'], top1: '急性支气管炎' },
  { text: '高热+咽痛', ids: ['fever', 'high_fever', 'sore_throat'], top1: '急性咽炎 / 扁桃体炎' },
  { text: '皮疹+发热', ids: ['rash', 'fever'], top1: '湿疹 / 皮炎' },
  { text: '腹痛+呕吐', ids: ['abdominal_pain', 'vomiting'], top1: '急性胃肠炎' }
];

const errors = [];

BASELINE.forEach(exp => {
  const ids = new Set();
  exp.text.split('+').forEach(seg => {
    parseSymptoms(seg).ids.forEach(id => ids.add(id));
  });
  const gotIds = [...ids].sort().join(',');
  const wantIds = exp.ids.slice().sort().join(',');
  if (gotIds !== wantIds) {
    errors.push(exp.text + ' 症状 id 变化：期望 [' + wantIds + ']，实际 [' + gotIds + ']');
  }
  if (exp.redFlag) {
    const flags = flagsFor(ids);
    if (!flags.length) errors.push(exp.text + ' 应仍命中危险信号（判红）');
    return;
  }
  const results = scoreConditions(ids);
  const top1 = results[0] ? results[0].name : null;
  if (top1 !== exp.top1) {
    errors.push(exp.text + ' top1 变化：期望 ' + exp.top1 + '，实际 ' + top1);
  }
});

if (errors.length) {
  console.error('回归测试失败：\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('回归用例 ' + BASELINE.length + '/' + BASELINE.length +
  ' 通过：7 条非红旗 Top1 未变，胸痛+气短仍判红');