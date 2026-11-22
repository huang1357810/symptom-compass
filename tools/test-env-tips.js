/*
 * 环境提示自测：node tools/test-env-tips.js
 *
 * 用假响应验证 4 类规则（高温 / 空气质量 / 流感季 / 无命中）的命中与不命中，
 * 并静态校验「请求失败时区块保持隐藏」的降级逻辑。
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
vm.runInContext(m[1] + '\n;globalThis.__out = { envTipsFor, ENV_CITY_KEY };', sandbox, { timeout: 5000 });
const { envTipsFor } = sandbox.__out;

const ids = tips => tips.map(t => t.id);
const errors = [];

const hit = (name, input, wantId) => {
  const tips = envTipsFor(input);
  if (ids(tips).indexOf(wantId) === -1) errors.push(name + '：应命中 ' + wantId + '，实际 [' + ids(tips).join(',') + ']');
};
const miss = (name, input, wantId) => {
  const tips = envTipsFor(input);
  if (ids(tips).indexOf(wantId) !== -1) errors.push(name + '：不应命中 ' + wantId);
};

/* 1. 高温 */
hit('高温命中', { tempC: 36, pm25: 20, month: 7, selected: ['dehydration'] }, 'heat');
miss('高温不命中（温度不足）', { tempC: 28, pm25: 20, month: 7, selected: ['dehydration'] }, 'heat');
miss('高温不命中（无相关症状）', { tempC: 36, pm25: 20, month: 7, selected: ['sore_throat'] }, 'heat');

/* 2. 空气质量 */
hit('空气命中', { tempC: 20, pm25: 90, month: 7, selected: ['dry_cough'] }, 'air');
miss('空气不命中（PM2.5 达标）', { tempC: 20, pm25: 40, month: 7, selected: ['dry_cough'] }, 'air');
miss('空气不命中（无呼吸道症状）', { tempC: 20, pm25: 90, month: 7, selected: ['rash'] }, 'air');

/* 3. 流感季 */
hit('流感季命中（12 月发热）', { tempC: 10, pm25: 20, month: 12, selected: ['fever'] }, 'flu');
miss('流感季不命中（7 月发热）', { tempC: 30, pm25: 20, month: 7, selected: ['fever'] }, 'flu');
miss('流感季不命中（12 月无发热）', { tempC: 10, pm25: 20, month: 12, selected: ['headache'] }, 'flu');

/* 4. 全部不命中 */
const none = envTipsFor({ tempC: 22, pm25: 15, month: 6, selected: ['headache'] });
if (none.length) errors.push('正常天气不应产生提示，实际 ' + none.length + ' 条');

/* 5. 降级：请求失败时隐藏区块、不阻塞结果 */
const start = html.indexOf('async function loadEnvTips');
const seg = start !== -1 ? html.slice(start, start + 1800) : '';
if (!seg) errors.push('未找到 loadEnvTips 实现');
if (seg.indexOf('catch (e)') === -1 || seg.indexOf('box.hidden = true') === -1) {
  errors.push('请求失败时应静默隐藏环境提示区块');
}
const fetchStart = html.indexOf('async function fetchEnvJson');
const fetchSeg = fetchStart !== -1 ? html.slice(fetchStart, fetchStart + 600) : '';
if (!fetchSeg) errors.push('未找到环境请求封装');
if (fetchSeg.indexOf('AbortController') === -1 || fetchSeg.indexOf('clearTimeout') === -1) {
  errors.push('环境请求应带超时，避免阻塞');
}

if (errors.length) {
  console.error('环境提示校验失败：\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('环境提示用例 10/10 通过（高温 / 空气质量 / 流感季 / 无命中 + 静默降级）');