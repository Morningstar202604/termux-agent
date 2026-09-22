import {
  useEffect,
  useRef,
  useState,
  createContext,
  useContext,
} from "react";
import {
  useExternalStoreRuntime,
  AssistantRuntimeProvider,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import {
  BridgeClient,
  type BridgeStatus,
  type ToolPart,
  type StreamPart,
} from "./bridge-client";

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export interface AssistantMeta {
  tools: ToolPart[];
  running: boolean;
}
export type { ToolPart };

interface MetaContext {
  meta: Record<string, AssistantMeta>;
}
const MetaCtx = createContext<MetaContext>({ meta: {} });
export const useMeta = () => useContext(MetaCtx);

export interface ConnContext {
  status: BridgeStatus;
  error: string;
  reconnect: () => void;
}
const ConnCtx = createContext<ConnContext>({
  status: "idle",
  error: "",
  reconnect: () => {},
});
export const useConn = () => useContext(ConnCtx);

export function ChatProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [messages, setMessages] = useState<ThreadMessageLike[]>([]);
  const [meta, setMeta] = useState<Record<string, AssistantMeta>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<BridgeStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const clientRef = useRef<BridgeClient | null>(null);
  const assistantIdRef = useRef<string>(uid("asst"));
  const pollRef = useRef<{ timer: number; stopped: boolean }>({
    timer: 0,
    stopped: false,
  });
  // 未连接时先收下消息，连接恢复后自动发出（用户消息永远不丢）
  const pendingRef = useRef<string | null>(null);
  const statusRef = useRef<BridgeStatus>("idle");
  const isRunningRef = useRef(false);
  statusRef.current = status;
  isRunningRef.current = isRunning;

  const finalizeAssistant = (aid: string) => {
    setIsRunning(false);
    isRunningRef.current = false;
    setMeta((prev) => ({
      ...prev,
      [aid]: { ...prev[aid], running: false },
    }));
    // 完成时才 trim，避免流式期间尾部空格闪烁
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== aid) return m;
        const content = (m.content as any[]).map((c) =>
          c.type === "text" || c.type === "reasoning"
            ? { ...c, text: (c.text ?? "").trim() }
            : c,
        );
        return {
          ...m,
          content,
          status: { type: "complete", reason: "stop" },
        } as ThreadMessageLike;
      }),
    );
  };

  // 真正发一条 prompt：建 assistant 消息 + meta，然后轮询服务端状态
  const doSend = async (text: string) => {
    const newAsstId = uid("asst");
    assistantIdRef.current = newAsstId;
    setMeta((prev) => ({
      ...prev,
      [newAsstId]: { tools: [], running: true },
    }));
    setIsRunning(true);
    isRunningRef.current = true;
    setErrorMsg("");
    try {
      await clientRef.current!.sendPrompt(text);
    } catch (e) {
      setIsRunning(false);
      isRunningRef.current = false;
      setErrorMsg(String((e as Error)?.message ?? e));
      setMeta((prev) => ({
        ...prev,
        [newAsstId]: { ...prev[newAsstId], running: false },
      }));
    }
  };

  const markReady = async (): Promise<boolean> => {
    const c = clientRef.current!;
    const h = await c.health();
    if (h.ok && h.handshaked) {
      setStatus("ready");
      statusRef.current = "ready";
      setErrorMsg("");
      pollRef.current.stopped = true;
      if (pollRef.current.timer) window.clearTimeout(pollRef.current.timer);
      // 有待发消息：连接恢复，立即补发
      const pending = pendingRef.current;
      if (pending && !isRunningRef.current) {
        pendingRef.current = null;
        void doSend(pending);
      }
      return true;
    }
    setStatus("error");
    statusRef.current = "error";
    setErrorMsg(
      h.ok ? "服务已就绪，正在等 goose 初始化…" : "无法连接服务（/api）",
    );
    pollRef.current.stopped = false;
    schedulePoll();
    return false;
  };

  const schedulePoll = () => {
    const p = pollRef.current;
    p.timer = window.setTimeout(() => {
      if (p.stopped) return;
      markReady().catch(() => {});
    }, 2000);
  };

  useEffect(() => {
    const client = new BridgeClient({
      onStatus: (s, m) => {
        setStatus(s);
        statusRef.current = s;
        if (m) setErrorMsg(m);
      },
      onSnapshot: (parts: StreamPart[]) => {
        const aid = assistantIdRef.current;
        let text = "";
        let thought = "";
        const toolParts: ToolPart[] = [];
        for (const p of parts) {
          if (p.type === "text") text += p.text;
          else if (p.type === "thought") thought += p.text;
          else if (p.type === "tool-call") toolParts.push(p);
        }
        // 工具卡片/运行状态按 assistant 消息 id 存，历史消息保留自己的卡片
        setMeta((prev) => ({
          ...prev,
          [aid]: { tools: toolParts, running: true },
        }));
        setMessages((prev) => {
          const content: any[] = [];
          // 流式期间不 trim，完成时再统一 trim
          if (thought) content.push({ type: "reasoning", text: thought });
          if (text) content.push({ type: "text", text });
          if (content.length === 0) content.push({ type: "text", text: "" });
          const updated: ThreadMessageLike = {
            role: "assistant",
            content,
            id: aid,
            status: { type: "running" },
          };
          const idx = prev.findIndex((m) => m.id === aid);
          if (idx === -1) return [...prev, updated];
          const next = [...prev];
          next[idx] = updated;
          return next;
        });
      },
      onRunComplete: () => {
        finalizeAssistant(assistantIdRef.current);
      },
      onError: (m) => {
        // 忙碌/业务错误不改连接状态；只有真连接故障才标 error
        const busy = /上一轮|进行中|409|未就绪|已停止/.test(m);
        if (!busy) {
          setStatus("error");
          statusRef.current = "error";
        }
        setErrorMsg(m);
        finalizeAssistant(assistantIdRef.current);
      },
    });
    clientRef.current = client;
    // 打开页面立即探活，失败自动轮询直到 ready（2s × 无上限，短请求）
    pollRef.current.stopped = false;
    setStatus("connecting");
    statusRef.current = "connecting";
    markReady().catch(() => {});
    return () => {
      pollRef.current.stopped = true;
      if (pollRef.current.timer) window.clearTimeout(pollRef.current.timer);
      client.close();
    };
  }, []);

  const reconnect = () => {
    pollRef.current.stopped = false;
    setStatus("connecting");
    statusRef.current = "connecting";
    setErrorMsg("");
    markReady().catch(() => {});
  };

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning,
    // 只在运行中禁发；未连接也允许输入，发送时排队等连接
    isSendDisabled: isRunning,
    convertMessage: (m: ThreadMessageLike) => m,
    onNew: async (msg) => {
      const text = msg.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { text: string }).text)
        .join("\n")
        .trim();
      if (!text) return;

      // 用户消息总是先入列表，绝不丢
      const userMsg: ThreadMessageLike = {
        role: "user",
        content: msg.content,
        id: uid("user"),
      };
      setMessages((prev) => [...prev, userMsg]);

      // 未连接：挂起，连接恢复后 markReady 里自动补发
      if (statusRef.current !== "ready") {
        pendingRef.current = text;
        setStatus("connecting");
        statusRef.current = "connecting";
        setErrorMsg("等待连接，消息已暂存，连接恢复后自动发送");
        pollRef.current.stopped = false;
        markReady().catch(() => {});
        return;
      }

      if (isRunningRef.current) {
        setErrorMsg("上一轮回复还在进行中，请稍候再发");
        return;
      }
      await doSend(text);
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <MetaCtx.Provider value={{ meta }}>
        <ConnCtx.Provider value={{ status, error: errorMsg, reconnect }}>
          <div className="flex h-full flex-col">{children}</div>
        </ConnCtx.Provider>
      </MetaCtx.Provider>
    </AssistantRuntimeProvider>
  );
}
