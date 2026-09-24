import { useState } from "react";

export function Composer({
  busy,
  ready,
  onSend,
  onStop,
  error,
}: {
  busy: boolean;
  ready: boolean;
  onSend: (t: string) => void;
  onStop: () => void;
  error: string;
}) {
  const [text, setText] = useState("");
  const submit = () => {
    if (busy || !text.trim()) return;
    onSend(text);
    setText("");
  };
  return (
    <footer className="composer">
      {error && <div className="composer-err">{error}</div>}
      <div className="composer-box">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={busy ? "回复生成中…" : "输入指令，回车发送"}
          rows={1}
        />
        {busy ? (
          <button className="send stop" onClick={onStop} title="停止" aria-label="停止">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            className="send"
            onClick={submit}
            disabled={!text.trim() || !ready}
            title="发送"
            aria-label="发送"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2 11 13" />
              <path d="M22 2 15 22 11 13 2 9l20-7z" />
            </svg>
          </button>
        )}
      </div>
      <p className="composer-hint">本地运行 · 数据仅在你的设备上</p>
    </footer>
  );
}
