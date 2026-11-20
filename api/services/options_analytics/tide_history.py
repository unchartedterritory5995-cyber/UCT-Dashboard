"""Market Tide by day: each finished session's net call and net put premium, stored once after the close.

`market_tide.build(scope)` tides ONE session from our own flow tape and keeps nothing. This module
stores a finished session's totals in a small SQLite file of its own, so a member can set today
beside the days and weeks before it. `GET /api/options/market-tide/history` reads it; the Terminal
panel `TIDEH` draws it.

WHERE THE DATA COMES FROM
  * `capture()` asks `market_tide.build(scope)` for each scope (all / stocks / etfs) and stores the
    session's totals when, and only when, the read is whole (the rules are in `_refusal`).
  * One row per (session, scope). A later capture of the same session replaces the row only when it
    runs at least as late into the day AND holds at least as many prints: a full day is never
    overwritten by a thinner read.
  * `history()` reads the store and nothing else. It never builds a tide and never reads the tape.

HONEST LIMITS
  * It is the tide of the tape's prints (`market_tide.TAPE_FILTERS`), not of all option volume.
  * ⛔ NO BACKFILL (`BACKFILL = False`). The history begins at the first capture; earlier sessions
    are not recovered. Why: the tape's `days=N` read is the whole tape only while N is BELOW
    `FLOW_CSV_CAP_DAYS` (api/flow_router.py: `should_cap = ... (n_days >= cap_days)`), at or above it
    the body is the top `FLOW_CSV_CAP_ROWS` prints by premium, and the response carries nothing that
    says which of the two it is. That threshold is a setting on the flow-worker service, which this
    process cannot read, so a multi-day read cannot be shown to be whole from here.
  * A session with no row is a MISSING session: `history()` names it (by the trading calendar) and
    never fills it, interpolates it or draws it as zero.
  * The trading calendar is a published dataset with an end date. Past it no day is named missing;
    `missing_checked_through` says how far the check reached.
  * ⛔ `build()` returns no gross figures (no bought-at-the-ask / sold-at-the-bid split), so none is
    stored: net call, net put, net, and the print counts are all there is.
  * A day is NOT thrown away for a few prints the tape could not date, price or label call/put:
    `build()` leaves those out of its figures and calls the read partial, and with no backfill a
    refused day is gone for good. When that is the ONLY shortfall and they are at most
    `UNREADABLE_MAX_SHARE` of the prints counted, the day is stored with their count
    (`prints_unreadable`), which the panel shows. Any other partial read is refused.

⛔ Its own file under DATA_DIR (WAL, busy_timeout). Plain blocking SQLite: the route is a plain `def`.
⛔ `capture()` and `run_capture_job()` never raise: one scope failing is logged and the others store.
"""
from __future__ import annotations

import contextlib
import datetime as _dt
import json
import logging
import math
import os
import sqlite3
from typing import Optional
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")

