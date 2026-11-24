"""SETH, the Terminal's "how setups acted": a fixed library of chart setups (breakouts, pullbacks, gaps,
reclaims, tight weeks, pocket pivots) and how each one did in every S&P 500 correction, in the first
months after each low and later in each uptrend; and, for one stock, every time each setup fired on it.

WHERE THE NUMBERS COME FROM (all already stored on this server; NOTHING HERE ASKS A VENDOR):

  stocks    `price_reads.daily_bars`, STAT's read: one read of a stock's stored daily bars through the
            read-only loader `/api/bars-history` serves (split-adjusted by the serve-time heal, not
            dividend-adjusted), for every symbol of the site's stock universe (`cap_universe`, less the
            funds it lists), ONE STOCK AT A TIME.
  phases    MKTH's held answer (`market_history.get_market_history`): its S&P 500 declines of 10% or
            more. No second correction finder.
  the maths `setup_history_calc` (pure), which calls the screen backtester (`screener/backtest.py`)
            and the Screener's evaluator (`ast_interpret.interpret`) for every number.

HOW OFTEN (the house pattern of `market_history` and `scan_period`): a request NEVER builds. The universe
study is built ONCE A WEEK: from Saturday (New York time) the first request finds the held answer due and
starts the ONE background build (`held_build.HeldBuild`), answering at once from what it holds. A build
starts only inside `scan_period`'s quiet span (weekends, and weekdays from 20:15 to 07:00 New York time)
with at least `BUILD_MARGIN_S` of it left; with nothing held outside that span the answer is `waiting`
(never a build in the trading day). The answer is held in this module and on disk
(`<DATA_DIR>/setup_history/`), so a restart serves the last one at once. Never the shared cache.

BOUNDS: one stock's bars at a time, dropped before the next is read (`_scan_one` returns nothing that
holds them; `tests/test_setup_history.py` fails if two are alive at once); the build sleeps after every
stock (`YIELD_S`, or `YIELD_BUSY_S` should a build run on past the quiet span); the universe read is capped
at `MAX_SYMBOLS`; each setup stores at most `MAX_SIGNALS_PER_SETUP` signals (past it that setup's
numbers are withheld, never cut). The history read is the newest `read_sessions()` sessions of each
stock (`HISTORY_YEARS` years plus the longest warm-up): see MEASURED.

ONE STOCK (`get_stock`): every signal of every setup on that stock over its whole held history, newest
first, worked out on a background thread on the first request of the session (`held_reads.KeyedHeld`,
at most `STOCK_SLOTS` at once, `STOCK_KEYS` held), with the universe line for each setup and phase
attached at read time from the held study.

MEASURED (2026-11-22, the dev PC under other work, 40 invented stocks through the REAL read and the REAL
study, extrapolated to 3,512 stocks; not production): the evaluator is the cost. Seven screens cost about
0.28 ms of CPU per stored bar of a stock plus about 50 ms per stock (the read about 21 ms of that for 1,059
bars). So: the whole held history (about 6,400 bars a stock) about 2.4 hours of one core; 10 years (2,900
bars read) about 54 minutes; 4 years about 26; 3 years (1,059 bars read) about 21 minutes, plus about 15 s
for the summaries. The WINDOW (`HISTORY_YEARS`, see WINDOW below) is what is cut, never the universe. Memory: the build's own peak Python allocation was 6.0 MB for 40
stocks (one stock's bars at a time, the per-day cells, a 29-byte record per signal); at 3,512 stocks about
460,000 signals, so about 20 MB held and about 35 MB at the peak while the summaries sort the largest group,
well under the 150 MB budget beside the web process.

THE READY ANSWER IS PUT TOGETHER ONCE (speed pass 3, 2026-11-24; live, a held stock still took 0.78 s): the stock's
answer with its universe lines (`universe_lines` over the held study) is kept per stock key (`_served`) while the same
stock answer and the same study build are held, with its bytes (`held_bytes`); the stock's background build prepares it
when a study is held, so the request neither walks the study nor turns 60 KB into JSON on the event loop. Same answer.

WINDOW, set by the integrator (2026-11-22): 8 years, not the 3 the builder measured against a 20-minute bound.
The owner asked how setups acted in other corrections and rallies; 3 years held only a couple, 8 years hold
the 2018 fourth-quarter decline's end, the 2020 crash, the 2022 bear market and the 2025 decline. The cost is
about 42 minutes of one core once a week in the quiet span (2,370 bars read a stock), about 1.2 million
signals (about 36 MB held, under 60 MB at the summaries' peak, inside the 150 MB budget; the largest setup,
the pocket pivot, about 400,000, under `MAX_SIGNALS_PER_SETUP`), so `BUILD_MARGIN_S` is 90 minutes. The
phase rows rest on the corrections inside those 8 years, and every row says how many signals it rests on.
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from collections import OrderedDict
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Optional

from api.services import held_build, held_bytes, held_reads
from api.services import setup_history_calc as C
from api.services.screener import backtest as bt

_log = logging.getLogger(__name__)

SOURCE = "UCT's stored daily prices (split-adjusted, price only)"
UNIVERSE_NAME = "UCT's stock universe ($300M market value and up), less the funds it lists"
INDEX_KEY = "SPX"
INDEX_NAME = "S&P 500"

# ── defaults (each one is the builder's, not an owner ruling) ────────────────────────────────
HISTORY_YEARS = 8               # the study's window: the newest 8 years (integrator, 2026-11-22; see MEASURED)
MAX_SYMBOLS = 8000              # the universe read never exceeds this many symbols (MKTH's cap)
MAX_SIGNALS_PER_SETUP = 600_000  # signals one setup may store (about 17 MB); past it its numbers are withheld
YIELD_S = 0.005                 # the build sleeps this long after every stock, in the quiet span
YIELD_BUSY_S = 0.05             # and this long should it run on past the quiet span
BUILD_MARGIN_S = 90 * 60        # a build starts only with at least this much of the quiet span left
MKTH_WAIT_S = 5.0               # the longest the build waits for MKTH's first stage (the index declines)
NOT_HELD_RETRY_S = 1800.0       # with no index declines held, the build is tried again after this
STOCK_SLOTS = 2                 # one-stock reads worked out at once, whatever the number of members
STOCK_SLOT_WAIT_S = 20.0        # a one-stock build waits this long for a slot, then says busy
STOCK_KEYS = 128                # one-stock answers held (least recently asked dropped first)
# The longest a request waits for its one-stock build, then `computing`. NONE (speed pass 2026-11-23): live, a
# cold stock waited the full 3 seconds and then said `computing` anyway; the panel asks again every 3 seconds.
STOCK_WAIT_S = 0.0
STOCK_MAX_ROWS = 300            # signals one stock's answer lists (the newest; the cut is said)
LAG_RECHECK_S = 1800.0          # a stock whose bars stop short of the session is read again after this
DISK = ("setup_history", "setup_history_v1.json")
DISK_VERSION = 1

#: what one build cost on invented bars (the dev PC, not production); see the module docstring
MEASURED = ("dev PC, invented bars: about 0.28 ms of CPU per stored bar per stock for the seven setups plus "
            "about 50 ms per stock; 8 years (about 2,370 bars read) is about 42 minutes of one core for 3,512 stocks")

HINDSIGHT = ("The market phase is assigned with hindsight: a decline is known to be a correction, and its low "
             "the low, only after the fact. Each signal uses only the bars up to its own day; the phase label "
             "does not. Read a phase row as how the setup did in what turned out to be a correction, never as "
             "something a trader could have known on the day.")
ONE_PER_RUN = ("One signal per run: a setup true on several sessions in a row counts once, on the first session "
               "of the run. A run whose start the history cannot see (the session before is warm-up or a gap) "
               "is not counted.")
OBSERVATIONS = ("One observation per run. Runs close together still overlap their forward windows, so nearby "
                "observations are correlated and the count overstates independent evidence.")

_building = threading.Event()


# ── the clock (MKTH's) ───────────────────────────────────────────────────────────────────────

def now_et() -> datetime:
    from api.services import market_history
    return market_history.now_et()


def evening_key(now: datetime) -> str:
    from api.services import market_history
    return market_history.evening_key(now)


def quiet(now: datetime) -> bool:
    from api.services import market_history
    return market_history.quiet(now)


def week_key(now: datetime) -> str:
    """Pure: the newest Saturday (New York date) on or before `now`. A study built for an earlier
    Saturday is due for a rebuild."""
    from api.services.market_history import ET
    d = now.astimezone(ET).date()
    return (d - timedelta(days=(d.weekday() - 5) % 7)).isoformat()


def build_window_open(now: datetime) -> bool:
    """Pure: a build may start now (inside the quiet span, with `BUILD_MARGIN_S` of it left)."""
    return quiet(now) and quiet(now + timedelta(seconds=BUILD_MARGIN_S))


def window_start(key: str, years: Optional[int] = None) -> str:
    """The first day of the study's window: the same calendar day `years` years before `key`."""
    from api.services.session_calendar import add_months
    years = HISTORY_YEARS if years is None else years
    return add_months(date.fromisoformat(key), -12 * years).isoformat()


