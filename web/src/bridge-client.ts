// 单端口 HTTP 轮询客户端：POST /api/chat 提交，GET /api/state 每 400ms 拉快照。
// 全部是短请求，无 SSE / WebSocket，任何代理与网络下都稳定。

export type BridgeStatus = "idle" | "connecting" | "ready" | "error";

export interface ToolPart {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  title?: string;
  status: "in_progress" | "completed" | "failed";
  input?: string;
  liveOutput?: string;
  result?: string;
  error?: string;
  exitCode?: number;
}

export type StreamPart =
  | { type: "text"; text: string }
  | { type: "thought"; text: string }
  | ToolPart;

export interface BridgeEvents {
  onStatus: (status: BridgeStatus, message?: string) => void;
  onSnapshot: (parts: StreamPart[]) => void;
  onRunComplete: () => void;
  onError: (message: string) => void;
}

export interface AgentSettings {
  model: string;
  temperature: number;
  maxTokens: number;
  thinking: "" | "low" | "medium" | "high";
  apiKey: string;
  gooseRunning?: boolean;
  goosePort?: number;
  gooseHome?: string;
}

interface ServerState {
  status: "idle" | "running" | "done" | "error";
  text: string;
  thought: string;
  tools: Omit<ToolPart, "type">[];
  error: string;
}

export class BridgeClient {
  private ev: BridgeEvents;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ev: BridgeEvents, private base = "") {
    this.ev = ev;
  }

  async health(): Promise<{ ok: boolean; handshaked: boolean }> {
    try {
      const r = await fetch(`${this.base}/api/health`, { cache: "no-store" });
      const j = await r.json();
      return { ok: !!j.ok, handshaked: !!j.handshaked };
    } catch {
      return { ok: false, handshaked: false };
    }
  }

  async getSettings(): Promise<AgentSettings | null> {
    try {
      const r = await fetch(`${this.base}/api/settings`, { cache: "no-store" });
      if (!r.ok) return null;
      return (await r.json()) as AgentSettings;
    } catch {
      return null;
    }
  }

  async applySettings(s: AgentSettings): Promise<{ ok: boolean; error?: string }> {
    try {
      const r = await fetch(`${this.base}/api/settings/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({} as any));
      return { ok: r.ok && !!j.ok, error: j.error };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  }

  /** 停止正在运行的回复 */
  async stop(): Promise<boolean> {
    try {
      const r = await fetch(`${this.base}/api/stop`, {
        method: "POST",
        cache: "no-store",
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  async sendPrompt(text: string): Promise<void> {
    this.stopPolling();
    this.ev.onSnapshot([]);

    const res = await fetch(`${this.base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
      cache: "no-store",
    }).catch(() => null);

    if (!res) {
      this.ev.onError("网络异常，无法提交消息");
      return;
    }
    if (res.status === 503) {
      const j = await res.json().catch(() => ({} as any));
      this.ev.onError(j.error ?? "智能体未就绪，稍后重试");
      return;
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({} as any));
      this.ev.onError(j.error ?? `HTTP ${res.status}`);
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        this.stopPolling();
        fn();
        resolve();
      };

      const tick = async () => {
        let s: ServerState;
        try {
          const r = await fetch(`${this.base}/api/state`, { cache: "no-store" });
          if (!r.ok) throw new Error(String(r.status));
          s = await r.json();
        } catch {
          settle(() => this.ev.onError("轮询失败，网络中断"));
          return;
        }

        this.emitFromState(s);

        if (s.status === "done") {
          settle(() => this.ev.onRunComplete());
        } else if (s.status === "error") {
          settle(() => this.ev.onError(s.error || "agent error"));
        }
      };

      this.pollTimer = setInterval(() => {
        void tick();
      }, 400);
      void tick();
    });
  }

  private emitFromState(s: ServerState) {
    const parts: StreamPart[] = [];
    if (s.thought?.trim()) parts.push({ type: "thought", text: s.thought });
    if (s.text?.trim()) parts.push({ type: "text", text: s.text });
    for (const t of s.tools ?? []) {
      parts.push({ ...t, type: "tool-call" as const });
    }
    this.ev.onSnapshot(parts);
  }

  private stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  close() {
    this.stopPolling();
  }
}
