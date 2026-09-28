'use strict';
const path = require('path');
const express = require('express');
const { BiliApiError } = require('./bilibili');
const { resolve } = require('./resolver');

function createApp({ fetchFn = fetch } = {}) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/resolve', async (req, res) => {
    const type = typeof req.query.type === 'string' ? req.query.type.trim() : '';
    const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
    if (!type || !id) {
      return res.json({ code: 400, message: '缺少参数：type 和 id 均为必填', data: null });
    }
    try {
      const data = await resolve(type, id, fetchFn);
      res.json({ code: 0, message: 'ok', data });
    } catch (err) {
      const code = err instanceof BiliApiError ? err.code : -1;
      const message = err instanceof Error ? err.message : String(err);
      res.json({ code, message, data: null });
    }
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => {
    console.log(`BiliCover running at http://localhost:${port}`);
  });
}

module.exports = { createApp };