#: The one switch: the same one the tide itself sits behind. Read when the job RUNS.
SWITCH = "OPTIONS_MARKET_TIDE_ENABLED"
#: The store's file name under DATA_DIR.
DB_FILE = "market_tide_history.db"
#: Today's session counts as finished once the New York clock passes this (index options trade to
#: 16:15, so the last print of the day is in by then).
FINISHED_AFTER = (16, 20)
#: A whole session's last tided minute is no earlier than this many minutes before that day's
#: regular close (15:55 on a normal day, 12:55 on a 13:00 half-day). A tape that stops sooner is
#: a tape that stopped, not a finished day.
CLOSE_SLACK_MIN = 5
#: The most prints a stored day may have left out as unreadable, as a share of the prints counted.
UNREADABLE_MAX_SHARE = 0.01
#: The regular close used when the calendar cannot name the day's own.
REGULAR_CLOSE = (16, 0)
#: The job never reads the tape between these New York times on a weekday, whoever calls it.
QUIET_FROM, QUIET_TO = (9, 20), (16, 15)
DEFAULT_SESSIONS = 60
MAX_SESSIONS = 250
#: See the module docstring: there is none, and `history()` says so.
BACKFILL = False
SOURCE_CAPTURE = "capture"
STORED_NOTE = ("Each session is stored once after its close, about 4:30 PM ET, and is not revised "
               "afterwards. Sessions before the first stored day were never stored and cannot be "
               "recovered.")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS tide_sessions (
  session TEXT NOT NULL,
  scope TEXT NOT NULL,
  net_call_premium INTEGER NOT NULL,
  net_put_premium INTEGER NOT NULL,
  net_premium INTEGER NOT NULL,
  prints_counted INTEGER NOT NULL,
  prints_unsigned INTEGER NOT NULL,
  prints_unreadable INTEGER NOT NULL,
  minutes INTEGER NOT NULL,
  data_through TEXT NOT NULL,
  first_stored_at TEXT NOT NULL,
  stored_at TEXT NOT NULL,
  source TEXT NOT NULL,
  tape_versions TEXT NOT NULL,
  PRIMARY KEY (session, scope)
);
"""
_COLUMNS = ("session", "net_call_premium", "net_put_premium", "net_premium", "prints_counted",
            "prints_unsigned", "prints_unreadable", "data_through", "stored_at", "source")


def _db_path() -> str:
    return os.path.join(os.environ.get("DATA_DIR", "/data"), DB_FILE)


def _connect() -> sqlite3.Connection:
    path = _db_path()
    with contextlib.suppress(OSError):
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    conn = sqlite3.connect(path, timeout=5)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=2000")
    conn.executescript(_SCHEMA)
    return conn


# ── the rules a read must pass to be stored ─────────────────────────────────────

def _floor(session: str) -> str:
    """The earliest last-minute ('HH:MM') a whole `session` can end on."""
    h, m = REGULAR_CLOSE
    try:
        from api.services import session_calendar
        close = session_calendar.close_time(_dt.date.fromisoformat(session))
        if close is not None:
            h, m = close.hour, close.minute
    except Exception:  # noqa: BLE001 -- the calendar is a published dataset; fall back to 16:00
        pass
    total = h * 60 + m - CLOSE_SLACK_MIN
    return f"{total // 60:02d}:{total % 60:02d}"


def _whole(v) -> Optional[int]:
    """A finite number as an int, else None (a bool is not a number here)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return None
    return int(round(v))


def _only_unreadable(tide: dict) -> bool:
    """True when the read is whole but for prints the tape could not date, price or label: every
    source was read, the session's prints are there, the ONE reason given is that count, and it is
    within UNREADABLE_MAX_SHARE of the prints counted. A failed source, or a reason this module
    does not know, is never waved through."""
    bad, counted = _whole(tide.get("prints_unreadable")), _whole(tide.get("prints_counted"))
    sources = tide.get("sources")
    return bool(
        bad and bad > 0 and counted and bad <= counted * UNREADABLE_MAX_SHARE
        and isinstance(sources, dict) and sources and all(v == "ok" for v in sources.values())
        and tide.get("session_status") != "no_prints_today"
        and len(tide.get("partial_reasons") or []) == 1)


