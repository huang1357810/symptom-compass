/*
 * 把 Web 版打包成华为云 FunctionGraph 函数所需的三件套：
 *   cloud/functiongraph/index.html  页面
 *   cloud/functiongraph/logic.js    数据 + 分诊算法（从页面 script 抽出，保证与前端完全一致）
 * 运行：node tools/gen-cloud-logic.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'site', 'index.html');
const OUT_DIR = path.join(ROOT, 'cloud', 'functiongraph');

const html = fs.readFileSync(SRC, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  console.error('未找到 script 块');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

// 1. 页面原样复制（它自己会探测 /api/triage/health 决定用云还是本地）
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html, 'utf8');

// 2. 逻辑抽出成 CommonJS 模块
const header = `/**
 * 分诊逻辑（服务端）
 * ⚠️ 由 tools/gen-cloud-logic.js 从 site/index.html 自动生成，请勿手工修改。
 * 该 script 末尾已自带 module.exports，因此可直接被 require。
 */

`;
fs.writeFileSync(path.join(OUT_DIR, 'logic.js'), header + m[1], 'utf8');

// 3. 3D 资源（模型 + three.js 模块）一并同步，云端页面才能打开 3D 视图
const ASSET_DIRS = [
  [path.join(ROOT, 'site', 'models'), path.join(OUT_DIR, 'models')],
  [path.join(ROOT, 'site', 'vendor'), path.join(OUT_DIR, 'vendor')]
];

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  fs.readdirSync(src, { withFileTypes: true }).forEach(ent => {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) n += copyDir(s, d);
    else { fs.copyFileSync(s, d); n++; }
  });
  return n;
}

let assetCount = 0;
ASSET_DIRS.forEach(([s, d]) => { assetCount += copyDir(s, d); });

// 4. 自检：确认能 require 且导出关键函数
delete require.cache[require.resolve(path.join(OUT_DIR, 'logic.js'))];
const logic = require(path.join(OUT_DIR, 'logic.js'));
const required = ['scoreConditions', 'flagsFor', 'SYMPTOMS', 'CONDITIONS', 'RED_FLAGS'];
const missing = required.filter(k => logic[k] === undefined);
if (missing.length) {
  console.error('导出缺失:', missing.join(', '));
  process.exit(1);
}

const sample = logic.scoreConditions(['sore_throat', 'fever']);
console.log('已生成:');
console.log('  ', path.join(OUT_DIR, 'index.html'), (html.length / 1024).toFixed(1) + ' KB');
console.log('  ', path.join(OUT_DIR, 'logic.js'), ((header.length + m[1].length) / 1024).toFixed(1) + ' KB');
console.log('自检通过：疾病', logic.CONDITIONS.length, '| 症状', Object.keys(logic.SYMPTOMS).length,
  '| 示例(咽痛+发热) =>', sample.map(r => r.name + ' ' + Math.round(r.score * 100) + '%').join(', '));
