'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/index');

const VIEW_OK = {
  code: 0,
  message: '0',
  data: {
    pic: 'https://i0.hdslb.com/bfs/archive/aaabbbccc.jpg',
    title: '示例视频标题',
    desc: '示例简介',
    owner: { mid: 1, name: '示例UP主' },
  },
};
const COLUMN_OK = {
  code: 0,
  message: '0',
  data: { banner_url: 'https://i0.hdslb.com/bfs/article/cover.jpg', title: '示例专栏标题', author_name: '示例作者' },
};
const LIVE_OK = {
  code: 0,
  message: '0',
  data: { user_cover: 'https://i0.hdslb.com/bfs/room/cover.jpg', title: '示例直播间标题', uid: 2233 },
};

let server;
let base;
let fetchCalls;

async function stubFetch(url, init = {}) {
  fetchCalls.push({ url: String(url), method: init.method || 'GET', body: init.body || null });
  const u = String(url);
  if (u.includes('aid=404')) {
    return new Response(JSON.stringify({ code: -404, message: '啥都木有' }), { status: 200 });
  }
  if (u.includes('/x/web-interface/view')) {
    return new Response(JSON.stringify(VIEW_OK), { status: 200 });
  }
  if (u.includes('/x/article/viewinfo')) {
    return new Response(JSON.stringify(COLUMN_OK), { status: 200 });
  }
  if (u.includes('/room/v1/Room/get_info')) {
    return new Response(JSON.stringify(LIVE_OK), { status: 200 });
  }
  throw new Error('unexpected upstream url: ' + u);
}

before(async () => {
  server = createApp({ fetchFn: stubFetch }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => new Promise((resolve) => server.close(resolve)));

test('缺少参数返回 code 400', async () => {
  const body = await (await fetch(base + '/api/resolve')).json();
  assert.equal(body.code, 400);
  assert.match(body.message, /type/);
});

test('bv 解析成功：返回归一化 data 且请求 bvid=BV+id', async () => {
  fetchCalls = [];
  const body = await (await fetch(base + '/api/resolve?type=bv&id=1xx411c7mD')).json();
  assert.equal(body.code, 0);
  assert.equal(body.data.type, 'bv');
  assert.equal(body.data.title, '示例视频标题');
  assert.equal(body.data.author, '示例UP主');
  assert.ok(fetchCalls.some((c) => c.url.includes('bvid=BV1xx411c7mD')), '应携带完整 BV 前缀请求');
});

test('live 解析成功：后端走 POST 表单', async () => {
  fetchCalls = [];
  const body = await (await fetch(base + '/api/resolve?type=live&id=2233')).json();
  assert.equal(body.code, 0);
  assert.equal(body.data.uid, '2233');
  const liveCall = fetchCalls.find((c) => c.url.includes('/room/v1/Room/get_info'));
  assert.ok(liveCall, '应请求 live get_info');
  assert.equal(liveCall.method, 'POST');
  assert.equal(liveCall.body, 'id=2233');
});

test('cv 解析成功', async () => {
  const body = await (await fetch(base + '/api/resolve?type=cv&id=123456')).json();
  assert.equal(body.code, 0);
  assert.equal(body.data.type, 'cv');
  assert.equal(body.data.title, '示例专栏标题');
});

test('上游错误码透传到信封', async () => {
  const body = await (await fetch(base + '/api/resolve?type=av&id=404')).json();
  assert.equal(body.code, -404);
  assert.equal(body.message, '啥都木有');
  assert.equal(body.data, null);
});

test('不支持的类型返回 code 400', async () => {
  const body = await (await fetch(base + '/api/resolve?type=zzz&id=1')).json();
  assert.equal(body.code, 400);
});
