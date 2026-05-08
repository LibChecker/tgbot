# tgbot APK WebUI (Cloudflare Pages)

一个独立的 Cloudflare Pages 静态项目，复用主项目的 APK 解析器和 LibChecker 规则，在浏览器本地分析 APK，不把文件上传到服务器。

## 本地构建

```bash
npm run build
```

构建产物输出到 `dist/`。构建脚本会同步这些主项目文件：

- `src/apk.js`
- `src/sdk-markers.js`
- `src/generated/libchecker-rules.js`
- `src/generated/libchecker-sdk-icons.js`

## 本地预览

```bash
npm run dev
```

## 部署

```bash
npm run deploy
```

Cloudflare Pages 控制台使用 Git 集成时，可配置：

- Build command: `npm run build`
- Build output directory: `dist`

## 解析引擎

当前实现使用主项目已有的纯 JavaScript APK 解析器，并放在浏览器 Web Worker 中运行，避免阻塞 UI。这个结构后续可以把 `analyzer-worker.js` 内的解析调用替换成 WASM 模块，但不需要改变页面交互和展示层。
