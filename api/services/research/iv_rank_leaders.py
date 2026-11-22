"""OSCR RICH / OSCR CHEAP: the market-wide IV rank list, built once an evening from OUR options log.

WHAT IT IS
  For every symbol the options log covers with at least `iv_history.RANK_MIN_SESSIONS` sessions of
  the current ATM read, the latest session's ATM IV, its IV rank and IV percentile against its own
  logged sessions (up to `iv_history.RANK_WINDOW`), and how many sessions that is. Two cuts of the one
  list: the highest IV rank (options rich against their own year) and the lowest (cheap), each
  `MAX_PER_SIDE` long, with the counts of everything left out said in numbers.

WHY IT IS ITS OWN LIST
  The option screener's IV percentile ranking (`options_screener.iv_percentile`, the OSCR "IV
  percentile" tab) sorts by percentile, keeps the 200 highest and is computed on the first request
  after each new session; it holds every summary file's rows in memory to do it. This list sorts by
  IV RANK both ways, is built off the request, and keeps nothing between builds but its answer.

THE RULES ARE THE SERVICE'S, NEVER RETYPED
  The read rule of a day (`iv_history.summary_rule`), the number parse (`iv_history._num`), the
  minimum and the window (`RANK_MIN_SESSIONS`, `RANK_WINDOW`), the rank and percentile
  (`iv_history.rank_of`) and the rank's word (`vol.rank_label`) are the ones the IVH panel and the
  option chain's header use, so a symbol reads the same here as in `NVDA IVH`. A first-run day (the
  20-45 day rule) is left out of every rank, as there.

WHEN (never on a member's request)
  The scheduler calls `run_scheduled` daily at `RUN_AT_ET` (20:45 New York time): after the 16:30
  log and its screen build, inside `scan_period`'s quiet span. It reads the per-underlying summary
  files the IVH store already mirrors (`iv_history.get_store()`, about 80 KB a day), one file at a time,
  streaming its rows, and keeps one small float array per symbol (at most `RANK_WINDOW` values).
  Measured on an invented log of 6,034 underlyings (the real log's count, 2026-09-30): see
  `MEASURED_PEAK_MB`. The answer is held in this module and in one file on the data disk, so a
  restart serves the last evening's list at once.

⛔ NO VENDOR CALL. It reads only the log this server already holds (our own R2 copy).
⛔ A SYMBOL UNDER THE MINIMUM IS LEFT OUT AND COUNTED, never ranked on fewer sessions.
⛔ DARK with the option screener: the job runs only while `OPTIONS_SCREENER_ENABLED` is on (the route's
  own switch, read per call through `options_screener.is_enabled`). No new switch.
"""
from __future__ import annotations

import csv
import gzip
import json
import logging
import os
import tempfile
import threading
import time
from array import array
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from api.services.research import iv_history

_log = logging.getLogger(__name__)

SOURCE = iv_history.SOURCE
MAX_PER_SIDE = 100
RUN_AT_ET = (20, 45)                 # daily, New York time (scan_period's quiet span starts 20:15 on a weekday)
DISK_DIR = "iv_rank_leaders"
DISK_FILE = "leaders_v1.json"
DISK_VERSION = 1
#: The private-memory peak one build added over an invented log of 6,034 underlyings (2026-11-22, the dev PC):
#: 40 sessions 10 MB in 0.8 s, 252 sessions 26 MB in 8.8 s (tracemalloc: 7.6 and 16.6 MB). Each symbol keeps at
#: most RANK_WINDOW values, so the memory stops growing at 252 sessions; only the time grows with the log.
MEASURED_PEAK_MB = 26
RANK_METHOD = ("IV rank = where the latest session's ATM IV sits between its lowest and highest over the "
               "symbol's own logged sessions (up to 252), from 0 to 100. IV percentile = the share of those "
               "earlier sessions whose ATM IV was below it. " + iv_history.METHOD)
HIGH_ORDER = "Highest IV rank first; a tie goes to the higher IV percentile, then to more open interest."
LOW_ORDER = "Lowest IV rank first; a tie goes to the lower IV percentile, then to more open interest."


