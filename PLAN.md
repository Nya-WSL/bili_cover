# Bilibili 封面提取 Web 应用（BiliCover）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Web 应用，用户粘贴 B 站视频 / 直播 / 专栏链接或 av / BV / cv / b23 编号后，由后端调用 B 站接口解析出封面图、标题、UP 主等信息，前端多端（PC / 手机 / 平板）展示并支持下载封面。

**Architecture:** 单一 Node.js（Express）服务同时承担静态前端与 API：浏览器端负责正则识别输入类型（type+id），后端 `/api/resolve` 按类型调用对应 B 站接口并归一化字段，`/api/download` 代理下载封面（绕过跨域限制）；b23 短链接由后端跟随 Location 后递归再解析。前后端共用同一份 `shared/parser.js` 解析代码（UMD，无构建步骤）。

**Tech Stack:** Node.js ≥ 18.13（内置 fetch / Response / node:test）、Express 4、原生 HTML/CSS/JavaScript（无框架、无打包、零构建）。唯一运行时依赖：`express`（包管理用 yarn，见 Global Constraints §1）。

**Spec:** 需求已内联在本文件（见 Global Constraints 的正则表、接口映射表、字段映射表、错误码约定）。执行者必须严格照抄其中的正则与端点，不得自行"改进"导致与需求正则不一致。

---

## Global Constraints

以下约束对每个任务都生效（逐字照抄，勿改动语义）：

### 1. 目录与运行约定

```
bilicover/
├── package.json            # type 不写（CommonJS），scripts: start / dev / test
├── yarn.lock
├── .gitignore
├── README.md               # Task 9 创建
├── PLAN.md                 # 本文件
├── shared/
│   └── parser.js           # 前后端共用的输入解析器（UMD）
├── server/
│   ├── index.js            # Express 应用（静态 + /api/resolve + /api/download + /parser.js）
│   ├── bilibili.js         # 上游 HTTP 客户端 + BiliApiError
│   ├── resolver-core.js    # av/bv/cv/live 四类解析与字段归一化
│   └── resolver.js         # 总调度（含 b23 短链接跟随）
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
└── test/                   # node:test 用例（*.test.js）
```

- 包管理器统一用 **yarn**：依赖安装 `yarn install`，锁文件为 `yarn.lock`（需提交）。禁止用 npm 安装/提交，`package-lock.json` 已加入 `.gitignore`。
- `yarn start` 启动服务，默认端口 `3000`（可用环境变量 `PORT` 覆盖）。
- `yarn test` 运行 `node --test`（**无参默认发现模式**）。原因：Node ≥ 22 把 `--test` 的位置参数改为 glob 语义，`node --test test/` 的目录参数已失效（会把 `test/` 当作模块加载而失败）；无参形式在 Node 18.13–24 均可递归发现 `test/` 下用例并跳过 node_modules。单文件参数形式（如 `node --test test/parser.test.js`）在各版本均可用，各步 RED/GREEN 验证保留单文件形式。全部用例离线可跑（上游请求一律注入 stub fetch）。
- 测试通过的判定以 **exit code 0 与测试计数** 为准。摘要前缀有版本差异：Node ≤ 20 为 `# pass N`，Node ≥ 21 为 `ℹ pass N`（本机 Node v24 为 `ℹ` 前缀）；下文各步骤 “Expected” 只核对计数，勿要求字面前缀一致。
- 语言为 CommonJS（`require` / `module.exports`），不要在 `package.json` 写 `"type": "module"`。

### 2. 输入解析正则表（规范来源，`shared/parser.js` 必须与此一一对应）

按下列顺序匹配（顺序即优先级，与需求一致）。所有 URL 类规则加 `^`、`$` 锚定并对整串 `trim()` 后匹配，规则整体加 `/i` 使域名/前缀大小写不敏感；裸编号规则保持需求原样（含前缀字符类）：

| 类型 | 正则（代码中的 JS 字面量） | 捕获 $1 |
|---|---|---|
| av | `/^(?:(?:a\|A)(?:v\|V))?([0-9]+)$/` | 纯数字 id |
| av | `/^https?:\/\/.*?bilibili.*?av([0-9]+).*?$/i` | 纯数字 id |
| bv | `/^(?:(?:b\|B)(?:v\|V))([0-9A-Za-z]+)$/` | **不含 BV 前缀**的 id |
| bv | `/^https?:\/\/.*?bilibili.*?BV([0-9A-Za-z]+).*?$/i` | **不含 BV 前缀**的 id |
| cv | `/^(?:(?:c\|C)(?:v\|V))([0-9]+)$/` | 纯数字 id |
| cv | `/^https?:\/\/.*?bilibili.*?cv([0-9]+).*?$/i` | 纯数字 id |
| live | `/^https?:\/\/live\.bilibili.*?\/([0-9]+).*?$/i` | 房间号 |
| b23 | `/^https?:\/\/b23\.tv\/([0-9A-Za-z]+).*?$/i` | 短码 |

