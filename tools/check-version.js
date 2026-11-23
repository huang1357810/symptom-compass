/*
 * 版本一致性检查：node tools/check-version.js
 *
 * package.json 的 version 是唯一来源，以下四处必须一致：
 *   - site/index.html 的 CONTENT_VERSION
 *   - cloud/functiongraph/logic.js 头注释 @version
 *   - harmony/.../Data.ets 头注释 @version
 *   - README.md 顶部「版本：」
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const expected = 'v' + pkg.version;

const checks = [
  {
    file: 'site/index.html',
    test: s => s.indexOf("const CONTENT_VERSION = '" + expected + "';") !== -1,
    hint: "const CONTENT_VERSION = '" + expected + "';"
  },
  {
    file: 'cloud/functiongraph/logic.js',
    test: s => s.indexOf('@version ' + expected) !== -1,
    hint: '头注释 @version ' + expected
  },
  {
    file: 'harmony/entry/src/main/ets/common/Data.ets',
    test: s => s.indexOf('@version ' + expected) !== -1,
    hint: '头注释 @version ' + expected
  },
  {
    file: 'README.md',
    test: s => new RegExp('^- 版本：' + expected + '$', 'm').test(s),
    hint: '顶部 - 版本：' + expected
  }
];

const errors = [];
checks.forEach(c => {
  const p = path.join(ROOT, c.file);
  if (!fs.existsSync(p)) {
    errors.push(c.file + ' 不存在（请先运行 node tools/build.js）');
    return;
  }
  if (!c.test(fs.readFileSync(p, 'utf8'))) {
    errors.push(c.file + ' 未包含 ' + c.hint);
  }
});

if (errors.length) {
  console.error('版本不一致（期望 ' + expected + '）：\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('版本一致：' + expected + '（Web / 云函数 / 鸿蒙 / README）');