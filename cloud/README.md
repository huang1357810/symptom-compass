# 华为云部署（FunctionGraph 版）

把「症状自查助手」完整部署到华为云：**云函数同时托管页面和分诊 API**，一个链接搞定，不需要服务器、不需要备案域名。

## 架构

```
浏览器
  │  https://xxxx.apig.cn-north-4.myhuaweicloud.com   （或函数 URL）
  ▼
API 网关 / 函数 URL
  │
  ▼
FunctionGraph（Node.js，入口 index.handler，内存 256MB）
  ├─ GET  /                     → 返回 index.html（整个前端）
  ├─ GET  /api/triage/health    → {"ok":true}，前端据此判断启用云端分诊
  └─ POST /api/triage           → 分诊计算，返回 results + flags
```

前端页面加载时会先探一次 `/api/triage/health`：

- 探测成功 → 结果页右上角显示蓝色 **「云端分析」**，所有计算走华为云函数
- 探测失败 → 自动回退本地计算，显示 **「本地分析」**，功能不受影响

这个设计的好处：**同一个 HTML 既能放在普通静态托管上跑，也能放在华为云上跑**，评审现场断网也不怕。

## 为什么不用 OBS 静态托管

| 问题 | 说明 |
| --- | --- |
| HTML 被强制下载 | 2022 年后创建的桶，通过 OBS 端点访问 HTML 会带 `Content-Disposition: attachment`，浏览器直接下载而不是渲染 |
| 默认端点没有 HTTPS | 只有 HTTP，浏览器提示不安全 |
| 要正常显示 | 必须绑自定义域名 + CDN + `Content-Disposition: inline` 响应头，而国内域名要 ICP 备案 |

FunctionGraph 没有这些问题：直接返回 `Content-Type: text/html`，函数 URL / APIG 调试域名自带 HTTPS，且不需要备案。

## 部署步骤

### 第 0 步：准备

- 华为云账号，已完成实名认证
- 包：`cloud/symptom-triage-function.zip`（37 KB，根目录三个文件：`index.js`、`logic.js`、`index.html`）

### 第 1 步：创建函数

进入 **函数工作流 FunctionGraph → 函数 → 创建函数**：

| 配置项 | 填什么 |
| --- | --- |
| 函数类型 | 优先选 **HTTP 函数**（能直接拿 URL）；没有该选项就选 **事件函数**，第 3 步加 API 网关触发器 |
| 函数名称 | `symptom-triage` |
| 运行时 | Node.js 18.x（没有就 16.x，代码不依赖新特性） |
| 函数入口 | `index.handler` |
| 内存 | 256 MB |
| 超时时间 | 30 秒 |
| 代码上传方式 | **上传 ZIP 文件** → 选 `symptom-triage-function.zip` |

> 注意：ZIP 解压后必须是 `index.js` 在**根目录**，不能是 `functiongraph/index.js`。本包已经处理好。

### 第 2 步：触发方式

**情况 A：选了 HTTP 函数**

创建后一般会直接给出一个访问地址（可能叫「函数 URL」或「HTTP 触发器」），形如：

```
https://<函数ID>.cn-north-4.functiongraph.huaweicloud.com
```

**情况 B：事件函数**

去 **API 网关 APIG** 建一个 API，或用函数的「触发器 → 创建触发器 → API 网关」：

| 配置项 | 填什么 |
| --- | --- |
| API 分组 | 新建一个（会分配一个调试域名，免备案） |
| 认证方式 | **NONE**（不能选 IAM，否则浏览器访问会 401） |
| 请求方法 | ANY（GET 和 POST 都要） |
| 后端超时 | 30 秒 |
| 请求路径 | `/` 并开启「透传」/ 匹配所有路径 |
| 响应 | 直接返回函数结果（不要套模板） |

得到的地址形如：

```
https://<分组ID>.apig.cn-north-4.myhuaweicloud.com
```

### 第 3 步：验证（关键，别跳过）

**① 健康检查**

```bash
curl https://<你的地址>/api/triage/health
```

应返回：

```json
{"ok":true,"service":"symptom-triage","version":"1.0.0","conditions":28,"symptoms":73}
```

如果这里不通，后面一定不通，先排查这一步（见文末「常见问题」）。

**② 分诊接口**