> **BV 前缀修正（重要，与真实 API 兼容）：** 需求正则的 bv 捕获组不含 `BV` 前缀，而 B 站 `/x/web-interface/view?bvid=` 必须传完整 `BV` 前缀。因此解析器（parser）返回 `id = 捕获值`；**调用 view 接口时统一拼接 `'BV' + id`**（见 Task 4 `resolver-core.js`）。此修正不改变正则本身。
>
> 其它语义说明：纯数字输入（如 `12345`）按需求正则优先判定为 av；live 只能通过完整 `live.bilibili.com` 链接命中；`b23.tv` 链接不会命中含 `bilibili` 的 URL 规则（域名不同）。
>
> 输入不满足任何规则 → `parseInput` 返回 `null`，前端提示"无法识别的输入"（非法输入提示）。
>
> 上表单元格内的 `\|` 是 Markdown 表格转义，实际正则中的字符为 `|`（如 `(?:a|A)`）；唯一权威代码见 Task 2 Step 3 的 `shared/parser.js`。

```typescript
// 解析成功时 parseInput 返回的结构（与需求一致）
type ResolvingData = {
  type: 'av' | 'bv' | 'cv' | 'live' | 'b23',
  id: string,
}
```

### 3. 上游接口映射（逐字）

| 解析类型 | 端点 | 方法 | 参数 | 成功时取用字段 |
|---|---|---|---|---|
| av | `https://api.bilibili.com/x/web-interface/view?aid=${id}` | GET | — | `json.data.pic` `json.data.title` `json.data.desc` `json.data.owner.name` |
| bv | `https://api.bilibili.com/x/web-interface/view?bvid=${'BV' + id}` | GET | — | 同上 |
| cv | `https://api.bilibili.com/x/article/viewinfo?id=${id}` | GET | — | `json.data.banner_url` `json.data.title` `json.data.author_name`（无描述字段） |
| live | `https://api.live.bilibili.com/room/v1/Room/get_info` | **POST** | body=`id=${id}`，`Content-Type: application/x-www-form-urlencoded; charset=UTF-8` | `json.data.user_cover` `json.data.title` `json.data.uid`（无描述字段） |
| b23 | `https://b23.tv/${code}` | **HEAD**（redirect: manual）→ 读响应头 `location` | — | 用真实地址再次走 `parseInput` 后递归解析（见 Task 5） |

错误判定（所有上游接口一致）：返回 JSON 的 `code` 不为 `0` 即为失败，失败信息为 `message` 字段 → 抛 `BiliApiError(json.code, json.message)`。上游网络失败 / 非 2xx / 非 JSON → `BiliApiError(-1, ...)`。

所有上游请求必须带请求头：`User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`、`Referer: https://www.bilibili.com/`、`Accept: application/json, text/plain, */*`（规避 412 风控；仍遇 412 时给出"触发风控请稍后重试"提示）。

### 4. 归一化结果结构（`/api/resolve` 成功时 `data` 字段）

```js
{
  type: 'av' | 'bv' | 'cv' | 'live',   // b23 解析后为最终真实类型
  imageUrl: string,                    // 封面图绝对地址（可能以 // 开头）
  title: string,
  desc: string | null,                 // 仅 av/bv 有值，cv/live 为 null
  author: string | null,               // owner.name / author_name；live 为 null
  uid: string | null,                  // 仅 live 有值（json.data.uid 转字符串）
}
```

### 5. API 响应信封与错误码约定

`/api/resolve` 与 `/api/download` 都返回 `{ code, message, data }`：

| code | 含义 |
|---|---|
| `0` | 成功（`message: 'ok'`） |
| `400` | 参数缺失 / 类型不支持 / 下载地址不合法 |
| `-1` | 网络或内部错误（message 含 HTTP 状态 / 原因） |
| `-2` | b23 短链接解析失败（无 Location / 跳转过多次 / 真实地址不可识别） |
| 其它（透传） | 上游 B 站返回的 `json.code`（如 `-404`），`message` 为 `json.message` |

前端必须展示失败原因**并提示错误码**（形如 `解析失败（错误码 -404）：啥都木有`）。

### 6. 展示与平台约束

- 首页参考百度/谷歌：居中搜索框布局（输入框 + 「提取封面」按钮），回车可提交。
- `<meta name="viewport">` 必须存在；CSS 至少含 ≤480px、≤640px 断点（手机竖屏按钮换行、结果卡片上下堆叠；平板/PC 图片左信息右）。
- 解析成功后展示：封面图（`<img>` 直接热链 B 站 CDN，非代理）、类型徽标、标题、UP 主 / 主播信息（按类型展示非空字段）、`下载封面图片` 按钮（指向同源 `/api/download?url=...`）。
- 前后端同源部署，不需要 CORS 配置。
- 所有用户可见文本渲染使用转义，防 XSS（标题等内容来自第三方）。

---

## Task 1: 项目脚手架 + Express 服务壳

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `public/index.html`（占位首页，Task 8 整体替换）
- Create: `server/index.js`
- Test: `test/shell.test.js`

