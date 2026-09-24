"""工具危险度分级与审批规则（服务端强制执行，不依赖 LLM 自觉）。

风险等级：
  safe   —— 只读，无害（列目录、读文件、查电量、读剪贴板…）     → 永不需要确认
  write  —— 写操作（写文件、发通知、写剪贴板…）                  → approve 模式下需确认
  danger —— 高危（任意 shell、删除、短信、电话、定位…）          → approve 模式下必须确认

权限模式：
  auto    —— 全放行（不推荐，仅调试用）
  approve —— safe 自动；write/danger 需用户在界面确认（推荐默认）
  chat    —— 纯聊天，不注册任何工具
"""
from __future__ import annotations

SAFE = "safe"
WRITE = "write"
DANGER = "danger"

VALID_MODES = ("auto", "approve", "chat")


def should_ask(risk: str, mode: str) -> bool:
    """返回 True 表示该工具调用需要用户确认。"""
    if mode == "auto":
        return False
    if mode == "approve":
        return risk in (WRITE, DANGER)
    return False  # chat 模式根本不注册工具，走不到这里
