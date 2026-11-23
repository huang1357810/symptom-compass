/*
 * 匿名账号自测：node tools/test-auth.js
 *
 * 用内存假 KV 跑 worker/auth.mjs 的真实逻辑：
 * 注册 / 重复用户名 / 弱密码 / 手机号与邮箱被拒 / 登录 / 错误密码 /
 * 限流 / 连续失败锁定 / 恢复码 / 注销级联。
 */
const path = require('path');
const { pathToFileURL } = require('url');

if (!globalThis.crypto) globalThis.crypto = require('crypto').webcrypto;

function makeKV() {
  const map = new Map();
  return {
    map,
    async get(k) { return map.has(k) ? map.get(k) : null; },
    async put(k, v) { map.set(k, String(v)); },
    async delete(k) { map.delete(k); },
    async list(opts) {
      const prefix = (opts && opts.prefix) || '';
      const limit = (opts && opts.limit) || 1000;
      const start = opts && opts.cursor ? Number(opts.cursor) : 0;
      const all = Array.from(map.keys()).filter(k => k.indexOf(prefix) === 0).sort();
      const keys = all.slice(start, start + limit).map(name => ({ name }));
      const next = start + limit < all.length ? String(start + limit) : undefined;
      return { keys, list_complete: !next, cursor: next };
    }
  };
}

