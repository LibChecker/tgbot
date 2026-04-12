# tgbot (Cloudflare Workers)

这个项目面向 **Cloudflare Workers** 部署，提供一个 Telegram Bot 的 `/apkinfo` 能力。

用户使用方式：

1. 私聊机器人时，直接发送或转发一个 `.apk` 文件消息，Bot 会自动解析。
2. 在群组或频道里：
   - 可以直接发送带 `.apk` 的消息，并把 `/apkinfo` 或 `/apkinfo@你的bot用户名` 写在 caption 的任意位置
   - 或者回复一个带 `.apk` 的消息，再发送 `/apkinfo`
   - 也可以在消息里直接 `@bot用户名` 并附带 APK，或回复 APK 后 `@bot用户名`
   - 转发自其他频道或群组、且自带 `.apk` 的消息，也会自动解析
   - 文件消息可以同时带说明文字，命令前后有额外文本也能正常解析
3. Bot 返回一个简短摘要，并附带“打开完整报告”按钮。
4. 私聊场景下会优先通过 Telegram `web_app` 打开 Worker 自带的报告页；Telegraph 作为存储和备用链接保留。
5. 完整信息会展示在报告页中：
   - 应用名
   - 包名
   - versionName / versionCode
   - Target / Min / Compile SDK
   - 构建特性（Kotlin / Compose / Gradle / AGP，能解析到版本时会直接显示版本）
   - 原生库列表（按 ABI 分组）
   - 组件（Activity / Service / Receiver / Provider）
   - 基于 LibChecker-Rules-Bundle 的原生库 / 组件 SDK 标记、图标与分布图表
   - 权限数量
   - 完整权限列表
   - application 级 `meta-data`（字符串资源引用会尽量解析成人类可读文本）

## 实现说明

