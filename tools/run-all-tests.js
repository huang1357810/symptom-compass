/*
 * 一键跑全部自测：node tools/run-all-tests.js
 * 也用于 package.json 的 npm test。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
const files = fs.readdirSync(dir)
  .filter(f => /^test-.*\.js$/.test(f) || f === 'security-check.js')
  .sort();

if (!files.length) {
  console.error('没有找到 tools/test-*.js');
  process.exit(1);
}

const failed = [];
for (const f of files) {
  console.log('== ' + f);
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(f);
}

console.log('');
if (failed.length) {
  console.error('失败 ' + failed.length + ' 个：' + failed.join(', '));
  process.exit(1);
}
console.log('全部 ' + files.length + ' 个测试通过');