/*
 * 账号隐私自测：node tools/test-auth-privacy.js
 *
 * 断言 users 记录只含白名单字段，且代码中不存在 phone / email / realName 字段。
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

if (!globalThis.crypto) globalThis.crypto = require('crypto').webcrypto;

function makeKV() {
  const map = new Map();
  return {
    async get(k) { return map.has(k) ? map.get(k) : null; },
    async put(k, v) { map.set(k, String(v)); },
    async delete(k) { map.delete(k); },
    async list(opts) {
      const prefix = (opts && opts.prefix) || '';
      const all = Array.from(map.keys()).filter(k => k.indexOf(prefix) === 0).sort();
      return { keys: all.map(name => ({ name })), list_complete: true };
    }
  };
}

(async () => {
  const auth = await import(pathToFileURL(path.join(__dirname, '..', 'worker', 'auth.mjs')).href);
  const kv = makeKV();
  const env = { FEEDBACK_KV: kv };

  const errors = [];
  const reg = await auth.register(env, { username: 'Privacy_01', password: 'password123', agree: true });
  if (!reg.ok) {
    console.error('注册失败，无法审计：' + JSON.stringify(reg));
    process.exit(1);
  }

  const raw = await kv.get('users:' + reg.userId);
  const rec = JSON.parse(raw);
  const keys = Object.keys(rec).sort();
  const allowed = ['createdAt', 'hash', 'iterations', 'recoveryHash', 'salt', 'status', 'username'];

  if (keys.join(',') !== allowed.join(',')) {
    errors.push('users 字段不在白名单：' + keys.join(','));
  }
  ['phone', 'email', 'realName'].forEach(field => {
    if (Object.prototype.hasOwnProperty.call(rec, field)) errors.push('users 记录出现禁用字段：' + field);
    if (new RegExp('"' + field + '"', 'i').test(raw)) errors.push('users 记录含禁用字段：' + field);
  });

  /* 静态扫描：不得出现字段赋值（排除注释中的说明文字） */
  const files = ['worker/auth.mjs', 'worker/index.js'];
  const fieldRe = /(^|[^A-Za-z_])(phone|email|realName)\s*[:=]/;
  files.forEach(rel => {
    const text = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    text.split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (fieldRe.test(code)) errors.push(rel + ' 第 ' + (i + 1) + ' 行出现禁用字段赋值');
    });
  });

  if (errors.length) {
    console.error('账号隐私校验失败：\n  ' + errors.join('\n  '));
    process.exit(1);
  }
  console.log('账号隐私通过：users 仅白名单字段（含 iterations），未出现 phone / email / realName');})();