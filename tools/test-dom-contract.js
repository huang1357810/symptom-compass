/*
 * DOM 契约自测：node tools/test-dom-contract.js
 *
 * 静态解析 site/index.html，断言关键 id、人体图热点数量、隐藏自检入口与调试入口存在。
 * 删除任一关键按钮或结构时，CI 必须变红。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');
const selftestPath = path.join(ROOT, 'site', 'selftest.html');

const errors = [];
const has = (needle, label) => {
  if (html.indexOf(needle) === -1) errors.push('缺少 ' + label + '（' + needle + '）');
};

/* 1. 关键 DOM id */
[
  ['id="nluInput"', '自然语言输入框'],
  ['id="go"', '开始分诊按钮'],
  ['id="toResults"', '查看分诊结果按钮'],
  ['id="triage"', '三问区块'],
  ['id="results"', '结果区块'],
  ['id="list"', '结果列表'],
  ['id="feedback"', '反馈区块'],
  ['id="envTips"', '天气健康提示区块'],
  ['id="largeTextToggle"', '大字模式开关'],
  ['id="clear"', '清空按钮'],
  ['class="logo"', 'logo（隐藏自检入口）']
].forEach(([n, l]) => has(n, l));

/* 2. 隐藏自检入口与调试入口 */
has('selftest.html', 'logo 五连击自检入口');
if (html.indexOf('logoTaps') === -1) errors.push('缺少 logo 连击计数逻辑');
has('?debug=1', '调试入口');
has('class="why"', '「为什么推荐」样式');
has('class="dbg"', '调试块样式');

/* 3. 人体图热点：唯一 data-part 必须为 20 */
const parts = new Set();
const re = /data-part="([^"]+)"/g;
let m;
while ((m = re.exec(html)) !== null) parts.add(m[1]);
if (parts.size !== 20) errors.push('人体图唯一热点应为 20，实际 ' + parts.size);

/* 4. 自检页存在且包含全部检查项 */
if (!fs.existsSync(selftestPath)) {
  errors.push('缺少 site/selftest.html');
} else {
  const st = fs.readFileSync(selftestPath, 'utf8');
  ['关键 DOM id', '人体图热点', 'NLU 识别', '分诊流程', '大字模式'].forEach(name => {
    if (st.indexOf(name) === -1) errors.push('selftest.html 缺少检查项：' + name);
  });
  if (st.indexOf('src="./index.html"') === -1) errors.push('selftest.html 未加载 index.html');
}

/* 5. 版本单一来源占位 */
if (!/const CONTENT_VERSION = 'v[0-9.]+';/.test(html)) errors.push('缺少 CONTENT_VERSION 版本占位');

if (errors.length) {
  console.error('DOM 契约校验失败：\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('DOM 契约通过：关键 id 11 个、人体图热点 ' + parts.size + ' 个、自检入口与调试入口均在');