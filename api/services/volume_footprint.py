"""VFP, the Terminal's volume footprint and gaps: one stock's accumulation and distribution days and
up/down volume, its biggest volume days, its pocket pivots, and every gap of 3% or more with whether
and when it filled.

WHERE THE NUMBERS COME FROM (all already stored on this server; NOTHING HERE ASKS A VENDOR):

  the stock      `price_reads.daily_bars`: ONE read of the stored daily bars, the read STAT makes,
                 through the same read-only loader `/api/bars-history` serves (split-adjusted prices
                 and volumes by the serve-time heal).
  earnings days  the report dates the site's earnings page already holds for the stock
                 (`earnings_intel.get_earnings_held`: its memory copy, then its snapshot on this
                 server's disk; never a build, never a provider call, never a refresh kick). It holds
                 up to 12 reported quarters, and only for stocks the earnings page has been built for,
                 so the answer says which span the marks cover; outside it a mark is "not known".

THE DEFINITIONS are in `volume_footprint_calc` (pure, tested on invented series).

HOW OFTEN AND HOW MUCH (STAT's pattern and bounds; half STAT's held cap, see `CACHE_MAX`). Computed on the member's request (a plain
read of one stock), then HELD per symbol for the session: an answer is keyed on the newest session
whose evening has begun (`market_history.evening_key`, 20:15 New York time on a trading day) and only
bars up to that session are read, so today's unfinished bar never counts. A stock whose newest bar is
older than that session is read again at most every `LAG_RECHECK_S`. The held earnings dates are
looked at again at most every `EARNINGS_RECHECK_S` (a cache or one-row disk read); only when they
changed is the stock worked out again. The held answers are capped (`CACHE_MAX`, the least recently
asked dropped first); one request per symbol builds at a time (a second waits for it), and at most
`BUILD_SLOTS` symbols build at once (a build that waits past `BUILD_WAIT_S` for a slot says `busy`).
THE FIRST ASK NEVER BUILDS ON THE REQUEST (speed pass 2, 2026-11-24; live, a first open took 1.6 s): with
nothing held the request starts the stock's ONE background build (`BUILD_THREAD`; at most `MAX_PENDING`
started and unfinished, past that `busy`) and answers `computing` at once; the panel asks again. A build
that holds nothing (a failed read, `busy`) is said ONCE to the next request (`_said`), never held.

MEASURED (2026-11-22, invented bars through the real read path on the dev PC, not production): one stock
of 6,011 daily rows costs about 0.14 to 0.16 s of CPU the first time it is asked for in a session (the
store read and its serve-time heal about 0.11 to 0.125 s of that, the very read STAT makes; the four
sections about 0.012 s), and well under a millisecond when held. The transient peak of a first read is
about 3.9 MB, all of it the store read (STAT's first read peaks the same); the sections add about 0.26 MB.
An answer is about 24 KB as JSON and about 74 KB held.

Never the shared cache: the answers are held in this module.
"""
from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Optional

from api.services import stock_stats_calc as SC
from api.services import volume_footprint_calc as C

_log = logging.getLogger(__name__)

SOURCE = "UCT's stored daily prices and volumes"
BASIS = "daily bars of settled sessions; prices and volumes split-adjusted as the store serves them"
EARNINGS_SOURCE = "the report dates UCT's earnings page holds for this stock"
BUSY = "The server is busy working out volume footprints. Try again in a moment."

# ── defaults (each one is the builder's, not an owner ruling; STAT's own) ─────────────────────────
CACHE_MAX = 128                 # held answers (one per symbol), least recently asked dropped first: half STAT's
                                # 256, because an answer is about 74 KB held against STAT's 23 to 31 KB, so the
                                # most this module can hold (about 9.5 MB) stays near STAT's (about 8 MB)
LAG_RECHECK_S = 1800.0          # a stock whose bars stop short of the session is read again after this
EARNINGS_RECHECK_S = 1800.0     # the held earnings dates are looked at again after this
BUILD_SLOTS = 4                 # symbols built at once, whatever the number of members
BUILD_WAIT_S = 10.0             # the longest a build waits for a slot
WAIT_S = 0.0                    # the longest a request waits for the build it started: none, the panel asks again
MAX_PENDING = 4 * BUILD_SLOTS   # builds started and not finished, at most; past it a request says busy
BUILD_THREAD = "volume-footprint-build"

_lock = threading.Lock()
_cache: "OrderedDict[str, dict]" = OrderedDict()   # sym -> {key, at, recheck_at, earn_stamp, earn_check_at, answer}
_inflight: dict[str, threading.Event] = {}
_slots = threading.BoundedSemaphore(BUILD_SLOTS)
_said: "OrderedDict[str, dict]" = OrderedDict()    # sym -> {key, answer}: a build that held nothing, said once
_gen = 0                                            # bumped by reset_for_tests: a build started before it keeps nothing


