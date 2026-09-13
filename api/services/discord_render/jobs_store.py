"""Durable job rows for the V2 runtime — the restart-recovery record AND the SLO store.

Why durable: `web` served a median of 8.4 minutes per deployment over 2026-08-30..09-13
(1,077 deployments). A job held only in memory dies with the pod after 5 s of
graceful shutdown and the member's reply sits on "thinking…" until Discord expires
the token. And a metric held only in memory resets every 8 minutes, which reads as
health straight through an outage.

Its OWN SQLite file (DISCORD_RENDER_DB_PATH, default /data/discord_render_jobs.db) so a
lock here can never wait on bars.db or auth.db, which run deliberately short
busy_timeouts on the web pod.

⛔ Interaction tokens are 15-minute bearer credentials. A token is stored only while
its job is queued or running, NULLED at every terminal state, and purged at 16
minutes regardless.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time

TERMINAL_STATES = ("delivered", "messaged", "abandoned", "superseded")
TOKEN_LIFETIME_S = 15 * 60
TOKEN_PURGE_AFTER_S = 16 * 60
ROW_RETENTION_S = 30 * 24 * 3600

_SCHEMA = """
CREATE TABLE IF NOT EXISTS discord_render_jobs (
  corr_id TEXT PRIMARY KEY,
  interaction_id TEXT,
  created_at REAL NOT NULL,
  command TEXT, kind TEXT, lane TEXT,
  args_json TEXT,
  user_id TEXT, guild_id TEXT, channel_id TEXT, app_id TEXT,
  token TEXT,
  ephemeral INTEGER DEFAULT 0,
  interaction_type INTEGER,
  state TEXT NOT NULL,
  lease_owner TEXT, lease_until REAL,
  attempts INTEGER DEFAULT 0, resumed INTEGER DEFAULT 0,
  ack_ms REAL, queue_ms REAL, first_image_ms REAL, final_ms REAL,
  outcome TEXT, failure_class TEXT, detail TEXT, quality TEXT,
  cache_hit INTEGER, render_attempts INTEGER, renderer_status TEXT, discord_status TEXT,
  pod_boot_ts REAL, commit_sha TEXT,
  updated_at REAL
);
CREATE INDEX IF NOT EXISTS ix_drj_state ON discord_render_jobs(state, created_at);
CREATE INDEX IF NOT EXISTS ix_drj_created ON discord_render_jobs(created_at);
CREATE TABLE IF NOT EXISTS discord_render_alerts (
  alert_key TEXT PRIMARY KEY, last_sent REAL NOT NULL
);
"""

_UPDATABLE = {"ack_ms", "queue_ms", "first_image_ms", "final_ms", "outcome", "failure_class", "detail",
              "quality", "cache_hit", "render_attempts", "renderer_status", "discord_status", "attempts",
              "resumed", "args_json"}


def default_path() -> str:
    return os.environ.get("DISCORD_RENDER_DB_PATH", "/data/discord_render_jobs.db")


class JobsStore:
    def __init__(self, path: str | None = None, *, now=time.time):
        self.path = path or default_path()
        self._now = now
        self._lock = threading.Lock()
        d = os.path.dirname(self.path)
        if d:
            os.makedirs(d, exist_ok=True)
        self._conn = sqlite3.connect(self.path, check_same_thread=False, timeout=5.0)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA busy_timeout=5000")
            self._conn.executescript(_SCHEMA)
            self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # ── writes ──────────────────────────────────────────────────────────────
    def insert(self, row: dict) -> bool:
        """Insert a new job. False if the corr id already exists (Discord retried
        the same interaction, or a resume raced an insert) — never overwrites."""
        cols = dict(row)
        cols.setdefault("created_at", self._now())
        cols.setdefault("state", "queued")
        cols["updated_at"] = self._now()
        if isinstance(cols.get("args_json"), (dict, list)):
            cols["args_json"] = json.dumps(cols["args_json"], separators=(",", ":"))
        keys = sorted(cols)
        with self._lock:
            try:
                self._conn.execute(
                    f"INSERT INTO discord_render_jobs ({','.join(keys)}) VALUES ({','.join('?' * len(keys))})",
                    [cols[k] for k in keys])
                self._conn.commit()
                return True
            except sqlite3.IntegrityError:
                return False

    def claim(self, corr_id: str, owner: str, lease_s: float) -> bool:
        """Compare-and-set: take the job if it is not terminal and nobody else holds a
        live lease. The ONLY way a worker may start running a job."""
        now = self._now()
        with self._lock:
            cur = self._conn.execute(
                "UPDATE discord_render_jobs SET state='running', lease_owner=?, lease_until=?, "
                "attempts=COALESCE(attempts,0)+1, updated_at=? "
                "WHERE corr_id=? AND state IN ('queued','running') "
                "AND (lease_owner IS NULL OR lease_owner=? OR lease_until IS NULL OR lease_until < ?)",
                (owner, now + lease_s, now, corr_id, owner, now))
            self._conn.commit()
            return cur.rowcount == 1

    def heartbeat(self, corr_id: str, owner: str, lease_s: float) -> bool:
        now = self._now()
        with self._lock:
            cur = self._conn.execute(
                "UPDATE discord_render_jobs SET lease_until=?, updated_at=? "
                "WHERE corr_id=? AND lease_owner=? AND state='running'",
                (now + lease_s, now, corr_id, owner))
            self._conn.commit()
            return cur.rowcount == 1

    def owns(self, corr_id: str, owner: str) -> bool:
        """True while this owner still holds the job — checked before every PATCH so
        an old pod finishing after a new pod reclaimed the job cannot double-post."""
        with self._lock:
            r = self._conn.execute(
                "SELECT lease_owner, state FROM discord_render_jobs WHERE corr_id=?", (corr_id,)).fetchone()
        return bool(r) and r["lease_owner"] == owner and r["state"] == "running"

    def update(self, corr_id: str, **fields) -> None:
        bad = set(fields) - _UPDATABLE
        if bad:
            raise ValueError(f"not updatable: {sorted(bad)}")
        if not fields:
            return
        fields["updated_at"] = self._now()
        keys = sorted(fields)
        with self._lock:
            self._conn.execute(
                f"UPDATE discord_render_jobs SET {','.join(k + '=?' for k in keys)} WHERE corr_id=?",
                [fields[k] for k in keys] + [corr_id])
            self._conn.commit()

    def finish(self, corr_id: str, state: str, owner: str | None = None, **fields) -> bool:
        """Terminal transition. Nulls the token. With `owner`, only the lease holder may
        finish (a superseded worker's late result is not recorded over the new one)."""
        if state not in TERMINAL_STATES:
            raise ValueError(f"not terminal: {state}")
        bad = set(fields) - _UPDATABLE
        if bad:
            raise ValueError(f"not updatable: {sorted(bad)}")
        fields = {**fields, "updated_at": self._now()}
        keys = sorted(fields)
        sql = (f"UPDATE discord_render_jobs SET state=?, token=NULL, lease_until=NULL, "
               f"{','.join(k + '=?' for k in keys)} WHERE corr_id=? AND state NOT IN "
               f"('delivered','messaged','abandoned','superseded')")
        params = [state] + [fields[k] for k in keys] + [corr_id]
        if owner is not None:
            sql += " AND lease_owner=?"
            params.append(owner)
        with self._lock:
            cur = self._conn.execute(sql, params)
            self._conn.commit()
            return cur.rowcount == 1

    def release_all(self, owner: str) -> int:
        """Shutdown: give every lease this pod holds back NOW, so the next pod resumes
        without waiting out the lease."""
        with self._lock:
            cur = self._conn.execute(
                "UPDATE discord_render_jobs SET lease_until=?, updated_at=? WHERE lease_owner=? AND state='running'",
                (self._now() - 1, self._now(), owner))
            self._conn.commit()
            return cur.rowcount

    # ── reads ───────────────────────────────────────────────────────────────
    def get(self, corr_id: str) -> dict | None:
        with self._lock:
            r = self._conn.execute("SELECT * FROM discord_render_jobs WHERE corr_id=?", (corr_id,)).fetchone()
        return dict(r) if r else None

    def resumable(self, max_age_s: float) -> list[dict]:
        """Non-terminal jobs young enough to still reply to, whose lease has lapsed."""
        now = self._now()
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM discord_render_jobs WHERE state IN ('queued','running') "
                "AND created_at >= ? AND token IS NOT NULL "
                "AND (lease_until IS NULL OR lease_until < ?) ORDER BY created_at",
                (now - max_age_s, now)).fetchall()
        return [dict(r) for r in rows]

    def expired_unfinished(self, max_age_s: float) -> list[dict]:
        """Non-terminal jobs too old to resume (lease lapsed)."""
        now = self._now()
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM discord_render_jobs WHERE state IN ('queued','running') "
                "AND created_at < ? AND (lease_until IS NULL OR lease_until < ?)",
                (now - max_age_s, now)).fetchall()
        return [dict(r) for r in rows]

    def stuck(self, older_than_s: float) -> list[dict]:
        now = self._now()
        with self._lock:
            rows = self._conn.execute(
                "SELECT corr_id, command, created_at, state, lease_owner FROM discord_render_jobs "
                "WHERE state IN ('queued','running') AND created_at < ?", (now - older_than_s,)).fetchall()
        return [dict(r) for r in rows]

    def recent(self, since_s: float, limit: int = 5000) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT corr_id, created_at, command, kind, lane, state, ack_ms, queue_ms, first_image_ms, "
                "final_ms, outcome, failure_class, quality, cache_hit, resumed, attempts, detail "
                "FROM discord_render_jobs WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?",
                (self._now() - since_s, limit)).fetchall()
        return [dict(r) for r in rows]

    # ── housekeeping ────────────────────────────────────────────────────────
    def purge(self) -> dict:
        now = self._now()
        with self._lock:
            t = self._conn.execute("UPDATE discord_render_jobs SET token=NULL WHERE token IS NOT NULL AND created_at < ?",
                                   (now - TOKEN_PURGE_AFTER_S,)).rowcount
            d = self._conn.execute("DELETE FROM discord_render_jobs WHERE created_at < ?",
                                   (now - ROW_RETENTION_S,)).rowcount
            self._conn.commit()
        return {"tokens_nulled": t, "rows_deleted": d}

    # ── durable alert cooldown ──────────────────────────────────────────────
    def alert_due(self, key: str, cooldown_s: float) -> bool:
        """True (and records the send) when `key` has not alerted within the cooldown.
        Durable because an in-memory cooldown on this pod resets every ~8 minutes."""
        now = self._now()
        with self._lock:
            r = self._conn.execute("SELECT last_sent FROM discord_render_alerts WHERE alert_key=?", (key,)).fetchone()
            if r and now - r["last_sent"] < cooldown_s:
                return False
            self._conn.execute("INSERT INTO discord_render_alerts(alert_key,last_sent) VALUES(?,?) "
                               "ON CONFLICT(alert_key) DO UPDATE SET last_sent=excluded.last_sent", (key, now))
            self._conn.commit()
            return True
