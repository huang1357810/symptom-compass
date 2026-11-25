/*
 * 大模型网关（唯一出口）：OpenAI 兼容 /chat/completions。
 *
 * 从 env 读取 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL（默认 deepseek-chat）。
 * 超时 8 秒（AbortController），失败重试 1 次（401 不重试）。
 * 返回 { ok:true, data } 或 { ok:false, error }。
 * 不打印 prompt 与用户原文。
 */
export const DEFAULT_MODEL = 'deepseek-chat';
export const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';

export async function callLLM(env, messages, options) {
  const key = env && env.LLM_API_KEY;
  if (!key) return { ok: false, error: 'no_key' };

  const base = String((env && env.LLM_BASE_URL) || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = (env && env.LLM_MODEL) || DEFAULT_MODEL;
  const timeoutMs = options && Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 8000;
  const url = base + '/chat/completions';

  async function once() {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + key
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          temperature: 0,
          response_format: { type: 'json_object' }
        }),
        signal: ctrl.signal
      });
      if (res.status === 401) return { ok: false, error: 'http_401' };
      if (!res.ok) return { ok: false, error: 'http_' + res.status };
      const data = await res.json();
      return { ok: true, data: data };
    } catch (e) {
      return { ok: false, error: (e && e.name === 'AbortError') ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  let r = await once();
  if (!r.ok && r.error !== 'http_401' && r.error !== 'no_key') {
    r = await once();
  }
  return r;
}