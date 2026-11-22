/*
 * 天气健康提示自测：node tools/test-weather-tips.js
 *
 * 覆盖：5 条规则命中/不命中 + 全不命中、最多 3 张卡、文案红线、
 * 「看相关症状」点击后对应 symptom 被选中且不自动出结果。
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

/* 最小假 DOM：脚本只在函数内操作 DOM，这里保证调用时不为空 */
function mockEl(){
  return {
    classList: { add(){}, remove(){}, toggle(){} },
    style: {},
    dataset: {},
    textContent: '',
    innerHTML: '',
    disabled: false,
    open: false,
    hidden: false,
    setAttribute(){},
    getAttribute(){ return null; },
    scrollIntoView(){},
    querySelectorAll(){ return []; },
    appendChild(){}
  };
}

const sandbox = {};
const els = {};
sandbox.document = {
  getElementById(id){ if (!els[id]) els[id] = mockEl(); return els[id]; },
  querySelector(){ return mockEl(); },
  querySelectorAll(){ return []; },
  addEventListener(){},
  createElement(){ return mockEl(); }
};
const mem = {};
sandbox.localStorage = {
  getItem(k){ return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
  setItem(k, v){ mem[k] = String(v); },
  removeItem(k){ delete mem[k]; }
};
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;
sandbox.AbortController = AbortController;
sandbox.fetch = () => Promise.reject(new Error('no network in test'));

vm.createContext(sandbox);
vm.runInContext(
  m[1] + '\n;globalThis.__out={weatherTipsFor,selectSymptomForTip,SYMPTOMS};' +
  'globalThis.__sel=selected;globalThis.__lastResults=lastResults;',
  sandbox,
  { timeout: 8000 }
);
const { weatherTipsFor, selectSymptomForTip, SYMPTOMS } = sandbox.__out;

const errors = [];
const ids = tips => tips.map(t => t.id);

const hit = (name, input, wantId) => {
  const got = ids(weatherTipsFor(input));
  if (got.indexOf(wantId) === -1) errors.push(name + '：应命中 ' + wantId + '，实际 [' + got.join(',') + ']');
};
const miss = (name, input, wantId) => {
  const got = ids(weatherTipsFor(input));
  if (got.indexOf(wantId) !== -1) errors.push(name + '：不应命中 ' + wantId);
};

/* 1. 高温 */
hit('高温命中', { tempC: 36, pm25: 20, humidity: 50, month: 6 }, 'heat');
miss('高温不命中（温度不足）', { tempC: 34, pm25: 20, humidity: 50, month: 6 }, 'heat');

/* 2. 寒冷 */
hit('寒冷命中', { tempC: 3, pm25: 20, humidity: 50, month: 6 }, 'cold');
miss('寒冷不命中（温度回升）', { tempC: 6, pm25: 20, humidity: 50, month: 6 }, 'cold');

/* 3. 空气质量 */
hit('空气命中', { tempC: 20, pm25: 100, humidity: 50, month: 6 }, 'air');
miss('空气不命中（PM2.5 达标）', { tempC: 20, pm25: 50, humidity: 50, month: 6 }, 'air');

/* 4. 流感季 */
hit('流感季命中', { tempC: 20, pm25: 20, humidity: 50, month: 12 }, 'flu');
miss('流感季不命中（非高发月）', { tempC: 20, pm25: 20, humidity: 50, month: 6 }, 'flu');

/* 5. 闷热 */
hit('闷热命中', { tempC: 30, pm25: 20, humidity: 90, month: 6 }, 'muggy');
miss('闷热不命中（湿度不足）', { tempC: 30, pm25: 20, humidity: 80, month: 6 }, 'muggy');
miss('闷热不命中（温度不足）', { tempC: 27, pm25: 20, humidity: 90, month: 6 }, 'muggy');

/* 6. 全部不命中 */
const none = weatherTipsFor({ tempC: 22, pm25: 20, humidity: 50, month: 6 });
if (none.length) errors.push('正常天气不应产生提示，实际 ' + none.length + ' 条');

/* 7. 最多 3 张 */
const many = weatherTipsFor({ tempC: 36, pm25: 100, humidity: 90, month: 12 });
if (many.length > 3) errors.push('提示卡最多 3 张，实际 ' + many.length);

/* 8. 文案红线 + 每张卡带 1–2 个合法症状按钮 */
const BANNED = ['容易得', '预测', '概率', '确诊'];
const DRUGS = ['布洛芬', '对乙酰氨基酚', '阿司匹林', '抗生素', '蒙脱石', '奥司他韦'];
const allText = JSON.stringify(weatherTipsFor({ tempC: 36, pm25: 100, humidity: 90, month: 12 }));
BANNED.forEach(w => { if (allText.indexOf(w) !== -1) errors.push('文案出现禁用词：' + w); });
DRUGS.forEach(w => { if (allText.indexOf(w) !== -1) errors.push('文案不应推荐药物：' + w); });
many.forEach(t => {
  if (!Array.isArray(t.symptoms) || t.symptoms.length < 1 || t.symptoms.length > 2) {
    errors.push(t.title + ' 应带 1–2 个相关症状按钮');
  } else {
    t.symptoms.forEach(id => { if (!SYMPTOMS[id]) errors.push(t.title + ' 的症状 id 不存在：' + id); });
  }
  if (!t.title || !t.data || !t.text) errors.push('提示卡字段不完整：' + t.title);
});

/* 9. 点击「看相关症状」→ 选中对应 symptom，且不自动出结果 */
if (!selectSymptomForTip('dry_cough')) errors.push('selectSymptomForTip 应返回 true');
if (!sandbox.__sel.has('dry_cough')) errors.push('点击后 dry_cough 应被勾选');
selectSymptomForTip('dry_cough');
if (!sandbox.__sel.has('dry_cough')) errors.push('重复点击不应取消勾选');
if (sandbox.__lastResults !== null) errors.push('点击症状不应自动生成分诊结果');
const seg = html.slice(html.indexOf('function selectSymptomForTip'), html.indexOf('function selectSymptomForTip') + 600);
if (seg.indexOf('toggle(id)') === -1) errors.push('应复用现有 toggle 逻辑');
if (seg.indexOf('showResults') !== -1) errors.push('不应自动调用 showResults');

if (errors.length) {
  console.error('天气提示校验失败：\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('天气提示用例 14/14 通过（5 条规则命中/不命中 + 上限 3 张 + 文案红线 + 点击勾选）');