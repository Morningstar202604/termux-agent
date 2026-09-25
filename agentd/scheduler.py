"""定时/条件触发（P1）：APScheduler(AsyncIOScheduler) + 自管 SQLite 持久化。

不引入 SQLAlchemy（手机端轻量原则）：job 定义存 SQLite 自己的表，
进程重启后从库恢复调度；APScheduler 只做内存里的时间引擎。
"""
from __future__ import annotations

import asyncio
import json
import sqlite3
import time
import uuid
from typing import Awaitable, Callable

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger

# trigger_type 合法值
TRIGGER_TYPES = ("cron", "interval", "date")

# 条件操作符：支持 battery < 阈值（如 "battery < 20"）
CONDITION_OPS = ("<", ">", "<=", ">=", "==")


def parse_condition(cond: str) -> tuple[str, str, float] | None:
    """解析条件字符串 → (metric, op, value)；无法解析返回 None。"""
    if not cond or not isinstance(cond, str):
        return None
    s = cond.strip().lower()
    for op in CONDITION_OPS:
        if op in s:
            left, right = s.split(op, 1)
            metric = left.strip()
            try:
                value = float(right.strip())
            except ValueError:
                return None
            if metric not in ("battery",):
                return None
            return metric, op, value
    return None


class JobStore:
    """job 定义的 SQLite 持久化（自管表，无需 SQLAlchemy）。"""

    def __init__(self, db_path: str):
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.execute(
            """CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                trigger_type TEXT NOT NULL,
                expr TEXT NOT NULL,
                message TEXT NOT NULL,
                session_id TEXT DEFAULT '',
                condition TEXT DEFAULT '',
                enabled INTEGER DEFAULT 1,
                created_at REAL NOT NULL
            )"""
        )
        self._conn.commit()

    def list(self) -> list[dict]:
        rows = self._conn.execute(
            "SELECT id,name,trigger_type,expr,message,session_id,condition,enabled,created_at FROM jobs ORDER BY created_at DESC"
        ).fetchall()
        return [
            {
                "id": r[0],
                "name": r[1],
                "trigger_type": r[2],
                "expr": r[3],
                "message": r[4],
                "session_id": r[5],
                "condition": r[6],
                "enabled": bool(r[7]),
                "created_at": r[8],
            }
            for r in rows
        ]

    def get(self, jid: str) -> dict | None:
        for j in self.list():
            if j["id"] == jid:
                return j
        return None

    def add(self, job: dict) -> str:
        jid = job.get("id") or uuid.uuid4().hex[:12]
        self._conn.execute(
            "INSERT INTO jobs (id,name,trigger_type,expr,message,session_id,condition,enabled,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (
                jid,
                job["name"],
                job["trigger_type"],
                job["expr"],
                job["message"],
                job.get("session_id", ""),
                job.get("condition", ""),
                1 if job.get("enabled", True) else 0,
                job.get("created_at", time.time()),
            ),
        )
        self._conn.commit()
        return jid

    def update(self, jid: str, patch: dict) -> bool:
        fields = {
            "name": "name",
            "trigger_type": "trigger_type",
            "expr": "expr",
            "message": "message",
            "session_id": "session_id",
            "condition": "condition",
            "enabled": "enabled",
        }
        sets, vals = [], []
        for k, col in fields.items():
            if k in patch:
                v = patch[k]
                if k == "enabled":
                    v = 1 if v else 0
                sets.append(f"{col}=?")
                vals.append(v)
        if not sets:
            return False
        vals.append(jid)
        cur = self._conn.execute(f"UPDATE jobs SET {','.join(sets)} WHERE id=?", vals)
        self._conn.commit()
        return cur.rowcount > 0

    def delete(self, jid: str) -> bool:
        cur = self._conn.execute("DELETE FROM jobs WHERE id=?", (jid,))
        self._conn.commit()
        return cur.rowcount > 0

    def close(self) -> None:
        try:
            self._conn.close()
        except Exception:  # noqa: BLE001
            pass


