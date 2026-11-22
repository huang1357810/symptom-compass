/*
 * 内容来源 / 审核字段自测：node tools/test-content-meta.js
 * 要求：35 条疾病都标注来源、审核与更新日期，并通过生成器同步到鸿蒙与云端。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'site', 'index.html');
const html = fs.readFileSync(HTML, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  console.error('未找到 script 块');
  process.exit(1);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(m[1] + '\n;globalThis.__out = { CONDITIONS };', sandbox, { timeout: 5000 });
const { CONDITIONS } = sandbox.__out;

const errors = [];
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

/* 1. 每条疾病都有来源/审核/更新 */
CONDITIONS.forEach(c => {
  if (!c.source || !String(c.source).trim()) errors.push(c.id + ' 缺少 source');
  if (!c.reviewer || !String(c.reviewer).trim()) errors.push(c.id + ' 缺少 reviewer');
  if (!c.updated || !dateRe.test(String(c.updated))) errors.push(c.id + ' 的 updated 不是 YYYY-MM-DD');
});
if (!CONDITIONS.length) errors.push('CONDITIONS 为空');

/* 2. 结果页展示字段 */
if (html.indexOf('meta-src') === -1) errors.push('结果页未渲染来源/审核字段');
if (html.indexOf("c.reviewer") === -1) errors.push('结果页未使用 reviewer 字段');

/* 3. 生成器透传（鸿蒙） */
const gen = fs.readFileSync(path.join(ROOT, 'tools', 'gen-harmony-data.js'), 'utf8');
['source:', 'reviewer:', 'updated:'].forEach(k => {
  if (gen.indexOf(k) === -1) errors.push('gen-harmony-data.js 未透传 ' + k);
});
const dataEts = path.join(ROOT, 'harmony', 'entry', 'src', 'main', 'ets', 'common', 'Data.ets');
if (!fs.existsSync(dataEts)) {
  errors.push('缺少 Data.ets（请运行 gen-harmony-data.js）');
} else {
  const ets = fs.readFileSync(dataEts, 'utf8');
  ['source:', 'reviewer:', 'updated:'].forEach(k => {
    if (ets.indexOf(k) === -1) errors.push('Data.ets 未包含 ' + k);
  });
}

/* 4. 云端逻辑透传（script 原样抽出） */
const logic = path.join(ROOT, 'cloud', 'functiongraph', 'logic.js');
if (!fs.existsSync(logic)) {
  errors.push('缺少 cloud/functiongraph/logic.js（请运行 gen-cloud-logic.js）');
} else {
  const text = fs.readFileSync(logic, 'utf8');
  ['source:', 'reviewer:', 'updated:'].forEach(k => {
    if (text.indexOf(k) === -1) errors.push('云端 logic.js 未包含 ' + k);
  });
}

if (errors.length) {
  console.error('内容元数据校验失败：\n  ' + errors.join('\n  '));
} else {
  console.log('内容来源/审核字段校验通过：' + CONDITIONS.length + ' 条疾病，Web / 鸿蒙 / 云端一致');
}
process.exit(errors.length ? 1 : 0);