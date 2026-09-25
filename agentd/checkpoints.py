"""危险操作回滚（P1 基础设施）：checkpoint/undo。

对可回滚的危险操作（覆盖写文件、删除文件）在执行前自动备份原文件，
用户可在前端一键撤销。备份存 $AGENT_HOME/checkpoints/，记录落 SQLite，
服务重启后仍可撤销。
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from pathlib import Path


def home_dir() -> Path:
    return Path(os.environ.get("AGENT_HOME") or Path.home() / ".agent" / "termux-agent")


def backup_file(src: Path) -> str | None:
    """把 src 备份到 checkpoints 目录，返回备份相对路径；失败返回 None。"""
    try:
        ckdir = home_dir() / "checkpoints"
        ckdir.mkdir(parents=True, exist_ok=True)
        os.chmod(ckdir, 0o700)
        name = f"{int(time.time())}_{uuid.uuid4().hex[:8]}_{src.name[:60]}.bak"
        dst = ckdir / name
        if src.is_dir():
            return None  # 目录暂不支持回滚（只处理文件）
        import shutil

        shutil.copy2(src, dst)
        os.chmod(dst, 0o600)
        return str(dst)
    except Exception:  # noqa: BLE001 —— 备份失败不阻塞主操作
        return None


class CheckpointStore:
    """undo 记录持久化：哪个会话、哪次工具调用、备份在哪、还原了没。"""

    def __init__(self, db_path: str | Path):
        self.conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self.conn.execute(
            """CREATE TABLE IF NOT EXISTS checkpoints (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                tool_call_id TEXT NOT NULL,
                tool_name TEXT NOT NULL,
                path TEXT NOT NULL,
                backup TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'restore',
                created_at REAL NOT NULL,
                undone INTEGER DEFAULT 0
            )"""
        )
        self.conn.commit()

    def record(self, session_id: str, tool_call_id: str, tool_name: str, path: str, backup: str, kind: str = "restore") -> None:
        self.conn.execute(
            "INSERT OR REPLACE INTO checkpoints(id, session_id, tool_call_id, tool_name, path, backup, kind, created_at, undone) VALUES (?,?,?,?,?,?,?,?,0)",
            (uuid.uuid4().hex[:16], session_id, tool_call_id, tool_name, path, backup, kind, time.time()),
        )
        self.conn.commit()

    def find(self, session_id: str, tool_call_id: str) -> dict | None:
        r = self.conn.execute(
            "SELECT id, tool_name, path, backup, kind, undone FROM checkpoints WHERE session_id=? AND tool_call_id=? ORDER BY created_at DESC LIMIT 1",
            (session_id, tool_call_id),
        ).fetchone()
        if not r:
            return None
        return {
            "id": r[0], "tool_name": r[1], "path": r[2],
            "backup": r[3], "kind": r[4], "undone": bool(r[5]),
        }

    def mark_undone(self, ckid: str) -> None:
        self.conn.execute("UPDATE checkpoints SET undone=1 WHERE id=?", (ckid,))
        self.conn.commit()

    def delete_session(self, session_id: str) -> None:
        self.conn.execute("DELETE FROM checkpoints WHERE session_id=?", (session_id,))
        self.conn.commit()

    def close(self) -> None:
        try:
            self.conn.close()
        except Exception:  # noqa: BLE001
            pass


def undo(store: CheckpointStore, session_id: str, tool_call_id: str) -> dict:
    """撤销一次已完成的文件类操作。"""
    ck = store.find(session_id, tool_call_id)
    if not ck:
        return {"error": "没有可撤销的操作（可能未备份或记录已删除）"}
    if ck["undone"]:
        return {"error": "该操作已撤销过"}
    backup = Path(ck["backup"])
    target = Path(ck["path"])
    if not backup.exists():
        return {"error": "备份文件已丢失，无法撤销"}
    try:
        import shutil

        # 还原：目标若是新文件（kind=restore 删除场景）→ 写回；覆盖场景 → 先清再写
        if target.exists() and ck["kind"] == "overwrite":
            if target.is_dir():
                shutil.rmtree(target, ignore_errors=True)
            else:
                target.unlink()
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(backup, target)
        store.mark_undone(ck["id"])
        return {"ok": True, "restored": str(target), "tool": ck["tool_name"]}
    except Exception as e:  # noqa: BLE001
        return {"error": f"撤销失败：{e}"}
