"""口袋 Agent · agentd —— 手机上的本地智能体服务（单进程）。

启动：
  python -m agentd.main                     # 本机访问，端口 8787
  python -m agentd.main --lan               # 局域网访问（会要求设置访问令牌）
  python -m agentd.main --mock              # 离线 mock 模式（不调用 LLM，用于自测）

安全要点（对比旧实现的修复）：
  - 默认只绑 127.0.0.1；--lan 时强制要求 Bearer token；
  - 工具审批由服务端强制，approve 模式下写/危险操作必须用户确认；
  - GET /api/settings 只返回打码后的 API Key。
"""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .agent import Agent
from .config import PRESETS, Settings, mask_key
from .memory import Store

VERSION = "0.1.0"
APP_NAME = "口袋 Agent"

DIST = Path(__file__).parent / "web" / "dist"


# ---------- 审批中心 ----------
class ApprovalCenter:
    """每个待审批工具调用一个 asyncio.Event；超时默认拒绝（安全优先）。"""

    def __init__(self):
        self._gates: dict[tuple[str, str], dict] = {}
        self._always: dict[str, set] = {}

    async def ask(self, session_id: str, tool_call_id: str, tool_name: str) -> str:
        if tool_name in self._always.setdefault(session_id, set()):
            return "allow"
        timeout = 120
        try:
            timeout = int(settings_mgr.get().get("server", {}).get("approval_timeout", 120))
        except (TypeError, ValueError):
            pass
        gate = {"event": asyncio.Event(), "decision": None}
        self._gates[(session_id, tool_call_id)] = gate
        try:
            await asyncio.wait_for(gate["event"].wait(), timeout=timeout)
        except asyncio.TimeoutError:
            return "timeout"  # 超时默认拒绝（安全优先）
        finally:
            self._gates.pop((session_id, tool_call_id), None)
        d = gate["decision"]
        if d == "allow_always":
            self._always.setdefault(session_id, set()).add(tool_name)
            return "allow"
        if d == "allow_once":
            return "allow"
        return "deny"

    def decide(self, session_id: str, tool_call_id: str, decision: str) -> bool:
        gate = self._gates.get((session_id, tool_call_id))
        if not gate:
            return False
        gate["decision"] = decision
        gate["event"].set()
        return True

    def forget(self, session_id: str) -> None:
        """会话删除时清理：未决审批 + 「始终允许」记忆。"""
        self._gates = {k: v for k, v in self._gates.items() if k[0] != session_id}
        self._always.pop(session_id, None)


# ---------- 应用 ----------
settings_mgr = Settings()
store: Store | None = None
approval = ApprovalCenter()
runs: dict[str, dict] = {}  # session_id -> {task, queue}
MOCK = False


