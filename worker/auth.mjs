/*
 * 匿名账号核心逻辑（ESM，Worker 与 Node 测试共用）
 *
 * 数据模型（KV）：
 *   users:{userId}   = { username, salt, hash, recoveryHash, createdAt, status }
 *   uname:{lower}    = userId（用户名唯一索引）
 *   sessions:{token} = { userId, expiresAt }
 *   fb:{ts}:{id}     = 反馈记录（userId 或 anonId）
 *
 * 明确不存储：phone / email / realName（任何联系方式）。
 */

export const DEFAULT_ITERATIONS = 50000;
/* 旧版本（首次上线）默认迭代数；老记录没有 iterations 字段时按此校验，避免降档后老账号失效 */
export const LEGACY_ITERATIONS = 100000;

export const AUTH = {
  ITERATIONS: DEFAULT_ITERATIONS,
  SALT_BYTES: 16,
  RECOVERY_LEN: 8,
  SESSION_TTL_MS: 7 * 24 * 3600 * 1000,
  LOGIN_PER_MINUTE: 5,
  LOGIN_FAIL_LOCK: 10,
  LOGIN_LOCK_SECONDS: 15 * 60,
  RECOVER_FAIL_LOCK: 5,
  RECOVER_LOCK_SECONDS: 30 * 60
};

/* 迭代数解析：默认 5 万（免费版 CPU 限制），可通过 env.AUTH_ITERATIONS 覆盖（1 万–30 万） */
export function iterationsFor(env) {
  const n = env && Number(env.AUTH_ITERATIONS);
  if (!Number.isFinite(n) || n < 10000) return DEFAULT_ITERATIONS;
  return Math.min(Math.round(n), 300000);
}

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const PHONE_RE = /^\d{11}$/;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/* ---------------- 校验 ---------------- */

export function validateUsername(name) {
  if (typeof name !== 'string') return '用户名需为 3–20 位字母、数字或下划线';
  if (PHONE_RE.test(name)) return '用户名不能是手机号';
  if (name.indexOf('@') !== -1) return '用户名不能包含 @';
  if (!USERNAME_RE.test(name)) return '用户名需为 3–20 位字母、数字或下划线';
  return '';
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) return '密码至少 8 位';
  return '';
}

/* ---------------- 哈希与随机 ---------------- */

function randomBytes(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

function toHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function pbkdf2(text, saltBytes, iterations) {
  const iters = Number.isFinite(iterations) && iterations > 0 ? iterations : DEFAULT_ITERATIONS;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(String(text)), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: iters, hash: 'SHA-256' },
    key, 256
  );
  return toHex(new Uint8Array(bits));
}

function recoveryCode() {
  const b = randomBytes(AUTH.RECOVERY_LEN);
  let s = '';
  for (let i = 0; i < b.length; i++) s += RECOVERY_ALPHABET[b[i] % RECOVERY_ALPHABET.length];
  return s;
}

/* ---------------- Cookie ---------------- */

export function getCookie(request, name) {
  const raw = (request && request.headers && request.headers.get('Cookie')) || '';
  const parts = raw.split(';');
  for (const part of parts) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return '';
}

export function sessionCookie(token) {
  return 'mb_session=' + token +
    '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' + Math.floor(AUTH.SESSION_TTL_MS / 1000);
}

export function clearCookie() {
  return 'mb_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
}

const noStore = { 'Cache-Control': 'no-store' };

export function jsonNoStore(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, noStore)
  });
}

/* ---------------- KV 辅助 ---------------- */

