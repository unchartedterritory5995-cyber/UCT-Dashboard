"""STAT, the Terminal's stock statistics: one stock's volatility and range, beta and correlation,
returns, its own drawdowns, and how it acted in every S&P 500 correction and bear market.

WHERE THE NUMBERS COME FROM (all already stored on this server; NOTHING HERE ASKS A VENDOR):

  the stock     `price_reads.daily_bars`: ONE read of the stored daily bars, through the same
                read-only loader `/api/bars-history` serves (split-adjusted by the serve-time heal,
                not dividend-adjusted: price returns).
  benchmarks    `price_reads.daily_closes` of SPY and of the stock's sector fund (the SPDR fund
                `rs_benchmarks.SECTOR_ETF` maps its sector to, the map RS's "sector" benchmark
                uses), each read at most once each evening for every member and kept as its newest
                `BENCH_TAIL` closes.
  sector        the persisted industry map, read only (`industry_map.peek_groups`): no fallback
                fetch. A fund (the map files every ETF under "Exchange Traded Fund") has no sector
                fund of its own.
  corrections   MKTH's held answer (`market_history.get_market_history`, which answers at once and
                starts its own one background build only when that is due): its S&P 500 declines.
                No second correction finder.

THE DEFINITIONS are in `stock_stats_calc` (pure, tested on invented series).

HOW OFTEN AND HOW MUCH. Computed on the member's request (a plain read of one stock), then HELD per
symbol for the session: an answer is keyed on the newest session whose evening has begun
(`market_history.evening_key`, 20:15 New York time on a trading day) and only closes up to that
session are read, so a chart view that writes today's unfinished bar into the store never changes
it. A stock whose newest close is older than that session (a halt, a store that has not caught up)
is read again at most every `LAG_RECHECK_S`, and so is one whose answer was built while SPY or its
sector fund was not held or could not be read (that read is tried again after `LAG_RECHECK_S` too; a
failed read is said as one, never as "no prices held"). The held answers are
capped (`CACHE_MAX`, the least recently asked dropped first); one request per symbol builds at a time
(a second waits for it), and at most `BUILD_SLOTS` symbols build at once (past `BUILD_WAIT_S` the
request says `busy`).
MEASURED (2026-11-21, invented bars through the real read path on the dev PC, not production): one
stock of 6,011 daily rows costs about 0.17 to 0.19 s of CPU the first time it is asked for in a
session (the store read and its serve-time heal about 0.125 s of that, the same read the chart's
history makes; the statistics about 0.05 s), and well under a millisecond when held. SPY and the
sector fund are read once per session for every stock. An answer is about 13 to 22 KB.

Never the shared cache: the answers are held in this module.
"""
from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from datetime import date, datetime, timezone
from typing import Optional

from api.services import stock_stats_calc as C

_log = logging.getLogger(__name__)

SOURCE = "UCT's stored daily prices (split-adjusted, price only)"
INDEX_NAME = "S&P 500"
INDEX_KEY = "SPX"
BENCHMARK = "SPY"

# ── defaults (each one is the builder's, not an owner ruling) ────────────────────────────────
CACHE_MAX = 256                 # held answers (one per symbol), least recently asked dropped first
LAG_RECHECK_S = 1800.0          # a stock whose closes stop short of the session is read again after this
BUILD_SLOTS = 4                 # symbols built at once, whatever the number of members
BUILD_WAIT_S = 10.0             # the longest a request waits for a slot (or for the same symbol's build)
BENCH_TAIL = 400                # benchmark closes held per evening (beta reads the newest 252 returns)

_lock = threading.Lock()
_cache: "OrderedDict[str, dict]" = OrderedDict()   # sym -> {key, stamp, at, recheck_at, answer}
_inflight: dict[str, threading.Event] = {}
_bench: dict[str, dict] = {}                        # fund -> {key, at, closes | None, why | None}
_slots = threading.BoundedSemaphore(BUILD_SLOTS)


# ── the reads (each indirected so tests replace it) ─────────────────────────────────────────

def now_et() -> datetime:
    from api.services import market_history
    return market_history.now_et()


def session_key(now: datetime) -> str:
    """The newest session whose evening has begun (MKTH's `evening_key`)."""
    from api.services import market_history
    return market_history.evening_key(now)


def _read_bars(sym: str) -> dict:
    from api.services.market_intel import price_reads
    return price_reads.daily_bars(sym)


