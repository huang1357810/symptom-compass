/*
 * 自适应追问决策树自测：node tools/test-followup-tree.js
 *
 * 规则：危险信号优先（返回空）、头痛先问突发性、发热问体温、腹痛问位置、咳嗽问痰；
 * 最多 2 个；无匹配时返回空（由原三问兜底）。
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
vm.runInContext(m[1] + '\n;globalThis.__out={nextQuestions};', sandbox, { timeout: 10000 });
const { nextQuestions } = sandbox.__out;

const idsOf = list => list.map(q => q.id);
const errors = [];
const ok = (name, cond, detail) => {
  if (!cond) errors.push(name + (detail ? '：' + detail : ''));
};

/* 1. 头痛 → 突发性 */
const headache = nextQuestions(['headache'], {});
ok('头痛首问为突发性', headache.length > 0 && headache[0].id === 'headache_onset', JSON.stringify(idsOf(headache)));
ok('突发性问题有多选项', headache[0].options.length >= 2);

/* 2. 发热 → 体温问题 */
const fever = nextQuestions(['fever'], {});
ok('发热包含体温问题', idsOf(fever).indexOf('fever') !== -1, JSON.stringify(idsOf(fever)));

/* 3. 胸痛 + 呼吸困难 → 危险信号优先，不追问 */
const red = nextQuestions(['chest_pain', 'dyspnea'], {});
ok('危险信号输入不追问', red.length === 0, JSON.stringify(idsOf(red)));

/* 4. 无匹配症状 → 返回空，走原三问 */
const none = nextQuestions([], {});
ok('无匹配症状退化回原三问', none.length === 0, JSON.stringify(idsOf(none)));

/* 5. 已答过的问题不重复 */
const answered = nextQuestions(['headache'], { headache_onset: 0 });
ok('已回答的头痛问题不再出现', idsOf(answered).indexOf('headache_onset') === -1, JSON.stringify(idsOf(answered)));

/* 6. 腹痛 / 咳嗽 */
ok('腹痛问位置', idsOf(nextQuestions(['abdominal_pain'], {})).indexOf('abd_location') !== -1);
ok('咳嗽问痰', idsOf(nextQuestions(['dry_cough'], {})).indexOf('cough_phlegm') !== -1);

/* 7. 最多 2 个 */
const many = nextQuestions(['headache', 'fever', 'abdominal_pain', 'dry_cough'], {});
ok('最多返回 2 个问题', many.length <= 2, JSON.stringify(idsOf(many)));
ok('优先级：头痛优先', many[0].id === 'headache_onset', JSON.stringify(idsOf(many)));

/* 8. 结构完整 */
many.forEach(q => {
  if (!q.id || !q.title || !Array.isArray(q.options) || !q.options.length) {
    errors.push('问题结构不完整：' + JSON.stringify(q));
  }
});

if (errors.length) {
  console.error('自适应追问校验失败：\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('自适应追问 10/10 通过（头痛/发热/腹痛/咳嗽、危险信号优先、最多 2 个、无匹配退化）');