import { useEffect, useRef, useState } from "react";
import { IconSend, IconStop } from "./icons";

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
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 输入框随内容自动增高（最多 6 行），发送/清空后复原
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  }, [text]);

  const submit = () => {
    // busy 时不拦截：回复生成中继续发送会进入消息队列，自动排队执行
    if (!text.trim()) return;
    onSend(text);
    setText("");
  };
  return (
    <footer className="composer">
      {error && <div className="composer-err">{error}</div>}
      <div className="composer-box">
        <textarea
          ref={taRef}
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
            <IconStop size={14} />
          </button>
        ) : (
          <button
            className="send"
            onClick={submit}
            disabled={!text.trim() || !ready}
            title="发送"
            aria-label="发送"
          >
            <IconSend size={16} />
          </button>
        )}
      </div>
      <p className="composer-hint">本地运行 · 数据仅在你的设备上</p>
    </footer>
  );
}
