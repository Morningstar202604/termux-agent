# Android Agent

在安卓手机上运行的通用 AI agent，基于 [goose](https://github.com/aaif-goose/goose)（Apache-2.0, Rust）裁剪而成。

agent 的全部运行逻辑、文件、记忆、工具执行都在本地（Termux 环境）；
LLM 推理走外部 OpenAI 协议 API（base_url + api_key 可指向任意兼容端点）。

## 架构

| 层 | 实现 |
|---|---|
| Agent 编排 | goose（Rust，Termux musl portable 构建） |
| LLM 接入 | 内置 OpenAI 引擎 declarative provider（OpenAI 协议） |
| 工具层 | goose 内置扩展（shell/文件/搜索）+ `termux-api` 桥接 Android 原生能力 |
| 运行宿主 | Termux（aarch64-android） |

## 目录

- `goose/` — goose 源码（pinned commit: e629eea）
- `config/provider.json` — declarative provider 配置（OpenAI 协议端点，已指向 agnes-ai）
- `termux/termux-bridge` — termux-api 桥接脚本（日历/通知/短信/剪贴板等）
- `termux/install.sh` — Termux 一键安装脚本（装 goose + 配置 provider + 装 API key）
- `termux/termux.env` — 环境变量模板
- `app/` — Flutter 前端（安卓聊天 UI，通过 ACP WebSocket 连接 Termux 内的 goose）

## 前端（安卓聊天 UI）

Flutter app，跑在手机上，通过 WebSocket 连接 Termux 里的 `goose serve`（ACP 协议，端口 3284）。

```
┌─────────────────────────────┐
│  安卓 APK (Flutter 聊天 UI) │
│   ws://127.0.0.1:3284/acp   │
└──────────┬──────────────────┘
           │ 同一台手机的 loopback
┌──────────┴──────────────────┐
│  Termux: goose serve        │
│   agent 循环 / 工具 / 记忆  │
│   外连 LLM API (OpenAI)     │
└─────────────────────────────┘
```

### 手机侧

```bash
# 1. Termux 里跑一次（装好 goose + provider）
pkg install termux-api
termux-setup-storage
# 拷 config/provider.json 和 termux/* 到 ~/.agent/，执行 install.sh all

# 2. 启动 goose ACP 服务（后台或终端里挂着）
source ~/.agent/termux.env
~/.local/bin/goose serve --dangerously-unauthenticated --host 127.0.0.1 --port 3284
```

## 网页版（推荐，免装 APK）

最简路线：浏览器直接访问，不打包 APK，不装 Flutter。

```bash
# 1. 手机侧装好 goose + provider（一次性）
cd termux && bash install.sh all
# 启动 ACP 服务
source ~/.agent/termux.env
~/.local/bin/goose serve --dangerously-unauthenticated --host 0.0.0.0 --port 3284

# 2. 手机/PC 上跑 Web 前端
cd web
npm install
# 开发（Vite 代理 /acp 到本机 goose serve）
npx vite --host 0.0.0.0
# 或构建静态包
npm run build   # 产物 dist/，需 goose serve 加 --allowed-origin 放行浏览器跨域

# 3. 浏览器打开 http://<机器IP>:5173，默认连 ws://127.0.0.1:3284/acp
#    手机访问时把连接地址改成 ws://手机IP:3284/acp（在页面「连接」面板改）
```

前端技术栈：Vite + React + TypeScript + Tailwind，聊天 UI 用 `@assistant-ui/react`（OpenAI 官方组件库，不手画），通过 `useExternalStoreRuntime` 把 ACP 的 `session/update` 流式通知接进外部 store。

### 老路线：Flutter APK（需 8GB+ 内存机器出包）

```bash
cd app
bash scripts/build_apk.sh
# 产物: app/build/app/outputs/flutter-apk/app-debug.apk
```

> 本机容器无 swap 出不了 APK，需在 8GB+ 内存机器跑。脚本已内置低内存 gradle 参数（`-Xmx2g` 单线程）。

APK 打开后默认连 `ws://127.0.0.1:3284/acp`，输入指令即可和 agent 对话，工具调用会以卡片形式展示。

## 快速开始（手机端）

```bash
pkg install termux-api
termux-setup-storage
```

然后编辑 `termux/termux.env`，填入你的 API key 和 base_url，执行 `termux/install.sh`。

## 日常使用

```bash
# 交互式会话（默认带 developer 扩展：shell/文件读写/目录树）
source $HOME/.agent/termux.env
~/.local/bin/goose session

# 加 memory 扩展（JSON 文件记忆库）
~/.local/bin/goose session --with-builtin memory

# 非交互执行（管道输入）
echo "list my files" | ~/.local/bin/goose run

# 调 Android 原生能力（agent 可通过 shell 工具调用）
termux-bridge notify "提醒" "喝水"
termux-bridge clipboard-get
termux-bridge battery
```

`termux-bridge` 把 termux-api 封装成 shell 命令，agent 的 `developer` shell 工具可直接调用；后续可扩展日历/短信/闹钟。

## 开发（PC 端）

```bash
cd goose
cargo build --release -p goose-cli --bin goose --no-default-features --features portable-default
```

在 Termux 中从源码构建（官方支持）：

```bash
pkg install rust cmake protobuf clang build-essential
cd goose
cargo build --release -p goose-cli --bin goose --no-default-features --features portable-default
```

便携构建（musl）自动禁用 `local-inference`(V8) 和 `system-keyring`(D-Bus)，两者在 Android 上不可用。

## 数据边界

- 本地：agent 代码、会话、文件读写、shell 执行、termux-api 调用
- 云端（仅推理）：LLM API。注意 agent 上下文可能携带本地文件内容，敏感文件需自行做白名单/脱敏