def now_et() -> datetime:
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/New_York"))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def quiet(now: datetime) -> bool:
    """scan_period's quiet span (weekends; weekdays before 07:00 or from 20:15 New York time), read
    from scan_period itself."""
    from api.services import scan_period
    from zoneinfo import ZoneInfo
    return bool(scan_period._reuse_quiet_now(now.astimezone(ZoneInfo("America/New_York"))))


def next_run(now: Optional[datetime] = None) -> datetime:
    now = now or now_et()
    slot = now.replace(hour=RUN_AT_ET[0], minute=RUN_AT_ET[1], second=0, microsecond=0)
    return slot if slot > now else slot + timedelta(days=1)


# ── the build ───────────────────────────────────────────────────────────────────────────────────

def _int(v) -> Optional[int]:
    n = iv_history._num(v)
    return int(n) if n is not None and n == n else None


def _read_day(path: str):
    """`(rule, rows)` of one summary file, rows streamed as `(symbol, atm_iv, atm_dte, open_interest)`.
    `rows` is None for a file that is not the current rule or has no ATM IV column."""
    fh = gzip.open(path, "rt", newline="", encoding="utf-8")
    reader = csv.reader(fh)
    header = next(reader, None) or []
    rule = iv_history.summary_rule(header)
    col = {name: k for k, name in enumerate(header)}
    iu, iiv = col.get("underlying"), col.get("atm_iv")
    if rule != iv_history.CURRENT_RULE or iu is None or iiv is None:
        fh.close()
        return rule, None
    idte, icoi, ipoi = col.get("atm_dte"), col.get("call_oi"), col.get("put_oi")

    def cell(r: list, k: Optional[int]):
        return r[k] if k is not None and k < len(r) else None

    def rows():
        try:
            for r in reader:
                sym = (cell(r, iu) or "").strip()
                if not sym:
                    continue
                coi, poi = _int(cell(r, icoi)), _int(cell(r, ipoi))
                oi = None if coi is None and poi is None else (coi or 0) + (poi or 0)
                yield sym, iv_history._num(cell(r, iiv)), _int(cell(r, idte)), oi
        finally:
            fh.close()
    return rule, rows()


def build(*, store=None, now: Optional[datetime] = None) -> dict:
    """The list, from every summary file the store holds. Raises when the store cannot be listed
    (the caller keeps the last good answer)."""
    from api.services.options_analytics.vol import rank_label
    store = store or iv_history.get_store()
    manifests = store.sessions()
    base = {"v": DISK_VERSION, "source": SOURCE, "method": RANK_METHOD, "high_order": HIGH_ORDER,
            "low_order": LOW_ORDER, "rank_min_sessions": iv_history.RANK_MIN_SESSIONS,
            "rank_window": iv_history.RANK_WINDOW, "max_per_side": MAX_PER_SIDE, "built_at": _now_iso(),
            "data_basis": "end-of-day snapshot"}
    sessions = sorted(manifests)
    if not sessions:
        return {**base, "status": "no_log", "session": None, "logging_began": None, "sessions_logged": 0,
                "rankable_sessions": 0, "legacy_sessions": [], "unread_sessions": [], "missing_sessions": [],
                "counts": _counts(), "high": [], "low": []}
    series: dict[str, array] = {}
    last_seen: dict[str, int] = {}
    latest_idx, latest_extra, latest_rows, latest_no_iv = None, {}, 0, 0
    legacy, unread, rankable = [], [], 0
    for i, d in enumerate(sessions):
        path = store.summary_path(d)
        if path is None:
            unread.append(d)
            continue
        try:
            rule, rows = _read_day(path)
            # the whole day is read before any of it counts: a file that breaks half way is unread, not half a day
            day = list(rows) if rows is not None else None
        except (OSError, EOFError, csv.Error, UnicodeDecodeError):
            unread.append(d)
            continue
        if day is None:
            (legacy if rule == iv_history.LEGACY_RULE else unread).append(d)
            continue
        day_extra, day_rows, day_no_iv, seen = {}, 0, 0, set()
        for sym, iv, dte, oi in day:
            if sym in seen:                 # one row a symbol a day: the first, as iv_history's reader
                continue
            seen.add(sym)
            day_rows += 1
            if iv is None:
                day_no_iv += 1
                continue
            a = series.get(sym)
            if a is None:
                a = series[sym] = array("d")
            a.append(iv)
            if len(a) > iv_history.RANK_WINDOW:
                del a[0]
            last_seen[sym] = i
            day_extra[sym] = (dte, oi)
        del day
        rankable += 1
        latest_idx, latest_extra, latest_rows, latest_no_iv = i, day_extra, day_rows, day_no_iv
    out = {**base, "status": "ok", "logging_began": sessions[0], "sessions_logged": len(sessions),
           "rankable_sessions": rankable, "legacy_sessions": legacy, "unread_sessions": unread,
           "missing_sessions": _missing(sessions, now)}
    if latest_idx is None:
        return {**out, "session": None, "counts": _counts(), "high": [], "low": []}
    ranked, below, flat, stale = [], 0, 0, 0
    for sym, a in series.items():
        if last_seen[sym] != latest_idx:
            stale += 1
            continue
        if len(a) < iv_history.RANK_MIN_SESSIONS:
            below += 1
            continue
        r = iv_history.rank_of(list(a))
        if r["iv_rank"] is None:
            flat += 1
            continue
        dte, oi = latest_extra.get(sym, (None, None))
        ranked.append({"symbol": sym, "atm_iv": r["current"], "iv_rank": r["iv_rank"],
                       "iv_percentile": r["iv_percentile"], "rank_word": rank_label(r["iv_rank"]),
                       "low": r["low"], "high": r["high"], "sessions": r["window_sessions"],
                       "atm_dte": dte, "open_interest": oi})
    oi_of = (lambda r: -(r["open_interest"] or 0))
    high = sorted(ranked, key=lambda r: (-r["iv_rank"], -r["iv_percentile"], oi_of(r), r["symbol"]))[:MAX_PER_SIDE]
    low = sorted(ranked, key=lambda r: (r["iv_rank"], r["iv_percentile"], oi_of(r), r["symbol"]))[:MAX_PER_SIDE]
    return {**out, "session": sessions[latest_idx],
            "counts": _counts(ranked=len(ranked), below_min=below, flat=flat, not_in_latest=stale,
                              latest_rows=latest_rows, latest_no_atm_iv=latest_no_iv, symbols_logged=len(series)),
            "high": high, "low": low}