**Interfaces:**
- Consumes: 无（全新项目）。
- Produces: `createApp()` → Express app（静态托管 `public/`）；文件顶部 `require.main === module` 时监听 `PORT || 3000` 启动。Task 6/7/8 在其上扩展。

- [ ] **Step 1: 初始化 git 并创建 `package.json`**

```bash
git init
```

`package.json`：

```json
{
  "name": "bilicover",
  "version": "0.1.0",
  "private": true,
  "description": "Bilibili 视频/直播/专栏封面提取（前端 + Node/Express API）",
  "main": "server/index.js",
  "scripts": {
    "start": "node server/index.js",
    "dev": "node --watch server/index.js",
    "test": "node --test"
  },
  "engines": {
    "node": ">=18.13.0"
  },
  "dependencies": {
    "express": "^4.19.2"
  }
}
```

- [ ] **Step 2: 创建 `.gitignore`**

```gitignore
node_modules/
*.log
.DS_Store
package-lock.json   # yarn 项目不提交 npm 锁文件
```

- [ ] **Step 3: 安装依赖（用 yarn）**

Run: `yarn install`
Expected: 生成 `yarn.lock`，`node_modules/express` 存在，exit code 0（不要运行 npm install）。

- [ ] **Step 4: 先写失败测试 `test/shell.test.js`**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/index');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('GET / 返回首页 HTML（占位页含 BiliCover）', async () => {
  const server = await listen(createApp());
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.match(html, /BiliCover/);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 5: 运行测试确认失败**

Run: `yarn test`
Expected: FAIL —— `Error: Cannot find module '../server/index'`（`createApp` 尚不存在）。

- [ ] **Step 6: 实现服务壳 `server/index.js`**

```js
'use strict';
const path = require('path');
const express = require('express');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.static(path.join(__dirname, '..', 'public')));
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => {
    console.log(`BiliCover running at http://localhost:${port}`);
  });
}

module.exports = { createApp };
```

- [ ] **Step 7: 创建占位首页 `public/index.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>BiliCover</title>
</head>
<body>
  <h1>BiliCover</h1>
  <p>占位页：Task 8 将替换为完整界面。</p>
</body>
</html>
```

- [ ] **Step 8: 运行测试确认通过**

Run: `yarn test`
Expected: `tests 1`、`pass 1`，exit code 0。

- [ ] **Step 9: 提交**

```bash
git add .gitignore package.json yarn.lock PLAN.md public/index.html server/index.js test/shell.test.js
git commit -m "chore: scaffold express server shell with static homepage"
```

---

## Task 2: 前后端共用输入解析器 `shared/parser.js`

**Files:**
- Create: `shared/parser.js`
- Test: `test/parser.test.js`

**Interfaces:**
- Consumes: 无（纯函数，零依赖）。
- Produces: `parseInput(input: string) → { type: 'av'|'bv'|'cv'|'live'|'b23', id: string } | null`。UMD：CommonJS 导出 `module.exports = { parseInput }`；浏览器注入全局 `BiliParser.parseInput`（Task 8 前端与 Task 5 后端 b23 递归共用）。

- [ ] **Step 1: 先写失败测试 `test/parser.test.js`**

```js
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

  // ---- bv（捕获组不含 BV 前缀，见 Global Constraints §2）----
  ['BV1xx411c7mD', { type: 'bv', id: '1xx411c7mD' }],
  ['bv1xx411c7mD', { type: 'bv', id: '1xx411c7mD' }],
  ['https://www.bilibili.com/video/BV1xx411c7mD?share_source=copy_web', { type: 'bv', id: '1xx411c7mD' }],

  // ---- cv ----
  ['cv123456', { type: 'cv', id: '123456' }],
  ['https://www.bilibili.com/read/cv123456?spm_id_from=333.999.0.0', { type: 'cv', id: '123456' }],

  // ---- live ----
  ['https://live.bilibili.com/2233', { type: 'live', id: '2233' }],
  ['https://live.bilibili.com/2233?spm_id_from=333.999.0.0', { type: 'live', id: '2233' }],

  // ---- b23 ----
  ['https://b23.tv/x9ABCD', { type: 'b23', id: 'x9ABCD' }],
  ['https://b23.tv/x9ABCD?share_source=copy_web', { type: 'b23', id: 'x9ABCD' }],
];