def _read_closes(sym: str) -> dict:
    from api.services.market_intel import price_reads
    return price_reads.daily_closes(sym)


def _groups(sym: str) -> dict:
    """`{sector, industry}` from the persisted industry map, read only; {} when it cannot say."""
    try:
        from api.services import industry_map
        return (industry_map.peek_groups([sym]) or {}).get(sym, {}) or {}
    except Exception:  # noqa: BLE001 -- a missing map is a missing sector fund, said in the answer
        return {}


def _market_answer() -> dict:
    """MKTH's answer, at once (it starts its one background build only when that is due)."""
    from api.services import market_history
    return market_history.get_market_history(wait_s=0)


def _is_trading_day(d: date) -> bool:
    from api.services.session_calendar import is_trading_day
    return is_trading_day(d)


# ── the pieces ───────────────────────────────────────────────────────────────────────────────

def sector_fund(sym: str) -> dict:
    """`{state: 'ok', symbol, sector}` | `{state: 'fund'}` | `{state: 'no_sector'}` |
    `{state: 'not_mapped', sector}`."""
    from api.services.rs_benchmarks import ETF_INDUSTRY, SECTOR_ETF
    g = _groups(sym)
    if (g.get("industry") or "") == ETF_INDUSTRY:
        return {"state": "fund"}
    sector = g.get("sector")
    if not sector:
        return {"state": "no_sector"}
    etf = SECTOR_ETF.get(sector)
    if not etf:
        return {"state": "not_mapped", "sector": sector}
    return {"state": "ok", "symbol": etf, "sector": sector}


def bench_closes(fund: str, key: str) -> tuple[Optional[list], Optional[dict]]:
    """`(closes, None)`: the newest `BENCH_TAIL` settled closes of `fund` (SPY or a sector fund); or
    `(None, why)`, `why` the block's state: `{"state": "not_held"}` (nothing settled is stored for it)
    or `{"state": "unavailable", "reason": ...}` (the read failed, which is NOT "nothing stored").
    Read at most once per session key for every member; a missing answer of either kind is tried
    again after `LAG_RECHECK_S`."""
    now = time.time()
    with _lock:
        held = _bench.get(fund)
        if held and held["key"] == key and (held["closes"] is not None or now < held["at"] + LAG_RECHECK_S):
            return held["closes"], held["why"]
    got = _read_closes(fund)
    closes, why = None, {"state": "not_held"}
    if got.get("status") == "ok":
        closes = [(d, c) for d, c in got.get("closes") or () if d <= key][-BENCH_TAIL:] or None
    elif got.get("reason") != "no_price_history":
        why = {"state": "unavailable", "reason": got.get("reason") or "read_failed"}
    if closes is not None:
        why = None
    with _lock:
        _bench[fund] = {"key": key, "at": now, "closes": closes, "why": why}
    return closes, why


def market_corrections() -> tuple[dict, tuple]:
    """`(block, stamp)`: MKTH's S&P 500 block as this answer uses it, and a stamp that changes
    whenever MKTH's answer does (so a held STAT answer follows it)."""
    try:
        ans = _market_answer() or {}
    except Exception:  # noqa: BLE001 -- the other sections stand; this one says it failed
        ans = {"status": "failed"}
    status = ans.get("status")
    stamp = (status, ans.get("built_at"), ans.get("data_through"))
    if status == "computing":
        return {"state": "computing"}, stamp
    if status != "ok":
        return {"state": "unavailable", "detail": ans.get("detail")}, stamp
    block = (ans.get("indexes") or {}).get(INDEX_KEY) or {}
    if block.get("state") != "ok":
        return {"state": "not_held"}, stamp
    defin = ans.get("definition") or {}
    return {"state": "ok", "index": block, "data_through": block.get("last") or ans.get("data_through"),
            "built_at": ans.get("built_at"), "definition": defin.get("text")}, stamp


def _beta_section(sym: str, closes: list, key: str) -> dict:
    stock = closes[-(C.BETA.WINDOW + 60):]
    out: dict = {"as_of": closes[-1][0], "window": C.BETA.WINDOW, "min": C.BETA.MIN_OBS,
                 "capture_min_days": C.CAPTURE_MIN_DAYS}
    spy, why = bench_closes(BENCHMARK, key)
    out["spy"] = {"symbol": BENCHMARK, **(C.beta_block(stock, spy, capture=True) if spy else why)}
    sec = sector_fund(sym)
    if sec["state"] != "ok":
        out["sector"] = sec
    else:
        fund, why = bench_closes(sec["symbol"], key)
        out["sector"] = {**sec, **(C.beta_block(stock, fund) if fund else why)}
    return out


