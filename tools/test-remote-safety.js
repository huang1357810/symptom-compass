/*
 * 远端分诊安全自测：node tools/test-remote-safety.js
 *
 * 审查要点：远端分诊返回空 flags 时，本地危险信号不能被覆盖；
 * 远端数据异常（null/重复/缺 id）也不能抛错。
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
  m[1] + '\n;globalThis.__out = { RED_FLAGS, flagsFor, mergeRedFlags, computeTriage };',
  sandbox,
  { timeout: 5000 }
);
const { flagsFor, mergeRedFlags, computeTriage } = sandbox.__out;
vm.runInContext('patientAge = 30;', sandbox);

const cases = [];

/* 1. 远端只返回空 flags：本地胸痛仍然判红 */
cases.push({
  name: '远端空 flags 不覆盖本地危险信号',
  run() {
    const local = flagsFor(new Set(['chest_pain']));
    const merged = mergeRedFlags(local, []);
    const triage = computeTriage([], merged);
    return local.length === 1 && merged.length === 1 &&
      merged[0].title === '胸痛' && triage.level === 'red';
  }
});

/* 2. 远端返回与本地相同的红旗：去重且保留本地对象 */
cases.push({
  name: '重复危险信号去重且本地优先',
  run() {
    const local = flagsFor(new Set(['chest_pain']));
    const remote = [{ id: 'remote-chest', title: '胸痛', msg: '远端文案' }];
    const merged = mergeRedFlags(local, remote);
    return merged.length === 1 && merged[0] === local[0];
  }
});

/* 3. 远端补充本地没有的红旗：保留 */
cases.push({
  name: '远端补充的危险信号被保留',
  run() {
    const local = flagsFor(new Set(['fatigue']));
    const remote = [{ id: 'r1', title: '远端提示', msg: '...' }];
    const merged = mergeRedFlags(local, remote);
    return local.length === 0 && merged.length === 1 && merged[0].title === '远端提示';
  }
});

/* 4. 异常远端数据不抛错 */
cases.push({
  name: '异常远端 flags 不抛错',
  run() {
    const merged = mergeRedFlags(
      flagsFor(new Set(['chest_pain'])),
      [null, 'bad', { msg: 'no-id' }, { id: '', title: '' }]
    );
    return merged.length === 1 && merged[0].title === '胸痛';
  }
});

/* 5. 远端返回空 results 时，本地判定仍可工作（不抛错） */
cases.push({
  name: '远端空 results 与本地红旗组合不抛错',
  run() {
    const merged = mergeRedFlags(flagsFor(new Set(['chest_pain'])), []);
    const triage = computeTriage([], merged);
    return triage && triage.level === 'red';
  }
});

/* 6. 源码接线：matched 对未知症状回退 id，不直接取 label */
cases.push({
  name: 'matched 对未知症状回退显示 id',
  run() {
    return html.indexOf('SYMPTOMS[id] && SYMPTOMS[id].label ? SYMPTOMS[id].label : String(id)') !== -1 &&
      html.indexOf('mergeRedFlags(flagsFor(selected), data.flags)') !== -1;
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

if (failures.length) {
  console.error('失败用例：\n  ' + failures.join('\n  '));
}
console.log('用例 ' + passed + '/' + cases.length + ' 通过');
process.exit(failures.length ? 1 : 0);