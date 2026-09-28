'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/index');

let server;
let base;

async function stubFetch(url) {
  const u = String(url);
  if (u.includes('i0.hdslb.com')) {
    return new Response('FAKE-IMAGE-BYTES', {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    });
  }
  throw new Error('unexpected url: ' + u);
}

before(async () => {
  server = createApp({ fetchFn: stubFetch }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => new Promise((resolve) => server.close(resolve)));

test('下载成功：attachment 头 + 图片字节', async () => {
  const url =
    base + '/api/download?url=' + encodeURIComponent('https://i0.hdslb.com/bfs/archive/cover.jpg');
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment/);
  assert.match(res.headers.get('content-type'), /image\/jpeg/);
  assert.equal(await res.text(), 'FAKE-IMAGE-BYTES');
});

test('非 hdslb 主机返回 400 code=400', async () => {
  const url =
    base + '/api/download?url=' + encodeURIComponent('https://evil.example.com/x.jpg');
  const res = await fetch(url);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 400);
});

test('缺少 url 参数返回 400', async () => {
  const res = await fetch(base + '/api/download');
  assert.equal(res.status, 400);
});
