"""Fundamentals router — wraps fundamentals.get_fundamentals + FMP metrics
trio (primary) + Finnhub /stock/metric (fallback).

GET /api/fundamentals/{ticker}
Returns: {market_cap, forward_pe, beta, week52_high, week52_low, avg_vol, div_yield}

All fields are null-safe; never raises on missing data.

── Task 9 migration (2026-08-05) ───────────────────────────────────────────
Finnhub's `/stock/metric?metric=all` used to be the SOLE source of 52-week
range / avg volume / the market-cap fallback. It is now migrated to FMP's
`stable/quote` + `stable/key-metrics-ttm` + `stable/ratios-ttm` trio
(`_fmp_metrics_get`) as PRIMARY, with Finnhub kept as a genuine fallback
(`_fh_metric_get` — unchanged, still called every request) rather than
deleted, because `/stock/metric` is not known-403 and because exactly one
field (`avg_vol`, a 10-day average volume) has **no FMP equivalent** in this
trio — verified live 2026-08-05 against `stable/quote`, whose only volume
field is a single day's `volume`, not an average. `avg_vol` therefore stays
Finnhub-sourced permanently; `week52_high`/`week52_low`/the `market_cap`
fallback are now FMP-primary, Finnhub-fallback.
"""
from __future__ import annotations

import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor, wait as _futures_wait
from typing import Any

import requests
from fastapi import APIRouter, Depends, HTTPException, Query

from api.services.fundamentals import get_fundamentals, _fmt_billions
from api.services.earnings_table import get_earnings_table
from api.services import fundamentals_snapshot_store as snap_store
from api.services.cache import cache
from api.services.cache_policy import set_by_completeness
from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

_log = logging.getLogger(__name__)
router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the earnings table.

    ⛔ Defined HERE, never imported from a sibling — each router owns its own
    402 sentence so "which surface refused me" is readable off the message.
    Rail: `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`

    Why paid: `get_earnings_table` is the FMP-Ultimate-backed actual-vs-estimate
    history whose lookback window scales with the requested year
    (`_history_limit`), and it falls through to the **AlphaVantage 25-calls-a-day**
    budget the Model Book's own earnings surface shares. A free account walking
    tickers drained a quota the paying product depends on.

    ⚠️ SCOPE: this gates `/api/fundamentals/earnings-table` ONLY.
    `/api/fundamentals/{ticker}` carries no session dependency at all — it is in
    the sweep's "no dependency" bucket, not the `get_current_user` bucket this
    task was asked to close. It is reported in the report, not changed here.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="The earnings table requires a paid plan")
    return user

_FH_METRIC_TTL = 3600  # 1 hour -- only for a build with at least one field resolved
_FUND_FAIL_TTL = 300   # 5 min -- an all-null build self-heals fast instead of
                       # riding the full hour (or, worse, the 7-day disk ceiling)
_TIMEOUT = 10
_SNAP_KIND = "fund_snapshot_v3"       # /api/fundamentals/{ticker} payloads (v3: +inception/inst-own)
_SNAP_STALE_MAX = 7 * 86400           # serve-stale ceiling for the compact snapshot

# ── FMP metrics trio (Task 9) ───────────────────────────────────────────────
# A SEPARATE, OWN timeout budget from Finnhub's `_TIMEOUT` above — FMP is a
# different provider entirely and must never share finnhub_client's token
# bucket / budget. `_FMP_TOTAL_TIMEOUT` is the HARD wall-clock cap on the
# whole 3-way fan-out (the 524-outage class named in the plan's Global
# Constraints: an unbounded/slow external call on the request path pins a
# worker in the ONE shared anyio threadpool). `_FMP_POOL_WORKERS` bounds the
# pool to exactly one worker per endpoint — it never grows with request
# volume, mirroring the fixed-width pools already in this codebase
# (`insider.get_recent_insider_buys` = 10-wide, `fundamentals.compare_fundamentals`
# = <=6-wide).
_FMP_ENDPOINTS = ("quote", "key-metrics-ttm", "ratios-ttm")
_FMP_PER_CALL_TIMEOUT = 6      # seconds, per individual FMP leg
_FMP_TOTAL_TIMEOUT = 7         # seconds, hard cap for the whole fan-out
_FMP_POOL_WORKERS = 3          # exactly len(_FMP_ENDPOINTS) -- bounded, fixed