test('parseInput 覆盖全部类型与非法输入', () => {
  for (const [input, expected] of cases) {
    assert.deepEqual(parseInput(input), expected, `input=${JSON.stringify(input)}`);
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/parser.test.js`
Expected: FAIL —— `Cannot find module '../shared/parser'`。

- [ ] **Step 3: 实现 `shared/parser.js`**（正则与 Global Constraints §2 表逐条对应）

```js
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
  const PATTERNS = [
    { type: 'av', re: /^(?:(?:a|A)(?:v|V))?([0-9]+)$/ },
    { type: 'av', re: /^https?:\/\/.*?bilibili.*?av([0-9]+).*?$/i },
    { type: 'bv', re: /^(?:(?:b|B)(?:v|V))([0-9A-Za-z]+)$/ },
    { type: 'bv', re: /^https?:\/\/.*?bilibili.*?BV([0-9A-Za-z]+).*?$/i },
    { type: 'cv', re: /^(?:(?:c|C)(?:v|V))([0-9]+)$/ },
    { type: 'cv', re: /^https?:\/\/.*?bilibili.*?cv([0-9]+).*?$/i },
    { type: 'live', re: /^https?:\/\/live\.bilibili.*?\/([0-9]+).*?$/i },
    { type: 'b23', re: /^https?:\/\/b23\.tv\/([0-9A-Za-z]+).*?$/i },
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/parser.test.js`
Expected: `tests 1`、`pass 1`（内部含 20+ 断言），exit code 0。

- [ ] **Step 5: 提交**

```bash
git add shared/parser.js test/parser.test.js
git commit -m "feat: shared input parser for av/bv/cv/live/b23"
```

---

## Task 3: 上游 HTTP 客户端 `server/bilibili.js`

**Files:**
- Create: `server/bilibili.js`
- Test: `test/bilibili.test.js`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `class BiliApiError extends Error`（字段 `code`）。
  - `httpJson(url, { method = 'GET', form = null, fetchFn = fetch }) → Promise<object>`：带 UA/Referer/Accept 头请求上游并返回解析后的 JSON；网络异常 / 非 2xx（412 有专门提示）/ 非 JSON 均抛 `BiliApiError`。
  - `BASE_HEADERS` 常量。
  - `fetchFn` 可注入 —— Task 4/5/6/7 全部测试用它打桩，运行时缺省用 Node 全局 `fetch`。

- [ ] **Step 1: 先写失败测试 `test/bilibili.test.js`**

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/bilibili.test.js`
Expected: FAIL —— `Cannot find module '../server/bilibili'`。

- [ ] **Step 3: 实现 `server/bilibili.js`**

```js
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/bilibili.test.js`
Expected: `tests 5`、`pass 5`，exit code 0。

- [ ] **Step 5: 提交**

```bash
git add server/bilibili.js test/bilibili.test.js
git commit -m "feat: upstream http client with BiliApiError"
```

---

## Task 4: av/bv/cv/live 解析与字段归一化 `server/resolver-core.js`

**Files:**
- Create: `server/resolver-core.js`
- Test: `test/resolver-core.test.js`

**Interfaces:**
- Consumes: `BiliApiError`、`httpJson`（Task 3，签名见上）。
- Produces: `resolveKind(kind, id, fetchFn = fetch) → Promise<NormalizedResult>`，`kind ∈ 'av' | 'bv' | 'cv' | 'live'`，其它值抛 `BiliApiError(400, '不支持的类型：' + kind)`。返回结构见 Global Constraints §4。bv 在此拼接 `'BV' + id` 作为 `bvid` 参数。

- [ ] **Step 1: 先写失败测试 `test/resolver-core.test.js`**（含上游字段 fixture 与错误码透传断言）

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/resolver-core.test.js`
Expected: FAIL —— `Cannot find module '../server/resolver-core'`。

- [ ] **Step 3: 实现 `server/resolver-core.js`**

```js
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

module.exports = { resolveKind };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/resolver-core.test.js`
Expected: `tests 6`、`pass 6`，exit code 0。

- [ ] **Step 5: 提交**

```bash
git add server/resolver-core.js test/resolver-core.test.js
git commit -m "feat: normalize av/bv/cv/live from bilibili apis"
```

---

## Task 5: 总调度 + b23 短链接跟随 `server/resolver.js`

**Files:**
- Create: `server/resolver.js`
- Test: `test/resolver.test.js`

**Interfaces:**
- Consumes: `parseInput`（Task 2）、`BiliApiError`（Task 3）、`resolveKind`（Task 4）。
- Produces: `resolve(type, id, fetchFn = fetch) → Promise<NormalizedResult>`：`type === 'b23'` 时对 `https://b23.tv/${id}` 发 `HEAD`（`redirect: 'manual'`）读 `location`，HEAD 拿不到 Location 时用 `GET` 重试一次；得到真实地址后再次 `parseInput`，若是 b23 递归（上限 3 跳），否则交给 `resolveKind`。非 b23 类型直接交给 `resolveKind`。

- [ ] **Step 1: 先写失败测试 `test/resolver.test.js`**

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/resolver.test.js`
Expected: FAIL —— `Cannot find module '../server/resolver'`。

- [ ] **Step 3: 实现 `server/resolver.js`**

```js
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/resolver.test.js`
Expected: `tests 5`、`pass 5`，exit code 0。

- [ ] **Step 5: 提交**

```bash
git add server/resolver.js test/resolver.test.js
git commit -m "feat: resolve dispatcher with b23 short-link following"
```

---

## Task 6: HTTP API `GET /api/resolve`（统一响应信封）

**Files:**
- Modify: `server/index.js`（整体替换为下方内容，新增依赖注入 `createApp({ fetchFn })`）
- Test: `test/api-resolve.test.js`

**Interfaces:**
- Consumes: `resolve`（Task 5）、`BiliApiError`（Task 3）。
- Produces: `GET /api/resolve?type=<av|bv|cv|live|b23>&id=<id>` → `{ code, message, data }`（信封与错误码见 Global Constraints §5）。`type`/`id` 缺失返回 `code 400`。所有上游/业务异常都被捕获并转换为信封（不抛 500）。

- [ ] **Step 1: 先写失败测试 `test/api-resolve.test.js`**

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/api-resolve.test.js`
Expected: FAIL —— 此时 `server/index.js` 还没有 `/api/resolve` 路由（404，无法解析 JSON）。

- [ ] **Step 3: 将 `server/index.js` 整体替换为以下内容**

```js
'use strict';
const path = require('path');
const express = require('express');
const { BiliApiError } = require('./bilibili');
const { resolve } = require('./resolver');

function createApp({ fetchFn = fetch } = {}) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/resolve', async (req, res) => {
    const type = typeof req.query.type === 'string' ? req.query.type.trim() : '';
    const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
    if (!type || !id) {
      return res.json({ code: 400, message: '缺少参数：type 和 id 均为必填', data: null });
    }
    try {
      const data = await resolve(type, id, fetchFn);
      res.json({ code: 0, message: 'ok', data });
    } catch (err) {
      const code = err instanceof BiliApiError ? err.code : -1;
      const message = err instanceof Error ? err.message : String(err);
      res.json({ code, message, data: null });
    }
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => {
    console.log(`BiliCover running at http://localhost:${port}`);
  });
}

module.exports = { createApp };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/api-resolve.test.js`
Expected: `tests 6`、`pass 6`，exit code 0。

- [ ] **Step 5: 回归 Task 1 的壳测试仍通过**

Run: `node --test test/shell.test.js`
Expected: `pass 1`，exit code 0。

- [ ] **Step 6: 提交**

```bash
git add server/index.js test/api-resolve.test.js
git commit -m "feat: GET /api/resolve with unified envelope"
```

---

## Task 7: HTTP API `GET /api/download`（图片代理下载）

**Files:**
- Modify: `server/index.js`（整体替换为下方内容：新增下载路由与图片校验辅助函数）
- Test: `test/api-download.test.js`

**Interfaces:**
- Consumes: `fetchFn`（依赖注入，同 Task 6）。
- Produces: `GET /api/download?url=<encodeURIComponent(封面绝对地址)>` → 上游图片字节流，响应头带 `Content-Type`（透传上游）与 `Content-Disposition: attachment`（文件名取 URL 末段，缺扩展名时按 Content-Type 推断，缺省 `cover.jpg`）。仅允许 `http(s)` 且主机为 `hdslb.com` / `biliimg.com` 及其子域（防开放代理滥用）；不合法返回 HTTP 400 `{ code: 400 }`，上游失败返回 HTTP 502 `{ code: -1 }`。

- [ ] **Step 1: 先写失败测试 `test/api-download.test.js`**

```js
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/index');

let server;
let base;

async function stubFetch(url) {
  const u = String(url);
  if (u.includes('i0.hdslb.com')) {
    return new Response('FAKE-IMAGE-BYTES', {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    });
  }
  throw new Error('unexpected url: ' + u);
}

before(async () => {
  server = createApp({ fetchFn: stubFetch }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => new Promise((resolve) => server.close(resolve)));

test('下载成功：attachment 头 + 图片字节', async () => {
  const url =
    base + '/api/download?url=' + encodeURIComponent('https://i0.hdslb.com/bfs/archive/cover.jpg');
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment/);
  assert.match(res.headers.get('content-type'), /image\/jpeg/);
  assert.equal(await res.text(), 'FAKE-IMAGE-BYTES');
});

test('非 hdslb 主机返回 400 code=400', async () => {
  const url =
    base + '/api/download?url=' + encodeURIComponent('https://evil.example.com/x.jpg');
  const res = await fetch(url);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 400);
});

test('缺少 url 参数返回 400', async () => {
  const res = await fetch(base + '/api/download');
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/api-download.test.js`
Expected: FAIL —— `/api/download` 路由不存在（404）。

- [ ] **Step 3: 将 `server/index.js` 整体替换为以下内容**

```js
'use strict';
const path = require('path');
const express = require('express');
const { BiliApiError } = require('./bilibili');
const { resolve } = require('./resolver');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 只允许 B 站图片 CDN，避免把本接口变成开放代理
const ALLOWED_HOST_SUFFIXES = ['hdslb.com', 'biliimg.com'];

function isAllowedImageUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((s) => host === s || host.endsWith('.' + s));
}

function imageFilenameFromContentType(contentType) {
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
  };
  return map[contentType] || null;
}

function createApp({ fetchFn = fetch } = {}) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/resolve', async (req, res) => {
    const type = typeof req.query.type === 'string' ? req.query.type.trim() : '';
    const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
    if (!type || !id) {
      return res.json({ code: 400, message: '缺少参数：type 和 id 均为必填', data: null });
    }
    try {
      const data = await resolve(type, id, fetchFn);
      res.json({ code: 0, message: 'ok', data });
    } catch (err) {
      const code = err instanceof BiliApiError ? err.code : -1;
      const message = err instanceof Error ? err.message : String(err);
      res.json({ code, message, data: null });
    }
  });

  app.get('/api/download', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    if (!rawUrl || !isAllowedImageUrl(rawUrl)) {
      return res.status(400).json({ code: 400, message: '图片地址不合法', data: null });
    }
    let upstream;
    try {
      upstream = await fetchFn(rawUrl, {
        headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' },
      });
    } catch (err) {
      return res.status(502).json({ code: -1, message: '图片下载失败：' + err.message, data: null });
    }
    if (!upstream.ok) {
      return res.status(502).json({ code: -1, message: '图片下载失败：HTTP ' + upstream.status, data: null });
    }
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';

    let filename = '';
    try {
      filename = decodeURIComponent(new URL(rawUrl).pathname.split('/').pop() || '');
    } catch {
      filename = '';
    }
    if (!filename.includes('.')) {
      const ext = imageFilenameFromContentType(contentType);
      filename = (filename || 'cover') + '.' + (ext || 'jpg');
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(filename));
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => {
    console.log(`BiliCover running at http://localhost:${port}`);
  });
}

