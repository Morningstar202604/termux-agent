import type { Session } from "../api";
import { IconClose, IconPlus, IconTrash } from "./icons";

export function SessionList({
  sessions,
  currentId,
  onClose,
  onPick,
  onNew,
  onDelete,
  onRename,
}: {
  sessions: Session[];
  currentId: string;
  onClose: () => void;
  onPick: (sid: string) => void;
  onNew: () => void;
  onDelete: (sid: string) => void;
  onRename: (sid: string, title: string) => void;
}) {
  const rename = (s: Session) => {
    const title = window.prompt("给会话改个名字（留空 = 不改）", s.title);
    if (title && title.trim() && title.trim() !== s.title) onRename(s.id, title.trim());
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>会话</h2>
          <div className="drawer-actions">
            <button className="btn primary sm" onClick={onNew}>
              <IconPlus size={13} /> 新建
            </button>
            <button className="icon-btn" onClick={onClose} aria-label="关闭">
              <IconClose />
            </button>
          </div>
        </div>
        <ul className="sessions">
          {sessions.length === 0 && <li className="s-empty">还没有会话</li>}
          {sessions.map((s) => (
            <li
              key={s.id}
              className={`session ${s.id === currentId ? "active" : ""}`}
              onClick={() => onPick(s.id)}
            >
              <div className="session-main">
                <span className="s-title" title="点击重命名" onDoubleClick={() => rename(s)}>
                  {s.title}
                </span>
                <span className="s-count">{s.message_count} 条消息</span>
              </div>
              <div className="s-ops">
                <button
                  className="s-del s-rename"
                  onClick={(e) => {
                    e.stopPropagation();
                    rename(s);
                  }}
                  title="重命名会话"
                  aria-label="重命名会话"
                >
                  ✎
                </button>
                <button
                  className="s-del"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s.id);
                  }}
                  title="删除会话"
                  aria-label="删除会话"
                >
                  <IconTrash size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
