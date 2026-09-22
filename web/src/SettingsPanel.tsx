import { useEffect, useState } from "react";
import { useConn } from "./ChatProvider";
import { BridgeClient, type AgentSettings } from "./bridge-client";

function maskKey(k: string) {
  if (!k) return "";
  return k.length > 8 ? k.slice(0, 6) + "…" + k.slice(-4) : "•".repeat(k.length);
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { status } = useConn();
  const client = new BridgeClient({
    onStatus: () => {},
    onSnapshot: () => {},
    onRunComplete: () => {},
    onError: () => {},
  });
  const [form, setForm] = useState<AgentSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [showKey, setShowKey] = useState(false);

  const load = () => {
    void client.getSettings().then((s) => {
      if (s) setForm(s);
    });
  };

  useEffect(() => {
    load();
    return () => client.close();
  }, []);

  if (!form) {
    return (
      <Overlay onClose={onClose}>
        <PanelShell title="设置" onClose={onClose}>
          <p className="py-8 text-center text-sm text-zinc-500">加载中…</p>
        </PanelShell>
      </Overlay>
    );
  }

  const set = <K extends keyof AgentSettings>(k: K, v: AgentSettings[K]) =>
    setForm((p) => (p ? { ...p, [k]: v } : p));

  const resetDefaults = () => {
    setForm({
      ...form,
      model: "agnes-3.0-flash",
      temperature: 0,
      maxTokens: 0,
      thinking: "",
    });
    setMsg("已恢复默认值，点击「保存并重启」生效");
  };

  const submit = async () => {
    setSaving(true);
    setMsg("");
    const r = await client.applySettings({
      model: form.model,
      temperature: form.temperature,
      maxTokens: form.maxTokens,
      thinking: form.thinking,
      apiKey: form.apiKey,
    });
    setSaving(false);
    if (r.ok) {
      setMsg("已保存，正在重启 goose…");
      setTimeout(onClose, 1200);
    } else {
      setMsg(r.error || "保存失败");
    }
  };

  const connected = status === "ready";

  return (
    <Overlay onClose={onClose}>
      <PanelShell title="智能体设置" onClose={onClose}>
        <div className="space-y-5">
          <Field label="API Key" hint="当前智能体使用的 LLM 凭据">
            <div className="flex gap-2">
              <input
                type={showKey ? "text" : "password"}
                value={form.apiKey}
                onChange={(e) => set("apiKey", e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-emerald-500/40"
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                className="rounded-lg border border-white/10 px-3 text-xs text-zinc-400 transition hover:bg-white/[0.05]"
              >
                {showKey ? "隐藏" : "显示"}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-zinc-600">
              {form.apiKey ? `当前：${maskKey(form.apiKey)}` : "尚未配置"}
            </p>
          </Field>

          <Field label="模型" hint="GOOSE_MODEL，可换成自定义 provider 支持的模型名">
            <input
              value={form.model}
              onChange={(e) => set("model", e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-emerald-500/40"
            />
          </Field>

          <Field
            label="Temperature"
            hint="回答随机性：0 更确定，越高越发散"
          >
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={form.temperature}
                onChange={(e) =>
                  set("temperature", Number(e.target.value))
                }
                className="flex-1 accent-emerald-500"
              />
              <span className="w-10 text-right text-sm text-zinc-300">
                {form.temperature.toFixed(1)}
              </span>
            </div>
          </Field>

          <Field
            label="Max Tokens"
            hint="单次回复上限；0 表示用默认（32768）"
          >
            <input
              type="number"
              min={0}
              max={32768}
              step={256}
              value={form.maxTokens}
              onChange={(e) =>
                set(
                  "maxTokens",
                  Math.max(0, Math.min(32768, Number(e.target.value) || 0)),
                )
              }
              className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-emerald-500/40"
            />
          </Field>

          <Field
            label="Thinking Effort"
            hint="思考深度：越高推理越深、耗时长"
          >
            <div className="grid grid-cols-4 gap-2">
              {(["", "low", "medium", "high"] as const).map((v) => (
                <button
                  key={v || "default"}
                  onClick={() => set("thinking", v)}
                  className={`rounded-lg border px-2 py-1.5 text-xs transition ${
                    form.thinking === v
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                      : "border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06]"
                  }`}
                >
                  {v || "默认"}
                </button>
              ))}
            </div>
          </Field>

          {!connected && (
            <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
              当前智能体未就绪，保存设置后会触发 goose 重启
            </p>
          )}

          <div className="flex items-center gap-2 border-t border-white/[0.06] pt-4">
            <button
              onClick={resetDefaults}
              className="rounded-xl border border-white/10 px-3 py-2 text-xs text-zinc-400 transition hover:bg-white/[0.05]"
            >
              重置默认
            </button>
            <button
              onClick={onClose}
              className="rounded-xl border border-white/10 px-4 py-2 text-sm text-zinc-400 transition hover:bg-white/[0.05]"
            >
              取消
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="flex-1 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-emerald-500/20 transition active:scale-[0.98] disabled:opacity-50"
            >
              {saving ? "保存中…" : "保存并重启"}
            </button>
          </div>

          {msg && (
            <p className="text-center text-xs text-emerald-400">{msg}</p>
          )}
        </div>
      </PanelShell>
    </Overlay>
  );
}

function Overlay({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function PanelShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border border-white/[0.08] bg-[#11141a] p-5 shadow-2xl sm:rounded-2xl"
      style={{
        paddingBottom: "max(env(safe-area-inset-bottom), 20px)",
      }}
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/[0.06]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label className="text-xs font-medium text-zinc-300">{label}</label>
        {hint && <span className="text-[10px] text-zinc-600">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
