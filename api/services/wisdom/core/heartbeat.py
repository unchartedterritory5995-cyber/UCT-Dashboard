"""One heartbeat row per job (docs/wisdom/CONTRACTS.md §3).

Beats on EVERY run, skipped ones included: a heartbeat that only beats on
success cannot tell "switched off" from "dead". Callers pass an open write
connection so the beat commits with the run row it describes.
"""
from __future__ import annotations

import sqlite3
from typing import Optional

from api.services.wisdom.core import timeutil

_BEAT_SQL = """
INSERT INTO wisdom_job_heartbeats
  (job_id, last_beat_at, last_status, last_ok_at, last_error, beats, consecutive_failures, alerted_at)
VALUES (?, ?, ?, ?, ?, 1, ?, NULL)
ON CONFLICT(job_id) DO UPDATE SET
  last_beat_at = excluded.last_beat_at,
  last_status = excluded.last_status,
  last_ok_at = COALESCE(excluded.last_ok_at, wisdom_job_heartbeats.last_ok_at),
  last_error = excluded.last_error,
  beats = wisdom_job_heartbeats.beats + 1,
  consecutive_failures = CASE
    WHEN excluded.last_status = 'failed' THEN wisdom_job_heartbeats.consecutive_failures + 1
    WHEN excluded.last_status = 'ok' THEN 0
    ELSE wisdom_job_heartbeats.consecutive_failures END,
  alerted_at = CASE WHEN excluded.last_status = 'ok' THEN NULL ELSE wisdom_job_heartbeats.alerted_at END
"""


def beat(conn: sqlite3.Connection, job_id: str, status: str, *, error: Optional[str] = None,
         now_iso: Optional[str] = None) -> None:
    if status not in ("ok", "skipped", "failed", "running"):
        raise ValueError(f"unknown heartbeat status {status!r}")
    now_iso = now_iso or timeutil.iso_et(timeutil.now_et())
    conn.execute(
        _BEAT_SQL,
        (job_id, now_iso, status, now_iso if status == "ok" else None, error, 1 if status == "failed" else 0),
    )


def mark_alerted(conn: sqlite3.Connection, job_id: str, now_iso: str) -> None:
    conn.execute(
        "INSERT INTO wisdom_job_heartbeats (job_id, alerted_at, beats, consecutive_failures) VALUES (?, ?, 0, 0) "
        "ON CONFLICT(job_id) DO UPDATE SET alerted_at = excluded.alerted_at",
        (job_id, now_iso),
    )


def job_health(conn: sqlite3.Connection) -> list[dict]:
    return [dict(row) for row in conn.execute("SELECT * FROM wisdom_job_heartbeats ORDER BY job_id")]
