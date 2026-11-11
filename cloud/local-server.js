/**
 * 本地开发服务器：把 FunctionGraph 的 handler 挂到 HTTP 上，
 * 用于在没有华为云账号时验证「云端分诊」整条链路。
 *
 * 运行： node cloud/local-server.js
 * 访问： http://127.0.0.1:8091
 */
const http = require('http');
const { handler } = require('./functiongraph/index');

const PORT = Number(process.env.PORT || 8091);

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
  });
}

const server = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const event = {
    path: (req.url || '/').split('?')[0],
    httpMethod: req.method,
    headers: req.headers,
    body: body.length > 0 ? body : null,
    isBase64Encoded: false
  };

  try {
    const result = await handler(event, {});
    res.writeHead(result.statusCode, result.headers);
    res.end(result.body);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(e && e.message) }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('cloud dev server: http://127.0.0.1:' + PORT);
});
