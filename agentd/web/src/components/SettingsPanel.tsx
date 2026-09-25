import { useEffect, useState, type ReactNode } from "react";
import { api, setToken, type AppSettings, type Provider, type ToolInfo } from "../api";
import type { ThemePref } from "../theme";
import { IconClose } from "./icons";

const MODES: Array<{ v: "auto" | "approve" | "chat"; label: string; hint: string }> = [
  { v: "auto", label: "全自动", hint: "所有工具直接执行（不推荐）" },
  { v: "approve", label: "逐次审批", hint: "写文件/危险操作需你确认（推荐）" },
  { v: "chat", label: "纯聊天", hint: "不调用任何工具" },
];

const RISK_LABEL: Record<string, string> = {
  safe: "只读",
  write: "需确认",
  danger: "危险",
};

const THEMES: Array<{ v: ThemePref; label: string; swatch: ReactNode }> = [
  {
    v: "dark",
    label: "深色",
    swatch: (
      <svg width="46" height="30" viewBox="0 0 46 30">
        <rect width="46" height="30" rx="7" fill="#161922" />
        <rect x="6" y="7" width="20" height="4" rx="2" fill="#e4e7ec" opacity="0.9" />
        <rect x="6" y="15" width="34" height="4" rx="2" fill="#9aa3b2" opacity="0.5" />
        <rect x="6" y="22" width="14" height="3" rx="1.5" fill="#10b981" />
      </svg>
    ),
  },
  {
    v: "light",
    label: "浅色",
    swatch: (
      <svg width="46" height="30" viewBox="0 0 46 30">
        <rect width="46" height="30" rx="7" fill="#ffffff" stroke="#e0e5ec" />
        <rect x="6" y="7" width="20" height="4" rx="2" fill="#1a1f2a" opacity="0.85" />
        <rect x="6" y="15" width="34" height="4" rx="2" fill="#5a6472" opacity="0.4" />
        <rect x="6" y="22" width="14" height="3" rx="1.5" fill="#0d9d6e" />
      </svg>
    ),
  },
  {
    v: "system",
    label: "跟随系统",
    swatch: (
      <svg width="46" height="30" viewBox="0 0 46 30">
        <rect width="23" height="30" rx="7" fill="#161922" />
        <rect x="23" width="23" height="30" rx="7" fill="#ffffff" stroke="#e0e5ec" />
        <rect x="6" y="7" width="14" height="4" rx="2" fill="#e4e7ec" opacity="0.9" />
        <rect x="28" y="7" width="12" height="4" rx="2" fill="#1a1f2a" opacity="0.85" />
        <rect x="6" y="15" width="16" height="4" rx="2" fill="#9aa3b2" opacity="0.5" />
        <rect x="28" y="15" width="12" height="4" rx="2" fill="#5a6472" opacity="0.4" />
        <rect x="6" y="22" width="10" height="3" rx="1.5" fill="#10b981" />
        <rect x="28" y="22" width="10" height="3" rx="1.5" fill="#0d9d6e" />
      </svg>
    ),
  },
];

