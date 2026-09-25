"""配置管理：LLM、权限模式、服务选项。

配置文件位于 $AGENT_HOME/config.json（默认 ~/.agent/termux-agent/config.json）。
API Key 只存在本地文件里，任何 API 回传时都会打码。
"""
from __future__ import annotations

import json
import os
from pathlib import Path

# 国产 LLM 厂商预设（OpenAI 兼容协议）。base_url 与 model 均可按需修改。
PRESETS = [
    {
        "id": "doubao",
        "label": "豆包 · 火山方舟",
        "base_url": "https://ark.cn-beijing.volces.com/api/v3",
        "model": "doubao-seed-1-6-250615",
        "note": "火山方舟控制台创建推理接入点后，用接入点 ID 作为 model",
    },
    {
        "id": "deepseek",
        "label": "DeepSeek",
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
        "note": "支持 deepseek-reasoner（思考模型）",
    },
    {
        "id": "qwen",
        "label": "通义千问",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model": "qwen-plus",
        "note": "阿里云百炼开通后使用",
    },
    {
        "id": "kimi",
        "label": "Kimi · 月之暗面",
        "base_url": "https://api.moonshot.cn/v1",
        "model": "moonshot-v1-8k",
        "note": "",
    },
    {
        "id": "glm",
        "label": "智谱 GLM",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "model": "glm-4-flash",
        "note": "glm-4-flash 有免费额度",
    },
    {
        "id": "siliconflow",
        "label": "硅基流动 SiliconFlow",
        "base_url": "https://api.siliconflow.cn/v1",
        "model": "deepseek-ai/DeepSeek-V3",
        "note": "",
    },
    {
        "id": "custom",
        "label": "自定义 OpenAI 兼容端点",
        "base_url": "",
        "model": "",
        "note": "填你自己的 base_url 与模型名",
    },
]

DEFAULTS = {
    "llm": {
        "provider": "custom",
        "base_url": "",
        "api_key": "",
        "model": "",
        "temperature": 0.3,
        "max_tokens": 4096,
    },
    # auto = 全放行（不推荐） | approve = 写操作与危险操作需确认（推荐） | chat = 纯聊天（不调用工具）
    "permission_mode": "approve",
    "server": {"allow_lan": False, "token": "", "approval_timeout": 120},
}


def home_dir() -> Path:
    """数据目录（配置 + 数据库）。"""
    h = os.environ.get("AGENT_HOME")
    return Path(h).expanduser() if h else Path.home() / ".agent" / "termux-agent"


class Settings:
    def __init__(self, path: Path | None = None):
        self.path = path or (home_dir() / "config.json")
        self.data = dict(DEFAULTS)
        self.load()

    def load(self) -> None:
        try:
            if self.path.exists():
                loaded = json.loads(self.path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    self.data = self._merge(dict(DEFAULTS), loaded)
        except Exception:
            self.data = dict(DEFAULTS)

    @staticmethod
    def _merge(base: dict, patch: dict) -> dict:
        out = dict(base)
        for k, v in patch.items():
            if isinstance(v, dict) and isinstance(out.get(k), dict):
                out[k] = Settings._merge(out[k], v)
            else:
                out[k] = v
        return out

    def get(self) -> dict:
        return self.data

    def save(self, patch: dict) -> dict:
        self.data = self._merge(self.data, patch)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(self.path.parent, 0o700)  # 数据目录 700（含数据库）
        except OSError:
            pass
        self.path.write_text(
            json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass
        return self.data

    def llm(self) -> dict:
        return self.data["llm"]

    def permission_mode(self) -> str:
        m = self.data.get("permission_mode", "approve")
        return m if m in ("auto", "approve", "chat") else "approve"


def mask_key(key: str) -> str:
    """打码 API Key：短 key（≤8）全遮；中等长度保留首尾 2 位；长 key 保留首尾 4 位。"""
    if not key:
        return ""
    n = len(key)
    if n <= 8:
        return "*" * n
    head = tail = 4 if n > 16 else 2
    return key[:head] + "*" * (n - head - tail) + key[-tail:]
