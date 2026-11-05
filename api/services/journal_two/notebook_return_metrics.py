"""The Notebook's return metrics (audit 2026-11-05, spec S20) -- the admin READ.

The write side is the Notebook's one telemetry door: `POST /api/j2/telemetry`, which records each
allow-listed event in the shared `activity_log` as `action = "j2:<event>"` (api/routers/journal_two.py).
This module reads those rows back and answers the six numbers of S20's table. Nothing is written.

  Day-1 return       of the members whose FIRST Notebook visit fell in the window (and at least one ET day
                     ago), the share who opened it again on the next ET calendar day.
  Day-7 return       of the members whose first visit fell in the window and whose first 7 trading days have
                     all passed, the share who opened it on 3 or more of those 7 trading days.
  First "aha"        of the same cohort, the share with a `first_live_widget`, and the median / p90 time from the
                     first visit to it.
  Morning open rate  over the window: of the member trading days with any Notebook open, the share with an open
                     before 09:30 ET.
  Recap rate         over the window: of the same member trading days, the share with a `recap_written`.
  Trust incidents    over the window: `trust_incident` counts by kind, and per 100 active members.

Definitions that are choices, stated once (the admin panel shows the same words):
  * A "visit" is `notebook_tab_visit` (one per Notebook mount, Stage A). An ET day is America/New_York.
  * A trading day is a weekday; market holidays are NOT removed (a holiday counts as a trading day nobody
    trades). This keeps the read free of a calendar dependency and moves every rate the same way.
  * The member-day denominator (morning, recap) is days the member opened the Notebook at all, so the two rates
    say "on the days they used it", not "of all days".

⛔ BOUNDED BY THE WINDOW (fix round 1, review I5). Nothing reads the whole history:
  * every row read is inside the window (at most 90 days, plus one day before it), by `action` over the
    `(action, created_at)` index, and capped at `MAX_ROWS`; a capped read says so (`capped: true`);
  * a member's FIRST visit (and first "aha") is asked only for the members active in the window, one index SEEK
    each on `(action, user_id, created_at)` (`idx_activity_action_user_created`) -- never a `GROUP BY user_id` over
    every row ever written;
  * ⛔ that index is built AFTER BOOT, on its own daemon thread and connection (`start_activity_index_build`, started
    from api/main.py), never inside auth_db's boot script, where a lock on a big build would skip every later
    migration (Tier 3a re-review R4). UNTIL IT EXISTS the read answers "warming" (`WARMING_SENTENCE`) and reads no
    activity rows at all: without it the planner walks each action's whole history per member;
  * one answer per window is kept for `CACHE_S` in this process, so a reload of the Admin page reads nothing.
It runs on the request thread of an ADMIN only, on open and on Retry (the panel does not poll).

⛔ NEVER CONTENT. Only `user_id`, `created_at` and, for trust incidents, the `kind` enum are read.
"""
from __future__ import annotations

import json
import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable
from zoneinfo import ZoneInfo

from api.services import auth_db

ET = ZoneInfo("America/New_York")
WINDOWS = (7, 30, 90)
MAX_ROWS = 200_000
MORNING_CUTOFF = (9, 30)
DAY7_TRADING_DAYS = 7
DAY7_MIN_DAYS = 3

VISIT = "j2:notebook_tab_visit"
AHA = "j2:first_live_widget"
RECAP = "j2:recap_written"
TRUST = "j2:trust_incident"
FIRST_RUN = "j2:first_run_completed"

DEFINITIONS = {
    "day1": "Members whose first Notebook visit was in the window who opened it again the next ET day.",
    "day7": "Members whose first visit was in the window who opened it on 3+ of their first 7 trading days.",
    "aha": "Time from the first visit to the first widget showing the member's own tickers.",
    "morning": "Of member trading days with a Notebook open, the share with an open before 09:30 ET.",
    "recap": "Of member trading days with a Notebook open, the share with a recap written.",
    "trust": "Publishes undone within 10 minutes; widgets deleted then restored by undo.",
    "tradingDay": "A weekday; market holidays are not removed.",
}


def _parse(ts: Any) -> datetime | None:
    """`activity_log.created_at` (SQLite CURRENT_TIMESTAMP, UTC, 'YYYY-MM-DD HH:MM:SS') as an aware UTC time."""
    if not isinstance(ts, str) or not ts:
        return None
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00").replace(" ", "T", 1))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _et(dt: datetime) -> datetime:
    return dt.astimezone(ET)


def _is_trading_day(d: date) -> bool:
    return d.weekday() < 5


def _trading_days_from(start: date, n: int) -> list[date]:
    out: list[date] = []
    d = start
    while len(out) < n:
        if _is_trading_day(d):
            out.append(d)
        d += timedelta(days=1)
    return out


