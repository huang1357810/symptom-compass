/*
 * 复诊提醒自测：node tools/test-reminder.js
 *
 * 覆盖：日期计算 / 到期判断 / 无权限降级为页面提示 / 有权限只弹一次。
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

function mockEl() {
  const el = {
    hidden: false, textContent: '', innerHTML: '', className: '', value: '', disabled: false,
    dataset: {}, style: {}, open: false,
    classList: {
      add(cls) { if (cls === 'hidden') el.hidden = true; },
      remove(cls) { if (cls === 'hidden') el.hidden = false; },
      toggle(cls, force) {
        if (cls !== 'hidden') return;
        el.hidden = force === undefined ? !el.hidden : !!force;
      }
    },
    setAttribute() {}, getAttribute() { return null; },
    scrollIntoView() {}, addEventListener() {}, appendChild() {},
    querySelectorAll() { return []; }, querySelector() { return mockEl(); }
  };
  return el;
}

function makeSandbox(permission) {
  const els = {};
  const mem = {};
  const notifications = [];

  const sandbox = {
    console, Date, Math, JSON, Set, Map, Array, Object, String, Number, Promise,
    setTimeout, clearTimeout, AbortController: globalThis.AbortController,
    Response: globalThis.Response, Request: globalThis.Request, Headers: globalThis.Headers,
    TextEncoder: globalThis.TextEncoder,
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem(k, v) { mem[k] = String(v); },
      removeItem(k) { delete mem[k]; }
    },
    location: { search: '', href: '' },
    history: { replaceState() {} },
    navigator: {},
    alert() {}, confirm() { return true; },
    document: {
      getElementById(id) { if (!els[id]) els[id] = mockEl(); return els[id]; },
      querySelector() { return mockEl(); },
      querySelectorAll() { return []; },
      addEventListener() {},
      createElement() { return mockEl(); }
    }
  };
  if (permission !== undefined) {
    function FakeNotification(title, opts) { notifications.push({ title, opts }); }
    FakeNotification.permission = permission;
    sandbox.Notification = FakeNotification;
  }
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.fetch = async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });

  vm.createContext(sandbox);
  vm.runInContext(
    m[1] + '\n;globalThis.__out={revisitDate,reminderDue,reminderChannel,revisitIsDue,checkRevisit,setRevisit,revisitReminder,dayKey,REVISIT_KEY};',
    sandbox,
    { timeout: 10000 }
  );
  return { sandbox, els, mem, notifications, out: sandbox.__out };
}

const errors = [];
const ok = (name, cond, detail) => {
  if (!cond) errors.push(name + (detail ? '：' + detail : ''));
};

const pad = n => String(n).padStart(2, '0');
const expectDate = ms => {
  const d = new Date(ms);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
};

/* 1–2. 日期计算 */
const noPerm = makeSandbox(undefined);
const base = new Date(2026, 0, 1, 12, 0, 0).getTime();
[3, 7, 14].forEach(days => {
  const got = noPerm.out.revisitDate(days, base);
  const want = expectDate(base + days * 86400000);
  ok(days + ' 天后日期计算正确', got === want, got + ' vs ' + want);
});

/* 3. 到期判断 */
const today = '2026-01-10';
ok('到期：今天', noPerm.out.reminderDue({ date: today }, today) === true);
ok('到期：过去', noPerm.out.reminderDue({ date: '2026-01-09' }, today) === true);
ok('未到期：未来', noPerm.out.reminderDue({ date: '2026-01-11' }, today) === false);
ok('已提醒过不再弹', noPerm.out.reminderDue({ date: today, notified: true }, today) === false);
ok('空提醒不弹', noPerm.out.reminderDue(null, today) === false);

/* 4. 通道降级 */
ok('granted → 系统通知', noPerm.out.reminderChannel('granted') === 'system');
ok('default → 页面提示', noPerm.out.reminderChannel('default') === 'inline');
ok('denied → 页面提示', noPerm.out.reminderChannel('denied') === 'inline');
ok('undefined → 页面提示', noPerm.out.reminderChannel(undefined) === 'inline');

/* 5. revisitIsDue 只看到期，不看 notified */
ok('到期显示不受 notified 影响', noPerm.out.revisitIsDue({ date: today, notified: true }) === true);
ok('未来日期不显示', noPerm.out.revisitIsDue({ date: '2099-01-01' }) === false);

/* 6. 无通知权限：降级为页面提示 */
const inline = makeSandbox(undefined);
inline.mem['mingbian.revisit.v1'] = JSON.stringify({ date: '2020-01-01', days: 3, notified: false, owner: 'a_x' });
inline.sandbox.__out.checkRevisit();
ok('无权限时页面显示提示', inline.els.revisitDue.hidden === false);
ok('无权限时文案说明降级', String(inline.els.revisitDue.textContent).indexOf('页面提示') !== -1,
  inline.els.revisitDue.textContent);
ok('无权限时不构造系统通知', inline.notifications.length === 0);
ok('无权限时标记已提醒', JSON.parse(inline.mem['mingbian.revisit.v1']).notified === true);

/* 7. 有通知权限：只弹一次 */
const system = makeSandbox('granted');
system.mem['mingbian.revisit.v1'] = JSON.stringify({ date: '2020-01-01', days: 7, notified: false, owner: 'u_1' });
system.sandbox.__out.checkRevisit();
ok('有权限时弹系统通知一次', system.notifications.length === 1, '次数=' + system.notifications.length);
ok('系统通知标题正确', system.notifications[0] && system.notifications[0].title === '复诊提醒');
system.sandbox.__out.checkRevisit();
ok('第二次打开不重复弹', system.notifications.length === 1, '次数=' + system.notifications.length);

/* 8. setRevisit 写入结构 */
const set = inline.sandbox.__out.setRevisit(7);
ok('setRevisit 返回 7 天后日期', set.date === expectDate(Date.now() + 7 * 86400000), set.date);
ok('setRevisit 含 owner 与 notified=false', typeof set.owner === 'string' && set.notified === false);

if (errors.length) {
  console.error('复诊提醒校验失败：\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('复诊提醒 18/18 通过（日期/到期/降级/只弹一次/写入结构）');