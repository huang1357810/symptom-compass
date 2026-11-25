/*
 * 盲评一致性计算：node tools/kappa.js --csv=data/某医生填好的.csv
 *
 * 输入 CSV 列：caseId,doctor,level（level 为 红/黄/绿，也接受 red/yellow/green）
 * 依赖 data/review-key.json（仅研究者持有的答案键，含每个 caseId 的系统等级）
 * 输出 docs/盲评结果.md
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const hit = args.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : def;
};

const CSV = getArg('csv', '');
const OUT = getArg('out', 'docs/盲评结果.md');
if (!CSV) {
  console.error('用法：node tools/kappa.js --csv=data/review-filled.csv');
  process.exit(1);
}

const LEVELS = ['red', 'yellow', 'green'];
const CN = { red: '红', yellow: '黄', green: '绿' };
function normLevel(v) {
  const s = String(v || '').trim();
  if (s === '红' || s === 'red') return 'red';
  if (s === '黄' || s === 'yellow') return 'yellow';
  if (s === '绿' || s === 'green') return 'green';
  return '';
}

const keyPath = path.join(ROOT, 'data', 'review-key.json');
if (!fs.existsSync(keyPath)) {
  console.error('缺少 data/review-key.json（先运行 node tools/gen-review-cases.js）');
  process.exit(1);
}
const keyData = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
const sysLevel = {};
Object.keys(keyData.key || {}).forEach(id => { sysLevel[id] = keyData.key[id].systemLevel; });

const raw = fs.readFileSync(path.resolve(ROOT, CSV), 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/);
const rows = [];
let headerSkipped = false;
lines.forEach((line, idx) => {
  const lineNo = idx + 1;
  if (!line.trim()) return;
  if (!headerSkipped) { headerSkipped = true; return; }   /* 跳过表头 */
  const cols = line.split(',');
  const caseId = (cols[0] || '').trim();
  const doctor = (cols[1] || '').trim();
  const level = normLevel(cols[2]);
  if (!caseId) { console.error('第 ' + lineNo + ' 行缺少 caseId'); process.exit(1); }
  if (!doctor) { console.error('第 ' + lineNo + ' 行缺少 doctor'); process.exit(1); }
  if (!level) { console.error('第 ' + lineNo + ' 行 level 非法：' + (cols[2] || '')); process.exit(1); }
  if (!sysLevel[caseId]) { console.error('第 ' + lineNo + ' 行 caseId 不在答案键中：' + caseId); process.exit(1); }
  rows.push({ caseId, doctor, level });
});

if (!rows.length) { console.error('CSV 中没有有效数据行'); process.exit(1); }

function cohenKappa(pairs) {
  const n = pairs.length;
  if (!n) return { n: 0, po: 0, pe: 0, kappa: 0 };
  const po = pairs.filter(p => p[0] === p[1]).length / n;
  let pe = 0;
  LEVELS.forEach(c => {
    const a = pairs.filter(p => p[0] === c).length / n;
    const b = pairs.filter(p => p[1] === c).length / n;
    pe += a * b;
  });
  const kappa = pe === 1 ? 1 : (po - pe) / (1 - pe);
  return { n, po, pe, kappa };
}

const doctors = Array.from(new Set(rows.map(r => r.doctor))).sort();
const byDoctor = {};
doctors.forEach(d => { byDoctor[d] = rows.filter(r => r.doctor === d); });

const pct = v => (v * 100).toFixed(1) + '%';
const fmt = v => v.toFixed(3);

const md = [
  '# 盲评一致性结果',
  '',
  '> 由 `tools/kappa.js` 生成。系统等级来自 `data/review-key.json`（答案键，不随盲评表发放）。',
  '> 说明：红例中含部分「危险信号合成」病例，医生通常也会判红，κ 可能偏高，解读请谨慎。',
  '',
  '- 有效记录：' + rows.length + ' 条 ｜ 医生：' + doctors.length + ' 位',
  ''
];

/* 医生 vs 系统 */
md.push('## 每位医生 vs 系统');
md.push('');
md.push('| 医生 | 条数 | 一致数 | 一致率 | 期望一致率 Pe | Cohen κ | 危险信号漏诊率 | 过度分诊率 |');
md.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
doctors.forEach(d => {
  const list = byDoctor[d];
  const pairs = list.map(r => [sysLevel[r.caseId], r.level]);
  const k = cohenKappa(pairs);
  const sysRed = list.filter(r => sysLevel[r.caseId] === 'red');
  const missed = sysRed.filter(r => r.level === 'yellow' || r.level === 'green').length;
  const over = sysRed.filter(r => r.level === 'green').length;
  md.push('| ' + d + ' | ' + list.length + ' | ' + Math.round(k.po * list.length) + ' | ' +
    pct(k.po) + ' | ' + fmt(k.pe) + ' | ' + fmt(k.kappa) + ' | ' +
    (sysRed.length ? pct(missed / sysRed.length) : '—') + ' | ' +
    (sysRed.length ? pct(over / sysRed.length) : '—') + ' |');
});
md.push('');

/* 医生之间两两一致率 */
md.push('## 医生之间两两一致率');
md.push('');
md.push('| 医生 A | 医生 B | 共同病例 | 一致率 |');
md.push('| --- | --- | --- | --- |');
for (let i = 0; i < doctors.length; i++) {
  for (let j = i + 1; j < doctors.length; j++) {
    const a = {};
    byDoctor[doctors[i]].forEach(r => { a[r.caseId] = r.level; });
    let common = 0, same = 0;
    byDoctor[doctors[j]].forEach(r => {
      if (a[r.caseId] !== undefined) { common += 1; if (a[r.caseId] === r.level) same += 1; }
    });
    md.push('| ' + doctors[i] + ' | ' + doctors[j] + ' | ' + common + ' | ' +
      (common ? pct(same / common) : '—') + ' |');
  }
}
md.push('');

/* 每位医生的混淆矩阵 */
md.push('## 分等级混淆矩阵（系统 × 医生）');
md.push('');
doctors.forEach(d => {
  const list = byDoctor[d];
  md.push('### ' + d);
  md.push('');
  md.push('| 系统 \\ 医生 | 红 | 黄 | 绿 |');
  md.push('| --- | --- | --- | --- |');
  LEVELS.forEach(s => {
    const row = list.filter(r => sysLevel[r.caseId] === s);
    if (!row.length) return;
    md.push('| ' + CN[s] + ' | ' + row.filter(r => r.level === 'red').length +
      ' | ' + row.filter(r => r.level === 'yellow').length +
      ' | ' + row.filter(r => r.level === 'green').length + ' |');
  });
  md.push('');
});

fs.mkdirSync(path.dirname(path.resolve(ROOT, OUT)), { recursive: true });
fs.writeFileSync(path.resolve(ROOT, OUT), md.join('\n'), 'utf8');

doctors.forEach(d => {
  const list = byDoctor[d];
  const k = cohenKappa(list.map(r => [sysLevel[r.caseId], r.level]));
  console.log(d + '：n=' + list.length + ' 一致率=' + pct(k.po) + ' κ=' + fmt(k.kappa));
});
console.log('已写入 ' + OUT);