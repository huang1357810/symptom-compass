/*
 * 生成医生盲评材料：node tools/gen-review-cases.js
 *
 * 输入：data/direction-eval.json（100 条）
 * 输出：
 *   data/review-cases.json        盲评用病例（不含任何系统结论）
 *   data/review-key.json          答案键（仅研究者持有，含系统等级；不得交给医生）
 *   docs/盲评表.md                可打印/填写的表格（不含系统结论）
 *   data/review-csv-template.csv  空表头
 *
 * 抽样：固定随机种子 20260101；年龄档 × 等级 双重配额，满足：
 *   年龄 0–5:8 / 6–17:12 / 18–39:30 / 40–59:25 / 60+:25
 *   等级 红 25 / 黄 40 / 绿 35
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SEED = 20260101;

const html = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  console.error('未找到 script 块');
  process.exit(1);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(m[1] + '\n;globalThis.__out={SYMPTOMS,QUESTIONS,RED_FLAGS};', sandbox, { timeout: 10000 });
const { SYMPTOMS, QUESTIONS, RED_FLAGS } = sandbox.__out;

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'direction-eval.json'), 'utf8'));

/* 固定种子随机数（mulberry32） */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);

function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function triageOf(item) {
  const ids = item.input.symptoms || [];
  const ans = item.input.answers || {};
  vm.runInContext('selected.clear();', sandbox);
  vm.runInContext(JSON.stringify(ids) + '.forEach(function(id){ selected.add(id); });', sandbox);
  vm.runInContext('Object.keys(answers).forEach(function(k){ delete answers[k]; });', sandbox);
  ['duration', 'fever', 'activity'].forEach(k => {
    if (ans[k] !== undefined) vm.runInContext('answers["' + k + '"]=' + Number(ans[k]) + ';', sandbox);
  });
  vm.runInContext('patientAge=' + (typeof item.input.age === 'number' ? item.input.age : 'null') + ';', sandbox);
  return vm.runInContext(
    '(function(){var ctx={age:patientAge,durationDays:durationDaysFromAnswers()};' +
    'var fl=flagsFor(selected,ctx);var rs=scoreConditions(selected,new Set(),ctx);' +
    'var tr=computeTriage(rs,fl);return {level:tr.level};})()',
    sandbox
  );
}

function labelOf(id) { return SYMPTOMS[id] ? SYMPTOMS[id].label : ''; }

/* 补足到至少 3 个症状：只加「非红旗」伴随症状，不改变分诊等级 */
const EXTRAS = ['fatigue', 'poor_appetite', 'headache', 'nausea', 'chills', 'dizziness'];
function ensureMin(ids) {
  const out = ids.slice();
  for (const e of EXTRAS) {
    if (out.length >= 3) break;
    if (out.indexOf(e) === -1 && SYMPTOMS[e]) out.push(e);
  }
  return out;
}

function answerLabel(qid, idx) {
  const q = QUESTIONS.find(x => x.id === qid);
  if (!q || idx === undefined || !q.options[idx]) return '';
  return q.options[idx].label;
}

/* 活动能力按年龄适配；<12 岁不得出现「工作」字样 */
function activityText(age, idx) {
  const i = Math.max(0, Math.min(2, Number(idx) || 0));
  if (age < 12) return ['精神好能玩', '精神差但能进食', '嗜睡难唤醒'][i];
  if (age >= 65) return ['日常活动正常', '活动减少但能自理', '卧床需人照顾'][i];
  return ['活动正常', '影响工作但能自理', '卧床需人照顾'][i];
}

/* 去重并计算等级 */
const seen = new Set();
const pool = [];
data.forEach(item => {
  const ids = ensureMin(item.input.symptoms || []);
  const names = ids.map(labelOf);
  if (names.some(n => !n)) return;
  const key = ids.slice().sort().join(',') + '|' + JSON.stringify(item.input.answers || {}) + '|' + item.input.age;
  if (seen.has(key)) return;
  seen.add(key);
  const item2 = { input: { symptoms: ids, answers: item.input.answers || {}, age: item.input.age } };
  const t = triageOf(item2);
  pool.push({ item: item2, names, level: t.level });
});

