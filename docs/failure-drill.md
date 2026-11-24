# 故障演练

> 前 4 项由 `tools/test-degrade.js` 实测（假 DOM / 假 fetch / 假 KV，不访问线上）；第 5 项基于 `site/index.html` 源码静态判断，未在真实浏览器切换 JS 开关实测。

| 场景 | 验证方式 | 实际表现 | 是否可接受 |
| --- | --- | --- | --- |
| 断网 | `test-degrade`：`initWeatherTips()` + `fetch` 直接 reject | 天气提示块 `hidden=true`；`scoreConditions(['sore_throat','fever'])` 仍返回结果（分诊纯函数不受影响） | ✅ 可接受 |
| `/api/feedback` 返回 500 | 假 fetch 返回 500，调用 `fbSubmit()` | 状态栏显示「当前无法提交，内容已保存在本机，可稍后重试（也可在「我的档案」里查看）」；`selected` 仍保留已选症状，未清空 | ✅ 可接受 |
| KV 不可用 | Worker `env.FEEDBACK_KV = null` 提交反馈 | 后台返回 **503**；前端收到 503 后不抛错、走本地保存并给出可重试提示 | ✅ 可接受（降级期间反馈不落库，但主流程不受影响） |
| 清 Cookie | `/api/auth/me` 返回 401 后 `initAccount()`，再提交反馈 | 自动降级为游客模式（`accountMe=null`）；反馈 payload 带 `anonId`、不含 `userId` | ✅ 可接受 |
| 禁用 JS | 静态检查：`site/index.html` 无 `<noscript>`；症状列表容器由脚本渲染 | 静态 HTML 的首屏标题、公告、表单骨架可见；但症状列表、分诊、档案、天气提示、匿名账号全部依赖 JS，禁用后不可用；页面**没有**「请启用 JS」提示 | ⚠️ 部分不可接受：纯前端应用的已知缺陷。若需改善，只能补 `<noscript>` 说明，无法恢复功能 |

## 复现命令

```bash
node tools/test-degrade.js
```

输出为 9 项断言全过时：`降级演练 9/9 通过（断网天气 / 反馈 500 / KV 503 / 清 Cookie 游客 + anonId）`。

## 未覆盖

- 真实浏览器禁用 JS 的渲染表现（沙箱无法切换浏览器设置），仅按源码判断。
- 多区域 KV 延迟、断网恢复后的重试队列（前端目前是「保存本机 + 手动重试」，无自动重放）。
- 后端 5xx 时的告警与用户可见状态（Worker 无监控接入）。