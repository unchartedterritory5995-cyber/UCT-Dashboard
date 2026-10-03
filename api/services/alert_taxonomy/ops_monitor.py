"""Per-trigger ops monitor + channel health (Alerts PRD AC-7, and AC-8's half).

PRD §20.7: the monitoring view distinguishes, per trigger type, "evaluated N,
fired M, could-not-evaluate K" from one collapsed "N alerts" count -- so a
data-source failure for one type is NAMED, never silently omitted.
PRD §20.8: when a channel is down, the view flags THAT channel as degraded
while the others keep delivering.

TWO SOURCES, NEITHER INVENTED.
  * Sweep receipts -- each S7 sweep records one row per run
    (`record_sweep`): evaluated / fired / could_not_evaluate. A type with no
    run in the window is reported `no-runs` (never "clean": a sweep that did
    not run checked nothing).
  * Fire outcomes -- `alert_fires.delivery_channels`, the per-channel
    vocabulary every delivery already writes (ok / failed / skipped), plus
    the two withheld outcomes (`routing: suspended`, `queue: capped`).

`record_sweep` never raises: the monitor can never cost a sweep its run.
DARK: `ALERT_OPS_MONITOR_ENABLED` gates the admin route (404 off). Recording
is unconditional and additive (one small table in alert_taxonomy.db) so the
first armed read already has history.
"""
from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

from api.services.alert_taxonomy import channels as _channels
from api.services.alert_taxonomy import db as _db

log = logging.getLogger(__name__)

FLAG = "ALERT_OPS_MONITOR_ENABLED"
DEFAULT_WINDOW_S = 24 * 3600
#: A channel is `degraded` when at least this share of its ATTEMPTS failed.
DEGRADED_FAILURE_SHARE = 0.5

_DDL = """
CREATE TABLE IF NOT EXISTS alert_sweep_runs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_type        TEXT NOT NULL,
    ran_at              REAL NOT NULL,
    evaluated           INTEGER NOT NULL,
    fired               INTEGER NOT NULL,
    could_not_evaluate  INTEGER NOT NULL,
    note                TEXT
);
CREATE INDEX IF NOT EXISTS idx_alert_sweep_runs_type ON alert_sweep_runs(trigger_type, ran_at DESC);
"""


def is_enabled() -> bool:
    return os.environ.get(FLAG, "0").strip() == "1"


def _conn(db_path: str | None):
    c = _db.connect(db_path)
    _db.init_db(c)
    c.executescript(_DDL)
    return c


def record_sweep(trigger_type: str, *, evaluated: int, fired: int, could_not_evaluate: int,
                 note: str | None = None, ran_at: float | None = None,
                 db_path: str | None = None) -> bool:
    """One sweep run's receipt. Never raises."""
    try:
        c = _conn(db_path)
        try:
            c.execute("INSERT INTO alert_sweep_runs (trigger_type, ran_at, evaluated, fired,"
                      " could_not_evaluate, note) VALUES (?,?,?,?,?,?)",
                      (trigger_type, time.time() if ran_at is None else ran_at,
                       int(evaluated), int(fired), int(could_not_evaluate), note))
            c.commit()
        finally:
            c.close()
        return True
    except Exception:  # noqa: BLE001
        log.warning("[ops-monitor] could not record a %s sweep", trigger_type, exc_info=True)
        return False


def _type_rows(c, since: float) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for r in c.execute(
            "SELECT trigger_type, COUNT(*) AS runs, SUM(evaluated) AS ev, SUM(fired) AS fi,"
            " SUM(could_not_evaluate) AS cne, MAX(ran_at) AS last FROM alert_sweep_runs"
            " WHERE ran_at >= ? GROUP BY trigger_type", (since,)).fetchall():
        cne = int(r["cne"] or 0)
        out[r["trigger_type"]] = {
            "runs": int(r["runs"]), "evaluated": int(r["ev"] or 0), "fired": int(r["fi"] or 0),
            "could_not_evaluate": cne, "last_run_at": r["last"],
            "status": "degraded" if cne else "clean",
        }
    return out


def _channel_rows(c, since: float) -> tuple[dict[str, dict[str, int]], dict[str, int]]:
    counts: dict[str, dict[str, int]] = {}
    withheld = {"suspended": 0, "capped": 0}
    for (raw,) in c.execute("SELECT delivery_channels FROM alert_fires WHERE fired_at >= ?"
                            " AND delivery_channels IS NOT NULL", (since,)).fetchall():
        try:
            ch = json.loads(raw)
        except (TypeError, ValueError):
            continue
        if not isinstance(ch, dict):
            continue
        if ch.get("routing") == "suspended":
            withheld["suspended"] += 1
            continue
        if ch.get("queue") == "capped":
            withheld["capped"] += 1
            continue
        for kind, outcome in ch.items():
            bucket = counts.setdefault(kind, {"ok": 0, "failed": 0, "skipped": 0, "queued": 0})
            if outcome in bucket:
                bucket[outcome] += 1
    return counts, withheld


def channel_status(kind: str, n: dict[str, int] | None) -> str:
    configured = _channels.is_configured(kind)
    n = n or {}
    attempts = n.get("ok", 0) + n.get("failed", 0)
    if attempts and n.get("failed", 0) / attempts >= DEGRADED_FAILURE_SHARE:
        return "degraded"
    if configured is False:
        return "unconfigured"
    if not attempts and not n.get("queued", 0):
        return "idle"
    return "ok"


def report(*, window_s: int = DEFAULT_WINDOW_S, now: float | None = None,
           db_path: str | None = None) -> dict[str, Any]:
    now = time.time() if now is None else now
    since = now - window_s
    c = _conn(db_path)
    try:
        types = _type_rows(c, since)
        known = [r[0] for r in c.execute("SELECT type_id FROM alert_trigger_registry").fetchall()]
        counts, withheld = _channel_rows(c, since)
    finally:
        c.close()
    for t in known:
        types.setdefault(t, {"runs": 0, "evaluated": 0, "fired": 0, "could_not_evaluate": 0,
                             "last_run_at": None, "status": "no-runs"})
    chans = []
    for entry in _channels.describe():
        n = counts.get(entry["kind"])
        chans.append({**entry, **(n or {"ok": 0, "failed": 0, "skipped": 0, "queued": 0}),
                      "status": channel_status(entry["kind"], n)})
    return {"window_s": window_s, "as_of": now,
            "trigger_types": dict(sorted(types.items())),
            "channels": chans, "withheld": withheld}
