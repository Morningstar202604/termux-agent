import { useEffect, useState } from "react";
import {
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  useAui,
} from "@assistant-ui/react";
import { ChatProvider, useMeta, useConn } from "./ChatProvider";
import { SettingsPanel } from "./SettingsPanel";
import { BridgeClient, type ToolPart } from "./bridge-client";

const SUGGESTIONS = [
  { icon: "🖥️", label: "查看系统状态" },
  { icon: "📁", label: "列出当前目录" },
  { icon: "🐚", label: "运行一条 shell 命令" },
  { icon: "🔧", label: "诊断网络问题" },
];

const EXAMPLE_PROMPTS = [
  "帮我看看这台机器还有什么可以优化的",
  "写一个 Python 脚本备份 ~/notes 目录",
  "用自然语言解释一下刚才那个报错",
  "把当前目录的 README 翻译成中文",
];

export default function App() {
  return (
    <div className="relative flex h-[100dvh] flex-col bg-[#0a0c10] text-zinc-100">
      <ChatProvider>
        <Header />
        <main className="min-h-0 flex-1">
          <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-3 sm:px-5">
            <ThreadPrimitive.Root>
              <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto overscroll-contain py-4">
                <ThreadPrimitive.Empty>
                  <EmptyState />
                </ThreadPrimitive.Empty>
                <ThreadPrimitive.Messages>
                  {({ message }) => (
                    <MessageRow key={message.id} role={message.role} />
                  )}
                </ThreadPrimitive.Messages>
                <ThreadPrimitive.ViewportFooter />
              </ThreadPrimitive.Viewport>
              <Composer />
            </ThreadPrimitive.Root>
          </div>
        </main>
      </ChatProvider>
    </div>
  );
}

/* ---------- Header ---------- */

