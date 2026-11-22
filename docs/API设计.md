# 明辨康途 · API 设计

> 文档版本：v2.10 ｜ 最后更新：2026-11-22 ｜ 对应内容版本：v1

## 接口总览

| 方法 | 路径 | 部署位置 | 鉴权 | 说明 |
| --- | --- | --- | --- | --- |
| POST | `/api/triage` | FunctionGraph | 无 | 可选云端分诊（前端未启用时走本地） |
| GET | `/api/triage/health` | FunctionGraph | 无 | 健康检查，用于判断是否启用云端分诊 |
| POST | `/api/feedback` | Cloudflare Worker | 无 | 提交结果反馈 |
| GET | `/api/feedback/list` | Cloudflare Worker | Header / key | 反馈汇总页（HTML） |
| POST | `/api/feedback/status` | Cloudflare Worker | Header / key | 标记已改进并填写修正版本 |
| GET | `/api/evals/latest` | Cloudflare Worker | 无 | 最近一次评测结果（JSON） |
| POST | `/api/evals/publish` | Cloudflare Worker | Header / key | 发布评测结果到 KV |
| POST | `/api/metrics/event` | Cloudflare Worker | 无 | 匿名运营事件（症状数 + 判红等级） |

> 当前只保留 Cloudflare Worker；腾讯云 CloudBase 方案已移除，相关文件不再在仓库中。

## 通用约定

- 请求/响应均为 UTF-8；JSON 接口返回 `Content-Type: application/json; charset=utf-8`。
- 反馈与统计接口允许跨域：`Access-Control-Allow-Origin: *`，方法 `GET, POST, OPTIONS`。
- 所有外发接口失败时，前端必须静默降级，不影响分诊。

### 管理鉴权

- **优先使用 Header**：`X-Admin-Key: <ADMIN_KEY>`
- **兼容 query**：`?key=<ADMIN_KEY>`，已 **deprecated**（后台页表单仍使用，便于直接打开链接）
- 密钥只放 Wrangler Secret（`wrangler secret put ADMIN_KEY`），不写入仓库；旧版明文密钥已轮换
- 未配置 `ADMIN_KEY` 或密钥不匹配：401

### 错误码

| 状态码 | 含义 | 典型场景 |
| --- | --- | --- |
| 400 | 参数错误 | rating 不在 1–5、事件字段非法、JSON 解析失败 |
| 401 | 未授权 | 管理密钥缺失或不匹配 |
| 404 | 不存在 | 反馈 id 找不到、未知路由 |
| 405 | 方法不允许 | GET 调 POST 接口 |
| 429 | 触发限流 | 同 IP 每分钟超过阈值 |
| 503 | 存储未配置 | 未绑定 `FEEDBACK_KV` |

---

## 1. POST /api/triage（FunctionGraph）

**请求**

```json
{ "symptoms": ["sore_throat", "fever"] }
```

**响应 200**

```json
{
  "mode": "cloud",
  "selected": ["sore_throat", "fever"],
  "flags": [],
  "results": [
    { "id": "pharyngitis", "name": "急性咽炎 / 扁桃体炎", "score": 0.5, "matched": ["sore_throat", "fever"] }
  ]
}
```

**错误**：400（JSON 非法 / symptoms 为空）、405（非 POST）。

---

## 2. POST /api/feedback（Worker / CloudBase）

**请求**

```json
{
  "rating": 4,
  "tags": ["不够准", "太笼统"],
  "text": "希望把病程问得更细",
  "page": "result",
  "contentVersion": "v1",
  "context": {
    "top": { "id": "pharyngitis", "name": "急性咽炎 / 扁桃体炎", "score": 50 },
    "results": [{ "id": "pharyngitis", "name": "急性咽炎 / 扁桃体炎", "score": 50 }],
    "symptoms": [{ "id": "sore_throat", "label": "咽痛" }],
    "triage": "yellow"
  }
}
```

**校验规则**

- `rating`：整数 1–5（0 或 6 → 400）。
- `tags`：最多 5 个，每个截断到 20 字。
- `text`：截断到 300 字。
- `page` / `contentVersion`：截断到 40 / 20 字。
- `context`：`results` 最多 3 条，`symptoms` 最多 20 个，字段截断。
- 限流：同 IP 每分钟最多 5 条（429）。

**响应 200**

```json
{ "ok": true, "id": "lq3k9z-a1b2c3" }
```