module.exports = { createApp };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/api-download.test.js`
Expected: `tests 3`、`pass 3`，exit code 0。

- [ ] **Step 5: 全量回归（此时已有 7 个测试文件）**

Run: `yarn test`
Expected: 全部通过（shell 1 + parser 1 + bilibili 5 + resolver-core 6 + resolver 5 + api-resolve 6 + api-download 3 = `tests 27`、`pass 27`），exit code 0。

- [ ] **Step 6: 提交**

```bash
git add server/index.js test/api-download.test.js
git commit -m "feat: GET /api/download image proxy"
```

---

## Task 8: 前端界面（首页布局 + 解析展示 + 下载 + 多端适配）

**Files:**
- Modify: `public/index.html`（整体替换占位页）
- Create: `public/style.css`
- Create: `public/app.js`
- Modify: `server/index.js`（仅新增 `/parser.js` 静态路由，供前端复用解析器）

**Interfaces:**
- Consumes: `/parser.js`（Task 2 的 `shared/parser.js`，经 Express 静态暴露为全局 `BiliParser`）、`GET /api/resolve`（Task 6）、`GET /api/download`（Task 7）。
- Produces: 完成整条用户链路（输入 → 校验 → 请求 → 展示 → 下载 → 错误提示）以及 PC/手机/平板的响应式布局。本任务无自动化测试，以 Step 5 手工验收清单为准。

- [ ] **Step 1: 为 `server/index.js` 增加 `/parser.js` 路由**

在 `app.disable('x-powered-by');` 之后、`app.get('/api/resolve', ...)` 之前插入（精确 diff）：

```diff
   const app = express();
   app.disable('x-powered-by');
