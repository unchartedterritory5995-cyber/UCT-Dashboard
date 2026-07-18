"""Admin trigger for the legacy pattern_* purge — runs IN-PROCESS.

Context (2026-07-18): six railway-ssh attempts at tools/purge_legacy_patterns.py
died with the ssh websocket (Railway kills a session's child processes when the
socket drops, and the socket does not survive this job's sustained volume I/O).
Running the batched delete on a daemon thread inside uvicorn detaches it from
any session — only a redeploy can interrupt it, and committed batches are
durable so a re-trigger resumes where it left off.

POST /api/admin/purge-legacy-patterns  — start (admin; idempotent while running)
GET  /api/admin/purge-legacy-patterns  — progress/status (admin)

Same safety gate as the CLI tool: refuses unless /data/patterns.db exists and
is serving detections (the pattern engine's live home since 2026-07-16).
"""
from __future__ import annotations

import os
import sqlite3
import threading
import time

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])

LEGACY_TABLES = ("pattern_feedback", "pattern_outcomes", "pattern_stats",
                 "pattern_detections")
_RUNNING_PHASES = ("starting", "deleting", "dropping", "vacuum")

_lock = threading.Lock()
_state: dict = {
    "phase": "idle", "table": None, "rows_deleted": 0, "batches": 0,
    "started_at": None, "finished_at": None, "error": None,
    "size_before_gb": None, "size_after_gb": None,
}


def _auth_db_path() -> str:
    from api.services import auth_db
    return auth_db._DB_PATH


def _patterns_db_live() -> int:
    """Detection count in the live patterns.db, or -1 if unavailable."""
    try:
        from api.services.pattern_engine import pattern_db
        path = pattern_db._db_path()
        if not os.path.exists(path):
            return -1
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
        try:
            return conn.execute("SELECT COUNT(*) FROM pattern_detections").fetchone()[0]
        finally:
            conn.close()
    except Exception:
        return -1


def _run() -> None:
    db = _auth_db_path()
    batch = int(os.environ.get("PURGE_BATCH_ROWS", "50000"))
    pause = float(os.environ.get("PURGE_BATCH_PAUSE_SECS", "1.0"))
    try:
        _state["size_before_gb"] = round(os.path.getsize(db) / 1e9, 2)
        conn = sqlite3.connect(db, timeout=120)
        try:
            conn.execute("PRAGMA busy_timeout=120000")
            for t in LEGACY_TABLES:
                row = conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                    (t,)).fetchone()
                if not row:
                    continue
                _state["table"] = t
                _state["phase"] = "deleting"
                while True:
                    cur = conn.execute(
                        f"DELETE FROM {t} WHERE rowid IN "
                        f"(SELECT rowid FROM {t} LIMIT ?)", (batch,))
                    conn.commit()
                    if cur.rowcount <= 0:
                        break
                    _state["rows_deleted"] += cur.rowcount
                    _state["batches"] += 1
                    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                    time.sleep(pause)   # keep volume I/O gentle on live traffic
                _state["phase"] = "dropping"
                conn.execute(f"DROP TABLE {t}")
                conn.commit()
                conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            _state["phase"] = "vacuum"
            conn.execute("VACUUM")
        finally:
            conn.close()
        _state["size_after_gb"] = round(os.path.getsize(db) / 1e9, 2)
        _state["phase"] = "done"
    except Exception as e:  # noqa: BLE001
        _state["phase"] = "error"
        _state["error"] = str(e)
    finally:
        _state["finished_at"] = time.time()


@router.post("/purge-legacy-patterns")
def start_purge(user: dict = Depends(require_admin)):
    with _lock:
        if _state["phase"] in _RUNNING_PHASES:
            return {"ok": True, "already_running": True, **_state}
        n = _patterns_db_live()
        if n < 1:
            raise HTTPException(
                status_code=409,
                detail=f"REFUSING: patterns.db missing or empty (detections={n}) "
                       f"— the pattern move must be live before purging auth.db.")
        _state.update(phase="starting", table=None, rows_deleted=0, batches=0,
                      started_at=time.time(), finished_at=None, error=None,
                      size_after_gb=None)
        threading.Thread(target=_run, daemon=True,
                         name="legacy-pattern-purge").start()
    return {"ok": True, "started": True, "patterns_db_detections": n}


@router.get("/purge-legacy-patterns")
def purge_status(user: dict = Depends(require_admin)):
    out = dict(_state)
    if out["started_at"] and not out["finished_at"]:
        out["elapsed_s"] = round(time.time() - out["started_at"])
    return out
