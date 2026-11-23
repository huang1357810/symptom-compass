/*
 * 方向评测：node tools/eval-direction.js
 *
 * 指标：Hit@1 / Hit@3 / MRR，分 train / holdout 两组。
 * 数据集：data/direction-eval.json（gold 由 core 症状 + 人工判定，不由算法反填）。
 * 输出：docs/eval-direction.md（指标表 + 错例 + 改动前后对比）。
 *
 * 可选参数：--check   与基线比较并断言不倒退（非 0 退出即失败）
 *           --tag=名称 写入对比表时使用的阶段名
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'direction-eval.json');
const DOC = path.join(ROOT, 'docs', 'eval-direction.md');
const HTML = path.join(ROOT, 'site', 'index.html');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const tagArg = args.find(a => a.startsWith('--tag='));
const TAG = tagArg ? tagArg.slice('--tag='.length) : '';

/* 阶段 0 基线（首次运行后固定，用于 --check 与对比表） */
const BASELINE = {
  trainHit1: 0.9571, trainHit3: 0.9857, trainMrr: 0.9714,
  holdoutHit1: 0.8333, holdoutHit3: 0.9667, holdoutMrr: 0.9000
};

/* 历史阶段（人工维护：每阶段实测后追加，回退的保留并注明原因）
   数据基于 2026-11-23 的 100 条评测集；gold 已按 docs/eval-gold-audit.md 修正 10 条 */
const HISTORY = [
  { tag: '阶段 0 · 基线（gold 审计后）', algo: 'hit / total', trainHit1: 0.9571, holdoutHit1: 0.8333,
    trainHit3: 0.9857, holdoutHit3: 0.9667, trainMrr: 0.9714, holdoutMrr: 0.9000, note: '修正 10 条 gold 后重算' },
  { tag: '阶段 1 · IDF+平滑', algo: 'hit/(hit+0.4(total-hit)+0.2)', trainHit1: 0.9571, holdoutHit1: 0.8667,
    trainHit3: 0.9857, holdoutHit3: 0.9667, trainMrr: 0.9714, holdoutMrr: 0.9167, note: '未胜出：holdout Hit@3 未提升（96.7%），不启用' },
  { tag: '阶段 1 · IDF+幂次', algo: 'hit/total^0.7', trainHit1: 0.9571, holdoutHit1: 0.8667,
    trainHit3: 1, holdoutHit3: 1, trainMrr: 0.9762, holdoutMrr: 0.9278, note: '已启用：holdout Hit@3 96.7%→100%；7 条非红旗 Top1 不变，胸痛+气短仍判红' },
  { tag: '阶段 2 · 阴性按权重罚', algo: 'hit/total + negPenalty', trainHit1: 0.9571, holdoutHit1: 0.8667,
    trainHit3: 1, holdoutHit3: 1, trainMrr: 0.9762, holdoutMrr: 0.9278, note: '已开启：10 组混淆对 10/10；评测集无否定，指标同阶段 1' },
  { tag: '阶段 3 · core 加成（v2 下）', algo: 'score×min(1.2,1+0.08·core) / hit≥0.8', trainHit1: 0.9571, holdoutHit1: 0.8667,
    trainHit3: 1, holdoutHit3: 1, trainMrr: 0.9762, holdoutMrr: 0.9333, note: '已开启：holdout MRR +0.0055' },
  { tag: '阶段 4 · 乘子加强 ×1.15/×0.85/×1.10', algo: 'typicalDays ±15% + 年龄 ×1.10', trainHit1: 0.9571, holdoutHit1: 0.8000,
    trainHit3: 1, holdoutHit3: 0.9667, trainMrr: 0.9786, holdoutMrr: 0.8833, note: '回退：30 条仅变化 5/30（16.7%，要求 ≥50%），Hit@1/Hit@3 回落；gold 审计后仅 6 组可区分' },
  { tag: '阶段 5 · 阈值网格（审计前）', algo: 'minScore 0.12–0.30', trainHit1: 0.9571, holdoutHit1: 0.8667,
    trainHit3: 1, holdoutHit3: 1, trainMrr: 0.9762, holdoutMrr: 0.9333, note: '暂保持 0.18；未在审计后数据上重跑网格' },
  { tag: '阶段 6 · 分母回退 + 证据降权', algo: 'IDF+smooth / evidence ×0.55', trainHit1: 0.9571, holdoutHit1: 0.8667,
    trainHit3: 0.9857, holdoutHit3: 0.9667, trainMrr: 0.9714, holdoutMrr: 0.9167, note: '已启用：优先 Top3 合理性；holdout Hit@3 100%→96.7%（≥70% 达标），手足口病/中暑被挤出 Top3' }
];

const html = fs.readFileSync(HTML, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  console.error('未找到 script 块');
  process.exit(1);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  m[1] + '\n;globalThis.__out={scoreConditions,CONDITIONS,SYMPTOMS,parseSymptoms};',
  sandbox,
  { timeout: 10000 }
);
const { scoreConditions, CONDITIONS, SYMPTOMS, parseSymptoms } = sandbox.__out;

