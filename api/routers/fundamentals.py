"""Fundamentals router — wraps fundamentals.get_fundamentals + Finnhub /stock/metric.

GET /api/fundamentals/{ticker}
Returns: {market_cap, forward_pe, beta, week52_high, week52_low, avg_vol, div_yield}

All fields are null-safe; never raises on missing data.
"""
from __future__ import annotations

import logging
import os
import threading
from typing import Any

import requests
from fastapi import APIRouter, Depends, Query

from api.services.fundamentals import get_fundamentals, _fmt_billions
from api.services.earnings_table import get_earnings_table
from api.services import fundamentals_snapshot_store as snap_store
from api.services.cache import cache
from api.middleware.auth_middleware import get_current_user

_log = logging.getLogger(__name__)
router = APIRouter()

_FH_METRIC_TTL = 3600  # 1 hour
_TIMEOUT = 10
_SNAP_KIND = "fund_snapshot_v3"       # /api/fundamentals/{ticker} payloads (v3: +inception/inst-own)
_SNAP_STALE_MAX = 7 * 86400           # serve-stale ceiling for the compact snapshot


def _fh_metric_get(ticker: str) -> dict[str, Any]:
    """Fetch Finnhub /stock/metric?metric=all for avg volume + extras."""
    fh_key = os.environ.get("FINNHUB_API_KEY", "")
    if not fh_key:
        return {}
    ck = f"fh_metric::{ticker.upper()}"
    hit = cache.get(ck)
    if hit is not None:
        return hit
    try:
        r = requests.get(
            "https://finnhub.io/api/v1/stock/metric",
            params={"symbol": ticker.upper(), "metric": "all", "token": fh_key},
            timeout=_TIMEOUT,
        )
        r.raise_for_status()
        data = r.json()
        result = data.get("metric") or {}
        cache.set(ck, result, _FH_METRIC_TTL)
        return result
    except Exception as e:
        _log.debug("Finnhub /stock/metric failed for %s: %s", ticker, e)
        return {}


@router.get("/api/fundamentals/earnings-table")
def get_earnings_table_endpoint(
    sym: str = Query(...),
    debug: int = Query(0),
    user: dict = Depends(get_current_user),
):
    """Annual EPS/Sales table + quarterly actual-vs-estimate strip for `sym`.
    Null-safe: unknown ticker returns empty arrays, never 500."""
    s = (sym or "").upper().strip()
    if not s:
        return {"ticker": "", "annual": [], "quarterly": []}
    try:
        return get_earnings_table(s, debug=bool(debug))
    except Exception as e:
        _log.warning("earnings-table failed for %s: %s", s, e)
        return {"ticker": s, "annual": [], "quarterly": []}


@router.get("/api/admin/fundamentals-health")
def fundamentals_health():
    """Current state of the fundamentals-accuracy monitor (no auth — read-only).

    Shows cycles run, tickers checked, cache entries auto-healed, the blank-sales
    rate (legit for pre-revenue names — watch for a spike), and any tickers still
    failing the widget invariants after self-heal (should be empty). A non-empty
    `flagged_current` = a real regression to investigate."""
    from api.services import fundamentals_monitor
    return fundamentals_monitor.get_state()


_snap_refresh_inflight: set[str] = set()
_snap_refresh_lock = threading.Lock()


def _schedule_snapshot_refresh(sym: str) -> None:
    """Background rebuild of the compact snapshot after a stale-serve."""
    with _snap_refresh_lock:
        if sym in _snap_refresh_inflight:
            return
        _snap_refresh_inflight.add(sym)

    def _run():
        try:
            _build_snapshot(sym)
        except Exception as e:
            _log.warning("fund snapshot bg refresh failed for %s: %s", sym, e)
        finally:
            with _snap_refresh_lock:
                _snap_refresh_inflight.discard(sym)

    threading.Thread(target=_run, daemon=True, name=f"fund-snap-refresh-{sym}").start()


