'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveKind } = require('../server/resolver-core');
const { BiliApiError } = require('../server/bilibili');

const VIEW_OK = {
  code: 0,
  message: '0',
  data: {
    pic: 'https://i0.hdslb.com/bfs/archive/aaabbbccc.jpg',
    title: '示例视频标题',
    desc: '这是一段示例简介。',
    owner: { mid: 1, name: '示例UP主' },
  },
};
const VIEW_ERR = { code: -404, message: '啥都木有' };
const COLUMN_OK = {
  code: 0,
  message: '0',
  data: {
    banner_url: 'https://i0.hdslb.com/bfs/article/cover.jpg',
    title: '示例专栏标题',
    author_name: '示例作者',
  },
};
const LIVE_OK = {
  code: 0,
  message: '0',
  data: { user_cover: 'https://i0.hdslb.com/bfs/room/cover.jpg', title: '示例直播间标题', uid: 2233 },
};
const LIVE_ERR = { code: -400, message: '请求错误' };

function stubByUrl(record) {
  return async (url, init = {}) => {
    record.push({ url: String(url), method: init.method || 'GET', body: init.body || null });
    const u = String(url);
    if (u.includes('/x/web-interface/view')) {
      return new Response(JSON.stringify(u.includes('aid=404') ? VIEW_ERR : VIEW_OK), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (u.includes('/x/article/viewinfo')) {
      return new Response(JSON.stringify(COLUMN_OK), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (u.includes('/room/v1/Room/get_info')) {
      return new Response(JSON.stringify(init.body === 'id=404' ? LIVE_ERR : LIVE_OK), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error('unexpected url: ' + u);
  };
}

test('av 解析成功并归一化字段', async () => {
  const record = [];
  const data = await resolveKind('av', '170001', stubByUrl(record));
  assert.deepEqual(data, {
    type: 'av',
    imageUrl: VIEW_OK.data.pic,
    title: '示例视频标题',
    desc: '这是一段示例简介。',
    author: '示例UP主',
    uid: null,
  });
  assert.match(record[0].url, /aid=170001/);
});

test('bv 解析时 bvid 补全 BV 前缀', async () => {
  const record = [];
  const data = await resolveKind('bv', '1xx411c7mD', stubByUrl(record));
  assert.equal(data.type, 'bv');
  assert.equal(data.author, '示例UP主');
  assert.match(record[0].url, /bvid=BV1xx411c7mD/);
});

test('cv 解析成功（无 desc）', async () => {
  const data = await resolveKind('cv', '123456', stubByUrl([]));
  assert.equal(data.type, 'cv');
  assert.equal(data.imageUrl, COLUMN_OK.data.banner_url);
  assert.equal(data.title, '示例专栏标题');
  assert.equal(data.author, '示例作者');
  assert.equal(data.desc, null);
  assert.equal(data.uid, null);
});

test('live 解析成功：POST 表单且 uid 转字符串', async () => {
  const record = [];
  const data = await resolveKind('live', '2233', stubByUrl(record));
  assert.equal(data.type, 'live');
  assert.equal(data.imageUrl, LIVE_OK.data.user_cover);
  assert.equal(data.title, '示例直播间标题');
  assert.equal(data.uid, '2233');
  assert.equal(data.author, null);
  assert.equal(record[0].method, 'POST');
  assert.equal(record[0].body, 'id=2233');
});

test('上游 code!=0 时透传错误码与 message', async () => {
  await assert.rejects(
    resolveKind('av', '404', stubByUrl([])),
    (err) => err instanceof BiliApiError && err.code === -404 && err.message === '啥都木有'
  );
  await assert.rejects(
    resolveKind('live', '404', stubByUrl([])),
    (err) => err instanceof BiliApiError && err.code === -400 && err.message === '请求错误'
  );
});

test('不支持的类型抛 code 400', async () => {
  await assert.rejects(resolveKind('xxx', '1', stubByUrl([])), (err) => err.code === 400);
});
