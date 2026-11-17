/*
 * 皮肤拍照（非诊断）自测：node tools/test-skin.js
 * 校验像素特征统计、护理/就医建议、合规边界（不出现病名）与页面接线
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  console.error('未找到 script 块');
  process.exit(1);
}

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  m[1] + '\n;globalThis.__out = { SKIN_SYMPTOMS, analyzeSkinPixels, describeSkinFeatures, skinAdvice };',
  sandbox,
  { timeout: 5000 }
);
const { SKIN_SYMPTOMS, analyzeSkinPixels, describeSkinFeatures, skinAdvice } = sandbox.__out;

/* 生成合成像素 */
function makePixels(w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const rgb = fn(x, y);
      const i = (y * w + x) * 4;
      d[i] = rgb[0];
      d[i + 1] = rgb[1];
      d[i + 2] = rgb[2];
      d[i + 3] = 255;
    }
  }
  return d;
}

const W = 60;
const H = 40;
const redImg = makePixels(W, H, () => [220, 40, 40]);
const grayImg = makePixels(W, H, () => [150, 150, 150]);
const checker = makePixels(W, H, (x, y) => ((x + y) % 20 === 0 ? [255, 255, 255] : [0, 0, 0]));

const cases = [];

/* 1. 红色占比 */
cases.push({
  name: '红色图像识别出高红占比',
  run() {
    const f = analyzeSkinPixels(redImg, W, H);
    return f.redRatio > 0.9 && f.saturation > 0.5;
  }
});

/* 2. 灰色图像低红占比 */
cases.push({
  name: '灰色图像红占比低',
  run() {
    const f = analyzeSkinPixels(grayImg, W, H);
    return f.redRatio < 0.05 && f.saturation < 0.1;
  }
});

/* 3. 棋盘图纹理高 */
cases.push({
  name: '高对比图像纹理值高',
  run() {
    return analyzeSkinPixels(checker, W, H).texture > 0.1;
  }
});

/* 4. 描述文案 */
cases.push({
  name: '描述文案区分偏红与不明显',
  run() {
    const a = describeSkinFeatures(analyzeSkinPixels(redImg, W, H));
    const b = describeSkinFeatures(analyzeSkinPixels(grayImg, W, H));
    return a.join('').indexOf('偏红') !== -1 && b.join('').indexOf('没有看到大片明显发红') !== -1;
  }
});

/* 5. 瘙痒给出可执行步骤（含频次与用量方式，不给药物剂量） */
cases.push({
  name: '瘙痒给出可执行护理步骤',
  run() {
    const r = skinAdvice(new Set(['itch']), { redRatio: 0.2 });
    const text = r.steps.join('|');
    return text.indexOf('炉甘石') !== -1 && text.indexOf('每天 2 次') !== -1 &&
      text.indexOf('10–15 分钟') !== -1 && text.indexOf('mg') === -1;
  }
});

/* 6. 呼吸不畅 → 急诊 */
cases.push({
  name: '呼吸不畅给出急诊级别',
  run() {
    const r = skinAdvice(new Set(['rash', 'dyspnea']), { redRatio: 0.3 });
    return r.urgency === 'emergency' && r.headline.indexOf('急诊') !== -1 &&
      r.redFlags.join('|').indexOf('急诊') !== -1;
  }
});

/* 7. 高热 + 皮疹 → 立即就医 */
cases.push({
  name: '高热伴皮疹给出立即就医',
  run() {
    const r = skinAdvice(new Set(['rash', 'high_fever']), { redRatio: 0.3 });
    return r.urgency === 'emergency' && r.redFlags.join('|').indexOf('立即就医') !== -1;
  }
});

/* 8. 发热（非高热）→ 24–48 小时就诊 */
cases.push({
  name: '发热伴皮疹给出尽快就诊路径',
  run() {
    const r = skinAdvice(new Set(['rash', 'fever']), { redRatio: 0.2 });
    return r.urgency === 'soon' && r.followUp.join('|').indexOf('24–48 小时') !== -1;
  }
});

/* 9. 大面积发红 → 尽快面诊 */
cases.push({
  name: '大面积发红建议尽快面诊',
  run() {
    const r = skinAdvice(new Set(['rash']), { redRatio: 0.6 });
    return r.urgency === 'soon' && r.redFlags.join('|').indexOf('皮肤科面诊') !== -1;
  }
});

/* 10. 普通情况 → 居家 3 天 + 复查节点 + 就诊准备 */
cases.push({
  name: '普通情况给出居家与复查计划',
  run() {
    const r = skinAdvice(new Set(['itch']), { redRatio: 0.1 });
    return r.urgency === 'home' && r.followUp.join('|').indexOf('3 天') !== -1 &&
      r.prepare.length > 0 && r.avoid.length > 0 && r.steps.length > 0;
  }
});

/* 11. 未选皮肤症状时不硬给步骤 */
cases.push({
  name: '没有皮肤症状时不输出执行步骤',
  run() {
    const r = skinAdvice(new Set(['fever']), { redRatio: 0.1 });
    return r.steps.length === 0 && r.urgency === 'soon' && r.redFlags.length > 0;
  }
});

/* 12. 合规：所有输出不出现病名 */
cases.push({
  name: '输出文案不包含具体病名',
  run() {
    const banned = ['湿疹', '皮炎', '荨麻疹', '银屑病', '癣', '白癜风', '疥疮', '带状疱疹', '玫瑰糠疹', '痤疮', '肿瘤', '癌'];
    const r = skinAdvice(new Set(['rash', 'itch', 'hives', 'blister', 'dry_skin', 'hand_foot_rash', 'high_fever', 'dyspnea']), { redRatio: 0.8 });
    const samples = [
      describeSkinFeatures(analyzeSkinPixels(redImg, W, H)).join('|'),
      describeSkinFeatures(analyzeSkinPixels(grayImg, W, H)).join('|'),
      [r.headline].concat(r.steps, r.avoid, r.redFlags, r.followUp, r.prepare).join('|')
    ];
    return samples.every(t => banned.every(b => t.indexOf(b) === -1));
  }
});

/* 11. 页面接线：图片选择、本地分析、无上传 */
cases.push({
  name: '页面接线与本地分析',
  run() {
    const start = html.indexOf('function handleSkinFile');
    const end = html.indexOf('async function showResults');
    const fn = start !== -1 && end !== -1 ? html.slice(start, end) : '';
    return html.indexOf('id="skinFile"') !== -1 &&
      html.indexOf('accept="image/*"') !== -1 &&
      html.indexOf('不做诊断') !== -1 &&
      html.indexOf('不识别病名') !== -1 &&
      fn.indexOf('fetch(') === -1;
  }
});

/* 12. 结果页与打印包含皮肤摘要 */
cases.push({
  name: '结果页与打印包含皮肤摘要',
  run() {
    const printBlock = html.slice(html.indexOf('@media print'), html.indexOf('</style>'));
    return html.indexOf('id="skinSummary"') !== -1 &&
      html.indexOf('function renderSkinSummary') !== -1 &&
      printBlock.indexOf('.report-skin') !== -1;
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