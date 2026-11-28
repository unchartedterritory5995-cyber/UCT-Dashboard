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
  * ⛔ NO BACKFILL (`BACKFILL = False`). The history begins at the first capture; sessions before
    it are not recovered. Why: the tape's `days=N` read is the whole tape only while N is BELOW
    `FLOW_CSV_CAP_DAYS` (api/flow_router.py: `should_cap = ... (n_days >= cap_days)`), at or above it
    the body is the top `FLOW_CSV_CAP_ROWS` prints by premium, and the response carries nothing that
    says which of the two it is. That threshold is a setting on the flow-worker service, which this
    process cannot read, so a multi-day read cannot be shown to be whole from here.
  * CATCH-UP (R1, 2026-11-28): a session INSIDE the history that the three after-close tries all
    missed (a deploy across the window, a worker outage, a refused read) is re-read later, ONE DAY
    AT A TIME, with `date_from=date_to=<day>`. A one-day range is the same one-day size the tide's
    own `days=1` read relies on (flow_router: the cap keys off how many days the range covers),
    and the tape prunes by whole trade day (flow_db.prune_old_trade_days), so a day it still holds
    is all there or not there. The re-read passes the same `_refusal` rules as a capture plus
    stricter ones (`_day_refusal`: every source read, each with prints of that day and no other),
    and is stored with `source = "catchup"`. A day that fails `CATCHUP_MAX_TRIES` runs is recorded
    in `tide_gaps` as missing for good, with the last reason, and is not read again. Bounded:
    the last `CATCHUP_WINDOW` sessions, never before the first stored day, at most
    `CATCHUP_MAX_DAYS` days (two tape reads each) per run, never inside the trading day, and only
    when a day is actually missing. It runs after each scheduled capture and once at start-up.
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
#: A session the after-close tries missed, re-read from the tape later (see CATCH-UP above).
SOURCE_CATCHUP = "catchup"
#: How far back the catch-up looks, in trading sessions ending at the last finished one. Far inside
#: the tape's retention (flow_db.FLOW_RETAIN_TRADE_DAYS, 90 days, prune unarmed today).
CATCHUP_WINDOW = 20
#: Missed sessions re-read per run (each costs one tape read per source: two).
CATCHUP_MAX_DAYS = 2
#: Runs a missed session is tried in before it is recorded as missing for good.
CATCHUP_MAX_TRIES = 3
#: Seconds after start-up the one catch-up run waits (the app is up, the worker reachable).
CATCHUP_BOOT_DELAY_S = 180
STORED_NOTE = ("Each session is stored once after its close, about 4:30 PM ET, and is not revised "
               "afterwards. A session missed then is read again from the tape later, while the "
               "tape still holds all of it. Sessions before the first stored day were never "
               "stored and cannot be recovered.")

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
CREATE TABLE IF NOT EXISTS tide_gaps (
  session TEXT NOT NULL,
  scope TEXT NOT NULL,
  tries INTEGER NOT NULL,
  last_tried_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  given_up INTEGER NOT NULL,
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


def _store(conn: sqlite3.Connection, scope: str, tide: dict, stamp: str,
           source: str = SOURCE_CAPTURE) -> dict:
    """Insert or replace one row under the replace rule. Returns what happened, in words.
    A catch-up (`source = SOURCE_CATCHUP`) only ever fills an EMPTY slot: it never replaces a row."""
    session = tide["session"]
    through = tide["data_through"]
    prints = _whole(tide["prints_counted"])
    unreadable = _whole(tide["prints_unreadable"])
    totals = tide["totals"]
    conn.execute("BEGIN IMMEDIATE")
    try:
        old = conn.execute("SELECT data_through, prints_counted, first_stored_at FROM tide_sessions "
                           "WHERE session = ? AND scope = ?", (session, scope)).fetchone()
        if old and source == SOURCE_CATCHUP:
            conn.execute("ROLLBACK")
            return {"stored": False, "session": session, "replaced": False,
                    "reason": f"{session} is already stored; the catch-up leaves it as it is."}
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
             len(tide["minutes"]), through, old[2] if old else stamp, stamp, source,
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


def _job_refusal(now: Optional[_dt.datetime]) -> Optional[str]:
    """Why a job reads nothing now (switch off, or inside the trading day); None when it may."""
    from api.services.options_analytics import flags
    if not flags.is_on(SWITCH):
        return "Market Tide is switched off."
    from api.services.options_analytics import market_tide as mt
    now_et = now.astimezone(_ET) if now else mt._now()
    if now_et.weekday() < 5 and QUIET_FROM <= (now_et.hour, now_et.minute) < QUIET_TO:
        return "The session is still trading; a session is stored after its close."
    return None


def run_capture_job(now: Optional[_dt.datetime] = None) -> dict:
    """The scheduler's entry: store the finished session, then re-read any missed one (the
    catch-up reads nothing when no day is missing). Switch off, or inside the trading day:
    returns without reading anything. Never raises."""
    try:
        why = _job_refusal(now)
        if why:
            return {"ran": False, "reason": why}
        return {"ran": True, "scopes": capture(now), "catchup": catch_up(now)}
    except Exception as e:  # noqa: BLE001 -- nothing here reaches the scheduler
        logger.warning("[tide-history] capture job failed: %s: %s", type(e).__name__, e)
        return {"ran": False, "reason": f"The capture failed: {type(e).__name__}."}


def run_startup_job(now: Optional[_dt.datetime] = None) -> dict:
    """Once, a few minutes after start-up: the catch-up alone, today included when today's
    session is finished (a restart across the after-close window would otherwise lose today
    until tomorrow's runs). Same guards as the capture job. Never raises."""
    try:
        why = _job_refusal(now)
        if why:
            return {"ran": False, "reason": why}
        return {"ran": True, "catchup": catch_up(now, include_today=True)}
    except Exception as e:  # noqa: BLE001 -- nothing here reaches the scheduler
        logger.warning("[tide-history] start-up catch-up failed: %s: %s", type(e).__name__, e)
        return {"ran": False, "reason": f"The catch-up failed: {type(e).__name__}."}


# ── catch-up: a missed session, re-read later from the tape, one day at a time ─────

def _sources_for(scope: str) -> list:
    """The tape partitions a scope is made of (the same rule as `market_tide.build`)."""
    from api.services.options_analytics import market_tide as mt
    return list(mt.SOURCES) if scope == "all" else ["stocks" if scope == "stocks" else "etfs"]


def _default_read_day(path: str, day: str, add) -> tuple:
    """Stream ONE session of one tape partition into `add`: `?date_from=day&date_to=day`, the
    route's one-day range (whole: the cap keys off the days the range covers). (ok, version).
    ok is False when the read FAILED; a day the tape does not hold is ok with no rows."""
    import csv
    import httpx
    from api import flow_proxy
    from api.services.options_analytics import market_tide as mt
    try:
        with httpx.stream("GET", mt._flow_base_url() + path,
                          params={"date_from": day, "date_to": day},
                          headers=flow_proxy.internal_read_headers(),
                          timeout=mt.READ_TIMEOUT_S) as r:
            if r.status_code != 200:
                return False, None
            version = r.headers.get("x-flow-version")
            for row in csv.DictReader(r.iter_lines()):
                add(row)
            return True, version
    except Exception:  # noqa: BLE001 -- a failed read, never an empty day
        return False, None


#: Swappable in tests: (path, iso day, add) -> (ok, version).
_read_day = _default_read_day


def _last_finished(now_et: _dt.datetime, include_today: bool) -> Optional[_dt.date]:
    """The newest trading session the catch-up may look at: today only when asked and today's
    session is finished, else the trading day before today. None past the calendar's reach."""
    from api.services import session_calendar
    d = now_et.date()
    if not (include_today and (now_et.hour, now_et.minute) >= FINISHED_AFTER):
        d -= _dt.timedelta(days=1)
    for _ in range(15):
        if not session_calendar.covers(d):
            return None
        if session_calendar.is_trading_day(d):
            return d
        d -= _dt.timedelta(days=1)
    return None


def find_gaps(now: Optional[_dt.datetime] = None, include_today: bool = False) -> list:
    """The missed sessions, newest first: `[{session, scopes}]`. A session counts when it is a
    trading day among the last CATCHUP_WINDOW sessions ending at `_last_finished`, on or after
    the first stored day of ANY scope, with no row for a scope and not given up for it. Reads the
    store and the calendar only; no store yet is no gap (and creates nothing)."""
    from api.services import session_calendar
    from api.services.options_analytics import market_tide as mt
    if not os.path.exists(_db_path()):
        return []
    now_et = now.astimezone(_ET) if now else mt._now()
    with contextlib.closing(_connect()) as conn:
        stored = {s: set() for s in mt.SCOPES}
        for session, scope in conn.execute("SELECT session, scope FROM tide_sessions"):
            stored.setdefault(scope, set()).add(session)
        given_up = set(conn.execute("SELECT session, scope FROM tide_gaps WHERE given_up = 1"))
    every = set().union(*stored.values())
    if not every:
        return []
    floor = min(every)
    out, seen = [], 0
    try:
        d = _last_finished(now_et, include_today)
        while d is not None and seen < CATCHUP_WINDOW and d.isoformat() >= floor:
            if not session_calendar.covers(d):
                break
            if session_calendar.is_trading_day(d):
                seen += 1
                iso = d.isoformat()
                scopes = [s for s in mt.SCOPES if iso not in stored[s] and (iso, s) not in given_up]
                if scopes:
                    out.append({"session": iso, "scopes": scopes})
            d -= _dt.timedelta(days=1)
    except Exception:  # noqa: BLE001 -- name what was found; never guess the rest
        pass
    return out


def _day_refusal(day: str, srcs: list, parts: dict, status: dict) -> Optional[str]:
    """Stricter than a capture, because nothing else vouches for a day read later: every source
    of the scope was read, and each holds prints of THIS day and of no other."""
    for name in srcs:
        if status.get(name) != "ok":
            return f"The {name} tape could not be read for {day}, so it is not stored."
    for name in srcs:
        held = set(parts[name]._by_session)
        if not held:
            return (f"The tape holds no {name} prints for {day} (it no longer holds that day, "
                    "or never did), so it is not stored.")
        if held != {day}:
            return f"The {name} tape answered with other days than {day}, so it is not stored."
    return None


def _day_tides(day: str, scopes: list) -> dict:
    """{scope: a tide shaped like `market_tide.build`'s, or the reason in words}. Each source is
    read ONCE for all the scopes that need it (two reads for a whole day)."""
    from api.services.options_analytics import market_tide as mt
    needed = sorted({name for s in scopes for name in _sources_for(s)})
    parts, status, versions = {}, {}, {}
    for name in needed:
        part = mt.Tide()           # its own accumulator: a read that dies half-way is dropped whole
        ok, version = _read_day(mt.SOURCES[name], day, part.add)
        status[name], versions[name] = ("ok" if ok else "failed"), version
        if ok:
            parts[name] = part
    out = {}
    for scope in scopes:
        srcs = _sources_for(scope)
        why = _day_refusal(day, srcs, parts, status)
        if why:
            out[scope] = why
            continue
        acc = mt.Tide()
        for name in srcs:
            mt._merge(acc, parts[name])
        res = acc.result()
        reasons = []
        if res["prints_unreadable"]:
            reasons.append(f"{res['prints_unreadable']} prints had no readable time, premium or "
                           "call/put and are not counted.")
        out[scope] = {**res, "scope": scope, "sources": {n: status[n] for n in srcs},
                      "tape_versions": {n: versions[n] for n in srcs}, "tape_behind": False,
                      "partial": bool(reasons), "partial_reasons": reasons}
    return out


def _record_try(conn: sqlite3.Connection, session: str, scope: str, why: str, stamp: str) -> dict:
    """One more failed try for (session, scope); the CATCHUP_MAX_TRIES-th gives it up for good."""
    old = conn.execute("SELECT tries FROM tide_gaps WHERE session = ? AND scope = ?",
                       (session, scope)).fetchone()
    tries = (old[0] if old else 0) + 1
    given_up = tries >= CATCHUP_MAX_TRIES
    conn.execute("INSERT OR REPLACE INTO tide_gaps (session, scope, tries, last_tried_at, reason, "
                 "given_up) VALUES (?, ?, ?, ?, ?, ?)",
                 (session, scope, tries, stamp, why, 1 if given_up else 0))
    return {"stored": False, "session": session, "replaced": False, "reason": why,
            "tries": tries, "given_up": given_up}


def catch_up(now: Optional[_dt.datetime] = None, include_today: bool = False) -> dict:
    """Re-read up to CATCHUP_MAX_DAYS missed sessions from the tape and store each scope that
    passes every rule (`source = "catchup"`); a refused one is a try, and the last try gives it
    up. `{gaps, tried: [{session, scopes: {scope: result}}], left}`. Never raises; reads nothing
    when no session is missing."""
    from api.services.options_analytics import market_tide as mt
    try:
        now_et = now.astimezone(_ET) if now else mt._now()
        gaps = find_gaps(now_et, include_today)
    except Exception as e:  # noqa: BLE001
        logger.warning("[tide-history] catch-up could not look for gaps: %s: %s", type(e).__name__, e)
        return {"gaps": None, "tried": [], "left": None, "reason": f"{type(e).__name__}"}
    todo = gaps[:CATCHUP_MAX_DAYS]
    tried = []
    for gap in todo:
        day, results = gap["session"], {}
        try:
            tides = _day_tides(day, gap["scopes"])
        except Exception as e:  # noqa: BLE001 -- the day is a try, never a crash
            tides = {s: f"The tape read for {day} failed: {type(e).__name__}." for s in gap["scopes"]}
        stamp = _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")
        for scope, t in tides.items():
            try:
                why = t if isinstance(t, str) else _refusal(t, now_et)
                with contextlib.closing(_connect()) as conn:
                    conn.isolation_level = None
                    if why:
                        results[scope] = _record_try(conn, day, scope, why, stamp)
                    else:
                        # its tries, if any, stay in tide_gaps as history: a stored day is never
                        # a gap again, and this store deletes nothing (a rail pins that)
                        results[scope] = _store(conn, scope, t, stamp, source=SOURCE_CATCHUP)
            except Exception as e:  # noqa: BLE001 -- one scope never stops the others
                results[scope] = {"stored": False, "session": day, "replaced": False,
                                  "reason": f"The {scope} catch-up failed: {type(e).__name__}."}
            log = logger.info if results[scope].get("stored") else logger.warning
            log("[tide-history] catch-up %s %s: %s", day, scope, results[scope]["reason"])
        tried.append({"session": day, "scopes": results})
    return {"gaps": len(gaps), "tried": tried, "left": len(gaps) - len(todo)}


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
    rows, stored, recovered, for_good = [], [], [], []
    if os.path.exists(_db_path()):
        with contextlib.closing(_connect()) as conn:
            rows = conn.execute(
                f"SELECT {', '.join(_COLUMNS)} FROM tide_sessions WHERE scope = ? "
                "ORDER BY session DESC LIMIT ?", (scope, n)).fetchall()
            every = conn.execute("SELECT session, source FROM tide_sessions WHERE scope = ? "
                                 "ORDER BY session", (scope,)).fetchall()
            stored = [r[0] for r in every]
            recovered = [r[0] for r in every if r[1] == SOURCE_CATCHUP]
            have = set(stored)
            for_good = [{"session": s, "reason": why} for s, why in conn.execute(
                "SELECT session, reason FROM tide_gaps WHERE scope = ? AND given_up = 1 "
                "ORDER BY session", (scope,)) if s not in have]
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
        "recovered_sessions": recovered,
        "missing_for_good": for_good,
        "catchup_window": CATCHUP_WINDOW,
        "stored_note": STORED_NOTE,
        "filters": mt.TAPE_FILTERS,
        "method": mt.METHOD,
        "label": "computed",
    }
