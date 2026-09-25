#!/usr/bin/env bash
# 口袋 Agent · 手机端一键安装
#
# 用法（在 Termux 里执行）：
#   pkg install git
#   git clone <本仓库地址>
#   cd termux-agent && bash termux/install.sh
#
# 安装内容（约 2-5 分钟，无需编译任何 Rust）：
#   1. Python 3              pkg install python
#   2. termux-api            手机能力桥（通知/剪贴板/电量/短信/电话…）
#   3. pip 依赖               fastapi / uvicorn / openai / apscheduler
#   4. 数据目录               $HOME/.agent/termux-agent（权限 700，仅自己可读）
#   5. （可选）离线语音       sherpa-onnx + 中文模型，见 termux/voice.md
#   6. （可选）开机自启       termux-boot 插件，见 termux/boot.sh
set -euo pipefail
cd "$(dirname "$0")/.."

step() { echo ""; echo "== $1 =="; }

step "1/4 检查 Termux 基础组件"
command -v pkg >/dev/null 2>&1 || { echo "❌ 请先在 Termux 里执行：pkg install termux-tools"; exit 1; }
command -v python >/dev/null 2>&1 || { echo "安装 Python 3..."; pkg install -y python; }
if ! command -v termux-notification >/dev/null 2>&1; then
  echo "安装 termux-api（手机能力桥）..."
  pkg install -y termux-api
fi
# 存储权限（读 /sdcard、~/storage 需要）
if [ ! -d "$HOME/storage" ]; then
  echo "提示：首次使用请允许存储权限 → termux-setup-storage（会弹出系统授权）"
fi
python --version

step "2/4 安装 Python 依赖"
python -m pip install --upgrade pip -q
python -m pip install -r agentd/requirements.txt -q

step "3/4 初始化数据目录（权限 700，仅自己可读）"
DATA_DIR="$HOME/.agent/termux-agent"
mkdir -p "$DATA_DIR/logs"
chmod 700 "$DATA_DIR"

step "4/4 可选能力（按需，跳过不影响主功能）"
echo ""
echo "a) 离线语音（完全本地 TTS，约 135MB）：见 termux/voice.md"
echo "   pip install sherpa-onnx，再下载中文模型到 \$HOME/.agent/termux-agent/tts-model/"
echo "b) 开机自启（重启后自动拉起服务）：见 termux/boot.sh"
echo "   pkg install termux-boot && mkdir -p ~/.termux/boot && cp termux/boot.sh ~/.termux/boot/agentd.sh && chmod +x ~/.termux/boot/agentd.sh"

step "完成 ✅"
echo ""
echo "启动：            bash termux/start.sh"
echo "浏览器打开：      http://127.0.0.1:8787"
echo ""
echo "首次使用：在页面右上角 ⚙ 设置里选择模型厂商（豆包/DeepSeek/千问/Kimi/智谱/硅基流动）并填入 API Key。"
echo "数据安全：会话/记忆/备份全部存本机（$DATA_DIR），权限 700。"
echo "撤销保护：写文件/删文件等危险操作执行前会自动备份，对话里可一键撤销。"
