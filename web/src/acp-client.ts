// ACP (Agent Client Protocol) WebSocket 客户端。
// 连接 goose serve 的 /acp 端点（JSON-RPC 2.0 over WebSocket）。
// 对外暴露消息流（TextPart / ThoughtPart / ToolPart）和连接状态。

export type AcpStatus = "idle" | "connecting" | "ready" | "error";

export interface ToolPart {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  status: "in_progress" | "completed" | "failed";
  detail?: string;
}

export type StreamPart =
  | { type: "text"; text: string }
  | { type: "thought"; text: string }
  | ToolPart;

export interface AcpEvents {
  onStatus: (status: AcpStatus, message?: string) => void;
  // 每次调用传入"当前完整快照"（按 messageId 分组后的累积结果），UI 用它刷新消息。
  onSnapshot: (parts: StreamPart[]) => void;
  onRunComplete: () => void;
  onError: (message: string) => void;
}

// 按 messageId 累积 agent 文本；工具调用按 toolCallId 维护状态。
export class AcpClient {
  private ws: WebSocket | null = null;
  private nextId = 0;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void; method: string }
  >();
  private sessionId: string | null = null;
  private promptId: number | null = null;
  private ev: AcpEvents;

  // agent 消息累积：messageId -> text
  private textByMessage = new Map<string, string>();
  private thoughtByMessage = new Map<string, string>();
  private toolById = new Map<string, Omit<ToolPart, "type">>();
  private toolOrder: string[] = [];

  constructor(ev: AcpEvents) {
    this.ev = ev;
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // connect -> initialize -> session/new，完成即 onStatus("ready")
  async connect(url: string): Promise<void> {
    this.ev.onStatus("connecting");
    await new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        this.initHandshake()
          .then(resolve)
          .catch(reject);
      };
      this.ws.onerror = () => reject(new Error("WebSocket connection failed"));
      this.ws.onclose = () => {
        this.ev.onStatus("idle");
        this.rejectAll(new Error("connection closed"));
      };
      this.ws.onmessage = (e) => this.handleMessage(String(e.data));
    });
    this.ev.onStatus("ready");
  }

  private async initHandshake() {
    await this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "termux-agent-web", version: "0.1" },
    });
    const res = (await this.request("session/new", { cwd: "/tmp", mcpServers: [] })) as {
      sessionId?: string;
    };
    if (!res.sessionId) throw new Error("no sessionId from session/new");
    this.sessionId = res.sessionId;
  }

  // 发送 prompt（fire-and-forget；结果走 session/update 通知 + 最终 result）
  sendPrompt(text: string): void {
    if (!this.sessionId || !this.ws) return;
    // 每条新 prompt 清空累积，避免跨轮串消息
    this.textByMessage.clear();
    this.thoughtByMessage.clear();
    this.toolById.clear();
    this.toolOrder = [];
    this.promptId = this.nextId++;
    const msg = {
      jsonrpc: "2.0",
      id: this.promptId,
      method: "session/prompt",
      params: { sessionId: this.sessionId, prompt: [{ type: "text", text }] },
    };
    this.ws.send(JSON.stringify(msg));
  }

  reset() {
    this.textByMessage.clear();
    this.thoughtByMessage.clear();
    this.toolById.clear();
    this.toolOrder = [];
  }

  private request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject, method });
      this.ws?.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  // 默认自动批准权限请求（goose serve 默认 auto 模式）
  respondPermission(requestId: number, approve = true) {
    this.ws?.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        result: { outcome: { outcome: "selected", optionId: approve ? "allow_once" : "reject_once" } },
      }),
    );
  }

  private handleMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // 1. 同步响应（initialize / session/new / session/prompt 最终 result）
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message ?? "rpc error"));
        else p.resolve(msg.result);
      }
      if (this.promptId !== null && msg.id === this.promptId) {
        if (msg.error) this.ev.onError(msg.error.message ?? "prompt failed");
        else this.ev.onRunComplete();
        this.promptId = null;
      }
      return;
    }

    // 2. 服务端主动请求（权限等）
    if (msg.method === "requestPermission") {
      this.respondPermission(msg.id, true);
      return;
    }

    // 3. 通知：session/update
    if (msg.method === "session/update") {
      this.handleUpdate(msg.params?.update ?? msg.params);
    }
  }

  private handleUpdate(update: any) {
    if (!update) return;
    const kind = update.sessionUpdate;

    if (kind === "agent_message_chunk") {
      const mid = String(update.messageId ?? "default");
      const t = update.content?.text ?? "";
      this.textByMessage.set(mid, (this.textByMessage.get(mid) ?? "") + t);
      this.emit();
    } else if (kind === "agent_thought_chunk") {
      const mid = String(update.thoughtMessageId ?? update.messageId ?? "thought");
      const t = update.content?.text ?? "";
      this.thoughtByMessage.set(mid, (this.thoughtByMessage.get(mid) ?? "") + t);
      this.emit();
    } else if (kind === "tool_call") {
      this.upsertTool({
        toolCallId: String(update.toolCallId),
        toolName: update.title ?? "tool",
        status: "in_progress",
      });
    } else if (kind === "tool_call_update") {
      const status: ToolPart["status"] =
        update.status === "completed"
          ? "completed"
          : update.status === "failed" || update.status === "error"
            ? "failed"
            : "in_progress";
      this.upsertTool({
        toolCallId: String(update.toolCallId),
        toolName: update.title ?? this.toolById.get(String(update.toolCallId))?.toolName ?? "tool",
        status,
        detail: update.status,
      });
    }
  }

  private upsertTool(part: Omit<ToolPart, "type">) {
    if (!this.toolById.has(part.toolCallId)) this.toolOrder.push(part.toolCallId);
    this.toolById.set(part.toolCallId, part);
    this.emit();
  }

  // 汇总当前累积状态为完整快照
  private emit() {
    const parts: StreamPart[] = [];
    for (const [mid, text] of this.textByMessage) {
      if (text.trim()) parts.push({ type: "text", text });
    }
    for (const [mid, text] of this.thoughtByMessage) {
      if (text.trim()) parts.push({ type: "thought", text });
    }
    for (const id of this.toolOrder) {
      const p = this.toolById.get(id);
      if (p) parts.push({ ...p, type: "tool-call" as const });
    }
    this.ev.onSnapshot(parts);
  }

  private rejectAll(err: unknown) {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }

  close() {
    this.rejectAll(new Error("closed by client"));
    this.ws?.close();
    this.ws = null;
    this.sessionId = null;
  }
}
