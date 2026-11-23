/*
 * 一键构建：node tools/build.js（npm run build）
 *
 * 顺序：
 *   1. 把 package.json 的 version 注入 Web CONTENT_VERSION 与 README
 *   2. gen-cloud-logic → gen-harmony-data → run-evals →（pack-cloudbase，若已移除则跳过）
 *   3. check-version → check-docs
 *   4. 要求 git status 干净（生成物已同步并已提交）
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = 'v' + pkg.version;

function run(script) {
  console.log('== node tools/' + script);
  const r = spawnSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) {
    console.error('构建失败：' + script);
    process.exit(r.status || 1);
  }
}

function inject(rel, re, value) {
  const p = path.join(ROOT, rel);
  const s = fs.readFileSync(p, 'utf8');
  if (!re.test(s)) {
    console.error(rel + ' 中未找到版本位置，无法注入');
    process.exit(1);
  }
  fs.writeFileSync(p, s.replace(re, value), 'utf8');
}

/* 1. 先注入版本，再生成，保证云端副本拿到新版 */
inject('site/index.html', /const CONTENT_VERSION = '[^']*';/, "const CONTENT_VERSION = '" + version + "';");
inject('README.md', /^- 版本：v[0-9.]+$/m, '- 版本：' + version);

/* 2. 生成物 */
run('gen-cloud-logic.js');
run('gen-harmony-data.js');
run('run-evals.js');
if (fs.existsSync(path.join(__dirname, 'pack-cloudbase.js'))) {
  run('pack-cloudbase.js');
} else {
  console.log('== 跳过 pack-cloudbase（脚本已移除）');
}

/* 3. 版本与文档校验 */
run('check-version.js');
run('check-docs.js');

/* 4. 工作区必须干净 */
const g = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
if (g.status !== 0) {
  console.error('git status 执行失败');
  process.exit(1);
}
const dirty = String(g.stdout || '').trim();
if (dirty) {
  console.error('构建后工作区不干净，请提交以下改动后重试：');
  console.error(dirty);
  process.exit(1);
}
console.log('构建完成：' + version + '，工作区干净');