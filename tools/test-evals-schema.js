/*
 * 评测发布 schema 自测：node tools/test-evals-schema.js
 */
const path = require('path');
const { pathToFileURL } = require('url');

const MOD = pathToFileURL(path.join(__dirname, '..', 'worker', 'evals-schema.mjs')).href;

const ok = (body) => ({
  version: 'eval-v1',
  total: 15,
  red: 15,
  negatives: 4,
  falsePositive: 0,
  ...body
});

(async () => {
  const { validateEvals } = await import(MOD);
  const cases = [];

  cases.push({
    name: '合法评测通过',
    run() {
      const r = validateEvals(ok({}));
      return r.ok && r.value.total === 15 && r.value.red === 15;
    }
  });

  cases.push({
    name: '缺少 version 被拒',
    run() {
      const r = validateEvals(ok({ version: '' }));
      return !r.ok && r.error === 'bad_version';
    }
  });

  cases.push({
    name: 'version 超长被截断而不是拒绝',
    run() {
      const r = validateEvals(ok({ version: 'v'.repeat(80) }));
      return r.ok && r.value.version.length === 40;
    }
  });

  cases.push({
    name: '负数被拒',
    run() {
      const r = validateEvals(ok({ total: -1 }));
      return !r.ok && r.error === 'bad_numbers';
    }
  });

  cases.push({
    name: '非整数被拒',
    run() {
      const r = validateEvals(ok({ red: 1.5 }));
      return !r.ok && r.error === 'bad_numbers';
    }
  });

  cases.push({
    name: 'red > total 被拒',
    run() {
      const r = validateEvals(ok({ red: 20, total: 15 }));
      return !r.ok && r.error === 'red_gt_total';
    }
  });

  cases.push({
    name: 'falsePositive > negatives 被拒',
    run() {
      const r = validateEvals(ok({ falsePositive: 5, negatives: 4 }));
      return !r.ok && r.error === 'fp_gt_negatives';
    }
  });

  cases.push({
    name: '空对象被拒',
    run() {
      const r = validateEvals(null);
      return !r.ok && r.error === 'bad_evals';
    }
  });

  let passed = 0;
  const failures = [];
  cases.forEach(c => {
    let good = false;
    try {
      good = !!c.run();
    } catch (e) {
      failures.push(c.name + ' → 抛错：' + e.message);
      return;
    }
    if (good) passed++;
    else failures.push(c.name);
  });

  if (failures.length) console.error('失败用例：\n  ' + failures.join('\n  '));
  console.log('用例 ' + passed + '/' + cases.length + ' 通过');
  process.exit(failures.length ? 1 : 0);
})();