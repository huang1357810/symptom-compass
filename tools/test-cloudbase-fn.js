/*
 * CloudBase 反馈云函数自测：node tools/test-cloudbase-fn.js
 * 不依赖真实云环境：用假 store 调用 createHandler。
 */
const path = require('path');

const FN = path.join(__dirname, '..', 'cloudbase', 'functions', 'feedback', 'index.js');
const STATS = path.join(__dirname, '..', 'cloudbase', 'functions', 'feedback', 'stats.js');

const { createHandler } = require(FN);
const { summarizeFeedback } = require(STATS);

function makeStore() {
  const rows = [];
  let seq = 0;
  return {
    rows,
    async countRecent(ipHash, sinceMs) {
      return rows.filter(r => r.ipHash === ipHash && r.createdAt.getTime() >= sinceMs).length;
    },
    async insert(rec) {
      seq += 1;
      const id = 'id' + seq;
      rows.push(Object.assign({ _id: id }, rec));
      return id;
    },
    async list() {
      return rows.slice();
    },
    async findById(id) {
      return rows.find(r => r._id === id) || null;
    },
    async update(id, patch) {
      const r = rows.find(x => x._id === id);
      if (r) Object.assign(r, patch);
    }
  };
}

function ev(method, p, extra) {
  return Object.assign({
    httpMethod: method,
    path: p,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1', 'user-agent': 'unit-test' },
    queryStringParameters: {},
    body: ''
  }, extra || {});
}

function postBody(obj, ip) {
  return ev('POST', '/api/feedback', {
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip || '10.0.0.1', 'user-agent': 'unit-test' },
    body: JSON.stringify(obj)
  });
}