def create_app() -> FastAPI:
    global store
    app = FastAPI(title=APP_NAME, version=VERSION)
    store = Store(settings_mgr.path.parent / "agent.db")

    def emit_now(session_id: str):
        q = runs.get(session_id, {}).get("queue")
        if q is None:
            return
        async def _emit(ev: dict):
            q.put_nowait(ev)
        return _emit

    async def run_agent(session_id: str, message: str):
        try:
            # 新会话（尚无 user 消息）自动命名
            if store.first_user_message(session_id) is None:
                try:
                    title = await Agent(store, settings_mgr, mock=MOCK).title_for(message)
                    store.touch_session(session_id, title or "新会话")
                except Exception:  # noqa: BLE001 —— 命名失败不阻塞
                    pass
            agent = Agent(store, settings_mgr, mock=MOCK)

            async def ask(tid: str, name: str, summary: str, risk: str) -> str:
                emit = emit_now(session_id)
                if emit:
                    await emit({"type": "approval", "id": tid, "name": name, "summary": summary, "risk": risk})
                return await approval.ask(session_id, tid, name)

            await agent.chat(session_id, message, emit=emit_now(session_id), ask_approval=ask)
        except asyncio.CancelledError:
            q = runs.get(session_id, {}).get("queue")
            if q:
                q.put_nowait({"type": "error", "message": "已停止"})
        except Exception as e:  # noqa: BLE001 —— 服务端兜底，不能静默
            q = runs.get(session_id, {}).get("queue")
            if q:
                q.put_nowait({"type": "error", "message": str(e)})
        finally:
            runs.pop(session_id, None)

    def cancel_run(session_id: str) -> bool:
        run = runs.get(session_id)
        if run and run.get("task") and not run["task"].done():
            run["task"].cancel()
            return True
        return False

    async def _heartbeat(queue: asyncio.Queue) -> None:
        """SSE 保活：每 15s 发一条注释帧（前端会自动忽略）。"""
        try:
            while True:
                await asyncio.sleep(15)
                queue.put_nowait({"_hb": True})
        except asyncio.CancelledError:
            pass

    # ---------- 鉴权（局域网开启后强制） ----------
    def check_token(request: Request) -> None:
        import hmac

        s = settings_mgr.get()
        token = str(s.get("server", {}).get("token", ""))
        if not token:
            return
        auth = request.headers.get("authorization", "")
        if not auth.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="需要访问令牌")
        given = auth[len("Bearer "):].strip()
        if not hmac.compare_digest(given, token):
            raise HTTPException(status_code=401, detail="需要访问令牌")

    # ---------- API ----------
    @app.get("/api/health")
    async def health():
        llm = settings_mgr.llm()
        ready = MOCK or bool(llm.get("api_key") and llm.get("model"))
        return {
            "ok": True,
            "app": APP_NAME,
            "version": VERSION,
            "ready": ready,
            "mock": MOCK,
            "active_runs": len(runs),
        }

    @app.post("/api/chat", dependencies=[Depends(check_token)])
    async def chat(payload: dict, request: Request):
        if store is None:
            raise HTTPException(503, "服务未就绪")
        message = payload.get("message")
        if not isinstance(message, str) or not message.strip():
            raise HTTPException(400, "消息不能为空")
        if len(message) > 100000:
            raise HTTPException(400, "消息过长（最多 10 万字符）")

        session_id = payload.get("session_id")
        if not isinstance(session_id, str) or not session_id.strip():
            session_id = store.create_session()
        elif store.get_session(session_id) is None:
            raise HTTPException(404, "会话不存在")

        if session_id in runs:
            raise HTTPException(409, "上一轮回复还在进行中，请稍候再发")

        queue: asyncio.Queue = asyncio.Queue()
        # 先注册再启动任务，避免 run_agent 首帧 emit 时 runs 尚未就绪的竞态
        runs[session_id] = {"task": None, "queue": queue}
        task = asyncio.create_task(run_agent(session_id, message))
        runs[session_id]["task"] = task

        async def sse():
            # 首帧告知会话 ID（新建会话时前端需要）
            yield f"data: {json.dumps({'type': 'session', 'session_id': session_id}, ensure_ascii=False)}\n\n"
            try:
                # 心跳：审批等待可能长达 120s，移动网络/代理需要保活
                hb = asyncio.get_running_loop().create_task(_heartbeat(queue))
                try:
                    while True:
                        ev = await queue.get()
                        if ev.get("_hb"):
                            yield ": ping\n\n"  # SSE 注释帧，保活且不产生数据事件
                            continue
                        yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                        if ev.get("type") in ("done", "error"):
                            break
                finally:
                    hb.cancel()
            except asyncio.CancelledError:
                cancel_run(session_id)
                raise

        return StreamingResponse(
            sse(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @app.post("/api/stop", dependencies=[Depends(check_token)])
    async def stop(payload: dict):
        session_id = payload.get("session_id", "")
        return {"ok": cancel_run(session_id)}

    @app.post("/api/approval", dependencies=[Depends(check_token)])
    async def approval_endpoint(payload: dict):
        session_id = payload.get("session_id", "")
        tool_call_id = payload.get("tool_call_id", "")
        decision = payload.get("decision", "")
        if decision not in ("allow_once", "allow_always", "deny"):
            raise HTTPException(400, "decision 必须是 allow_once / allow_always / deny")
        ok = approval.decide(session_id, tool_call_id, decision)
        if not ok:
            raise HTTPException(404, "该审批已过期或不存在")
        return {"ok": True}

    @app.get("/api/sessions", dependencies=[Depends(check_token)])
    async def list_sessions():
        if store is None:
            return []
        return store.list_sessions()

    @app.post("/api/sessions", dependencies=[Depends(check_token)])
    async def create_session():
        if store is None:
            raise HTTPException(503)
        sid = store.create_session()
        return {"session_id": sid, "title": "新会话"}

    @app.delete("/api/sessions/{sid}", dependencies=[Depends(check_token)])
    async def delete_session(sid: str):
        if store is None:
            raise HTTPException(503)
        cancel_run(sid)
        ok = store.delete_session(sid)
        if ok:
            approval.forget(sid)  # 清理该会话的"始终允许"记忆与未决审批
        return {"ok": ok}

    @app.get("/api/sessions/{sid}/messages", dependencies=[Depends(check_token)])
    async def session_messages(sid: str):
        if store is None:
            raise HTTPException(503)
        if store.get_session(sid) is None:
            raise HTTPException(404, "会话不存在")
        return store.get_messages(sid)

    @app.get("/api/providers")
    async def providers():
        return {"providers": PRESETS}

    @app.get("/api/tools", dependencies=[Depends(check_token)])
    async def tools():
        from .tools import all_tools

        return {
            "tools": [
                {
                    "name": t.name,
                    "description": t.description,
                    "risk": t.risk,
                    "summary": t.summary,
                    "timeout": t.timeout,
                }
                for t in all_tools()
            ],
            "count": len(all_tools()),
        }

    @app.get("/api/settings", dependencies=[Depends(check_token)])
    async def get_settings():
        s = settings_mgr.get()
        llm = dict(s.get("llm", {}))
        llm["api_key"] = mask_key(llm.get("api_key", ""))
        return {**s, "llm": llm}

    @app.put("/api/settings", dependencies=[Depends(check_token)])
    async def put_settings(payload: dict):
        llm = payload.get("llm")
        if isinstance(llm, dict):
            clean = {
                "provider": str(llm.get("provider", "custom"))[:64],
                "base_url": str(llm.get("base_url", "")).strip()[:512],
                "model": str(llm.get("model", "")).strip()[:128],
                "temperature": max(0.0, min(2.0, float(llm.get("temperature", 0.3)))),
                "max_tokens": max(256, min(65536, int(llm.get("max_tokens", 4096)))),
            }
            # api_key 为空时不覆盖旧值；非空才写入
            key = llm.get("api_key")
            if isinstance(key, str) and key.strip() and key != mask_key(settings_mgr.llm().get("api_key", "")):
                clean["api_key"] = key.strip()[:512]
            settings_mgr.save({"llm": clean})
        mode = payload.get("permission_mode")
        if isinstance(mode, str) and mode in ("auto", "approve", "chat"):
            settings_mgr.save({"permission_mode": mode})
        server = payload.get("server")
        if isinstance(server, dict):
            if isinstance(server.get("token"), str):
                settings_mgr.save({"server": {"token": server["token"].strip()[:128]}})
            at = server.get("approval_timeout")
            if isinstance(at, (int, float)) and at > 0:
                settings_mgr.save({"server": {"approval_timeout": min(int(at), 600)}})
        s = settings_mgr.get()
        llm_out = dict(s.get("llm", {}))
        llm_out["api_key"] = mask_key(llm_out.get("api_key", ""))
        return {"ok": True, "settings": {**s, "llm": llm_out}}

    # ---------- 静态前端 ----------
    if DIST.exists():
        app.mount("/", StaticFiles(directory=str(DIST), html=True), name="static")
    else:

        @app.get("/", include_in_schema=False)
        async def root_placeholder():
            return HTMLResponse(
                "<html><body style='font-family:sans-serif;background:#0f1115;color:#e4e4e7;padding:40px'>"
                "<h2>口袋 Agent 服务已启动</h2>"
                "<p>前端尚未构建。在仓库根目录执行：</p>"
                "<pre>cd agentd/web && npm install && npm run build</pre>"
                "</body></html>"
            )

    return app


def main():
    global MOCK
    parser = argparse.ArgumentParser(description="口袋 Agent agentd")
    parser.add_argument("--host", default=None, help="监听地址（默认 127.0.0.1，--lan 时 0.0.0.0）")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--lan", action="store_true", help="允许局域网访问（会校验访问令牌）")
    parser.add_argument("--mock", action="store_true", help="离线 mock 模式")
    parser.add_argument("--home", default=None, help="数据目录（默认 ~/.agent/termux-agent）")
    args = parser.parse_args()

    MOCK = args.mock
    if args.home:
        import os

        os.environ["AGENT_HOME"] = args.home
    settings_mgr.load()

    host = args.host or ("0.0.0.0" if args.lan else "127.0.0.1")
    if args.lan:
        s = settings_mgr.get()
        token = str(s.get("server", {}).get("token", "")).strip()
        if not token:
            print("✗ 安全策略：--lan 必须配置访问令牌才能启动（否则局域网内任何设备都能调用本服务）。")
            print("  请先设置 server.token（启动本机模式后，在页面「设置 → 局域网访问令牌」填入），再重试。")
            raise SystemExit(1)

    import uvicorn

    print(f"[agentd] 口袋 Agent v{VERSION} | mock={MOCK} | 监听 {host}:{args.port}")
    if MOCK:
        print("[agentd] mock 模式：消息含 电池/短信/定位/剪贴板/传感器/通知/工具 等词会走工具链路，便于自测")
    uvicorn.run(create_app(), host=host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
