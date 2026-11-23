/*
 * Top3 临床合理性自测：node tools/test-top3-sanity.js
 *
 * 目的：不只看 gold 是否命中，还要拦住「短表病种靠 1 个泛化症状冲进前三」。
 * 断言：forbid 列表与 Top3 无交集；require 列表至少命中 1 个。
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
vm.runInContext(
  m[1] + '\n;globalThis.__out={parseSymptoms,scoreConditions,SYMPTOMS};',
  sandbox,
  { timeout: 8000 }
);
const { parseSymptoms, scoreConditions, SYMPTOMS } = sandbox.__out;

const label = id => (SYMPTOMS[id] ? SYMPTOMS[id].label : id);

const CASES = [
  {
    name: '咽痛+发热',
    text: '咽痛+发热',
    forbid: ['hfmd'],
    require: ['pharyngitis', 'flu', 'cold']
  },
  {
    name: '干咳+咳痰',
    text: '干咳+咳痰',
    require: ['bronchitis', 'pneumonia', 'tb']
  },
  {
    name: '腹泻+恶心',
    text: '腹泻+恶心',
    forbid: ['tb', 'pneumonia']
  },
  {
    name: '皮疹+发热',
    text: '皮疹+发热',
    forbid: ['tb']
  },
  {
    name: '腹痛+呕吐',
    text: '腹痛+呕吐',
    require: ['gastroenteritis']
  },
  {
    name: '头痛+恶心',
    text: '头痛+恶心',
    forbid: ['pneumonia']
  }
];

const errors = [];

CASES.forEach(c => {
  const ids = new Set();
  c.text.split('+').forEach(seg => {
    parseSymptoms(seg).ids.forEach(id => ids.add(id));
  });
  const results = scoreConditions(ids);
  const top3 = results.slice(0, 3).map(r => r.id);

  (c.forbid || []).forEach(bad => {
    if (top3.indexOf(bad) !== -1) {
      errors.push(c.name + '：Top3 不应含 ' + label(bad) + '，实际 [' + top3.map(label).join(' / ') + ']');
    }
  });

  if (c.require && c.require.length) {
    const ok = c.require.some(id => top3.indexOf(id) !== -1);
    if (!ok) {
      errors.push(c.name + '：Top3 应至少含 ' + c.require.map(label).join(' 或 ') +
        '，实际 [' + top3.map(label).join(' / ') + ']');
    }
  }

  if (!top3.length) errors.push(c.name + '：Top3 为空');
});

if (errors.length) {
  console.error('Top3 合理性校验失败：\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('Top3 合理性 ' + CASES.length + '/' + CASES.length + ' 组通过（forbid 无交集，require 至少命中 1 个）');