/*
 * 远端内容转义自测：node tools/test-remote-render.js
 * 构造带 <img onerror> / <script> 的远端 name/summary，断言输出已转义。
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
  m[1] + '\n;globalThis.__out = { renderCondition, renderUrgent, esc };',
  sandbox,
  { timeout: 5000 }
);
const { renderCondition, renderUrgent, esc } = sandbox.__out;

const evil = {
  id: 'evil',
  name: '<img src=x onerror=alert(1)>',
  dept: '<b>dept</b>',
  tag: '<i>tag</i>',
  summary: '<script>alert(1)</script>',
  care: ['<b>care</b>'],
  meds: [{ n: '<i>n</i>', note: '<u>note</u>' }],
  see: '<svg onload=alert(1)>',
  source: '<s>src</s>',
  reviewer: '<s>rev</s>',
  updated: '2026-11-22',
  score: 0.5,
  matched: ['<x>', 'fever']
};

const condHtml = renderCondition(evil, 0, false);
const urgentHtml = renderUrgent(
  { level: 'red', title: '<img>', advice: '<script>x</script>', reasons: ['<b>r</b>'] },
  [{ title: '<i>t</i>', msg: '<u>m</u>' }]
);

const cases = [];

function noRawTags(s) {
  /* 模板自带 <svg class="chev"> 图标，这里只检查恶意标记本身 */
  return s.indexOf('<img src=x') === -1 &&
    s.indexOf('<script>alert(1)</script>') === -1 &&
    s.indexOf('<b>care</b>') === -1 &&
    s.indexOf('<svg onload') === -1 &&
    s.indexOf('<i>n</i>') === -1 &&
    s.indexOf('<x>') === -1;
}

cases.push({
  name: '疾病卡片转义远端 name/summary/care/meds/see',
  run() {
    return noRawTags(condHtml) &&
      condHtml.indexOf('&lt;img') !== -1 &&
      condHtml.indexOf('&lt;script') !== -1 &&
      condHtml.indexOf('&lt;b&gt;care') !== -1;
  }
});

cases.push({
  name: '急症横幅转义 title/advice/reasons/flags',
  run() {
    return noRawTags(urgentHtml) &&
      urgentHtml.indexOf('&lt;img') !== -1 &&
      urgentHtml.indexOf('&lt;script') !== -1 &&
      urgentHtml.indexOf('&lt;i&gt;t') !== -1;
  }
});

cases.push({
  name: '匹配症状标签对未知 id 回退并转义',
  run() {
    return condHtml.indexOf('&lt;x&gt;') !== -1 && condHtml.indexOf('发热') !== -1;
  }
});

cases.push({
  name: 'esc 基础转义',
  run() {
    return esc('<a href="x">&</a>') === '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;';
  }
});

cases.push({
  name: '源码接线：急症走 renderUrgent',
  run() {
    return html.indexOf('renderUrgent(triage, flags)') !== -1;
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