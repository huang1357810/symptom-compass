# 安全自查

> 由 `tools/security-check.js` 实测生成。使用**内存假 KV** 加载真实 `worker/index.js` 与 `worker/auth.mjs`，不访问线上、不写真实 KV。

| 项 | 方法 | 结果 | 证据 |
| --- | --- | --- | --- |
| 伪造 userId 提交反馈 | 未登录请求体带 userId=u_fake | 通过 | HTTP 400 · forged_user |
| 反馈正文 XSS 转义 | 正文注入 <img onerror>，查看管理页 HTML | 通过 | 输出为 &lt;img src=x onerror=alert(1)&gt;，无原始标签 |
| 无管理密钥访问反馈列表 | GET /api/feedback/list 不带 key | 通过 | HTTP 401 |
| 反馈接口限流阈值 | 同一 IP（CF-Connecting-IP）连续提交 20 次 | 通过 | 第 6 次开始返回 429（前 5 次成功） |
| 登录错误文案不泄露账号是否存在 | 不存在用户名 vs 存在用户名+错误密码 | 通过 | 两者均 HTTP 401 · 「用户名或密码错误」 |
| 用户名格式校验（手机号 / 邮箱） | 注册 username=13800138000 与 a@b.com | 通过 | 手机号 HTTP 400「用户名不能是手机号」；邮箱 HTTP 400「用户名不能包含 @」 |

- 反馈限流实测阈值：**同一 IP 每分钟 5 次**（第 6 次起 429）。
- PBKDF2 迭代数：默认 **50,000**；线上实测 100,000 次时 `cpuTimeMs` 约 **107ms**（免费版 CPU 约 10ms 限制下据此降档，付费版可用 `AUTH_ITERATIONS` 调回）。
- 说明：KV 为最终一致存储，用户名唯一性与注销删除均非原子；本表只覆盖单实例逻辑，未覆盖并发竞态。
