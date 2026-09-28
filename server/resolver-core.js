'use strict';
const { BiliApiError, httpJson } = require('./bilibili');

function checkUpstream(json) {
  if (!json || typeof json.code !== 'number') {
    throw new BiliApiError(-1, '上游返回数据格式异常');
  }
  if (json.code !== 0) {
    throw new BiliApiError(json.code, json.message || '上游接口返回错误');
  }
}

async function resolveKind(kind, id, fetchFn) {
  switch (kind) {
    case 'av':
      return resolveVideo(
        'av',
        'https://api.bilibili.com/x/web-interface/view?aid=' + encodeURIComponent(id),
        fetchFn
      );
    case 'bv':
      // bvid 必须带完整 BV 前缀（parser 的捕获组不含前缀，见 Global Constraints §2）
      return resolveVideo(
        'bv',
        'https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent('BV' + id),
        fetchFn
      );
    case 'cv':
      return resolveColumn(id, fetchFn);
    case 'live':
      return resolveLive(id, fetchFn);
    case 'bangumi':
      return resolveBangumi(id, fetchFn);
    default:
      throw new BiliApiError(400, '不支持的类型：' + kind);
  }
}

async function resolveVideo(kind, url, fetchFn) {
  const json = await httpJson(url, { fetchFn });
  checkUpstream(json);
  const data = json.data || {};
  if (!data.pic) {
    throw new BiliApiError(-1, '上游返回缺少封面字段 pic');
  }
  return {
    type: kind,
    imageUrl: data.pic,
    title: data.title || '',
    desc: data.desc || null,
    author: (data.owner && data.owner.name) || null,
    uid: null,
  };
}

async function resolveColumn(id, fetchFn) {
  const url = 'https://api.bilibili.com/x/article/viewinfo?id=' + encodeURIComponent(id);
  const json = await httpJson(url, { fetchFn });
  checkUpstream(json);
  const data = json.data || {};
  if (!data.banner_url) {
    throw new BiliApiError(-1, '上游返回缺少封面字段 banner_url');
  }
  return {
    type: 'cv',
    imageUrl: data.banner_url,
    title: data.title || '',
    desc: null,
    author: data.author_name || null,
    uid: null,
  };
}

async function resolveLive(id, fetchFn) {
  const json = await httpJson('https://api.live.bilibili.com/room/v1/Room/get_info', {
    method: 'POST',
    form: 'id=' + encodeURIComponent(id),
    fetchFn,
  });
  checkUpstream(json);
  const data = json.data || {};
  if (!data.user_cover) {
    throw new BiliApiError(-1, '上游返回缺少封面字段 user_cover');
  }
  return {
    type: 'live',
    imageUrl: data.user_cover,
    title: data.title || '',
    desc: null,
    author: null,
    uid: data.uid != null ? String(data.uid) : null,
  };
}

async function resolveBangumi(id, fetchFn) {
  // 番剧接口用 result 包裹（非 data）；ep 编号走 ep_id，ss 编号走 season_id
  const lower = String(id).toLowerCase();
  const param = lower.startsWith('ep') ? 'ep_id' : 'season_id';
  const num = String(id).slice(2);
  const url =
    'https://api.bilibili.com/pgc/view/web/season?' +
    param +
    '=' +
    encodeURIComponent(num);
  const json = await httpJson(url, { fetchFn });
  checkUpstream(json);
  const data = json.result || {};
  if (!data.cover) {
    throw new BiliApiError(-1, '上游返回缺少封面字段 cover');
  }
  return {
    type: 'bangumi',
    imageUrl: data.cover,
    title: data.title || '',
    desc: data.evaluate || null,
    author: null,
    uid: null,
  };
}

module.exports = { resolveKind };
