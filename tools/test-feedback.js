/*
 * 反馈系统自测：node tools/test-feedback.js
 * 校验：反馈是否记录对应病症、改进状态链路、隐私文案与页面/Worker 接线
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');
const worker = fs.readFileSync(path.join(ROOT, 'worker', 'index.js'), 'utf8');

const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  console.error('未找到 script 块');
  process.exit(1);
}

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  m[1] + '\n;globalThis.__out = { fbContext, selected };',
  sandbox,
  { timeout: 5000 }
);

const cases = [];

/* 1. 反馈上下文包含方向与症状 */
cases.push({
  name: '反馈记录对应病症与症状',
  run() {
    vm.runInContext(
      "selected.add('fever'); selected.add('sore_throat');" +
      "lastResults = [{ id: 'flu', name: '流行性感冒', score: 0.72 }, { id: 'cold', name: '普通感冒', score: 0.41 }];" +
      'lastTriage = { level: "yellow" };',
      sandbox
    );
    const ctx = vm.runInContext('fbContext()', sandbox);
    return ctx.top && ctx.top.id === 'flu' && ctx.top.name === '流行性感冒' &&
      ctx.results.length === 2 &&
      ctx.symptoms.length === 2 && ctx.symptoms[0].label === '发热' &&
      ctx.triage === 'yellow';
  }
});

/* 2. 提交 payload 带 context */
cases.push({
  name: '提交时附带上下文',
  run() {
    return html.indexOf('context: fbContext()') !== -1 &&
      html.indexOf('function fbContext()') !== -1;
  }
});

/* 3. 隐私文案更新：说明会发送方向与症状 */
cases.push({
  name: '隐私文案说明会发送方向与症状',
  run() {
    return html.indexOf('本次分析的可能方向与症状名称') !== -1 &&
      html.indexOf('不发送年龄、长期用药和照片') !== -1;
  }
});

/* 4. 前端不会发送年龄/用药 */
cases.push({
  name: '反馈 payload 不含年龄与长期用药',
  run() {
    const start = html.indexOf('async function fbSubmit');
    const end = html.indexOf('function initFeedback');
    const fn = start !== -1 && end !== -1 ? html.slice(start, end) : '';
    return fn.indexOf('patientAge') === -1 && fn.indexOf('chronic') === -1;
  }
});

/* 5. 档案面板展示我的反馈与改进状态 */
cases.push({
  name: '档案面板记录反馈与改进状态',
  run() {
    return html.indexOf('id="fbHistory"') !== -1 &&
      html.indexOf('function renderFeedbackHistory') !== -1 &&
      html.indexOf('renderFeedbackHistory();') !== -1 &&
      html.indexOf("fb.status === 'improved'") !== -1;
  }
});

/* 6. 本地保存带状态 */
cases.push({
  name: '提交成功后本地记录状态',
  run() {
    return html.indexOf("status: 'open'") !== -1 && html.indexOf('serverId') !== -1;
  }
});

/* 7. Worker 保存 context 与改进字段 */
cases.push({
  name: 'Worker 保存对应病症与改进状态',
  run() {
    return worker.indexOf('function normalizeContext') !== -1 &&
      worker.indexOf('context,') !== -1 &&
      worker.indexOf("status: 'open'") !== -1 &&
      worker.indexOf('improveNote') !== -1;
  }
});

/* 8. Worker 提供改进入口 */
cases.push({
  name: 'Worker 支持标记已改进',
  run() {
    return worker.indexOf('async function handleStatus') !== -1 &&
      worker.indexOf("'/api/feedback/status'") !== -1 &&
      worker.indexOf('Response.redirect') !== -1;
  }
});

/* 9. 汇总页展示对应病症与操作 */
cases.push({
  name: '汇总页展示对应病症与改进列',
  run() {
    return worker.indexOf('对应病症') !== -1 &&
      worker.indexOf('ctx.top') !== -1 &&
      worker.indexOf('name="status"') !== -1 &&
      worker.indexOf('name="note"') !== -1;
  }
});

/* 10. 上下文有长度与数量限制 */
cases.push({
  name: '上下文清洗限制数量与长度',
  run() {
    return worker.indexOf('slice(0, 3)') !== -1 &&
      worker.indexOf('slice(0, 20)') !== -1 &&
      worker.indexOf('str(x.id, 40)') !== -1;
  }
});

/* 11. 每次进入结果页重置反馈表单，避免按钮被上一次提交锁死 */
cases.push({
  name: '新结果页重置反馈表单',
  run() {
    return html.indexOf('function fbReset()') !== -1 &&
      html.indexOf('fbReset();') !== -1 &&
      html.indexOf('btn.disabled = false') !== -1 &&
      html.indexOf("btn.textContent = '提交反馈'") !== -1;
  }
});

/* 12. 重置会清空评分、标签、文本与状态 */
cases.push({
  name: '重置清空评分标签与状态',
  run() {
    const start = html.indexOf('function fbReset()');
    const end = html.indexOf('async function fbSubmit');
    const fn = start !== -1 && end !== -1 ? html.slice(start, end) : '';
    return fn.indexOf('fbRating = 0') !== -1 &&
      fn.indexOf('fbTags.clear()') !== -1 &&
      fn.indexOf("classList.remove('on')") !== -1 &&
      fn.indexOf('text.value =') !== -1 &&
      fn.indexOf("fbSetStatus('', '')") !== -1;
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