def _fh_metric_get(ticker: str) -> dict[str, Any]:
    """Fetch Finnhub /stock/metric?metric=all for avg volume + extras.

    Routed through the shared api.services.finnhub_client.fh_get (2026-08-05)
    — every Finnhub caller in the codebase shares ONE process-wide token
    bucket / 429 cooldown (see finnhub_client.py's module docstring).
    """
    ck = f"fh_metric::{ticker.upper()}"
    hit = cache.get(ck)
    if hit is not None:
        return hit
    from api.services.finnhub_client import fh_get
    data = fh_get("/stock/metric", {"symbol": ticker.upper(), "metric": "all"}, timeout=_TIMEOUT)
    if not isinstance(data, dict):
        return {}
    result = data.get("metric") or {}
    cache.set(ck, result, _FH_METRIC_TTL)
    return result


def _fmp_get(path: str, params: dict, timeout: int) -> Any:
    """Fire one FMP `stable/*` GET. Returns parsed JSON (list or dict) or
    None on any failure (missing key, network error, non-2xx). Own timeout
    budget, own try/except — never raises, never touches finnhub_client."""
    key = os.environ.get("FMP_API_KEY", "")
    if not key:
        return None
    try:
        r = requests.get(
            f"https://financialmodelingprep.com/stable/{path}",
            params={**params, "apikey": key},
            timeout=timeout,
        )
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        _log.warning("FMP %s failed for %s: %s", path, params.get("symbol", "?"), exc)
        return None


def _fmp_metrics_get(ticker: str) -> dict[str, Any]:
    """FMP replacement for Finnhub's `/stock/metric?metric=all` — fans out to
    `stable/quote` + `stable/key-metrics-ttm` + `stable/ratios-ttm` (three
    calls where Finnhub had one) with a BOUNDED pool (exactly
    `_FMP_POOL_WORKERS` workers, one per endpoint, never grows) and a HARD
    TOTAL wall-clock timeout (`_FMP_TOTAL_TIMEOUT`) — a slow/hanging FMP leg
    cannot pin the shared anyio threadpool past that budget: any leg still
    running when the budget expires is ABANDONED (not waited on) via
    `shutdown(wait=False, cancel_futures=True)`.

    Returns one flat MERGED dict (mirrors `_fh_metric_get`'s flat shape so
    downstream extraction is provider-agnostic) — quote's `yearHigh`/
    `yearLow`/`marketCap`/... + key-metrics-ttm's EV multiples/current ratio/
    Graham number + ratios-ttm's margins. Only quote's fields currently feed
    the compact `/api/fundamentals` response (see Task 9 report — the other
    two endpoints' fields have no consumer yet per the Step-1 frontend
    enumeration); all three are still fetched, merged, and tested per-field
    so the fan-out/bound behavior is exercised and future consumers can read
    the extra keys without another provider migration.
    """
    ck = f"fmp_metrics::{ticker.upper()}"
    hit = cache.get(ck)
    if hit is not None:
        return hit

    sym = ticker.upper()

    def _one(path: str):
        return path, _fmp_get(path, {"symbol": sym}, timeout=_FMP_PER_CALL_TIMEOUT)

    merged: dict[str, Any] = {}
    ex = ThreadPoolExecutor(max_workers=_FMP_POOL_WORKERS)
    try:
        futures = {ex.submit(_one, path): path for path in _FMP_ENDPOINTS}
        done, not_done = _futures_wait(futures, timeout=_FMP_TOTAL_TIMEOUT)
        for fut in done:
            try:
                _path, data = fut.result()
            except Exception as exc:
                _log.warning("FMP leg failed for %s: %s", sym, exc)
                continue
            row = data[0] if isinstance(data, list) and data else (data if isinstance(data, dict) else None)
            if isinstance(row, dict):
                merged.update(row)
        if not_done:
            _log.warning(
                "FMP metrics fan-out exceeded %ss total budget for %s (%d leg(s) abandoned)",
                _FMP_TOTAL_TIMEOUT, sym, len(not_done),
            )
    finally:
        # wait=False: the calling (request-path) thread does NOT block on any
        # leg still running past the total budget -- that is what makes
        # _FMP_TOTAL_TIMEOUT a genuinely HARD cap instead of degrading to
        # "sum of per-call timeouts". cancel_futures=True (3.9+) drops any
        # not-yet-started work; already-running threads finish in the
        # background (each still bounded by its own _FMP_PER_CALL_TIMEOUT)
        # and are discarded on completion.
        ex.shutdown(wait=False, cancel_futures=True)

    # Honest-degradation: a complete miss self-heals in 5 min (matches
    # _FUND_FAIL_TTL), not a full hour -- mirrors the negative-cache pattern
    # already used for the whole-response cache write below, applied here at
    # the provider-leg level too so a transient FMP blip doesn't pin a blank
    # for an hour.
    cache.set(ck, merged, _FH_METRIC_TTL if merged else _FUND_FAIL_TTL)
    return merged


