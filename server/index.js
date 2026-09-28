'use strict';
const path = require('path');
const express = require('express');
const { BiliApiError } = require('./bilibili');
const { resolve } = require('./resolver');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 只允许 B 站图片 CDN，避免把本接口变成开放代理
const ALLOWED_HOST_SUFFIXES = ['hdslb.com', 'biliimg.com'];

function isAllowedImageUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((s) => host === s || host.endsWith('.' + s));
}

function imageFilenameFromContentType(contentType) {
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
  };
  return map[contentType] || null;
}

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

  app.get('/api/download', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    if (!rawUrl || !isAllowedImageUrl(rawUrl)) {
      return res.status(400).json({ code: 400, message: '图片地址不合法', data: null });
    }
    let upstream;
    try {
      upstream = await fetchFn(rawUrl, {
        headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' },
      });
    } catch (err) {
      return res.status(502).json({ code: -1, message: '图片下载失败：' + err.message, data: null });
    }
    if (!upstream.ok) {
      return res.status(502).json({ code: -1, message: '图片下载失败：HTTP ' + upstream.status, data: null });
    }
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';

    let filename = '';
    try {
      filename = decodeURIComponent(new URL(rawUrl).pathname.split('/').pop() || '');
    } catch {
      filename = '';
    }
    if (!filename.includes('.')) {
      const ext = imageFilenameFromContentType(contentType);
      filename = (filename || 'cover') + '.' + (ext || 'jpg');
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(filename));
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
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
