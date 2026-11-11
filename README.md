# 症状自查助手

一个纯前端的健康科普小工具：勾选症状 → 按吻合度给出可能的方向 → 每个方向附自我照护、常用药物（通用名 + 注意事项）、何时必须就医，并对危险信号做强制拦截。

- 线上地址：<https://symptom-self-check.netlify.app>
- 零依赖、零构建、零后端：整个应用就是一个 `index.html`
- 所有计算在浏览器本地完成，**不收集、不上传任何用户数据**

> ⚠️ 这是一个科普工具，不是诊断工具。它不能替代医生面诊，也不能用于自我确诊或自行用药决策。

---

## 目录结构

```
symptom-checker/
├── README.md                本文件
├── site/
│   ├── index.html           Web 版：整个应用（HTML + CSS + JS + 数据）
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
│   └── gen-cloud-logic.js   Web 数据 → 云函数 logic.js 生成器
├── serve-site.js            本地静态服务器（预览用，Node 自带模块，无依赖）
└── 启动公网地址.ps1          备用：临时公网隧道（Windows）
```

## 三个版本

| | Web 版 `site/` | HarmonyOS 版 `harmony/` | 华为云版 `cloud/` |
| --- | --- | --- | --- |
| 用途 | 快速演示、分享链接 | 参赛演示、应用市场 | 满足「必须使用华为云」 |
| 形态 | 静态网页 | 原生 App | 云函数托管整站 |
| 数据 | 手写于 `index.html` | 由生成器产出 | 由生成器从页面抽取 |
| 分诊计算 | 浏览器本地 | App 本地 | 云函数（失败自动回退本地） |

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
  ├─ 逻辑层    flagsFor()、scoreConditions()、gradeOf()
  └─ 视图层    init()、renderGroups()、toggle()、showResults()、renderCondition()
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

把 `site/` 目录整个上传到任意静态托管即可（Netlify / Cloudflare Pages / GitHub Pages / OSS）。

本项目线上的部署方式：Netlify，站点名 `symptom-self-check`。
更新内容：把 `site/` 文件夹拖到 Netlify 的 Deploys 面板，几秒生效，网址不变。

## 已知限制

- 匹配是**启发式**的，基于人工设定的症状权重，不是临床预测模型
- 症状是预设列表，不支持自由文本的自然语言解析
- 内容以常见病为主，覆盖 28 种情况、73 个症状，不能覆盖复杂或罕见病
- 不做随访、不记录历史（每次打开都是新的，分享靠 URL hash）
- 药物只给通用名与注意事项，**刻意不写剂量**——剂量必须由医生/药师按个体情况决定

## 内容免责

本项目内容仅用于健康教育与就医参考，不构成诊断、处方或治疗方案。药物信息为常见通用名及一般性注意事项，具体品种、剂量、禁忌须以药品说明书和医生/药师意见为准。出现危险信号请立即就医或拨打 120。

## 许可

源码可自由使用、修改、二次分发。医学内容请自行请专业人员审核后再公开发布。
