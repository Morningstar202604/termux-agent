"""MCP 最小客户端（P1 可选接入，零新增依赖）。

MCP（Model Context Protocol）已是工具协议事实标准（Linux 基金会托管）。
这里用 ~120 行手写 stdio JSON-RPC 客户端完成握手与调用——
协议本身极简，无需引入 mcp SDK；内建 30 个工具保持同进程原生调用，
MCP 服务器作为可选扩展（settings.server.mcp）按需接入。
"""
from __future__ import annotations

import asyncio
import json
import shutil


class MCPClient:
    """连接一个 stdio MCP 服务器（子进程 + 行 JSON 通信）。"""

    def __init__(self, name: str, command: str, args: list[str] | None = None, timeout: float = 20.0):
        self.name = name
        self.command = command
        self.args = args or []
        self.timeout = timeout
        self._proc: asyncio.subprocess.Process | None = None
        self._next_id = 0
        self._pending: dict[int, asyncio.Future] = {}

    async def connect(self) -> list[dict]:
        """启动子进程并完成 initialize 握手；返回 tools/list 结果。"""
        exe = shutil.which(self.command) or self.command
        self._proc = await asyncio.create_subprocess_exec(
            exe, *self.args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        asyncio.create_task(self._reader())
        await self._call("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "pocket-agent", "version": "0.1.0"},
        })
        # 通知初始化完成（无 id，不需要响应）
        assert self._proc and self._proc.stdin
        self._proc.stdin.write((json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n").encode())
        await self._proc.stdin.drain()
        result = await self._call("tools/list", {})
        return (result or {}).get("tools", []) or []

    async def _reader(self) -> None:
        assert self._proc and self._proc.stdout
        try:
            while True:
                line = await self._proc.stdout.readline()
                if not line:
                    break
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(msg, dict) and "id" in msg:
                    fut = self._pending.get(msg["id"])
                    if fut and not fut.done():
                        fut.set_result(msg)
        except Exception:  # noqa: BLE001
            pass

    async def _call(self, method: str, params: dict | None = None) -> dict | None:
        assert self._proc and self._proc.stdin
        self._next_id += 1
        rid = self._next_id
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[rid] = fut
        payload = {"jsonrpc": "2.0", "id": rid, "method": method}
        if params is not None:
            payload["params"] = params
        try:
            self._proc.stdin.write((json.dumps(payload, ensure_ascii=False) + "\n").encode())
            await self._proc.stdin.drain()
            msg = await asyncio.wait_for(fut, timeout=self.timeout)
            if "result" in msg:
                return msg["result"]
            return {"error": msg.get("error", "mcp 调用失败")}
        finally:
            self._pending.pop(rid, None)

    async def call_tool(self, tool_name: str, arguments: dict) -> dict:
        """调用 MCP 工具，返回结构化结果（兼容内建工具的输出形状）。"""
        try:
            result = await self._call("tools/call", {"name": tool_name, "arguments": arguments or {}})
        except asyncio.TimeoutError:
            return {"error": f"MCP 工具 {tool_name} 超时"}
        except Exception as e:  # noqa: BLE001
            return {"error": f"MCP 调用失败：{e}"}
        if not isinstance(result, dict) or "error" in result:
            return {"error": str(result.get("error", "MCP 调用失败")) if isinstance(result, dict) else "MCP 调用失败"}
        content = result.get("content") or []
        texts = [c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text"]
        return {"mcp_result": "\n".join(texts)}

    async def close(self) -> None:
        if self._proc:
            try:
                self._proc.terminate()
                await asyncio.wait_for(self._proc.wait(), timeout=3)
            except Exception:  # noqa: BLE001
                try:
                    self._proc.kill()
                except Exception:  # noqa: BLE001
                    pass
