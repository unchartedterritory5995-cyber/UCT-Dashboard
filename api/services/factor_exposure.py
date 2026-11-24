"""FCTX, the Terminal's factor exposure: how one stock trades against the market, size, growth vs value,
momentum, quality and low volatility, as a regression of its daily returns on six fund spreads, now and
a year earlier.

WHERE THE NUMBERS COME FROM (all already stored on this server; NOTHING HERE ASKS A VENDOR):

  the stock   `price_reads.daily_bars(sym, max_bars=READ_SESSIONS)`: STAT's read (the read-only loader
              `/api/bars-history` serves: split-adjusted by the serve-time heal, not dividend-adjusted),
              of only the newest `READ_SESSIONS` stored rows, the two years the two windows need plus
              slack (SETH's bounded read).
  the funds   the same read of SPY, IWM, IWF, IWD, MTUM, QUAL and USMV, ONCE PER SESSION FOR EVERY
              MEMBER (`fund_set`); a fund that is not held with enough history (`factor_exposure_calc.
              fund_check`: at least 201 settled closes, the newest within 10 days of the session) is
              replaced by its one stated alternative (IVV, VTWO, VUG and VTV together, SPMO, SPHQ,
              SPLV), read only then; a factor neither fund can carry is left out and the answer says
              so. Without a market fund there is no answer (`unavailable`, in words).

THE DEFINITIONS are in `factor_exposure_calc` (pure, tested on invented series).

HOW OFTEN AND HOW MUCH (STAT's pattern and bounds). Computed on the member's request (a plain read of
one stock), then HELD per symbol for the session: an answer is keyed on the newest session whose evening
has begun (`market_history.evening_key`, 20:15 New York time on a trading day) and only closes up to
that session are read, so today's unfinished bar never counts. A stock whose newest close is older than
that session is read again at most every `LAG_RECHECK_S`; so is the fund set when a fund in it lags, was
replaced or left out (an answer follows the fund set: `stamp`). The held answers are capped
(`CACHE_MAX`, the least recently asked dropped first); one request per symbol builds at a time (a second
waits for it), and at most `BUILD_SLOTS` symbols build at once (past `BUILD_WAIT_S` the request says
`busy`). The fund set is read by one build at a time (`_funds_read`), never twice for one session.
THE FIRST ASK NEVER BUILDS ON THE REQUEST (speed pass 2, 2026-11-24; live, a first open took 2.1 s): the
request reads only what is held (the session's fund set, then the stock's answer for it); anything else
starts the stock's ONE background build (`BUILD_THREAD`: the fund set when it is not held fresh, then the
stock; at most `MAX_PENDING` started and unfinished, past that `busy`) and the request answers
`computing` at once; the panel asks again. A build that holds nothing (a failed read, `busy`) is said
ONCE to the next request (`_said`), never held.

MEASURED (2026-11-22, invented bars through the real read path on the dev PC, not production): one stock
with 6,011 stored daily rows costs about 23 ms of CPU the first time it is asked for in a session (the
bounded store read of its newest 564 rows and its serve-time heal about 10 ms, against about 0.11 to 0.125
s for STAT's whole-history read; the regression, both windows and the VIFs about 14 ms), with a transient
peak of about 0.47 MB and about 35 KB kept while it is held; well under a millisecond when held. The fund
set (seven funds) costs about 75 ms of CPU once a session for every member, peaks at about 0.73 MB and
keeps about 0.5 MB. An answer is about 6 KB as JSON, so the most this module holds (`CACHE_MAX` answers)
is about 9 MB.

Never the shared cache: the answers are held in this module.
"""
from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Optional

from api.services import factor_exposure_calc as C
from api.services import held_build

_log = logging.getLogger(__name__)

SOURCE = "UCT's stored daily prices (split-adjusted, price only)"
BASIS = "daily close, split-adjusted, not dividend-adjusted (price return)"
BUSY = "The server is busy working out factor exposures. Try again in a moment."

