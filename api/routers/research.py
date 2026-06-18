"""Research page endpoints (`/api/research/*`)."""
from __future__ import annotations

import logging
import threading

from fastapi import APIRouter, Depends

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