def _build_snapshot(sym: str) -> dict[str, Any]:
    """Live build of the compact snapshot; populates memory + disk."""
    try:
        base = get_fundamentals(sym)
    except Exception as e:
        _log.warning("get_fundamentals failed for %s: %s", sym, e)
        base = {}

    if "error" in base:
        _log.debug("fundamentals error for %s: %s", sym, base.get("error"))
        base = {}

    # Finnhub /stock/metric for avg vol and 52-week range (more reliable than yfinance)
    fh = {}
    try:
        fh = _fh_metric_get(sym)
    except Exception as e:
        _log.debug("Finnhub metric failed for %s: %s", sym, e)

    def _safe_float(v) -> float | None:
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    # avg_vol: prefer Finnhub 10-week avg daily volume, fall back to yfinance averageVolume
    #
    # ⚠️ UNIT: Finnhub's volume metrics come back in MILLIONS of shares, NOT shares
    # — empirically verified 2026-08-04 against /stock/metric: AMD 29.65728,
    # AAPL 60.83381, F 64.44564, which are those names' real ~30M/~61M/~64M daily
    # volumes. This endpoint's contract (see the module docstring and the comment
    # on the `avg_vol` key below) is SHARES, and both consumers assume shares:
    # `SetupSection.compactVol` and the older `FundamentalsStrip.fmtVol`. Passing
    # the raw Finnhub number through therefore rendered "0K" for every ticker in
    # the research modal (29.65728/1000 rounds to 0) and a bare "29.65728" in the
    # fundamentals strip. Normalize HERE, at the boundary, so the documented
    # contract is true for every consumer instead of each one carrying a
    # provider quirk. Found by Task 12 GATE a in a live browser; no fixture-based
    # test could see it, because the defect is in the unit contract, not the
    # formatter. (`52WeekAverageDailyVolume` returns None for every symbol probed,
    # so it is unverifiable in practice, but it is the same provider metric
    # family and gets the same treatment rather than a silently different unit.)
    _FH_VOL_MILLIONS = 1e6
    avg_vol_fh = _safe_float(fh.get("10DayAverageTradingVolume") or fh.get("averageDailyVolume10Day"))
    if avg_vol_fh is None:
        avg_vol_fh = _safe_float(fh.get("52WeekAverageDailyVolume"))
    if avg_vol_fh is not None:
        avg_vol_fh *= _FH_VOL_MILLIONS

    # 52-week range: prefer Finnhub annual highs
    w52_high_fh = _safe_float(fh.get("52WeekHigh"))
    w52_low_fh = _safe_float(fh.get("52WeekLow"))

    # market_cap: yfinance is primary (right in the overwhelming majority of
    # cases) but its `.info` payload sometimes omits `marketCap` ENTIRELY for
    # an unremarkable mega-cap — confirmed live 2026-08-05 for AMD and JPM,
    # both of which resolved every other field cleanly. Finnhub's
    # `marketCapitalization` (already fetched by `_fh_metric_get` above for
    # avg_vol/52-week range — no new API call) covers exactly this gap, so it
    # is used as a fallback ONLY when yfinance has nothing, never overriding a
    # value yfinance already resolved. Finnhub reports it in MILLIONS of
    # dollars (same unit family as the avg_vol millions quirk documented
    # above), so it is scaled to dollars before going through the same
    # T/B/M formatter yfinance's figure already uses, so both sources render
    # identically on the widget.
    market_cap = base.get("market_cap")
    if market_cap is None:
        cap_millions_fh = _safe_float(fh.get("marketCapitalization"))
        if cap_millions_fh is not None:
            market_cap = _fmt_billions(cap_millions_fh * 1e6)

    result: dict[str, Any] = {
        "ticker": sym,
        "name": base.get("name"),                       # company name (widget header)
        "market_cap": market_cap,                       # formatted string e.g. "$1.23T"
        "forward_pe": base.get("pe_forward"),           # float or None
        "beta": base.get("beta"),                       # float or None
        "week52_high": w52_high_fh or base.get("fifty_two_week_high"),
        "week52_low": w52_low_fh or base.get("fifty_two_week_low"),
        "avg_vol": avg_vol_fh,                          # 10-day avg daily vol (shares)
        "div_yield": base.get("dividend_yield_pct"),    # pct e.g. 1.5
        # Stock Profile widget "More Info": key metrics + company profile
        "next_earnings": base.get("next_earnings"),     # ISO 'YYYY-MM-DD'
        "float_shares": base.get("float_shares"),       # shares (raw)
        "short_pct_float": base.get("short_pct_float"), # pct e.g. 1.2
        "employees": base.get("employees"),
        "website": base.get("website"),
        "ceo": base.get("ceo"),
        "hq": base.get("hq"),
        "inception": base.get("inception"),                 # ISO first-trade date → Age
        "inst_own_pct": base.get("held_pct_institutions"),  # pct e.g. 75.4
    }

    cache.set(f"api_fund::{sym}", result, _FH_METRIC_TTL)
    # Persist only when at least one field resolved — a transient all-null
    # build must not become a week of stale-served blanks.
    if any(v is not None for k, v in result.items() if k != "ticker"):
        snap_store.put(_SNAP_KIND, sym, result, _FH_METRIC_TTL)
    return result


@router.get("/api/fundamentals/{ticker}")
def get_fundamentals_endpoint(ticker: str):
    """Compact fundamentals for a ticker.

    Returns {market_cap, forward_pe, beta, week52_high, week52_low, avg_vol, div_yield}.
    All fields are null-safe; returns empty dict (not error) on any failure.
    Serve order: memory → disk (fresh) → disk (stale ≤7d, background refresh)
    → live build — the yfinance/Finnhub round-trips never block a repeat view.
    """
    sym = (ticker or "").upper().strip()
    if not sym:
        return {}

    ck = f"api_fund::{sym}"
    hit = cache.get(ck)
    if hit is not None:
        return hit

    snap = snap_store.get(_SNAP_KIND, sym)
    if snap is not None:
        payload, age, ttl = snap
        if age <= ttl:
            cache.set(ck, payload, max(60, int(ttl - age)))
            return payload
        if age <= _SNAP_STALE_MAX:
            cache.set(ck, payload, 60)
            _schedule_snapshot_refresh(sym)
            return payload

    return _build_snapshot(sym)
