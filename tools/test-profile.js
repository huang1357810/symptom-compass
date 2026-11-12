/*
 * 用户档案与关心提醒自测：node tools/test-profile.js
 * 检查「3 天内同一方向 3 次 → 就医提醒」「7 天没再查 → 康复关心」以及去重逻辑
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
const localStorage = {
  getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};

const sandbox = { window: { localStorage } };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  m[1] + '\n;globalThis.__out = { PROFILE_RULES, emptyProfile, summarizeProfile, recordVisit };',
  sandbox,
  { timeout: 5000 }
);
const { PROFILE_RULES, emptyProfile, summarizeProfile, recordVisit } = sandbox.__out;

const DAY = 86400000;
const NOW = new Date('2026-11-12T12:00:00').getTime();
const DIR = 'pharyngitis';
const NAME = '急性咽炎 / 扁桃体炎';

function entry(agoMs, dir, name, sym) {
  return {
    t: NOW - agoMs,
    sig: (sym || ['sore_throat']).join(','),
    sym: sym || ['sore_throat'],
    dir: dir || DIR,
    dirName: name || NAME,
    level: 'yellow'
  };
}

function profileWith(entries, extra) {
  return Object.assign(emptyProfile(), { entries }, extra || {});
}

const cases = [];

/* 1. 三天内三次 → 就医提醒 */
cases.push({
  name: '3 天内 3 次触发就医提醒',
  run() {
    const p = profileWith([entry(2 * DAY), entry(1 * DAY), entry(3600 * 1000)]);
    const s = summarizeProfile(p, NOW);
    return s.advise.length === 1 && s.advise[0].dir === DIR && s.advise[0].count === 3;
  }
});

/* 2. 三次但跨出三天窗口 → 不提醒 */
cases.push({
  name: '超过 3 天窗口不触发就医提醒',
  run() {
    const p = profileWith([entry(9 * DAY), entry(5 * DAY), entry(4 * DAY)]);
    const s = summarizeProfile(p, NOW);
    return s.advise.length === 0;
  }
});

/* 3. 七天没再查 → 康复关心 */
cases.push({
  name: '8 天未再查触发康复关心',
  run() {
    const s = summarizeProfile(profileWith([entry(8 * DAY)]), NOW);
    return s.care.length === 1 && s.care[0].dir === DIR && s.care[0].days === 8;
  }
});

/* 4. 六天没查 → 还不关心 */
cases.push({
  name: '6 天未再查不关心',
  run() {
    const s = summarizeProfile(profileWith([entry(6 * DAY)]), NOW);
    return s.care.length === 0;
  }
});

/* 5. 点过「知道了」后三天内不再提醒 */
cases.push({
  name: '刚提醒过的方向不重复提醒',
  run() {
    const p = profileWith(
      [entry(2 * DAY), entry(1 * DAY), entry(3600 * 1000)],
      { muted: { ['advise:' + DIR]: NOW - DAY } }
    );
    return summarizeProfile(p, NOW).advise.length === 0;
  }
});

/* 6. 永久忽略后不再提醒 */
cases.push({
  name: '「不再提醒」后永久静默',
  run() {
    const p = profileWith([entry(8 * DAY)], { ignore: { ['care:' + DIR]: true } });
    return summarizeProfile(p, NOW).care.length === 0;
  }
});

/* 7. 康复关心只针对「一段时间的最后一次」；重新查看后不再关心 */
cases.push({
  name: '重新查看会重置关心计时',
  run() {
    const p = profileWith([entry(20 * DAY), entry(1 * DAY)]);
    return summarizeProfile(p, NOW).care.length === 0;
  }
});

/* 8. 就医与康复可以同时存在（不同方向） */
cases.push({
  name: '不同方向可分别触发',
  run() {
    const p = profileWith([
      entry(2 * DAY, DIR, NAME),
      entry(1 * DAY, DIR, NAME),
      entry(3600 * 1000, DIR, NAME),
      entry(9 * DAY, 'migraine', '偏头痛', ['headache'])
    ]);
    const s = summarizeProfile(p, NOW);
    return s.advise.length === 1 && s.care.length === 1 && s.care[0].dir === 'migraine';
  }
});

/* 9. 记录去重：十分钟内同一组症状只记一次 */
cases.push({
  name: '十分钟内重复查看只记一次',
  run() {
    Object.keys(store).forEach(k => delete store[k]);
    recordVisit(['fever', 'sore_throat'], DIR, NAME, 'yellow', NOW);
    recordVisit(['sore_throat', 'fever'], DIR, NAME, 'yellow', NOW + 60 * 1000);
    const p = JSON.parse(store['mingbian.profile.v1']);
    return p.entries.length === 1;
  }
});

/* 10. 超过十分钟算新的查看 */
cases.push({
  name: '超过十分钟记为新的一次',
  run() {
    Object.keys(store).forEach(k => delete store[k]);
    recordVisit(['fever'], DIR, NAME, 'yellow', NOW);
    recordVisit(['fever'], DIR, NAME, 'yellow', NOW + 11 * 60 * 1000);
    const p = JSON.parse(store['mingbian.profile.v1']);
    return p.entries.length === 2;
  }
});

/* 11. 未匹配到方向也要记录，但不参与提醒 */
cases.push({
  name: '无方向记录不触发提醒',
  run() {
    Object.keys(store).forEach(k => delete store[k]);
    recordVisit(['fatigue'], '', '', 'green', NOW);
    const p = JSON.parse(store['mingbian.profile.v1']);
    return p.entries.length === 1 && summarizeProfile(p, NOW).advise.length === 0 && summarizeProfile(p, NOW).care.length === 0;
  }
});

/* 12. 规则常量与页面文案一致 */
cases.push({
  name: '规则为 3 天 / 3 次 / 7 天',
  run() {
    return PROFILE_RULES.days === 3 && PROFILE_RULES.times === 3 && PROFILE_RULES.careDays === 7;
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