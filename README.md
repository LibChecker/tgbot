# tgbot (Cloudflare Workers)

这个项目面向 **Cloudflare Workers** 部署，提供一个 Telegram Bot 的 `/apkinfo` 能力。

用户使用方式：

1. 私聊机器人时，直接发送或转发一个 `.apk` 文件消息，Bot 会自动解析。
2. 在群组或频道里：
   - 可以直接发送一个 `.apk` 文件消息，Bot 会自动解析
   - 可以直接发送带 `.apk` 的消息，并把 `/apkinfo` 或 `/apkinfo@你的bot用户名` 写在 caption 的任意位置
   - 或者回复一个带 `.apk` 的消息，再发送 `/apkinfo`
   - 也可以在消息里直接 `@bot用户名` 并附带 APK，或回复 APK 后 `@bot用户名`
   - 转发自其他频道或群组、且自带 `.apk` 的消息会尽量自动解析，但这类消息在群组里是否能拿到文件对象受 Telegram Bot API 限制影响
   - 文件消息可以同时带说明文字，命令前后有额外文本也能正常解析
3. Bot 返回一个简短摘要，并附带“打开完整报告”按钮。
4. 完整报告通过 Worker 报告页打开；Worker 会再从 Telegraph 拉取内容并渲染成更适合阅读的详情页。
5. 也可以直接发送 APK 下载链接；Bot 会尝试用 HTTP Range 只下载 ZIP 尾部、中央目录、`AndroidManifest.xml` 和少量 metadata 来生成预览报告，不会主动完整下载 APK。
6. 超过 Telegram Bot API 20MB 下载限制的 APK，可以发送 `/upload` 打开 Worker 网页上传入口，直接上传到 Worker 解析。
7. 完整信息会展示在报告页中：
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
8. Bot 会根据 Telegram 用户的 `language_code` 在中文和英文之间自动切换；Worker 报告页也会跟随同一语言。

## 实现说明