def _rows(conn, action: str, since: str | None, cols: str = "user_id, created_at") -> tuple[list, bool]:
    if since is None:
        rows = conn.execute(
            f"SELECT {cols} FROM activity_log WHERE action = ? ORDER BY created_at LIMIT ?",
            (action, MAX_ROWS + 1)).fetchall()
    else:
        rows = conn.execute(
            f"SELECT {cols} FROM activity_log WHERE action = ? AND created_at >= ? ORDER BY created_at LIMIT ?",
            (action, since, MAX_ROWS + 1)).fetchall()
    return list(rows[:MAX_ROWS]), len(rows) > MAX_ROWS


def _first_for(conn, action: str, users: Iterable[str]) -> dict[str, datetime]:
    """Each named member's FIRST row of `action`, ever: one MIN per member, an index seek on
    `(action, user_id, created_at)`. Only the members asked about are read (the window's active members)."""
    out: dict[str, datetime] = {}
    for user in users:
        row = conn.execute(
            "SELECT MIN(created_at) AS first FROM activity_log WHERE action = ? AND user_id = ?",
            (action, user)).fetchone()
        dt = _parse(row["first"]) if row else None
        if dt is not None:
            out[user] = dt
    return out


#: One answer per window, per process, this long (an admin reloading the page reads nothing new).
CACHE_S = 600
_CACHE: dict[int, tuple[float, dict[str, Any]]] = {}


def compute_cached(days: int = 30, *, clock=None) -> dict[str, Any]:
    """`compute(days)`, held CACHE_S per window in this process (the admin route calls this)."""
    import time
    t = (clock or time.monotonic)()
    hit = _CACHE.get(days)
    if hit is not None and t - hit[0] < CACHE_S:
        return hit[1]
    out = compute(days)
    if not out.get("warming"):                    # a warming answer is never held: the next open may be ready
        _CACHE[days] = (t, out)
    return out


# ── The index the first-visit seeks need, built after boot (re-review R4) ──────────────────────────────────────
ACTIVITY_INDEX = "idx_activity_action_user_created"
ACTIVITY_INDEX_SQL = (f"CREATE INDEX IF NOT EXISTS {ACTIVITY_INDEX}"
                      " ON activity_log(action, user_id, created_at)")
WARMING_SENTENCE = "Metrics are warming up; try again in a few minutes."
#: The build's own lock wait. Long on purpose: it runs on its own thread, never on a request or the boot path.
BUILD_BUSY_MS = 60_000
BUILD_ATTEMPTS = 6
BUILD_RETRY_S = 600


def index_ready(conn) -> bool:
    """Whether the first-visit index exists (sqlite_master; reads no activity rows)."""
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?",
                        (ACTIVITY_INDEX,)).fetchone() is not None


def build_activity_index(*, connect=None) -> bool:
    """Build the index on its OWN connection. True when it exists afterwards; any failure is logged and False --
    never raised, and it can never touch another migration."""
    import logging
    conn = None
    try:
        conn = (connect or auth_db.get_connection)()
        conn.execute(f"PRAGMA busy_timeout = {BUILD_BUSY_MS}")
        conn.execute(ACTIVITY_INDEX_SQL)
        conn.commit()
        return index_ready(conn)
    except Exception:  # noqa: BLE001 -- a one-shot that retries; the metrics say "warming" meanwhile
        logging.getLogger(__name__).exception("[return-metrics] index build failed; it retries later")
        return False
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass


def run_activity_index_build(*, attempts: int = BUILD_ATTEMPTS, wait_s: float = BUILD_RETRY_S,
                             sleep=None, connect=None) -> bool:
    """Try the build up to `attempts` times, `wait_s` apart. The body of the boot thread (and of its rails)."""
    import time
    nap = sleep or time.sleep
    for i in range(attempts):
        if build_activity_index(connect=connect):
            return True
        if i + 1 < attempts:
            nap(wait_s)
    return False


def start_activity_index_build():
    """api/main.py calls this after the auth schema has committed: one daemon thread, its own connection."""
    import threading
    t = threading.Thread(target=run_activity_index_build, name="return-metrics-index", daemon=True)
    t.start()
    return t


def _rate(num: int, den: int) -> float | None:
    return round(num / den, 4) if den else None


def _seconds_summary(vals: Iterable[float]) -> dict[str, Any]:
    v = sorted(vals)
    if not v:
        return {"n": 0, "medianS": None, "p90S": None}
    p90 = v[min(len(v) - 1, int(round(0.9 * (len(v) - 1))))]
    return {"n": len(v), "medianS": round(statistics.median(v), 1), "p90S": round(p90, 1)}


