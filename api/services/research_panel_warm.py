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
                         clock: Callable[[], float] = time.monotonic) -> dict[str, Any]:
    """Warm each surface for each symbol, best-effort. Never raises.

    Returns {"symbols": n warmed, "ok": n calls that returned, "failed": n that raised,
    "stopped": "budget" | None}."""
    surfaces = _surfaces() if surfaces is None else surfaces
    stats: dict[str, Any] = {"symbols": 0, "ok": 0, "failed": 0, "stopped": None}
    start = clock()
    for i, sym in enumerate(symbols):
        if clock() - start > budget_seconds:
            stats["stopped"] = "budget"
            break
        if i:
            sleep(pace_seconds)
        for name, fn in surfaces:
            try:
                fn(sym)
                stats["ok"] += 1
            except Exception as e:                               # noqa: BLE001
                stats["failed"] += 1
                _log.info("[research-warm] %s %s failed: %s", name, sym, e)
        stats["symbols"] += 1
    return stats
