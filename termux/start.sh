#!/usr/bin/env bash
# 口袋 Agent · 启动 agentd（本地智能体服务）
#
# 用法：
#   bash termux/start.sh                 # 本机访问 http://127.0.0.1:8787
#   bash termux/start.sh 8788            # 自定义端口
#   bash termux/start.sh 8787 --lan      # 局域网访问（建议先在设置里配置访问令牌）
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${1:-8787}"
EXTRA=""
if [ "${2:-}" = "--lan" ]; then
  EXTRA="--lan"
  echo "⚠ 局域网模式：请确认已在页面设置里配置访问令牌，否则任何设备都能调用本服务。"
fi

echo "启动口袋 Agent（端口 $PORT）..."
exec python -m agentd.main --port "$PORT" $EXTRA
