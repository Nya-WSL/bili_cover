'use strict';

/*
 * Vercel 入口冒烟测试：确保 api/app.js 能正常加载并导出一个可用的
 * Express 请求处理器（即 createApp() 的返回值）。这能拦住「Vercel 部署时
 * 入口文件崩溃」这类本地启动测不到的问题。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../api/app');

test('api/app.js 导出可用的 Express 应用处理器', () => {
  // Express 应用本质是一个 (req, res) => void 的函数
  assert.equal(typeof app, 'function', '应导出一个请求处理器函数');
  // Express 应用带有一组路由方法，用来确认它是真正的 app 而非普通函数
  assert.equal(typeof app.listen, 'function');
  assert.equal(typeof app.get, 'function');
  assert.equal(typeof app.use, 'function');
});