def read_sessions(years: Optional[int] = None) -> int:
    """How many of a stock's newest daily bars the study reads: the window (a generous 262 sessions a
    year) plus the longest warm-up of any setup plus slack. A bar older than the window is warm-up."""
    years = HISTORY_YEARS if years is None else years
    return years * 262 + max(s.warmup for s in C.LIBRARY) + 20


def library_version() -> str:
    """A fingerprint of what the study means (the trees, the horizons, the window, the floor): a held
    answer built under another is not served as if it were this one."""
    doc = json.dumps({"setups": [[s.id, s.tree] for s in C.LIBRARY], "horizons": list(C.HORIZONS),
                      "years": HISTORY_YEARS, "min": C.MIN_SIGNALS, "after_low_months": C.AFTER_LOW_MONTHS},
                     sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(doc.encode("utf-8")).hexdigest()[:16]


# ── the reads (each indirected so tests replace it) ─────────────────────────────────────────

def _read_bars(sym: str, max_bars: Optional[int] = None) -> dict:
    from api.services.market_intel import price_reads
    return price_reads.daily_bars(sym, max_bars=max_bars)


def _universe() -> list:
    from api.services import cap_universe
    return sorted(cap_universe.symbols() - cap_universe.etf_symbols())


def _market(wait_s: float) -> dict:
    """MKTH's answer (it starts its own one background build only when that is due)."""
    from api.services import market_history
    return market_history.get_market_history(wait_s=wait_s)


def bar_dicts(rows, key: str) -> list:
    """`price_reads.daily_bars` rows `(day, open, high, low, close, volume)` up to session `key`, as the
    bar dicts the evaluator reads. A missing volume stays None (a hole for a setup that reads volume)."""
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows or () if r and r[0] <= key]