async function readJson(kv, key) {
  const raw = await kv.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function minuteBucket(now) {
  return Math.floor(now / 60000);
}

async function bump(kv, key, ttl) {
  const n = Number(await kv.get(key)) || 0;
  await kv.put(key, String(n + 1), { expirationTtl: ttl });
  return n + 1;
}

export async function rateLimited(kv, ip, now) {
  const key = 'login:ip:' + ip + ':' + minuteBucket(now);
  const n = Number(await kv.get(key)) || 0;
  if (n >= AUTH.LOGIN_PER_MINUTE) return true;
  await kv.put(key, String(n + 1), { expirationTtl: 70 });
  return false;
}

/* ---------------- 注册 / 登录 / 会话 ---------------- */

export async function register(env, input) {
  const kv = env.FEEDBACK_KV;
  if (!kv) return { ok: false, status: 503, error: 'no_store' };

  const username = String((input && input.username) || '').trim();
  const password = String((input && input.password) || '');
  const uErr = validateUsername(username);
  if (uErr) return { ok: false, status: 400, error: uErr };
  const pErr = validatePassword(password);
  if (pErr) return { ok: false, status: 400, error: pErr };
  if (input && input.agree !== true) {
    return { ok: false, status: 400, error: '请先勾选同意匿名账号与反馈存储说明' };
  }

  const lower = username.toLowerCase();
  if (await kv.get('uname:' + lower)) {
    return { ok: false, status: 409, error: '用户名已被占用' };
  }

  const iterations = iterationsFor(env);
  const saltBytes = randomBytes(AUTH.SALT_BYTES);
  const salt = toHex(saltBytes);
  const hash = await pbkdf2(password, saltBytes, iterations);
  const code = recoveryCode();
  const recoveryHash = await pbkdf2(code, saltBytes, iterations);
  const userId = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const record = {
    username,
    salt,
    hash,
    recoveryHash,
    iterations,
    createdAt: Date.now(),
    status: 'active'
  };
  await kv.put('users:' + userId, JSON.stringify(record));
  await kv.put('uname:' + lower, userId);

  return { ok: true, userId, username, recoveryCode: code };
}

export async function login(env, input) {
  const kv = env.FEEDBACK_KV;
  if (!kv) return { ok: false, status: 503, error: 'no_store' };

  const now = typeof input.now === 'number' ? input.now : Date.now();
  const ip = String((input && input.ip) || 'unknown');
  const username = String((input && input.username) || '').trim();
  const password = String((input && input.password) || '');

  if (await kv.get('loginlock:' + ip)) {
    return { ok: false, status: 423, error: '尝试次数过多，请 15 分钟后再试' };
  }
  if (await rateLimited(kv, ip, now)) {
    return { ok: false, status: 429, error: '请求过于频繁，请稍后再试' };
  }

  let record = null;
  let userId = '';
  if (!validateUsername(username)) {
    userId = (await kv.get('uname:' + username.toLowerCase())) || '';
    if (userId) record = await readJson(kv, 'users:' + userId);
  }

  let ok = false;
  if (record && record.status === 'active') {
    /* 校验必须用「创建时记录的迭代数」；老账号没有该字段时回退默认值 */
    const iterations = Number.isFinite(record.iterations) && record.iterations > 0
      ? record.iterations : LEGACY_ITERATIONS;
    const hash = await pbkdf2(password, fromHex(record.salt), iterations);
    ok = hash === record.hash;
  }

  if (!ok) {
    const fails = await bump(kv, 'loginfail:' + ip, AUTH.LOGIN_LOCK_SECONDS + 60);
    if (fails >= AUTH.LOGIN_FAIL_LOCK) {
      await kv.put('loginlock:' + ip, '1', { expirationTtl: AUTH.LOGIN_LOCK_SECONDS });
    }
    return { ok: false, status: 401, error: '用户名或密码错误' };
  }

  await kv.delete('loginfail:' + ip);
  await rateLimited(kv, ip, now);

  const token = toHex(randomBytes(32));
  const expiresAt = now + AUTH.SESSION_TTL_MS;
  await kv.put('sessions:' + token, JSON.stringify({ userId, expiresAt }), {
    expirationTtl: Math.floor(AUTH.SESSION_TTL_MS / 1000)
  });

  return { ok: true, token, userId, username: record.username, expiresAt };
}

export async function me(env, token) {
  const kv = env.FEEDBACK_KV;
  if (!kv || !token) return null;
  const session = await readJson(kv, 'sessions:' + token);
  if (!session || typeof session.expiresAt !== 'number' || session.expiresAt < Date.now()) {
    if (session) await kv.delete('sessions:' + token);
    return null;
  }
  const user = await readJson(kv, 'users:' + session.userId);
  if (!user || user.status !== 'active') return null;
  return { userId: session.userId, username: user.username };
}

export async function logout(env, token) {
  if (env.FEEDBACK_KV && token) await env.FEEDBACK_KV.delete('sessions:' + token);
  return { ok: true };
}

/* ---------------- 找回密码 ---------------- */

export async function recover(env, input) {
  const kv = env.FEEDBACK_KV;
  if (!kv) return { ok: false, status: 503, error: 'no_store' };

  const username = String((input && input.username) || '').trim();
  const code = String((input && input.recoveryCode) || '').trim().toUpperCase();
  const newPassword = String((input && input.newPassword) || '');
  const lower = username.toLowerCase();

  if (await kv.get('recoverlock:' + lower)) {
    return { ok: false, status: 423, error: '恢复码错误次数过多，请 30 分钟后再试' };
  }

  const userId = (await kv.get('uname:' + lower)) || '';
  const user = userId ? await readJson(kv, 'users:' + userId) : null;

  let ok = false;
  if (user && user.status === 'active' && code) {
    /* 恢复码校验同样使用该账号记录的迭代数，避免默认值调整后老账号失效 */
    const iterations = Number.isFinite(user.iterations) && user.iterations > 0
      ? user.iterations : LEGACY_ITERATIONS;
    const hash = await pbkdf2(code, fromHex(user.salt), iterations);
    ok = hash === user.recoveryHash;
  }

  if (!ok) {
    const fails = await bump(kv, 'recoverfail:' + lower, AUTH.RECOVER_LOCK_SECONDS + 60);
    if (fails >= AUTH.RECOVER_FAIL_LOCK) {
      await kv.put('recoverlock:' + lower, '1', { expirationTtl: AUTH.RECOVER_LOCK_SECONDS });
    }
    return { ok: false, status: 400, error: '用户名或恢复码错误' };
  }

  const pErr = validatePassword(newPassword);
  if (pErr) return { ok: false, status: 400, error: pErr };

  /* 换盐防复用，并生成新恢复码（只返回这一次，旧码立即失效）；迭代数按当前 env 更新 */
  const iterations = iterationsFor(env);
  const saltBytes = randomBytes(AUTH.SALT_BYTES);
  user.salt = toHex(saltBytes);
  user.hash = await pbkdf2(newPassword, saltBytes, iterations);
  const newCode = recoveryCode();
  user.recoveryHash = await pbkdf2(newCode, saltBytes, iterations);
  user.iterations = iterations;
  await kv.put('users:' + userId, JSON.stringify(user));
  await kv.delete('recoverfail:' + lower);

  return { ok: true, recoveryCode: newCode };
}

/* ---------------- 注销（级联删除） ---------------- */

async function listAll(kv, prefix, maxPages = 6) {
  const out = [];
  let cursor;
  for (let i = 0; i < maxPages; i++) {
    const opts = { prefix, limit: 500 };
    if (cursor) opts.cursor = cursor;
    const page = await kv.list(opts);
    for (const k of page.keys) out.push(k.name);
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }
  return out;
}

/* ---------------- 时间轴（仅登录用户，服务端隔离） ---------------- */

const TIMELINE_MAX_DAYS = 400;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function mergeTimelineDays(baseDays, incomingDays) {
  const out = Object.assign({}, baseDays || {});
  Object.keys(incomingDays || {}).forEach(date => {
    if (!DATE_RE.test(date)) return;
    const prev = out[date] || null;
    const next = incomingDays[date] || {};
    const prevSym = Array.isArray(prev && prev.sym) ? prev.sym : [];
    const nextSym = Array.isArray(next.sym) ? next.sym : [];
    const sym = Array.from(new Set(prevSym.concat(nextSym))).slice(0, 40);
    const symptoms = Object.assign({}, prev && prev.symptoms ? prev.symptoms : {});
    const incoming = next.symptoms && typeof next.symptoms === 'object' ? next.symptoms : {};
    Object.keys(incoming).forEach(id => {
      const v = Number(incoming[id]);
      if (!Number.isFinite(v)) return;
      symptoms[id] = Math.max(Number(symptoms[id]) || 0, Math.max(0, Math.min(10, Math.round(v))));
    });
    const manual = (prev && prev.source === 'manual') || next.source === 'manual';
    out[date] = {
      score: Math.max(Number(prev && prev.score) || 0, Number(next.score) || 0),
      source: manual ? 'manual' : 'auto',
      level: next.level || (prev && prev.level) || '',
      sym: sym,
      symptoms: symptoms
    };
  });
  const keys = Object.keys(out).sort();
  if (keys.length > TIMELINE_MAX_DAYS) {
    keys.slice(0, keys.length - TIMELINE_MAX_DAYS).forEach(k => { delete out[k]; });
  }
  return out;
}

export async function timelineGet(env, userId) {
  const kv = env.FEEDBACK_KV;
  if (!kv) return { ok: false, status: 503, error: 'no_store' };
  const raw = await readJson(kv, 'timeline:' + userId);
  return { ok: true, timeline: { days: (raw && raw.days) || {} } };
}

export async function timelineAppend(env, userId, payload) {
  const kv = env.FEEDBACK_KV;
  if (!kv) return { ok: false, status: 503, error: 'no_store' };

  const days = payload && payload.days && typeof payload.days === 'object' ? payload.days : null;
  const single = payload && typeof payload.date === 'string'
    ? { [payload.date]: payload.entry || {} }
    : null;
  const incoming = days || single;
  if (!incoming) return { ok: false, status: 400, error: 'bad_timeline' };

  const cur = await readJson(kv, 'timeline:' + userId);
  const merged = mergeTimelineDays(cur && cur.days, incoming);
  await kv.put('timeline:' + userId, JSON.stringify({ days: merged }));
  return { ok: true, timeline: { days: merged } };
}

export async function timelineClear(env, userId) {
  const kv = env.FEEDBACK_KV;
  if (!kv) return { ok: false, status: 503, error: 'no_store' };
  await kv.delete('timeline:' + userId);
  return { ok: true };
}

export async function deleteAccount(env, userId) {
  const kv = env.FEEDBACK_KV;
  if (!kv || !userId) return { ok: false, status: 400, error: 'bad_request' };

  const user = await readJson(kv, 'users:' + userId);
  if (!user) return { ok: false, status: 404, error: 'not_found' };

  let sessions = 0;
  for (const key of await listAll(kv, 'sessions:')) {
    const s = await readJson(kv, key);
    if (s && s.userId === userId) {
      await kv.delete(key);
      sessions += 1;
    }
  }

  let feedback = 0;
  for (const key of await listAll(kv, 'fb:')) {
    const rec = await readJson(kv, key);
    if (rec && rec.userId === userId) {
      await kv.delete(key);
      feedback += 1;
    }
  }

  await kv.delete('timeline:' + userId);
  await kv.delete('uname:' + String(user.username).toLowerCase());
  await kv.delete('users:' + userId);
  return { ok: true, deletedSessions: sessions, deletedFeedback: feedback };
}

/* ---------------- 反馈归属校验 ---------------- */

export async function resolveFeedbackOwner(request, env, body) {
  const token = getCookie(request, 'mb_session');
  const session = token ? await me(env, token) : null;
  const claimed = body && typeof body.userId === 'string' ? body.userId : '';

  if (claimed && (!session || session.userId !== claimed)) {
    return { error: 'forged_user' };
  }
  if (session) return { userId: session.userId };

  const anon = body && typeof body.anonId === 'string'
    ? body.anonId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)
    : '';
  return anon ? { anonId: anon } : {};
}