/* 源文件默认开关快照，用于生成「临床合理性」对比后恢复 */
const SRC_RANK = JSON.parse(vm.runInContext('JSON.stringify(RANK_FLAGS);', sandbox));

/* 通过命令行临时打开排序开关（不改变源文件默认值） */
if (args.includes('--baseline')) {
  vm.runInContext('RANK_FLAGS.v2=false; RANK_FLAGS.negPenalty=false; RANK_FLAGS.coreBonus=false; RANK_FLAGS.ageDuration=false;', sandbox);
}
if (args.includes('--no-neg')) vm.runInContext('RANK_FLAGS.negPenalty = false;', sandbox);
if (args.includes('--no-core')) vm.runInContext('RANK_FLAGS.coreBonus = false;', sandbox);
if (args.includes('--v2')) vm.runInContext('RANK_FLAGS.v2 = true;', sandbox);
if (args.includes('--neg')) vm.runInContext('RANK_FLAGS.negPenalty = true;', sandbox);
if (args.includes('--core')) vm.runInContext('RANK_FLAGS.coreBonus = true;', sandbox);
if (args.includes('--age')) vm.runInContext('RANK_FLAGS.ageDuration = true;', sandbox);
const denomArg = args.find(a => a.startsWith('--denom='));
if (denomArg) {
  const v = denomArg.slice('--denom='.length);
  if (v === 'pow' || v === 'smooth') vm.runInContext("RANK_FLAGS.denom = '" + v + "';", sandbox);
}

const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));

function rankOf(gold, results){
  const idx = results.findIndex(r => r.id === gold);
  return idx === -1 ? Infinity : idx + 1;
}

function metrics(list){
  const n = list.length;
  let h1 = 0, h3 = 0, mrr = 0;
  list.forEach(item => {
    const ans = item.input.answers || {};
    const days = ans.duration === undefined ? undefined : [0, 1, 4, 8][ans.duration];
    const ctx = { age: item.input.age, durationDays: days };
    const results = scoreConditions(item.input.symptoms, new Set(), ctx);
    const rank = rankOf(item.gold, results);
    item._rank = rank;
    item._top = results[0] ? results[0].name : '（无匹配）';
    item._top3 = results.slice(0, 3).map(r => r.name).join(' / ') || '（无匹配）';
    if (rank === 1) h1 += 1;
    if (rank <= 3) h3 += 1;
    if (rank !== Infinity) mrr += 1 / rank;
  });
  return {
    n,
    hit1: n ? Number((h1 / n).toFixed(4)) : 0,
    hit3: n ? Number((h3 / n).toFixed(4)) : 0,
    mrr: n ? Number((mrr / n).toFixed(4)) : 0
  };
}

const train = data.filter(d => d.split === 'train');
const holdout = data.filter(d => d.split === 'holdout');
const mt = metrics(train);
const mh = metrics(holdout);
const ma = metrics(data);

/* 8 个典型输入（与 test-regression 一致），用于回归对比 */
const TYPICAL = ['咽痛+发热', '腹泻+恶心', '胸痛+气短', '头痛+恶心', '咳嗽+黄痰', '高热+咽痛', '皮疹+发热', '腹痛+呕吐'];
const typical = TYPICAL.map(text => {
  const ids = new Set();
  text.split('+').forEach(seg => parseSymptoms(seg).ids.forEach(id => ids.add(id)));
  const results = scoreConditions(ids, new Set());
  return { text, ids: [...ids], top1: results[0] ? results[0].name : '（无匹配）' };
});

const pct = v => (v * 100).toFixed(1) + '%';
const fmt = v => v === null ? '—' : v.toFixed(4);

/* 临床合理性：同一输入在「改动前（幂次、无证据降权）」与「当前默认」下的 Top3 */
const TOP3_CASES = ['咽痛+发热', '干咳+咳痰', '腹泻+恶心', '皮疹+发热', '头痛+恶心', '腹痛+呕吐'];
function top3Of(text) {
  const ids = new Set();
  text.split('+').forEach(seg => parseSymptoms(seg).ids.forEach(id => ids.add(id)));
  const r = scoreConditions(ids);
  return r.slice(0, 3).map(x => x.name).join(' / ') || '（无匹配）';
}
const top3After = TOP3_CASES.map(top3Of);
vm.runInContext("RANK_FLAGS.denom='pow'; RANK_FLAGS.evidence=false;", sandbox);
const top3Before = TOP3_CASES.map(top3Of);
Object.keys(SRC_RANK).forEach(k => {
  vm.runInContext('RANK_FLAGS.' + k + '=' + JSON.stringify(SRC_RANK[k]) + ';', sandbox);
});

const misses = data.filter(d => d._rank !== 1).map(d =>
  '| ' + d.id + ' | ' + d.split + ' | ' + d.input.symptoms.join(' + ') + ' | ' +
  (SYMPTOMS[d.gold] ? SYMPTOMS[d.gold].label : d.gold) + ' | ' + d._top + ' | ' +
  (d._rank === Infinity ? '未进 Top8' : '第 ' + d._rank + ' 位') + ' |'
);