# ── defaults (each one is the builder's, not an owner ruling; STAT's own) ─────────────────────────
CACHE_MAX = 256                 # held answers (one per symbol), least recently asked dropped first
LAG_RECHECK_S = 1800.0          # a stock (or the fund set) that stops short of the session is read again after this
BUILD_SLOTS = 4                 # symbols built at once, whatever the number of members
BUILD_WAIT_S = 10.0             # the longest a build waits for a slot
READ_SESSIONS = 2 * C.WINDOW + 60   # newest stored rows read for the stock and for each fund
WAIT_S = 0.0                    # the longest a request waits for the build it started: none, the panel asks again
MAX_PENDING = 4 * BUILD_SLOTS   # builds started and not finished, at most; past it a request says busy
BUILD_THREAD = "factor-exposure-build"
# How long the word of a build that held nothing is kept for the panel waiting on it (it asks again every few seconds):
# held_build's own span for a failed build. Older, the next request starts a new build (review 2026-11-24: an untaken
# failure was told to the next member to open the stock hours later).
SAID_S = held_build.FAILED_S

#: what one first read cost (see the module docstring)
MEASURED = ("dev PC, invented bars through the real read: a first read about 23 ms of CPU and a 0.47 MB "
            "transient peak; the fund set about 75 ms once a session")

_lock = threading.Lock()
_funds_read = threading.Lock()
_cache: "OrderedDict[str, dict]" = OrderedDict()   # sym -> {key, stamp, at, recheck_at, answer}
_inflight: dict[str, threading.Event] = {}
_funds: dict = {}                                   # {"held": the fund set}
_slots = threading.BoundedSemaphore(BUILD_SLOTS)
_said: "OrderedDict[str, dict]" = OrderedDict()    # sym -> {key, answer, at}: a build that held nothing, said once
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
    return price_reads.daily_bars(sym, max_bars=READ_SESSIONS)


# ── the funds, once a session for every member ──────────────────────────────────────────────

def _settled(got: dict, key: str) -> tuple[str, list]:
    """`(read state, settled closes)` of one `daily_bars` answer."""
    status = got.get("status") if isinstance(got, dict) else None
    if status != "ok":
        reason = got.get("reason") if isinstance(got, dict) else None
        return ("not_held" if reason == "no_price_history" else "unavailable"), []
    return "ok", [(d, c) for d, c in got.get("closes") or () if d <= key]


def read_funds(key: str) -> dict:
    """The fund set for session `key`: every fund looked at, the option each factor uses, and the
    settled closes of the funds in use (the others are let go)."""
    checks: dict = {}
    series: dict = {}

    def usable(sym: str) -> bool:
        if sym not in checks:
            try:
                state, closes = _settled(_read_bars(sym), key)
            except Exception:  # noqa: BLE001 -- one fund's failed read is that fund's state, said in the answer
                state, closes = "unavailable", []
            checks[sym] = C.fund_check(closes, key, state)
            if checks[sym]["state"] == "ok":
                series[sym] = closes
        return checks[sym]["state"] == "ok"

    chosen: dict = {}
    for f in C.FACTORS:
        for option in f["options"]:
            if all([usable(s) for s in option]):        # a list: every fund of the option is looked at
                chosen[f["key"]] = option
                break
        if not chosen.get("market"):
            break                                       # no market fund, no model: the rest is not read
    used = {s for opt in chosen.values() for s in opt}
    series = {s: v for s, v in series.items() if s in used}
    complete = all(chosen.get(f["key"]) == f["options"][0] for f in C.FACTORS)
    lagging = any(checks[s]["last"] < key for s in used)
    now = time.time()
    stamp = (key, tuple(sorted((s, checks[s]["last"], checks[s]["closes"]) for s in used)),
             tuple(sorted((k, v) for k, v in chosen.items())))
    return {"key": key, "at": now, "state": "ok" if chosen.get("market") else "unavailable",
            "checks": checks, "chosen": chosen, "series": series, "stamp": stamp,
            "recheck_at": None if complete and not lagging else now + LAG_RECHECK_S}


