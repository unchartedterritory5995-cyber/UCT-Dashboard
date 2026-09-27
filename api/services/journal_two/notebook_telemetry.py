"""Notebook telemetry — the admin READ side (wave 6, D14).

The write side already exists: `POST /api/j2/telemetry` (api/routers/
journal_two.py) accepts an event only if it is on `_J2_TELEMETRY_EVENTS`, and
records it in the shared `activity_log` as `action = "j2:<event>"`. The client
helper is `app/src/pages/journal-2-0/lib/notebookTelemetry.js`.

This module answers "how often did each event fire over the last 7 and 30
days, and for how many members?" — nothing more.

⛔ THE EVENT LIST IS NOT RESTATED HERE. The caller passes the allow-list, so
the set counted is exactly the set the server accepts: an event added to the
allow-list is counted the day it lands, and an event this file typed on its own
could drift into counting a name nothing can send.

⛔ NEVER CONTENT. The only field read out of `details` is a NUMBER (`ms`, for
the open-time percentiles); everything else in the blob stays in the table.
"""
from __future__ import annotations

import json
import math
from typing import Any, Iterable

from api.services import auth_db

WINDOWS = (7, 30)

# Events whose props carry a duration in `ms`: their windows also report the
# median and the 95th percentile, because a count of note opens says nothing
# about whether opening a note is fast.
TIMED_EVENTS = ("note_open_ms",)
_MAX_TIMED_ROWS = 20000


def _percentile(sorted_vals: list[float], p: float) -> float | None:
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    if lo == hi:
        return round(sorted_vals[int(k)], 1)
    return round(sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo), 1)


def _ms_of(details: Any) -> float | None:
    try:
        v = json.loads(details or "{}").get("ms")
    except (ValueError, AttributeError):
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0:
        return None
    return float(v)


# ⭐ PUBLIC NAMES FOR TWO HELPERS ANOTHER READ REUSES (wave 9, lane 9C). The
# 30-day soak's server read (`notebook_soak.py`) reports the same p50/p95 over
# the same `ms` prop, split by population. It calls THESE — the very function
# objects `event_counts` uses — so the two reads cannot compute a percentile or
# parse a duration two different ways. Additive only: `event_counts` is
# unchanged, and tests/test_notebook_soak.py pins both `is` identities.
percentile = _percentile
ms_of = _ms_of


def event_counts(events: Iterable[str], conn=None) -> dict[str, Any]:
    """`{"windows": {"7": {event: {...}}, "30": {...}}}` — every event present,
    zero-filled, so an event that never fired reads as 0 and not as missing."""
    names = sorted(set(events))
    actions = [f"j2:{e}" for e in names]
    owned = conn is None
    conn = conn or auth_db.get_connection()
    out: dict[str, Any] = {"events": names, "windows": {}}
    try:
        for days in WINDOWS:
            window: dict[str, Any] = {
                e: {"count": 0, "members": 0} for e in names
            }
            if actions:
                marks = ",".join("?" for _ in actions)
                rows = conn.execute(
                    f"SELECT action, COUNT(*) AS n, COUNT(DISTINCT user_id) AS m"
                    f" FROM activity_log WHERE action IN ({marks})"
                    f" AND created_at >= datetime('now', ?) GROUP BY action",
                    (*actions, f"-{days} days"),
                ).fetchall()
                for r in rows:
                    ev = r["action"][3:]
                    window[ev] = {"count": int(r["n"]), "members": int(r["m"])}
            for ev in TIMED_EVENTS:
                if ev not in window:
                    continue
                details = conn.execute(
                    "SELECT details FROM activity_log WHERE action = ?"
                    " AND created_at >= datetime('now', ?) ORDER BY created_at DESC LIMIT ?",
                    (f"j2:{ev}", f"-{days} days", _MAX_TIMED_ROWS),
                ).fetchall()
                vals = sorted(v for v in (_ms_of(d["details"]) for d in details) if v is not None)
                window[ev]["p50_ms"] = _percentile(vals, 0.5)
                window[ev]["p95_ms"] = _percentile(vals, 0.95)
            out["windows"][str(days)] = window
        return out
    finally:
        if owned:
            conn.close()