class SchedulerService:
    """包一层 AsyncIOScheduler：启动恢复 + CRUD 同步内存调度。"""

    def __init__(
        self,
        store: JobStore,
        run_cb: Callable[[str, str], Awaitable[None]],
        notify_cb: Callable[[str, str], None] | None = None,
    ):
        self._store = store
        self._run_cb = run_cb
        self._notify = notify_cb or (lambda t, c: None)
        self._sched = AsyncIOScheduler()
        self._job_ids: set[str] = set()

    def _make_trigger(self, job: dict):
        tt = job["trigger_type"]
        if tt == "cron":
            return CronTrigger.from_crontab(job["expr"])
        if tt == "interval":
            return IntervalTrigger(seconds=max(int(float(job["expr"])), 5))
        # date：一次性，格式 "YYYY-MM-DD HH:MM"
        return DateTrigger(run_date=job["expr"])

    async def _fire(self, job_id: str) -> None:
        job = self._store.get(job_id)
        if not job or not job["enabled"]:
            return
        # 条件触发：满足才执行（如 battery < 20）
        cond = parse_condition(job["condition"])
        if cond:
            ok = await self._check_condition(cond)
            if not ok:
                self._notify("口袋 Agent · 条件未满足", f"{job['name']}：{job['condition']}，本次跳过")
                return
        self._notify("口袋 Agent · 定时任务", f"正在执行：{job['name']}")
        try:
            await self._run_cb(job["session_id"] or "", job["message"])
        except Exception:  # noqa: BLE001 —— 定时任务异常不能影响调度器
            self._notify("口袋 Agent · 定时任务出错", job["name"])

    async def _check_condition(self, cond: tuple[str, str, float]) -> bool:
        metric, op, value = cond
        try:
            from .tools.phone import get_battery  # 延迟导入避免循环

            info = await get_battery()
            pct = float(info.get("percentage", 0))
        except Exception:  # noqa: BLE001
            return True  # 读不到电池时视为满足（避免任务静默丢失）
        return {
            "<": pct < value,
            ">": pct > value,
            "<=": pct <= value,
            ">=": pct >= value,
            "==": abs(pct - value) < 0.5,
        }.get(op, True)

    def start(self) -> None:
        for job in self._store.list():
            if job["enabled"]:
                self._schedule(job)
        if not self._sched.running:
            self._sched.start()

    def _schedule(self, job: dict) -> None:
        if job["id"] in self._job_ids:
            return
        try:
            self._sched.add_job(
                self._fire,
                trigger=self._make_trigger(job),
                id=job["id"],
                args=[job["id"]],
                replace_existing=True,
                misfire_grace_time=300,
            )
            self._job_ids.add(job["id"])
        except Exception as e:  # noqa: BLE001 —— 非法表达式不阻塞启动
            import sys
            print(f"[agentd] 定时任务 {job['id']} 调度失败: {e}", file=sys.stderr)

    def create(self, job: dict) -> dict:
        jid = self._store.add(job)
        stored = self._store.get(jid)
        if stored and stored["enabled"]:
            self._schedule(stored)
        return stored

    def update(self, jid: str, patch: dict) -> dict | None:
        self._store.update(jid, patch)
        job = self._store.get(jid)
        if not job:
            return None
        # 内存调度同步：停旧的，按需加新的
        try:
            self._sched.remove_job(jid)
        except Exception:  # noqa: BLE001
            pass
        self._job_ids.discard(jid)
        if job["enabled"]:
            self._schedule(job)
        return job

    def delete(self, jid: str) -> bool:
        try:
            self._sched.remove_job(jid)
        except Exception:  # noqa: BLE001
            pass
        self._job_ids.discard(jid)
        return self._store.delete(jid)

    def list(self) -> list[dict]:
        out = []
        for j in self._store.list():
            nxt = None
            if j["enabled"]:
                try:
                    job = self._sched.get_job(j["id"])
                    nxt = job.next_run_time.isoformat() if job and job.next_run_time else None
                except Exception:  # noqa: BLE001
                    pass
            out.append({**j, "next_run": nxt})
        return out

    def shutdown(self) -> None:
        try:
            if self._sched.running:
                self._sched.shutdown(wait=False)
        except Exception:  # noqa: BLE001
            pass
        self._store.close()