# ── the reads (each indirected so tests replace it) ─────────────────────────────────────────

def now_et() -> datetime:
    from api.services import market_history
    return market_history.now_et()


def session_key(now: datetime) -> str:
    """The newest session whose evening has begun (MKTH's `evening_key`, as STAT)."""
    from api.services import market_history
    return market_history.evening_key(now)


def _read_bars(sym: str) -> dict:
    from api.services.market_intel import price_reads
    return price_reads.daily_bars(sym)


def _read_earnings(sym: str) -> Optional[dict]:
    """The earnings page this server already holds for `sym`, or None. Read only (see the docstring)."""
    from api.services import earnings_intel
    return earnings_intel.get_earnings_held(sym)


# ── the pieces ───────────────────────────────────────────────────────────────────────────────

def earnings(sym: str) -> tuple[Optional[dict], dict, tuple]:
    """`(index, block, stamp)`: the held report dates as `volume_footprint_calc.earnings_index` reads
    them, the block the answer carries, and a stamp that changes whenever they do."""
    try:
        payload = _read_earnings(sym)
    except Exception:  # noqa: BLE001 -- the marks are said to be not known; the sections stand
        payload = None
    if payload is None:
        return None, {"state": "not_held", "source": EARNINGS_SOURCE}, ("not_held",)
    index = C.earnings_index(payload)
    if index is None:
        return None, {"state": "no_dates", "source": EARNINGS_SOURCE}, ("no_dates",)
    cover = index["cover"]
    block = {"state": "ok", "source": EARNINGS_SOURCE, "reports": len(index["dates"]), "first_report": index["dates"][0],
             "last_report": index["dates"][-1], "next_report": index["next"], "built": index["built"], "cover": cover}
    stamp = ("ok", tuple(index["dates"]), tuple(sorted(cover.items())) if cover else None)
    return index, block, stamp


def build(sym: str, key: str) -> tuple[dict, tuple]:
    """`(answer, earnings stamp)` for one stock, from bars up to session `key`."""
    got = _read_bars(sym)
    status = got.get("status")
    if status == "refused":
        return {"status": "refused", "symbol": sym, "detail": got.get("detail")}, ()
    if status != "ok":
        reason = got.get("reason") or "unavailable"
        if reason == "no_price_history":
            return {"status": "not_held", "symbol": sym, "detail": f"UCT holds no daily prices for {sym}."}, ()
        return {"status": "unavailable", "symbol": sym, "reason": reason,
                "detail": f"{sym}'s price history could not be read just now."}, ()
    bars = SC.clean_bars([b for b in got.get("bars") or () if b and b[0] <= key])
    if not bars:
        return {"status": "not_held", "symbol": sym, "detail": f"UCT holds no settled daily prices for {sym} yet."}, ()
    index, earn_block, stamp = earnings(sym)
    flag = C.earnings_flagger(bars, index)
    jumps = SC.jumps_of(SC.closes_of(bars))
    answer = {
        "status": "ok", "symbol": sym, "session": key, "data_through": bars[-1][0], "first": bars[0][0],
        "sessions": len(bars), "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": SOURCE, "basis": BASIS, "suspect_jump_pct": round(SC.SUSPECT_JUMP * 100),
        "earnings": earn_block,
        "accumulation": C.accumulation(bars),
        "big_days": C.big_days(bars, flag),
        "pivots": C.pocket_pivots(bars, flag),
        "gaps": C.gaps(bars, flag, jumps),
    }
    return answer, stamp


# ── held answers ─────────────────────────────────────────────────────────────────────────────

def _fresh(entry: Optional[dict], key: str, now: float) -> bool:
    if not entry or entry["key"] != key:
        return False
    return entry["recheck_at"] is None or now < entry["recheck_at"]


def _peek(sym: str, key: str, now: float) -> Optional[dict]:
    with _lock:
        entry = _cache.get(sym)
        if _fresh(entry, key, now):
            _cache.move_to_end(sym)
            return entry["answer"]
    return None


def _keep(sym: str, key: str, answer: dict, stamp: tuple, now: float) -> None:
    status = answer.get("status")
    if status not in ("ok", "not_held"):
        return                                        # a failed read is never held
    lagging = status == "not_held" or (answer.get("data_through") or "") < key
    with _lock:
        _cache[sym] = {"key": key, "at": now, "answer": answer, "earn_stamp": stamp,
                       "earn_check_at": now + EARNINGS_RECHECK_S,
                       "recheck_at": now + LAG_RECHECK_S if lagging else None}
        _cache.move_to_end(sym)
        while len(_cache) > CACHE_MAX:
            _cache.popitem(last=False)


