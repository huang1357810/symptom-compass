/*
 * 生成 worker/symptom-ids.mjs：node tools/gen-symptom-ids.js
 * 从 site/index.html 抽取 SYMPTOM_IDS，供 Worker 端 LLM 抽取做白名单。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  console.error('未找到 script 块');
  process.exit(1);
}
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(m[1] + '\n;globalThis.__out={SYMPTOM_IDS};', sandbox, { timeout: 8000 });
const ids = sandbox.__out.SYMPTOM_IDS;

const lines = [];
for (let i = 0; i < ids.length; i += 8) {
  lines.push('  ' + ids.slice(i, i + 8).map(x => "'" + x + "'").join(', ') + ',');
}
const content = '/* 由 tools/gen-symptom-ids.js 从 site/index.html 生成，请勿手改。 */\n' +
  'export const SYMPTOM_IDS = [\n' + lines.join('\n') + '\n];\n';

fs.writeFileSync(path.join(ROOT, 'worker', 'symptom-ids.mjs'), content, 'utf8');
console.log('已生成 worker/symptom-ids.mjs，共 ' + ids.length + ' 个症状 id');