@router.get("/api/fundamentals/earnings-table")
def get_earnings_table_endpoint(
    sym: str = Query(...),
    debug: int = Query(0),
    user: dict = Depends(require_paid),
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

    # FMP metrics trio (primary, Task 9) + Finnhub /stock/metric (fallback —
    # kept, not deleted, both because /stock/metric is not known-403 and
    # because avg_vol has no FMP equivalent in the trio, see module docstring).
    fmp = {}
    try:
        fmp = _fmp_metrics_get(sym)
    except Exception as e:
        _log.debug("FMP metrics failed for %s: %s", sym, e)

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

    # avg_vol: Finnhub-only. Verified live 2026-08-05 against stable/quote +
    # stable/key-metrics-ttm + stable/ratios-ttm — none of the three carries a
    # 10-day/52-week AVERAGE volume field (`quote.volume` is a single day's
    # volume, a different statistic entirely; substituting it here would be
    # exactly the "substituted stat" the honest-degradation law forbids). This
    # field therefore has no FMP leg to prefer — it renders from Finnhub or
    # not at all, same fallback-of-last-resort role Finnhub now plays for the
    # other two fields below.
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

    # 52-week range: FMP `stable/quote`'s `yearHigh`/`yearLow` are now
    # PRIMARY — verified live 2026-08-05 (AAPL yearHigh=344.57/yearLow=205.59)
    # to be plain dollar prices, the SAME unit Finnhub's `52WeekHigh`/
    # `52WeekLow` always were, so no conversion is needed switching providers
    # here (unlike market_cap below). Finnhub is the fallback when FMP's
    # fetch failed or came back empty.
    w52_high = _safe_float(fmp.get("yearHigh"))
    if w52_high is None:
        w52_high = _safe_float(fh.get("52WeekHigh"))
    w52_low = _safe_float(fmp.get("yearLow"))
    if w52_low is None:
        w52_low = _safe_float(fh.get("52WeekLow"))

    # market_cap: yfinance is primary (right in the overwhelming majority of
    # cases) but its `.info` payload sometimes omits `marketCap` ENTIRELY for
    # an unremarkable mega-cap — confirmed live 2026-08-05 for AMD and JPM,
    # both of which resolved every other field cleanly. FMP `stable/quote`'s
    # `marketCap` (already fetched by `_fmp_metrics_get` above for the
    # 52-week range — no new API call) is now the first fallback used ONLY
    # when yfinance has nothing, never overriding a value yfinance already
    # resolved. Finnhub's `marketCapitalization` is the final fallback below
    # that, kept for when FMP's fetch also comes back empty.
    #
    # ⚠️ UNIT: FMP's `quote.marketCap` is RAW DOLLARS — verified live
    # 2026-08-05 (AAPL 4,567,767,716,000 ≈ $4.57T, matches reality) — a
    # DIFFERENT unit than Finnhub's `marketCapitalization`, which is MILLIONS
    # of dollars (same millions-family quirk as the avg_vol unit documented
    # above). Do NOT apply Finnhub's `* 1e6` scale to the FMP value — that
    # would inflate it a million-fold. Each leg is scaled to dollars in its
    # OWN unit before going through the shared T/B/M formatter so every
    # source renders identically on the widget.
    market_cap = base.get("market_cap")
    if market_cap is None:
        cap_fmp = _safe_float(fmp.get("marketCap"))
        if cap_fmp is not None:
            market_cap = _fmt_billions(cap_fmp)
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
        "week52_high": w52_high if w52_high is not None else base.get("fifty_two_week_high"),
        "week52_low": w52_low if w52_low is not None else base.get("fifty_two_week_low"),
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

    # `complete` gates BOTH the memory cache write and the disk persist below
    # — the persist was already correctly guarded; the preceding cache.set
    # was not, so a transient all-null build (both get_fundamentals and the
    # Finnhub metric leg failed) used to pin a blank for the full hour
    # in-memory even though the disk copy correctly refused to be poisoned.
    complete = any(v is not None for k, v in result.items() if k != "ticker")
    set_by_completeness(
        f"api_fund::{sym}", result, complete=complete,
        ttl_ok=_FH_METRIC_TTL, ttl_partial=_FUND_FAIL_TTL,
        persist=lambda v: snap_store.put(_SNAP_KIND, sym, v, _FH_METRIC_TTL),
    )
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
