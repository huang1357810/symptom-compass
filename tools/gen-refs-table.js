/*
 * 生成指南出处核对表：node tools/gen-refs-table.js
 * 输出 docs/refs.md，待补条目置顶，方便人工补齐。
 *
 * 说明：URL 指向发布机构官网入口（可公开访问），指南原文页待人工替换。
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
vm.runInContext(m[1] + '\n;globalThis.__out={CONDITIONS};', sandbox, { timeout: 8000 });
const { CONDITIONS } = sandbox.__out;

const filled = [];
const pending = [];
CONDITIONS.forEach(c => {
  const refs = Array.isArray(c.refs) ? c.refs.filter(r => r && r.title) : [];
  if (refs.length) {
    filled.push({ c, refs });
  } else {
    pending.push(c);
  }
});

const rows = [];
pending.forEach(c => {
  rows.push('| ' + c.name + ' | 0 | — | — | — | — | 待补 |');
});
filled.forEach(({ c, refs }) => {
  refs.forEach(r => {
    rows.push('| ' + c.name + ' | ' + refs.length + ' | ' + r.title + ' | ' + (r.org || '—') +
      ' | ' + (r.year || '—') + ' | ' + (r.url || '—') + ' | 已填 |');
  });
});

const totalRefs = filled.reduce((n, x) => n + x.refs.length, 0);
const md = [
  '# 内容指南出处核对表',
  '',
  '> 由 `tools/gen-refs-table.js` 从 `site/index.html` 的 `CONDITIONS.refs` 自动生成。',
  '> **待补条目置顶**，方便人工补齐；`refs` 为空的条目允许存在，但必须在本表标为「待补」。',
  '> 链接统一指向发布机构官网入口（国家卫健委 / 中华医学会），**指南原文页待人工替换**。',
  '> 只收录「国家卫健委」或「中华医学会及专科学分会」公开发布的指南；无法确认的一律留空。',
  '',
  '- 已填：' + filled.length + ' 条情况 / ' + totalRefs + ' 条依据',
  '- 待补：' + pending.length + ' 条情况',
  '',
  '| 情况 | refs 数量 | 指南名称 | 机构 | 年份 | 链接 | 状态 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...rows,
  ''
].join('\n');

fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'refs.md'), md, 'utf8');
console.log('已写入 docs/refs.md：已填 ' + filled.length + ' 条（' + totalRefs + ' 条依据），待补 ' + pending.length + ' 条');