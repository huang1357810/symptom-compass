/*
 * 文献出处自测：node tools/test-refs.js
 * 规则：
 *  - 每个 refs 的 id 必须是真实存在的 conditions id
 *  - url 域名必须在白名单内
 *  - title / org 非空，year 在 2000–2026
 *  - 有引用的病种数量 >= 20
 *  - 无引用的病种允许，但需在 docs/refs.md 中列出待补
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'site', 'index.html');
const html = fs.readFileSync(HTML, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('未找到 script 块'); process.exit(1); }

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(m[1] + '\n;globalThis.__out = { CONDITIONS, CONDITION_REFS };', sandbox, { timeout: 8000 });
const { CONDITIONS, CONDITION_REFS } = sandbox.__out;

const WHITELIST = [
  'nhc.gov.cn', 'cma.org.cn', 'chinacdc.cn', 'medjournals.cn',
  'yiigle.com', 'who.int'
];

const errors = [];
const ids = new Set(CONDITIONS.map(c => c.id));
let covered = 0;
let total = 0;

for (const [id, list] of Object.entries(CONDITION_REFS)) {
  if (!ids.has(id)) errors.push(`refs 中的 id 不存在：${id}`);
  if (!Array.isArray(list) || !list.length) continue;
  covered++;
  for (const r of list) {
    total++;
    if (!r.title || !String(r.title).trim()) errors.push(`${id}：缺少 title`);
    if (!r.org || !String(r.org).trim()) errors.push(`${id}：缺少 org`);
    if (!Number.isInteger(r.year) || r.year < 2000 || r.year > 2026) errors.push(`${id}：year 不合理（${r.year}）`);
    let host = '';
    try { host = new URL(r.url).hostname; } catch (e) { errors.push(`${id}：url 非法（${r.url}）`); continue; }
    if (!WHITELIST.some(d => host === d || host.endsWith('.' + d))) {
      errors.push(`${id}：域名不在白名单（${host}）`);
    }
    if (r.scope && !['general', 'children', 'specific'].includes(r.scope)) {
      errors.push(`${id}：scope 非法（${r.scope}）`);
    }
  }
}

if (covered < 20) errors.push(`有引用的病种仅 ${covered} 条，少于 20`);
if (total < 22) errors.push(`引用条目仅 ${total} 条，少于 22`);

// docs/refs.md 必须覆盖全部待补
const mdPath = path.join(ROOT, 'docs', 'refs.md');
if (fs.existsSync(mdPath)) {
  const md = fs.readFileSync(mdPath, 'utf8');
  for (const c of CONDITIONS) {
    if (!CONDITION_REFS[c.id] || !CONDITION_REFS[c.id].length) {
      if (!md.includes(c.name)) errors.push(`docs/refs.md 缺少待补条目：${c.name}`);
    }
  }
} else {
  errors.push('缺少 docs/refs.md');
}

if (errors.length) {
  console.error('文献出处校验失败：');
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log(`文献出处校验通过：${covered} 个病种有官方出处，共 ${total} 条；其余标记待补`);