def _refusal(tide: dict, now_et: _dt.datetime) -> Optional[str]:
    """Why this read is NOT stored, in words; None when it is whole."""
    session = tide.get("session")
    try:
        day = _dt.date.fromisoformat(str(session))
    except ValueError:
        return "The tape holds no session to store."
    today = now_et.date()
    if day > today:
        return f"The tape's session {session} is dated after today, so it is not stored."
    if day == today and (now_et.hour, now_et.minute) < FINISHED_AFTER:
        return (f"The {session} session is not finished: today's session is stored after "
                f"{FINISHED_AFTER[0] - 12}:{FINISHED_AFTER[1]:02d} PM ET.")
    if tide.get("tape_behind"):
        return f"The tape is running behind for {session}, so it is not stored."
    if tide.get("partial") and not _only_unreadable(tide):
        why = " ".join(str(x) for x in (tide.get("partial_reasons") or [])) or "No reason was given."
        return f"The read of {session} is partial, so it is not stored: {why}"
    minutes = tide.get("minutes")
    if not isinstance(minutes, list) or not minutes:
        return f"No print was tided for {session}, so there is nothing to store."
    through = tide.get("data_through")
    floor = _floor(session)
    if not isinstance(through, str) or len(through) != 5 or through < floor:
        return (f"The tape for {session} runs only to {through or 'no minute'} ET, short of "
                f"{floor} ET, so the day is not stored as finished.")
    totals = tide.get("totals") or {}
    figures = [totals.get("net_call_premium"), totals.get("net_put_premium"), totals.get("net_premium"),
               tide.get("prints_counted"), tide.get("prints_unsigned"), tide.get("prints_unreadable")]
    if any(_whole(v) is None for v in figures):
        return f"The totals for {session} could not be read, so it is not stored."
    return None


def _store(conn: sqlite3.Connection, scope: str, tide: dict, stamp: str) -> dict:
    """Insert or replace one row under the replace rule. Returns what happened, in words."""
    session = tide["session"]
    through = tide["data_through"]
    prints = _whole(tide["prints_counted"])
    unreadable = _whole(tide["prints_unreadable"])
    totals = tide["totals"]
    conn.execute("BEGIN IMMEDIATE")
    try:
        old = conn.execute("SELECT data_through, prints_counted, first_stored_at FROM tide_sessions "
                           "WHERE session = ? AND scope = ?", (session, scope)).fetchone()
        if old and not (through >= old[0] and prints >= old[1]):
            conn.execute("ROLLBACK")
            return {"stored": False, "session": session, "replaced": False,
                    "reason": (f"A fuller read of {session} is already stored (through {old[0]} ET, "
                               f"{old[1]} prints); this one (through {through} ET, {prints} prints) "
                               "was not kept.")}
        conn.execute(
            "INSERT OR REPLACE INTO tide_sessions (session, scope, net_call_premium, net_put_premium, "
            "net_premium, prints_counted, prints_unsigned, prints_unreadable, minutes, data_through, "
            "first_stored_at, stored_at, source, tape_versions) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (session, scope, _whole(totals["net_call_premium"]), _whole(totals["net_put_premium"]),
             _whole(totals["net_premium"]), prints, _whole(tide["prints_unsigned"]), unreadable,
             len(tide["minutes"]), through, old[2] if old else stamp, stamp, SOURCE_CAPTURE,
             json.dumps(tide.get("tape_versions") or {}, sort_keys=True, default=str)))
        conn.execute("COMMIT")
    except Exception:
        with contextlib.suppress(sqlite3.Error):
            conn.execute("ROLLBACK")
        raise
    left_out = f" {unreadable} unreadable prints were left out." if unreadable else ""
    return {"stored": True, "session": session, "replaced": bool(old),
            "reason": f"Stored {session} through {through} ET, {prints} prints.{left_out}"}


def capture(now: Optional[_dt.datetime] = None) -> dict:
    """Store each scope's finished session. `{scope: {stored, session, replaced, reason}}`.
    Never raises: a scope that fails says why and the others still store."""
    from api.services.options_analytics import market_tide as mt
    out: dict = {}
    for scope in mt.SCOPES:
        try:
            now_et = now.astimezone(_ET) if now else mt._now()
            tide = mt.build(scope, now=now)
            why = _refusal(tide, now_et)
            if why:
                out[scope] = {"stored": False, "session": tide.get("session"), "replaced": False,
                              "reason": why}
            else:
                stamp = _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")
                with contextlib.closing(_connect()) as conn:
                    conn.isolation_level = None
                    out[scope] = _store(conn, scope, tide, stamp)
        except Exception as e:  # noqa: BLE001 -- one scope never stops the others, or the scheduler
            out[scope] = {"stored": False, "session": None, "replaced": False,
                          "reason": f"The {scope} tide could not be stored: {type(e).__name__}."}
            logger.warning("[tide-history] %s not stored: %s: %s", scope, type(e).__name__, e)
            continue
        log = logger.info if out[scope]["stored"] else logger.warning
        log("[tide-history] %s: %s", scope, out[scope]["reason"])
    return out


