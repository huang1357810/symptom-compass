/*
 * 症状时间轴自测：node tools/test-timeline.js
 * 校验严重度估算、按天记录（自动/手动覆盖）与曲线解读文案
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', 'site', 'index.html');
const html = fs.readFileSync(HTML, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  console.error('未找到 script 块');
  process.exit(1);
}

const store = {};
const sandbox = {
  window: {
    localStorage: {
      getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    }
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  m[1] + '\n;globalThis.__out = { TIMELINE_KEY, TIMELINE_DAYS, dayKey, timelinePoints, estimateSeverity, recordTimeline, setManualSeverity, analyzeTimeline };',
  sandbox,
  { timeout: 5000 }
);
const T = sandbox.__out;

const NOW = new Date('2026-11-13T10:00:00').getTime();
const DAY = 86400000;

function tlWith(list) {
  const days = {};
  list.forEach(x => {
    const t = NOW - x.daysAgo * DAY;
    days[T.dayKey(t)] = { score: x.score, source: x.source || 'auto', level: '', sym: [] };
  });
  return { days };
}

const cases = [];

/* 1. 严重度估算 */
cases.push({
  name: '严重度估算随症状数与分诊等级上升',
  run() {
    const a = T.estimateSeverity([], 'green');
    const b = T.estimateSeverity(['fever'], 'green');
    const c = T.estimateSeverity(['fever', 'cough', 'fatigue'], 'yellow');
    const d = T.estimateSeverity(['a', 'b', 'c', 'd', 'e'], 'red');
    return a === 0 && b >= 1 && b <= 2 && c >= 5 && c <= 7 && d === 10;
  }
});

/* 2. 同一天自动记录取较高值 */
cases.push({
  name: '同一天重复查看取较高分',
  run() {
    Object.keys(store).forEach(k => delete store[k]);
    T.recordTimeline(['fever'], 'green', NOW);
    T.recordTimeline(['fever', 'cough', 'fatigue', 'nausea'], 'yellow', NOW);
    const saved = JSON.parse(store[T.TIMELINE_KEY]);
    return saved.days[T.dayKey(NOW)].score >= 5;
  }
});

/* 3. 手动记录优先，自动不覆盖 */
cases.push({
  name: '手动打卡不被自动记录覆盖',
  run() {
    Object.keys(store).forEach(k => delete store[k]);
    T.setManualSeverity(9, NOW);
    T.recordTimeline(['fever', 'cough'], 'green', NOW);
    const saved = JSON.parse(store[T.TIMELINE_KEY]);
    const hit = saved.days[T.dayKey(NOW)];
    return hit.score === 9 && hit.source === 'manual';
  }
});

/* 4. 手动记录可以覆盖自动 */
cases.push({
  name: '手动打卡覆盖当天自动分',
  run() {
    Object.keys(store).forEach(k => delete store[k]);
    T.recordTimeline(['fever', 'cough', 'fatigue'], 'yellow', NOW);
    T.setManualSeverity(3, NOW);
    const saved = JSON.parse(store[T.TIMELINE_KEY]);
    return saved.days[T.dayKey(NOW)].score === 3 && saved.days[T.dayKey(NOW)].source === 'manual';
  }
});

/* 5. 窗口长度与缺失天 */
cases.push({
  name: '取 14 天且缺失天为 null',
  run() {
    const tl = tlWith([{ daysAgo: 0, score: 4 }, { daysAgo: 2, score: 6 }]);
    const pts = T.timelinePoints(tl, T.TIMELINE_DAYS, NOW);
    return pts.length === 14 && pts[13].score === 4 && pts[11].score === 6 && pts[12].score === null;
  }
});

/* 6. 「第 3 天加重，第 5 天缓解」 */
cases.push({
  name: '解读出第 3 天加重、第 5 天缓解',
  run() {
    const tl = tlWith([
      { daysAgo: 4, score: 2 },
      { daysAgo: 3, score: 2 },
      { daysAgo: 2, score: 7 },
      { daysAgo: 1, score: 6 },
      { daysAgo: 0, score: 2 }
    ]);
    const r = T.analyzeTimeline(tl, T.TIMELINE_DAYS, NOW);
    return r.text.indexOf('第 3 天加重') >= 0 && r.text.indexOf('第 5 天开始缓解') >= 0;
  }
});

/* 7. 持续加重提示 */
cases.push({
  name: '持续加重给出就医提醒',
  run() {
    const tl = tlWith([
      { daysAgo: 2, score: 2 },
      { daysAgo: 1, score: 5 },
      { daysAgo: 0, score: 7 }
    ]);
    return T.analyzeTimeline(tl, T.TIMELINE_DAYS, NOW).text.indexOf('还在加重') >= 0;
  }
});

/* 8. 平稳 */
cases.push({
  name: '平稳波动给出平稳文案',
  run() {
    const tl = tlWith([
      { daysAgo: 2, score: 3 },
      { daysAgo: 1, score: 3 },
      { daysAgo: 0, score: 3 }
    ]);
    return T.analyzeTimeline(tl, T.TIMELINE_DAYS, NOW).text.indexOf('平稳') >= 0;
  }
});

/* 9. 空数据 */
cases.push({
  name: '没有记录时给出引导',
  run() {
    const r = T.analyzeTimeline({ days: {} }, T.TIMELINE_DAYS, NOW);
    return r.empty === true && r.text.indexOf('记录今天') >= 0;
  }
});

/* 10. 窗口外的旧记录不参与解读 */
cases.push({
  name: '超过 14 天的记录不参与曲线',
  run() {
    const tl = tlWith([
      { daysAgo: 20, score: 9 },
      { daysAgo: 0, score: 3 }
    ]);
    const pts = T.timelinePoints(tl, T.TIMELINE_DAYS, NOW);
    const valid = pts.filter(p => p.score !== null);
    return valid.length === 1 && valid[0].score === 3;
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