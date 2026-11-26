/*
 * 症状抽取（受约束）：一句话 → { symptoms:[], negated:[] }
 *
 * 只做症状 id 抽取，不输出病名/建议/剂量；id 必须取自 84 个症状白名单。
 * 任何失败（无 key / 超时 / HTTP 失败 / JSON 非法）都返回 null，上层回退本地。
 * 缓存：对文本 SHA-256，KV 存 nlu:{hash} 7 天。
 */
import { callLLM } from './llm.mjs';
import { SYMPTOM_IDS } from './symptom-ids.mjs';

let lastError = '';
export function lastLlmError() { return lastError; }

const MAX_SYMPTOMS = 8;
const ALLOWED = new Set(SYMPTOM_IDS);

export function normalizeText(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, 200);
}

export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function systemPrompt() {
  return '你是症状抽取器。只把用户的一句话转成症状 id 数组，不要输出病名、诊断、建议或剂量。\n' +
    '只输出 JSON 对象：{"symptoms":[],"negated":[]}。\n' +
    'id 只能从这个列表里选：' + SYMPTOM_IDS.join(',') + '。\n' +
    'negated 表示用户明确否认的症状（例如“没有发烧”）。用户没提到的不要猜。';
}

/* 构造模型消息（评测脚本复用同一条链路，避免提示漂移） */
export function buildMessages(text) {
  return [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: normalizeText(text) }
  ];
}

/* 白名单过滤 + 去重 + 最多 8 个 */
export function pickWhitelist(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach(function (id) {
    if (typeof id === 'string' && ALLOWED.has(id) && out.indexOf(id) === -1) out.push(id);
  });
  return out.slice(0, MAX_SYMPTOMS);
}

function stripFence(raw) {
  let t = String(raw == null ? '' : raw).trim();
  t = t.replace(/^\x60\x60\x60(?:json)?\s*/i, '').replace(/\x60\x60\x60\s*$/, '').trim();
  if (t.charAt(0) === '{') return t;
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  return (a !== -1 && b > a) ? t.slice(a, b + 1) : t;
}

export async function extractSymptoms(env, text) {
  const clean = normalizeText(text);
  if (!clean) return null;

  const cacheKey = 'nlu:' + (await sha256Hex(clean));
  if (env && env.FEEDBACK_KV) {
    try {
      const cached = await env.FEEDBACK_KV.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && Array.isArray(parsed.symptoms)) return parsed;
      }
    } catch (e) { /* 缓存损坏忽略 */ }
  }

  lastError = '';
  const r = await callLLM(env, buildMessages(clean));
  if (!r.ok) { lastError = 'llm:' + r.error; return null; }

  let content = '';
  try {
    content = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message
      ? String(r.data.choices[0].message.content || '') : '';
  } catch (e) { return null; }

  content = stripFence(content);
  if (!content) { lastError = 'empty_content'; return null; }
  let obj = null;
  try { obj = JSON.parse(content); } catch (e) { lastError = 'bad_json'; return null; }
  if (!obj || !Array.isArray(obj.symptoms)) { lastError = 'no_symptoms_field'; return null; }

  const out = { symptoms: pickWhitelist(obj.symptoms), negated: pickWhitelist(obj.negated) };
  if (env && env.FEEDBACK_KV) {
    try { await env.FEEDBACK_KV.put(cacheKey, JSON.stringify(out), { expirationTtl: 7 * 24 * 3600 }); } catch (e) { /* 忽略 */ }
  }
  return out;
}