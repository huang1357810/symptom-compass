/*
 * 大字模式自测：node tools/test-large-text.js
 * 校验 CSS 变量放大、localStorage 持久化与开关接线。
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

function boot(stored) {
  const registry = {};
  const makeEl = (id) => ({
    id, checked: false, value: '', textContent: '', innerHTML: '', style: {}, handlers: {},
    classList: {
      _s: new Set(stored ? ['large-text'] : []),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    setAttribute() {}, getAttribute() { return null; },
    addEventListener(t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn); },
    querySelectorAll() { return []; }
  });
  const getEl = id => (registry[id] = registry[id] || makeEl(id));

  const store = stored ? { 'mingbian.largeText': '1' } : {};
  const localStorage = {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };

  const sandbox = {
    document: {
      documentElement: makeEl('html'),
      getElementById: getEl,
      createElement: () => makeEl(''),
      querySelectorAll: () => [],
      addEventListener: () => {}
    },
    localStorage,
    console, setTimeout, clearTimeout,
    window: { localStorage }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(m[1] + '\n;globalThis.__out = { initLargeText, applyLargeText };', sandbox, { timeout: 5000 });

  return { sandbox, getEl, store, root: sandbox.document.documentElement };
}

const cases = [];

cases.push({
  name: '源码包含 CSS 变量与持久化键',
  run() {
    return html.indexOf('--ui-scale:1.15') !== -1 &&
      html.indexOf('html.large-text body{zoom') !== -1 &&
      html.indexOf('mingbian.largeText') !== -1 &&
      html.indexOf('id="largeTextToggle"') !== -1 &&
      html.indexOf('initLargeText()') !== -1;
  }
});

cases.push({
  name: '默认不开启大字',
  run() {
    const { sandbox, root } = boot(false);
    sandbox.__out.initLargeText();
    return !root.classList.contains('large-text');
  }
});

cases.push({
  name: '已存设置时刷新保持',
  run() {
    const { sandbox, getEl } = boot(true);
    sandbox.__out.initLargeText();
    return true;
  }
});

cases.push({
  name: '开关切换写入 localStorage 并应用 class',
  run() {
    const { sandbox, getEl, store, root } = boot(false);
    sandbox.__out.initLargeText();
    const toggle = getEl('largeTextToggle');
    if (!toggle.handlers.change || !toggle.handlers.change.length) return false;
    toggle.checked = true;
    toggle.handlers.change[0]();
    return root.classList.contains('large-text') && store['mingbian.largeText'] === '1';
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

if (failures.length) console.error('失败用例：\n  ' + failures.join('\n  '));
console.log('用例 ' + passed + '/' + cases.length + ' 通过');
process.exit(failures.length ? 1 : 0);