def _counts(**kw) -> dict:
    keys = ("ranked", "below_min", "flat", "not_in_latest", "latest_rows", "latest_no_atm_iv", "symbols_logged")
    return {k: int(kw.get(k, 0)) for k in keys}


def _missing(sessions: list, now: Optional[datetime]) -> list:
    """The trading sessions since the log began that it does not hold (iv_history's own rule)."""
    try:
        have = set(sessions)
        return [d for d in iv_history.expected_sessions(sessions[0], now) if d not in have]
    except Exception:  # noqa: BLE001 -- past the calendar's horizon: no list, never a guess
        return []


# ── the held answer ─────────────────────────────────────────────────────────────────────────────

_lock = threading.Lock()
_state: dict[str, Any] = {"held": None, "last_run": None, "loaded": False, "inflight": None}


def _disk_path() -> Optional[str]:
    base = os.environ.get("DATA_DIR", "/data")
    return os.path.join(base, DISK_DIR, DISK_FILE) if os.path.isdir(base) else None


def _save_disk(held: Optional[dict], last_run: Optional[dict]) -> None:
    path = _disk_path()
    if not path:
        return
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".leaders_", suffix=".tmp", dir=os.path.dirname(path))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump({"v": DISK_VERSION, "held": held, "last_run": last_run}, fh, separators=(",", ":"))
            os.replace(tmp, path)
        except Exception:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise
    except Exception as exc:  # noqa: BLE001 -- the answer is still held in memory
        _log.warning("[iv-rank-leaders] the answer could not be written to disk (%s)", type(exc).__name__)


def _valid(held: Any) -> bool:
    return (isinstance(held, dict) and held.get("v") == DISK_VERSION and held.get("status") in ("ok", "no_log")
            and isinstance(held.get("high"), list) and isinstance(held.get("low"), list)
            and isinstance(held.get("counts"), dict))


def _load_disk() -> tuple[Optional[dict], Optional[dict]]:
    path = _disk_path()
    if not path:
        return None, None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return None, None
    if not isinstance(doc, dict) or doc.get("v") != DISK_VERSION:
        return None, None
    held = doc.get("held") if _valid(doc.get("held")) else None
    last = doc.get("last_run") if isinstance(doc.get("last_run"), dict) else None
    return held, last


