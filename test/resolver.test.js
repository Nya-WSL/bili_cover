'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('../server/resolver');
const { BiliApiError } = require('../server/bilibili');

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

test('非 b23 类型直接委托 resolveKind（bv 补全前缀）', async () => {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    return new Response(JSON.stringify(VIEW_OK), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const data = await resolve('bv', '1xx411c7mD', fetchFn);
  assert.equal(data.type, 'bv');
  assert.match(calls[0].url, /bvid=BV1xx411c7mD/);
});

test('b23：HEAD 返回 Location 后解析为 bv 视频', async () => {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || 'GET';
    calls.push({ url: u, method });
    if (method === 'HEAD' && u.includes('b23.tv')) {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://www.bilibili.com/video/BV1xx411c7mD?share_source=copy_web' },
      });
    }
    if (u.includes('/x/web-interface/view')) {
      return new Response(JSON.stringify(VIEW_OK), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('unexpected url: ' + u);
  };
  const data = await resolve('b23', 'x9ABCD', fetchFn);
  assert.equal(data.type, 'bv');
  assert.equal(data.title, '示例视频标题');
  const headCall = calls.find((c) => c.method === 'HEAD');
  assert.ok(headCall, '应先发 HEAD 请求');
  assert.ok(calls.some((c) => c.url.includes('bvid=BV1xx411c7mD')), '应继续请求 view 接口');
});

test('b23：HEAD 无 Location 时回退 GET', async () => {
  let headSeen = false;
  const fetchFn = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || 'GET';
    if (method === 'HEAD' && u.includes('b23.tv')) {
      headSeen = true;
      return new Response(null, { status: 200 }); // 无 location
    }
    if (method === 'GET' && u.includes('b23.tv')) {
      return new Response(null, { status: 302, headers: { location: 'https://live.bilibili.com/2233' } });
    }
    if (u.includes('/room/v1/Room/get_info')) {
      return new Response(
        JSON.stringify({ code: 0, message: '0', data: { user_cover: 'https://i0.hdslb.com/x.jpg', title: '示例直播间', uid: 2233 } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    throw new Error('unexpected url: ' + u);
  };
  const data = await resolve('b23', 'liveCode', fetchFn);
  assert.ok(headSeen);
  assert.equal(data.type, 'live');
});

test('b23：真实地址无法识别抛 code -2', async () => {
  const fetchFn = async (url, init = {}) => {
    if (String(url).includes('b23.tv')) {
      return new Response(null, { status: 302, headers: { location: 'https://example.com/whatever' } });
    }
    throw new Error('unexpected url: ' + url);
  };
  await assert.rejects(resolve('b23', 'abc', fetchFn), (err) => err instanceof BiliApiError && err.code === -2);
});

test('b23：跳转超过 3 次抛 code -2', async () => {
  let count = 0;
  const fetchFn = async (url, init = {}) => {
    if (String(url).includes('b23.tv')) {
      count += 1;
      return new Response(null, { status: 302, headers: { location: 'https://b23.tv/next' } });
    }
    throw new Error('unexpected url: ' + url);
  };
  await assert.rejects(resolve('b23', 'loop', fetchFn), (err) => err.code === -2 && /次数过多/.test(err.message));
  assert.ok(count >= 3, '应多次跟随但最终终止');
});