- 运行方式：Telegram webhook + Cloudflare Workers。
- APK 解析：纯 JavaScript，在 Worker 内直接解析 `AndroidManifest.xml` 与 `resources.arsc`。
- 展示方式：Telegram 消息仅返回摘要，完整结果通过 Worker 报告页展示；Telegraph 作为内容存储层，Worker 负责渲染更完整的 UI。
- 国际化：当前已支持中文和英文；Telegram 回复、命令描述、Telegraph 内容与 Worker 报告页会基于用户语言自动切换。
- 大文件入口：`/upload` 网页直接接收 APK 上传并解析，用来绕过 Telegram Bot API `getFile` 的 20MB 文件下载限制；默认建议上限为 `90MB`，仍受 Cloudflare Worker 请求体和内存限制影响。
- 链接预览：收到 APK 下载链接时会参考 LibChecker `ApkPreview` 的思路，优先使用 HTTP Range 拉取 ZIP 尾部、中央目录和 `AndroidManifest.xml`；原生库列表直接从中央目录提取，构建特性只解析可通过 ZIP 条目或小型 metadata 判断的部分。若远端不支持 Range 或不返回 `Content-Length`，Worker 会拒绝解析，避免意外完整下载大文件。
- 信息维度：参考 LibChecker 常见 APK 分析视图，输出构建特性、原生库、组件、权限和 application 级 `meta-data`。
- SDK 标记：原生库与组件会结合 [LibChecker-Rules-Bundle](https://github.com/LibChecker/LibChecker-Rules-Bundle) 规则库匹配 SDK 名称、图标，并生成分布图表；组件匹配逻辑对齐 `DetailViewModel`，优先按类名规则匹配，失败时再用 `intent-filter action` 兜底。
- 可观测性：已启用 Cloudflare Workers Observability，并增加结构化 JSON 日志、关键业务埋点、Analytics Engine 数据集与 Worker 版本元数据，便于在后台查看请求量、解析成功率、报告打开量和失败原因。
- 不再依赖 Python、轮询进程或 `androguard`。
- 自带受保护的 webhook 管理接口，可直接通过 Worker 自动注册 Telegram webhook。
- 自带受保护的命令管理接口，可直接同步 Telegram 的 `/` 命令菜单。
- 已支持 `message`、`edited_message`、`channel_post`、`edited_channel_post` 这几类更新。

> 如果应用名来自资源表，Worker 会尽量解析出真实名称；如果资源表异常，会回退显示资源 ID。
>
> 受 Telegram 官方 Bot API 当前限制，这种部署方式下只能直接下载并解析不超过 `20MB` 的 APK。
>
> 如果 APK 超过 `20MB`，请使用 `/upload` 或直接打开 `https://你的域名/upload`。这条链路不经过 Telegram 文件下载接口，因此可以绕过 Bot API 的 `20MB` 限制。
>
> Telegram 群组里的消息能否送达到 bot，受 Privacy Mode 影响很大。开启 Privacy Mode 时，最稳的是使用 `/apkinfo@你的bot用户名`；如果你希望普通 `@bot`、普通转发消息或更自然的群聊交互都能工作，需要在 `@BotFather` 中关闭该 Bot 的 Privacy Mode。频道里则需要把 Bot 设为管理员。
>
> 对于“群组里回复一条转发来的 APK 再让 bot 解析”这类场景，即使 bot 已经在群里、也拿到了命令消息，Telegram 也不一定会把原始 `document/file_id` 一并交给 bot。Worker 端无法凭消息 ID 再次向 Bot API 拉取任意历史消息，所以这类转发消息无法保证稳定解析。最稳的方式仍然是直接在群里发送 APK 文件，或私聊 bot 再转发 APK。

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

可选：调整网页上传入口的建议解析上限，单位为 MB。默认是 `90`。

```toml
[vars]
MAX_DIRECT_UPLOAD_MB = "90"
```

可选：调整链接预览的 Range 解析保护阈值，单位为 MB。默认分别是中央目录 `16`、单个压缩条目 `24`、`resources.arsc` `12`。

```toml
[vars]
MAX_LINK_PREVIEW_CD_MB = "16"
MAX_LINK_PREVIEW_ENTRY_MB = "24"
MAX_LINK_PREVIEW_RESOURCE_MB = "12"
```

### 3. 可选配置公开地址

如果你希望 webhook 固定指向某个 URL，可以在 [wrangler.toml](wrangler.toml) 里加：

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

## 日志与用量观测

部署后，Worker 会自动输出结构化 JSON 日志到 Cloudflare Workers 的日志后台，并同时把关键业务事件写入 `tgbot_usage` Analytics Engine 数据集。

建议重点筛选这些事件名：

- `webhook.accepted`
- `telegram.update.received`
- `apk.analysis.succeeded`
- `apk.analysis.failed`
- `apk.link_analysis.succeeded`
- `apk.link_analysis.failed`
- `apk.analysis.skipped_too_large`
- `apk.target_missing`
- `report.viewed`
- `admin.webhook.set`
- `admin.commands.set`

日志和埋点里会尽量附带这些字段，方便你在后台按维度筛：

- `request_id`
- `route`
- `update_type`
- `chat_type`
- `chat_id`
- `command`
- `package_name`
- `file_name`
- `report_path`
- `duration_ms`
- `file_size_bytes`
- `content_length_bytes`
- `downloaded_bytes`
- `range_request_count`
- `permissions_count`
- `native_library_count`
- `component_count`
- `sdk_native_match_count`
- `sdk_component_match_count`
- `error_name`
- `error_message`

如果后面流量上来了，可以把 [wrangler.toml](wrangler.toml) 里的 `head_sampling_rate` 从 `1` 调低，减少日志采样量。

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

项目还带了一个本地脚本 [scripts/manage-webhook.mjs](scripts/manage-webhook.mjs)，可以直接调用 Worker 的管理接口，所以不需要手写 `curl`。

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

项目已新增工作流 [deploy.yml](.github/workflows/deploy.yml)：

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

仓库新增了 [.dev.vars.example](.dev.vars.example)，你可以复制成 `.dev.vars` 后本地调试：

```text
BOT_TOKEN=...
ADMIN_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...
PUBLIC_WEBHOOK_URL=https://your-worker.your-subdomain.workers.dev
```

## 更新规则库

项目已经内置了规则库生成脚本 [generate_libchecker_bundle.py](scripts/generate_libchecker_bundle.py)。以后如果 [LibChecker-Rules-Bundle](https://github.com/LibChecker/LibChecker-Rules-Bundle) 有更新，直接执行：

```bash
npm run rules:update
```

这条命令会直接从 GitHub 上的 `LibChecker-Rules-Bundle` 仓库拉取最新规则与图标资源，不再依赖仓库里的本地 `tmp_rules.db` 中间文件。执行时会自动：

1. 下载最新的 `rules.db`
2. 重新生成：
   - [src/generated/libchecker-rules.js](src/generated/libchecker-rules.js)
   - [src/generated/libchecker-sdk-icons.js](src/generated/libchecker-sdk-icons.js)

如果你想固定到某个分支、tag 或 commit，也可以直接运行：

```bash
python scripts/generate_libchecker_bundle.py --ref main
python scripts/generate_libchecker_bundle.py --ref <tag-or-commit>
```

建议更新完规则后再跑一次：

```bash
npm run check
```

## 项目结构

```text
src/
  apk.js      # APK / AndroidManifest / resources.arsc 解析
  index.js    # Cloudflare Worker 入口、Telegram webhook、管理接口
  observability.js # 结构化日志与 Analytics Engine 埋点
wrangler.toml
```
