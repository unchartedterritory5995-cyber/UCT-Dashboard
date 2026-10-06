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
one-thread worker and answered as pending. DARK behind BROKER_ESTIMATES_ENABLED,
and the vendor read also honours FUNDAMENTALS_FMP_ANALYST_ESTIMATES (the same
gate every other analyst-estimates caller checks).

What is forward is decided by the SAME rule as the EE panel
(`estimates_consensus.is_unreported`): a quarter stays until the company has
reported it, not until its period end passes.

States: pending | ok | none (FMP answered, no forward quarter) | plan_gated
(FMP refused the endpoint on this plan: 401/403 or its cached-forbidden window)
| gated (FUNDAMENTALS_FMP_ANALYST_ESTIMATES off) | unavailable (the read
failed). Only `ok` and `none` are held for the long TTL.
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
ESTIMATES_GATE_ENV = "FUNDAMENTALS_FMP_ANALYST_ESTIMATES"
PLAN_GATED_REASON = ("FMP refused /stable/analyst-estimates on this plan (401/403); "
                     "this is an access problem, not an absence of analyst coverage")
GATED_REASON = ("analyst-estimates reads are switched off on this server "
                "(FUNDAMENTALS_FMP_ANALYST_ESTIMATES)")
_MAX_QUEUED = 8
QUARTERS = 8


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


def estimates_gate_on() -> bool:
    """FUNDAMENTALS_FMP_ANALYST_ESTIMATES, read per call with the same accepted
    spellings as annual_financials / earnings_table."""
    return os.environ.get(ESTIMATES_GATE_ENV, "0").strip().lower() in ("1", "true", "yes")


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


def periods(rows: list[dict], today: Optional[str] = None, limit: int = QUARTERS,
            last_report: Optional[str] = None) -> list[dict]:
    """Quarters not yet REPORTED, soonest first. The rule is EE's
    (`estimates_consensus.is_unreported`): a quarter whose period end has
    passed but which has not reported is the next one to report, and it stays."""
    from api.services.research.estimates_consensus import is_unreported
    today = today or time.strftime("%Y-%m-%d")
    out = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        end = str(r.get("date") or "")[:10]
        if len(end) != 10 or not is_unreported(end, last_report, today):
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
# sym -> (read_at, ttl, payload | None). payload = {"state": "ok"|"plan_gated",
# "rows": [...], "last_report": str|None, "grades": dict|None}; None = failed.
_cache: dict[str, tuple[float, float, Any]] = {}
_queued: set[str] = set()
_executor: Optional[ThreadPoolExecutor] = None


class PlanGated(Exception):
    """FMP refused the endpoint on this plan (401/403 or cached-forbidden)."""


def _fetch_rows(sym: str) -> list[dict]:
    """Indirection so tests replace it by name. Raises PlanGated on a refusal,
    returns [] for an answered-empty symbol, raises anything else."""
    from api.services import fmp_client
    try:
        res = fmp_client.get_analyst_estimates(sym, period="quarter", limit=16, timeout=10)
    except fmp_client.FMPNotFound:
        return []
    except fmp_client.FMPAuthError as exc:
        raise PlanGated(str(exc)) from exc
    if res.degraded is not None:
        # The cached-forbidden window: value is None. Reading it as [] is what
        # turned a plan refusal into six hours of "no consensus".
        raise PlanGated(f"FMP endpoint degraded ({res.degraded})")
    return res.value if isinstance(res.value, list) else []


def _fetch_last_report(sym: str) -> Optional[str]:
    """Newest report date with an actual; None when unknown (the shared rule
    then falls back to the grace window)."""
    from api.services.research.estimates_consensus import read_last_report
    _state, last = read_last_report(sym)
    return last


def _fetch_grades(sym: str) -> Optional[dict]:
    """BRKE's OWN read of the firms that acted on the stock. It used to read
    only the cache key the Analyst Ratings tab fills, so the list was empty
    unless a member happened to open ANR first. `get_analyst_grades` fills that
    same key, so ANR benefits from this read too."""
    from api.services.analyst_grades import get_analyst_grades
    return get_analyst_grades(sym)


def _read(sym: str) -> None:
    payload: Any
    try:
        rows = _fetch_rows(sym)
        payload, ttl = {"state": "ok", "rows": rows}, _TTL_OK
    except PlanGated as exc:
        _logger.warning("broker estimates plan-gated for %s: %s", sym, exc)
        payload, ttl = {"state": "plan_gated", "rows": []}, _TTL_FAIL
    except Exception as exc:  # noqa: BLE001 -- recorded as a state
        _logger.warning("broker estimates read failed for %s: %s", sym, exc)
        payload, ttl = None, _TTL_FAIL
    if payload is not None and payload["state"] == "ok":
        try:
            payload["last_report"] = _fetch_last_report(sym)
        except Exception:  # noqa: BLE001
            payload["last_report"] = None
        if payload["last_report"] is None and payload["rows"]:
            ttl = _TTL_FAIL          # decided on the grace window alone: re-check soon
    if payload is not None:
        try:
            payload["grades"] = _fetch_grades(sym)
        except Exception as exc:  # noqa: BLE001
            _logger.warning("broker estimates grades read failed for %s: %s", sym, exc)
            payload["grades"] = None
    with _lock:
        _cache[sym] = (time.time(), ttl, payload)
        _queued.discard(sym)


def _schedule(sym: str) -> bool:
    global _executor
    if not is_enabled() or not estimates_gate_on():
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


def _firms(sym: str, stored: Optional[dict] = None) -> dict:
    """Named firms from the grades read: the shared cache key when it is warm
    (fresher), else BRKE's own stored read. Never a vendor call here."""
    from api.services.cache import cache
    hit = cache.get(f"analyst_grades_{sym}")
    if not hit or hit.get("_miss"):
        hit = stored
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
    now = time.time()
    with _lock:
        hit = _cache.get(sym)
    payload = hit[2] if hit is not None else None
    stored_grades = payload.get("grades") if isinstance(payload, dict) else None
    base = {"ticker": sym, "source": SOURCE, "merge_point": MERGE_POINT,
            "contributors": {"state": "unavailable", "reason": CONTRIBUTORS_REASON},
            "firms": _firms(sym, stored_grades)}
    if not estimates_gate_on():
        return {**base, "state": "gated", "queued": False, "reason": GATED_REASON}
    if hit is None or now - hit[0] > hit[1]:
        queued = _schedule(sym)
        if hit is None:
            return {**base, "state": "pending", "queued": queued,
                    "reason": "the consensus is being read; this panel fills in by itself"}
    read_at = hit[0]
    if payload is None:
        return {**base, "state": "unavailable", "read_at": read_at,
                "reason": "the consensus estimates could not be read"}
    if payload.get("state") == "plan_gated":
        return {**base, "state": "plan_gated", "read_at": read_at, "reason": PLAN_GATED_REASON}
    ps = periods(payload.get("rows") or [], today=today, last_report=payload.get("last_report"))
    if not ps:
        return {**base, "state": "none", "read_at": read_at,
                "reason": "no upcoming quarter carries a consensus estimate"}
    return {**base, "state": "ok", "read_at": read_at, "periods": ps}
