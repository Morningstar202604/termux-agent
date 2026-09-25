// 前端消息模型

export interface ToolPart {
  id: string;
  name: string;
  input: unknown;
  status: "running" | "waiting" | "completed" | "failed" | "denied";
  result?: Record<string, unknown>;
  summary?: string;
  risk?: string;
}

export type Part =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; tool: ToolPart };

export interface Msg {
  id: string;
  role: "user" | "assistant";
  parts: Part[];
  done: boolean;
  error?: string;
  queued?: boolean;
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