def phase_source(market: dict) -> Optional[dict]:
    """`{map: PhaseMap, info}` from MKTH's answer, or None when it holds no S&P 500 declines."""
    if not isinstance(market, dict) or market.get("status") != "ok":
        return None
    block = (market.get("indexes") or {}).get(INDEX_KEY) or {}
    if block.get("state") != "ok":
        return None
    eps = block.get("episodes") or []
    info = {"index": INDEX_NAME, "first": block.get("first"), "last": block.get("last"), "episodes": len(eps),
            "built_at": market.get("built_at"), "definition": (market.get("definition") or {}).get("text"),
            "words": dict(C.PHASE_WORDS), "after_low_months": C.AFTER_LOW_MONTHS, "hindsight": HINDSIGHT}
    return {"map": C.PhaseMap(eps, block.get("first"), block.get("last")), "info": info}


# ── the universe study (part 1) ──────────────────────────────────────────────────────────────

def _scan_one(study: C.Study, sym: str, key: str, max_bars: int) -> str:
    """Read ONE stock, add it to the study, and let its bars go (nothing returned holds them)."""
    try:
        got = _read_bars(sym, max_bars)
    except Exception:  # noqa: BLE001 -- one symbol never stops the build
        return "failed"
    if not isinstance(got, dict) or got.get("status") != "ok":
        return "not_held" if isinstance(got, dict) and got.get("reason") == "no_price_history" else "failed"
    bars = bar_dicts(got.get("bars"), key)
    del got
    if not bars:
        return "not_held"
    study.add(bars)
    return "read"


