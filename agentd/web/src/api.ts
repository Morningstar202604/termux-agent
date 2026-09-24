// agentd API 客户端：REST + SSE 流式。

export interface Session {
  id: string;
  title: string;
  message_count: number;
}

export interface StoredMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  meta: Record<string, unknown>;
}

export interface Provider {
  id: string;
  label: string;
  base_url: string;
  model: string;
  note: string;
}

export interface LlmSettings {
  provider: string;
  base_url: string;
  api_key: string;
  model: string;
  temperature: number;
  max_tokens: number;
}

export interface AppSettings {
  llm: LlmSettings;
  permission_mode: "auto" | "approve" | "chat";
  server: { allow_lan?: boolean; token?: string; approval_timeout?: number };
}

export interface ToolInfo {
  name: string;
  description: string;
  risk: "safe" | "write" | "danger";
  summary: string;
  timeout: number;
}

export type ChatEvent =
  | { type: "session"; session_id: string }
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "approval"; id: string; name: string; summary: string; risk: string }
  | {
      type: "tool_update";
      id: string;
      name: string;
      status: "completed" | "failed" | "denied";
      result: Record<string, unknown>;
    }
  | { type: "done"; stop_reason: string }
  | { type: "error"; message: string };

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.detail) msg = j.detail;
      else if (j?.error) msg = j.error;
    } catch {
      /* keep http status */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const api = {
  async get<T>(path: string): Promise<T> {
    return parse<T>(await fetch(path, { cache: "no-store" }));
  },
  async post<T>(path: string, body?: unknown): Promise<T> {
    return parse<T>(
      await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    );
  },
  async put<T>(path: string, body: unknown): Promise<T> {
    return parse<T>(
      await fetch(path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  },
  async del<T>(path: string): Promise<T> {
    return parse<T>(await fetch(path, { method: "DELETE" }));
  },

  /** POST /api/chat 并逐行消费 SSE，事件交给 onEvent。 */
  async sseChat(
    sessionId: string,
    message: string,
    onEvent: (ev: ChatEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message }),
      signal,
    });
    if (!res.ok || !res.body) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        msg = j?.detail || j?.error || msg;
      } catch {
        /* keep */
      }
      throw new Error(msg);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (t.startsWith("data: ")) {
          try {
            onEvent(JSON.parse(t.slice(6)) as ChatEvent);
          } catch {
            /* 忽略坏帧 */
          }
        }
      }
    }
  },
};
