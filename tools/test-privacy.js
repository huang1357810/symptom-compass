/*
 * 隐私与数据说明页自测：node tools/test-privacy.js
 * 校验页面内容、入口链接、离线缓存与云端同步。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const P = path.join(ROOT, 'site', 'privacy.html');
const html = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'site', 'sw.js'), 'utf8');
const gen = fs.readFileSync(path.join(ROOT, 'tools', 'gen-cloud-logic.js'), 'utf8');

if (!fs.existsSync(P)) {
  console.error('缺少 site/privacy.html');
  process.exit(1);
}
const page = fs.readFileSync(P, 'utf8');

const errors = [];
const must = (cond, msg) => { if (!cond) errors.push(msg); };

/* 1. 页面核心内容 */
must(page.indexOf('隐私与数据说明') !== -1, '页面缺少标题');
must(page.indexOf('不做诊断') !== -1 || page.indexOf('不是诊断') !== -1, '页面缺少医疗边界说明');

/* 2. 本机存储键全部列出 */
[
  'mingbian.profile.v1',
  'mingbian.timeline.v1',
  'mingbian.feedback.v1',
  'mingbian.pwa.dismissed'
].forEach(k => must(page.indexOf(k) !== -1, '页面未列出本机存储键 ' + k));

/* 3. 反馈上传字段与不传字段 */
must(page.indexOf('评分') !== -1 && page.indexOf('标签') !== -1 && page.indexOf('建议文字') !== -1, '页面缺少反馈字段说明');
must(page.indexOf('症状名称') !== -1 && page.indexOf('可能方向') !== -1, '页面缺少分析上下文说明');
must(page.indexOf('不上传') !== -1 && page.indexOf('照片') !== -1, '页面缺少照片不上传说明');
must(page.indexOf('年龄') !== -1 && page.indexOf('长期用药') !== -1, '页面缺少年龄/用药不上传说明');

/* 4. 删除方式与联系方式 */
must(page.indexOf('清除全部记录') !== -1, '页面缺少清除方式');
must(page.indexOf('github.com/huang1357810/symptom-compass') !== -1, '页面缺少联系方式');
must(page.indexOf('2026-11-22') !== -1, '页面缺少更新日期');

/* 5. 入口链接 */
const links = (html.match(/href="privacy\.html"/g) || []).length;
must(links >= 2, 'index.html 中隐私页入口少于 2 处（页脚 + 档案面板）');

/* 6. 离线缓存 */
must(sw.indexOf("./privacy.html") !== -1, 'sw.js 未预缓存 privacy.html');
const ver = /mingbian-kangtu-v(\d+)/.exec(sw);
must(ver !== null && Number(ver[1]) >= 9, 'sw.js 缓存版本需 >= v9');

/* 7. 云端同步 */
must(gen.indexOf("privacy.html") !== -1, 'gen-cloud-logic.js 未复制 privacy.html');
must(fs.existsSync(path.join(ROOT, 'cloud', 'functiongraph', 'privacy.html')), '云端缺少 privacy.html（请运行 gen-cloud-logic.js）');

/* 8. CloudBase 打包脚本会遍历 site/（若脚本存在） */
const packPath = path.join(ROOT, 'tools', 'pack-cloudbase.js');
if (fs.existsSync(packPath)) {
  const pack = fs.readFileSync(packPath, 'utf8');
  must(pack.indexOf('SITE') !== -1, 'pack-cloudbase.js 未遍历 site/');
}

if (errors.length) {
  console.error('隐私页校验失败：\n  ' + errors.join('\n  '));
} else {
  console.log('隐私与数据说明页校验通过');
}
process.exit(errors.length ? 1 : 0);