function Header() {
  const { status, reconnect } = useConn();
  const [showSettings, setShowSettings] = useState(false);
  const [clearing, setClearing] = useState(false);
  const connected = status === "ready";
  const connecting = status === "connecting";

  const clearHistory = async () => {
    setClearing(true);
    const c = new BridgeClient({ onStatus: () => {}, onSnapshot: () => {}, onRunComplete: () => {}, onError: () => {} });
    await c.clearHistory();
    setClearing(false);
    window.location.reload();
  };
  return (
    <>
      <header className="z-20 flex items-center justify-between border-b border-white/[0.06] bg-[#0a0c10]/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 shadow-lg shadow-emerald-500/25">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="14" rx="2" />
              <path d="m7 9 3 3 4-4" />
              <path d="M7 14h6" />
              <circle cx="18" cy="15" r="1" fill="white" stroke="none" />
            </svg>
          </div>
          <div>
            <h1 className="text-[15px] font-semibold leading-tight tracking-tight">Termux Agent</h1>
            <p className="text-[11px] leading-tight text-zinc-500">本地 Goose 智能体</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={clearHistory}
            disabled={clearing}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-zinc-400 transition active:scale-95 hover:bg-white/[0.08] hover:text-zinc-200 disabled:opacity-50"
            aria-label="清空历史"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
            </svg>
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-zinc-400 transition active:scale-95 hover:bg-white/[0.08] hover:text-zinc-200"
            aria-label="设置"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.72l-.43.25a2 2 0 0 1-2 0l-.1-.05a2 2 0 0 0-2.78.77 2 2 0 0 0 0 2.77l.05.1a2 2 0 0 1 .25 2 2 2 0 0 1-.72 1l-.25.44a2 2 0 0 0 .77 2.78 2 2 0 0 0 2.77 0l.1-.05a2 2 0 0 1 2 .25 2 2 0 0 1 1-.72l.44-.25a2 2 0 0 1 2 0l.1.05a2 2 0 0 0 2.78-.77 2 2 0 0 0 0-2.77l-.05-.1a2 2 0 0 1-.25-2 2 2 0 0 1 .72-1l.25-.44a2 2 0 0 0-.77-2.78 2 2 0 0 0-2.77 0l-.1.05a2 2 0 0 1-2-.25V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
          <button
            onClick={reconnect}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              connected
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : connecting
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  : "border-red-500/30 bg-red-500/10 text-red-300"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connected
                  ? "bg-emerald-400"
                  : connecting
                    ? "animate-pulse bg-amber-400"
                    : "bg-red-400"
              }`}
            />
            {connected ? "已连接" : connecting ? "连接中" : "重连"}
          </button>
        </div>
      </header>
      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}
    </>
  );
}

/* ---------- Empty state ---------- */

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/15 to-cyan-500/15 ring-1 ring-emerald-500/20">
        <span className="text-3xl">🦅</span>
      </div>
      <h2 className="mt-4 text-lg font-semibold">开始对话</h2>
      <p className="mt-1.5 max-w-xs text-sm text-zinc-500">
        智能体在你的手机上本地运行，可调用 shell、文件、网络等工具完成指令
      </p>
      <div className="mt-6 grid w-full max-w-sm grid-cols-2 gap-2.5">
        {SUGGESTIONS.map((s) => (
          <SuggestionCard key={s.label} icon={s.icon} label={s.label} />
        ))}
      </div>
      <div className="mt-5 flex w-full max-w-sm flex-col gap-1.5">
        <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-600">
          试试这些指令
        </p>
        {EXAMPLE_PROMPTS.map((p) => (
          <ExamplePrompt key={p} text={p} />
        ))}
      </div>
    </div>
  );
}

function SuggestionCard({ icon, label }: { icon: string; label: string }) {
  const aui = useAui();
  return (
    <button
      onClick={() => {
        aui.thread().append({
          role: "user",
          content: [{ type: "text", text: label }],
        });
      }}
      className="flex flex-col items-start gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3 text-left transition active:scale-[0.98] active:bg-white/[0.06]"
    >
      <span className="text-xl">{icon}</span>
      <span className="text-xs font-medium text-zinc-300">{label}</span>
    </button>
  );
}

function ExamplePrompt({ text }: { text: string }) {
  const aui = useAui();
  return (
    <button
      onClick={() =>
        aui.thread().append({
          role: "user",
          content: [{ type: "text", text }],
        })
      }
      className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-left text-[12px] text-zinc-400 transition hover:border-emerald-500/20 hover:text-zinc-200 active:scale-[0.99]"
    >
      “{text}”
    </button>
  );
}

/* ---------- Messages ---------- */

function MessageRow({ role }: { role: "user" | "assistant" | "system" }) {
  const isUser = role === "user";
  return (
    <div className={`mb-1 flex ${isUser ? "justify-end" : "justify-start"}`}>
      {isUser ? (
        <UserBubble />
      ) : (
        <div className="w-full space-y-2.5">
          <AssistantBubble />
        </div>
      )}
    </div>
  );
}

function UserBubble() {
  const aui = useAui();
  const message = aui.message().getState();
  const text =
    (message.content as any[])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n") || "";
  return (
    <div className="max-w-[85%]">
      <div className="rounded-2xl rounded-br-md bg-gradient-to-br from-emerald-600 to-cyan-600 px-4 py-2.5 text-[14px] leading-relaxed text-white shadow-sm">
        <MessagePrimitive.Parts />
      </div>
      <CopyBar text={text} align="right" />
    </div>
  );
}

function CopyBar({ text, align = "left" }: { text: string; align?: "left" | "right" }) {
  const [done, setDone] = useState(false);
  if (!text.trim()) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className={`mt-1 flex items-center gap-2 px-1 ${align === "right" ? "justify-end" : ""}`}>
      <button
        onClick={copy}
        className="flex items-center gap-1 text-[11px] text-zinc-500 transition hover:text-zinc-300"
      >
        {done ? <CopyCheckIcon /> : <CopyIcon />}
        {done ? "已复制" : "复制"}
      </button>
    </div>
  );
}

function AssistantBubble() {
  const { meta } = useMeta();
  const aui = useAui();
  const message = aui.message().getState();
  const m = meta[message.id as string];
  const running = m?.running ?? false;
  const hasBody =
    message.parts.some((p) => p.type === "text" && (p.text ?? "").trim() !== "") ||
    message.parts.some((p) => p.type === "reasoning");
  const fullText =
    (message.content as any[])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n") || "";

  return (
    <div className="w-full space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 text-[10px] font-bold text-white">
          A
        </div>
        <span className="text-[11px] font-medium text-zinc-500">
          {running ? "正在思考…" : "Goose 智能体"}
        </span>
      </div>
      {m && m.tools.length > 0 && <ToolStream tools={m.tools} running={running} />}
      {hasBody && (
        <div className="rounded-2xl rounded-tl-md border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-[14px] leading-relaxed text-zinc-100">
          <AssistantMessage running={running} />
          {running && !hasText(message.parts) && <ThinkingDots />}
        </div>
      )}
      {!hasBody && running && (
        <div className="rounded-2xl rounded-tl-md border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-[14px]">
          <ThinkingDots />
        </div>
      )}
      {!running && !hasBody && fullText && <CopyBar text={fullText} />}
    </div>
  );
}

function hasText(parts: readonly any[]): boolean {
  return parts.some((p) => p.type === "text" && (p.text ?? "").trim() !== "");
}

function AssistantMessage({ running }: { running?: boolean }) {
  return (
    <MessagePrimitive.Parts
      components={{
        Reasoning: ({ text }) => (
          <ReasoningBlock text={(text ?? "").trim()} streaming={running} />
        ),
        Text: ({ text }) => (
          <span className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">
            {text}
          </span>
        ),
      }}
    />
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.2s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.1s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" />
    </span>
  );
}

/* ---------- Reasoning ---------- */

function ReasoningBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  // 流式中默认展开让用户看到思考过程，结束后默认收起
  const [open, setOpen] = useState<boolean | null>(null);
  if (!text) return null;
  const isOpen = open === null ? (streaming ? true : false) : open;
  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-white/[0.06] bg-black/20">
      <button
        onClick={() => setOpen((o) => (o === null ? false : !o))}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="text-zinc-400">
          {streaming ? (
            <span className="inline-flex h-3.5 w-3.5 items-center justify-center">
              <Spinner />
            </span>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          )}
        </span>
        <span className="text-xs font-medium text-zinc-400">
          {streaming ? "正在思考…" : "思考过程"}
        </span>
        {text.length > 60 && !isOpen && (
          <span className="text-[10px] text-zinc-600">· {Math.ceil(text.length / 12)} 行</span>
        )}
        <span
          className={`ml-auto text-zinc-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {isOpen && (
        <div className="border-t border-white/[0.06] px-3 py-2.5 text-xs leading-relaxed text-zinc-400 whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}

/* ---------- Tool stream ---------- */

function ToolStream({ tools, running }: { tools: ToolPart[]; running: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const runningTool = tools.find((t) => t.status === "in_progress");
  // 运行中默认只看当前工具；结束后默认全部展示（收起态卡片本身很紧凑）
  const active = showAll
    ? tools
    : running
      ? runningTool
        ? [runningTool]
        : tools.slice(-1)
      : tools;
  const hidden = tools.length - active.length;
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-1.5">
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          <span className="flex h-4 w-4 items-center justify-center rounded bg-white/[0.06]">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.77 3.77z" />
            </svg>
          </span>
          工具调用 · {tools.length}
        </span>
        {(showAll || hidden > 0) && tools.length > 1 && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-medium text-emerald-400"
          >
            {showAll ? "收起" : `全部展开 (+${hidden})`}
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {active.map((t) => (
          <ToolCard key={t.toolCallId} tool={t} />
        ))}
        {hidden > 0 && !showAll && (
          <p className="px-2 py-1 text-center text-[11px] text-zinc-600">
            还有 {hidden} 个工具已收起
          </p>
        )}
      </div>
    </div>
  );
}

function ToolCard({ tool }: { tool: ToolPart }) {
  const [open, setOpen] = useState(tool.status === "in_progress");
  const [tab, setTab] = useState<"detail" | "output">("detail");
  const isShell = /shell|command|run/i.test(tool.toolName ?? "");
  const toolIcon = isShell ? "⌨️" : "🧩";
  const status =
    tool.status === "completed" ? (
      <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400">
        <CheckIcon /> 完成
      </span>
    ) : tool.status === "failed" ? (
      <span className="flex items-center gap-1 text-[11px] font-medium text-red-400">
        <XIcon /> 失败
      </span>
    ) : (
      <span className="flex items-center gap-1 text-[11px] font-medium text-amber-400">
        <Spinner /> 运行中
      </span>
    );

  // 输入 / 输出 / 错误 三段独立取值，按状态组合展示
  const input = tool.input || tool.title;
  const out = tool.result || tool.liveOutput;
  const err = tool.error;
  const hasDetail = !!(input || (tool.status === "in_progress" ? tool.liveOutput : ""));
  const hasOutput = !!(tool.status !== "in_progress" && (out || err || tool.exitCode));

  const isFileOp = /write|edit|file|patch|replace/i.test(tool.toolName ?? "");

  const renderDetail = () => {
    const parts: string[] = [];
    if (input) parts.push("$ " + input);
    const runningOut = tool.status === "in_progress" ? tool.liveOutput : "";
    if (runningOut) parts.push(runningOut);
    if (tool.status !== "in_progress") {
      if (out) parts.push(out);
      if (err) parts.push("✗ " + err);
      if (tool.exitCode !== undefined && tool.exitCode !== 0)
        parts.push(`exit code: ${tool.exitCode}`);
    }
    return parts.length ? parts.join("\n") : undefined;
  };
  const detail = hasDetail ? renderDetail() : undefined;

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-black/20 ${
        tool.status === "failed"
          ? "border-red-500/25"
          : tool.status === "completed"
            ? "border-emerald-500/15"
            : "border-amber-500/20"
      }`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition active:bg-white/[0.04]"
      >
        <span
          className={`flex h-7 w-7 flex-none items-center justify-center rounded-lg text-sm ${
            tool.status === "failed"
              ? "bg-red-500/15"
              : tool.status === "completed"
                ? "bg-emerald-500/15"
                : "bg-amber-500/15"
          }`}
        >
          {toolIcon}
        </span>
        <span className="flex-1 truncate">
          <span className="flex items-center gap-1.5">
            <span className="block truncate text-xs font-medium text-zinc-200">
              {tool.title ?? tool.toolName}
            </span>
            {isFileOp && tool.status === "completed" && (
              <span className="rounded bg-emerald-500/15 px-1 text-[10px] text-emerald-400">
                文件
              </span>
            )}
          </span>
          {detail && !open && (
            <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
              {detail.split("\n")[0]}
            </span>
          )}
        </span>
        {status}
        <span className={`text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {open && (hasDetail || hasOutput) && (
        <div className="border-t border-white/[0.06]">
          {(hasDetail || hasOutput) && (
            <div className="flex gap-1 px-3 pt-2">
              {hasDetail && (
                <TabBtn active={tab === "detail"} onClick={() => setTab("detail")}>
                  过程
                </TabBtn>
              )}
              {hasOutput && (
                <TabBtn active={tab === "output"} onClick={() => setTab("output")}>
                  结果
                </TabBtn>
              )}
            </div>
          )}
          <pre
            className="max-h-52 overflow-auto bg-black/30 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-zinc-300"
          >
            {(tab === "output" ? (out ?? "") : detail) ?? ""}
          </pre>
        </div>
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
        active
          ? "bg-white/[0.08] text-zinc-100"
          : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}

/* ---------- Composer ---------- */

function Composer() {
  const { status, error } = useConn();
  const aui = useAui();
  const threadState = aui.optional.thread ? aui.thread().getState() : undefined;
  const running = threadState?.isRunning ?? false;
  const notReady = status === "error";
  const [settings, setSettings] = useState<{ model: string; permissionMode: string } | null>(null);
  useEffect(() => {
    void fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => d.ok && setSettings({ model: d.model, permissionMode: d.permissionMode }))
      .catch(() => {});
  }, [status]);
  const client = new BridgeClient({
    onStatus: () => {},
    onSnapshot: () => {},
    onRunComplete: () => {},
    onError: () => {},
  });
  const handleCancel = () => {
    void client.stop();
  };
  const permLabel: Record<string, string> = {
    auto: "全放行",
    approve: "逐次审批",
    smart_approve: "智能审批",
    chat: "纯聊天",
  };
  return (
    <div
      className="border-t border-white/[0.06] bg-[#0a0c10]/95 px-3 pt-3 backdrop-blur"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}
    >
      <div className="mx-auto w-full max-w-3xl">
        {(notReady || (status !== "ready" && error)) && (
          <p className="mb-2 px-1 text-[11px] text-amber-400">
            {error || "连接异常，正在自动重连…"}
          </p>
        )}
        {settings && (
          <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-zinc-500">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/70" />
              <span className="font-medium text-zinc-400">{settings.model}</span>
            </span>
            <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-0.5">
              权限：{permLabel[settings.permissionMode] ?? settings.permissionMode}
            </span>
          </div>
        )}
        <ComposerPrimitive.Root className="flex items-end gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-2 shadow-lg transition focus-within:border-emerald-500/40">
          <ComposerPrimitive.Input
            placeholder={
              running ? "回复生成中…可点右侧停止" : "输入指令，回车发送"
            }
            className="max-h-40 min-h-[36px] flex-1 resize-none px-2 py-2 text-[14px] leading-relaxed outline-none placeholder:text-zinc-500"
          />
          {running && (
            <ComposerPrimitive.Cancel
              className="mb-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-red-500/40 bg-red-500/15 text-red-400 transition active:scale-95"
              onClick={handleCancel}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </ComposerPrimitive.Cancel>
          )}
          {!running && (
            <ComposerPrimitive.Send className="mb-0.5 mr-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 text-white shadow-lg shadow-emerald-500/20 transition active:scale-95 disabled:from-zinc-700 disabled:to-zinc-700 disabled:shadow-none">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2 11 13" />
                <path d="M22 2 15 22 11 13 2 9l20-7z" />
              </svg>
            </ComposerPrimitive.Send>
          )}
        </ComposerPrimitive.Root>
        <p className="mt-2 text-center text-[10px] text-zinc-600">
          本地 Goose 智能体 · 数据仅在你的设备上
        </p>
      </div>
    </div>
  );
}

/* ---------- Icons ---------- */

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function CopyCheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function Spinner() {
  return (
    <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