def _held(sym: str, key: str, now: float) -> Optional[dict]:
    """The held answer, after looking at the held earnings dates again when that is due; None when the
    stock must be worked out (nothing held, a new session, a lagging stock's recheck, new report dates)."""
    with _lock:
        entry = _cache.get(sym)
        if not _fresh(entry, key, now):
            return None
        _cache.move_to_end(sym)
        if now < entry["earn_check_at"] or entry["answer"].get("status") != "ok":
            return entry["answer"]
    _index, _block, stamp = earnings(sym)             # outside the lock: a memory or one-row disk read
    with _lock:
        entry = _cache.get(sym)                       # it may have been replaced meanwhile
        if not _fresh(entry, key, now) or stamp != entry["earn_stamp"]:
            return None
        entry["earn_check_at"] = now + EARNINGS_RECHECK_S
        return entry["answer"]


def _say(sym: str, key: str, answer: dict, gen: int) -> None:
    """Keep the outcome of a build that held nothing, to say it once to the next request for the stock."""
    with _lock:
        if gen != _gen:
            return
        _said[sym] = {"key": key, "answer": answer}
        _said.move_to_end(sym)
        while len(_said) > CACHE_MAX:
            _said.popitem(last=False)


def _take_said(sym: str, key: str) -> Optional[dict]:
    with _lock:
        said = _said.pop(sym, None)
    return said["answer"] if said and said["key"] == key else None


def _build_bg(sym: str, key: str, ev: threading.Event, gen: int) -> None:
    """The stock's one build, on its own thread: held when it may be (`_keep`), else said once (`_say`)."""
    try:
        if not _slots.acquire(timeout=BUILD_WAIT_S):
            _say(sym, key, {"status": "busy", "symbol": sym, "detail": BUSY}, gen)
            return
        try:
            started = time.thread_time()
            answer, stamp = build(sym, key)
            _log.debug("[volume-footprint] %s built in %.0f ms of CPU", sym, (time.thread_time() - started) * 1000)
        finally:
            _slots.release()
        if gen == _gen:
            _keep(sym, key, answer, stamp, time.time())
        if answer.get("status") not in ("ok", "not_held"):
            _say(sym, key, answer, gen)
    except Exception as exc:  # noqa: BLE001 -- one stock never fails the route with a 500
        _log.warning("[volume-footprint] %s failed (%s)", sym, type(exc).__name__)
        _say(sym, key, {"status": "unavailable", "symbol": sym, "reason": "failed",
                        "detail": f"The volume footprint for {sym} could not be worked out just now."}, gen)
    finally:
        with _lock:
            if _inflight.get(sym) is ev:
                del _inflight[sym]
        ev.set()


def _start(sym: str, key: str) -> Optional[threading.Event]:
    """The stock's build in flight, or a new one on its own thread; None when `MAX_PENDING` are already running."""
    with _lock:
        ev = _inflight.get(sym)
        if ev is not None:
            return ev
        if len(_inflight) >= MAX_PENDING:
            return None
        ev = _inflight[sym] = threading.Event()
        gen = _gen
    threading.Thread(target=_build_bg, args=(sym, key, ev, gen), name=BUILD_THREAD, daemon=True).start()
    return ev


def get_volume_footprint(sym: str, now: Optional[datetime] = None, *, wait_s: Optional[float] = None) -> dict:
    """The answer for one canonical symbol (the route has already refused anything else). NEVER builds on the
    caller's thread: the held answer, else `computing` while the stock's one background build runs (`wait_s`, by
    default `WAIT_S`: none, waits that long for it first)."""
    now = now or now_et()
    key = session_key(now)
    held = _held(sym, key, time.time())
    if held is not None:
        return held
    said = _take_said(sym, key)
    if said is not None:
        return said
    ev = _start(sym, key)
    if ev is None:
        return {"status": "busy", "symbol": sym, "detail": BUSY}
    wait = WAIT_S if wait_s is None else wait_s
    if wait > 0:
        ev.wait(wait)
        held = _peek(sym, key, time.time())
        if held is not None:
            return held
        said = _take_said(sym, key)
        if said is not None:
            return said
    return {"status": "computing", "symbol": sym}


def drain_for_tests(timeout: float = 10.0) -> None:
    """Tests only: wait for every build in flight."""
    with _lock:
        evs = list(_inflight.values())
    for ev in evs:
        ev.wait(timeout)


def reset_for_tests() -> None:
    """Tests only: forget everything this module holds."""
    global _slots, _gen
    with _lock:
        _cache.clear()
        _inflight.clear()
        _said.clear()
        _gen += 1
    _slots = threading.BoundedSemaphore(BUILD_SLOTS)