def compute(days: int = 30, *, now: datetime | None = None, conn=None) -> dict[str, Any]:
    """The six S20 numbers over the last `days` days (`days` in WINDOWS)."""
    if days not in WINDOWS:
        raise ValueError(f"days must be one of {WINDOWS}")
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    start = now - timedelta(days=days)
    since = start.strftime("%Y-%m-%d %H:%M:%S")
    today_et = _et(now).date()
    owned = conn is None
    conn = conn or auth_db.get_connection()
    capped = False
    try:
        if not index_ready(conn):
            # R4: never a full-history walk. Nothing is read from activity_log until the index exists.
            return {"days": days, "asOf": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "warming": True,
                    "message": WARMING_SENTENCE, "definitions": DEFINITIONS}
        visits, c1 = _rows(conn, VISIT, (start - timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S"))
        # A member new in the window has a visit in the window, so only those are asked for their first visit.
        in_window = sorted({r["user_id"] for r in visits if (_parse(r["created_at"]) or start) >= start})
        first_visit = _first_for(conn, VISIT, in_window)
        cohort = {u: t for u, t in first_visit.items() if t >= start}
        first_aha = _first_for(conn, AHA, sorted(cohort))
        recaps, c2 = _rows(conn, RECAP, since)
        trust, c3 = _rows(conn, TRUST, since, "user_id, created_at, details")
        built, c4 = _rows(conn, FIRST_RUN, since)
        capped = c1 or c2 or c3 or c4
    finally:
        if owned:
            conn.close()

    visit_days: dict[str, set[date]] = defaultdict(set)
    morning_days: dict[str, set[date]] = defaultdict(set)
    for r in visits:
        dt = _parse(r["created_at"])
        if dt is None:
            continue
        local = _et(dt)
        visit_days[r["user_id"]].add(local.date())
        if dt >= start and (local.hour, local.minute) < MORNING_CUTOFF:
            morning_days[r["user_id"]].add(local.date())

    # Day-1 return.
    d1_den = d1_num = 0
    # Day-7 return.
    d7_den = d7_num = 0
    for user, first in cohort.items():
        d0 = _et(first).date()
        if d0 + timedelta(days=1) < today_et:          # the next ET day is OVER (review minor 10)
            d1_den += 1
            if (d0 + timedelta(days=1)) in visit_days.get(user, ()):
                d1_num += 1
        window = _trading_days_from(d0, DAY7_TRADING_DAYS)
        if window[-1] < today_et:
            d7_den += 1
            if len(set(window) & visit_days.get(user, set())) >= DAY7_MIN_DAYS:
                d7_num += 1

    # First "aha".
    aha_secs = [(first_aha[u] - t).total_seconds() for u, t in cohort.items()
                if u in first_aha and first_aha[u] >= t]

    # Member trading days with an open, inside the window (the morning and recap denominators).
    member_days = {(u, d) for u, ds in visit_days.items() for d in ds
                   if _is_trading_day(d) and d >= _et(start).date()}
    morning = {(u, d) for (u, d) in member_days if d in morning_days.get(u, ())}
    recap_days = set()
    for r in recaps:
        dt = _parse(r["created_at"])
        if dt is not None:
            recap_days.add((r["user_id"], _et(dt).date()))
    recap_hit = member_days & recap_days

    by_kind: dict[str, int] = defaultdict(int)
    for r in trust:
        try:
            kind = json.loads(r["details"] or "{}").get("kind")
        except (ValueError, AttributeError):
            kind = None
        by_kind[kind if kind in ("publish_undone", "widget_restored") else "other"] += 1
    active = set()
    for r in visits:
        dt = _parse(r["created_at"])
        if dt is not None and dt >= start:
            active.add(r["user_id"])

    return {
        "days": days,
        "asOf": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "capped": bool(capped),
        "definitions": DEFINITIONS,
        "activeMembers": len(active),
        "newMembers": len(cohort),
        "firstRunCompleted": len({r["user_id"] for r in built}),
        "day1": {"returned": d1_num, "of": d1_den, "rate": _rate(d1_num, d1_den)},
        "day7": {"returned": d7_num, "of": d7_den, "rate": _rate(d7_num, d7_den)},
        "aha": {"reached": len(aha_secs), "of": len(cohort), "rate": _rate(len(aha_secs), len(cohort)),
                **_seconds_summary(aha_secs)},
        "morning": {"days": len(morning), "of": len(member_days), "rate": _rate(len(morning), len(member_days))},
        "recap": {"days": len(recap_hit), "of": len(member_days), "rate": _rate(len(recap_hit), len(member_days))},
        "trust": {
            "publishUndone": by_kind.get("publish_undone", 0),
            "widgetRestored": by_kind.get("widget_restored", 0),
            "total": sum(by_kind.values()),
            "per100Active": round(100 * sum(by_kind.values()) / len(active), 2) if active else None,
        },
    }
