"""
Watchlist performance — batch multi-period returns for ticker lists.
Reuses _compute_returns pattern from theme_performance.py.
"""

import hashlib
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

_logger = logging.getLogger(__name__)

from api.services.cache import cache
from api.services.cache_policy import set_by_completeness
from api.services.massive import get_agg_bars
from api.services.theme_performance import _compute_returns_with_refs

_MAX_WORKERS = 2  # Conservative for Railway 512MB — prevents thread explosion
_CACHE_TTL = 300  # 5 minutes
_CACHE_TTL_PARTIAL = 30  # any per-ticker fetch failure in the batch — retry in 30s, not 5 min

# Periods for which we surface the REFERENCE close price so the client can recompute
# the % against a live intraday price, tick-by-tick (like the daily change column).
_REF_PERIODS = ("5d", "30d", "60d", "90d")

# ── D4 CP2 — per-ticker addressing (gate fingerprint 40caca541) ──────────────
#
# ⚰️ THE SET KEY WAS THE ONLY CACHE, and that is the defect this checkpoint
# removes. `wl_perf:{md5(sorted tickers)}` wraps a loop that is ALREADY
# per-ticker, so:
#
#   - two members whose watchlists share 40 of 50 names shared NOTHING, and the
#     41st distinct list was a 41st full recompute of 50 tickers;
#   - ONE completeness verdict covered the whole batch, so a single failed
#     ticker either marked every healthy peer partial, or — before the
#     `any_failed` fix — pinned its own all-None row at the full 5-minute TTL
#     against peers that had succeeded.
#
# ⭐ THE SET KEY IS KEPT AS A FAST PATH, never deleted. SPEC-D4 §2.4 rule 2: a
# request-set key is fine OVER a per-entity cache and wrong AS the cache. A miss
# on it falls through to the per-ticker tier rather than refilling it, which is
# the shape `live_prices` already uses correctly twelve files away.
#
# ⛔ `api/services/cache.py` IS UNTOUCHED (D4-D): flow-worker runs it and does
# not redeploy for it.

_TICKER_TTL = 300          # a healthy per-ticker row
_TICKER_TTL_PARTIAL = 30   # a row whose fetch failed — retry soon, never pin it

#: Observability ONLY. ⛔ NEVER a gate on serving: a cache that can refuse to
#: serve because its counter is unhappy is a new failure mode, and the scope
#: says so in as many words.
_counters = {"set_hit": 0, "ticker_hit": 0, "miss": 0}


def _ticker_key(ticker: str, as_of: str) -> str:
    """One entry per entity, shared across every member — §2.4 rule 1."""
    return f"wl_returns::{ticker}::{as_of}"


def _bump(name: str) -> None:
    """⛔⛔ A COUNTER MAY NEVER RAISE INTO THE SERVING PATH, and this is not
    theoretical: the CP2 test that damages the counter dict caught a bare
    `_counters[name] += 1` throwing KeyError straight out of `get_batch_returns`.
    The scope says the counter is observability and never a gate on serving — an
    exception from it IS a gate, and the harshest kind."""
    try:
        _counters[name] = _counters.get(name, 0) + 1
    except Exception:                                   # noqa: BLE001
        pass


def counters() -> dict:
    return dict(_counters)


def hit_rate() -> float | None:
    """⛔ None when nothing has been observed. A rate over zero calls is 0.0,
    which reads as 'the cache never hits' rather than 'nobody asked'."""
    total = sum(_counters.values())
    if total == 0:
        return None
    return (_counters["set_hit"] + _counters["ticker_hit"]) / total


def reset_counters() -> None:
    """Restores the canonical keys rather than zeroing whatever is there — a
    cleared dict must come back whole, not empty."""
    _counters.clear()
    _counters.update({"set_hit": 0, "ticker_hit": 0, "miss": 0})


def _fetch_ticker_returns(ticker: str) -> dict:
    to_date = date.today().isoformat()
    from_date = (date.today() - timedelta(days=400)).isoformat()
    bars = get_agg_bars(ticker, from_date, to_date)
    r, refs = _compute_returns_with_refs(bars)
    out = {k: r.get(k) for k in ("1d", "1w", "1m", "3m", "ytd", "5d", "30d", "60d", "90d")}
    # Reference closes for the N-day columns → client recomputes % vs the live price.
    out["refs"] = {k: refs.get(k) for k in _REF_PERIODS}
    return out


def get_batch_returns(tickers: list[str]) -> dict:
    """Compute 1d/1w/1m/3m/ytd + 5d/30d/60d/90d returns for a batch of tickers.

    Returns:
        {ticker: {1d, 1w, 1m, 3m, ytd, 5d, 30d, 60d, 90d}} dict
    """
    deduped = sorted(set(t.upper() for t in tickers))
    if not deduped:
        return {}
    as_of = date.today().isoformat()
    cache_key = "wl_perf:" + hashlib.md5(",".join(deduped).encode()).hexdigest()

    # TIER 1 — the request-set key, kept as a FAST PATH (§2.4 rule 2).
    cached = cache.get(cache_key)
    if cached is not None:
        _bump("set_hit")
        return cached

    # TIER 2 — the per-entity cache, which is the REAL one. A set-key miss falls
    # THROUGH to here rather than refilling the set key, so two members sharing
    # 40 of 50 names now share those 40 rows.
    results: dict = {}
    missing = []
    for ticker in deduped:
        hit = cache.get(_ticker_key(ticker, as_of))
        if hit is not None:
            results[ticker] = hit
            _bump("ticker_hit")
        else:
            missing.append(ticker)
            _bump("miss")

    any_failed = False
    if missing:
        with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
            futures = {pool.submit(_fetch_ticker_returns, t): t for t in missing}
            for future in futures:
                ticker = futures[future]
                try:
                    row = future.result(timeout=15)
                    ok = True
                except Exception as e:
                    _logger.warning("Failed to fetch returns for %s: %s", ticker, e)
                    any_failed = True
                    ok = False
                    row = {"1d": None, "1w": None, "1m": None, "3m": None, "ytd": None,
                           "5d": None, "30d": None, "60d": None, "90d": None,
                           "refs": {k: None for k in _REF_PERIODS}}
                results[ticker] = row
                # ⛔⛔ COMPLETENESS IS NOW PER TICKER, and that is the whole point.
                # A failed ticker's all-None row can no longer be cached against
                # its healthy peers: it gets its OWN short TTL, and every peer
                # keeps the full one.
                set_by_completeness(_ticker_key(ticker, as_of), row, complete=ok,
                                    ttl_ok=_TICKER_TTL, ttl_partial=_TICKER_TTL_PARTIAL)

    # Refill the fast path. Still completeness-gated at the BATCH level, because
    # this key IS the batch — but it is no longer the only cache, so a short TTL
    # here costs one dict assembly, not 50 provider calls.
    set_by_completeness(cache_key, results, complete=not any_failed,
                         ttl_ok=_CACHE_TTL, ttl_partial=_CACHE_TTL_PARTIAL)
    return results
