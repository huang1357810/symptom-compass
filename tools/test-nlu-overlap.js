/*
 * NLU 重叠/归并自测：node tools/test-nlu-overlap.js
 *
 * 修复「干咳+咳痰」互相吞并：
 *   - 不同位置的匹配不得互相吞并
 *   - 同一位置多个候选取最长匹配
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
vm.runInContext(m[1] + '\n;globalThis.__out={parseSymptoms};', sandbox, { timeout: 8000 });
const { parseSymptoms } = sandbox.__out;

const ids = text => parseSymptoms(text).ids;
const errors = [];
const ok = (name, cond, detail) => { if (!cond) errors.push(name + (detail ? '：' + detail : '')); };

/* 1. 三个不同位置的症状都要保留 */
const a = ids('干咳、咳痰、胸闷');
ok('「干咳、咳痰、胸闷」返回 3 个 id', a.length === 3, JSON.stringify(a));
ok('含 dry_cough', a.indexOf('dry_cough') !== -1, JSON.stringify(a));
ok('含 sputum', a.indexOf('sputum') !== -1, JSON.stringify(a));
ok('含 chest_tight', a.indexOf('chest_tight') !== -1, JSON.stringify(a));

/* 2. 「咳嗽、干咳」应含 dry_cough */
const b = ids('咳嗽、干咳');
ok('「咳嗽、干咳」含 dry_cough', b.indexOf('dry_cough') !== -1, JSON.stringify(b));

/* 3. 空格分隔也不吞并 */
const c = ids('干咳 咳痰');
ok('「干咳 咳痰」含 dry_cough 与 sputum',
  c.indexOf('dry_cough') !== -1 && c.indexOf('sputum') !== -1, JSON.stringify(c));

/* 4. 同一位置最长匹配：整体「咳黄痰」应只归为 sputum */
const d = ids('咳黄痰');
ok('「咳黄痰」含 sputum', d.indexOf('sputum') !== -1, JSON.stringify(d));
ok('「咳黄痰」不应再拆出 dry_cough', d.indexOf('dry_cough') === -1, JSON.stringify(d));

/* 5. 否定仍然生效：说没有咳痰，sputum 不应进 ids */
const e = parseSymptoms('干咳、没有咳痰、胸闷');
ok('否定「咳痰」后 sputum 不进 ids', e.ids.indexOf('sputum') === -1, JSON.stringify(e.ids));
ok('否定项进入 negated', e.negated.indexOf('sputum') !== -1, JSON.stringify(e.negated));

/* 6. 否定：嗓子疼但明确没有发烧 */
const f = parseSymptoms('嗓子疼、没有发烧');
ok('「嗓子疼、没有发烧」含 sore_throat', f.ids.indexOf('sore_throat') !== -1, JSON.stringify(f.ids));
ok('否定「发烧」后 fever 不进 ids', f.ids.indexOf('fever') === -1, JSON.stringify(f.ids));
ok('fever 进入 negated', f.negated.indexOf('fever') !== -1, JSON.stringify(f.negated));

if (errors.length) {
  console.error('NLU 重叠校验失败：\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('NLU 重叠 10/10 通过（跨位置不吞并、同位置最长匹配、否定仍生效）');