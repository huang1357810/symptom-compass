/*
 * 用药安全自测：node tools/test-meds.js
 * 校验：药名库完整性、类别合法性、相互作用规则结构
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'site', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(m[1] + '\n;globalThis.__out={MED_DICT,CHRONIC_MEDS,INTERACTION_RULES,matchMedName,safetyCheck};', sandbox, { timeout: 8000 });
const { MED_DICT, CHRONIC_MEDS, INTERACTION_RULES, matchMedName, safetyCheck } = sandbox.__out;

const errors = [];
const cats = new Set(CHRONIC_MEDS.map(c => c.id));
const names = new Set();

MED_DICT.forEach(m => {
  const name = m.n, cat = m.cat;
  if (!name) errors.push('药名为空');
  if (!cats.has(cat)) errors.push(name + ' 的类别不存在：' + cat);
  if (names.has(name)) errors.push('药名重复：' + name);
  names.add(name);
});

if (MED_DICT.length < 60) errors.push('药名库少于 60 条，覆盖不足');

INTERACTION_RULES.forEach((r, i) => {
  if (!r.text) errors.push('第 ' + (i + 1) + ' 条规则缺少说明');
  if (!['red', 'yellow'].includes(r.level)) errors.push('第 ' + (i + 1) + ' 条规则 level 非法');
  const kinds = ['re', 'pair', 'pairAny', 'pairDistinct'].filter(k => r[k]);
  if (kinds.length !== 1) errors.push('第 ' + (i + 1) + ' 条规则结构异常');
  if (r.re && !r.chronic) errors.push('第 ' + (i + 1) + ' 条 re 规则缺少 chronic');
  if (r.chronic && !cats.has(r.chronic)) errors.push('第 ' + (i + 1) + ' 条 chronic 类别不存在：' + r.chronic);
});

/* 匹配行为 */
const cases = [
  ['华法林', 'anticoag'], ['华法林钠片', 'anticoag'], ['拜阿司匹林', 'anticoag'],
  ['氨氯地平', 'bp'], ['二甲双胍', 'dm'], ['阿托伐他汀', 'statin'],
  ['舍曲林', 'ssri'], ['泼尼松', 'steroid'], ['奥美拉唑', 'ppi'],
  ['左甲状腺素', 'thyroid'], ['卡马西平', 'antiepileptic'], ['别嘌醇', 'gout']
];
cases.forEach(([q, want]) => {
  const hit = matchMedName(q);
  if (!hit) errors.push('未识别的药名：' + q);
  else if (hit.cat !== want) errors.push(q + ' 归类错误：' + hit.cat + '，期望 ' + want);
});

if (matchMedName('不存在的药')) errors.push('不存在的药名不应匹配');

/* 典型冲突 */
const med = (...xs) => [{ meds: xs.map(n => ({ n })) }];
const mustHit = (age, chronic, meds, keyword) => {
  const items = safetyCheck(age, new Set(chronic), med(...meds));
  if (!items.some(i => i.text.includes(keyword))) errors.push('应命中但未命中：' + keyword);
};
mustHit(70, ['anticoag'], ['布洛芬'], '出血风险');
mustHit(null, ['ssri'], ['右美沙芬'], '5-羟色胺');
mustHit(null, ['thyroid'], ['铁剂'], '左甲状腺素');
mustHit(null, [], ['蒙脱石散', '益生菌'], '间隔 2 小时');

if (errors.length) {
  console.error('用药安全校验失败：\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('药名库 ' + MED_DICT.length + ' 条，相互作用规则 ' + INTERACTION_RULES.length + ' 条，用例通过');
