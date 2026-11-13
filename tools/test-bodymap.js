/*
 * 人体部位图自测：node tools/test-bodymap.js
 * 校验部位与症状的映射关系，以及 SVG 热点与数据是否一一对应
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', 'site', 'index.html');
const html = fs.readFileSync(HTML, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  console.error('未找到 script 块');
  process.exit(1);
}

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(m[1] + '\n;globalThis.__out = { SYMPTOMS, BODY_PARTS };', sandbox, { timeout: 5000 });
const { SYMPTOMS, BODY_PARTS } = sandbox.__out;

const errors = [];
const partIds = new Set();

BODY_PARTS.forEach(p => {
  if (!p.id) errors.push('部位缺少 id');
  if (partIds.has(p.id)) errors.push('部位 id 重复：' + p.id);
  partIds.add(p.id);
  if (!p.label) errors.push(p.id + ' 缺少名称');
  if (!Array.isArray(p.groups) || !p.groups.length) errors.push(p.id + ' 没有症状分组');

  const seen = new Set();
  let total = 0;
  (p.groups || []).forEach(g => {
    if (!g.name) errors.push(p.id + ' 有分组缺少名称');
    if (!Array.isArray(g.ids) || !g.ids.length) errors.push(p.id + '/' + g.name + ' 没有症状');
    (g.ids || []).forEach(id => {
      if (!SYMPTOMS[id]) errors.push(p.id + ' 引用了不存在的症状 ' + id);
      if (seen.has(id)) errors.push(p.id + ' 内症状重复：' + id);
      seen.add(id);
      total++;
    });
  });
  if (total < 2) errors.push(p.id + ' 的症状少于 2 个');
});

/* SVG 热点必须都能在数据里找到 */
const hotspots = [];
const re = /data-part="([^"]+)"/g;
let hit;
while ((hit = re.exec(html)) !== null) {
  if (hotspots.indexOf(hit[1]) === -1) hotspots.push(hit[1]);
}

hotspots.forEach(id => {
  if (!partIds.has(id)) errors.push('SVG 热点 ' + id + ' 在 BODY_PARTS 中没有对应数据');
});

/* 每个部位至少有一个可点的热点或入口 */
BODY_PARTS.forEach(p => {
  if (hotspots.indexOf(p.id) === -1) errors.push('部位 ' + p.id + ' 没有对应的可点热点');
});

/* 关键部位必须有，避免以后误删 */
const need = ['head', 'neck', 'chest', 'upper_abd', 'lower_abd', 'back', 'lowback', 'skin'];
need.forEach(id => {
  if (!partIds.has(id)) errors.push('缺少关键部位 ' + id);
});

/* 典型症状要能在对应部位找到 */
const expectations = [
  ['head', 'headache'],
  ['chest', 'chest_pain'],
  ['upper_abd', 'epigastric_pain'],
  ['lower_abd', 'abdominal_pain'],
  ['lowback', 'flank_pain'],
  ['skin', 'rash']
];
expectations.forEach(([partId, sid]) => {
  const part = BODY_PARTS.find(p => p.id === partId);
  if (!part) return;
  const all = part.groups.reduce((acc, g) => acc.concat(g.ids), []);
  if (all.indexOf(sid) === -1) errors.push(part.label + ' 里找不到 ' + (SYMPTOMS[sid] ? SYMPTOMS[sid].label : sid));
});

if (errors.length) {
  console.error('人体部位图校验失败：\n  ' + errors.join('\n  '));
}
console.log('部位 ' + BODY_PARTS.length + ' 个，可点热点 ' + hotspots.length + ' 处，问题 ' + errors.length + ' 个');
process.exit(errors.length ? 1 : 0);