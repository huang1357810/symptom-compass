/*
 * 可解释性自测：node tools/test-explain.js
 *
 * 覆盖：
 *   - 「因为你提到」列出权重最高的 2 个症状
 *   - keyNegatives 命中否定词时追加「你也说没有」
 *   - 无 keyNegative 时不出现该句
 *   - 病程落在典型区间时追加说明
 *   - 只有 ?debug=1 才渲染调试块
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

function load(search) {
  const sandbox = {};
  if (search !== undefined) sandbox.location = { search };
  vm.createContext(sandbox);
  vm.runInContext(
    m[1] + '\n;globalThis.__out={explainFor,debugInfoFor,renderCondition,CONDITIONS};',
    sandbox,
    { timeout: 8000 }
  );
  return sandbox.__out;
}

const plain = load(undefined);
const debug = load('?debug=1');
const errors = [];

/* 1. 命中症状 + 病程 */
const pharyngitis = plain.CONDITIONS.find(c => c.id === 'pharyngitis');
const e1 = plain.explainFor(
  Object.assign({}, pharyngitis, { score: 0.6, matched: ['fever', 'sore_throat'] }),
  new Set(['sore_throat', 'fever']),
  new Set(),
  { durationDays: 2, age: 30 }
);
if (e1.indexOf('因为你提到') === -1) errors.push('缺少「因为你提到」');
if (e1.indexOf('咽痛') === -1) errors.push('应列出咽痛');
if (e1.indexOf('病程 2 天') === -1) errors.push('应包含病程说明');

/* 2. keyNegatives 命中否定词 */
const rhinitis = plain.CONDITIONS.find(c => c.id === 'allergic_rhinitis');
const e2 = plain.explainFor(
  Object.assign({}, rhinitis, { score: 0.5, matched: ['sneeze', 'runny_nose'] }),
  new Set(['sneeze', 'runny_nose']),
  new Set(['fever']),
  { durationDays: 1, age: 30 }
);
if (e2.indexOf('你也说没有：发热') === -1) errors.push('应包含「你也说没有：发热」，实际：' + e2);

/* 3. 无 keyNegative 命中时不出现该句 */
const e3 = plain.explainFor(
  Object.assign({}, pharyngitis, { score: 0.6, matched: ['sore_throat'] }),
  new Set(['sore_throat']),
  new Set(['fever']),
  { durationDays: 1, age: 30 }
);
if (e3.indexOf('你也说没有') !== -1) errors.push('pharyngitis 未命中 keyNegative，不应出现「你也说没有」，实际：' + e3);

/* 4. 调试块只在 ?debug=1 渲染 */
const card = {
  id: 'pharyngitis', name: '急性咽炎 / 扁桃体炎', dept: '耳鼻喉科', tag: '',
  score: 0.6, matched: ['sore_throat'], core: ['sore_throat'],
  care: [], meds: [], summary: '', source: '', reviewer: '', updated: '', see: ''
};
const noDbg = plain.renderCondition(card, 0, false);
if (noDbg.indexOf('class="dbg"') !== -1) errors.push('默认不应渲染调试块');
const withDbg = debug.renderCondition(card, 0, false);
if (withDbg.indexOf('class="dbg"') === -1) errors.push('?debug=1 时应渲染调试块');
if (withDbg.indexOf('证据门槛') === -1) errors.push('调试块应包含证据门槛状态');

/* 5. 无信息时不显示解释行（不占位） */
const empty = plain.explainFor(
  Object.assign({}, pharyngitis, { score: 0.1, matched: [] }),
  new Set(['headache']),
  new Set(),
  {}
);
if (empty !== '') errors.push('无信息时应返回空字符串，实际：' + empty);

if (errors.length) {
  console.error('可解释性校验失败：\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('可解释性 5/5 通过（命中症状 / 关键阴性 / 病程 / 无信息不占位 / ?debug=1 开关）');