(async () => {
  const auth = await import(pathToFileURL(path.join(__dirname, '..', 'worker', 'auth.mjs')).href);

  let passed = 0;
  const failures = [];
  const ok = (name, cond, detail) => {
    if (cond) passed += 1;
    else failures.push(name + (detail ? '：' + detail : ''));
  };

  /* 1. 注册 */
  let kv = makeKV();
  let env = { FEEDBACK_KV: kv };
  const reg = await auth.register(env, { username: 'Alice_01', password: 'password123', agree: true });
  ok('注册成功', reg.ok === true, JSON.stringify(reg));
  ok('恢复码为 8 位', reg.ok && typeof reg.recoveryCode === 'string' && reg.recoveryCode.length === 8);

  const stored = JSON.parse(await kv.get('users:' + reg.userId));
  ok('users 记录字段完整', ['username', 'salt', 'hash', 'recoveryHash', 'createdAt', 'status']
    .every(k => Object.prototype.hasOwnProperty.call(stored, k)));

  /* 2. 重复用户名（大小写不敏感） */
  const dup = await auth.register(env, { username: 'alice_01', password: 'password123', agree: true });
  ok('重复用户名被拒', dup.ok === false && dup.status === 409, JSON.stringify(dup));

  /* 3. 弱密码 */
  const weak = await auth.register(env, { username: 'bob_01', password: '1234567', agree: true });
  ok('弱密码被拒', weak.ok === false && weak.status === 400, JSON.stringify(weak));

  /* 4. 手机号被拒 */
  const phone = await auth.register(env, { username: '13800138000', password: 'password123', agree: true });
  ok('纯 11 位数字被拒', phone.ok === false && /手机号/.test(phone.error || ''), JSON.stringify(phone));

  /* 5. 含 @ 被拒 */
  const mail = await auth.register(env, { username: 'a@b.com', password: 'password123', agree: true });
  ok('含 @ 被拒', mail.ok === false && /@/.test(mail.error || ''), JSON.stringify(mail));

  /* 6. 未勾选同意 */
  const noAgree = await auth.register(env, { username: 'carol_01', password: 'password123' });
  ok('未勾选同意被拒', noAgree.ok === false && noAgree.status === 400, JSON.stringify(noAgree));

  /* 7. 登录成功 */
  const login1 = await auth.login(env, {
    username: 'Alice_01', password: 'password123', ip: '1.1.1.1', now: 60000 * 100
  });
  ok('登录成功并返回会话', login1.ok === true && typeof login1.token === 'string' && login1.token.length === 64);
  const sess = JSON.parse(await kv.get('sessions:' + login1.token));
  ok('sessions 记录含 userId 与 expiresAt', sess.userId === reg.userId && typeof sess.expiresAt === 'number');

  /* 8. 错误密码 → 统一文案 */
  const bad = await auth.login(env, {
    username: 'Alice_01', password: 'wrongpass1', ip: '2.2.2.2', now: 60000 * 100
  });
  ok('错误密码被拒', bad.ok === false && bad.status === 401);
  ok('错误密码文案统一', bad.error === '用户名或密码错误');

  /* 9. 登录限流：同 IP 每分钟 5 次 */
  const ip = '3.3.3.3';
  const now0 = 60000 * 200;
  const codes = [];
  for (let i = 0; i < 6; i++) {
    const r = await auth.login(env, { username: 'Alice_01', password: 'wrongpass1', ip, now: now0 });
    codes.push(r.status);
  }
  ok('同 IP 第 6 次触发限流', codes[5] === 429, codes.join(','));

  /* 10. 连续失败 10 次锁 15 分钟 */
  const ip2 = '4.4.4.4';
  for (let i = 0; i < 5; i++) {
    await auth.login(env, { username: 'Alice_01', password: 'wrongpass1', ip: ip2, now: 60000 * 300 });
  }
  for (let i = 0; i < 5; i++) {
    await auth.login(env, { username: 'Alice_01', password: 'wrongpass1', ip: ip2, now: 60000 * 301 });
  }
  const locked = await auth.login(env, { username: 'Alice_01', password: 'password123', ip: ip2, now: 60000 * 302 });
  ok('连续失败 10 次后锁定', locked.ok === false && locked.status === 423, JSON.stringify(locked));

  /* 11. 恢复码：错误码被拒、正确码可重置并返回新码 */
  const badRecover = await auth.recover(env, {
    username: 'Alice_01', recoveryCode: 'WRONG123', newPassword: 'newpassword1'
  });
  ok('错误恢复码被拒', badRecover.ok === false && badRecover.status === 400, JSON.stringify(badRecover));

  const goodRecover = await auth.recover(env, {
    username: 'Alice_01', recoveryCode: reg.recoveryCode, newPassword: 'newpassword1'
  });
  ok('正确恢复码可重置', goodRecover.ok === true && typeof goodRecover.recoveryCode === 'string', JSON.stringify(goodRecover));

  const oldLogin = await auth.login(env, {
    username: 'Alice_01', password: 'password123', ip: '5.5.5.5', now: 60000 * 400
  });
  ok('旧密码已失效', oldLogin.ok === false);
  const newLogin = await auth.login(env, {
    username: 'Alice_01', password: 'newpassword1', ip: '5.5.5.6', now: 60000 * 400
  });
  ok('新密码可登录', newLogin.ok === true, JSON.stringify(newLogin));

  /* 12. 注销级联：删 user / 全部 session / 名下反馈 */
  await kv.put('fb:1:x', JSON.stringify({ id: 'x', ts: 1, rating: 5, userId: reg.userId }));
  await kv.put('fb:2:y', JSON.stringify({ id: 'y', ts: 2, rating: 4, userId: 'someone_else' }));
  const del = await auth.deleteAccount(env, reg.userId);
  ok('注销返回删除统计', del.ok === true && del.deletedFeedback === 1 && del.deletedSessions >= 1, JSON.stringify(del));
  ok('user 记录已删除', (await kv.get('users:' + reg.userId)) === null);
  ok('用户名索引已删除', (await kv.get('uname:alice_01')) === null);
  ok('名下反馈已删除', (await kv.get('fb:1:x')) === null);
  ok('他人反馈保留', (await kv.get('fb:2:y')) !== null);
  const meAfter = await auth.me(env, login1.token);
  ok('旧会话已失效', meAfter === null);

  if (failures.length) {
    console.error('匿名账号校验失败：\n  ' + failures.join('\n  '));
    process.exit(1);
  }
  console.log('匿名账号用例 ' + passed + '/' + passed + ' 通过（注册/校验/登录/限流/锁定/恢复码/注销级联）');
})();