const groups = { red: [], yellow: [], green: [] };
pool.forEach(c => { if (groups[c.level]) groups[c.level].push(c); });

/* 合成候选：红例取危险信号组合，黄例取绿例 + 高病程/受限三问；年龄覆盖各档 */
function synthRed(limit) {
  const variants = [];
  RED_FLAGS.forEach(f => {
    const isCond = f.when && typeof f.when.ageMax === 'number';
    const ages = isCond ? [Math.max(0, f.when.ageMax - 0.01)] : [2, 9, 25, 45, 66, 78];
    ages.forEach(age => variants.push({ ids: ensureMin(f.ids), age, answers: { duration: 1, fever: 2, activity: 1 } }));
  });
  const out = [];
  for (const v of shuffled(variants)) {
    if (out.length >= limit) break;
    const item = { input: { symptoms: v.ids, answers: v.answers, age: v.age } };
    if (triageOf(item).level !== 'red') continue;
    out.push({ item, names: v.ids.map(labelOf), level: 'red' });
  }
  return out;
}

function synthYellow(limit) {
  const variants = [];
  groups.green.forEach(g => {
    [2, 9, 25, 45, 66, 78].forEach(age => {
      variants.push({ ids: ensureMin(g.item.input.symptoms), age, answers: { duration: 3, fever: 1, activity: 1 } });
    });
  });
  const out = [];
  for (const v of shuffled(variants)) {
    if (out.length >= limit) break;
    const item = { input: { symptoms: v.ids, answers: v.answers, age: v.age } };
    if (triageOf(item).level !== 'yellow') continue;
    out.push({ item, names: v.ids.map(labelOf), level: 'yellow' });
  }
  return out;
}

const redAll = groups.red.concat(synthRed(70));
const yellowAll = groups.yellow.concat(synthYellow(80));
const greenAll = groups.green.slice();

/* 年龄档 × 等级矩阵（行和=年龄配额，列和=25/40/35） */
const BANDS = [
  { name: '0-5', min: 0, max: 5, red: 2, yellow: 4, green: 2 },
  { name: '6-17', min: 6, max: 17, red: 3, yellow: 6, green: 3 },
  { name: '18-39', min: 18, max: 39, red: 7, yellow: 12, green: 11 },
  { name: '40-59', min: 40, max: 59, red: 6, yellow: 10, green: 9 },
  { name: '60+', min: 60, max: 90, red: 7, yellow: 8, green: 10 }
];

const keyUsed = new Set();
const templateUse = new Map();

function randAge(band) {
  return band.min + Math.floor(rnd() * (band.max - band.min + 1));
}

function fillBand(band, level, need) {
  const src = level === 'red' ? redAll : (level === 'yellow' ? yellowAll : greenAll);
  const out = [];
  let idx = 0;
  while (out.length < need && idx < src.length * 40) {
    const tpl = src[idx % src.length];
    idx += 1;
    const used = templateUse.get(tpl) || 0;
    if (used >= 4) continue;
    const age = randAge(band);
    const item = {
      input: {
        symptoms: tpl.item.input.symptoms.slice(),
        answers: Object.assign({}, tpl.item.input.answers),
        age: age
      }
    };
    if (triageOf(item).level !== level) continue;
    const key = item.input.symptoms.slice().sort().join(',') + '|' + JSON.stringify(item.input.answers) + '|' + age;
    if (keyUsed.has(key)) continue;
    keyUsed.add(key);
    templateUse.set(tpl, used + 1);
    out.push({ item, names: item.input.symptoms.map(labelOf), level });
  }
  return out;
}

const collected = [];
BANDS.forEach(band => {
  ['red', 'yellow', 'green'].forEach(level => {
    const need = band[level];
    if (!need) return;
    const got = fillBand(band, level, need);
    if (got.length < need) {
      console.error('警告：年龄档 ' + band.name + ' 的 ' + level + ' 只填到 ' + got.length + '/' + need);
    }
    collected.push.apply(collected, got);
  });
});

const finalList = shuffled(collected).slice(0, 100);

