'use strict';

/*
 * Vercel 无服务器函数入口。
 *
 * 直接复用现有的 Express 应用（server/index.js 导出的 createApp），
 * 因此本地 `yarn start` 与 Vercel 部署走完全相同的代码与路由，无需任何改写。
 *
 * 请求流转（vercel.json 的 catch-all rewrite）：
 *   浏览器 → Vercel 边缘 → 转发到本函数 → Express 处理
 *     - 命中 public/ 静态文件（index.html / style.css / app.js / parser.js 等）由 express.static 返回
 *     - /api/resolve、/api/download 由对应路由处理（服务端直接调 B 站接口，无 CORS 问题）
 *
 * 注意：本文件仅在 Vercel 部署时由运行时加载；本地运行仍走 server/index.js 的
 * `require.main === module` 分支自行监听端口，二者互不干扰。
 */
const { createApp } = require('../server/index');

module.exports = createApp();
