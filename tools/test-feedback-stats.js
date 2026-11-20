/*
 * 反馈统计自测：node tools/test-feedback-stats.js
 * 校验评分分布、平均分、低分病症 Top5 的聚合与排序。
 */
const path = require('path');
const { pathToFileURL } = require('url');

const MOD = pathToFileURL(path.join(__dirname, '..', 'worker', 'feedback-stats.mjs')).href;

const rec = (name, rating) => ({ rating, context: { top: { name } } });

(async () => {
  const { summarizeFeedback } = await import(MOD);
  const cases = [];

  /* 1. 空数据 */
  cases.push({
    name: '空数据返回零值',
    run() {
      const s = summarizeFeedback([]);
      return s.total === 0 && s.avg === 0 && s.lowTop.length === 0 &&
        s.dist.join(',') === '0,0,0,0,0';
    }
  });

  /* 2. 评分分布与平均分 */
  cases.push({
    name: '评分分布与平均分正确',
    run() {
      const s = summarizeFeedback([
        { rating: 5 }, { rating: 5 }, { rating: 4 }, { rating: 3 }, { rating: 1 }
      ]);
      return s.total === 5 && s.dist.join(',') === '1,0,1,1,2' &&
        Math.abs(s.avg - 3.6) < 0.001;
    }
  });

  /* 3. 低分病症按低分数排序 */
  cases.push({
    name: '低分 Top5 按低分数降序',
    run() {
      const s = summarizeFeedback([
        rec('A', 1), rec('A', 2),
        rec('B', 2),
        rec('C', 1), rec('C', 1), rec('C', 1),
        rec('D', 5)
      ]);
      return s.lowTop.length === 3 &&
        s.lowTop[0].name === 'C' && s.lowTop[0].low === 3 &&
        s.lowTop[1].name === 'A' && s.lowTop[1].low === 2 &&
        s.lowTop[2].name === 'B';
    }
  });

  /* 4. 低分相同则均分低的在前 */
  cases.push({
    name: '低分并列时均分低的在前',
    run() {
      const s = summarizeFeedback([rec('X', 1), rec('Y', 2)]);
      return s.lowTop.length === 2 && s.lowTop[0].name === 'X' && s.lowTop[1].name === 'Y';
    }
  });

  /* 5. 未记录方向归组 */
  cases.push({
    name: '未记录方向归组',
    run() {
      const s = summarizeFeedback([{ rating: 1 }]);
      return s.lowTop.length === 1 && s.lowTop[0].name === '未记录方向';
    }
  });

  /* 6. 最多返回 5 条 */
  cases.push({
    name: '低分 Top5 最多 5 条',
    run() {
      const items = [];
      for (let i = 0; i < 7; i++) items.push(rec('D' + i, 1));
      return summarizeFeedback(items).lowTop.length === 5;
    }
  });

  /* 7. 无效评分不计入统计 */
  cases.push({
    name: '无效评分不计入总数',
    run() {
      const s = summarizeFeedback([{ rating: 'x' }, { rating: 4 }]);
      return s.total === 1 && s.dist.join(',') === '0,0,0,1,0';
    }
  });

  let passed = 0;
  const failures = [];
  cases.forEach(c => {
    let ok = false;
    try {
      ok = !!c.run();
    } catch (e) {
      failures.push(c.name + ' → 抛错：' + e.message);
      return;
    }
    if (ok) passed++;
    else failures.push(c.name);
  });

  if (failures.length) {
    console.error('失败用例：\n  ' + failures.join('\n  '));
  }
  console.log('用例 ' + passed + '/' + cases.length + ' 通过');
  process.exit(failures.length ? 1 : 0);
})();