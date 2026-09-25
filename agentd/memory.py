"""会话与消息存储（SQLite）。

与旧实现（无会话模型的 JSONL）不同，这里用三张表：
sessions（会话） / messages（消息） / memory（长期记忆，M2 启用）。
消息落库后，服务重启也能完整恢复上下文。
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from pathlib import Path


def _now() -> float:
    return time.time()


class Store:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(path))
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self._migrate()
        self._secure_files()

    def _secure_files(self) -> None:
        """数据含会话隐私（短信/定位等），与 config.json 同级别保护：
        目录 700，数据库及其 WAL/SHM 文件 600，其他用户不可读。"""
        try:
            os.chmod(self.path.parent, 0o700)
        except OSError:
            pass
        for f in (self.path, Path(str(self.path) + "-wal"), Path(str(self.path) + "-shm")):
            try:
                if f.exists():
                    os.chmod(f, 0o600)
            except OSError:
                pass

    def _migrate(self) -> None:
        c = self.conn
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '新会话',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                meta TEXT NOT NULL DEFAULT '{}',
                created_at REAL NOT NULL
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'summary',
                content TEXT NOT NULL,
                created_at REAL NOT NULL
            )
            """
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_mem_sid ON memory(session_id, kind)")
        self.conn.commit()

    # ---------- 会话 ----------
    def create_session(self, title: str = "新会话") -> str:
        sid = uuid.uuid4().hex[:12]
        t = _now()
        self.conn.execute(
            "INSERT INTO sessions(id, title, created_at, updated_at) VALUES (?,?,?,?)",
            (sid, title, t, t),
        )
        self.conn.commit()
        return sid

    def list_sessions(self, limit: int = 50) -> list[dict]:
        rows = self.conn.execute(
            "SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["message_count"] = self.conn.execute(
                "SELECT COUNT(*) FROM messages WHERE session_id=? AND role IN ('user','assistant')",
                (d["id"],),
            ).fetchone()[0]
            out.append(d)
        return out

    def get_session(self, sid: str) -> dict | None:
        r = self.conn.execute(
            "SELECT id, title, created_at, updated_at FROM sessions WHERE id=?", (sid,)
        ).fetchone()
        return dict(r) if r else None

    def touch_session(self, sid: str, title: str | None = None) -> None:
        if title is not None:
            self.conn.execute(
                "UPDATE sessions SET title=?, updated_at=? WHERE id=?", (title, _now(), sid)
            )
        else:
            self.conn.execute("UPDATE sessions SET updated_at=? WHERE id=?", (_now(), sid))
        self.conn.commit()

    def delete_session(self, sid: str) -> bool:
        self.conn.execute("DELETE FROM messages WHERE session_id=?", (sid,))
        self.conn.execute("DELETE FROM memory WHERE session_id=?", (sid,))
        cur = self.conn.execute("DELETE FROM sessions WHERE id=?", (sid,))
        self.conn.commit()
        return cur.rowcount > 0

    def clear_all(self) -> None:
        self.conn.execute("DELETE FROM messages")
        self.conn.execute("DELETE FROM sessions")
        self.conn.execute("DELETE FROM memory")
        self.conn.commit()

    # ---------- 消息 ----------
    def add_message(self, sid: str, role: str, content: str, meta: dict | None = None) -> dict:
        t = _now()
        cur = self.conn.execute(
            "INSERT INTO messages(session_id, role, content, meta, created_at) VALUES (?,?,?,?,?)",
            (sid, role, content, json.dumps(meta or {}, ensure_ascii=False), t),
        )
        self.conn.commit()
        self.touch_session(sid)
        return {"id": cur.lastrowid, "role": role, "content": content, "meta": meta or {}}

    def get_messages(self, sid: str, limit: int = 200) -> list[dict]:
        rows = self.conn.execute(
            "SELECT role, content, meta FROM messages WHERE session_id=? ORDER BY id LIMIT ?",
            (sid, limit),
        ).fetchall()
        out = []
        for r in rows:
            m = dict(r)
            try:
                m["meta"] = json.loads(m["meta"] or "{}")
            except Exception:
                m["meta"] = {}
            out.append(m)
        return out

    def first_user_message(self, sid: str) -> str | None:
        r = self.conn.execute(
            "SELECT content FROM messages WHERE session_id=? AND role='user' ORDER BY id LIMIT 1",
            (sid,),
        ).fetchone()
        return r["content"] if r else None

    # ---------- 记忆摘要 ----------
    def set_summary(self, sid: str, summary: str) -> None:
        summary = (summary or "").strip()
        if not summary:
            return
        self.conn.execute("DELETE FROM memory WHERE session_id=? AND kind='summary'", (sid,))
        self.conn.execute(
            "INSERT INTO memory(session_id, kind, content, created_at) VALUES (?,?,?,?)",
            (sid, "summary", summary, _now()),
        )
        self.conn.commit()

    def get_summary(self, sid: str) -> str | None:
        r = self.conn.execute(
            "SELECT content FROM memory WHERE session_id=? AND kind='summary' ORDER BY id DESC LIMIT 1",
            (sid,),
        ).fetchone()
        return r["content"] if r else None

    # ---------- 相关历史记忆（P1：跨会话回忆） ----------
    def search_memories(self, query: str, limit: int = 3, exclude_session: str | None = None) -> list[dict]:
        """按关键词检索此前对话摘要（SQLite 原生 LIKE，零新依赖）。

        关键词提取：英文/数字词（>2 位）+ 中文按标点切块（>1 字）。
        数据量小（每会话一条摘要），LIKE 足够快；FTS5/sqlite-vec 留作可选扩展。
        """
        words = self._keywords(query)
        if not words:
            return []
        conds, args = [], []
        for w in words:
            conds.append("content LIKE ?")
            args.append(f"%{w}%")
        if exclude_session:
            conds.append("session_id != ?")
            args.append(exclude_session)
        rows = self.conn.execute(
            f"SELECT session_id, content, created_at FROM memory WHERE kind='summary' AND ({' OR '.join(conds)}) ORDER BY created_at DESC LIMIT ?",
            (*args, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    @staticmethod
    def _keywords(text: str, max_words: int = 8) -> list[str]:
        import re

        words: list[str] = []
        # 英文/数字词
        words += [w.lower() for w in re.findall(r"[A-Za-z0-9]{2,}", text or "")]
        # 中文：按非中文标点切块，取 2 字以上片段
        cn = re.findall(r"[\u4e00-\u9fff]{2,}", text or "")
        words += [c for c in cn if c not in words]
        # 去重 + 限长
        seen, out = set(), []
        for w in words:
            if w not in seen and len(w) <= 20:
                seen.add(w)
                out.append(w)
            if len(out) >= max_words:
                break
        return out

    def close(self) -> None:
        try:
            self.conn.close()
        except Exception:
            pass
