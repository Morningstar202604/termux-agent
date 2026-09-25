"""通知栏持久进度（P1）：调用 termux-notification，运行期进度可见可回溯。

零依赖：直接调二进制，失败静默（没有 termux-api 的环境自动降级为无通知）。
--id 固定，同一任务更新同一通知、完成后清除，避免刷屏。
"""
from __future__ import annotations

import shutil
import subprocess

_NOTIFY_ID = "pocket-agent"


def notify(title: str, content: str, persistent: bool = False) -> bool:
    """发/更新一条通知栏消息。persistent=True 时点击通知打开 Agent 页面。"""
    exe = shutil.which("termux-notification")
    if not exe:
        return False
    cmd = [exe, "--id", _NOTIFY_ID, "--title", title[:40], "--content", content[:200]]
    if persistent:
        # 点击打开本机 Agent 页面（PWA/WebView 场景）
        cmd += ["--action", "android.intent.action.VIEW", "--action-data", "http://127.0.0.1:8787/"]
    try:
        subprocess.run(cmd, capture_output=True, timeout=4)
        return True
    except Exception:  # noqa: BLE001 —— 通知失败不影响主流程
        return False


def clear() -> bool:
    """移除当前通知。"""
    exe = shutil.which("termux-notification-remove")
    if not exe:
        return False
    try:
        subprocess.run([exe, _NOTIFY_ID], capture_output=True, timeout=4)
        return True
    except Exception:  # noqa: BLE001
        return False
