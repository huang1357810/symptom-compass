/*
 * 从 Web 版 site/index.html 提取数据，生成 HarmonyOS 工程用的 Data.ets
 * 目的：单一数据源，避免手工转录 28 种疾病时出错
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', 'site', 'index.html');
const OUT_DIR = path.join(__dirname, '..', 'harmony', 'entry', 'src', 'main', 'ets', 'common');
const OUT = path.join(OUT_DIR, 'Data.ets');

const html = fs.readFileSync(HTML, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('未找到 script 块'); process.exit(1); }

// 在沙箱里执行，末尾挂出需要的数据
const code = m[1] + '\n;globalThis.__out = { SYMPTOMS, GROUPS, CONDITIONS, RED_FLAGS, PRESETS };';
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { timeout: 5000 });
const { SYMPTOMS, GROUPS, CONDITIONS, RED_FLAGS, PRESETS } = sandbox.__out;

// —— 校验（与 Web 版同一套规则）——
const errors = [];
for (const c of CONDITIONS) {
  for (const sid of Object.keys(c.symptoms)) {
    if (!SYMPTOMS[sid]) errors.push(`${c.id} 引用了不存在的症状 ${sid}`);
  }
  for (const sid of c.core) {
    if (!(sid in c.symptoms)) errors.push(`${c.id} 的 core 症状 ${sid} 不在 weights 中`);
  }
}
for (const f of RED_FLAGS) {
  for (const sid of f.ids) if (!SYMPTOMS[sid]) errors.push(`危险信号 ${f.title} 引用不存在的症状 ${sid}`);
}
if (errors.length) {
  console.error('数据校验失败:\n' + errors.join('\n'));
  process.exit(1);
}

const q = s => JSON.stringify(s);

const symptomLines = Object.entries(SYMPTOMS)
  .map(([id, s]) => `  ${q(id)}: { label: ${q(s.label)}, group: ${q(s.group)} }`)
  .join(',\n');

const conditionLines = CONDITIONS.map(c => {
  const sym = Object.entries(c.symptoms).map(([k, v]) => `${q(k)}: ${v}`).join(', ');
  const meds = c.meds.map(x => `{ n: ${q(x.n)}, note: ${q(x.note)} }`).join(', ');
  return [
    '  {',
    `    id: ${q(c.id)},`,
    `    name: ${q(c.name)},`,
    `    dept: ${q(c.dept)},`,
    `    tag: ${q(c.tag || '')},`,
    `    summary: ${q(c.summary)},`,
    `    symptoms: { ${sym} },`,
    `    core: [${c.core.map(q).join(', ')}],`,
    `    care: [${c.care.map(q).join(', ')}],`,
    `    meds: [${meds}],`,
    `    see: ${q(c.see)}`,
    '  }'
  ].join('\n');
}).join(',\n');

const flagLines = RED_FLAGS.map(f => {
  const mode = f.mode ? `mode: ${q(f.mode)}` : `mode: 'any'`;
  return `  { ids: [${f.ids.map(q).join(', ')}], ${mode}, title: ${q(f.title)}, msg: ${q(f.msg)} }`;
}).join(',\n');

const presetLines = Object.entries(PRESETS)
  .map(([k, v]) => `  ${q(k)}: [${v.map(q).join(', ')}]`)
  .join(',\n');

const content = `/**
 * 症状 / 疾病 / 危险信号 数据
 *
 * ⚠️ 本文件由 tools/gen-harmony-data.js 从 site/index.html 自动生成，请勿手工修改。
 * 修改内容请改 Web 版数据源后重新生成： node tools/gen-harmony-data.js
 */

export interface SymptomDef {
  label: string;
  group: string;
}

export interface MedInfo {
  n: string;
  note: string;
}

export interface ConditionDef {
  id: string;
  name: string;
  dept: string;
  tag: string;
  summary: string;
  symptoms: Record<string, number>;
  core: string[];
  care: string[];
  meds: MedInfo[];
  see: string;
}

export interface RedFlagDef {
  ids: string[];
  mode: string;
  title: string;
  msg: string;
}

export const GROUPS: string[] = [${GROUPS.map(q).join(', ')}];

export const SYMPTOMS: Record<string, SymptomDef> = {
${symptomLines}
};

export const CONDITIONS: ConditionDef[] = [
${conditionLines}
];

export const RED_FLAGS: RedFlagDef[] = [
${flagLines}
];

export const PRESETS: Record<string, string[]> = {
${presetLines}
};
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, content, 'utf8');

console.log('已生成:', OUT);
console.log('疾病:', CONDITIONS.length, '| 症状:', Object.keys(SYMPTOMS).length, '| 危险信号:', RED_FLAGS.length);
console.log('大小:', (fs.statSync(OUT).size / 1024).toFixed(1), 'KB');
