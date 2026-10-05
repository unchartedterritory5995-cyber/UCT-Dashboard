"""FT-071 -- the broker-estimates view (Bloomberg EEB's "# Ests beside the mean,
firms named"), as far as the data on this plan reaches. Research > Depth >
"Estimates by contributor".

What it shows, per upcoming fiscal quarter, from FMP `/stable/analyst-estimates`
(period=quarter): the consensus EPS and revenue MEAN beside the number of
estimates behind it, the high and low, and the dispersion (high - low) / |mean|.
Beside that, the firms that have most recently acted on the stock, by name, from
the Analyst Ratings tab's own FMP grades read (`analyst_grades`, cache only).

What it does not show, and says so. FMP returns consensus AGGREGATES only (mean,
high, low, and the count); no estimate on this plan is attributed to a named
analyst or firm. `contributors` is therefore `unavailable` with that reason, and
the firm list is labelled as rating actions, never as the people behind the EPS
mean.

MERGE POINT. lane/cov-05-07-09 (COV-07, `api/services/estimate_history.py`,
not merged when this was written) snapshots the same endpoint daily and stores
`n_eps` / `n_rev` per period. Once it lands, this module's consensus read should
come from that store's newest snapshot (one vendor read per symbol per day, not
two), and this panel should render beside its Estimate history tab.

Request path: an in-process cache only. A miss is read on this module's own
one-thread worker and answered as pending. DARK behind BROKER_ESTIMATES_ENABLED.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional

_logger = logging.getLogger(__name__)

ENABLED_ENV = "BROKER_ESTIMATES_ENABLED"
SOURCE = "FMP /stable/analyst-estimates (period=quarter), consensus aggregates"
FIRMS_SOURCE = "FMP grades (the Analyst Ratings tab's read, analyst_grades), rating actions only"
CONTRIBUTORS_REASON = ("FMP /stable/analyst-estimates returns consensus aggregates only (mean, high, "
                       "low and the number of estimates); no estimate on this plan is attributed to "
                       "a named analyst or firm")
MERGE_POINT = ("lane/cov-05-07-09 COV-07 estimate_history: read the consensus from its newest daily "
               "snapshot (n_eps/n_rev already stored) and render beside the Estimate history tab")
_TTL_OK = 6 * 3600
_TTL_FAIL = 600
_MAX_QUEUED = 8
QUARTERS = 8


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


def _f(v) -> Optional[float]:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x else None


def _i(v) -> Optional[int]:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _dispersion(lo, hi, mean) -> Optional[float]:
    if lo is None or hi is None or mean is None or mean == 0:
        return None
    return round((hi - lo) / abs(mean) * 100, 1)


def periods(rows: list[dict], today: Optional[str] = None, limit: int = QUARTERS) -> list[dict]:
    """Upcoming quarters (period end on/after today), soonest first."""
    today = today or time.strftime("%Y-%m-%d")
    out = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        end = str(r.get("date") or "")[:10]
        if not end or end < today:
            continue
        e_avg, e_lo, e_hi = _f(r.get("epsAvg")), _f(r.get("epsLow")), _f(r.get("epsHigh"))
        r_avg, r_lo, r_hi = _f(r.get("revenueAvg")), _f(r.get("revenueLow")), _f(r.get("revenueHigh"))
        out.append({"period_end": end,
                    "eps": {"mean": e_avg, "low": e_lo, "high": e_hi, "n": _i(r.get("numAnalystsEps")),
                            "dispersion_pct": _dispersion(e_lo, e_hi, e_avg)},
                    "revenue": {"mean": r_avg, "low": r_lo, "high": r_hi, "n": _i(r.get("numAnalystsRevenue")),
                                "dispersion_pct": _dispersion(r_lo, r_hi, r_avg)}})
    out.sort(key=lambda p: p["period_end"])
    return out[:limit]


# ── the vendor read: OFF the request path ───────────────────────────────────

_lock = threading.Lock()
_cache: dict[str, tuple[float, float, Any]] = {}      # sym -> (read_at, ttl, rows | None)
_queued: set[str] = set()
_executor: Optional[ThreadPoolExecutor] = None


def _fetch_rows(sym: str) -> list[dict]:
    """Indirection so tests replace it by name."""
    from api.services import fmp_client
    res = fmp_client.get_analyst_estimates(sym, period="quarter", limit=16)
    return res.value if isinstance(res.value, list) else []


def _read(sym: str) -> None:
    try:
        rows, ttl = _fetch_rows(sym), _TTL_OK
    except Exception as exc:  # noqa: BLE001 -- recorded as a state
        _logger.warning("broker estimates read failed for %s: %s", sym, exc)
        rows, ttl = None, _TTL_FAIL
    with _lock:
        _cache[sym] = (time.time(), ttl, rows)
        _queued.discard(sym)


def _schedule(sym: str) -> bool:
    global _executor
    if not is_enabled():
        return False
    with _lock:
        if sym in _queued or len(_queued) >= _MAX_QUEUED:
            return False
        _queued.add(sym)
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="broker-estimates")
        ex = _executor
    ex.submit(_read, sym)
    return True


def _firms(sym: str) -> dict:
    """The Analyst Ratings tab's cached grades read; never a vendor call here."""
    from api.services.cache import cache
    hit = cache.get(f"analyst_grades_{sym}")
    if not hit or hit.get("_miss"):
        return {"state": "not_loaded", "source": FIRMS_SOURCE,
                "reason": "no rating actions are cached for this ticker yet; the Analyst Ratings tab loads them"}
    items = ((hit.get("recent_actions") or {}).get("items") if isinstance(hit.get("recent_actions"), dict)
             else hit.get("recent_actions")) or []
    named = [{"date": a.get("date"), "firm": a.get("company"), "action": a.get("action"),
              "from_grade": a.get("from_grade"), "to_grade": a.get("to_grade")}
             for a in items if isinstance(a, dict) and a.get("company")]
    return {"state": "ok" if named else "empty", "source": FIRMS_SOURCE, "actions": named[:20]}


def view(sym: str, today: Optional[str] = None) -> dict:
    sym = (sym or "").upper().strip()
    base = {"ticker": sym, "source": SOURCE, "merge_point": MERGE_POINT,
            "contributors": {"state": "unavailable", "reason": CONTRIBUTORS_REASON},
            "firms": _firms(sym)}
    now = time.time()
    with _lock:
        hit = _cache.get(sym)
    if hit is None or now - hit[0] > hit[1]:
        queued = _schedule(sym)
        if hit is None:
            return {**base, "state": "pending", "queued": queued,
                    "reason": "the consensus is being read; reopen in a minute"}
    read_at, _ttl, rows = hit
    if rows is None:
        return {**base, "state": "unavailable", "read_at": read_at,
                "reason": "the consensus estimates could not be read"}
    ps = periods(rows, today=today)
    if not ps:
        return {**base, "state": "none", "read_at": read_at,
                "reason": "no upcoming quarter carries a consensus estimate"}
    return {**base, "state": "ok", "read_at": read_at, "periods": ps}
