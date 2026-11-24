/*
 * 只读接口压测：node tools/load-test.js [--mock] [--base=URL] [--path=/api/evals/latest]
 *                    [--requests=100] [--concurrency=1,10,50] [--note=说明]
 *
 * 不在 CI 执行（文件名不是 test-*），避免打线上。
 * 结果写入 docs/load-test.md；--mock 启动本地 HTTP 服务，仅验证脚本与并发模型。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const hit = args.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : def;
};

const BASE = getArg('base', 'https://mingbian-kangtu.huang-1357810.workers.dev');
const P = getArg('path', '/api/evals/latest');
const REQUESTS = Number(getArg('requests', '100'));
const LEVELS = getArg('concurrency', '1,10,50').split(',').map(Number).filter(n => n > 0);
const MOCK = args.includes('--mock');
const NOTE = getArg('note', '');
const ROOT = path.join(__dirname, '..');

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[idx];
}

function startMock() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true,"version":"mock"}');
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: 'http://127.0.0.1:' + server.address().port });
    });
  });
}

async function runLevel(url, concurrency, total) {
  const latencies = [];
  const codes = {};
  let errors = 0;
  let r429 = 0;
  let next = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= total) return;
      const t0 = process.hrtime.bigint();
      let code = 0;
      try {
        const r = await fetch(url, { cache: 'no-store' });
        code = r.status;
        await r.text();
      } catch (e) {
        code = -1;
      }
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      latencies.push(ms);
      codes[code] = (codes[code] || 0) + 1;
      if (code < 200 || code >= 400) errors += 1;
      if (code === 429) r429 += 1;
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  latencies.sort((a, b) => a - b);
  return {
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    errors,
    total,
    rate: total ? errors / total : 0,
    r429,
    codes
  };
}

(async () => {
  let url = BASE + P;
  let source = '线上目标';
  let mock = null;

  if (MOCK) {
    mock = await startMock();
    url = mock.url + P;
    source = '本地 mock 服务器（只验证脚本与并发模型，不代表线上容量）';
  }

  const rows = [];
  for (const c of LEVELS) {
    const r = await runLevel(url, c, REQUESTS);
    rows.push({ concurrency: c, ...r });
    console.log('并发 ' + c + '：P50 ' + r.p50.toFixed(1) + 'ms · P95 ' + r.p95.toFixed(1) +
      'ms · 错误率 ' + (r.rate * 100).toFixed(1) + '% · 429 ' + r.r429);
  }

  if (mock) mock.server.close();

  const md = [
    '# 压测结果（只读接口）',
    '',
    '> 目标：`' + url + '`',
    '> 数据来源：' + source,
    '> 运行时间：' + new Date().toISOString().slice(0, 19).replace('T', ' '),
    '',
    '| 并发 | 请求数 | P50 (ms) | P95 (ms) | 错误率 | 是否出现 429 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map(r => '| ' + r.concurrency + ' | ' + r.total + ' | ' + r.p50.toFixed(1) + ' | ' +
      r.p95.toFixed(1) + ' | ' + (r.rate * 100).toFixed(1) + '% | ' + (r.r429 ? '是（' + r.r429 + ' 次）' : '否') + ' |'),
    '',
    '## 口径与限制',
    '',
    '- **只测读接口**（默认 `GET /api/evals/latest`）；写接口（反馈、账号、指标）未压测。',
    '- Cloudflare Workers 免费版 **CPU 10ms/请求、KV 写 1000/天**；**写接口结果不代表真实容量**。',
    '- 429 若出现，来自平台或代理限流，不是应用层的反馈限流（反馈限流只作用于 POST /api/feedback）。',
    '- 未覆盖：真实移动网络抖动、多地区分布、并发下的 KV 最终一致性与账号并发注册。',
    NOTE ? '- 备注：' + NOTE : '- 备注：未填写',
    ''
  ].join('\n');

  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'load-test.md'), md, 'utf8');
  console.log('已写入 docs/load-test.md');
})().catch(err => {
  console.error('压测失败：' + err.message);
  process.exit(1);
});