"""MKTH, the Terminal's market history: every correction and bear market of the S&P 500 and the
Nasdaq-100, the rally after each low, and the stocks that led each rally.

WHERE THE NUMBERS COME FROM (all already stored on this server; NOTHING HERE ASKS A VENDOR):

  indexes   the index store `api/index_bars.py` keeps for SPX (the S&P 500) and NDX (the
            Nasdaq-100): its daily series, read from this process's memory copy or its disk
            snapshot (`<DATA_DIR>/index_bars_cache/<SYM>_D.json`) ONLY. Never `fetch_index_bars`,
            which fetches on a cold miss. The store reaches back to `INDEX_DAILY_HISTORY_START`
            (1990-01-01) unless `INDEX_FMP_LOOKBACK_DAYS` shortens it; the answer says the first
            close it actually had. The store holds no Nasdaq Composite: the Nasdaq-100 is the
            closest index it holds, and the answer names it as such.
  stocks    `price_reads.daily_closes`, the read-only `/api/bars-history` read (split-adjusted,
            not dividend-adjusted) for every symbol of the site's stock universe
            (`cap_universe.symbols()`, less the ETFs it lists): one symbol at a time, each read once
            for every window.
  sectors   the sector map PCHG and GRP read (`scan_period._sector_industry_map`).
  calendar  the index's own closes are the sessions; calendar months for the rally windows
            (`session_calendar.add_months`).

THE DEFINITIONS are in `market_history_calc` (pure, tested on invented series).

HOW OFTEN (the house pattern of `scan_period` and `fed_watch`): a request NEVER builds. It answers at
once from what this module holds. ONE background build runs at a time, whatever the number of
members, when the held answer is older than the newest session's evening (`REBUILD_AT_ET`, 20:15
New York time on a trading day, when `scan_period`'s quiet span begins and the evening jobs are
done): so at most once each evening, and only when someone asks. With
nothing held the request waits up to `WAIT_S` for the build's first stage (the two indexes, under a
second) and otherwise says `computing`. The build's second stage (the leaders: one read per stock)
runs on after it; until it ends the leaders say `computing` and the panel asks again.

The answer is held in this module AND on disk (`<DATA_DIR>/market_history/`), so a restart serves the
last answer at once and rebuilds only when it is due. Never the shared cache.

BOUNDS: the universe read is capped at `MAX_SYMBOLS`; the build sleeps after every stock so the
request threads keep the interpreter (`YIELD_S` in the quiet span, `YIELD_BUSY_S` when a first build
with nothing held lands in the trading day's busy span); each stock's closes are dropped as soon as
its few needed closes are taken (memory holds a float per stock per window, never a series).
MEASURED (2026-11-21, a bounded invented sample on the dev PC, not production): the shared per-stock
read costs about 80 ms of CPU for about 6,000 daily rows (the SQLite read about 28 ms, the serve-time
split heal and format about 33 ms), so a full universe of about 3,500 stocks is about 5 minutes of one
core, once each evening; the build's own Python memory stays in the tens of MB.
"""
from __future__ import annotations

import copy
import json
import logging
import os
import tempfile
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Optional
from zoneinfo import ZoneInfo

from api.services import market_history_calc as C

_log = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")

#: (store symbol, plain name) in the order the panel offers them
INDEXES = (("SPX", "S&P 500"), ("NDX", "Nasdaq-100"))
INDEX_SOURCE = "UCT's stored daily closes of the index"
STOCK_SOURCE = "UCT's stored daily stock closes (split-adjusted, price only)"
UNIVERSE_NAME = "UCT's stock universe ($300M market value and up), less the funds it lists"
INDEX_NOTE = ("The Nasdaq Composite is not in UCT's index history; the Nasdaq-100 is the closest index it holds.")

# ── defaults (each one is the builder's, not an owner ruling) ────────────────────────────────
REBUILD_AT_ET = (20, 15)        # the evening a trading day's closes are rebuilt from (scan_period's quiet span)
QUIET_HOURS_ET = (7 * 60, 20 * 60 + 15)   # minutes: a weekday between these is busy (scan_period._reuse_quiet_now)
WAIT_S = 3.0                    # the longest a request waits for the first stage of a build it started
FAIL_RETRY_S = 600.0            # a failed build waits this long before another is started
NOT_HELD_RETRY_S = 600.0        # an index store with nothing in it is looked at again after this
LAG_RETRY_S = 3600.0            # an evening build whose closes stop short of that session tries again after this
LAG_TRIES = 3                   # and at most this many times for one evening
YIELD_S = 0.002                 # the build sleeps this long after every stock it reads, in the quiet span
YIELD_BUSY_S = 0.05             # and this long in the busy span (a first build with nothing held)
MAX_SYMBOLS = 8000              # the universe read never exceeds this many symbols
SETTLED_AFTER_CLOSE_S = 30 * 60  # a daily index row for today stored earlier than this after the close is unfinished
DISK_VERSION = 1

