# Android Agent — 项目知识备忘

## 构建与编译

- 底座：`aaif-goose/goose`（Rust 工作区），pinned commit `e629eea`
- Termux/便携构建命令（官方支持，见 goose 仓库 BUILDING_LINUX.md）：
  `cargo build --release -p goose-cli --bin goose --no-default-features --features portable-default`
- portable feature 集 = rustls-tls + live-voice + aws-providers + telemetry + otel；
  musl 目标下自动禁用 `local-inference`(V8) 与 `system-keyring`(D-Bus)，Android 上两者不可用
- Termux 装 Rust：`pkg install rust cmake protobuf clang build-essential`
- 本机 PC 上 release 编译耗时较长（>15 分钟），建议后台终端跑

## 部署流程（手机端）

- `termux/install.sh` 支持分步：clone / build / install-binary / setup-provider / setup-bridge / setup-env / all
- provider 配置落地到 `~/.config/goose/custom_providers/llm.json`（goose declarative provider 目录）
- 环境变量模板在 `termux/termux.env`，provider 名 `custom_llm`，API key 变量名 `LLM_API_KEY`（需与 provider.json 的 api_key_env 一致）
- `termux-bridge` 脚本封装 termux-api（通知/剪贴板/位置/电量/TTS），输出 JSON 供 agent shell 调用

## 排障

- goose 二进制找不到：确认 `GOOSE_BIN` 与 install.sh 的 cp 路径一致
- provider 不生效：检查 `~/.config/goose/custom_providers/llm.json` 的 name 字段是否为 `custom_llm`，且 `GOOSE_PROVIDER=custom_llm`
- termux-bridge 报 "not available"：手机上先 `pkg install termux-api`，且首次需在 Termux 应用内跑 `termux-setup-storage`

## 环境配置

- 本开发环境预装了 rustup（stable，minimal profile），路径 `$HOME/.cargo/bin`
- background terminal 执行 cargo 时要用 `export PATH=$HOME/.cargo/bin:$PATH`（不能用 `source`，sh 不支持）
- 本容器 8GB 内存无 swap、`swapon` 无内核权限、`drop_caches` 释放不了被 page cache 占满的文件缓存；Flutter APK 构建（gradle 需 4GB+ 连续内存）在本机必 OOM。已装 JDK17/Android SDK/Flutter 到 `$HOME/Android/sdk` 和 `$HOME/flutter`，但出不了包。出 APK 需 8GB+ 内存机器。

## 网页版前端（web/）

- 路线：用户放弃 APK，改网页版。Vite + React 18 + TS + Tailwind，聊天 UI 用 `@assistant-ui/react`（OpenAI 官方组件库，不手画）
- 技术栈映射：ACP（WebSocket 流式 agent 状态）→ `useExternalStoreRuntime`（assistant-ui 的"外部 agent 状态流"runtime），手写薄 adapter 把 `session/update` 通知翻译成 `ThreadMessageLike[]`
- 文件：`web/src/acp-client.ts`（ACP WS 客户端，按 messageId 累积 agent 文本/推理/工具状态）、`web/src/ChatProvider.tsx`（useExternalStoreRuntime + 状态管理）、`web/src/App.tsx`（ThreadPrimitive 组合的聊天界面 + 连接设置面板）
- 启动：`cd web && npm install && npx vite --host 0.0.0.0`（5173），Vite 把 `/acp` 代理到 `http://127.0.0.1:3284`（goose serve），浏览器 ws://.../acp 同源无跨域
- 生产/手机侧：`npm run build` 出 dist/，goose serve 需带 `--allowed-origin <web页面origin>` 才放行浏览器跨域访问；或手机开热点把 3284 转出来
- 默认连接 `ws://127.0.0.1:3284/acp`，UI 可改地址

## ACP 协议关键事实（goose serve 实测 wire）

- 传输：JSON-RPC 2.0 over WebSocket，`goose serve` 路径 `/acp`，端口默认 3284
- 握手顺序：`initialize`(protocolVersion:1, clientCapabilities:{}, clientInfo) → `session/new`(cwd, mcpServers:[]) → `session/prompt`
- `session/prompt` 参数字段名是 **`prompt`**（ContentBlock[]，如 `{prompt:[{type:"text",text:"..."}]}`），**不是** `input`；结果走异步 `session/update` 通知流，最终 result 带 stopReason
- `session/update` 通知 method 名是 `session/update`（不是 sessionNotification）；`update.sessionUpdate` 判别字段值：`agent_message_chunk` / `agent_thought_chunk` / `tool_call` / `tool_call_update` / `session_info_update` / `usage_update`
- `agent_message_chunk` 带 `messageId` + `content:{type:"text",text:"..."}`，同 messageId 的 chunk 累积成一条消息（delta 模式）
- `session_info_update` 的 `_meta.goose.activeRunId` 非 null 表示 run 开始，null 表示 run 结束
- `requestPermission` 由服务端主动发，响应 `{outcome:{outcome:"selected",optionId:"allow_once"}}`；goose serve 默认 auto 模式可自动批准
- 探针脚本：`/tmp/acp_probe3.mjs`（node ws 包，需 `cd /tmp && npm i ws`），goose serve 用 background terminal 跑（30s 内会超时退出，要重开）
- goose serve 启动：`GOOSE_PATH_ROOT=$HOME/.goose-test GOOSE_PROVIDER=custom_llm GOOSE_MODEL=agnes-3.0-flash LLM_API_KEY=... goose serve --dangerously-unauthenticated --host 127.0.0.1 --port 3284`
- provider json 要拷到 `$GOOSE_PATH_ROOT/custom_providers/custom_llm.json`

## 排障

- goose 二进制找不到：确认 `GOOSE_BIN` 与 install.sh 的 cp 路径一致
- provider 不生效：检查 `~/.config/goose/custom_providers/{name}.json` 的 name 字段与 `GOOSE_PROVIDER` 一致
- termux-bridge 报 "not available"：手机上先 `pkg install termux-api`，首次需在 Termux 应用内跑 `termux-setup-storage`
- gradle APK 构建 OOM：`swapon` 容器无权限，`drop_caches` 无效，只能换 8GB+ 内存机器跑 `scripts/build_apk.sh`（脚本已内置低内存 gradle 参数 `-Xmx2g`）
- web 前端 `session/prompt` 报 "missing field prompt"：参数名要用 `prompt` 不是 `input`
- web 构建 PostCSS 报错 `module is not defined`：package.json 是 `type:module`，`postcss.config.js`/`tailwind.config.js` 必须改名 `.cjs`
- `useExternalStoreRuntime` 必须传 `convertMessage`（即使是恒等映射），否则 TS 报 convertMessage missing
- `ThreadMessageLike.status` 的 complete 态必须带 `reason` 字段：`{type:"complete", reason:"stop"}`，只写 `{type:"complete"}` 会 TS 报错
- `ThreadPrimitive.Messages` 渲染器接收 `{message}` 对象而非回调参数：`{({message}) => ...}`
- 本机 Vite 启动后 curl 5173 返回 200，但预览域名 `*.monkeycode-ai.online` 需在 `server.allowedHosts` 加 `.monkeycode-ai.online` 才放行（Vite 5 有 allowedHosts 白名单）