def build_study(previous: Optional[dict] = None, *, now: Optional[datetime] = None,
                symbols: Optional[list] = None, pause: Callable[[float], None] = time.sleep) -> tuple:
    """The whole study on the calling (background) thread: `(answer, log words)`. Raises
    `held_build.Stop` when MKTH holds no S&P 500 declines (the build is tried again later)."""
    _building.set()
    started, cpu0 = time.time(), time.thread_time()
    try:
        now = now or now_et()
        key, wk = evening_key(now), week_key(now)
        src = phase_source(_market(MKTH_WAIT_S))
        if src is None:
            raise held_build.Stop("unavailable", "index_not_held", hold=NOT_HELD_RETRY_S,
                                  note="the S&P 500 declines are not held yet")
        frm = window_start(key)
        want = read_sessions()
        syms = list(symbols if symbols is not None else _universe())[:MAX_SYMBOLS]
        study = C.Study(src["map"], frm, key, max_signals=MAX_SIGNALS_PER_SETUP)
        tally = {"read": 0, "not_held": 0, "failed": 0}
        for sym in syms:
            tally[_scan_one(study, sym, key, want)] += 1
            pause(YIELD_S if quiet(now_et()) else YIELD_BUSY_S)
        setups = study.result()
        cpu = time.thread_time() - cpu0
        method = bt._method_block(warmup=max(s.warmup for s in C.LIBRARY), min_signals=C.MIN_SIGNALS,
                                  horizons=C.HORIZONS)
        method.update({"observations": OBSERVATIONS, "one_signal_per_run": ONE_PER_RUN, "phase": HINDSIGHT,
                       "window": (f"The newest {HISTORY_YEARS} years of each stock's stored daily bars (signals from "
                                  f"{frm}); older bars are read only as warm-up. Cut from the whole history to keep "
                                  "the weekly build to about 40 minutes of one processor, so the phase rows rest on "
                                  "the corrections inside these years.")})
        universe = bt._universe_block(syms, "current")
        universe.update({"name": UNIVERSE_NAME, "symbols_read": tally["read"], "symbols_not_held": tally["not_held"],
                         "symbols_failed": tally["failed"], "symbols_scanned": study.symbols_scanned})
        answer = {
            "status": "ok",
            "built_for": wk,
            "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "session": key,
            "data_through": study.last_day,
            "library": library_version(),
            "window": {"from": frm, "to": key, "first_day": study.first_day, "years": HISTORY_YEARS},
            "source": SOURCE,
            "universe": universe,
            "method": method,
            "phases": src["info"],
            "horizons": list(C.HORIZONS),
            "min_signals": C.MIN_SIGNALS,
            "setups": setups,
            "dropped": [dict(d) for d in C.DROPPED],
            "build": {"seconds": round(time.time() - started, 1), "cpu_seconds": round(cpu, 1),
                      "signals_stored": study.signal_count()},
        }
        note = (f"symbols={len(syms)} read={tally['read']} not_held={tally['not_held']} failed={tally['failed']} "
                f"signals={study.signal_count()} cpu_s={cpu:.0f}")
        return answer, note
    finally:
        _building.clear()


def _valid_study(answer: dict) -> bool:
    return (isinstance(answer, dict) and answer.get("status") == "ok" and isinstance(answer.get("setups"), list)
            and answer.get("library") == library_version())


def _study_due(answer: dict, checked: float) -> bool:
    now = now_et()
    return (answer.get("built_for") or "") < week_key(now) and build_window_open(now)


_STUDY = held_build.HeldBuild("setup-history", lambda previous: build_study(previous), _study_due,
                              disk=DISK, version=DISK_VERSION, wait_s=0.0, valid=_valid_study)

