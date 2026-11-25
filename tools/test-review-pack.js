/*
 * 盲评工具包自测：node tools/test-review-pack.js
 *
 * 校验 review-cases.json / 盲评表 / 分布，并用假 CSV 跑 kappa.js。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const errors = [];
const ok = (name, cond, detail) => { if (!cond) errors.push(name + (detail ? '：' + detail : '')); };

/* 1. review-cases.json 结构 */
const casesPath = path.join(ROOT, 'data', 'review-cases.json');
ok('存在 data/review-cases.json', fs.existsSync(casesPath));
const pack = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
const cases = pack.cases || [];
ok('病例恰好 100 条', cases.length === 100, '实际 ' + cases.length);

const ids = cases.map(c => c.caseId);
ok('caseId 唯一', new Set(ids).size === ids.length);
ok('caseId 连续 R001–R100', ids.every((id, i) => id === 'R' + String(i + 1).padStart(3, '0')));

cases.forEach(c => {
  if (!Array.isArray(c.symptoms) || c.symptoms.length < 3 || c.symptoms.length > 5) {
    errors.push(c.caseId + ' 症状数量不在 3–5：' + (c.symptoms && c.symptoms.length));
  }
  if (!(typeof c.age === 'number' && c.age >= 0 && c.age <= 100)) errors.push(c.caseId + ' 年龄越界：' + c.age);
  ['duration', 'temperature', 'activity'].forEach(k => {
    if (!c[k] || !String(c[k]).trim()) errors.push(c.caseId + ' 缺少字段 ' + k);
  });
});

/* 年龄多样性：最大单一岁数占比 ≤35%；儿童不得出现「工作」 */
const ageFreq = {};
cases.forEach(c => { ageFreq[c.age] = (ageFreq[c.age] || 0) + 1; });
const maxSameAge = Math.max.apply(null, Object.values(ageFreq));
ok('最大单一岁数占比 ≤35%', maxSameAge <= 35, maxSameAge + '/100');
cases.filter(c => c.age < 12).forEach(c => {
  ok(c.caseId + ' 儿童活动能力不应含「工作」', String(c.activity).indexOf('工作') === -1, c.activity);
});

/* 2. 盲评表数据行 = 100 且不含系统结论 */
const sheetPath = path.join(ROOT, 'docs', '盲评表.md');
ok('存在 docs/盲评表.md', fs.existsSync(sheetPath));
const sheet = fs.readFileSync(sheetPath, 'utf8');
const dataRows = sheet.split('\n').filter(l => /^\| R\d{3} \|/.test(l));
ok('盲评表数据行 = 100', dataRows.length === 100, '实际 ' + dataRows.length);
['低风险', '高风险', '吻合度', '命中危险信号'].forEach(word => {
  ok('盲评表不应出现系统结论「' + word + '」', sheet.indexOf(word) === -1);
});

/* 3. 分布误差 ±5 */
const keyPath = path.join(ROOT, 'data', 'review-key.json');
ok('存在 data/review-key.json（答案键）', fs.existsSync(keyPath));
const key = JSON.parse(fs.readFileSync(keyPath, 'utf8')).key || {};
const dist = { red: 0, yellow: 0, green: 0 };
Object.keys(key).forEach(id => { dist[key[id].systemLevel] += 1; });
const target = { red: 25, yellow: 40, green: 35 };
Object.keys(target).forEach(level => {
  if (Math.abs(dist[level] - target[level]) > 5) {
    errors.push('分布 ' + level + ' 偏离目标超过 ±5：' + dist[level] + ' vs ' + target[level]);
  }
});

/* 4. 假 CSV 跑 kappa.js */
function writeCsv(name, rows) {
  const p = path.join(ROOT, 'data', name);
  fs.writeFileSync(p, 'caseId,doctor,level\n' + rows.map(r => r.join(',')).join('\n') + '\n', 'utf8');
  return 'data/' + name;
}

const allIds = Object.keys(key).sort();
const cn = { red: '红', yellow: '黄', green: '绿' };

/* 4a. 完全一致 → κ = 1 */
const perfect = writeCsv('_test-perfect.csv', allIds.map(id => [id, 'DrA', cn[key[id].systemLevel]]));
let run = spawnSync(process.execPath, [path.join(__dirname, 'kappa.js'), '--csv=' + perfect, '--out=data/_test-result.md'], { cwd: ROOT, encoding: 'utf8' });
ok('完全一致时 kappa 退出码 0', run.status === 0, run.stderr || '');
ok('完全一致时 κ=1.000', /κ=1\.000/.test(run.stdout || ''), run.stdout || '');

/* 4b. 与系统独立（已知边缘）→ κ ≈ 0 */
const order = ['red', 'yellow', 'green'];
const random = writeCsv('_test-random.csv', allIds.map((id, i) => {
  /* 固定规则：按系统等级错位且打散，使一致数≈Pe */
  const shift = (order.indexOf(key[id].systemLevel) + 1 + (i % 3)) % 3;
  return [id, 'DrB', cn[order[shift]]];
}));
run = spawnSync(process.execPath, [path.join(__dirname, 'kappa.js'), '--csv=' + random, '--out=data/_test-result.md'], { cwd: ROOT, encoding: 'utf8' });
const km = (run.stdout || '').match(/κ=(-?\d+\.\d+)/);
ok('随机/独立场景 kappa 可算出', !!km, run.stdout || run.stderr);
if (km) ok('随机/独立场景 |κ| < 0.2', Math.abs(Number(km[1])) < 0.2, 'κ=' + km[1]);

/* 4c. 缺字段 → 退出码非 0 */
const bad = writeCsv('_test-bad.csv', [[allIds[0], 'DrC']]);
run = spawnSync(process.execPath, [path.join(__dirname, 'kappa.js'), '--csv=' + bad, '--out=data/_test-result.md'], { cwd: ROOT, encoding: 'utf8' });
ok('缺字段时 kappa 退出码非 0', run.status !== 0, 'status=' + run.status);

/* 清理临时 CSV */
['_test-perfect.csv', '_test-random.csv', '_test-bad.csv', '_test-result.md'].forEach(f => {
  try { fs.unlinkSync(path.join(ROOT, 'data', f)); } catch (e) {}
});

if (errors.length) {
  console.error('盲评工具包校验失败：\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('盲评工具包通过：100 例 / 分布 红' + dist.red + ' 黄' + dist.yellow + ' 绿' + dist.green +
  ' / 盲评表 100 行无结论 / κ 场景（一致=1、独立≈0、缺字段报错）');