/*
 * 症状时间轴自测：node tools/test-timeline.js
 * 校验严重度估算、按天记录（自动/手动覆盖）、每个症状一条曲线与解读
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
  m[1] + '\n;globalThis.__out = { TIMELINE_KEY, TIMELINE_DAYS, dayKey, timelinePoints, timelineSeries, estimateSeverity, recordTimeline, setManualSeverity, analyzeTimeline };',
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
    const symptoms = x.symptoms || {};
    days[T.dayKey(t)] = {
      score: x.score,
      source: x.source || 'auto',
      level: '',
      sym: Object.keys(symptoms),
      symptoms
    };
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

/* 2. 同一天自动记录：整体分与每个症状都取较高值 */
cases.push({
  name: '同一天重复查看取较高分（含各症状）',
  run() {
    Object.keys(store).forEach(k => delete store[k]);
    T.recordTimeline(['fever'], 'green', NOW);
    T.recordTimeline(['fever', 'cough', 'fatigue', 'nausea'], 'yellow', NOW);
    const saved = JSON.parse(store[T.TIMELINE_KEY]);
    const day = saved.days[T.dayKey(NOW)];
    return day.score >= 5 && day.symptoms.fever >= 5 && day.symptoms.cough >= 5 && day.symptoms.nausea >= 5;
  }
});

/* 3. 自动记录会写入症状明细 */
cases.push({
  name: '自动记录写入每个症状的分值',
  run() {
    Object.keys(store).forEach(k => delete store[k]);
    T.recordTimeline(['fever', 'cough'], 'yellow', NOW);
    const day = JSON.parse(store[T.TIMELINE_KEY]).days[T.dayKey(NOW)];
    return day.symptoms && Object.keys(day.symptoms).length === 2;
  }
});

/* 4. 手动记录优先，自动不覆盖 */
cases.push({
  name: '手动打卡不被自动记录覆盖',
  run() {
    Object.keys(store).forEach(k => delete store[k]);
    T.setManualSeverity(9, ['fever'], NOW);
    T.recordTimeline(['fever', 'cough'], 'green', NOW);
    const hit = JSON.parse(store[T.TIMELINE_KEY]).days[T.dayKey(NOW)];
    return hit.score === 9 && hit.source === 'manual' && hit.symptoms.fever === 9;
  }
});

/* 5. 手动记录可以覆盖自动 */
cases.push({
  name: '手动打卡覆盖当天自动分',
  run() {
    Object.keys(store).forEach(k => delete store[k]);
    T.recordTimeline(['fever', 'cough', 'fatigue'], 'yellow', NOW);
    T.setManualSeverity(3, ['fever'], NOW);
    const hit = JSON.parse(store[T.TIMELINE_KEY]).days[T.dayKey(NOW)];
    return hit.score === 3 && hit.source === 'manual' && hit.symptoms.fever === 3 && hit.symptoms.cough === undefined;
  }
});

/* 6. 窗口长度与缺失天 */
cases.push({
  name: '取 14 天且缺失天为 null',
  run() {
    const tl = tlWith([{ daysAgo: 0, score: 4 }, { daysAgo: 2, score: 6 }]);
    const pts = T.timelinePoints(tl, T.TIMELINE_DAYS, NOW);
    return pts.length === 14 && pts[13].score === 4 && pts[11].score === 6 && pts[12].score === null;
  }
});

/* 7. 每个症状一条线，按出现天数排序 */
cases.push({
  name: '每个症状生成一条序列',
  run() {
    const tl = tlWith([
      { daysAgo: 4, score: 6, symptoms: { fever: 6, cough: 3 } },
      { daysAgo: 3, score: 7, symptoms: { fever: 7, cough: 3 } },
      { daysAgo: 2, score: 8, symptoms: { fever: 8 } },
      { daysAgo: 1, score: 5, symptoms: { fever: 5 } }
    ]);
    const series = T.timelineSeries(tl, T.TIMELINE_DAYS, NOW);
    const count = s => s.points.filter(v => v !== null).length;
    return series.length === 2 &&
      series[0].id === 'fever' && count(series[0]) === 4 &&
      series[1].id === 'cough' && count(series[1]) === 2;
  }
});

/* 8. 序列与日期对齐，没有该症状的日子是 null */
cases.push({
  name: '序列按日期对齐、缺失为 null',
  run() {
    const tl = tlWith([
      { daysAgo: 2, score: 6, symptoms: { fever: 6 } },
      { daysAgo: 0, score: 4, symptoms: { fever: 4 } }
    ]);
    const s = T.timelineSeries(tl, T.TIMELINE_DAYS, NOW)[0];
    return s.points[11] === 6 && s.points[12] === null && s.points[13] === 4;
  }
});

/* 9. 按症状解读：发热第 2 天最重，第 3 天后缓解 */
cases.push({
  name: '按症状解读加重与缓解',
  run() {
    const tl = tlWith([
      { daysAgo: 4, score: 6, symptoms: { fever: 6, cough: 3 } },
      { daysAgo: 3, score: 9, symptoms: { fever: 9, cough: 3 } },
      { daysAgo: 2, score: 8, symptoms: { fever: 8 } },
      { daysAgo: 1, score: 4, symptoms: { cough: 4 } },
      { daysAgo: 0, score: 3, symptoms: { cough: 3 } }
    ]);
    const text = T.analyzeTimeline(tl, T.TIMELINE_DAYS, NOW).text;
    return text.indexOf('发热第 2 天最重') >= 0 && text.indexOf('第 3 天后缓解') >= 0;
  }
});

/* 10. 旧数据（没有症状明细）仍能出整体解读 */
cases.push({
  name: '旧记录没有症状明细时退回整体解读',
  run() {
    const days = {};
    [[4, 2], [3, 2], [2, 7], [1, 6], [0, 2]].forEach(([ago, score]) => {
      days[T.dayKey(NOW - ago * DAY)] = { score, source: 'auto', level: '', sym: [] };
    });
    const r = T.analyzeTimeline({ days }, T.TIMELINE_DAYS, NOW);
    return r.series.length === 0 && r.text.indexOf('第 3 天加重') >= 0;
  }
});

/* 11. 空数据 */
cases.push({
  name: '没有记录时给出引导',
  run() {
    const r = T.analyzeTimeline({ days: {} }, T.TIMELINE_DAYS, NOW);
    return r.empty === true && r.text.indexOf('记录今天') >= 0;
  }
});

/* 12. 窗口外的旧记录不参与曲线 */
cases.push({
  name: '超过 14 天的记录不参与曲线',
  run() {
    const tl = tlWith([
      { daysAgo: 20, score: 9 },
      { daysAgo: 0, score: 3 }
    ]);
    const valid = T.timelinePoints(tl, T.TIMELINE_DAYS, NOW).filter(p => p.score !== null);
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