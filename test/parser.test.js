'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseInput } = require('../shared/parser');

// [输入, 期望结果]；期望为 null 表示非法输入
const cases = [
  // ---- 非法 / 边界 ----
  ['', null],
  ['   ', null],
  ['abc', null],
  ['av', null],
  ['1234abcd', null],
  ['https://example.com/video/BV1xx411c7mD', null], // 非 bilibili 域名

  // ---- av ----
  ['12345', { type: 'av', id: '12345' }],
  ['av12345', { type: 'av', id: '12345' }],
  ['AV12345', { type: 'av', id: '12345' }],
  ['aV12345', { type: 'av', id: '12345' }],
  ['https://www.bilibili.com/video/av170001', { type: 'av', id: '170001' }],
  ['https://www.bilibili.com/video/av170001?p=2&vd_source=abcd', { type: 'av', id: '170001' }],
  ['http://www.bilibili.com/video/av170001', { type: 'av', id: '170001' }],
  // 无协议前缀同样可识别
  ['www.bilibili.com/video/av170001', { type: 'av', id: '170001' }],
  ['bilibili.com/video/av170001?p=2', { type: 'av', id: '170001' }],

  // ---- bv（捕获组不含 BV 前缀，见 Global Constraints §2）----
  ['BV1xx411c7mD', { type: 'bv', id: '1xx411c7mD' }],
  ['bv1xx411c7mD', { type: 'bv', id: '1xx411c7mD' }],
  ['https://www.bilibili.com/video/BV1xx411c7mD?share_source=copy_web', { type: 'bv', id: '1xx411c7mD' }],
  ['www.bilibili.com/video/BV1xx411c7mD', { type: 'bv', id: '1xx411c7mD' }],

  // ---- cv ----
  ['cv123456', { type: 'cv', id: '123456' }],
  ['https://www.bilibili.com/read/cv123456?spm_id_from=333.999.0.0', { type: 'cv', id: '123456' }],
  ['www.bilibili.com/read/cv123456', { type: 'cv', id: '123456' }],

  // ---- bangumi（番剧）----
  ['ep12345', { type: 'bangumi', id: 'ep12345' }],
  ['ss67890', { type: 'bangumi', id: 'ss67890' }],
  ['EP12345', { type: 'bangumi', id: 'EP12345' }],
  ['https://www.bilibili.com/bangumi/play/ep12345', { type: 'bangumi', id: 'ep12345' }],
  ['https://www.bilibili.com/bangumi/play/ss67890?spm_id_from=333.999.0.0', { type: 'bangumi', id: 'ss67890' }],
  ['www.bilibili.com/bangumi/play/ep12345', { type: 'bangumi', id: 'ep12345' }],

  // ---- live ----
  ['https://live.bilibili.com/2233', { type: 'live', id: '2233' }],
  ['https://live.bilibili.com/2233?spm_id_from=333.999.0.0', { type: 'live', id: '2233' }],
  ['live.bilibili.com/2233', { type: 'live', id: '2233' }],

  // ---- b23 ----
  ['https://b23.tv/x9ABCD', { type: 'b23', id: 'x9ABCD' }],
  ['https://b23.tv/x9ABCD?share_source=copy_web', { type: 'b23', id: 'x9ABCD' }],
  ['b23.tv/x9ABCD', { type: 'b23', id: 'x9ABCD' }],
];

test('parseInput 覆盖全部类型与非法输入', () => {
  for (const [input, expected] of cases) {
    assert.deepEqual(parseInput(input), expected, `input=${JSON.stringify(input)}`);
  }
});