+
+  // 供前端复用与后端完全一致的输入解析逻辑（同一份 shared/parser.js）
+  app.get('/parser.js', (req, res) => {
+    res.sendFile(path.join(__dirname, '..', 'shared', 'parser.js'));
+  });
 
   app.get('/api/resolve', async (req, res) => {
```

- [ ] **Step 2: 自行设计 `public/index.html`（结构与样式自由发挥，仅约束契约）**

本任务**不给死代码**：页面布局、配色、动效、类名、文案由你按“参考百度/谷歌的居中搜索框”这一产品形态自由设计（B 站品牌色 #00aeec 风格可用）。HTML 必须满足以下**硬性契约**（来自 Global Constraints §6 与需求，逐条可验收）：

- `lang="zh-CN"`；`<meta charset="UTF-8">`；`<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">`（或等价写法）；`<title>` 含 BiliCover；依次引入 `/style.css`、`/parser.js`、`/app.js`（parser.js 必须先于 app.js）。
- 页面必须包含以下 **6 个元素 id**（app.js 行为契约与验收清单依赖，不得改名或缺省）：
  - `#extract-form`：提交表单（回车可提交）；
  - `#url-input`：输入框（粘贴 B 站链接或编号，`autocomplete="off"`）；
  - `#extract-btn`：`type="submit"` 的「提取封面」按钮；
  - `#input-error`：输入校验错误提示（初始 `hidden`，`role="alert"`）；
  - `#loading`：解析中状态（初始 `hidden`）；
  - `#result`：结果/错误面板容器（初始 `hidden`）。
- 结果区（`#result`，由 app.js 渲染）与错误面板的 UI 由 app.js 生成 HTML，故 CSS 需覆盖：封面图、类型徽标、信息行（标题/简介/UP主/UID）、下载按钮、错误面板这几类元素在桌面/平板/手机下都美观可用。
- `#result` 下方或页脚可加一句支持范围说明（如：视频 av/BV · 专栏 cv · 直播间 live · b23 短链接）。

- [ ] **Step 3: 自行设计 `public/style.css`（响应式断点为硬性要求）**

视觉风格自由，但必须满足：
- 首页参考百度/谷歌：输入框与「提取封面」按钮居中成行；按钮主色、输入框圆角/聚焦态美观即可。
- 至少包含 **≤480px** 与 **≤640px** 两个断点：≤480px 时输入框与按钮**纵向堆叠且按钮占满整行**（手机竖屏）；≤640px 时结果卡片**图片在上、文字信息在下**堆叠；桌面/平板宽屏时结果卡**图片在左、信息在右**。
- 任意宽度（≥320px）**无横向滚动**；图片自适应容器宽度并保持比例；下载按钮、错误面板有基础样式；结果出现时可加轻量淡入过渡（可选）。
- 若使用了自定义字体栈，回退到系统字体即可，避免引入外部资源（离线可用）。

- [ ] **Step 4: 创建 `public/app.js`（行为契约；具体实现方式可自定）**

必须实现并可逐条验证以下行为：
- 用全局 `window.BiliParser.parseInput(input)`（来自 `/parser.js`，与后端同一份正则）校验输入；返回 `null` 时在 `#input-error` 提示“无法识别的输入”，**不发请求**，并把焦点还给输入框。
- 校验通过后以 `GET /api/resolve?type=<type>&id=<id>`（用 `URLSearchParams` 构造）请求，读信封 `{ code, message, data }`：`code === 0` → 渲染成功结果；否则 → 渲染错误面板。
- 成功渲染：类型徽标（`data.type`；若输入是 b23 且最终类型不同，则输入徽标与最终类型徽标都展示）；封面 `<img>` 直接热链 B 站 CDN（非代理），地址以 `//` 开头时补 `https:`；标题行；`desc` 为 `null`/空串时**不渲染简介行**；live 显示主播 UID 行（`data.uid`），其它类型有 `author` 时显示 UP主行；`<img>` 加 `referrerpolicy="no-referrer"`，`alt` 用标题兜底；提供指向同源 `下载封面图片` 链接：`/api/download?url=<encodeURIComponent(封面地址)>`（`download` 属性）。
- **XSS 防护（硬性，必须）**：所有来自 API 或用户输入的可见文本（标题、简介、作者、uid、错误 message、错误码、类型名）在拼入 HTML 前必须逐字符转义 `& < > " '` 五个字符；不得把未转义文本拼进 innerHTML。下载按钮 href 值必须经 `encodeURIComponent` 处理。
- 交互状态：提交后禁用按钮（文案如“解析中…”）并显示 `#loading`；成功/失败/网络异常（fetch 抛错、非 JSON）后恢复按钮。失败时错误面板**同时展示失败原因与错误码**，文案形态如：`解析失败（错误码 -404）：啥都木有`。
- 空输入、连点提交等边界不产生重复请求或未捕获异常；代码保持清晰、有注释，IIFE 包裹避免污染全局。

- [ ] **Step 5: 手工验收清单（本任务无自动化测试，必须逐项实测通过）**

```bash
yarn start
# 打开 http://localhost:3000
```

| # | 操作 | 期望 |
|---|---|---|
| 1 | 首页布局 | 居中搜索框 + 「提取封面」按钮（参考百度/谷歌），标题/页脚可见，无横向滚动 |
| 2 | 输入 `https://www.bilibili.com/video/BV1xx411c7mD` 回车 | 显示封面大图、类型徽标 BV 视频、标题、简介、UP主、下载按钮（用任一当前真实存在的视频链接实测更佳） |
| 3 | 输入真实 av 号 / av 链接 | 同上，徽标为 AV 视频 |
| 4 | 输入真实专栏链接 `https://www.bilibili.com/read/cv…` | 徽标为专栏文章，显示标题与作者，无简介行 |
| 5 | 输入真实直播间地址 `https://live.bilibili.com/房间号` | 徽标为直播间，显示标题与主播 UID，无简介行 |
| 6 | 用 B 站客户端分享复制一条 `https://b23.tv/…` 短链 | 徽标显示 b23 短链接 + 最终类型徽标，信息为跳转后的真实内容 |
| 7 | 输入 `abc` / 空串 | 提示"无法识别的输入"，不发请求 |
| 8 | 输入不存在的视频号（如真实存在的错误号） | 展示错误面板：原因 + 错误码（如 `解析失败（错误码 -404）：啥都木有`） |
| 9 | 点击「下载封面图片」 | 浏览器下载图片文件（文件名来自 CDN 末段） |
| 10 | 手机宽度（DevTools 375px）与平板宽度（768px）分别打开 | ≤480px 时输入框与按钮上下堆叠且按钮占满；≤640px 结果卡图片在上、信息在下；均无横向滚动 |

> 提示：真实网络请求可能偶发 B 站 412 风控（界面会提示"触发风控，请稍后重试"），稍后重试即可，不代表代码缺陷。

- [ ] **Step 6: 回归全部自动化测试并提交**

Run: `yarn test`
Expected: 全部通过（shell 1 + parser 1 + bilibili 5 + resolver-core 6 + resolver 5 + api-resolve 6 + api-download 3 = `tests 27`、`pass 27`），exit code 0。

```bash
git add public/index.html public/style.css public/app.js server/index.js
git commit -m "feat: responsive frontend with resolve result and image download"
```

---

## Task 9: README + 全量回归 + 收尾

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: 全部已实现功能。
- Produces: 项目说明文档（启动方式、支持的输入、错误码、技术要点）。

- [ ] **Step 1: 创建 `README.md`**

```markdown
# BiliCover · B站封面提取

输入 B 站视频 / 直播 / 专栏链接或 av / BV / cv 号，一键提取封面图并下载。纯原生前端 + Node.js/Express API，零构建，支持 PC / 手机 / 平板。

## 运行

要求 Node.js ≥ 18.13，包管理器用 yarn。

    yarn install
    yarn start       # 打开 http://localhost:3000 （可用 PORT 环境变量改端口）
    yarn test        # 离线单元测试（上游请求全部打桩；Node ≥ 22 下 --test 目录参数已失效，脚本为无参发现模式）

## 支持的输入（正则识别，非法输入会提示）

- av：`12345`、`av12345`、`https://www.bilibili.com/video/av170001`
- bv：`BV1xx411c7mD`、`https://www.bilibili.com/video/BV1xx411c7mD`
- cv：`cv123456`、`https://www.bilibili.com/read/cv123456`
- live：`https://live.bilibili.com/2233`
- b23：`https://b23.tv/xxxx`

## API

- `GET /api/resolve?type=av|bv|cv|live|b23&id=…` → `{ code, message, data }`；成功时 `data` 含 `type / imageUrl / title / desc / author / uid`。`code=0` 成功；`400` 参数/类型错误；`-1` 网络错误；`-2` 短链接解析失败；其它为 B 站上游错误码透传（如 `-404`）。
- `GET /api/download?url=<封面地址>` → 代理下载图片（仅允许 B 站 CDN 域名），返回 `Content-Disposition: attachment`。

## 目录结构

- `shared/parser.js`：前后端共用的输入解析（UMD，同一份正则）
- `server/bilibili.js`：上游 HTTP 客户端 + `BiliApiError`
- `server/resolver-core.js`：av/bv/cv/live 解析与字段归一
- `server/resolver.js`：总调度（含 b23 短链接跟随）
- `server/index.js`：Express 应用与 API 路由
- `public/`：前端页面

## 技术要点

- bv 解析时向后端补全 `BV` 前缀再请求 `bvid` 参数。
- b23 用 `HEAD`（失败回退 `GET`）跟随 `Location`，真实地址再次进入同一解析器递归（上限 3 跳）。
- 上游请求统一携带 UA / Referer 以规避 412 风控。
- 所有用户可见文本渲染前转义。
```

- [ ] **Step 2: 全量回归**

Run: `yarn test`
Expected: 全部测试通过，exit code 0。
Run: `yarn start`（后台），随后 `curl -s http://localhost:3000/api/resolve?type=av&id=170001` 观察返回信封结构（真实网络，可能受 412 风控影响，属预期）。结束后停掉服务。

- [ ] **Step 3: 最终目录核对**

Run: `git status` 与 `ls -R` 确认文件齐全：`shared/parser.js`、`server/{index,bilibili,resolver-core,resolver}.js`、`public/{index.html,style.css,app.js}`、`test/*.test.js`、`README.md`。

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## 附录 A：需求 → 任务 验收矩阵（Self-Review）

| 需求点 | 覆盖 |
|---|---|
| 输入框 + 提取按钮、百度/谷歌式居中布局、多端响应式 | Task 1（壳）、Task 8（`index.html`/`style.css`） |
| 支持 av / bv / cv / live / b23 五种输入 | Task 2（正则表） |
| 正则不满足时提示非法输入 | Task 2（返回 null）+ Task 8（前端提示） |
| 得到 `{ type, id }` 交后端 | Task 6（`/api/resolve?type=&id=`） |
| av/bv → view 接口（`aid`/`bvid`，bv 补 BV 前缀） | Task 4 |
| cv → article viewinfo | Task 4 |
| live → `get_info` POST `id=` 表单 | Task 4 |
| `json.code !== 0` → 失败，`message` 为失败信息 | Task 3/4（`checkUpstream`） |
| b23 → HEAD 取 `location` 再解析 | Task 5 |
| 展示图片 + 标题/简介/UP主（live 显示主播 UID） | Task 4（归一化）+ Task 8（渲染） |
| 下载图片按钮 | Task 7（代理下载）+ Task 8（按钮） |
| 失败告知原因并提示错误码 | Task 6（信封）+ Task 8（错误面板） |
| 标题等第三方文本 XSS 防护 | Task 8（`esc` 转义） |
| 全程离线可测 | 各 Task 依赖注入 `fetchFn`，stub 测试 |

**说明（实现时必须保留的规范偏差）：** 唯一与"逐字正则"语义不同的是 bv 的 `bvid` 参数需要完整 `BV` 前缀（需求正则捕获组不含前缀），已在 Global Constraints §2 与本计划全部相关代码中显式补全，属于与真实 B 站 API 兼容的必要修正，不影响输入解析结果本身。