```bash
curl -X POST https://<你的地址>/api/triage \
  -H "Content-Type: application/json" \
  -d "{\"symptoms\":[\"sore_throat\",\"fever\"]}"
```

应返回 `results`（3 条，第一条「急性咽炎 / 扁桃体炎」）和 `flags`（空数组）。

**③ 页面**

浏览器打开 `https://<你的地址>/`，应看到首页。随便勾几个症状 → 查看可能情况 → 右上角出现蓝色 **「云端分析」** 即代表整条链路打通。

## 验收清单（对着比赛要求逐条勾）

- [ ] 公网地址可访问，HTTPS 正常
- [ ] 页面能加载，73 个症状正常显示
- [ ] 勾选症状 → 出结果 → 右上角显示「云端分析」
- [ ] 浏览器 F12 → Network 里能看到 `POST /api/triage` 请求，状态 200
- [ ] 胸痛 + 气短 → 红色拦截 + 「立即拨打 120」
- [ ] 手机浏览器也能打开
- [ ] 函数监控里能看到调用次数（评审问"真的跑在云上吗"时，这是证据）

## 成本

| 项目 | 费用 |
| --- | --- |
| FunctionGraph | 每月 100 万次调用 + 40 万 GB·秒免费额度（以官网为准），演示用量远低于额度 |
| APIG（若用） | 共享版有免费额度；超出后按调用次数计费 |
| 总 | 比赛演示基本 **0 元** |

没有请求就没有费用，函数实例空闲不收费。

## 常见问题

**Q1：`curl /api/triage/health` 返回 404 或 HTML？**

- 触发器路径没透传：请求 `/api/triage/health` 被改写成 `/`，函数只拿到 `/`
- 解决：APIG 里把「请求路径」设为匹配所有（`/{proxy+}` 或透传），或直接改用 HTTP 函数

**Q2：返回 401 / 403？**

APIG 认证方式选了 IAM。改成 **NONE**。

**Q3：返回 502 / 超时？**

- 函数入口写错：必须是 `index.handler`（不是 `index.js`）
- ZIP 层级错：解压后 `index.js` 必须在根目录
- 后端超时设置太短，调到 30 秒

**Q4：页面能打开，但一直是「本地分析」？**

`/api/triage/health` 没通。F12 看这个请求的状态码；或者页面和 API 不在同一个域名下（跨域）——本方案的页面由函数自己返回，同源，不会有跨域问题。

**Q5：中文乱码？**

函数的响应头已固定 `charset=utf-8`；若用 APIG，「响应头」里不要覆盖 Content-Type。

**Q6：第一次访问很慢（3–5 秒）？**

冷启动，正常现象。演示前先访问一次预热，或把「预置并发」开 1 个（少量费用）。

## 更新内容后怎么重新部署

```bash
# 1. 改 site/index.html
# 2. 重新生成函数代码
node tools/gen-cloud-logic.js
# 3. 重新打包
#    PowerShell:
Compress-Archive -Path cloud/functiongraph/index.js, cloud/functiongraph/logic.js, cloud/functiongraph/index.html `
  -DestinationPath cloud/symptom-triage-function.zip -Force
# 4. 控制台 → 函数 → 代码 → 上传 ZIP（覆盖）
```

> 函数里的 `logic.js` 是从 `site/index.html` 自动抽取的，**与前端同一份算法**，不会出现两边结果不一致。

## 本地验证（没有华为云账号也能测）

```bash
node cloud/local-server.js
# 打开 http://127.0.0.1:8091 —— 这就是"部署在云上"的样子，右上角显示「云端分析」
```

它把同一个 `handler` 挂在本地 HTTP 上，行为和线上一致，可用于开发调试。

## 替代方案

| 方案 | 适用场景 | 代价 |
| --- | --- | --- |
| **ECS + Nginx（8080 端口）** | 需要"看得见的服务器"、要演示日志/监控 | 约 0.3–0.5 元/小时；非 80 端口可免备案 |
| **OBS + CDN + 备案域名** | 已有备案域名，想要纯静态的低成本 | 域名备案 1–3 周 |

ECS 方案：起一台 2C2G 的 Linux，装 Nginx，把 `cloud/functiongraph/index.html` 放到 `/var/www/symptom/`，监听 8080，安全组放行 8080 即可（页面会自动回退为「本地分析」，因为同域没有 `/api`）。
