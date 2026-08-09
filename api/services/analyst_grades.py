"""Analyst ratings + price targets + recent grade actions (FMP Ultimate).

Composes five FMP stable endpoints into one analyst picture for a ticker:
  - grades-consensus      → current buy/hold/sell bucket counts + label
  - price-target-consensus→ target high/low/median/consensus
  - price-target-summary  → recency-weighted avg targets (month/quarter/year)
  - grades                → recent upgrade/downgrade/maintain actions (feed)
  - grades-historical     → monthly bucket snapshots (rating trend)

Returns one dict (or None when nothing resolves). Every sub-call is defensive —
a single failing endpoint nulls only its own slice, never the whole payload.
Cached 6h. Never raises.
"""
from __future__ import annotations

import logging
from typing import Optional

from api.services import earnings_estimates as ee
from api.services.cache import cache as _cache_singleton

_log = logging.getLogger(__name__)

cache = _cache_singleton          # module-level handle — tests patch this
_TTL = 6 * 3_600                  # 6h — analyst data moves slowly intra-day
# A result shaped by a PROVIDER FAILURE self-heals in 5 min instead of 6h. The
# two are not the same thing: "this small-cap has no analyst coverage" is a real
# answer worth holding for 6h, while "FMP timed out" is not an answer at all and
# used to be indistinguishable from it — both cached `{"_miss": True}` for the
# full 6h, so one transient blip blanked a ticker's analyst panel for the rest
# of the session.
_FAIL_TTL = 300
_MAX_ACTIONS = 12                 # recent grade actions to surface
_MAX_TREND = 6                    # months of rating-bucket history


def _num(v):
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _first(data):
    return data[0] if isinstance(data, list) and data and isinstance(data[0], dict) else None


def _consensus(ticker: str) -> Optional[dict]:
    row = _first(ee._fmp_get("/stable/grades-consensus", {"symbol": ticker}, timeout=4))
    if not row:
        return None
    buckets = {k: int(row.get(k) or 0) for k in
               ("strongBuy", "buy", "hold", "sell", "strongSell")}
    total = sum(buckets.values())
    if total == 0:
        return None
    return {**buckets, "total": total, "label": row.get("consensus") or None}


def _price_target(ticker: str) -> Optional[dict]:
    con = _first(ee._fmp_get("/stable/price-target-consensus", {"symbol": ticker}, timeout=4)) or {}
    summ = _first(ee._fmp_get("/stable/price-target-summary", {"symbol": ticker}, timeout=4)) or {}
    out = {
        "high":      _num(con.get("targetHigh")),
        "low":       _num(con.get("targetLow")),
        "median":    _num(con.get("targetMedian")),
        "consensus": _num(con.get("targetConsensus")),
        "last_month":   {"count": int(summ.get("lastMonthCount") or 0),
                         "avg": _num(summ.get("lastMonthAvgPriceTarget"))},
        "last_quarter": {"count": int(summ.get("lastQuarterCount") or 0),
                         "avg": _num(summ.get("lastQuarterAvgPriceTarget"))},
        "last_year":    {"count": int(summ.get("lastYearCount") or 0),
                         "avg": _num(summ.get("lastYearAvgPriceTarget"))},
    }
    if out["consensus"] is None and out["last_quarter"]["avg"] is None:
        return None
    return out


def _recent_actions(ticker: str) -> list[dict]:
    data = ee._fmp_get("/stable/grades", {"symbol": ticker, "limit": 40}, timeout=4)
    if not isinstance(data, list):
        return []
    out: list[dict] = []
    for row in data:
        if not isinstance(row, dict):
            continue
        action = (row.get("action") or "").lower()       # upgrade/downgrade/maintain/initiate
        out.append({
            "date":       str(row.get("date") or "")[:10],
            "company":    row.get("gradingCompany") or "",
            "action":     action,
            "from_grade": row.get("previousGrade") or None,
            "to_grade":   row.get("newGrade") or None,
        })
    # FMP returns newest-first; keep order, cap.
    return out[:_MAX_ACTIONS]