WAITING_DETAIL = ("The study of every setup is worked out once a week, outside trading hours. The first one starts "
                  "after 20:15 New York time on a weekday, or at any time at the weekend.")


def get_study(now: Optional[datetime] = None) -> dict:
    """The universe study (see the module docstring). NEVER builds on the caller's thread."""
    now = now or now_et()
    if _STUDY.peek() is None and not _building.is_set() and not build_window_open(now):
        return {"status": "waiting", "detail": WAITING_DETAIL}
    ans = _STUDY.get(wait_s=0.0)
    if ans.get("status") == "ok":
        return {**ans, "refreshing": _building.is_set()}
    return ans


def held_study() -> Optional[dict]:
    """READ ONLY: the study held now, or None. Never starts a build."""
    return _STUDY.peek()


# ── one stock (part 2) ───────────────────────────────────────────────────────────────────────

_slots = threading.BoundedSemaphore(STOCK_SLOTS)


def _build_stock(sym: str, session: str) -> dict:
    if not _slots.acquire(timeout=STOCK_SLOT_WAIT_S):
        raise held_build.Stop("failed", "busy", hold=5.0, note=f"{sym}: no build slot")
    try:
        got = _read_bars(sym)
        status = got.get("status") if isinstance(got, dict) else None
        if status != "ok":
            if isinstance(got, dict) and got.get("reason") == "no_price_history":
                return {"status": "not_held", "symbol": sym, "session": session,
                        "detail": f"UCT holds no daily prices for {sym}."}
            raise held_build.Stop("failed", "read_failed", hold=60.0, note=f"{sym}: the read failed")
        bars = bar_dicts(got.get("bars"), session)
        del got
        if not bars:
            return {"status": "not_held", "symbol": sym, "session": session,
                    "detail": f"UCT holds no settled daily prices for {sym} yet."}
        src = phase_source(_market(0.0))
        pm = src["map"] if src else C.PhaseMap((), None, None)
        res = C.stock_signals(bars, pm, bars[0]["t"], session)
        rows = res["signals"]
        return {
            "status": "ok", "symbol": sym, "session": session,
            "first": bars[0]["t"], "data_through": bars[-1]["t"], "sessions": len(bars),
            "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": SOURCE, "horizons": list(C.HORIZONS),
            "phases": ({**src["info"], "state": "ok"} if src else {"state": "not_held", "hindsight": HINDSIGHT}),
            "total": len(rows), "shown": min(len(rows), STOCK_MAX_ROWS), "cut": "oldest" if len(rows) > STOCK_MAX_ROWS else None,
            "signals": rows[:STOCK_MAX_ROWS],
            "setups": res["setups"],
            "library": [{"id": s.id, "name": s.name, "words": s.words} for s in C.LIBRARY],
            "one_signal_per_run": ONE_PER_RUN,
            "fill": "Each return is from the next session's open to the open 5, 20 or 60 sessions after that.",
        }
    finally:
        _slots.release()


def _stock_due(answer: dict, checked: float) -> bool:
    if answer.get("status") == "not_held" or (answer.get("data_through") or "") < (answer.get("session") or ""):
        return time.time() >= checked + LAG_RECHECK_S
    return False


def _stock_builder(key):
    sym, session, _stamp = key

    def build(previous):
        answer = _build_stock(sym, session)
        if answer.get("status") == "ok":
            # what `_STOCK.get` will hand out for it (a build that worked carries no check), put together with the
            # study held now, here on the build thread (`_STUDY.peek` never starts a build)
            _served_answer(key, {**answer, "check": None}, _STUDY.peek())
        return answer, f"{sym} {answer.get('status')} signals={answer.get('total')}"
    return build


_STOCK = held_reads.KeyedHeld("setup-history-stock", _stock_builder, _stock_due, max_keys=STOCK_KEYS,
                              wait_s=STOCK_WAIT_S, valid=lambda a: a.get("status") in ("ok", "not_held"))


