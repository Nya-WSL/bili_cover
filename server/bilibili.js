'use strict';

class BiliApiError extends Error {
  constructor(code, message) {
    super(String(message));
    this.name = 'BiliApiError';
    this.code = code;
  }
}

const BASE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Referer: 'https://www.bilibili.com/',
  Accept: 'application/json, text/plain, */*',
};

async function httpJson(url, { method = 'GET', form = null, fetchFn = fetch } = {}) {
  const headers = { ...BASE_HEADERS };
  const init = { method, headers };
  if (form != null) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    init.body = form;
  }

  let res;
  try {
    res = await fetchFn(url, init);
  } catch (err) {
    throw new BiliApiError(-1, '网络请求失败：' + err.message);
  }
  if (!res.ok) {
    const hint = res.status === 412 ? '（触发风控，请稍后重试）' : '';
    throw new BiliApiError(-1, '上游接口返回 HTTP ' + res.status + hint);
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw new BiliApiError(-1, '上游接口返回内容不是合法 JSON');
  }
  return json;
}

module.exports = { BiliApiError, httpJson, BASE_HEADERS };
