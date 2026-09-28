'use strict';
const { parseInput } = require('../shared/parser');
const { BiliApiError } = require('./bilibili');
const { resolveKind } = require('./resolver-core');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_B23_HOPS = 3;

async function resolve(type, id, fetchFn = fetch) {
  if (type !== 'b23') {
    return resolveKind(type, id, fetchFn);
  }
  return resolveShortLink(id, fetchFn, 0);
}

async function resolveShortLink(code, fetchFn, hop) {
  if (hop >= MAX_B23_HOPS) {
    throw new BiliApiError(-2, '短链接跳转次数过多，无法解析');
  }
  const shortUrl = 'https://b23.tv/' + encodeURIComponent(code);
  const target = await followRedirect(shortUrl, fetchFn);
  const parsed = parseInput(target);
  if (!parsed) {
    throw new BiliApiError(-2, '短链接指向的地址无法识别：' + target);
  }
  if (parsed.type === 'b23') {
    return resolveShortLink(parsed.id, fetchFn, hop + 1);
  }
  return resolveKind(parsed.type, parsed.id, fetchFn);
}

async function followRedirect(url, fetchFn) {
  for (const method of ['HEAD', 'GET']) {
    let res;
    try {
      res = await fetchFn(url, {
        method,
        redirect: 'manual',
        headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' },
      });
    } catch (err) {
      throw new BiliApiError(-1, '网络请求失败：' + err.message);
    }
    const location = res.headers.get('location');
    if (location) {
      return new URL(location, url).toString();
    }
    // HEAD 拿不到 Location 时继续尝试 GET；两次都失败则报错
  }
  throw new BiliApiError(-2, '短链接未返回有效的跳转地址');
}

module.exports = { resolve };
