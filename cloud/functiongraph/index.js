/**
 * 华为云 FunctionGraph 函数入口
 *
 * 一个函数同时承担两件事：
 *   GET  /                     返回页面（index.html）
 *   GET  /api/triage/health    健康检查，前端用它判断是否启用云端分诊
 *   POST /api/triage           分诊计算，入参 {"symptoms":["sore_throat","fever"]}
 *
 * 部署：函数类型选「HTTP 函数」，入口填 index.handler，
 *      上传 zip（index.js + logic.js + index.html），内存 256MB 足够。
 */
const fs = require('fs');
const path = require('path');
const logic = require('./logic');

let PAGE = null;
function page() {
  if (PAGE === null) {
    PAGE = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  }
  return PAGE;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function json(statusCode, obj) {
  return {
    statusCode: statusCode,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, CORS),
    body: JSON.stringify(obj),
    isBase64Encoded: false
  };
}

function pickPath(event) {
  if (event.path) return event.path;
  if (event.rawPath) return event.rawPath;
  if (event.requestContext && event.requestContext.path) return event.requestContext.path;
  return '/';
}

function pickMethod(event) {
  if (event.httpMethod) return String(event.httpMethod).toUpperCase();
  if (event.requestContext && event.requestContext.http && event.requestContext.http.method) {
    return String(event.requestContext.http.method).toUpperCase();
  }
  return 'GET';
}

function parseBody(event) {
  let raw = event.body;
  if (raw === undefined || raw === null || raw === '') return {};
  if (event.isBase64Encoded) {
    raw = Buffer.from(raw, 'base64').toString('utf8');
  }
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

exports.handler = async function (event, context) {
  const p = pickPath(event);
  const method = pickMethod(event);

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '', isBase64Encoded: false };
  }

  // 健康检查
  if (p.indexOf('/api/triage/health') >= 0) {
    return json(200, {
      ok: true,
      service: 'symptom-triage',
      version: '1.0.0',
      conditions: logic.CONDITIONS.length,
      symptoms: Object.keys(logic.SYMPTOMS).length
    });
  }

  // 分诊
  if (p.indexOf('/api/triage') >= 0) {
    if (method !== 'POST') {
      return json(405, { error: 'method not allowed, use POST' });
    }
    const payload = parseBody(event);
    if (payload === null) {
      return json(400, { error: 'invalid json body' });
    }
    const symptoms = Array.isArray(payload.symptoms) ? payload.symptoms : [];
    if (symptoms.length === 0) {
      return json(400, { error: 'symptoms is empty' });
    }

    const picked = new Set(symptoms);
    const results = logic.scoreConditions(picked);
    const flags = logic.flagsFor(picked);

    return json(200, {
      mode: 'cloud',
      selected: symptoms,
      flags: flags,
      results: results
    });
  }

  // 页面
  if (method === 'GET' || method === 'HEAD') {
    return {
      statusCode: 200,
      headers: Object.assign({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff'
      }, CORS),
      body: page(),
      isBase64Encoded: false
    };
  }

  return json(404, { error: 'not found', path: p });
};
