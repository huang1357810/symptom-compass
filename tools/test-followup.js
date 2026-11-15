/*
 * 问卷结构自测：node tools/test-followup.js
 * 校验固定三问的数据完整性（原 FOLLOWUPS 动态追问模块已移除，测试同步更新）
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
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(m[1] + '\n;globalThis.__out = { SYMPTOMS, QUESTIONS };', sandbox, { timeout: 5000 });
const { QUESTIONS } = sandbox.__out;

const errors = [];
const ids = new Set();

if (!Array.isArray(QUESTIONS) || QUESTIONS.length < 3) errors.push('题目少于 3 道');

QUESTIONS.forEach(q => {
  if (!q.id) errors.push('有题目缺少 id');
  if (ids.has(q.id)) errors.push('题目 id 重复：' + q.id);
  ids.add(q.id);
  if (!q.title) errors.push(q.id + ' 缺少标题');
  if (!Array.isArray(q.options) || q.options.length < 2) errors.push(q.id + ' 选项少于 2 个');
  (q.options || []).forEach(o => {
    if (!o.label) errors.push(q.id + ' 有选项缺少文案');
    if (typeof o.score !== 'number') errors.push(q.id + ' 的选项 score 不是数字');
    if (o.reason === undefined) errors.push(q.id + ' 的选项缺少 reason');
  });
});

['duration', 'fever', 'activity'].forEach(id => {
  if (!ids.has(id)) errors.push('缺少固定题 ' + id);
});

if (errors.length) {
  console.error('问卷校验失败：\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('题目 ' + QUESTIONS.length + ' 道，选项校验通过，问题 0 个');
