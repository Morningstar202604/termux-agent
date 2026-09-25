#!/usr/bin/env python3
"""MCP 最小 demo 服务器（stdio JSON-RPC，零依赖）——用于验证 agentd 的 MCP 客户端。

提供两个工具：echo（回显文本）、time（当前时间）。
按 MCP 协议走 initialize → notifications/initialized → tools/list → tools/call。
"""
import json
import sys
import time


def send(msg: dict) -> None:
    print(json.dumps(msg, ensure_ascii=False), flush=True)


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        mid, method = msg.get("id"), msg.get("method")
        if method == "initialize":
            send({
                "jsonrpc": "2.0", "id": mid,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "demo-mcp", "version": "0.0.1"},
                },
            })
        elif method == "notifications/initialized":
            pass
        elif method == "ping":
            send({"jsonrpc": "2.0", "id": mid, "result": {}})
        elif method == "tools/list":
            send({
                "jsonrpc": "2.0", "id": mid,
                "result": {
                    "tools": [
                        {
                            "name": "echo",
                            "description": "返回传入的文本",
                            "inputSchema": {
                                "type": "object",
                                "properties": {"text": {"type": "string", "description": "要回显的文本"}},
                                "required": ["text"],
                            },
                        },
                        {
                            "name": "time",
                            "description": "返回当前时间字符串",
                            "inputSchema": {"type": "object", "properties": {}},
                        },
                    ]
                },
            })
        elif method == "tools/call":
            params = msg.get("params", {})
            name, args = params.get("name"), params.get("arguments", {}) or {}
            if name == "echo":
                content = [{"type": "text", "text": str(args.get("text", ""))}]
            elif name == "time":
                content = [{"type": "text", "text": time.strftime("%Y-%m-%d %H:%M:%S")}]
            else:
                content = [{"type": "text", "text": f"未知工具：{name}"}]
            send({"jsonrpc": "2.0", "id": mid, "result": {"content": content, "isError": False}})


if __name__ == "__main__":
    main()
