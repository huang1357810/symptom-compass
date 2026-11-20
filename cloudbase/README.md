# 腾讯云 CloudBase 部署（国内可直连）

Cloudflare 的 `workers.dev` 在国内可能打不开。本目录提供一套 **CloudBase 静态托管 + 云函数** 方案，在保留原 Cloudflare 方案的前提下给国内环境一个可用入口。

- 前端：`site/`（纯静态，零构建）
- 后端：`functions/feedback/`（反馈提交、后台汇总页、标记已改进）
- 配置：`cloudbaserc.json`（环境 ID 用 `${ENV_ID}` 占位）

## 目录

```
cloudbase/
├── cloudbaserc.json
├── README.md
└── functions/
    └── feedback/
        ├── index.js        路由：/api/feedback、/api/feedback/list、/api/feedback/status
        ├── stats.js        评分分布与低分病症 Top5
        └── package.json    依赖 @cloudbase/node-sdk
```

## 5 步部署

### 1) 新建 CloudBase 环境

控制台 → 云开发 CloudBase → 新建环境（免费版即可），记下 **环境 ID**。

### 2) 上传静态站点

本地执行：

```bash
node tools/pack-cloudbase.js
```

生成 `dist-cloudbase.zip` → 控制台「静态网站托管」→ 上传并解压到根目录。
默认访问域名形如 `https://<env-id>.tcloudbaseapp.com`。

### 3) 部署 feedback 云函数

1. 云开发控制台 → 数据库 → 新建集合 `feedback`，权限选「仅管理端可读写」；
2. 云函数 → 新建函数，名称 `feedback`，运行环境选 **Nodejs16.13**（或 Nodejs18.15）；
3. 上传 `cloudbase/functions/feedback/` 整个目录，勾选「上传并安装依赖」；
4. 或用 CLI：`cloudbase functions:deploy feedback --envId <env-id>`。

### 4) 配置 HTTP 访问服务

云函数 → `feedback` → HTTP 访问服务 → 添加路径 `/api`（指向该函数）。
函数内部会按 `/api/feedback`、`/api/feedback/list`、`/api/feedback/status` 路由。

### 5) 设置 ADMIN_KEY 与前端接口地址

- 云函数 → 配置 → 环境变量：添加 `ADMIN_KEY`，值用一串随机字符；
- 浏览器打开 `https://<env-id>.tcloudbaseapp.com/api/feedback/list?key=<ADMIN_KEY>` 即为后台汇总页；
- 前端把 `site/config.example.js` 复制为 `site/config.js`，把地址改成：
  `https://<env-id>.tcloudbaseapp.com/api/feedback`，然后重新上传 `config.js` 到静态托管。
  （`index.html` 已预留 `config.js` 引用，不需要改代码。）

## 后台页包含

- 统计行：共 N 条 / 平均分 / 待改进 / 已改进
- 评分分布（1–5 星条形图）
- 低分病症 Top5（1–2 星按病症聚合：低分数、总数、均分）
- 明细表（时间 / 评分 / 标签 / 建议 / 对应病症 / 改进 / 操作）
- 行内「标记已改进 + 改进说明」表单

## 本地自测

```bash
node tools/test-cloudbase-fn.js
```

不依赖真实云环境：用假 store 调用 `createHandler`，覆盖评分校验、截断、限流、后台 HTML、鉴权与聚合。

## 常见问题

| 现象 | 原因 |
| --- | --- |
| 后台返回 401 | 未设置 `ADMIN_KEY`，或 URL 里的 key 不匹配 |
| 提交返回 429 | 同一 IP 每分钟超过 5 条 |
| 提交返回 404 | HTTP 访问服务路径没有指向 `feedback` 函数 |
| 控制台提示 `config.js` 404 | 尚未创建 config.js，属正常；页面会回退到同源 `/api/feedback` |
| 数据库报权限错误 | `feedback` 集合权限需设为「仅管理端可读写」，云函数以管理员身份读写 |

> 云函数只依赖 `@cloudbase/node-sdk`，不引入其他库；`@cloudbase/node-sdk` 仅在 `exports.main` 内加载，便于单测。