/*
 * 问卷重置自测：node tools/test-answers.js
 * 返回修改症状后，answers 必须清空，避免沿用上一次答案。
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
  m[1] + '\n;globalThis.__out = { answers, resetAnswers };',
  sandbox,
  { timeout: 5000 }
);
const { answers, resetAnswers } = sandbox.__out;

const cases = [];

cases.push({
  name: 'resetAnswers 清空全部答案',
  run() {
    answers['duration'] = 2;
    answers['fever'] = 1;
    answers['activity'] = 0;
    resetAnswers();
    return Object.keys(answers).length === 0;
  }
});

cases.push({
  name: '空答案时调用不抛错',
  run() {
    resetAnswers();
    resetAnswers();
    return Object.keys(answers).length === 0;
  }
});

cases.push({
  name: '修改症状与问卷返回都会清空',
  run() {
    const backBlock = html.indexOf("document.getElementById('back')");
    const triageBackBlock = html.indexOf("document.getElementById('triageBack')");
    const backSeg = backBlock !== -1 ? html.slice(backBlock, backBlock + 260) : '';
    const triageSeg = triageBackBlock !== -1 ? html.slice(triageBackBlock, triageBackBlock + 260) : '';
    return backSeg.indexOf('resetAnswers()') !== -1 && triageSeg.indexOf('resetAnswers()') !== -1;
  }
});

cases.push({
  name: 'clearAll 也使用 resetAnswers',
  run() {
    const start = html.indexOf('function clearAll()');
    const seg = start !== -1 ? html.slice(start, start + 900) : '';
    return seg.indexOf('resetAnswers()') !== -1;
  }
});

let passed = 0;
const failures = [];
cases.forEach(c => {
  let ok = false;
  try {
    ok = !!c.run();
  } catch (e) {
    failures.push(c.name + ' → 抛错：' + e.message);
    return;
  }
  if (ok) passed++;
  else failures.push(c.name);
});

if (failures.length) console.error('失败用例：\n  ' + failures.join('\n  '));
console.log('用例 ' + passed + '/' + cases.length + ' 通过');
process.exit(failures.length ? 1 : 0);