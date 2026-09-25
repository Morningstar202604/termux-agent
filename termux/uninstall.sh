#!/usr/bin/env bash
# 口袋 Agent · 一键卸载
#
# 用法（在 Termux 里执行）：
#   bash termux/uninstall.sh           # 停止服务 + 删除数据（全部会话/记忆/备份）
#   bash termux/uninstall.sh --keep-data   # 停止服务，保留数据目录
set -euo pipefail
cd "$(dirname "$0")/.."

KEEP_DATA=0
if [ "${1:-}" = "--keep-data" ]; then
  KEEP_DATA=1
fi

echo "== 停止 agentd 服务 =="
PIDS=$(pgrep -f "python -m agentd.main" || true)
if [ -n "$PIDS" ]; then
  # shellcheck disable=SC2086
  kill $PIDS 2>/dev/null || true
  sleep 1
  echo "已停止服务进程。"
else
  echo "没有正在运行的服务。"
fi

# 移除开机自启
if [ -f "$HOME/.termux/boot/agentd.sh" ]; then
  rm -f "$HOME/.termux/boot/agentd.sh"
  echo "已移除开机自启脚本。"
fi

DATA_DIR="$HOME/.agent/termux-agent"
if [ "$KEEP_DATA" = "1" ]; then
  echo "保留数据目录：$DATA_DIR（会话/记忆/备份未删除）"
else
  if [ -d "$DATA_DIR" ]; then
    rm -rf "$DATA_DIR"
    echo "已删除数据目录：$DATA_DIR（会话/记忆/备份全部清除）"
  fi
fi

echo ""
echo "== 卸载完成 =="
if [ "$KEEP_DATA" = "1" ]; then
  echo "如需彻底重装：重新 clone 仓库后运行 bash termux/install.sh 即可（数据仍在）。"
else
  echo "如需彻底清理 Python 依赖：pip uninstall -r agentd/requirements.txt -y"
  echo "如不再需要 termux-api：pkg uninstall termux-api"
fi
