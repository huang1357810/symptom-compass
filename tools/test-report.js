/*
 * 医生版报告与科室推荐自测：node tools/test-report.js
 * 校验科室推荐逻辑、结果页接线与打印样式
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
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(m[1] + '\n;globalThis.__out = { suggestDepts };', sandbox, { timeout: 5000 });
const { suggestDepts } = sandbox.__out;

const cases = [];

/* 1. 红级直接急诊 */
cases.push({
  name: '红级推荐急诊科',
  run() {
    const d = suggestDepts([{ dept: '消化内科' }], { level: 'red' });
    return d.primary[0] === '急诊科' && d.others.length === 0;
  }
});

/* 2. 单一科室 */
cases.push({
  name: '黄级取首选专科',
  run() {
    const d = suggestDepts([{ dept: '消化内科' }], { level: 'yellow' });
    return d.primary[0] === '消化内科' && d.others.length === 0;
  }
});

/* 3. 多科室拆分与备选 */
cases.push({
  name: '多个方向生成备选科室',
  run() {
    const d = suggestDepts([
      { dept: '耳鼻喉科' },
      { dept: '消化内科 / 全科' },
      { dept: '呼吸内科' }
    ], { level: 'green' });
    return d.primary[0] === '耳鼻喉科' && d.others.indexOf('消化内科') !== -1 && d.others.indexOf('全科') !== -1;
  }
});

/* 4. 去重 */
cases.push({
  name: '重复科室只保留一次',
  run() {
    const d = suggestDepts([
      { dept: '消化内科' },
      { dept: '消化内科 / 全科' }
    ], { level: 'green' });
    return d.primary[0] === '消化内科' && d.others.length === 1 && d.others[0] === '全科';
  }
});

/* 5. 含急诊的科室优先急诊 */
cases.push({
  name: '科室含急诊时优先急诊',
  run() {
    const d = suggestDepts([{ dept: '呼吸内科 / 急诊' }], { level: 'yellow' });
    return d.primary[0] === '急诊科' && d.others.indexOf('呼吸内科') !== -1;
  }
});

/* 6. 没有结果时给全科 */
cases.push({
  name: '没有匹配方向时推荐全科',
  run() {
    const d = suggestDepts([], { level: 'yellow' });
    return d.primary[0] === '全科医学科';
  }
});

/* 7. 科室字段缺失时的兜底 */
cases.push({
  name: '科室字段缺失时推荐全科',
  run() {
    const d = suggestDepts([{ dept: '' }], { level: 'green' });
    return d.primary[0] === '全科医学科';
  }
});

/* 8. 页面接线：科室卡片、时间轴摘要、导出按钮 */
cases.push({
  name: '结果页接入科室与时间轴',
  run() {
    return html.indexOf('id="deptBox"') !== -1 &&
      html.indexOf('id="reportTimeline"') !== -1 &&
      html.indexOf('function renderDeptBox') !== -1 &&
      html.indexOf('function renderReportTimeline') !== -1 &&
      html.indexOf('renderDeptBox(results, triage)') !== -1;
  }
});

/* 9. 打印样式包含科室与摘要 */
cases.push({
  name: '打印样式保留科室与时间轴',
  run() {
    const printBlock = html.slice(html.indexOf('@media print'), html.indexOf('</style>'));
    return printBlock.indexOf('.dept-card') !== -1 && printBlock.indexOf('.report-timeline') !== -1;
  }
});

/* 10. 导出按钮走浏览器打印 */
cases.push({
  name: '导出按钮调用浏览器打印',
  run() {
    return html.indexOf("getElementById('exportBtn')") !== -1 &&
      html.indexOf('window.print()') !== -1 &&
      html.indexOf('另存为 PDF') !== -1;
  }
});

/* 11. 时间轴曲线进入打印报告 */
cases.push({
  name: '时间轴曲线进入报告',
  run() {
    return html.indexOf('chartSvg(view.pts, view.series)') !== -1 &&
      html.indexOf('report-tl-chart') !== -1;
  }
});

/* 12. 免责声明在打印时显示 */
cases.push({
  name: '免责声明在打印时显示',
  run() {
    const printBlock = html.slice(html.indexOf('@media print'), html.indexOf('</style>'));
    const hideRule = printBlock.slice(0, printBlock.indexOf('.print-head{display:block'));
    return hideRule.indexOf('.disclaimer') === -1 &&
      printBlock.indexOf('.disclaimer{display:block !important') !== -1;
  }
});

/* 13. 年龄与用药提示进入打印 */
cases.push({
  name: '年龄与用药提示进入打印',
  run() {
    const printBlock = html.slice(html.indexOf('@media print'), html.indexOf('</style>'));
    return printBlock.indexOf('.safety-box') !== -1 &&
      html.indexOf('未发现明显的年龄或药物冲突') !== -1;
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