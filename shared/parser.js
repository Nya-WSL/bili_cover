'use strict';

/*
 * 输入解析器：按需求正则识别 B 站输入类型。
 * UMD 结构：Node（require）与浏览器（<script src="/parser.js">）共用同一份代码，
 * 保证前后端解析逻辑完全一致（后端 b23 跳转后的真实地址也用它解析）。
 *
 * 注意：捕获组与需求保持一致 —— bv 的捕获结果不含 "BV" 前缀；
 * bvid 需要完整前缀，由 server/resolver-core.js 拼 'BV' + id 后再请求。
 * URL 规则统一整串 ^...$ 锚定（先 trim），并加 /i 使域名/前缀大小写不敏感。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BiliParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 顺序即优先级：先 av/bv/cv，再 live、b23；条目顺序对应需求给出的正则。
  // URL 规则中的协议 https?:// 设为可选项，使无协议链接（如 www.bilibili.com/...）
  // 也能被识别（整串 ^...$ 锚定并先 trim，整体 /i 大小写不敏感）。
  const PATTERNS = [
    { type: 'av', re: /^(?:(?:a|A)(?:v|V))?([0-9]+)$/ },
    { type: 'av', re: /^(?:https?:\/\/)?.*?bilibili.*?av([0-9]+).*?$/i },
    { type: 'bv', re: /^(?:(?:b|B)(?:v|V))([0-9A-Za-z]+)$/ },
    { type: 'bv', re: /^(?:https?:\/\/)?.*?bilibili.*?BV([0-9A-Za-z]+).*?$/i },
    { type: 'cv', re: /^(?:(?:c|C)(?:v|V))([0-9]+)$/ },
    { type: 'cv', re: /^(?:https?:\/\/)?.*?bilibili.*?cv([0-9]+).*?$/i },
    { type: 'live', re: /^(?:https?:\/\/)?live\.bilibili.*?\/([0-9]+).*?$/i },
    { type: 'b23', re: /^(?:https?:\/\/)?b23\.tv\/([0-9A-Za-z]+).*?$/i },
  ];

  function parseInput(input) {
    if (typeof input !== 'string') return null;
    const text = input.trim();
    if (!text) return null;
    for (const { type, re } of PATTERNS) {
      const match = re.exec(text);
      if (match && match[1]) {
        return { type, id: match[1] };
      }
    }
    return null;
  }

  return { parseInput };
});
