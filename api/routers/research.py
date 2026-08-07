"""Research page endpoints (`/api/research/*`)."""
from __future__ import annotations

import logging
import threading

from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Body, Depends

from api.middleware.auth_middleware import require_admin
from api.services.research.financials import get_financials
from api.services.research.estimates import get_estimates
from api.services.research.ownership import get_ownership
from api.services.research.ratings import get_ratings
from api.services.research.snapshot import get_snapshot

_logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/research/financials/{sym}")
def research_financials(sym: str):
    try:
        return get_financials(sym)
    except Exception as exc:
        _logger.warning("research financials failed for %s: %s", sym, exc)
        return {"sym": (sym or "").upper(), "annual": [], "quarterly": [], "balance": {}, "metrics": {}}


@router.get("/api/research/estimates/{sym}")
def research_estimates(sym: str):
    try:
        return get_estimates(sym)
    except Exception as exc:
        _logger.warning("research estimates failed for %s: %s", sym, exc)
        return {"sym": (sym or "").upper(), "forward": [], "revisions": [], "rating_changes": []}


@router.get("/api/research/ownership/{sym}")
def research_ownership(sym: str):
    try:
        return get_ownership(sym)
    except Exception as exc:
        _logger.warning("research ownership failed for %s: %s", sym, exc)
        return {"sym": (sym or "").upper(), "institutional": {"pct_held": None, "holders": []}, "short": {}, "insider": []}


@router.get("/api/research/ratings/{sym}")
def research_ratings(sym: str):
    try:
        return get_ratings(sym)
    except Exception as exc:
        _logger.warning("research ratings failed for %s: %s", sym, exc)
        return {"sym": (sym or "").upper(), "composite": None, "components": {}, "checkup": [], "method": None}


@router.post("/api/research/snapshot-batch")
def research_snapshot_batch(tickers: list[str] = Body(..., embed=True)):
    """Compact snapshot (market cap / next earnings / UCT rating) for a BATCH of
    tickers — powers the Watchlist's optional Market Cap / Next Earnings / UCT Rating
    columns. Bounded parallel over get_snapshot (each internally cached), capped at 100.
    Only the three fields the columns need, to keep the payload small.
    """
    syms = list(dict.fromkeys(
        (t or "").upper().strip() for t in (tickers or []) if t and t.strip()
    ))[:100]
    if not syms:
        return {}

    def _one(sym):
        try:
            s = get_snapshot(sym)
            return sym, {
                "market_cap": (s.get("metrics") or {}).get("market_cap"),
                "next_earnings": s.get("next_earnings"),
                "composite": s.get("composite"),
                "sector": s.get("sector"),
                "industry": s.get("industry"),
            }
        except Exception:
            return sym, {"market_cap": None, "next_earnings": None, "composite": None,
                         "sector": None, "industry": None}

    out: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=6) as ex:
        for sym, val in ex.map(_one, syms):
            out[sym] = val

    # 20-session average daily volume — for the RVOL column (live volume / this avg).
    # One bounded batch of tiny indexed reads; today's evolving bar is excluded.
    try:
        from api.services import bars_sqlite
        import datetime as _dt
        try:
            import zoneinfo
            _today = int(_dt.datetime.now(zoneinfo.ZoneInfo("America/New_York")).strftime("%Y%m%d"))
        except Exception:
            _today = None
        avg = bars_sqlite.avg_daily_volume(list(out.keys()), sessions=20, before_ymd=_today)
    except Exception:
        avg = {}
    for sym in out:
        out[sym]["avg_vol_20d"] = avg.get(sym)
    return out


@router.get("/api/research/snapshot/{sym}")
def research_snapshot(sym: str):
    """Consolidated ratings + key fundamentals for the glanceable snapshot card."""
    try:
        return get_snapshot(sym)
    except Exception as exc:
        _logger.warning("research snapshot failed for %s: %s", sym, exc)
        return {"sym": (sym or "").upper(), "name": None, "sector": None, "industry": None,
                "composite": None, "components": {}, "checkup": [], "method": None, "metrics": {}}


@router.get("/api/research/ratings-percentile/status")
def ratings_percentile_status():
    """Universe percentile-rank coverage (read-only). Shows whether ratings are
    percentile-based yet and how many tickers/distributions are warmed."""
    try:
        from api.services.research import ratings_db, ratings_universe
        st = ratings_db.status()
        st["enabled"] = ratings_universe.is_enabled()
        return st
    except Exception as exc:
        _logger.warning("ratings-percentile status failed: %s", exc)
        return {"enabled": False, "usable": False, "error": str(exc)}


@router.post("/api/research/ratings-percentile/refresh")
def ratings_percentile_refresh(max_per_run: int | None = None, _admin: dict = Depends(require_admin)):
    """Admin: trigger a universe percentile refresh in the background (force —
    runs even if the feature flag is off so admins can warm it before enabling)."""
    from api.services.research import ratings_universe

    def _run():
        try:
            ratings_universe.run_percentile_refresh(max_per_run=max_per_run, force=True)
        except Exception as exc:  # pragma: no cover
            _logger.warning("ratings-percentile manual refresh failed: %s", exc)

    threading.Thread(target=_run, daemon=True, name="ratings-percentile-manual").start()
    return {"status": "started", "max_per_run": max_per_run}