def run_capture_job(now: Optional[_dt.datetime] = None) -> dict:
    """The scheduler's entry. Switch off, or inside the trading day: returns without reading
    anything. Never raises."""
    try:
        from api.services.options_analytics import flags
        if not flags.is_on(SWITCH):
            return {"ran": False, "reason": "Market Tide is switched off."}
        from api.services.options_analytics import market_tide as mt
        now_et = now.astimezone(_ET) if now else mt._now()
        if now_et.weekday() < 5 and QUIET_FROM <= (now_et.hour, now_et.minute) < QUIET_TO:
            return {"ran": False, "reason": "The session is still trading; a session is stored after its close."}
        return {"ran": True, "scopes": capture(now)}
    except Exception as e:  # noqa: BLE001 -- nothing here reaches the scheduler
        logger.warning("[tide-history] capture job failed: %s: %s", type(e).__name__, e)
        return {"ran": False, "reason": f"The capture failed: {type(e).__name__}."}


# ── reading the store ───────────────────────────────────────────────────────────

def _missing(stored: list) -> tuple:
    """(trading sessions strictly between the first and last stored day that have no row, oldest
    first; the last day the calendar could vouch for). Past the calendar's end no day is named."""
    if not stored:
        return [], None
    from api.services import session_calendar
    have = set(stored)
    d, end = _dt.date.fromisoformat(stored[0]), _dt.date.fromisoformat(stored[-1])
    out, checked = [], stored[0]
    try:
        while True:
            d += _dt.timedelta(days=1)
            if d >= end:
                checked = stored[-1]
                break
            if not session_calendar.covers(d):
                break
            if session_calendar.is_trading_day(d) and d.isoformat() not in have:
                out.append(d.isoformat())
            checked = d.isoformat()
    except Exception:  # noqa: BLE001 -- name what was found; never guess the rest
        pass
    return out, checked


def history(scope: str = "all", sessions: int = DEFAULT_SESSIONS) -> dict:
    """The stored sessions of `scope`, newest first, at most `sessions` (clamped 1..MAX_SESSIONS).
    Reads the store only. A store that does not exist yet is an empty history, and is not created."""
    from api.services.options_analytics import market_tide as mt
    if scope not in mt.SCOPES:
        raise ValueError(f"{scope!r} is not a tide scope")
    try:
        n = int(sessions)
    except (TypeError, ValueError):
        n = DEFAULT_SESSIONS
    n = max(1, min(MAX_SESSIONS, n))
    rows, stored = [], []
    if os.path.exists(_db_path()):
        with contextlib.closing(_connect()) as conn:
            rows = conn.execute(
                f"SELECT {', '.join(_COLUMNS)} FROM tide_sessions WHERE scope = ? "
                "ORDER BY session DESC LIMIT ?", (scope, n)).fetchall()
            stored = [r[0] for r in conn.execute(
                "SELECT session FROM tide_sessions WHERE scope = ? ORDER BY session", (scope,))]
    missing, checked = _missing(stored)
    return {
        "scope": scope,
        "sessions": [dict(zip(_COLUMNS, r)) for r in rows],
        "sessions_stored": len(stored),
        "sessions_asked": n,
        "history_began": stored[0] if stored else None,
        "latest_session": stored[-1] if stored else None,
        "missing_sessions": missing,
        "missing_checked_through": checked,
        "backfill": BACKFILL,
        "stored_note": STORED_NOTE,
        "filters": mt.TAPE_FILTERS,
        "method": mt.METHOD,
        "label": "computed",
    }