def _corrections_section(closes: list, market: dict) -> dict:
    base = {"index": INDEX_NAME, "first": closes[0][0], "as_of": closes[-1][0]}
    if market["state"] != "ok":
        return {**base, **market}
    block = market["index"]
    got = C.corrections(closes, block)
    return {**base, "state": "ok", "index_first": block.get("first"), "index_through": market["data_through"],
            "built_at": market.get("built_at"), "definition": market.get("definition"), **got}


def build(sym: str, key: str, market: dict) -> dict:
    """One stock's whole answer (see the module docstring), from closes up to session `key`."""
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
    bars = C.clean_bars([b for b in got.get("bars") or () if b and b[0] <= key])
    if not bars:
        return {"status": "not_held", "symbol": sym, "detail": f"UCT holds no settled daily prices for {sym} yet."}
    closes = C.closes_of(bars)
    jumps = C.jumps_of(closes)
    last_complete = C.week_complete(closes[-1][0], _is_trading_day)
    answer = {
        "status": "ok", "symbol": sym, "session": key, "data_through": closes[-1][0],
        "first": closes[0][0], "sessions": len(closes),
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": SOURCE, "basis": "daily close, split-adjusted, not dividend-adjusted (price return)",
        "suspect_jumps": jumps[-20:], "suspect_jump_pct": round(C.SUSPECT_JUMP * 100),
        "volatility": C.volatility(bars),
        "beta": _beta_section(sym, closes, key),
        "returns": {"as_of": closes[-1][0], "close": C.r2(closes[-1][1], 4),
                    "periods": C.period_returns(closes),
                    "extremes": C.extremes(closes, jumps, last_complete),
                    "week_complete": last_complete},
        "drawdowns": C.drawdowns(closes, sym, jumps),
        "corrections": _corrections_section(closes, market),
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


def _bench_missing(answer: dict) -> bool:
    """True when SPY or the sector fund was not held, or could not be read, as the answer was built:
    `bench_closes` tries that read again after `LAG_RECHECK_S`, and the stock's held answer must follow it."""
    beta = answer.get("beta") or {}
    return any((beta.get(k) or {}).get("state") in ("not_held", "unavailable") for k in ("spy", "sector"))


def _keep(sym: str, key: str, stamp: tuple, answer: dict, now: float) -> None:
    status = answer.get("status")
    if status not in ("ok", "not_held"):
        return                                        # a failed read is never held
    lagging = status == "not_held" or (answer.get("data_through") or "") < key or _bench_missing(answer)
    with _lock:
        _cache[sym] = {"key": key, "stamp": stamp, "at": now, "answer": answer,
                       "recheck_at": now + LAG_RECHECK_S if lagging else None}
        _cache.move_to_end(sym)
        while len(_cache) > CACHE_MAX:
            _cache.popitem(last=False)


def get_stock_stats(sym: str, now: Optional[datetime] = None) -> dict:
    """The answer for one canonical symbol (the route has already refused anything else)."""
    now = now or now_et()
    key = session_key(now)
    market, stamp = market_corrections()
    t = time.time()
    held = _held(sym, key, stamp, t)
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
        return held if held is not None else {"status": "busy", "symbol": sym,
                                              "detail": "The server is busy working out stock statistics. Try again in a moment."}
    try:
        if not _slots.acquire(timeout=BUILD_WAIT_S):
            return {"status": "busy", "symbol": sym,
                    "detail": "The server is busy working out stock statistics. Try again in a moment."}
        try:
            started = time.thread_time()
            answer = build(sym, key, market)
            _log.debug("[stock-stats] %s built in %.0f ms of CPU", sym, (time.thread_time() - started) * 1000)
        finally:
            _slots.release()
        _keep(sym, key, stamp, answer, time.time())
        return answer
    except Exception as exc:  # noqa: BLE001 -- one stock never fails the route with a 500
        _log.warning("[stock-stats] %s failed (%s)", sym, type(exc).__name__)
        return {"status": "unavailable", "symbol": sym, "reason": "failed",
                "detail": f"Stock statistics for {sym} could not be worked out just now."}
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
        _bench.clear()
    _slots = threading.BoundedSemaphore(BUILD_SLOTS)