(async () => {
  const cases = [];

  /* 1. 1–5 分通过 */
  cases.push({
    name: '1–5 分提交成功',
    async run() {
      const store = makeStore();
      const h = createHandler({ store, adminKey: 'secret' });
      for (let r = 1; r <= 5; r += 1) {
        const res = await h(postBody({ rating: r }, '10.0.1.' + r));
        if (res.statusCode !== 200) return false;
      }
      return store.rows.length === 5;
    }
  });

  /* 2. 0 分与 6 分被拒 */
  cases.push({
    name: '0 分与 6 分被拒',
    async run() {
      const store = makeStore();
      const h = createHandler({ store, adminKey: 'secret' });
      const r0 = await h(postBody({ rating: 0 }, '10.0.2.1'));
      const r6 = await h(postBody({ rating: 6 }, '10.0.2.2'));
      return r0.statusCode === 400 && r6.statusCode === 400 && store.rows.length === 0;
    }
  });

  /* 3. text 超 300 截断、tags 超 5 截断、单项 ≤20 */
  cases.push({
    name: 'text 与 tags 截断',
    async run() {
      const store = makeStore();
      const h = createHandler({ store, adminKey: 'secret' });
      await h(postBody({
        rating: 3,
        text: 'x'.repeat(400),
        tags: ['a'.repeat(30), 'b', 'c', 'd', 'e', 'f', 'g']
      }, '10.0.3.1'));
      const row = store.rows[0];
      return row.text.length === 300 && row.tags.length === 5 && row.tags[0].length === 20;
    }
  });

  /* 4. 后台 HTML 含统计与 Top5 */
  cases.push({
    name: '后台页含统计与低分 Top5',
    async run() {
      const store = makeStore();
      const h = createHandler({ store, adminKey: 'secret' });
      await h(postBody({ rating: 1, context: { top: { name: 'A' } } }, '10.0.4.1'));
      await h(postBody({ rating: 2, context: { top: { name: 'A' } } }, '10.0.4.2'));
      await h(postBody({ rating: 5, context: { top: { name: 'B' } } }, '10.0.4.3'));

      const res = await h(ev('GET', '/api/feedback/list', { queryStringParameters: { key: 'secret' } }));
      const body = res.body || '';
      return res.statusCode === 200 &&
        body.indexOf('评分分布') !== -1 &&
        body.indexOf('低分病症 Top5') !== -1 &&
        body.indexOf('共 3 条') !== -1 &&
        body.indexOf('已改进') !== -1;
    }
  });

  /* 5. 错误 key 返回 401 */
  cases.push({
    name: '错误 key 返回 401',
    async run() {
      const store = makeStore();
      const h = createHandler({ store, adminKey: 'secret' });
      const res = await h(ev('GET', '/api/feedback/list', { queryStringParameters: { key: 'wrong' } }));
      return res.statusCode === 401;
    }
  });

  /* 6. 未配置 ADMIN_KEY 返回 401 */
  cases.push({
    name: '未配置 ADMIN_KEY 返回 401',
    async run() {
      const saved = process.env.ADMIN_KEY;
      delete process.env.ADMIN_KEY;
      const h = createHandler({ store: makeStore() });
      const res = await h(ev('GET', '/api/feedback/list', { queryStringParameters: { key: 'anything' } }));
      if (saved !== undefined) process.env.ADMIN_KEY = saved;
      return res.statusCode === 401;
    }
  });

  /* 7. 聚合数值正确 */
  cases.push({
    name: '低分数量/总数/均分正确',
    async run() {
      const s = summarizeFeedback([
        { rating: 1, context: { top: { name: 'A' } } },
        { rating: 2, context: { top: { name: 'A' } } },
        { rating: 5, context: { top: { name: 'B' } } }
      ]);
      return s.total === 3 &&
        Math.abs(s.avg - 2.67) < 0.01 &&
        s.lowTop.length === 1 &&
        s.lowTop[0].name === 'A' &&
        s.lowTop[0].low === 2 &&
        s.lowTop[0].total === 2 &&
        s.lowTop[0].avg === 1.5;
    }
  });

  /* 8. 同一 IP 每分钟超过 5 条触发 429 */
  cases.push({
    name: '限流每分钟 5 条',
    async run() {
      const store = makeStore();
      const h = createHandler({ store, adminKey: 'secret' });
      let last = null;
      for (let i = 0; i < 6; i += 1) {
        last = await h(postBody({ rating: 4 }, '9.9.9.9'));
      }
      return last.statusCode === 429 && store.rows.length === 5;
    }
  });

  /* 9. 标记已改进（表单 → 303 并写入） */
  cases.push({
    name: '标记已改进并写入说明',
    async run() {
      const store = makeStore();
      const h = createHandler({ store, adminKey: 'secret' });
      const created = await h(postBody({ rating: 2 }, '10.0.5.1'));
      const id = JSON.parse(created.body).id;

      const res = await h(ev('POST', '/api/feedback/status', {
        queryStringParameters: { key: 'secret' },
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'id=' + encodeURIComponent(id) + '&status=improved&note=' + encodeURIComponent('已修')
      }));
      const row = store.rows[0];
      return res.statusCode === 303 && row.status === 'improved' && row.improveNote === '已修';
    }
  });

  /* 10. 未知路径 404 */
  cases.push({
    name: '未知路径返回 404',
    async run() {
      const h = createHandler({ store: makeStore(), adminKey: 'secret' });
      const res = await h(ev('GET', '/unknown'));
      return res.statusCode === 404;
    }
  });

  let passed = 0;
  const failures = [];
  for (const c of cases) {
    let ok = false;
    try {
      ok = !!(await c.run());
    } catch (e) {
      failures.push(c.name + ' → 抛错：' + e.message);
      continue;
    }
    if (ok) passed += 1;
    else failures.push(c.name);
  }

  if (failures.length) {
    console.error('失败用例：\n  ' + failures.join('\n  '));
  }
  console.log('用例 ' + passed + '/' + cases.length + ' 通过');
  process.exit(failures.length ? 1 : 0);
})();