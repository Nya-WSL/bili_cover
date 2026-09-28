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
- bangumi（番剧）：`ep12345` / `ss67890` / `https://www.bilibili.com/bangumi/play/ep12345`
- b23：`https://b23.tv/xxxx`

## API

- `GET /api/resolve?type=av|bv|cv|live|bangumi|b23&id=…` → `{ code, message, data }`；成功时 `data` 含 `type / imageUrl / title / desc / author / uid`（番剧 `desc` 取简介 `evaluate`，`author`/`uid` 为 null）。`code=0` 成功；`400` 参数/类型错误；`-1` 网络错误；`-2` 短链接解析失败；其它为 B 站上游错误码透传（如 `-404`）。
- `GET /api/download?url=<封面地址>` → 代理下载图片（仅允许 B 站 CDN 域名），返回 `Content-Disposition: attachment`。

## 部署到 Vercel

Vercel 的 Serverless Functions 可直接运行现有 Express 后端，无需 CORS 代理、无需改写代码。

1. 导入仓库到 Vercel（Framework Preset 选 **Other** 即可）。
2. 无需额外构建命令与输出目录：
   - `api/app.js` 作为函数入口，导出 `createApp()`；
   - `vercel.json` 用一条 catch-all rewrite 把所有请求（静态资源 + `/api/*`）转发给该 Express 应用统一处理。
3. 部署完成后，`/` 是首页，`/api/resolve`、`/api/download` 与本地行为完全一致。

> 本地仍用 `yarn start` 启动单机服务；Vercel 仅加载 `api/app.js` 作为函数，二者共用同一份 `server/` 代码。

## 目录结构

- `api/app.js`：Vercel Serverless Function 入口（导出 Express 应用）
- `vercel.json`：catch-all rewrite，将请求转发到 Express 函数
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