def _ensure_loaded() -> None:
    with _lock:
        if _state["loaded"]:
            return
    held, last = _load_disk()
    with _lock:
        if not _state["loaded"]:
            _state["loaded"] = True
            if _state["held"] is None and held is not None:
                _state["held"] = held
            if _state["last_run"] is None and last is not None:
                _state["last_run"] = last


def _run(done: threading.Event, now: Optional[datetime]) -> None:
    started = time.time()
    try:
        _ensure_loaded()
        try:
            held = build(now=now)
        except Exception as exc:  # noqa: BLE001 -- a failed build is said; the last good list stays held
            last = {"at": _now_iso(), "ok": False, "reason": type(exc).__name__}
            with _lock:
                _state["last_run"] = last
                keep = _state["held"]
            _save_disk(keep, last)
            _log.warning("[iv-rank-leaders] build failed (%s); the last good list is kept", type(exc).__name__)
            return
        last = {"at": _now_iso(), "ok": True, "reason": None}
        with _lock:
            _state["held"], _state["last_run"] = held, last
        _save_disk(held, last)
        c = held.get("counts") or {}
        _log.info("[iv-rank-leaders] session=%s sessions=%s ranked=%s below_min=%s flat=%s not_in_latest=%s %.1fs",
                  held.get("session"), held.get("sessions_logged"), c.get("ranked"), c.get("below_min"),
                  c.get("flat"), c.get("not_in_latest"), time.time() - started)
    finally:
        with _lock:
            _state["inflight"] = None
        done.set()


def run_scheduled(now: Optional[datetime] = None) -> dict:
    """THE SCHEDULED ENTRY (`api/main.py`, daily at RUN_AT_ET): start one build on its own thread,
    unless the option screener is switched off, the quiet span is over, or one is running. Returns
    at once."""
    from api.services.research import options_screener
    if not options_screener.is_enabled():
        return {"started": False, "reason": "off"}
    now = now or now_et()
    if not quiet(now):
        return {"started": False, "reason": "not_quiet"}
    with _lock:
        if _state["inflight"] is not None:
            return {"started": False, "reason": "running"}
        done = _state["inflight"] = threading.Event()
    threading.Thread(target=_run, args=(done, now), daemon=True, name="iv-rank-leaders").start()
    return {"started": True}


def get_leaders(now: Optional[datetime] = None) -> dict:
    """THE REQUEST PATH (`GET /api/options-screener/iv-rank`): only what is held, never a read of the log.

    status: 'ok' | 'no_log' (the log held no session at the last build) | 'not_built' (no evening has
            built it yet: `building`, `next_run`, and `last_run` when a build failed)
    ok:     session (the newest session read), built_at, logging_began, sessions_logged, rankable_sessions,
            legacy_sessions, unread_sessions, missing_sessions, counts {ranked, below_min, flat,
            not_in_latest, latest_rows, latest_no_atm_iv, symbols_logged}, high / low [{symbol, atm_iv,
            iv_rank, iv_percentile, rank_word, low, high, sessions, atm_dte, open_interest}] (at most
            max_per_side each), source, method, high_order, low_order, rank_min_sessions, rank_window
    """
    _ensure_loaded()
    with _lock:
        held, last, building = _state["held"], _state["last_run"], _state["inflight"] is not None
    upcoming = next_run(now).isoformat(timespec="minutes")
    if held is None:
        return {"status": "not_built", "building": building, "next_run": upcoming, "last_run": last,
                "source": SOURCE, "method": RANK_METHOD, "rank_min_sessions": iv_history.RANK_MIN_SESSIONS,
                "max_per_side": MAX_PER_SIDE}
    return {**{k: v for k, v in held.items() if k != "v"}, "building": building, "next_run": upcoming,
            "last_run": last}


def drain(timeout: float = 5.0) -> None:
    """Tests: wait for the build in flight, if any."""
    with _lock:
        done = _state["inflight"]
    if done is not None:
        done.wait(timeout)


def reset_for_tests() -> None:
    """Tests only: forget everything this module holds."""
    with _lock:
        _state.update({"held": None, "last_run": None, "loaded": False, "inflight": None})
