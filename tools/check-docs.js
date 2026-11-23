/*
 * 文档死链检查：node tools/check-docs.js
 *
 * 扫描 README.md、readme/*.md、docs/*.md 中的相对路径链接，
 * 目标文件/目录不存在则退出 1。跳过外链、锚点、邮件/电话与站点绝对路径。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'screenshots') return;
      walk(p, out);
    } else if (/\.md$/i.test(e.name)) {
      out.push(p);
    }
  });
  return out;
}

const files = [path.join(ROOT, 'README.md')]
  .concat(walk(path.join(ROOT, 'readme'), []))
  .concat(walk(path.join(ROOT, 'docs'), []));

const LINK = /\[[^\]]*\]\(([^)]+)\)/g;
const errors = [];
let checked = 0;

files.forEach(file => {
  if (!fs.existsSync(file)) {
    errors.push('缺少文档文件：' + path.relative(ROOT, file));
    return;
  }
  const text = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = LINK.exec(text)) !== null) {
    let target = m[1].trim();
    /* 去掉 Markdown 的 <...> 包裹与标题锚点 */
    target = target.replace(/^<|>$/g, '').split('#')[0].trim();
    if (!target) continue;
    if (/^(https?:|mailto:|tel:|data:)/i.test(target)) continue;
    if (target.startsWith('//')) continue;
    if (target.startsWith('/')) continue;
    target = target.split('?')[0];
    if (!target) continue;

    const abs = path.resolve(path.dirname(file), decodeURIComponent(target));
    checked += 1;
    if (!fs.existsSync(abs)) {
      errors.push(path.relative(ROOT, file) + ' → ' + m[1] + '（文件不存在）');
    }
  }
});

if (errors.length) {
  console.error('文档死链：\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('文档链接检查通过：' + files.length + ' 个文档，' + checked + ' 个相对链接');