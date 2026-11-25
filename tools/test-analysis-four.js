/*
 * 四段式「分析过程」自测：node tools/test-analysis-four.js
 *
 * 构造绿/黄/红三组结果，断言四段都存在、红色场景 ③ 在 ① 之前、文案不含禁用词。
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
  m[1] + '\n;globalThis.__out={renderAnalysisFour};',
  sandbox,
  { timeout: 10000 }
);
const { renderAnalysisFour } = sandbox.__out;
vm.runInContext('answers.duration=1; answers.fever=1; answers.activity=0;', sandbox);

const green = renderAnalysisFour(
  [{ name: '普通感冒', score: 0.62, matched: ['runny_nose', 'sneeze'] }],
  [],
  { level: 'green', title: '可以先观察', advice: '目前整体偏轻，可以先按建议自我照护。', reasons: [] }
);

const yellow = renderAnalysisFour(
  [{ name: '急性咽炎 / 扁桃体炎', score: 0.55, matched: ['sore_throat'] }],
  [],
  { level: 'yellow', title: '建议尽快就诊', advice: '建议这两天到耳鼻喉科检查一下。', reasons: ['症状持续超过 1 周'] }
);

const red = renderAnalysisFour(
  [],
  [{ title: '胸痛' }],
  { level: 'red', title: '建议立即就医', advice: '请立即前往医院急诊，紧急时拨打 120。', reasons: ['胸痛'] }
);

const errors = [];
const ok = (name, cond, detail) => {
  if (!cond) errors.push(name + (detail ? '：' + detail : ''));
};

[['绿色', green], ['黄色', yellow], ['红色', red]].forEach(([label, out]) => {
  ['① 我听到的', '② 可能方向', '③ 风险判断', '④ 建议'].forEach(title => {
    ok(label + ' 缺少「' + title + '」', out.indexOf(title) !== -1);
  });
});

ok('绿色显示低风险', green.indexOf('低风险') !== -1, green);
ok('黄色显示中风险', yellow.indexOf('中风险') !== -1, yellow);
ok('红色显示已命中的危险信号', red.indexOf('已命中：胸痛') !== -1, red);
ok('红色 ③ 出现在 ① 之前', red.indexOf('③ 风险判断') !== -1 &&
  red.indexOf('③ 风险判断') < red.indexOf('① 我听到的'), red);
ok('① 列出症状与三问文案', green.indexOf('症状：') !== -1 && green.indexOf('1–3 天') !== -1, green);
ok('④ 使用 triage.advice 原文', green.indexOf('目前整体偏轻，可以先按建议自我照护。') !== -1, green);
ok('② 给出 Top3 名称与百分比', yellow.indexOf('急性咽炎 / 扁桃体炎') !== -1 && yellow.indexOf('%') !== -1, yellow);

const all = green + yellow + red;
['确诊', '你可能得了', '概率'].forEach(word => {
  ok('文案出现禁用词「' + word + '」', all.indexOf(word) === -1);
});

if (errors.length) {
  console.error('四段式分析校验失败：\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('四段式分析 15/15 通过（绿/黄/红三段齐全、红色 ③ 置顶、无禁用词）');