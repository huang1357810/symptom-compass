/*
 * 追问式问诊自测：node tools/test-followup.js
 * 校验追问脚本的数据完整性，以及「按症状选题」「按回答计分」的逻辑
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

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  m[1] + '\n;globalThis.__out = { SYMPTOMS, QUESTIONS, FOLLOWUPS, buildQuestionnaire, scoreAnswers };',
  sandbox,
  { timeout: 5000 }
);
const { SYMPTOMS, QUESTIONS, FOLLOWUPS, buildQuestionnaire, scoreAnswers } = sandbox.__out;

const errors = [];
const seenQuestionIds = new Set();

/* 数据完整性 */
FOLLOWUPS.forEach(g => {
  if (!g.id || !Array.isArray(g.when) || !g.when.length) errors.push('追问组缺少 id 或 when：' + (g.id || '?'));
  g.when.forEach(id => {
    if (!SYMPTOMS[id]) errors.push(g.id + ' 引用了不存在的症状 ' + id);
  });
  (g.questions || []).forEach(q => {
    if (!q.id) errors.push(g.id + ' 里有问题缺少 id');
    if (seenQuestionIds.has(q.id)) errors.push('问题 id 重复：' + q.id);
    seenQuestionIds.add(q.id);
    if (!q.title) errors.push(q.id + ' 缺少标题');
    if (!Array.isArray(q.options) || q.options.length < 2) errors.push(q.id + ' 选项少于 2 个');
    (q.options || []).forEach(o => {
      if (!o.label) errors.push(q.id + ' 有选项缺少文案');
      if (typeof o.score !== 'number') errors.push(q.id + ' 的选项 score 不是数字');
      (o.add || []).forEach(id => {
        if (!SYMPTOMS[id]) errors.push(q.id + ' 的补选症状不存在：' + id);
      });
    });
  });
});

/* 固定三问不能被追问覆盖 */
QUESTIONS.forEach(q => {
  if (seenQuestionIds.has(q.id)) errors.push('追问与固定问题 id 冲突：' + q.id);
});

const cases = [];
const idsOf = list => list.map(q => q.id);

/* 1. 腹痛触发腹部追问，且固定三问排在后面 */
cases.push({
  name: '腹痛触发腹部三问',
  run() {
    const list = buildQuestionnaire(new Set(['abdominal_pain']));
    const ids = idsOf(list);
    return ids.slice(0, 3).join(',') === 'abd_site,abd_onset,abd_type' &&
      ids.slice(3).join(',') === 'fever,activity';
  }
});

/* 2. 胸痛优先于气短（同时命中时取靠前的一组） */
cases.push({
  name: '同时命中时取最相关的一组',
  run() {
    const list = buildQuestionnaire(new Set(['chest_tight', 'dyspnea']));
    return list[0].id === 'chest_feel';
  }
});

/* 3. 呼吸困难命中呼吸组 */
cases.push({
  name: '气短触发呼吸追问',
  run() {
    return buildQuestionnaire(new Set(['dyspnea']))[0].id === 'breath_when';
  }
});

/* 4. 皮疹命中皮肤组 */
cases.push({
  name: '皮疹触发皮肤追问',
  run() {
    return buildQuestionnaire(new Set(['rash']))[0].id === 'skin_spread';
  }
});

/* 5. 发热命中发热组 */
cases.push({
  name: '发热触发体温追问',
  run() {
    return buildQuestionnaire(new Set(['high_fever']))[0].id === 'fever_high';
  }
});

/* 6. 没有匹配的症状时只保留固定三问 */
cases.push({
  name: '无匹配只保留三个固定问题',
  run() {
    return buildQuestionnaire(new Set(['fatigue'])).length === QUESTIONS.length;
  }
});

/* 7. 一次只取一组，避免问题过多 */
cases.push({
  name: '最多只追加一组追问',
  run() {
    const list = buildQuestionnaire(new Set(['abdominal_pain', 'headache', 'rash', 'back_pain']));
    const ids = idsOf(list);
    return list.length === 5 &&
      ids.filter(id => id.indexOf('abd_') === 0).length === 3 &&
      ids.indexOf('head_type') === -1 && ids.indexOf('skin_spread') === -1;
  }
});

/* 8. 单选计分与理由 */
cases.push({
  name: '回答按选项计分',
  run() {
    const list = buildQuestionnaire(new Set(['abdominal_pain']));
    const r = scoreAnswers(list, { abd_site: 2, abd_onset: 3 });
    return r.score === 2 + 2 && r.reasons.indexOf('右下腹痛，需要警惕阑尾炎') >= 0 &&
      r.reasons.indexOf('腹痛持续超过 1 周') >= 0;
  }
});

/* 9. urgent 回答会单独收集 */
cases.push({
  name: '危险回答标为 urgent',
  run() {
    const list = buildQuestionnaire(new Set(['chest_tight']));
    const r = scoreAnswers(list, { chest_trigger: 0 });
    return r.urgent.length === 1 && r.urgent[0] === '活动相关胸痛';
  }
});

/* 10. 未作答的题不影响计分 */
cases.push({
  name: '未作答不计分',
  run() {
    const r = scoreAnswers(QUESTIONS, {});
    return r.score === 0 && r.reasons.length === 0 && r.urgent.length === 0;
  }
});

/* 11. 补选症状都是合法 id */
cases.push({
  name: 'add 症状可在 SYMPTOMS 中找到',
  run() {
    let ok = true;
    FOLLOWUPS.forEach(g => g.questions.forEach(q => q.options.forEach(o => {
      (o.add || []).forEach(id => { if (!SYMPTOMS[id]) ok = false; });
    })));
    return ok;
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

if (errors.length) {
  console.error('数据校验失败：\n  ' + errors.join('\n  '));
}
if (failures.length) {
  console.error('失败用例：\n  ' + failures.join('\n  '));
}
console.log('用例 ' + passed + '/' + cases.length + ' 通过，数据问题 ' + errors.length + ' 个');
process.exit(errors.length || failures.length ? 1 : 0);