/*
 * PWA 安装引导自测：node tools/test-pwa.js
 * 校验 manifest、Service Worker 版本、安装引导接线与 iOS 降级指引。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'site', 'sw.js'), 'utf8');
const manifestRaw = fs.readFileSync(path.join(ROOT, 'site', 'manifest.webmanifest'), 'utf8')
  .replace(/^\uFEFF/, '');

const cases = [];

/* 1. manifest 合法且可安装 */
cases.push({
  name: 'manifest 可安装',
  run() {
    const m = JSON.parse(manifestRaw);
    return m.name && m.short_name && m.start_url && m.display === 'standalone' &&
      Array.isArray(m.icons) && m.icons.length >= 2 &&
      m.icons.some(i => i.purpose === 'maskable');
  }
});

/* 2. 页面已挂 manifest + 注册 SW */
cases.push({
  name: '页面挂 manifest 并注册 Service Worker',
  run() {
    return html.indexOf('rel="manifest"') !== -1 &&
      html.indexOf("navigator.serviceWorker.register('sw.js')") !== -1;
  }
});

/* 3. 安装引导接线 */
cases.push({
  name: '安装引导接线完整',
  run() {
    return html.indexOf('id="pwaBar"') !== -1 &&
      html.indexOf('id="pwaInstall"') !== -1 &&
      html.indexOf('id="pwaDismiss"') !== -1 &&
      html.indexOf('beforeinstallprompt') !== -1 &&
      html.indexOf('appinstalled') !== -1 &&
      html.indexOf('.prompt()') !== -1;
  }
});

/* 4. 已安装 / 已关闭时不重复弹 */
cases.push({
  name: '已安装或已关闭时不再提示',
  run() {
    return html.indexOf('mingbian.pwa.dismissed') !== -1 &&
      html.indexOf('display-mode: standalone') !== -1 &&
      html.indexOf("navigator.standalone === true") !== -1;
  }
});

/* 5. iOS 降级指引 */
cases.push({
  name: 'iOS 给出文字指引',
  run() {
    return html.indexOf('iPad|iPhone|iPod') !== -1 &&
      html.indexOf('添加到主屏幕') !== -1;
  }
});

/* 6. file:// 下跳过 */
cases.push({
  name: 'file 协议下跳过引导',
  run() {
    const start = html.indexOf('function initPwaInstall');
    const seg = start !== -1 ? html.slice(start, start + 700) : '';
    return seg.indexOf("location.protocol.indexOf('http') !== 0") !== -1;
  }
});

/* 7. SW 缓存版本已递增 */
cases.push({
  name: 'Service Worker 缓存版本已递增',
  run() {
    const m = /mingbian-kangtu-v(\d+)/.exec(sw);
    return m !== null && Number(m[1]) >= 7;
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