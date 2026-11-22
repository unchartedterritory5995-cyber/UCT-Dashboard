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
`busy`). The fund set is read by one request at a time (`_funds_read`), never twice for one session.

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

_log = logging.getLogger(__name__)

SOURCE = "UCT's stored daily prices (split-adjusted, price only)"
BASIS = "daily close, split-adjusted, not dividend-adjusted (price return)"
BUSY = "The server is busy working out factor exposures. Try again in a moment."

# ── defaults (each one is the builder's, not an owner ruling; STAT's own) ─────────────────────────
CACHE_MAX = 256                 # held answers (one per symbol), least recently asked dropped first
LAG_RECHECK_S = 1800.0          # a stock (or the fund set) that stops short of the session is read again after this
BUILD_SLOTS = 4                 # symbols built at once, whatever the number of members
BUILD_WAIT_S = 10.0             # the longest a request waits for a slot (or for the same symbol's build)
READ_SESSIONS = 2 * C.WINDOW + 60   # newest stored rows read for the stock and for each fund

#: what one first read cost (see the module docstring)
MEASURED = ("dev PC, invented bars through the real read: a first read about 23 ms of CPU and a 0.47 MB "
            "transient peak; the fund set about 75 ms once a session")

_lock = threading.Lock()
_funds_read = threading.Lock()
_cache: "OrderedDict[str, dict]" = OrderedDict()   # sym -> {key, stamp, at, recheck_at, answer}
_inflight: dict[str, threading.Event] = {}
_funds: dict = {}                                   # {"held": the fund set}
_slots = threading.BoundedSemaphore(BUILD_SLOTS)


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


def get_factor_exposure(sym: str, now: Optional[datetime] = None) -> dict:
    """The answer for one canonical symbol (the route has already refused anything else)."""
    now = now or now_et()
    key = session_key(now)
    try:
        funds = fund_set(key)
    except Exception as exc:  # noqa: BLE001 -- one bad fund read never fails the route with a 500
        _log.warning("[factor-exposure] the fund set failed (%s)", type(exc).__name__)
        return {"status": "unavailable", "symbol": sym, "reason": "failed",
                "detail": f"The factor exposure for {sym} could not be worked out just now."}
    stamp = funds["stamp"]
    held = _held(sym, key, stamp, time.time())
    if held is not None:
        return held
    # one build per symbol at a time: a second request for it waits for that build
    with _lock:
        ev = _inflight.get(sym)
        mine = ev is None
        if mine:
            ev = _inflight[sym] = threading.Event()
    if not mine:
        ev.wait(BUILD_WAIT_S)
        held = _held(sym, key, stamp, time.time())
        return held if held is not None else {"status": "busy", "symbol": sym, "detail": BUSY}
    try:
        if not _slots.acquire(timeout=BUILD_WAIT_S):
            return {"status": "busy", "symbol": sym, "detail": BUSY}
        try:
            started = time.thread_time()
            answer = build(sym, key, funds)
            _log.debug("[factor-exposure] %s built in %.0f ms of CPU", sym, (time.thread_time() - started) * 1000)
        finally:
            _slots.release()
        _keep(sym, key, stamp, answer, time.time())
        return answer
    except Exception as exc:  # noqa: BLE001 -- one stock never fails the route with a 500
        _log.warning("[factor-exposure] %s failed (%s)", sym, type(exc).__name__)
        return {"status": "unavailable", "symbol": sym, "reason": "failed",
                "detail": f"The factor exposure for {sym} could not be worked out just now."}
    finally:
        with _lock:
            _inflight.pop(sym, None)
        ev.set()


def reset_for_tests() -> None:
    """Tests only: forget everything this module holds."""
    global _slots
    with _lock:
        _cache.clear()
        _inflight.clear()
        _funds.clear()
    _slots = threading.BoundedSemaphore(BUILD_SLOTS)
