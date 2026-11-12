/*
 * 自然语言识别自测：node tools/test-nlu.js
 * 从 Web 版页面抽出脚本，直接调用 parseSymptoms，检查常见说法能否勾对症状
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

const code = m[1] + '\n;globalThis.__out = { SYMPTOMS, SYMPTOM_ALIASES, parseSymptoms };';
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { timeout: 5000 });
const { SYMPTOMS, SYMPTOM_ALIASES, parseSymptoms } = sandbox.__out;

/* 每个症状都要有口语说法，否则自然语言输入永远识别不到它 */
const errors = [];
for (const id of Object.keys(SYMPTOM_ALIASES)) {
  if (!SYMPTOMS[id]) errors.push('别名表里有不存在的症状：' + id);
}
for (const id of Object.keys(SYMPTOMS)) {
  if (!SYMPTOM_ALIASES[id] || !SYMPTOM_ALIASES[id].length) {
    errors.push('症状缺少同义词：' + id + '（' + SYMPTOMS[id].label + '）');
  }
}

const cases = [
  { text: '昨天开始发烧 38 度，嗓子疼还流鼻涕', want: ['fever', 'sore_throat', 'runny_nose'] },
  { text: '烧到 39 度 5，浑身没劲', want: ['high_fever', 'fever', 'fatigue'] },
  { text: '肚子疼得厉害，还拉肚子', want: ['severe_abd', 'abdominal_pain', 'diarrhea'] },
  { text: '我没有发烧，只是有点咳嗽', want: ['dry_cough'], not: ['fever'] },
  { text: '不发烧也不咳嗽，就是头晕', want: ['dizziness'], not: ['fever', 'dry_cough'] },
  { text: '胸口闷，喘不上气', want: ['chest_tight', 'dyspnea'] },
  { text: '咳嗽有黄痰，晚上还发烧', want: ['sputum', 'fever'], not: ['dry_cough'] },
  { text: '最近总是睡不着，心情也不好', want: ['insomnia', 'low_mood'] },
  { text: '脖子疼、肩膀也酸', want: ['neck_pain'] },
  { text: '尿频尿急，小便还疼', want: ['urinary_freq', 'dysuria'] },
  { text: '大便发黑，还吐血', want: ['gi_bleed'] },
  { text: '起疹子，痒得厉害', want: ['rash', 'itch'] },
  { text: '中暑了，头晕还恶心', want: ['heat_exposure', 'dizziness', 'nausea'] },
  { text: '胃疼，反酸', want: ['epigastric_pain', 'heartburn'] },
  { text: '说话不清楚，一边手脚没劲', want: ['speech_diff', 'weakness_one_side'] },
  { text: '没有胃口，还老想吐', want: ['poor_appetite', 'nausea'] },
  { text: '发烧了，但是不咳嗽', want: ['fever'], not: ['dry_cough'] },
  { text: '关节又红又肿，走路都疼', want: ['joint_swelling', 'joint_pain'] },
  { text: '体检发现血压高', want: [] }
];

let passed = 0;
const failures = [];

cases.forEach((c, i) => {
  const got = parseSymptoms(c.text).ids;
  const missing = (c.want || []).filter(id => got.indexOf(id) === -1);
  const extra = (c.not || []).filter(id => got.indexOf(id) !== -1);
  if (missing.length || extra.length) {
    failures.push(
      '#' + (i + 1) + ' 「' + c.text + '」\n    期望：' + (c.want || []).join(', ') +
      (c.not ? '\n    不应出现：' + c.not.join(', ') : '') +
      '\n    实际：' + (got.join(', ') || '（空）') +
      (missing.length ? '\n    漏识别：' + missing.join(', ') : '') +
      (extra.length ? '\n    误识别：' + extra.join(', ') : '')
    );
  } else {
    passed++;
  }
});

if (errors.length) {
  console.error('词表校验失败：\n  ' + errors.join('\n  '));
}
if (failures.length) {
  console.error('用例失败：\n  ' + failures.join('\n  '));
}
console.log('用例 ' + passed + '/' + cases.length + ' 通过，词表问题 ' + errors.length + ' 个');
process.exit(errors.length || failures.length ? 1 : 0);