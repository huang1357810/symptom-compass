/*
 * 阴性降权（阶段 2）自测：node tools/test-direction-negatives.js
 *
 * 10 组「A 病 vs B 病」混淆对：加入用户明确否定的症状后，Top1 应等于人工 gold。
 * 同时静态校验危险信号逻辑未被改动。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'site', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  console.error('未找到 script 块');
  process.exit(1);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  m[1] + '\n;globalThis.__out={scoreConditions,flagsFor,RED_FLAGS,SYMPTOMS};',
  sandbox,
  { timeout: 8000 }
);
const { scoreConditions, flagsFor, RED_FLAGS, SYMPTOMS } = sandbox.__out;

const label = id => (SYMPTOMS[id] ? SYMPTOMS[id].label : id);

const GROUPS = [
  { name: '咽炎 vs 感冒（否定发热、吞咽痛）', sel: ['sore_throat', 'congestion', 'dry_cough'], neg: ['fever', 'dysphagia'], gold: 'cold' },
  { name: '偏头痛 vs 紧张性头痛（否定畏光、呕吐）', sel: ['headache', 'nausea'], neg: ['photophobia', 'vomiting'], gold: 'tension_headache' },
  { name: '过敏性鼻炎 vs 感冒（否定眼痒、瘙痒、嗅觉减退）', sel: ['sneeze', 'runny_nose', 'congestion'], neg: ['eye_itch', 'itch', 'smell_loss'], gold: 'cold' },
  { name: '肺炎 vs 支气管炎（否定气短、高热）', sel: ['dry_cough', 'sputum', 'fever'], neg: ['dyspnea', 'high_fever'], gold: 'bronchitis' },
  { name: '胃肠炎 vs 消化不良（否定腹泻、呕吐）', sel: ['nausea', 'abdominal_pain', 'bloating'], neg: ['diarrhea', 'vomiting'], gold: 'dyspepsia' },
  { name: '结石 vs 尿路感染（否定血尿、恶心）', sel: ['urinary_freq', 'dysuria', 'flank_pain'], neg: ['hematuria', 'nausea'], gold: 'uti' },
  { name: '咽炎 vs 中耳炎（否定咽痛、鼻塞）', sel: ['fever', 'ear_pain', 'hearing_loss'], neg: ['sore_throat', 'congestion'], gold: 'otitis' },
  { name: '牙痛 vs 鼻窦炎（否定牙痛）', sel: ['facial_pain', 'headache', 'congestion'], neg: ['toothache'], gold: 'sinusitis' },
  { name: '腰肌劳损 vs 痛风（否定腰背痛、肌痛）', sel: ['joint_pain', 'joint_swelling', 'fever'], neg: ['back_pain', 'myalgia'], gold: 'gout' },
  { name: '感冒 vs 鼻窦炎（否定流涕、喷嚏）', sel: ['purulent_discharge', 'facial_pain', 'congestion'], neg: ['runny_nose', 'sneeze'], gold: 'sinusitis' }
];

const errors = [];
let flipped = 0;

/* 先关闭阶段 2 开关，记录加入否定前的 Top1 */
vm.runInContext('RANK_FLAGS.negPenalty = false;', sandbox);
const base = GROUPS.map(g => {
  const top = scoreConditions(g.sel, new Set(g.neg))[0];
  return top ? top.id : null;
});

/* 打开阶段 2：阴性按权重罚 */
vm.runInContext('RANK_FLAGS.negPenalty = true;', sandbox);
GROUPS.forEach((g, i) => {
  const results = scoreConditions(g.sel, new Set(g.neg));
  const top = results[0] ? results[0].id : null;
  if (top !== g.gold) {
    errors.push(g.name + '：期望 ' + label(g.gold) + '，实际 ' + label(top));
  }
  if (base[i] !== g.gold && top === g.gold) flipped += 1;
});

if (flipped < 1) errors.push('阴性降权应至少让 1 组从错误翻盘为 gold，实际 ' + flipped);

/* 危险信号逻辑不得受排序改动影响 */
const flags = flagsFor(new Set(['chest_pain']));
if (!flags.some(f => f.title === '胸痛')) errors.push('胸痛危险信号丢失');
if (RED_FLAGS.length < 20) errors.push('危险信号条数异常：' + RED_FLAGS.length);

if (errors.length) {
  console.error('阴性降权校验失败：\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('阴性降权 10/10 组 Top1 符合 gold（其中加入否定后翻盘 ' + flipped + ' 组）；危险信号逻辑未变');