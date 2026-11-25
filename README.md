# 明辨康途

[![CI](https://github.com/huang1357810/symptom-compass/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/huang1357810/symptom-compass/actions/workflows/ci.yml)

一个纯前端的健康科普小工具：勾选症状 → 按吻合度给出可能的方向 → 每个方向附自我照护、常用药物（通用名 + 注意事项）、何时必须就医，并对危险信号做强制拦截。

- 线上地址：<https://mingbian-kangtu.huang-1357810.workers.dev>（Cloudflare Workers）
- 版本：v2.10.0
- 零依赖、零构建：核心分诊就是一个 `index.html`；反馈、评测、匿名账号是可选后端能力，不可用时自动降级
- 匿名账号（可选）：仅用于把反馈归属到同一匿名标识；不收集手机号、邮箱、真实姓名，健康档案仍只存本机
- 所有分诊计算在浏览器本地完成，**不上传症状、年龄、用药等健康数据**
- 天气健康提示（可选）：输入城市查看高温 / 寒冷 / 空气质量 / 流感季 / 闷热提醒，可一键勾选相关症状（只发送城市名，失败自动隐藏）

## 接入大模型（可选）

症状抽取默认走本地词表；只有显式开启灰度时才调用模型，且只做「一句话 → 症状 id 数组」，不输出病名、建议或剂量，失败自动回退本地。

Worker 变量：

- `LLM_API_KEY`（secret）、`LLM_BASE_URL`、`LLM_MODEL`
- 支持的 OpenAI 兼容服务：

| 厂商 | Base URL | 模型示例 |
| --- | --- | --- |
| 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-turbo` / `qwen-plus` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 智谱 | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |

本地评测（PowerShell，运行后清理 key）：

```powershell
$env:LLM_API_KEY = Read-Host "粘贴 API Key"
$env:LLM_MODEL = "deepseek-chat"
$env:LLM_BASE_URL = "https://api.deepseek.com/v1"
$env:LLM_PRICE_PER_1K = "0.001"   # 可选：按控制台单价填；不填则费用显示「未估算」
node tools/eval-nlu.js
Remove-Item Env:LLM_API_KEY
Remove-Item Env:LLM_MODEL
Remove-Item Env:LLM_BASE_URL
Remove-Item Env:LLM_PRICE_PER_1K
```

`eval-nlu.js` 退出码：**0** 正常（无 key 也返回 0，LLM 列写「未覆盖（缺 key）」）；**1** key 无效或未开通模型；**2** 超时/网络不可达。

开启与回退：

- 开启：`wrangler.jsonc` 的 `vars` 加 `"LLM_NLU_ENABLED": "true"`，并 `npx wrangler secret put LLM_API_KEY` 后部署。
- 回退：把 `LLM_NLU_ENABLED` 设为 `false` 或删除；即使开启，超时/无 key/坏 JSON 也会自动回退本地 `parseSymptoms`，功能不降级。
- ⚠️ 开启前必须先在 `privacy.html` 说明「你输入的一句话会发送给模型服务商」并取得同意。

> ⚠️ 这是一个科普工具，不是诊断工具。它不能替代医生面诊，也不能用于自我确诊或自行用药决策。

---

## 目录结构

```
symptom-checker/
├── README.md                本文件
├── site/
│   ├── index.html           Web 版：整个应用（HTML + CSS + JS + 数据）
│   ├── privacy.html         隐私与数据说明（本机存储、上传字段、删除方式）

│   └── preview.png          分享卡片图（og:image）
├── harmony/                 HarmonyOS 版（ArkTS + ArkUI，参加华为开发者大赛用）
│   ├── README.md            鸿蒙端说明：环境、打开方式、已知问题
│   ├── AppScope/            应用级配置与图标
│   └── entry/src/main/ets/
│       ├── common/Data.ets  ⚠️ 自动生成，勿手改
│       ├── common/Triage.ets 分诊逻辑（纯函数）
│       └── pages/Index.ets  全部界面
├── cloud/                   华为云版（FunctionGraph 同时托管页面 + 分诊 API）
│   ├── README.md            部署步骤、验收清单、常见问题
│   ├── functiongraph/       函数代码（index.js / logic.js / index.html）
│   ├── symptom-triage-function.zip  可直传函数的上传包
│   └── local-server.js      本地模拟云端，无需账号即可验证

├── deploy/                  CodeArts 流水线部署到 ECS
│   ├── README.md            CodeArts 逐步操作（Repo → Build → Deploy）
│   ├── nginx-symptom.conf   Nginx 配置（8080 端口，免备案）
│   └── deploy.sh            ECS 上的部署脚本（备份 + 解包 + 重载）
├── tools/
│   ├── gen-harmony-data.js  Web 数据 → Data.ets 生成器（含校验）
│   ├── gen-cloud-logic.js   Web 数据 → 云函数 logic.js 生成器
│   ├── run-evals.js         评测跑批：生成 docs/evals-latest.json 与 worker/evals-seed.json
│   ├── test-backend.js      后端可展示能力自测（文档/评测/接口/匿名）
│   ├── test-nlu.js          自然语言识别自测（node tools/test-nlu.js）
│   ├── test-profile.js      用户档案提醒规则自测（node tools/test-profile.js）
│   ├── test-bodymap.js      人体部位图自测（node tools/test-bodymap.js）
│   ├── test-redflags.js     危险信号评测（生成 docs/危险信号评测表.md）
│   ├── test-privacy.js      隐私页与入口/缓存校验
│   ├── test-content-meta.js 内容来源/审核字段三端一致性
│   ├── test-regression.js   8 个典型输入的症状 id 与 top1 回归
│   ├── test-weather-tips.js 天气健康提示规则（假响应）与点击勾选症状
│   ├── test-drugs-meta.js   药品来源/核对字段校验（生成 docs/药品核对表.md）
│   ├── add-content-meta.js  为疾病批量补来源/审核字段（可重复执行）

├── docs/
│   ├── 架构图.md            三层结构 / 数据流 / 部署拓扑（Mermaid）
│   ├── API设计.md           所有接口、参数、错误码与隐私边界
│   ├── evals-latest.json    评测产物（19/19 判红，48 条用例，0 误报）
│   ├── 药品核对表.md        药名库来源/核对状态（NMPA 列待人工填写）
│   └── 危险信号评测表.md    人读表格版评测结果
├── serve-site.js            本地静态服务器（预览用，Node 自带模块，无依赖）
└── 启动公网地址.ps1          备用：临时公网隧道（Windows）
```

## 三个版本

| | Web 版 `site/` | HarmonyOS 版 `harmony/` | 华为云版 `cloud/` |
| --- | --- | --- | --- |
| 用途 | 快速演示、分享链接 | 参赛演示、应用市场 | 满足「必须使用华为云」 |
| 形态 | 静态网页 | 原生 App | 云函数托管整站 |
| 数据 | 手写于 `index.html` | 由生成器产出 | 由生成器从页面抽取 |
| 分诊计算 | 浏览器本地（可切华为云 FunctionGraph） | App 本地 | 云函数（失败自动回退本地） |
| 分诊分级 | 红 / 黄 / 绿 三级 + 三个追问 | 红 / 黄 / 绿 三级 + 三个追问 | 返回结果与危险信号，分级由前端完成 |
| 离线 | PWA，可添加到主屏幕 | 原生离线 | 依赖网络（页面已缓存） |

**改内容只改 Web 版数据源，然后 `node tools/gen-harmony-data.js` 重新生成**，两端不会不同步。

## 本地运行

方式一：直接双击 `site/index.html`，用浏览器打开即可。
（全部逻辑都在本地，`file://` 协议下也能正常工作。）

方式二：起一个本地服务器（推荐，行为与线上一致）：

```bash
node serve-site.js
# 打开 http://127.0.0.1:8090
```

`serve-site.js` 只用 Node 内置模块，不需要 `npm install`。

## 技术栈

| 项目 | 说明 |
| --- | --- |
| 语言 | 原生 HTML5 / CSS3 / ES2017 JavaScript |
| 框架 | 无 |
| 依赖 | 无（字体用系统字体栈，图标是内联 SVG / data URI） |
| 构建 | 无，改完保存刷新即可 |
| 存储 | 无后端；分享链接通过 URL hash 携带症状，不经过服务器 |

## 代码结构

`site/index.html` 里分为三层，顺序阅读即可：

```
<style>      设计变量 → 布局 → 组件 → 响应式（@media 640px）
<body>       骨架：hero / 说明 / 症状选择 / 结果页 / 页脚
<script>
  ├─ 数据层    GROUPS、SYMPTOMS、CONDITIONS、RED_FLAGS、PRESETS
  ├─ 自然语言  SYMPTOM_ALIASES、parseSymptoms()
  ├─ 逻辑层    flagsFor()、scoreConditions()、gradeOf()
  └─ 视图层    init()、renderGroups()、toggle()、applyParsed()、showResults()、renderCondition()
```

逻辑层是纯函数，不碰 DOM，方便单测（例如用 Node 直接 `require` 抽取出的脚本）。

## 数据模型

### 症状 SYMPTOMS

```js
const SYMPTOMS = {
  sore_throat: { label: '咽痛', group: '头面' },
  //  key          显示文案    分组（对应 GROUPS 数组）
};
```

`key` 是全局唯一 id，被疾病和危险信号引用。

### 疾病 CONDITIONS

```js
{
  id: 'pharyngitis',
  name: '急性咽炎 / 扁桃体炎',
  dept: '耳鼻喉科',          // 建议就诊科室
  tag: '',                   // 可选角标，如「最常见」「需就医」
  summary: '一句话概述',
  symptoms: {                // 症状 → 权重（0~1，越典型越高）
    sore_throat: 1,
    dysphagia: 0.7,
    fever: 0.6
  },
  core: ['sore_throat'],     // 核心症状：命中任一项才算「可能相关」
  care: ['自我照护要点', '...'],
  meds: [                    // 只写通用名 + 注意事项，不写剂量
    { n: '对乙酰氨基酚 / 布洛芬', note: '缓解咽痛和发热，饭后服用' }
  ],
  see: '什么情况下必须就医'
}
```

### 危险信号 RED_FLAGS

```js
{
  ids: ['stiff_neck', 'high_fever'],  // 涉及的症状
  mode: 'all',                        // 'all' = 同时具备；默认 'any' = 任一即可
  title: '高热 + 颈部僵硬',
  msg: '需警惕脑膜炎，请立即急诊。'
}
```

命中后结果页顶部弹出红色提示，并把疾病列表收进折叠区（避免与急症提示冲突）。

## 匹配算法

`scoreConditions(selected)` 的规则：

1. **得分** = 命中症状的权重之和 ÷ 该疾病全部症状权重之和，范围 0~1
2. **核心症状**：`core` 里命中任意一条，才允许进入结果（防止「乏力」单独匹配到贫血这种弱关联）
3. **最少命中数**：已选症状 ≥ 3 时要求至少命中 2 条，否则 1 条即可
4. **门槛**：得分 < 0.18 直接丢弃；`core` 未命中时要求得分 ≥ 0.5
5. 按得分降序、命中数降序，取前 8 条
6. 展示为百分比，并标注「吻合度较高 / 中等 / 较低」——**这是启发式排序，不是概率**

调整建议：想让某疾病更容易出现，提高其典型症状权重并加进 `core`；想让它更少见，降低权重或去掉 `core`。

## 自然语言输入

症状区顶部有一个输入框，可以直接描述，例如「昨天开始发烧 38 度，嗓子疼还流鼻涕」。停笔约 0.5 秒后自动识别并勾选对应症状，也可以点「识别」或按 `Ctrl+Enter` 立即触发。

- **完全本地**：只在浏览器内做词典匹配，描述文字不会离开设备
- **词典**：每个症状在 `SYMPTOM_ALIASES` 里列出口语说法，`label` 本身也参与匹配；新增症状时记得补别名
- **匹配顺序**：长词组优先、互不重叠；命中位置前出现「没有 / 不 / 未 / 无」等否定词时跳过（「不发烧」不会勾上发热）
- **体温**：文字里出现「38 度」「39℃」时按数值补判发热或高热
- **归并**：高热自动带上发热，剧烈腹痛带上腹痛，关节红肿带上关节痛；有痰时不再算干咳
- **增量**：识别是在已勾选的基础上合并；自动勾选的项在描述改动后会撤回，手动点过的项不会被自动清除
- **搜索**：搜索框同样走别名表，输入「闹肚子」「窜稀」也能筛出「腹泻」
- **方言**：词表专门收了口语与方言说法（跑肚、打摆子、脑壳疼、大姨妈疼等），见 `EXTRA_ALIASES`

识别不全时仍可手动勾选或用搜索框过滤。自测：`node tools/test-nlu.js`（检查词表覆盖与 19 条常见说法）。该功能目前只在 Web 版，鸿蒙端尚未同步。

## 人体部位图

症状区里有一张内联 SVG 人体图（正面 / 背面可切换），在容易出问题的部位打了可点圆点，用来弥补「描述不出位置」的情况。

- 点部位后，右侧列出该处常见的不适，可以直接多选，和下方分组选择完全同步
- 圆点本身也会高亮：该部位只要有一个症状被选中，点位就变成实心
- 头顶、左右手臂、腿等同一部位有多个点位，点哪个效果一样
- 「全身 / 皮肤不适」按钮覆盖皮疹、发热、乏力等不好定位的表现
- 纯 SVG + CSS 实现，不引入任何 3D 库或模型文件，离线可用

数据在 `BODY_PARTS` 中维护：每组写明 `id`、`label`、`view`（front / back / all）和 `groups`（分组名 + 症状 id）。新增点位时，同时在该部位对应的 SVG 里加 `data-part="部位id"`。自测：`node tools/test-bodymap.js`。

## 用户档案与提醒

右上角「我的档案」会把每次查看结果记在本机 `localStorage`（键名 `mingbian.profile.v1`），不联网、不上传。

- **就医提醒**：同一个可能方向在 3 天内被查看 3 次，页面顶部会提示「建议去医院让医生当面看一下」
- **康复关心**：某个方向超过 7 天没再查看，会问一句是否已经好转
- **通知**：默认只在页面内显示；在档案里点「开启浏览器通知」后，打开页面时会额外发一条系统通知。纯前端无法在关闭页面后定时推送
- **控制**：点「知道了」「这个方向不再提醒」会记到本机；档案里可一键清除全部记录
- 同一组症状 10 分钟内重复查看只记一次，历史最多保留 200 条，超出后丢弃最早的

规则常量集中在 `PROFILE_RULES`（`days` / `times` / `careDays`），自测：`node tools/test-profile.js`。

## PWA 安装引导

- 浏览器触发 `beforeinstallprompt` 时，页面顶部出现「装到桌面，离线也能用」引导条；点「添加到桌面」直接拉起安装
- iOS Safari 不触发该事件，改为展开文字指引（分享 → 添加到主屏幕）
- 已安装（standalone）或点过「不再提示」（`mingbian.pwa.dismissed`）后不再出现
- `file://` 直接打开时与 Service Worker 一样跳过
- 自测：`node tools/test-pwa.js`

## 结果反馈与统计

结果页底部可给本次分析打分（1–5 星）、选标签、写建议，提交时附带本次 Top3 方向与症状名称（不含年龄、用药、照片）。

- 提交到 `POST /api/feedback`（Cloudflare Worker + KV）；未配置后端时降级为本地保存
- 本地记录在 `mingbian.feedback.v1`，「我的档案」可查看最近反馈与改进状态
- 管理端 `/api/feedback/list?key=ADMIN_KEY` 汇总页包含：
  - **评分分布**条形图（1–5 星数量与占比）
  - **低分病症 Top5**（1–2 星按病症聚合，含低分数、总数、均分）
  - 每条反馈的对应病症、改进状态与标记操作
- 统计逻辑在 `worker/feedback-stats.mjs`；自测：`node tools/test-feedback-stats.js`

## 如何新增一种疾病

1. 在 `CONDITIONS` 数组里加一个对象（照抄任意一条改）
2. 确保 `symptoms` 里的每个 key 都在 `SYMPTOMS` 中已存在（否则该症状会被静默忽略）
3. 填齐 `care`、`meds`、`see` —— 缺一项 UI 会留空白
4. 刷新页面即可，无需构建

> 提交前建议跑一遍校验：检查所有引用的症状 id 是否存在、`core` 是否都在 `symptoms` 里。仓库里没有内置测试，可以用 Node 把 `<script>` 抽出来 `require` 后遍历校验。

## 如何修改样式

所有视觉变量集中在 `<style>` 顶部的 `:root`：

```css
--teal: #0e8f86;   /* 主色 */
--ink: #0f2e30;    /* 正文 */
--line: #e2eeec;   /* 分隔线 */
```

响应式断点只有一个：`@media (max-width: 640px)`。

## 部署

当前线上：**Cloudflare Workers** — <https://mingbian-kangtu.huang-1357810.workers.dev>

- Worker 同时托管 `site/` 静态资源与 `/api/*`（反馈、评测、匿名统计）
- 更新：`npx wrangler deploy`；改了 `site/` 后需要重新部署
- 需要独立部署时，`site/` 也可作为纯静态站点上传（GitHub Pages / OSS），但 `/api/*` 仍需要 Worker

历史方案（仅保留说明，不作为当前线上）：Netlify 站点 `symptom-self-check`，详见 `docs/部署说明.md`。

### 管理密钥（已改为 Secret）

- 仓库不再保存明文密钥；部署前执行：`wrangler secret put ADMIN_KEY`
- 生成建议：`openssl rand -hex 32`（32 位以上随机串），不要复用旧值
- **旧版明文 ADMIN_KEY 已轮换**，如仍在使用请立即更换
- 后台访问：Header `X-Admin-Key` 优先；`?key=` 兼容但已 deprecated

### 版本

- 当前版本：**v2.10.0**（见 `package.json`）；由 `npm run build` 统一注入四端，发布前不要再手改
- 腾讯云 CloudBase 方案已移除（相关目录与打包脚本不再包含）

## 隐私与数据说明

独立页面 `site/privacy.html`，页脚与「我的档案」都有入口，离线也可访问（Service Worker 已预缓存）。

内容覆盖：

- **本机存储**：`mingbian.profile.v1` / `mingbian.timeline.v1` / `mingbian.feedback.v1` / `mingbian.pwa.dismissed` 各存什么、怎么删
- **仅反馈会上传**：评分、标签、建议文字、本次 Top3 方向与症状名称、UA；IP 只存哈希用于限流
- **明确不上传**：照片、年龄、长期用药、档案、时间轴、自由描述
- **第三方与保留期**、未成年人提示、医疗边界、联系方式与更新日期

自测：`node tools/test-privacy.js`（校验章节、入口、SW 缓存与云端副本）。

## 危险信号评测（进 CI）

`tools/test-redflags.js` 从页面抽取 `RED_FLAGS` 与分诊函数，逐条验证「一票判红」并统计负样本误报：

- 20 条危险信号：19 条按 `mode` 组合触发，要求 `flagsFor` 命中且 `computeTriage` 返回 `red`；1 条为条件黄牌（发热超过 5 天）
- 4 组常见轻症负样本：要求不判红
- 结果自动写入 `docs/危险信号评测表.md`（固定内容，CI 重跑不产生 diff）

随 CI 的 `tools/test-*.js` 循环执行；当前结果：**19/19 判红，条件黄牌 1/1，负样本 0 误报**。

## 内容来源与审核

35 条疾病都带三个字段，结果卡片底部直接展示「来源 · 审核 · 更新」：

| 字段 | 含义 | 当前值 |
| --- | --- | --- |
| `source` | 内容依据 | 公开教材与诊疗指南综合整理（《内科学》《外科学》《皮肤性病学》等） |
| `reviewer` | 审核人/状态 | 明辨康途内容组（待执业医师复核）——诚实标注，不冒充已审核 |
| `updated` | 版本日期 | 2026-11-22 |

一条数据改三端：字段写在 `site/index.html` 的 `CONDITIONS` 里，`gen-harmony-data.js` 透传到 `Data.ets`，`gen-cloud-logic.js` 抽出的 `logic.js` 自动携带；`tools/test-content-meta.js` 校验三端一致。

新增疾病时按 `tools/add-content-meta.js` 的字段格式补齐（该脚本可重复执行，已有字段会跳过）。

## 后端可展示能力

不做定时推送与审核工作流，只做「能纠错、能召回、能证明」的展示层：

- **架构与接口文档**：`docs/架构图.md`（Mermaid 三层 + 数据流 + 部署拓扑）、`docs/API设计.md`（全部接口、入参出参、错误码）
- **评测跑批**：`node tools/run-evals.js` 跑 48 条用例（20 条危险信号含 1 条条件黄牌 + 8 组加权 + 4 条条件规则 + 3 条年龄分支 + 5 条用药冲突 + 8 组负样本），按类别汇总输出 `docs/evals-latest.json` 与 `worker/evals-seed.json`；CI 在自测后执行并校验产物已提交
- **评测展示**：`GET /api/evals/latest`（KV 优先、打包 seed 兜底）；`POST /api/evals/publish?key=` 可发布新结果；后台「评测」板块显示判红率、误报数、最近运行
- **版本闭环**：反馈记录带 `contentVersion`；后台明细表有「内容版本」列，标记已改进时可填 `fixedVersion`，显示为「已改进（v1）」
- **匿名运营**：`POST /api/metrics/event` 只收 `{ symptomCount, level }`，按日聚合为 `{ total, red, yellow, green }`；后台「运营」板块显示今日查询量与判红率；前端失败静默
- 自测：`node tools/test-backend.js`；全量 `tools/test-*.js` 仍全绿

> 匿名口径：运营事件不含症状名称、方向、身份；反馈只在用户主动提交时携带方向与症状名。详见 `site/privacy.html`。

## 已知限制

- 匹配是**启发式**的，基于人工设定的症状权重，不是临床预测模型
- 自然语言输入是本地词典匹配，常见口语说法可以识别；非常规表述可能漏识别，需要手动补充
- 内容以常见病为主，覆盖 35 种情况、84 个症状，不能覆盖复杂或罕见病
- 提醒依赖本机记录，只在下次打开页面时检查；换设备或清除浏览器数据后记录会丢失，纯前端也做不到后台定时推送
- 人体图是示意图，点位只能帮助定位大致区域，不能替代查体；同一部位可能对应多种情况
- 药物只给通用名与注意事项，**刻意不写剂量**——剂量必须由医生/药师按个体情况决定
- 匿名账号密码哈希使用 PBKDF2-SHA256，**默认 50,000 次迭代**（Cloudflare Workers 免费版 CPU 约 10ms/请求下的折中）
- 线上实测：**100,000 次迭代时注册请求 `cpuTimeMs` 约 107ms**
- Workers 付费版可通过环境变量 `AUTH_ITERATIONS` 调回 `100000`（取值夹在 10,000–300,000）；已有账号按**注册时记录的迭代数**校验，老记录没有该字段时按**旧默认 100,000** 校验，不受默认值变化影响

## 内容免责

本项目内容仅用于健康教育与就医参考，不构成诊断、处方或治疗方案。药物信息为常见通用名及一般性注意事项，具体品种、剂量、禁忌须以药品说明书和医生/药师意见为准。出现危险信号请立即就医或拨打 120。

## 许可

源码可自由使用、修改、二次分发。医学内容请自行请专业人员审核后再公开发布。
