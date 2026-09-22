// goose-agent bridge: 浏览器同源 POST /api/chat，bridge 内部连 goose ACP WS。
// 单端点模型：POST 收指令，增量结果通过同一条 HTTP 响应以 SSE 推回。
// 完全绕开预览代理对 wss 长连接不可靠的问题。
import http from "node:http";
import { WebSocket } from "ws";

const GOOSE_WS = process.env.GOOSE_WS || "ws://127.0.0.1:3284/acp";
const PORT = Number(process.env.PORT || 3001);
const MAX_BODY = 1024 * 1024; // 请求体上限 1MB
const MAX_MSG = 100000; // 单条消息上限 10 万字符

let ws = null;
let nextId = 0;
let handshaked = false;
let sessionId = null;
let retryMs = 1000;
let activePromptId = null; // 单飞：同一时刻只跑一个 prompt，避免 session/update 串流
const pending = new Map();
const promptWriters = new Map();

function connect() {
  try {
    ws = new WebSocket(GOOSE_WS);
  } catch (e) {
    scheduleReconnect(e);
    return;
  }
  ws.on("open", async () => {
    retryMs = 1000;
    try {
      await rpc("initialize", {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "bridge", version: "0.2" },
      });
      const res = await rpc("session/new", { cwd: "/tmp", mcpServers: [] });
      sessionId = res?.sessionId ?? null;
      handshaked = !!sessionId;
      console.log("[bridge] goose ready, session =", sessionId);
    } catch (e) {
      handshaked = false;
      console.error("[bridge] handshake failed:", e);
    }
  });
  ws.on("close", () => {
    handshaked = false;
    sessionId = null;
    activePromptId = null;
    failAllPrompts("与 goose 的连接断开，请重试");
    scheduleReconnect();
  });
  ws.on("error", (e) => console.error("[bridge] ws error:", e.message));
  ws.on("message", (d) => handleMessage(String(d)));
}

function scheduleReconnect(e) {
  if (e) console.error("[bridge] connect error:", e.message ?? e);
  console.log(`[bridge] retry in ${retryMs}ms`);
  setTimeout(connect, retryMs);
  retryMs = Math.min(retryMs * 2, 15000);
}

// 断连时把所有在飞 prompt 的 SSE 全部以 error 收尾，避免浏览器端永远等 done
function failAllPrompts(message) {
  for (const [id, writer] of promptWriters) {
    if (writer.watchdog) clearTimeout(writer.watchdog);
    try {
      writer.push({ type: "error", message });
    } catch {
      /* ignore */
    }
    promptWriters.delete(id);
  }
}

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== 1) return reject(new Error("goose ws not open"));
    const id = nextId++;
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(method + " timeout"));
      }
    }, 60000);
  });
}

function handleMessage(raw) {
  let m;
  try {
    m = JSON.parse(raw);
  } catch {
    return;
  }
  if (m.id !== undefined && m.method === undefined && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error.message ?? "rpc error"));
    else p.resolve(m.result);
    return;
  }
  if (m.id !== undefined && m.method === undefined && promptWriters.has(m.id)) {
    const writer = promptWriters.get(m.id);
    promptWriters.delete(m.id);
    if (writer.watchdog) clearTimeout(writer.watchdog);
    if (activePromptId === m.id) activePromptId = null;
    if (m.error) writer.push({ type: "error", message: m.error.message ?? "prompt failed" });
    else writer.push({ type: "done", stopReason: m.result?.stopReason ?? "end_turn" });
    return;
  }
  if (m.method === "requestPermission") {
    ws?.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: m.id,
        result: { outcome: { outcome: "selected", optionId: "allow_once" } },
      }),
    );
    return;
  }
  if (m.method === "session/update") {
    const u = m.params?.update ?? m.params;
    // 单飞模式：只投递给当前活跃 prompt，杜绝多 prompt 串流
    if (activePromptId !== null && promptWriters.has(activePromptId)) {
      promptWriters.get(activePromptId).push({ type: "update", update: u });
    }
  }
}

function sseWrite(res, obj) {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write("data: " + JSON.stringify(obj) + "\n\n");
  } catch {
    /* 响应已关闭 */
  }
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url && req.url.startsWith("/api/chat")) {
    let body = "";
    let overflow = false;
    req.on("data", (c) => {
      body += c;
      if (body.length > MAX_BODY) {
        overflow = true;
        req.destroy();
      }
    });
    req.on("end", () => {
      if (overflow) {
        if (!res.writableEnded) {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "request too large" }));
        }
        return;
      }
      let message = "";
      try {
        message = JSON.parse(body || "{}").message ?? "";
      } catch {
        message = body;
      }
      if (typeof message !== "string") message = String(message);
      if (!message.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "empty message" }));
        return;
      }
      if (message.length > MAX_MSG) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "message too long (max 100000 chars)" }));
        return;
      }
      if (!handshaked || !sessionId || !ws || ws.readyState !== 1) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "goose not ready, retry in a moment" }));
        return;
      }
      if (activePromptId !== null) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "上一轮回复还在进行中，请稍候再发" }));
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      sseWrite(res, { type: "start", message });
      const pid = nextId++;
      activePromptId = pid;
      const writer = { push: (o) => sseWrite(res, o), watchdog: 0 };
      promptWriters.set(pid, writer);
      // prompt 看门狗：goose 卡死超过 5 分钟则收尾，避免单飞锁死
      writer.watchdog = setTimeout(() => {
        if (activePromptId === pid) {
          promptWriters.delete(pid);
          activePromptId = null;
          sseWrite(res, { type: "error", message: "回复超时（5 分钟），请重试" });
        }
      }, 5 * 60 * 1000);
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: pid,
          method: "session/prompt",
          params: { sessionId, prompt: [{ type: "text", text: message }] },
        }),
      );
      res.on("close", () => {
        clearTimeout(writer.watchdog);
        // 浏览器断开：移除 writer，但等 goose 回包时仍会清掉 activePromptId
        if (promptWriters.has(pid)) promptWriters.delete(pid);
      });
    });
    return;
  }

  if (req.method === "GET" && req.url === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        handshaked,
        sessionId,
        busy: activePromptId !== null,
      }),
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

connect();
server.listen(PORT, "0.0.0.0", () =>
  console.log("[bridge] listening :" + PORT + " -> goose " + GOOSE_WS),
);
