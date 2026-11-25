const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = 'D:/明辨康途/symptom-compass';
const html = fs.readFileSync(path.join(ROOT, 'site/index.html'), 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code + '\n;globalThis.__out={CONDITIONS,CONDITION_REFS};', sandbox, { timeout: 8000 });
const { CONDITIONS, CONDITION_REFS } = sandbox.__out;

const rows = CONDITIONS.map(c => {
  const list = CONDITION_REFS[c.id] || [];
  const status = list.length ? '已确认' : '待补';
  const first = list[0] || {};
  const domain = first.url ? new URL(first.url).hostname : '—';
  const scope = first.scope === 'children' ? '适用儿童' : first.scope === 'specific' ? '特定亚型' : '通用';
  return { name: c.name, status, count: list.length, title: first.title || '—', org: first.org || '—', year: first.year || '—', domain, scope };
});

const pending = rows.filter(r => r.status === '待补');
const done = rows.filter(r => r.status === '已确认');

const lines = [];
lines.push('# 文献出处核对表');
lines.push('');
lines.push(`> 由 tools/test-refs.js 生成。共 ${rows.length} 条内容：**已确认 ${done.length} 条**，待补 ${pending.length} 条。`);
lines.push('> 只收录官方/学会域名（国家卫健委、中华医学会、中国疾控、中华医学期刊、WHO）。');
lines.push('');
lines.push('## 待补（优先处理）');
lines.push('');
lines.push('| 情况 | 说明 |');
lines.push('| --- | --- |');
pending.forEach(r => lines.push(`| ${r.name} | 未找到符合白名单的公开指南，暂不标注出处 |`));
lines.push('');
lines.push('## 已确认');
lines.push('');
lines.push('| 情况 | 条数 | 指南 | 机构 | 年份 | 域名 | 适用范围 |');
lines.push('| --- | --- | --- | --- | --- | --- | --- |');
done.forEach(r => lines.push(`| ${r.name} | ${r.count} | ${r.title} | ${r.org} | ${r.year} | ${r.domain} | ${r.scope} |`));
lines.push('');

fs.writeFileSync(path.join(ROOT, 'docs/refs.md'), lines.join('\n'), 'utf8');
console.log(`已写入 docs/refs.md：已确认 ${done.length}，待补 ${pending.length}`);