_lock = threading.Lock()


def _blank_state() -> dict:
    return {
        "answer": None,       # the last answer, complete or first-stage
        "built_for": None,    # the evening (session date, ISO) the last COMPLETE answer was built for
        "built_at": 0.0,      # unix s the last complete answer finished
        "retry_at": 0.0,      # no build is started before this
        "inflight": None,     # the running build's done event
        "first_stage": None,  # set once the running build has published its first stage (or ended)
        "lag": None,          # (evening, tries) while the closes stop short of the evening they were built for
        "loaded": False,
        "last_build": None,   # {started, seconds, outcome, symbols_read, ...} for the log and the debug read
    }


_state: dict = _blank_state()


# ── the clock ────────────────────────────────────────────────────────────────────────────────

def now_et() -> datetime:
    return datetime.now(ET)


def quiet(now: datetime) -> bool:
    """Pure: weekends, and weekdays before 07:00 or from 20:15 New York time (the span
    `scan_period._reuse_quiet_now` keeps whole-universe work to)."""
    now = now.astimezone(ET)
    if now.weekday() >= 5:
        return True
    hm = now.hour * 60 + now.minute
    return hm < QUIET_HOURS_ET[0] or hm >= QUIET_HOURS_ET[1]


def evening_key(now: datetime) -> str:
    """Pure: the newest trading session whose evening (`REBUILD_AT_ET`) has begun at `now` (ET),
    as an ISO date. A held answer built for an earlier evening is due for a rebuild."""
    from api.services.session_calendar import is_trading_day
    now = now.astimezone(ET)
    d = now.date()
    at = now.replace(hour=REBUILD_AT_ET[0], minute=REBUILD_AT_ET[1], second=0, microsecond=0)
    if not (is_trading_day(d) and now >= at):
        d -= timedelta(days=1)
        while not is_trading_day(d):
            d -= timedelta(days=1)
    return d.isoformat()


# ── the reads (each indirected so tests replace it) ─────────────────────────────────────────

def _index_entry(sym: str) -> Optional[dict]:
    """The index store's held daily entry `{saved_at, series}` for `sym`: this process's memory
    copy, then the disk snapshot. NEVER a provider call and never a refresh kick (`fetch_index_bars`
    and `_peek_entry` can do either)."""
    from api import index_bars
    from api.services.cache import cache
    entry = cache.get(f"idxbars_{sym}_D")
    if entry and entry.get("series"):
        return entry
    entry = index_bars._load_disk(sym, "D")
    return entry if entry and entry.get("series") else None


def _stock_closes(sym: str) -> dict:
    from api.services.market_intel import price_reads
    return price_reads.daily_closes(sym)


def _universe() -> list[str]:
    from api.services import cap_universe
    return sorted(cap_universe.symbols() - cap_universe.etf_symbols())


def _sectors() -> dict:
    """{symbol: sector} from the sector map PCHG and GRP read; {} when it cannot be read."""
    try:
        from api.services.scan_period import _sector_industry_map
        return {s: (v or {}).get("sector") for s, v in (_sector_industry_map() or {}).items() if (v or {}).get("sector")}
    except Exception:  # noqa: BLE001 -- a missing sector map is a missing column, said in the answer
        return {}


def _settled(series_closes: list, saved_at: float, now: datetime) -> list:
    """Drop a row for today (ET) that the store read before today's session had settled: a daily
    copy refreshed mid-session holds a snapshot of an unfinished day, not its close."""
    if not series_closes:
        return series_closes
    from api.services.session_calendar import close_time
    today = now.astimezone(ET).date().isoformat()
    if series_closes[-1][0] != today:
        return series_closes
    close = close_time(now.astimezone(ET).date())
    if close is None or saved_at < close.timestamp() + SETTLED_AFTER_CLOSE_S:
        return series_closes[:-1]
    return series_closes