export function SettingsPanel({
  onClose,
  mock,
  theme,
  onTheme,
}: {
  onClose: () => void;
  mock: boolean;
  theme: ThemePref;
  onTheme: (t: ThemePref) => void;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [form, setForm] = useState<AppSettings | null>(null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    void api.get<{ providers: Provider[] }>("/api/providers").then((d) => setProviders(d.providers)).catch(() => {});
    void api.get<AppSettings>("/api/settings").then(setForm).catch(() => {});
    void api.get<{ tools: ToolInfo[] }>("/api/tools").then((d) => setTools(d.tools)).catch(() => {});
  }, []);

  if (!form) {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="sheet" onClick={(e) => e.stopPropagation()}>
          <p className="center-muted">加载中…</p>
        </div>
      </div>
    );
  }

  const pickProvider = (id: string) => {
    const p = providers.find((x) => x.id === id);
    if (!p) return;
    setForm((f) => (f ? { ...f, llm: { ...f.llm, provider: id, base_url: p.base_url, model: p.model } } : f));
  };

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      await api.put("/api/settings", {
        llm: form.llm,
        permission_mode: form.permission_mode,
        server: {
          token: form.server?.token ?? "",
          approval_timeout: Number(form.server?.approval_timeout ?? 120),
        },
      });
      // 局域网令牌同步到本地，后续请求自动携带
      setToken((form.server?.token ?? "").trim());
      setMsg("已保存");
      setTimeout(onClose, 800);
    } catch (e) {
      setMsg((e as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>设置</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <IconClose />
          </button>
        </div>

        {mock && <p className="mock-banner">当前是离线演示模式（--mock），下面的配置不影响演示。</p>}

        {/* 外观 */}
        <div className="group">
          <p className="group-title">外观</p>
          <div className="field">
            <label>主题</label>
            <div className="theme-row">
              {THEMES.map((t) => (
                <label key={t.v} className={`theme ${theme === t.v ? "on" : ""}`}>
                  <input
                    type="radio"
                    name="theme"
                    checked={theme === t.v}
                    onChange={() => onTheme(t.v)}
                  />
                  {t.swatch}
                  {t.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* 模型 */}
        <div className="group">
          <p className="group-title">模型</p>
          <div className="field">
            <label>模型厂商</label>
            <select value={form.llm.provider} onChange={(e) => pickProvider(e.target.value)}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {providers.find((p) => p.id === form.llm.provider)?.note && (
              <p className="hint">{providers.find((p) => p.id === form.llm.provider)?.note}</p>
            )}
          </div>
          <div className="field">
            <label>Base URL</label>
            <input
              value={form.llm.base_url}
              onChange={(e) => setForm((f) => (f ? { ...f, llm: { ...f.llm, base_url: e.target.value } } : f))}
              placeholder="https://…/v1"
            />
          </div>
          <div className="field">
            <label>模型名</label>
            <input
              value={form.llm.model}
              onChange={(e) => setForm((f) => (f ? { ...f, llm: { ...f.llm, model: e.target.value } } : f))}
              placeholder="例如 deepseek-chat"
            />
          </div>
          <div className="field">
            <label>API Key</label>
            <div className="key-row">
              <input
                type={showKey ? "text" : "password"}
                value={form.llm.api_key}
                onChange={(e) => setForm((f) => (f ? { ...f, llm: { ...f.llm, api_key: e.target.value } } : f))}
                placeholder={form.llm.api_key ? "已配置（留空则不修改）" : "sk-…"}
              />
              <button className="btn sm" onClick={() => setShowKey((v) => !v)}>
                {showKey ? "隐藏" : "显示"}
              </button>
            </div>
          </div>
          <div className="field">
            <label>Temperature · {form.llm.temperature.toFixed(1)}</label>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={form.llm.temperature}
              onChange={(e) =>
                setForm((f) => (f ? { ...f, llm: { ...f.llm, temperature: Number(e.target.value) } } : f))
              }
            />
            <p className="hint">低 = 更稳定听话，高 = 更有创意</p>
          </div>
        </div>

        {/* 权限与安全 */}
        <div className="group">
          <p className="group-title">权限与安全</p>
          <div className="field">
            <label>工具权限</label>
            <div className="mode-row">
              {MODES.map((m) => (
                <label key={m.v} className={`mode ${form.permission_mode === m.v ? "on" : ""}`}>
                  <input
                    type="radio"
                    name="permission_mode"
                    checked={form.permission_mode === m.v}
                    onChange={() => setForm((f) => (f ? { ...f, permission_mode: m.v } : f))}
                  />
                  <b>{m.label}</b>
                  <span>{m.hint}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <label>局域网访问令牌（可选）</label>
            <input
              value={form.server?.token ?? ""}
              onChange={(e) => setForm((f) => (f ? { ...f, server: { ...f.server, token: e.target.value } } : f))}
              placeholder="留空 = 仅本机可访问"
            />
            <p className="hint">设置后以 --lan 启动时，请求需带 Authorization: Bearer &lt;令牌&gt;</p>
          </div>
          <div className="field">
            <label>审批超时（秒）</label>
            <input
              type="number"
              min={5}
              max={600}
              value={form.server?.approval_timeout ?? 120}
              onChange={(e) =>
                setForm((f) =>
                  f ? { ...f, server: { ...f.server, approval_timeout: Number(e.target.value) || 120 } } : f
                )
              }
            />
            <p className="hint">等待审批超过该时长自动拒绝（安全优先）</p>
          </div>
        </div>

        {/* 手机能力 */}
        <div className="group">
          <p className="group-title">手机能力（{tools.length} 项）</p>
          <div className="field">
            <ul className="tools-list">
              {tools.map((t) => (
                <li key={t.name} className={`tool-item ${t.risk}`}>
                  <code>{t.name}</code>
                  <span className="tool-risk">{RISK_LABEL[t.risk] ?? t.risk}</span>
                  <p>{t.summary}</p>
                </li>
              ))}
            </ul>
            <p className="hint">需要 termux-api 的支持：pkg install termux-api</p>
          </div>
        </div>

        <div className="sheet-foot">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={() => void save()} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
        {msg && <p className="save-msg">{msg}</p>}
      </div>
    </div>
  );
}
