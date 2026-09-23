#!/usr/bin/env bash
# 一键启动：拉起 goose（ACP）+ 网页版 node 服务
# 用法: bash web/start.sh [端口默认5173]
# 前置: 已安装 node、已配置 LLM_API_KEY（见 .env 或 web/settings.json）
set -e
cd "$(dirname "$0")/.."

PORT="${1:-5173}"

# 1) 载入 .env（如果存在），否则从 web/settings.json 取 key
if [ -f .env ]; then
  set -a; . ./.env; set +a
fi
if [ -z "$LLM_API_KEY" ] && [ -f web/settings.json ]; then
  LLM_API_KEY="$(node -e 'try{console.log(require("./web/settings.json").apiKey||"")}catch(e){}' )"
  export LLM_API_KEY
fi

# 2) 依赖检查
command -v node >/dev/null 2>&1 || { echo "需要 node (npm i -g nodejs / 装 node)"; exit 1; }
[ -d web/node_modules ] || { echo "安装前端依赖..."; (cd web && npm install); }

# 3) 前端构建（server.mjs 直接托管 dist/）
if [ ! -f web/dist/index.html ]; then
  echo "构建前端 dist..."
  (cd web && ./node_modules/.bin/vite build)
fi

# 4) 起 node 服务（server.mjs 会自管 goose 进程，读 web/settings.json + LLM_API_KEY）
echo "启动 node 服务 (端口 $PORT, goose 自管理)..."
exec env PORT="$PORT" node web/server.mjs