def index_closes(sym: str, now: datetime) -> dict:
    """`{state: 'ok', closes, first, last}` from the held index series, or `{state: 'not_held'}`."""
    try:
        entry = _index_entry(sym)
    except Exception:  # noqa: BLE001
        entry = None
    rows = []
    for bar in (entry or {}).get("series") or []:
        try:
            d = datetime.fromtimestamp(int(bar["t"]), tz=timezone.utc).date().isoformat()
            rows.append((d, float(bar["c"])))
        except (KeyError, TypeError, ValueError, OverflowError, OSError):
            continue
    closes = _settled(C.clean_closes(rows), float((entry or {}).get("saved_at") or 0.0), now)
    if len(closes) < 2:
        return {"state": "not_held"}
    return {"state": "ok", "closes": closes, "first": closes[0][0], "last": closes[-1][0]}


# ── the build ────────────────────────────────────────────────────────────────────────────────

def _definition() -> dict:
    return {
        "correction_min_pct": round(C.CORRECTION_MIN * 100), "bear_min_pct": round(C.BEAR_MIN * 100),
        "rally_months": list(C.RALLY_MONTHS), "leader_sessions": C.LEADER_SESSIONS,
        "leaders_top": C.LEADERS_TOP, "leaders_min_stocks": C.LEADERS_MIN_STOCKS,
        "text": ("A decline counts from a closing high to the lowest close before that high is regained: 10% to "
                 "20% is a correction, 20% or more a bear market. A new high starts only once the old one is "
                 "regained, so a double bottom is one decline. Sessions are the index's closing days."),
    }


def build_indexes(now: datetime) -> tuple[dict, dict]:
    """First stage: `({SYM: index block}, {SYM: closes})`. Under a second for both indexes."""
    blocks, closes = {}, {}
    for sym, name in INDEXES:
        got = index_closes(sym, now)
        if got["state"] != "ok":
            blocks[sym] = {"symbol": sym, "name": name, "state": "not_held", "source": INDEX_SOURCE,
                           "detail": f"UCT does not hold the {name}'s daily closes on this server yet."}
            continue
        eps = C.describe_episodes(got["closes"], sym)
        blocks[sym] = {"symbol": sym, "name": name, "state": "ok", "source": INDEX_SOURCE,
                       "first": got["first"], "last": got["last"], "closes": len(got["closes"]),
                       "summary": C.summarize(eps, got["first"]), "episodes": eps}
        closes[sym] = got["closes"]
    return blocks, closes


def build_leaders(blocks: dict, closes: dict, *, read: Optional[Callable[[str], dict]] = None,
                  symbols: Optional[list] = None, sectors: Optional[dict] = None,
                  pause: Callable[[float], None] = time.sleep, yield_s: Optional[float] = None) -> dict:
    """Second stage: reads every stock ONCE and gives each episode its `leaders` block (in place).
    Returns the answer's top-level leaders record. `yield_s` is the sleep after each stock (default
    `YIELD_S`)."""
    read = read or _stock_closes
    yield_s = YIELD_S if yield_s is None else yield_s
    symbols = list(symbols if symbols is not None else _universe())[:MAX_SYMBOLS]
    sectors = sectors if sectors is not None else _sectors()
    started = time.time()

    windows: dict[tuple[str, str], C.WindowTally] = {}
    per_episode: list[tuple[dict, str, dict]] = []      # (episode, index symbol, its window)
    for sym, block in blocks.items():
        for ep in block.get("episodes") or []:
            w = C.leader_window(closes[sym], ep["trough"]["date"])
            per_episode.append((ep, sym, w))
            if w["end"]:
                key = (w["trough"], w["end"])
                if key not in windows:
                    windows[key] = C.WindowTally(*key)

    read_ok = not_held = 0
    store_first: Optional[str] = None
    for i, s in enumerate(symbols):
        try:
            got = read(s)
        except Exception:  # noqa: BLE001 -- one symbol never stops the list
            got = None
        if not got or got.get("status") != "ok":
            not_held += 1
        else:
            read_ok += 1
            first = got.get("first")
            if first and (store_first is None or first < store_first):
                store_first = first
            if windows:
                by_date = dict(got.get("closes") or ())
                jumps = got.get("suspect_jumps") or ()
                for tally in windows.values():
                    tally.add(s, by_date, jumps)
                del by_date
        if yield_s > 0:
            pause(yield_s)

    for ep, sym, w in per_episode:
        if not w["end"]:
            ep["leaders"] = {"state": "not_yet", "trough": w["trough"], "end": None,
                             "sessions_so_far": w["sessions_so_far"], "needed": C.LEADER_SESSIONS,
                             "note": C.SURVIVORSHIP_NOTE}
            continue
        res = windows[(w["trough"], w["end"])].result(w["index_return_pct"], sectors)
        ep["leaders"] = {**res, "index": sym, "note": C.SURVIVORSHIP_NOTE}

    return {"state": "ok", "source": STOCK_SOURCE, "universe": UNIVERSE_NAME, "symbols": len(symbols),
            "read": read_ok, "not_held": not_held, "store_first": store_first, "sectors_held": bool(sectors),
            "note": C.SURVIVORSHIP_NOTE, "seconds": round(time.time() - started, 1)}