def _fresh_funds(held: Optional[dict], key: str, now: float) -> bool:
    return bool(held) and held["key"] == key and (held["recheck_at"] is None or now < held["recheck_at"])


def held_funds(key: str) -> Optional[dict]:
    """The fund set for session `key` while it is held fresh, else None. Never reads a price."""
    with _lock:
        held = _funds.get("held")
        return held if _fresh_funds(held, key, time.time()) else None


def fund_set(key: str) -> dict:
    """The fund set for session `key`, read at most once per session for every member (again after
    `LAG_RECHECK_S` while a fund lags, was replaced or left out)."""
    with _lock:
        held = _funds.get("held")
        if _fresh_funds(held, key, time.time()):
            return held
    with _funds_read:                                 # one fund read at a time; a second waits for it
        with _lock:
            held = _funds.get("held")
            if _fresh_funds(held, key, time.time()):
                return held
        got = read_funds(key)
        with _lock:
            _funds["held"] = got
        return got


def funds_block(funds: dict) -> tuple[list, list]:
    """`(factors, fund checks)` as the answer lists them: each factor with the funds it uses (or why
    it is left out), and every fund looked at with what is held of it."""
    factors = []
    for f in C.FACTORS:
        opt = funds["chosen"].get(f["key"])
        primary, alternative = f["options"][0], f["options"][1]
        if opt is None:
            state = "dropped"
        else:
            state = "ok" if opt == primary else "substituted"
        legs = None
        if opt is not None:
            market = funds["chosen"]["market"][0]
            legs = list(opt) if (len(opt) == 2 or not f["less_market"]) else [opt[0], market]
        factors.append({"key": f["key"], "name": f["name"], "state": state, "funds": legs,
                        "primary": list(primary), "alternative": list(alternative),
                        "positive": f["positive"], "negative": f["negative"]})
    checks = [{"symbol": s, **c} for s, c in funds["checks"].items()]
    return factors, checks


# ── one stock ────────────────────────────────────────────────────────────────────────────────

def build(sym: str, key: str, funds: dict) -> dict:
    """One stock's whole answer (see the module docstring), from closes up to session `key`."""
    if funds["state"] != "ok":
        tried = " or ".join(C.BY_KEY["market"]["options"][i][0] for i in range(2))
        return {"status": "unavailable", "symbol": sym, "reason": "no_market_fund",
                "detail": f"The market fund ({tried}) is not held on this server just now, so no factor exposure can be worked out."}
    got = _read_bars(sym)
    status = got.get("status")
    if status == "refused":
        return {"status": "refused", "symbol": sym, "detail": got.get("detail")}
    if status != "ok":
        reason = got.get("reason") or "unavailable"
        if reason == "no_price_history":
            return {"status": "not_held", "symbol": sym, "detail": f"UCT holds no daily prices for {sym}."}
        return {"status": "unavailable", "symbol": sym, "reason": reason,
                "detail": f"{sym}'s price history could not be read just now."}
    closes = [(d, c) for d, c in got.get("closes") or () if d <= key]
    if not closes:
        return {"status": "not_held", "symbol": sym, "detail": f"UCT holds no settled daily prices for {sym} yet."}
    jumps = tuple(j for j in got.get("suspect_jumps") or () if j <= key)
    del got
    factors, checks = funds_block(funds)
    from api.services.market_intel.price_reads import SUSPECT_JUMP
    answer = {
        "status": "ok", "symbol": sym, "session": key, "data_through": closes[-1][0],
        "read_from": closes[0][0], "sessions_read": len(closes),
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": SOURCE, "basis": BASIS, "suspect_jump_pct": round(SUSPECT_JUMP * 100),
        "method": C.method(), "factors": factors, "fund_checks": checks,
        **C.exposure(closes, funds["series"], C.legs_of(funds["chosen"]), sym, jumps),
    }
    return answer


# ── held answers ─────────────────────────────────────────────────────────────────────────────

def _fresh(entry: Optional[dict], key: str, stamp: tuple, now: float) -> bool:
    if not entry or entry["key"] != key or entry["stamp"] != stamp:
        return False
    return entry["recheck_at"] is None or now < entry["recheck_at"]