def _trend(ticker: str) -> list[dict]:
    data = ee._fmp_get("/stable/grades-historical", {"symbol": ticker, "limit": _MAX_TREND}, timeout=4)
    if not isinstance(data, list):
        return []
    out: list[dict] = []
    for row in data:
        if not isinstance(row, dict):
            continue
        out.append({
            "date":       str(row.get("date") or "")[:10],
            "strongBuy":  int(row.get("analystRatingsStrongBuy") or 0),
            "buy":        int(row.get("analystRatingsBuy") or 0),
            "hold":       int(row.get("analystRatingsHold") or 0),
            "sell":       int(row.get("analystRatingsSell") or 0),
            "strongSell": int(row.get("analystRatingsStrongSell") or 0),
        })
    return out[:_MAX_TREND]


def get_analyst_grades(ticker: str) -> Optional[dict]:
    """Composed analyst picture for `ticker`, or None when nothing resolves."""
    ticker = (ticker or "").upper().strip()
    if not ticker:
        return None

    cache_key = f"analyst_grades_{ticker}"
    cached = cache.get(cache_key)
    if cached is not None:
        return None if cached.get("_miss") else cached

    # Track whether each leg ANSWERED, separately from what it answered. An
    # empty result from a leg that ran cleanly is a fact about the company; an
    # empty result from a leg that raised is a fact about the provider. Same
    # shape as research/ownership.py's yf_ok/insider_ok.
    all_answered = True

    # The four legs are INDEPENDENT provider calls. Run sequentially they cost
    # ~3.25s end-to-end — over the 2-3s budget this panel is held to — while
    # each leg is only ~0.8s. Fan them out and the endpoint costs the slowest
    # leg instead of their sum.
    #
    # Its OWN executor, not a plain run_in_threadpool: this handler is a sync
    # `def`, so it is already occupying one anyio worker thread. Borrowing three
    # more from that same shared pool is what starves the request path under
    # load.
    from concurrent.futures import ThreadPoolExecutor

    legs = (("consensus", _consensus, None),
            ("price_target", _price_target, None),
            ("actions", _recent_actions, []),
            ("trend", _trend, []))
    got: dict = {}
    with ThreadPoolExecutor(max_workers=len(legs),
                            thread_name_prefix="grades") as ex:
        futures = [(name, on_fail, ex.submit(fn, ticker))
                   for name, fn, on_fail in legs]
        for name, on_fail, fut in futures:
            try:
                got[name] = fut.result()
            except Exception:
                # Per-leg isolation is preserved exactly: one failing endpoint
                # nulls only its own slice and flips all_answered, which is what
                # separates "no analyst coverage" (hold 6h) from "provider
                # blipped" (retry in 5 min).
                got[name] = on_fail
                all_answered = False

    consensus = got["consensus"]
    price_target = got["price_target"]
    actions = got["actions"]
    trend = got["trend"]

    if not (consensus or price_target or actions):
        # No data. Hold it 6h only if every provider actually ANSWERED — that
        # is genuine "no analyst coverage". If any leg raised, this emptiness
        # is the outage talking, so retry in 5 min.
        # Deliberately this module's own `cache`, not cache_policy's
        # set_by_completeness: that helper writes through the shared singleton
        # and would bypass the module-level seam the existing tests patch. The
        # policy is identical — the completeness decision is what matters, not
        # which helper applies it.
        cache.set(cache_key, {"_miss": True},
                  ttl=_TTL if all_answered else _FAIL_TTL)
        return None

    payload = {
        "symbol":         ticker,
        "consensus":      consensus,
        "price_target":   price_target,
        "recent_actions": actions,
        "trend":          trend,
    }
    # A payload assembled while a leg was down is missing a section it would
    # otherwise have; hold it briefly so the gap fills rather than persisting
    # a partial picture for 6h.
    cache.set(cache_key, payload, ttl=_TTL if all_answered else _FAIL_TTL)
    return payload
