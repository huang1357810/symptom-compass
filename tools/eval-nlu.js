/*
 * NLU 对比评测：node tools/eval-nlu.js
 *
 * 数据分三层：A = direction-eval 100 条（症状名拼接）；B = 30 条手写口语（真实参考）；合计。
 * 方案：本地词表 / LLM / LLM+本地合并。
 *
 * 退出码：
 *   0 = 正常（无 key 也正常，LLM 列写「未覆盖（缺 key）」）
 *   1 = 有 key 但 401（key 无效或未开通模型）
 *   2 = 有 key 但超时/网络不可达
 *
 * 结果：docs/nlu-eval.md（含运行时间、模型名、费用估算）。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const RUN_AT = new Date().toISOString().slice(0, 19).replace('T', ' ');
const LLM_KEY = process.env.LLM_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat';
const PRICE_PER_1K = Number(process.env.LLM_PRICE_PER_1K);

const html = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(m[1] + '\n;globalThis.__out={parseSymptoms,SYMPTOMS};', sandbox, { timeout: 10000 });
const { parseSymptoms, SYMPTOMS } = sandbox.__out;

const COLLOQUIAL = [
  ['嗓子疼还有点烧', ['sore_throat', 'fever']],
  ['拉肚子拉水', ['diarrhea']],
  ['头疼得厉害还恶心', ['headache', 'nausea']],
  ['胸口闷喘不上气', ['chest_tight', 'dyspnea']],
  ['咳黄痰', ['sputum', 'dry_cough']],
  ['流鼻涕打喷嚏', ['runny_nose', 'sneeze']],
  ['胃疼反酸水', ['epigastric_pain', 'heartburn']],
  ['尿频尿急还疼', ['urinary_freq', 'dysuria']],
  ['腰侧一阵阵绞痛', ['flank_pain']],
  ['全身起风团很痒', ['hives', 'itch']],
  ['眼睛红有分泌物', ['eye_red', 'eye_discharge']],
  ['耳朵疼听不清', ['ear_pain', 'hearing_loss']],
  ['牙龈肿痛', ['toothache']],
  ['便秘好几天了', ['constipation']],
  ['脖子肩膀酸痛手麻', ['neck_pain', 'numbness']],
  ['关节红肿热痛', ['joint_swelling', 'joint_pain']],
  ['晚上睡不着心慌', ['insomnia', 'palpitation']],
  ['大便带血肛门疼', ['rectal_bleeding', 'anal_pain']],
  ['鼻塞流黄脓鼻涕', ['purulent_discharge', 'congestion']],
  ['嘴里起了溃疡', ['oral_ulcer']],
  ['脚趾缝脱皮痒', ['itch', 'dry_skin']],
  ['上腹烧灼感', ['epigastric_pain', 'heartburn']],
  ['手脚起疹子还发烧', ['hand_foot_rash', 'fever']],
  ['在太阳下晒久了头晕恶心', ['heat_exposure', 'dizziness', 'nausea']],
  ['胸闷压着疼', ['chest_wall_pain', 'chest_pain']],
  ['月经过后小腹坠痛', ['dysmenorrhea']],
  ['白带多还有味', ['vaginal_discharge']],
  ['浑身没劲脸色发白', ['fatigue', 'pallor']],
  ['咳了半个月还盗汗', ['dry_cough', 'night_sweat']],
  ['突然剧烈头痛像要炸开', ['thunderclap_headache']]
];

function loadDataset() {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'direction-eval.json'), 'utf8'));
  const a = data.map(item => ({
    group: 'A',
    text: item.input.symptoms.map(id => (SYMPTOMS[id] ? SYMPTOMS[id].label : id)).join('、'),
    gold: item.input.symptoms.slice()
  }));
  const b = COLLOQUIAL.map(x => ({ group: 'B', text: x[0], gold: x[1].slice() }));
  return a.concat(b);
}

function metrics(records) {
  let tp = 0, goldN = 0, predN = 0;
  records.forEach(r => {
    const g = new Set(r.gold), p = new Set(r.pred);
    goldN += g.size; predN += p.size;
    p.forEach(id => { if (g.has(id)) tp += 1; });
  });
  const recall = goldN ? tp / goldN : 0;
  const precision = predN ? tp / predN : 0;
  const f1 = (precision + recall) ? (2 * precision * recall) / (precision + recall) : 0;
  return { recall, falseRate: 1 - precision, f1, n: records.length };
}

const pct = v => (v * 100).toFixed(1) + '%';
const avg = (arr, key) => arr.length ? arr.reduce((s, x) => s + (x[key] || 0), 0) / arr.length : 0;

(async () => {
  const dataset = loadDataset();

  /* 本地词表 */
  const localRecords = dataset.map(d => {
    const t0 = process.hrtime.bigint();
    const pred = parseSymptoms(d.text).ids;
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    return { group: d.group, text: d.text, gold: d.gold, pred, ms };
  });

  /* LLM（仅当存在 key） */
  const llm = { covered: false, model: LLM_MODEL, calls: 0, errors: [], cost: 0, priced: false, tokens: 0 };
  let llmRecords = null;
  let mergedRecords = null;

  if (LLM_KEY) {
    llm.covered = true;
    const nlu = await import(pathToFileURL(path.join(ROOT, 'worker', 'nlu-llm.mjs')).href);
    const llmGw = await import(pathToFileURL(path.join(ROOT, 'worker', 'llm.mjs')).href);
    const env = {
      LLM_API_KEY: LLM_KEY,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
      LLM_MODEL: LLM_MODEL
    };
    llmRecords = [];
    for (const d of dataset) {
      const t0 = process.hrtime.bigint();
      let pred = [];
      let error = '';
      try {
        const r = await llmGw.callLLM(env, nlu.buildMessages(d.text));
        if (!r.ok) {
          error = r.error || 'http_error';
        } else {
          const content = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message
            ? String(r.data.choices[0].message.content || '') : '';
          let obj = null;
          try { obj = JSON.parse(content); } catch (e) { error = 'bad_json'; }
          if (obj && Array.isArray(obj.symptoms)) pred = nlu.pickWhitelist(obj.symptoms);
        }
      } catch (e) {
        error = 'network';
      }
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const tokens = d.text.length + JSON.stringify(pred).length;
      llm.calls += 1;
      llm.tokens += tokens;
      if (error) llm.errors.push(error);
      let costText = '费用未估算（未配置 LLM_PRICE_PER_1K）';
      if (!error && Number.isFinite(PRICE_PER_1K) && PRICE_PER_1K > 0) {
        const cost = (tokens / 1000) * PRICE_PER_1K;
        llm.cost += cost;
        llm.priced = true;
        costText = '费用≈' + cost.toFixed(5) + ' 元';
      }
      console.log('LLM ' + llm.calls + '/' + dataset.length + ' · ' + ms.toFixed(0) + 'ms · tokens≈' +
        tokens + ' · ' + (error ? '失败(' + error + ')' : costText));
      llmRecords.push({ group: d.group, text: d.text, gold: d.gold, pred, ms, error });
    }
    mergedRecords = dataset.map((d, i) => ({
      group: d.group,
      text: d.text,
      gold: d.gold,
      pred: Array.from(new Set(localRecords[i].pred.concat(llmRecords[i].pred))),
      ms: localRecords[i].ms + llmRecords[i].ms
    }));
  }

  const okCount = llmRecords ? llmRecords.filter(r => !r.error).length : 0;

  /* 分组统计 */
  const groups = ['A', 'B'];
  const stats = {
    local: { A: metrics(localRecords.filter(r => r.group === 'A')), B: metrics(localRecords.filter(r => r.group === 'B')), all: metrics(localRecords) },
    llm: llmRecords ? { A: metrics(llmRecords.filter(r => r.group === 'A')), B: metrics(llmRecords.filter(r => r.group === 'B')), all: metrics(llmRecords) } : null,
    merged: mergedRecords ? { A: metrics(mergedRecords.filter(r => r.group === 'A')), B: metrics(mergedRecords.filter(r => r.group === 'B')), all: metrics(mergedRecords) } : null
  };
  const delay = {
    local: {
      A: avg(localRecords.filter(r => r.group === 'A'), 'ms'),
      B: avg(localRecords.filter(r => r.group === 'B'), 'ms'),
      all: avg(localRecords, 'ms')
    },
    llm: llmRecords ? {
      A: avg(llmRecords.filter(r => r.group === 'A'), 'ms'),
      B: avg(llmRecords.filter(r => r.group === 'B'), 'ms'),
      all: avg(llmRecords, 'ms')
    } : null
  };

  const missing = '未覆盖（缺 key）';
  const line = (label, plan, s, ms) => s
    ? '| ' + label + ' | ' + plan + ' | ' + pct(s.recall) + ' | ' + pct(s.falseRate) + ' | ' +
      s.f1.toFixed(3) + ' | ' + ms.toFixed(2) + ' ms |'
    : '| ' + label + ' | ' + plan + ' | ' + missing + ' | ' + missing + ' | ' + missing + ' | ' + missing + ' |';

  const rows = [];
  const labels = {
    A: 'A · 症状名拼接（100）',
    B: 'B · 手写口语（30，真实参考）',
    all: '合计（130）'
  };
  ['A', 'B', 'all'].forEach(g => {
    const l = labels[g];
    rows.push(line(l, '本地', stats.local[g], delay.local[g]));
    rows.push(line(l, 'LLM', stats.llm ? stats.llm[g] : null, delay.llm ? delay.llm[g] : 0));
    rows.push(line(l, '合并', stats.merged ? stats.merged[g] : null, delay.llm ? delay.llm[g] : 0));
  });

  /* 本地错误分析 */
  const miss = [];
  const falsePos = [];
  localRecords.forEach(r => {
    const g = new Set(r.gold), p = new Set(r.pred);
    r.gold.forEach(id => { if (!p.has(id)) miss.push({ group: r.group, text: r.text, id }); });
    r.pred.forEach(id => { if (!g.has(id)) falsePos.push({ group: r.group, text: r.text, id }); });
  });
  const label = id => (SYMPTOMS[id] ? SYMPTOMS[id].label : id);

  const md = [
    '# NLU 症状抽取对比评测',
    '',
    '> 运行时间：' + RUN_AT + ' ｜ 模型：' + LLM_MODEL + ' ｜ LLM：' + (llm.covered ? (okCount ? '已实测' : '调用失败') : '未覆盖（缺 key）'),
    '> **组 A 由症状名拼接而成，会高估本地词表；组 B 才是真实参考。**',
    '> 评测脚本只在存在 `LLM_API_KEY` 时联网；CI 不调用真实模型。',
    '',
    '| 数据集 | 方案 | 召回 | 误抽 | F1 | 平均延迟 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '## LLM 调用信息',
    '',
    llm.covered
      ? '- 调用 ' + llm.calls + ' 次，成功 ' + okCount + ' 次，失败 ' + llm.errors.length + ' 次（' +
        (llm.errors.length ? llm.errors.slice(0, 5).join('、') : '无') + '）；tokens 估算 ≈ ' + Math.round(llm.tokens) +
        '；费用：' + (llm.priced ? '≈ ' + llm.cost.toFixed(4) + ' 元（按 LLM_PRICE_PER_1K 估算）' : '未配置单价，未估算')
      : '- 未覆盖（缺 key）：设置环境变量 `LLM_API_KEY` 后重跑本脚本。',
    '',
    '## 错误分析：漏抽（本地，前 10 条）',
    '',
    '| 组 | 文本 | 漏抽症状 |',
    '| --- | --- | --- |',
    ...miss.slice(0, 10).map(x => '| ' + x.group + ' | ' + x.text + ' | ' + label(x.id) + ' |'),
    '',
    '## 错误分析：误抽（本地，前 10 条）',
    '',
    '| 组 | 文本 | 误抽症状 |',
    '| --- | --- | --- |',
    ...falsePos.slice(0, 10).map(x => '| ' + x.group + ' | ' + x.text + ' | ' + label(x.id) + ' |'),
    '',
    '## 口径',
    '',
    '- 召回 = 抽中的 gold 症状数 / gold 总数；误抽 = 1 − 精确率；F1 为二者调和。',
    '- gold 为人工判定（评测集原有症状 + 手写条目的目标症状），非模型输出。',
    ''
  ].join('\n');

  fs.writeFileSync(path.join(ROOT, 'docs', 'nlu-eval.md'), md, 'utf8');

  console.log('本地：A 召回 ' + pct(stats.local.A.recall) + ' / B 召回 ' + pct(stats.local.B.recall) +
    ' / 合计 ' + pct(stats.local.all.recall) + '，F1 ' + stats.local.all.f1.toFixed(3));
  if (!llm.covered) {
    console.log('LLM 未覆盖（缺 key），保持 LLM_NLU_ENABLED=false');
  } else if (!okCount) {
    const has401 = llm.errors.some(e => e === 'http_401');
    const hasNet = llm.errors.some(e => e === 'timeout' || e === 'network');
    if (has401) {
      console.error('LLM 调用全部失败：key 无效或未开通模型（http_401）');
      console.error('已写入 docs/nlu-eval.md（记录失败）');
      process.exit(1);
    }
    if (hasNet) {
      console.error('LLM 调用全部失败：网络不可达（timeout/network）');
      console.error('已写入 docs/nlu-eval.md（记录失败）');
      process.exit(2);
    }
  }
  console.log('已写入 docs/nlu-eval.md');
})();