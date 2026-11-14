/*
 * 分页布局自测：node tools/test-layout.js
 * 确认「关键词」与「人体图 / 3D」分别在两页，年龄与操作区固定在分页之外
 */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'site', 'index.html'), 'utf8');
const errors = [];

const p0 = html.indexOf('class="pager-page" data-page="0"');
const p1 = html.indexOf('class="pager-page" data-page="1"');
if (p0 === -1 || p1 === -1) {
  errors.push('缺少两个 pager-page');
}
if (p0 !== -1 && p1 !== -1 && p1 < p0) errors.push('分页顺序不对');

const ageIndex = html.indexOf('class="agebox"');
const actionsIndex = html.indexOf('class="actions"');

const page0 = p0 !== -1 && p1 !== -1 ? html.slice(p0, p1) : '';
const page1 = p1 !== -1 ? html.slice(p1, ageIndex === -1 ? undefined : ageIndex) : '';

function has(block, needle, label) {
  if (block.indexOf(needle) === -1) errors.push(label + ' 缺少 ' + needle);
}
function lacks(block, needle, label) {
  if (block.indexOf(needle) !== -1) errors.push(label + ' 不应包含 ' + needle);
}

has(page0, 'id="nluInput"', '第 1 页');
has(page0, 'id="search"', '第 1 页');
has(page0, 'data-preset="cold"', '第 1 页');
lacks(page0, 'id="body3dBtn"', '第 1 页');

has(page1, 'id="body3dBtn"', '第 2 页');
has(page1, 'class="body-map"', '第 2 页');
has(page1, 'id="groups"', '第 2 页');
lacks(page1, 'id="nluInput"', '第 2 页');

if (ageIndex !== -1 && p1 !== -1 && ageIndex < p1) errors.push('年龄框应在分页之后（固定不随页滑动）');
if (actionsIndex !== -1 && ageIndex !== -1 && actionsIndex < ageIndex) errors.push('操作按钮应在年龄框之后');
if (actionsIndex !== -1 && p1 !== -1 && actionsIndex < p1) errors.push('操作按钮应在分页之外');

if (html.indexOf('id="pager"') === -1) errors.push('缺少分页容器 id="pager"');
if (html.indexOf('scroll-snap-type:x mandatory') === -1) errors.push('缺少横向滑动（scroll-snap）样式');
if (html.indexOf('class="pager-tab') === -1) errors.push('缺少页签');
if (html.indexOf('function setPager') === -1) errors.push('缺少分页切换逻辑');

if (errors.length) {
  console.error('分页布局校验失败：\n  ' + errors.join('\n  '));
} else {
  console.log('分页结构正确：第 1 页关键词 / 第 2 页人体图与 3D，年龄与操作区固定');
}
process.exit(errors.length ? 1 : 0);