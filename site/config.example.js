/*
 * 明辨康途 · 反馈接口地址（腾讯云 CloudBase）
 *
 * 用法：
 *   1. 把本文件复制为同目录的 config.js
 *   2. 把下面的地址改成你的环境（静态托管默认域名 + /api/feedback）
 *   3. 重新上传 config.js 到静态托管即可，无需改 index.html
 *
 * 不配置时，页面会请求同源 /api/feedback（Cloudflare Worker / 云函数均可）。
 */
window.__FEEDBACK_API__ = 'https://你的环境.tcloudbaseapp.com/api/feedback';