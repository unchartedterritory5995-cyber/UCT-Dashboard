"""Warm the terminal's heaviest research panels for the most-opened tickers after a deploy.

MEASURED live 2026-10-06, twice: the first open of `TSM EE` after a `web` deploy rendered
"Could not load this section". `/api/research/estimates/{sym}?consensus=1` took ~9.5 s on a
warm-ish pod and past the panel's 30 s deadline at boot (the pod is busy with its own
warmers); a minute later the same request answered in ~0.6 s.

WHAT IS WARMED, AND WHY ONLY THIS
---------------------------------
Each step calls the SAME function the route calls, and only functions that cache their own
result in the shared `TTLCache` (which `cache_snapshot` also carries across the next deploy):

    estimates         research.estimates.get_estimates          EE (yfinance legs)    12 h
    consensus         research.estimates_consensus.get_consensus EE (FMP consensus)    6 h
    financial_history research.financial_history.get_history    FA (quarter)         12 h
    analyst_ratings   research.analyst_ratings.get_analyst_ratings ANR                  6 h
    ownership         research.ownership.get_ownership           OWN                  12 h
    ratings           research.ratings.get_ratings               RTG                  12 h

NOT warmed: seasonality (computed per request from the bar store, which the bars prewarmer
already keeps hot -- nothing here would be cached), estimate-history (reads its own on-disk
snapshot table) and patterns (a DB read). Warming those would cost boot time and keep nothing.

A function whose entry is already present (restored from the snapshot at boot) answers from
the cache in microseconds, so after a quick redeploy this pass is nearly free.

BOUNDED AND PACED
-----------------
One thread, one symbol at a time, a pause between symbols, a wall-clock budget. Funds are
left out: EE / FA / ANR answer them as not applicable.

IT NEVER MAKES A MEMBER WAIT (2026-10-06 boot-contention fix)
-------------------------------------------------------------
Measured on the 17:46 UTC web boot, the first with this warm: three opens of `TSM EE`
(started 17:48:41, 17:49:36, 17:50:18) all answered within 7 ms of each other at 17:50:23
-- 102 s, 47 s, 5 s, identical bodies -- while unrelated sync routes answered in 0.3 s.
Released together means they waited on ONE in-flight computation, i.e. a `single_flight`
leader, and on a booting pod a warmer is exactly the leader nobody should be queued behind.
The same pass then drained the process-wide FMP bucket (`local FMP budget exhausted` for
AVGO / PLTR / NFLX at 17:50:52-17:51:01), the bucket a member's EE / FA read also spends.

So, three rules:
  1. The whole pass runs inside `single_flight.background()`: a member who opens a symbol
     the warm is building does NOT follow the warm's flight, it builds on its own thread
     (single_flight.py explains the take-over). Worst case one duplicated read.
  2. Before each symbol the pass waits until the FMP bucket holds `FMP_RESERVE_TOKENS`
     (half the per-minute ceiling), so a warm symbol can never take the bucket a member
     needs; if it does not refill inside the wall-clock budget the pass stops.
  3. Each symbol's wall time is logged, so the next boot shows what the pass cost.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Callable, Iterable

_log = logging.getLogger(__name__)

# The liquid single names of the bars prewarmer's priority list (bars_prewarm._PRIORITY,
# bars_fetch._build_universe_ticker_list), ETFs removed, plus TSM -- the name the
# 2026-10-06 defect was seen on. Order is priority: the budget cuts from the end.
PRIORITY_SYMBOLS: tuple[str, ...] = (
    "NVDA", "AAPL", "MSFT", "TSLA", "AMZN", "META", "GOOGL", "AMD",
    "AVGO", "TSM", "PLTR", "NFLX",
)

# Seconds between symbols, so the pass never stacks vendor calls on a booting pod.
PACE_SECONDS = 1.5
# The whole pass stops here even if symbols remain.
BUDGET_SECONDS = 300.0
# A symbol starts only while the FMP bucket (fmp_client, 120/min by default) holds at least
# this many tokens: one warm symbol spends ~12-15 FMP calls across its surfaces, so starting
# at >= 60 leaves members >= 45 of the minute's budget even mid-symbol.
FMP_RESERVE_TOKENS = 60.0
# How long to wait between bucket re-reads while below the reserve.
RESERVE_POLL_SECONDS = 5.0


def _fmp_tokens() -> float:
    """Tokens available on the shared FMP bucket now; +inf when it cannot be read (an
    unreadable bucket must not stall the warm -- the vendor reads then answer for
    themselves)."""
    try:
        from api.services import fmp_client
        return float(fmp_client.tokens_available())
    except Exception:                                            # noqa: BLE001
        return float("inf")


def _surfaces() -> list[tuple[str, Callable[[str], Any]]]:
    """(name, fn) per warmed surface. Imported lazily and one by one: a module that fails to
    import costs its own surface, never the whole warm."""
    out: list[tuple[str, Callable[[str], Any]]] = []

    def add(name: str, module: str, attr: str, **kw: Any) -> None:
        try:
            fn = getattr(__import__(module, fromlist=[attr]), attr)
        except Exception as e:                                   # noqa: BLE001
            _log.warning("[research-warm] %s unavailable: %s", name, e)
            return
        out.append((name, (lambda s, _fn=fn, _kw=kw: _fn(s, **_kw))))

    add("estimates", "api.services.research.estimates", "get_estimates")
    add("consensus", "api.services.research.estimates_consensus", "get_consensus")
    add("financial_history", "api.services.research.financial_history", "get_history",
        period="quarter")
    add("analyst_ratings", "api.services.research.analyst_ratings", "get_analyst_ratings")
    add("ownership", "api.services.research.ownership", "get_ownership")
    add("ratings", "api.services.research.ratings", "get_ratings")
    return out


def warm_research_panels(symbols: Iterable[str] = PRIORITY_SYMBOLS, *,
                         pace_seconds: float = PACE_SECONDS,
                         budget_seconds: float = BUDGET_SECONDS,
                         surfaces: list[tuple[str, Callable[[str], Any]]] | None = None,
                         sleep: Callable[[float], None] = time.sleep,
                         clock: Callable[[], float] = time.monotonic,
                         fmp_reserve: float = FMP_RESERVE_TOKENS,
                         fmp_tokens: Callable[[], float] | None = None,
                         reserve_poll_seconds: float = RESERVE_POLL_SECONDS) -> dict[str, Any]:
    """Warm each surface for each symbol, best-effort. Never raises.

    Runs as BACKGROUND work for `single_flight` (a member never follows its flights) and
    yields the shared FMP bucket to members (see the module docstring).

    Returns {"symbols": n warmed, "ok": n calls that returned, "failed": n that raised,
    "stopped": "budget" | None, "fmp_waits": n bucket re-reads spent below the reserve}."""
    from api.services import single_flight
    surfaces = _surfaces() if surfaces is None else surfaces
    tokens = _fmp_tokens if fmp_tokens is None else fmp_tokens
    stats: dict[str, Any] = {"symbols": 0, "ok": 0, "failed": 0, "stopped": None,
                             "fmp_waits": 0}
    start = clock()
    with single_flight.background():
        for i, sym in enumerate(symbols):
            if clock() - start > budget_seconds:
                stats["stopped"] = "budget"
                break
            if i:
                sleep(pace_seconds)
            waited = False
            while tokens() < fmp_reserve and clock() - start <= budget_seconds:
                waited = True
                stats["fmp_waits"] += 1
                sleep(reserve_poll_seconds)
            if waited and clock() - start > budget_seconds:
                stats["stopped"] = "budget"
                break
            t0 = clock()
            for name, fn in surfaces:
                try:
                    fn(sym)
                    stats["ok"] += 1
                except Exception as e:                           # noqa: BLE001
                    stats["failed"] += 1
                    _log.info("[research-warm] %s %s failed: %s", name, sym, e)
            stats["symbols"] += 1
            _log.info("[research-warm] %s done in %.1fs", sym, clock() - t0)
    return stats
