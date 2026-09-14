"""Capture health — metric 6.6 (docs/wisdom/CONTRACTS.md §6.1, W1 §6.6).

Per dataset, per session: the run's row count against the trailing median of
the last ten NON-HOLIDAY sessions.

    holiday  the dataset describes a session and that date is not a trading day
    missing  the source was unreadable, or the archive write failed
    zero     read fine, held nothing
    low      fewer than LOW_FRACTION × the trailing median (needs MIN_MEDIAN_SAMPLES)
    ok       otherwise

``zero`` / ``missing`` on a trading day page as
``wisdom_capture_p1:<dataset>`` (critical). Each dataset declares which of
the two pages it (families.Dataset.pages): an hour with no tweets is not an
outage, and the GEX gap is a known, named absence rather than a fresh failure.

⚠️ Holiday awareness comes from core.timeutil, whose table covers 2025–2027.
Outside it a weekday reads as a session; the admin table says so.
"""
from __future__ import annotations

import datetime as dt
import sqlite3
import statistics
from typing import Optional

from api.services.wisdom.core import timeutil

LOW_FRACTION = 0.5
MEDIAN_SESSIONS = 10
MIN_MEDIAN_SAMPLES = 3
HEALTH_VALUES = ("ok", "low", "zero", "missing", "holiday")
PAGE_KEY_PREFIX = "wisdom_capture_p1:"


def is_trading_session(session_date: str) -> bool:
    return timeutil.is_trading_day(dt.date.fromisoformat(session_date))


def trailing_median(conn: sqlite3.Connection, dataset: str, before_session: str) -> tuple[Optional[float], int]:
    """``(median, samples)`` over the last MEDIAN_SESSIONS trading sessions before
    ``before_session`` that have an ``ok`` run. A session with several runs
    (the hourly tweets job) contributes its largest row count."""
    rows = conn.execute(
        "SELECT session_date, MAX(row_count) AS n FROM wisdom_capture_runs "
        "WHERE dataset = ? AND session_date < ? AND status = 'ok' AND row_count IS NOT NULL "
        "GROUP BY session_date ORDER BY session_date DESC LIMIT 60",
        (dataset, before_session),
    ).fetchall()
    samples: list[int] = []
    for row in rows:
        if not is_trading_session(row["session_date"]):
            continue
        samples.append(int(row["n"]))
        if len(samples) >= MEDIAN_SESSIONS:
            break
    if not samples:
        return None, 0
    return float(statistics.median(samples)), len(samples)


def classify(*, status: str, row_count: Optional[int], median: Optional[float], samples: int,
             holiday: bool) -> str:
    if holiday or status == "skipped_holiday":
        return "holiday"
    if status in ("failed", "unreachable") or row_count is None:
        return "missing"
    if row_count == 0:
        return "zero"
    if median is not None and samples >= MIN_MEDIAN_SAMPLES and row_count < LOW_FRACTION * median:
        return "low"
    return "ok"


def should_page(pages: frozenset, health: str, session_date: str) -> bool:
    return health in ("zero", "missing") and health in pages and is_trading_session(session_date)


def page(dataset: str, health: str, summary: dict) -> bool:
    try:
        from api.services import chart_health_alerts

        message = (f"Wisdom capture {dataset}: {health} for session {summary.get('session_date')} "
                   f"(rows={summary.get('rows')}, status={summary.get('status')}, "
                   f"gaps={sorted((summary.get('gaps') or {}).keys())})")
        return bool(chart_health_alerts.emit(
            f"{PAGE_KEY_PREFIX}{dataset}", "critical", message,
            {"run_id": summary.get("run_id"), "session_date": summary.get("session_date"),
             "error": summary.get("error"), "r2_key": summary.get("r2_key")},
        ))
    except Exception:  # noqa: BLE001 — a page that cannot be sent must not fail the capture
        return False


def health_table(conn: sqlite3.Connection, days: int = 10) -> list[dict]:
    """One entry per registered dataset: its last ``days`` sessions with row counts
    and health, ``n`` = sessions with a run in the window, and health counts —
    so every rate the admin page shows has its denominator beside it."""
    from api.services.wisdom.capture import families

    days = max(1, min(int(days), 90))
    out: list[dict] = []
    for ds in families.DATASETS:
        runs = conn.execute(
            "SELECT run_id, session_date, started_at, finished_at, status, row_count, bytes, r2_key, "
            "trailing_median, health, error FROM wisdom_capture_runs WHERE dataset = ? "
            "ORDER BY session_date DESC, started_at DESC",
            (ds.name,),
        ).fetchall()
        sessions: list[dict] = []
        seen: set = set()
        for row in runs:
            if row["session_date"] in seen:
                continue
            seen.add(row["session_date"])
            sessions.append(dict(row))
            if len(sessions) >= days:
                break
        counts = {h: 0 for h in HEALTH_VALUES}
        for s in sessions:
            if s.get("health") in counts:
                counts[s["health"]] += 1
        latest = dict(runs[0]) if runs else None
        out.append({
            "dataset": ds.name,
            "family": ds.family,
            "job_id": ds.job_id,
            "cadence": ds.cadence,
            "session_shaped": ds.session_shaped,
            "pages_on": sorted(ds.pages),
            "n": len(sessions),
            "health_counts": counts,
            "latest": latest,
            "sessions": sessions,
            "bytes_in_window": sum(int(s.get("bytes") or 0) for s in sessions),
            "holiday_table_covers_latest": (
                timeutil.holiday_table_covers(dt.date.fromisoformat(latest["session_date"])) if latest else None),
        })
    return out