const cases = [];
const key = {};
finalList.forEach((c, i) => {
  const caseId = 'R' + String(i + 1).padStart(3, '0');
  const ans = c.item.input.answers || {};
  cases.push({
    caseId: caseId,
    age: c.item.input.age,
    symptoms: c.names.slice(0, 5),
    duration: answerLabel('duration', ans.duration) || '未填写',
    temperature: answerLabel('fever', ans.fever) || '未填写',
    activity: activityText(c.item.input.age, ans.activity)
  });
  key[caseId] = { systemLevel: c.level, symptomIds: c.item.input.symptoms, synthetic: !!c.synthetic };
});

/* 统计 */
const dist = { red: 0, yellow: 0, green: 0 };
const ageDist = { '0-5': 0, '6-17': 0, '18-39': 0, '40-59': 0, '60+': 0 };
const ageCount = {};
finalList.forEach(c => {
  dist[c.level] += 1;
  const age = c.item.input.age;
  ageCount[age] = (ageCount[age] || 0) + 1;
  if (age <= 5) ageDist['0-5'] += 1;
  else if (age <= 17) ageDist['6-17'] += 1;
  else if (age <= 39) ageDist['18-39'] += 1;
  else if (age <= 59) ageDist['40-59'] += 1;
  else ageDist['60+'] += 1;
});
const maxSameAge = Math.max.apply(null, Object.values(ageCount));

/* review-cases.json */
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data', 'review-cases.json'), JSON.stringify({
  generatedAt: new Date().toISOString().slice(0, 10),
  total: cases.length,
  cases: cases
}, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(ROOT, 'data', 'review-key.json'), JSON.stringify({
  generatedAt: new Date().toISOString().slice(0, 10), key: key
}, null, 2) + '\n', 'utf8');

/* CSV 模板 */
fs.writeFileSync(path.join(ROOT, 'data', 'review-csv-template.csv'), 'caseId,doctor,level\n', 'utf8');

/* 盲评表 */
const lines = [
  '# 明辨康途 · 分诊一致性盲评表',
  '',
  '> **请独立判断，不要参考任何系统结果**（本表不含系统分诊结论）。',
  '> 判定口径：**红 = 建议急诊**；**黄 = 24–48 小时内就诊**；**绿 = 可先观察**。',
  '> 病例已脱敏，不含姓名与联系方式；仅用于本项目评估。每 10 例一组，可分次完成。',
  '> 不确定时按你的临床习惯选择，可在「备注」写理由。',
  '',
  '填表说明：在「你的判断（红/黄/绿）」列填写 红 / 黄 / 绿。',
  ''
];
for (let g = 0; g < 10; g++) {
  const chunk = cases.slice(g * 10, g * 10 + 10);
  if (!chunk.length) break;
  lines.push('## 第 ' + (g + 1) + ' 组（' + chunk[0].caseId + '–' + chunk[chunk.length - 1].caseId + '）');
  lines.push('');
  lines.push('| 病例号 | 年龄 | 症状 | 病程 | 体温 | 活动能力 | 你的判断（红/黄/绿） | 备注 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  chunk.forEach(c => {
    lines.push('| ' + c.caseId + ' | ' + c.age + ' | ' + c.symptoms.join('、') + ' | ' +
      c.duration + ' | ' + c.temperature + ' | ' + c.activity + ' |  |  |');
  });
  lines.push('');
}
lines.push('## 总体意见');
lines.push('');
lines.push('（可选）你认为哪些病例最难判断？判定口径是否清晰？');
lines.push('');
lines.push('---');
lines.push('');
lines.push('回收方式：填写完成后将 CSV（列：caseId,doctor,level）或本表扫描件交回项目组。');
lines.push('');
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', '盲评表.md'), lines.join('\n'), 'utf8');

console.log('病例池（去重后）' + pool.length + ' 条；最终 ' + cases.length + ' 例');
console.log('等级分布：红 ' + dist.red + ' / 黄 ' + dist.yellow + ' / 绿 ' + dist.green);
console.log('年龄分布：0-5 ' + ageDist['0-5'] + ' / 6-17 ' + ageDist['6-17'] + ' / 18-39 ' + ageDist['18-39'] +
  ' / 40-59 ' + ageDist['40-59'] + ' / 60+ ' + ageDist['60+'] + '；最大单一岁数 ' + maxSameAge + ' 例');
console.log('已生成 data/review-cases.json、data/review-key.json、docs/盲评表.md、data/review-csv-template.csv');