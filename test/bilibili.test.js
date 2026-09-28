'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BiliApiError, httpJson } = require('../server/bilibili');

test('httpJson 返回解析后的 JSON', async () => {
  const fetchFn = async () => new Response(JSON.stringify({ code: 0 }), { status: 200 });
  const json = await httpJson('https://api.bilibili.com/x', { fetchFn });
  assert.deepEqual(json, { code: 0 });
});

test('httpJson 网络异常抛 BiliApiError code=-1', async () => {
  const fetchFn = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(
    httpJson('https://api.bilibili.com/x', { fetchFn }),
    (err) => err instanceof BiliApiError && err.code === -1 && /网络请求失败/.test(err.message)
  );
});

test('httpJson 非 2xx（412 风控）抛 BiliApiError 且带状态码提示', async () => {
  const fetchFn = async () => new Response('blocked', { status: 412 });
  await assert.rejects(
    httpJson('https://api.bilibili.com/x', { fetchFn }),
    (err) => err instanceof BiliApiError && /412/.test(err.message) && /风控/.test(err.message)
  );
});

test('httpJson 非 JSON 响应抛 BiliApiError code=-1', async () => {
  const fetchFn = async () => new Response('<html>oops</html>', { status: 200 });
  await assert.rejects(
    httpJson('https://api.bilibili.com/x', { fetchFn }),
    (err) => err instanceof BiliApiError && err.code === -1
  );
});

test('httpJson POST 模式发送表单并带基础头', async () => {
  let captured;
  const fetchFn = async (url, init) => {
    captured = { url: String(url), init };
    return new Response('{"code":0}', { status: 200 });
  };
  await httpJson('https://api.live.bilibili.com/x', { method: 'POST', form: 'id=2233', fetchFn });
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.body, 'id=2233');
  assert.match(captured.init.headers['Content-Type'], /application\/x-www-form-urlencoded/);
  assert.match(String(captured.init.headers['User-Agent']), /Mozilla/);
  assert.equal(captured.init.headers.Referer, 'https://www.bilibili.com/');
});
