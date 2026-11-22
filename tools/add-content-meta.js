/*
 * 为 CONDITIONS 批量补充「来源 / 审核 / 更新日期」字段
 * 用法：node tools/add-content-meta.js
 *
 * 可重复执行：已有 source 的条目会跳过。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', 'site', 'index.html');
const SOURCE = '《内科学》《外科学》《皮肤性病学》等公开教材与诊疗指南综合整理';
const REVIEWER = '明辨康途内容组（待执业医师复核）';
const UPDATED = '2026-11-22';

const html = fs.readFileSync(HTML, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  console.error('未找到 script 块');
  process.exit(1);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(m[1] + '\n;globalThis.__out = { CONDITIONS };', sandbox, { timeout: 5000 });
const ids = sandbox.__out.CONDITIONS.map(c => c.id);

let out = html;
let added = 0;
let skipped = 0;

for (const id of ids) {
  const needle = "id:'" + id + "',";
  if (!out.includes(needle)) {
    console.warn('未找到条目：' + id);
    continue;
  }
  if (out.includes(needle + ' source:')) {
    skipped += 1;
    continue;
  }
  const insert = " source:'" + SOURCE + "', reviewer:'" + REVIEWER + "', updated:'" + UPDATED + "',";
  out = out.replace(needle, needle + insert);
  added += 1;
}

if (added > 0) {
  fs.writeFileSync(HTML, out, 'utf8');
}

console.log('条目 ' + ids.length + ' 条 ｜ 新增字段 ' + added + ' 条 ｜ 跳过（已有）' + skipped + ' 条');