def _assemble(blocks: dict, leaders: dict, built_for: str, now: datetime) -> dict:
    lasts = [b["last"] for b in blocks.values() if b.get("state") == "ok"]
    return {
        "status": "ok" if lasts else "unavailable",
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "built_for": built_for,
        "data_through": min(lasts) if lasts else None,
        "definition": _definition(),
        "index_note": INDEX_NOTE,
        "indexes": blocks,
        "leaders": leaders,
    }


def build(now: Optional[datetime] = None, first_stage: Optional[threading.Event] = None) -> str:
    """The whole build on the calling (background) thread. Publishes the first stage at once when
    nothing is held, the complete answer at the end, and writes the disk copy. Returns the log text."""
    now = now or now_et()
    key = evening_key(now)
    blocks, closes = build_indexes(now)
    if not closes:
        answer = _assemble(blocks, {"state": "unavailable", "note": C.SURVIVORSHIP_NOTE}, key, now)
        with _lock:
            if _state["answer"] is None or _state["answer"].get("status") != "ok":
                _state["answer"] = answer
            _state["retry_at"] = time.time() + NOT_HELD_RETRY_S
        return "indexes not held"
    # The first stage is published as a COPY: the second stage adds each episode's leaders to `blocks`
    # in place, and a request may be serializing the first-stage answer at that moment.
    first = _assemble(copy.deepcopy(blocks), {"state": "computing", "note": C.SURVIVORSHIP_NOTE}, key, now)
    with _lock:
        if _state["answer"] is None or _state["answer"].get("status") != "ok":
            _state["answer"] = first
    if first_stage is not None:
        first_stage.set()
    leaders = build_leaders(blocks, closes, yield_s=YIELD_S if quiet(now) else YIELD_BUSY_S)
    answer = _assemble(blocks, leaders, key, now)
    with _lock:
        _state["answer"] = answer
        _state["built_for"] = key
        _state["built_at"] = time.time()
        if answer["data_through"] and answer["data_through"] < key:
            prev = _state["lag"]
            tries = prev[1] + 1 if prev and prev[0] == key else 1
            _state["lag"] = (key, tries)
            _state["retry_at"] = time.time() + LAG_RETRY_S
        else:
            _state["lag"] = None
    _save_disk()
    eps = sum(len(b.get("episodes") or []) for b in blocks.values())
    return (f"episodes={eps} symbols={leaders['symbols']} read={leaders['read']} "
            f"not_held={leaders['not_held']} store_first={leaders['store_first']} leaders_s={leaders['seconds']}")


def _build_bg(done: threading.Event, first_stage: threading.Event) -> None:
    started = time.time()
    said, level = "failed", logging.WARNING
    try:
        said = build(first_stage=first_stage)
        level = logging.INFO
    except Exception as exc:  # noqa: BLE001 -- a failed build is said and retried later, never "computing" for ever
        said = f"failed ({type(exc).__name__})"
        with _lock:
            _state["retry_at"] = time.time() + FAIL_RETRY_S
            held = _state["answer"]
            if held is None:
                _state["answer"] = {"status": "unavailable", "reason": "failed",
                                    "detail": "Market history could not be worked out just now."}
            elif (held.get("leaders") or {}).get("state") == "computing":
                # the first stage stands; its leaders say they failed, never "computing" until the retry
                _state["answer"] = {**held, "leaders": {"state": "failed", "note": C.SURVIVORSHIP_NOTE}}
    finally:
        secs = round(time.time() - started, 1)
        with _lock:
            _state["last_build"] = {"started": started, "seconds": secs, "outcome": said}
            _state["inflight"] = None
            _state["first_stage"] = None
        _log.log(level, "[market-history] %s; %.1fs", said, secs)
        first_stage.set()
        done.set()