def _held(sym: str, key: str, stamp: tuple, now: float) -> Optional[dict]:
    with _lock:
        entry = _cache.get(sym)
        if _fresh(entry, key, stamp, now):
            _cache.move_to_end(sym)
            return entry["answer"]
    return None


def _keep(sym: str, key: str, stamp: tuple, answer: dict, now: float) -> None:
    status = answer.get("status")
    if status not in ("ok", "not_held"):
        return                                        # a failed read is never held
    lagging = status == "not_held" or (answer.get("data_through") or "") < key
    with _lock:
        _cache[sym] = {"key": key, "stamp": stamp, "at": now, "answer": answer,
                       "recheck_at": now + LAG_RECHECK_S if lagging else None}
        _cache.move_to_end(sym)
        while len(_cache) > CACHE_MAX:
            _cache.popitem(last=False)


def _failed(sym: str) -> dict:
    return {"status": "unavailable", "symbol": sym, "reason": "failed",
            "detail": f"The factor exposure for {sym} could not be worked out just now."}


def _say(sym: str, key: str, answer: dict, gen: int) -> None:
    """Keep the outcome of a build that held nothing, to say it once to the next request for the stock."""
    with _lock:
        if gen != _gen:
            return
        _said[sym] = {"key": key, "answer": answer, "at": time.time()}
        _said.move_to_end(sym)
        while len(_said) > CACHE_MAX:
            _said.popitem(last=False)


def _take_said(sym: str, key: str) -> Optional[dict]:
    with _lock:
        said = _said.pop(sym, None)
    return said["answer"] if said and said["key"] == key and 0 <= time.time() - said["at"] < SAID_S else None


def _build_bg(sym: str, key: str, ev: threading.Event, gen: int) -> None:
    """The stock's one build, on its own thread: the session's fund set when it is not held fresh, then the stock
    unless an answer for that fund set is held; held when it may be (`_keep`), else said once (`_say`)."""
    try:
        try:
            funds = fund_set(key)
        except Exception as exc:  # noqa: BLE001 -- one bad fund read never fails the route with a 500
            _log.warning("[factor-exposure] the fund set failed (%s)", type(exc).__name__)
            _say(sym, key, _failed(sym), gen)
            return
        stamp = funds["stamp"]
        if _held(sym, key, stamp, time.time()) is not None:
            return
        if not _slots.acquire(timeout=BUILD_WAIT_S):
            _say(sym, key, {"status": "busy", "symbol": sym, "detail": BUSY}, gen)
            return
        try:
            started = time.thread_time()
            answer = build(sym, key, funds)
            _log.debug("[factor-exposure] %s built in %.0f ms of CPU", sym, (time.thread_time() - started) * 1000)
        finally:
            _slots.release()
        if gen == _gen:
            _keep(sym, key, stamp, answer, time.time())
        if answer.get("status") not in ("ok", "not_held"):
            _say(sym, key, answer, gen)
    except Exception as exc:  # noqa: BLE001 -- one stock never fails the route with a 500
        _log.warning("[factor-exposure] %s failed (%s)", sym, type(exc).__name__)
        _say(sym, key, _failed(sym), gen)
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


def _answer_held(sym: str, key: str) -> Optional[dict]:
    funds = held_funds(key)
    return _held(sym, key, funds["stamp"], time.time()) if funds is not None else None


def get_factor_exposure(sym: str, now: Optional[datetime] = None, *, wait_s: Optional[float] = None) -> dict:
    """The answer for one canonical symbol (the route has already refused anything else). NEVER reads a price on the
    caller's thread: the answer held for the session's held fund set, else `computing` while the stock's one
    background build runs (`wait_s`, by default `WAIT_S`: none, waits that long for it first)."""
    now = now or now_et()
    key = session_key(now)
    held = _answer_held(sym, key)
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
        held = _answer_held(sym, key)
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
        _funds.clear()
        _said.clear()
        _gen += 1
    _slots = threading.BoundedSemaphore(BUILD_SLOTS)