/* ---------------- 管理端查询 ---------------- */

export async function listUsers(env) {
  const kv = env.FEEDBACK_KV;
  if (!kv) return { ok: false, status: 503, error: 'no_store' };

  const fbKeys = await listAll(kv, 'fb:');
  const feedbackByUser = {};
  const lastActive = {};
  for (const key of fbKeys) {
    const rec = await readJson(kv, key);
    if (!rec || !rec.userId) continue;
    feedbackByUser[rec.userId] = (feedbackByUser[rec.userId] || 0) + 1;
    lastActive[rec.userId] = Math.max(lastActive[rec.userId] || 0, rec.ts || 0);
  }

  const users = [];
  for (const key of await listAll(kv, 'users:')) {
    const u = await readJson(kv, key);
    if (!u) continue;
    const userId = key.slice('users:'.length);
    users.push({
      userId,
      username: u.username,
      createdAt: u.createdAt,
      feedbackCount: feedbackByUser[userId] || 0,
      lastActiveAt: Math.max(lastActive[userId] || 0, u.createdAt || 0)
    });
  }
  users.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { ok: true, users };
}

export async function userFeedback(env, userId) {
  const kv = env.FEEDBACK_KV;
  if (!kv) return { ok: false, status: 503, error: 'no_store' };

  const items = [];
  for (const key of await listAll(kv, 'fb:')) {
    const rec = await readJson(kv, key);
    if (rec && rec.userId === userId) items.push(rec);
  }
  items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return { ok: true, userId, items };
}