def _start_job() -> tuple[threading.Event, threading.Event]:
    with _lock:
        done = _state["inflight"]
        if done is None:
            done = _state["inflight"] = threading.Event()
            first = _state["first_stage"] = threading.Event()
            threading.Thread(target=_build_bg, args=(done, first), daemon=True, name="market-history-build").start()
        return done, _state["first_stage"]


def refresh_due(now: Optional[datetime] = None, at: Optional[float] = None) -> bool:
    """True when nothing is running, no retry wait is on, and either the held answer is older than
    the newest session's evening or its closes stopped short of that evening (tried again
    `LAG_TRIES` times at most, `LAG_RETRY_S` apart). Pure over the module's state."""
    now = now or now_et()
    at = time.time() if at is None else at
    with _lock:
        if _state["inflight"] is not None or at < _state["retry_at"]:
            return False
        if _state["answer"] is None or _state["answer"].get("status") != "ok":
            return True
        built_for, lag = _state["built_for"], _state["lag"]
    key = evening_key(now)
    if built_for is None or built_for < key:
        return True
    return bool(lag and lag[0] == key and lag[1] < LAG_TRIES)


# ── disk ─────────────────────────────────────────────────────────────────────────────────────

def _disk_path() -> Optional[str]:
    base = os.environ.get("DATA_DIR", "/data")
    return os.path.join(base, "market_history", f"market_history_v{DISK_VERSION}.json") if os.path.isdir(base) else None


def _save_disk() -> None:
    path = _disk_path()
    if not path:
        return
    with _lock:
        doc = {"v": DISK_VERSION, "answer": _state["answer"], "built_for": _state["built_for"], "built_at": _state["built_at"]}
    try:
        blob = json.dumps(doc, separators=(",", ":"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".market_history_", suffix=".tmp", dir=os.path.dirname(path))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(blob)
            os.replace(tmp, path)
        except Exception:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise
    except Exception as exc:  # noqa: BLE001 -- the answer is still held in memory
        _log.warning("[market-history] the answer could not be written to disk (%s)", type(exc).__name__)


def _load_disk() -> Optional[dict]:
    path = _disk_path()
    if not path:
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(doc, dict) or doc.get("v") != DISK_VERSION:
        return None
    ans = doc.get("answer")
    if not isinstance(ans, dict) or ans.get("status") != "ok" or not isinstance(ans.get("indexes"), dict):
        return None
    if (ans.get("leaders") or {}).get("state") != "ok":
        return None                                   # a first-stage answer is never kept as if it were whole
    built_for = doc.get("built_for")
    try:
        date.fromisoformat(built_for)
    except (TypeError, ValueError):
        return None
    return {"answer": ans, "built_for": built_for, "built_at": min(float(doc.get("built_at") or 0.0), time.time())}


def _ensure_loaded() -> None:
    with _lock:
        if _state["loaded"]:
            return
    doc = _load_disk()
    with _lock:
        if _state["loaded"]:
            return
        _state["loaded"] = True
        if doc and _state["answer"] is None:
            _state.update(doc)


# ── the reads callers make ───────────────────────────────────────────────────────────────────

def _served(answer: Optional[dict], running: bool) -> dict:
    if answer is None:
        return {"status": "computing"}
    return {**answer, "refreshing": bool(running and (answer.get("leaders") or {}).get("state") == "ok")}


def held_answer() -> tuple[dict, str]:
    """READ ONLY: what this module holds, as `(answer, how)`. It never starts a build. how: 'held' |
    'not_held'."""
    _ensure_loaded()
    with _lock:
        ans = _state["answer"]
    return (_served(ans, False), "held" if ans and ans.get("status") == "ok" else "not_held")


def get_market_history(*, wait_s: Optional[float] = None) -> dict:
    """The market history answer (see the module docstring). NEVER builds on the caller's thread:
    when a rebuild is due it starts the one background build and answers at once from what is held;
    with nothing held it waits up to `WAIT_S` for the build's first stage."""
    _ensure_loaded()
    if refresh_due():
        _done, first = _start_job()
        with _lock:
            empty = _state["answer"] is None
        if empty and first is not None:
            first.wait(WAIT_S if wait_s is None else wait_s)
    with _lock:
        return _served(_state["answer"], _state["inflight"] is not None)


def last_build() -> Optional[dict]:
    with _lock:
        return dict(_state["last_build"]) if _state["last_build"] else None


def reset_for_tests() -> None:
    """Tests only: forget everything this module holds."""
    with _lock:
        _state.clear()
        _state.update(_blank_state())