**存储字段**：`rating`、`tags`、`text`、`page`、`contentVersion`、`context`、`status`（open/improved）、`improveNote`、`fixedVersion`、`createdAt`/`ts`、`ua`、`ipHash`（仅哈希，用于限流）。

**错误**：400、429、503。

---

## 3. GET /api/feedback/list?key=ADMIN_KEY

**响应 200**：HTML 汇总页，包含：

- 统计行：共 N 条 / 平均分 / 待改进 / 已改进
- 评分分布（1–5 星条形图）
- 低分病症 Top5（1–2 星按病症聚合）
- 评测板块：判红率、误报数、最近运行时间
- 运营板块：今日查询量、判红率（红/黄/绿）
- 明细表：时间 / 评分 / 标签 / 建议 / 对应病症 / **内容版本** / 改进（含修正版本）/ 操作
- 行内标记表单：`status`、`fixedVersion`、`note`

**错误**：401（无/错 key）、503（未配置 KV）。

## 4. POST /api/feedback/status?key=ADMIN_KEY

**请求（表单）**

```
id=<反馈 id>&status=improved&fixedVersion=v1&note=已补充病程判断
```

**行为**

- `status=improved` 时写入 `fixedVersion`（缺省取该反馈的 `contentVersion`）。
- 成功后 303 重定向回 `/api/feedback/list?key=`。

**错误**：400（缺 id）、401、404（id 不存在）、503。

---

## 5. GET /api/evals/latest（Worker）

**响应 200（JSON）**

```json
{
  "version": "eval-v2",
  "generatedAt": "2026-11-22",
  "total": 18,
  "red": 18,
  "redRate": 1,
  "negatives": 8,
  "falsePositive": 0,
  "falsePositiveRate": 0,
  "caseTotal": 42,
  "categories": [
    { "id": "redflags", "label": "危险信号", "total": 18, "pass": 18, "red": 18, "fp": 0 },
    { "id": "weighted", "label": "问卷加权", "total": 8, "pass": 8, "red": 1, "fp": 0 }
  ],
  "cases": [{ "title": "胸痛", "input": "胸痛", "level": "red", "ok": true }],
  "negativeCases": [{ "input": "乏力", "level": "yellow", "falsePositive": false }],
  "weightedCases": [{ "name": "高热 + 卧床", "score": { "duration": 0, "fever": 3, "activity": 2 }, "expect": "yellow", "level": "yellow", "ok": true }],
  "ageCases": [{ "name": "6 个月发热", "age": 0.5, "expect": "red", "level": "red", "ok": true }],
  "medsCases": [{ "name": "18 岁以下 + 阿司匹林", "expect": "red", "hits": 2, "ok": true }]
}
```

**数据来源**：KV `evals:latest` 优先；未发布时返回打包内置的 `worker/evals-seed.json`。

## 6. POST /api/evals/publish?key=ADMIN_KEY（Worker）

**请求**：与 `/api/evals/latest` 响应同结构的 JSON。

**服务端校验**（`worker/evals-schema.mjs`）：`version` 为非空字符串且 ≤40 字符；`total`、`red`、`negatives`、`falsePositive` 为非负整数；`red ≤ total`。任一项不满足返回 400。

**响应 200**：`{ "ok": true }`

**错误**：400（schema 不合法）、401、503。

---

## 7. POST /api/metrics/event（Worker）

**请求**

```json
{ "symptomCount": 3, "level": "yellow" }
```

**规则**

- `symptomCount`：整数 0–40。
- `level`：`red` / `yellow` / `green`。
- **不含**症状名称、方向、年龄、用药、照片或任何身份信息。
- 服务端按天累加：`metrics:YYYY-MM-DD` → `{ total, red, yellow, green }`，保留 90 天。
- 限流：同 IP 每分钟最多 60 条（429）。

**响应 200**：`{ "ok": true }`

**错误**：400、429、503（前端应静默忽略）。

---

## 隐私与数据边界

| 数据 | 是否外发 | 说明 |
| --- | --- | --- |
| 反馈评分/标签/建议/方向/症状名 | 是（用户主动） | 关联病症与改进闭环 |
| 匿名统计（症状数量、判红等级） | 是（自动、匿名） | 仅日聚合计数 |
| 年龄 / 长期用药 | 否 | 只在本机参与分诊与用药提示 |
| 照片 | 否 | 浏览器内分析，不上传不保存 |
| 档案 / 时间轴 / 自由输入原文 | 否 | 本机 localStorage |

详见 `site/privacy.html`。