def universe_lines(stock: dict, study: dict) -> dict:
    """For each (setup, phase) among the stock's listed signals: how that setup did across the whole
    universe in the same phase (a day with no phase reads the all-days line), from the held study."""
    if not isinstance(study, dict) or study.get("status") != "ok":
        status = study.get("status") if isinstance(study, dict) else None
        return {"state": status if status in ("computing", "waiting") else "unavailable",
                "detail": study.get("detail") if isinstance(study, dict) else None}
    pairs = {(r["setup"], r.get("phase") or C.PHASE_ALL) for r in stock.get("signals") or ()}
    lines = {}
    for s in study.get("setups") or ():
        if s.get("state") != "ok":
            continue
        for g in s.get("groups") or ():
            if (s["id"], g.get("phase")) not in pairs:
                continue
            lines[f"{s['id']}|{g['phase']}"] = {
                "signals": g.get("signals"),
                "horizons": {h: {"n": v.get("n"), "below_floor": v.get("below_floor"),
                                 "win_rate": (v.get("strategy") or {}).get("win_rate"),
                                 "avg_pct": (v.get("strategy") or {}).get("avg_pct"),
                                 "median_pct": (v.get("strategy") or {}).get("median_pct"),
                                 "excess_pct": (v.get("same_day") or {}).get("excess_pct_winsorised")}
                             for h, v in (g.get("horizons") or {}).items()},
            }
    return {"state": "ok", "window": study.get("window"), "built_at": study.get("built_at"), "lines": lines,
            "min_signals": study.get("min_signals"), "note": (study.get("universe") or {}).get("caveat")}


_served_lock = threading.Lock()
#: stock key -> (the stock answer, the study build's mark, the answer served): one per held stock key
_served: "OrderedDict[tuple, tuple]" = OrderedDict()


def _study_mark(study) -> Optional[tuple]:
    """Which study build `universe_lines` reads (each build is one answer, replaced whole), or None when no study is
    held (nothing is kept then: those lines say `computing`, `waiting` or `unavailable` and cost nothing)."""
    if not isinstance(study, dict) or study.get("status") != "ok":
        return None
    return (study.get("built_for"), study.get("built_at"), study.get("library"), study.get("session"))


def _served_answer(key: tuple, ans: dict, study) -> dict:
    """The answer for one held stock answer and the study held now: the one put together before while the SAME stock
    answer (equal, field for field) and the same study build are held, else put together now, kept with its bytes."""
    mark = _study_mark(study)
    if mark is not None:
        with _served_lock:
            hit = _served.get(key)
            if hit is not None and hit[1] == mark and hit[0] == ans:
                _served.move_to_end(key)
                return hit[2]
    out = {**ans, "universe": universe_lines(ans, study)}
    if mark is None:
        return out
    held_bytes.remember(out)
    dropped = []
    with _served_lock:
        old = _served.get(key)
        if old is not None:
            dropped.append(old[2])
        _served[key] = (ans, mark, out)
        _served.move_to_end(key)
        while len(_served) > STOCK_KEYS:
            dropped.append(_served.popitem(last=False)[1][2])
    for gone in dropped:
        held_bytes.forget(gone)
    return out


def get_stock(sym: str, now: Optional[datetime] = None) -> dict:
    """One canonical symbol's signals (the route has already refused anything else)."""
    now = now or now_et()
    session = evening_key(now)
    market = _market(0.0)
    stamp = (market.get("status"), market.get("built_at")) if isinstance(market, dict) else (None, None)
    key = (sym, session, stamp)
    ans = _STOCK.get(key, wait_s=STOCK_WAIT_S)
    if ans.get("status") != "ok":
        return {**ans, "symbol": ans.get("symbol") or sym}
    return _served_answer(key, ans, get_study(now))


def reset_for_tests() -> None:
    """Tests only: forget everything this module holds."""
    global _slots
    _STUDY.reset()
    _STOCK.reset()
    with _served_lock:
        for _ans, _mark, out in _served.values():
            held_bytes.forget(out)
        _served.clear()
    _building.clear()
    _slots = threading.BoundedSemaphore(STOCK_SLOTS)