- 运行方式：Telegram webhook + Cloudflare Workers。
- APK 解析：纯 JavaScript，在 Worker 内直接解析 `AndroidManifest.xml` 与 `resources.arsc`。
- 展示方式：Telegram 消息仅返回摘要，完整结果优先通过 Worker 自带报告页展示，Telegraph 作为存储与备用链接。
- 信息维度：参考 LibChecker 常见 APK 分析视图，输出构建特性、原生库、组件、权限和 application 级 `meta-data`。
- SDK 标记：原生库与组件会结合 [LibChecker-Rules-Bundle](https://github.com/LibChecker/LibChecker-Rules-Bundle) 规则库匹配 SDK 名称、图标，并生成分布图表；组件匹配逻辑对齐 `DetailViewModel`，优先按类名规则匹配，失败时再用 `intent-filter action` 兜底。
- 不再依赖 Python、轮询进程或 `androguard`。
- 自带受保护的 webhook 管理接口，可直接通过 Worker 自动注册 Telegram webhook。
- 自带受保护的命令管理接口，可直接同步 Telegram 的 `/` 命令菜单。
- 已支持 `message`、`edited_message`、`channel_post`、`edited_channel_post` 这几类更新。

> 如果应用名来自资源表，Worker 会尽量解析出真实名称；如果资源表异常，会回退显示资源 ID。
>
> 受 Telegram 官方 Bot API 当前限制，这种部署方式下只能直接下载并解析不超过 `20MB` 的 APK。
>
> Telegram 群组里的消息能否送达到 bot，受 Privacy Mode 影响很大。开启 Privacy Mode 时，最稳的是使用 `/apkinfo@你的bot用户名`；如果你希望普通 `@bot`、普通转发消息或更自然的群聊交互都能工作，需要在 `@BotFather` 中关闭该 Bot 的 Privacy Mode。频道里则需要把 Bot 设为管理员。

## 部署

### 1. 安装依赖

```bash
npm install
```

首次安装后请把 `package-lock.json` 一起提交到仓库；GitHub Actions 使用的是 `npm ci`。

### 2. 配置 Secrets

配置 Telegram Bot Token：

```bash
npx wrangler secret put BOT_TOKEN
```

可选：配置 Telegram webhook 校验密钥。配置后，Worker 会校验请求头中的 `X-Telegram-Bot-Api-Secret-Token`。

```bash
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

配置管理员 Token。这个 token 用于调用 Worker 自带的 webhook 管理接口。

```bash
npx wrangler secret put ADMIN_TOKEN
```

可选：配置一个固定的 Telegraph access token。若不配置，Worker 会自动创建并缓存一个 Telegraph 账号来发页。

```bash
npx wrangler secret put TELEGRAPH_ACCESS_TOKEN
```

### 3. 可选配置公开地址

如果你希望 webhook 固定指向某个 URL，可以在 [wrangler.toml](</C:/Users/Absinthe/Documents/GitHub/tgbot/wrangler.toml:1>) 里加：

```toml
[vars]
PUBLIC_WEBHOOK_URL = "https://your-worker.your-subdomain.workers.dev"
```

如果不配置，Worker 会默认用你当前请求的域名自动拼出 `https://<当前域名>/webhook`。

### 4. 本地调试

```bash
npm run dev
```

### 5. 部署到 Cloudflare Workers

```bash
npm run deploy
```

部署成功后，假设你的 Worker 地址是：

```text
https://your-worker.your-subdomain.workers.dev
```

## 自动管理 Webhook

Worker 提供了 webhook 与命令菜单管理接口，全部需要管理员鉴权：

- `GET /admin/webhook`
- `POST /admin/webhook/set`
- `POST /admin/webhook/delete`
- `GET /admin/commands`
- `POST /admin/commands/set`
- `POST /admin/commands/delete`

鉴权方式二选一：

- 请求头 `Authorization: Bearer <ADMIN_TOKEN>`
- 请求头 `X-Admin-Token: <ADMIN_TOKEN>`

### 1. 注册 webhook

```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/admin/webhook/set" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d "{}"
```

如果想清空 Telegram 端已经积压的旧消息，可以这样：

```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/admin/webhook/set" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d "{\"drop_pending_updates\":true}"
```

如果你想临时指定一个不同地址，也可以传 `url`：

```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/admin/webhook/set" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://example.com/webhook\"}"
```

### 2. 查看 webhook 状态

```bash
curl "https://your-worker.your-subdomain.workers.dev/admin/webhook" \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

### 3. 删除 webhook

```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/admin/webhook/delete" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d "{\"drop_pending_updates\":true}"
```

## 一条命令部署并注册

项目还带了一个本地脚本 [scripts/manage-webhook.mjs](</C:/Users/Absinthe/Documents/GitHub/tgbot/scripts/manage-webhook.mjs:1>)，可以直接调用 Worker 的管理接口，所以不需要手写 `curl`。

先在 PowerShell 里设置本地环境变量：

```powershell
$env:WORKER_URL="https://your-worker.your-subdomain.workers.dev"
$env:ADMIN_TOKEN="<你的 ADMIN_TOKEN>"
```

然后直接部署并注册 webhook：

```bash
npm run deploy:setup
```

这条命令现在还会一并同步 Telegram 的 `/` 命令菜单。

如果你只想单独注册 webhook：

```bash
npm run webhook:set
```

查看当前 webhook 状态：

```bash
npm run webhook:info
```

删除当前 webhook：

```bash
npm run webhook:delete
```

同步命令菜单：

```bash
npm run commands:set
```

查看当前命令菜单：

```bash
npm run commands:info
```

如果想额外传参，也支持这样：

```bash
npm run webhook:set -- --worker-url=https://your-worker.your-subdomain.workers.dev --admin-token=<你的ADMIN_TOKEN> --drop-pending-updates=true
```

如果你想让 webhook 指向另一个地址：

```bash
npm run webhook:set -- --worker-url=https://your-worker.your-subdomain.workers.dev --admin-token=<你的ADMIN_TOKEN> --webhook-url=https://example.com/webhook
```

## GitHub Actions 自动部署

项目已新增工作流 [deploy.yml](</C:/Users/Absinthe/Documents/GitHub/tgbot/.github/workflows/deploy.yml:1>)：

- PR 到 `main` / `master` 时自动执行 `npm ci` 和 `npm run check`
- push 到 `main` / `master` 时自动部署到 Cloudflare Workers
- 部署后自动同步 Worker secrets
- 如果配置了 `WORKER_URL`，还会自动调用 Worker 管理接口注册 Telegram webhook

你需要在 GitHub 仓库里配置这些 **Actions secrets**：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `BOT_TOKEN`
- `ADMIN_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAPH_ACCESS_TOKEN`

其中 `TELEGRAM_WEBHOOK_SECRET` 严格来说可以不配，但为了让 webhook 校验始终开启，建议也放进 GitHub secrets。

另外建议配置一个 **Actions variable**：

- `WORKER_URL`

示例值：

```text
https://your-worker.your-subdomain.workers.dev
```

如果没有配置 `WORKER_URL`，工作流仍会部署 Worker，只是不会自动注册 webhook。

## 本地开发变量模板

仓库新增了 [.dev.vars.example](</C:/Users/Absinthe/Documents/GitHub/tgbot/.dev.vars.example:1>)，你可以复制成 `.dev.vars` 后本地调试：

```text
BOT_TOKEN=...
ADMIN_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...
PUBLIC_WEBHOOK_URL=https://your-worker.your-subdomain.workers.dev
```

## 项目结构

```text
src/
  apk.js      # APK / AndroidManifest / resources.arsc 解析
  index.js    # Cloudflare Worker 入口、Telegram webhook、管理接口
wrangler.toml
```