const history = HISTORY.slice();
if (TAG){
  const row = {
    tag: TAG,
    algo: '当前代码',
    trainHit1: mt.hit1, holdoutHit1: mh.hit1,
    trainHit3: mt.hit3, holdoutHit3: mh.hit3,
    trainMrr: mt.mrr, holdoutMrr: mh.mrr,
    note: '本次运行'
  };
  const idx = history.findIndex(h => h.tag === TAG);
  if (idx === -1) history.push(row);
  else history[idx] = row;
}

const historyRows = history.map(row =>
  '| ' + row.tag + ' | ' + row.algo + ' | ' + fmt(row.trainHit1) + ' | ' + fmt(row.holdoutHit1) + ' | ' +
  fmt(row.trainHit3) + ' | ' + fmt(row.holdoutHit3) + ' | ' + fmt(row.trainMrr) + ' | ' +
  fmt(row.holdoutMrr) + ' | ' + row.note + ' |'
);

const md = [
  '# 方向评测（Hit@1 / Hit@3 / MRR）',
  '',
  '> 由 `tools/eval-direction.js` 自动生成。数据集 `data/direction-eval.json`：' +
    data.length + ' 条（train ' + train.length + ' / holdout ' + holdout.length + '）。',
  '> gold 由 `CONDITIONS` 的 core 症状 + 人工判定确定，未使用 `scoreConditions` 输出反填。',
  '',
  '## 当前指标',
  '',
  '| 分组 | 条数 | Hit@1 | Hit@3 | MRR |',
  '| --- | --- | --- | --- | --- |',
  '| train | ' + mt.n + ' | ' + pct(mt.hit1) + ' | ' + pct(mt.hit3) + ' | ' + fmt(mt.mrr) + ' |',
  '| holdout | ' + mh.n + ' | ' + pct(mh.hit1) + ' | ' + pct(mh.hit3) + ' | ' + fmt(mh.mrr) + ' |',
  '| 全部 | ' + ma.n + ' | ' + pct(ma.hit1) + ' | ' + pct(ma.hit3) + ' | ' + fmt(ma.mrr) + ' |',
  '',
  '## 改动前后对比',
  '',
  '| 阶段 | 算法 | train Hit@1 | holdout Hit@1 | train Hit@3 | holdout Hit@3 | train MRR | holdout MRR | 结论 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...historyRows,
  '',
  '## 8 个典型输入 Top1（回归对比）',
  '',
  '| 输入 | 症状 id | 当前 Top1 |',
  '| --- | --- | --- |',
  ...typical.map(t => '| ' + t.text + ' | ' + t.ids.join(', ') + ' | ' + t.top1 + ' |'),
  '',
  '## 临床合理性（Top3）',
  '',
  '> 原则：**优先保证 Top3 不出现明显不相关方向，其次追求 Hit@3**。',
  '> 「改动前」= IDF + 幂次分母（无证据降权）；「改动后」= IDF + 平滑分母 + 证据充分性降权。',
  '',
  '| 输入 | 改动前 Top3 | 改动后 Top3 |',
  '| --- | --- | --- |',
  ...TOP3_CASES.map((t, i) => '| ' + t + ' | ' + top3Before[i] + ' | ' + top3After[i] + ' |'),
  '',
  '典型变化：咽痛+发热的「手足口病」被挤出 Top3，由流感/感冒补位；头痛+恶心的「中暑」被挤出。',
  '',
  '## 错例（gold 未进 Top1，共 ' + misses.length + ' 条）',
  '',
  '| 编号 | 分组 | 输入症状 | gold | 当前 Top1 | 排名 |',
  '| --- | --- | --- | --- | --- | --- |',
  ...(misses.length ? misses : ['| — | — | — | — | — | — |']),
  ''
].join('\n');

fs.mkdirSync(path.dirname(DOC), { recursive: true });
fs.writeFileSync(DOC, md, 'utf8');

console.log('方向评测：train Hit@1 ' + pct(mt.hit1) + ' / Hit@3 ' + pct(mt.hit3) + ' / MRR ' + fmt(mt.mrr));
console.log('          holdout Hit@1 ' + pct(mh.hit1) + ' / Hit@3 ' + pct(mh.hit3) + ' / MRR ' + fmt(mh.mrr));
console.log('已写入 docs/eval-direction.md');

if (CHECK){
  const errors = [];
  if (BASELINE.holdoutHit3 !== null && mh.hit3 < BASELINE.holdoutHit3) {
    errors.push('holdout Hit@3 低于基线：' + fmt(mh.hit3) + ' < ' + fmt(BASELINE.holdoutHit3));
  }
  if (BASELINE.trainHit3 !== null && mt.hit3 < BASELINE.trainHit3) {
    errors.push('train Hit@3 低于基线：' + fmt(mt.hit3) + ' < ' + fmt(BASELINE.trainHit3));
  }
  if (errors.length) {
    console.error('方向评测未达标：\n  ' + errors.join('\n  '));
    process.exit(1);
  }
}