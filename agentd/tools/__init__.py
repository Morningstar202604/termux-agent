"""工具注册表。

每个工具 = 名称 + 描述 + JSON Schema 参数 + 危险度 + 异步执行函数。
LLM 通过 OpenAI 兼容的 function calling 拿到结构化定义，
不再像旧实现那样"靠猜 shell 命令 + 自己解析 JSON"。
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

Handler = Callable[..., Awaitable[dict]]


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict
    risk: str
    handler: Handler
    summary: str = ""          # 审批卡片上展示的一句话说明
    timeout: int = 120         # 单次执行超时（秒）


_REGISTRY: dict[str, Tool] = {}


def register(tool: Tool) -> None:
    _REGISTRY[tool.name] = tool


def get_tool(name: str) -> Tool | None:
    return _REGISTRY.get(name)


def all_tools() -> list[Tool]:
    return list(_REGISTRY.values())


def schemas() -> list[dict]:
    """转成 OpenAI function calling 需要的 tools 参数。"""
    return [
        {
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters,
            },
        }
        for t in all_tools()
    ]


async def call_tool(name: str, args: dict) -> dict:
    """执行工具，统一捕获异常与超时，永远返回结构化结果。"""
    tool = get_tool(name)
    if tool is None:
        return {"error": f"未知工具：{name}"}
    if not isinstance(args, dict):
        args = {}
    try:
        return await asyncio.wait_for(tool.handler(**args), timeout=tool.timeout)
    except asyncio.TimeoutError:
        return {"error": f"工具 {name} 执行超时（>{tool.timeout}s）"}
    except Exception as e:  # noqa: BLE001 —— 工具失败必须回传给模型
        return {"error": f"{type(e).__name__}: {e}"}


# 导入子模块完成注册（必须在 _REGISTRY 定义之后）
from . import files, phone, shell  # noqa: E402,F401
