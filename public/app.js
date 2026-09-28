'use strict';

/*
 * BiliCover 前端行为。
 * - 复用后端同一份解析逻辑：window.BiliParser.parseInput（/parser.js，UMD）。
 * - 所有来自 API / 用户输入的可见文本在插入 DOM 前均使用 textContent，
 *   从根本上规避 XSS（标题 / 简介 / 作者等内容来自第三方）。
 * - 下载地址一律经 encodeURIComponent 处理。
 */
(function () {
  const TYPE_LABELS = {
    av: 'AV 视频',
    bv: 'BV 视频',
    cv: '专栏文章',
    live: '直播间',
    bangumi: '番剧',
    b23: 'b23 短链接',
  };

  const form = document.getElementById('extract-form');
  const input = document.getElementById('url-input');
  const btn = document.getElementById('extract-btn');
  const inputError = document.getElementById('input-error');
  const result = document.getElementById('result');

  const DEFAULT_BTN_TEXT = '提取封面';
  let inFlight = false;

  function showInputError(show) {
    inputError.hidden = !show;
  }

  function setBusy(busy) {
    inFlight = busy;
    btn.disabled = busy;
    btn.textContent = busy ? '解析中…' : DEFAULT_BTN_TEXT;
  }

  function clearResult() {
    result.hidden = true;
    result.replaceChildren();
  }

  function buildBadges(inputType, finalType) {
    const wrap = document.createElement('div');
    wrap.className = 'badges';
    if (inputType === 'b23' && finalType !== 'b23') {
      const short = document.createElement('span');
      short.className = 'badge short';
      short.textContent = TYPE_LABELS.b23 || 'b23 短链接';
      wrap.appendChild(short);
    }
    const main = document.createElement('span');
    main.className = 'badge';
    main.textContent = TYPE_LABELS[finalType] || finalType;
    wrap.appendChild(main);
    return wrap;
  }

  function renderSuccess(inputType, d) {
    clearResult();

    const card = document.createElement('div');
    card.className = 'card';

    // 封面图：直接热链 B 站 CDN（非代理）；// 开头补 https:
    let coverSrc = d.imageUrl || '';
    if (coverSrc.startsWith('//')) coverSrc = 'https:' + coverSrc;
    const imgWrap = document.createElement('div');
    imgWrap.className = 'card-img-wrap';
    const img = document.createElement('img');
    img.className = 'card-img';
    img.src = coverSrc;
    img.alt = d.title || '封面';
    img.referrerPolicy = 'no-referrer';
    img.loading = 'lazy';
    imgWrap.appendChild(img);
    card.appendChild(imgWrap);

    const body = document.createElement('div');
    body.className = 'card-body';
    body.appendChild(buildBadges(inputType, d.type));

    const title = document.createElement('h2');
    title.className = 'card-title';
    title.textContent = d.title || '(无标题)';
    body.appendChild(title);

    // UP 主（非直播）/ 主播 UID（直播）
    if (d.type === 'live') {
      if (d.uid) {
        const row = document.createElement('div');
        row.className = 'card-row';
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = '主播 UID';
        row.appendChild(label);
        row.appendChild(document.createTextNode(String(d.uid)));
        body.appendChild(row);
      }
    } else if (d.author) {
      const row = document.createElement('div');
      row.className = 'card-row';
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = 'UP 主';
      row.appendChild(label);
      row.appendChild(document.createTextNode(d.author));
      body.appendChild(row);
    }

    // 简介：null / 空串不渲染
    if (d.desc) {
      const desc = document.createElement('p');
      desc.className = 'card-desc';
      desc.textContent = d.desc;
      body.appendChild(desc);
    }

    // 下载按钮：指向同源代理，地址经 encodeURIComponent
    const dl = document.createElement('a');
    dl.className = 'download-btn';
    dl.textContent = '下载封面图片';
    dl.href = '/api/download?url=' + encodeURIComponent(coverSrc);
    dl.setAttribute('download', '');
    body.appendChild(dl);

    card.appendChild(body);
    result.appendChild(card);
    result.hidden = false;
  }

  function renderError(code, message) {
    clearResult();
    const panel = document.createElement('div');
    panel.className = 'error-panel';
    const prefix = document.createElement('span');
    prefix.textContent = '解析失败（错误码 ';
    const codeEl = document.createElement('span');
    codeEl.className = 'err-code';
    codeEl.textContent = String(code);
    const suffix = document.createElement('span');
    suffix.textContent = '）：';
    panel.appendChild(prefix);
    panel.appendChild(codeEl);
    panel.appendChild(suffix);
    panel.appendChild(document.createTextNode(message || '未知错误'));
    result.appendChild(panel);
    result.hidden = false;
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (inFlight) return;

    const value = input.value.trim();
    showInputError(false);
    clearResult();

    // 输入校验：与后端同一份正则
    const parsed = window.BiliParser && window.BiliParser.parseInput(value);
    if (!parsed) {
      showInputError(true);
      input.focus();
      return;
    }

    setBusy(true);
    try {
      const qs = new URLSearchParams({ type: parsed.type, id: parsed.id });
      const res = await fetch('/api/resolve?' + qs.toString());
      let body;
      try {
        body = await res.json();
      } catch {
        renderError(-1, '服务返回非预期数据');
        return;
      }
      if (body && body.code === 0 && body.data) {
        renderSuccess(parsed.type, body.data);
      } else if (body) {
        renderError(body.code, body.message);
      } else {
        renderError(-1, '服务返回空数据');
      }
    } catch (err) {
      renderError(-1, (err && err.message) || '网络请求失败');
    } finally {
      setBusy(false);
    }
  }

  form.addEventListener('submit', onSubmit);
})();
