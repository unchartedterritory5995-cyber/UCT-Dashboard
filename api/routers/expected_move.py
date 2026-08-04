"""Expected-move research endpoint — live ATM-straddle read + captured history.

GET /api/research/expected-move/{sym} → {live, history, history_since}
Always mounted (safe read). The nightly capture job that populates history is
separately flag-gated in main.py (IMPLIED_STORE_ENABLED=1).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query

from api.middleware.auth_middleware import get_current_user
from api.services import implied_move, implied_store

_log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/research", tags=["research"])


@router.get("/expected-move/{sym}")
def expected_move(sym: str, report_date: str | None = Query(default=None),
                   user=Depends(get_current_user)):
    try:
        live = implied_move.get_expected_move(sym, report_date)
    except Exception:  # noqa: BLE001 — a bad live read must never 500 the endpoint
        _log.warning("expected-move live read failed for %s", sym, exc_info=True)
        live = None
    # Both reads share one try/except: get_earliest_report_date is computed
    # inside the same block as get_implied_history so a failure of either one
    # degrades both (history=[], history_since=None) rather than 500ing.
    try:
        history = implied_store.get_implied_history(sym, limit=8)
        history_since = implied_store.get_earliest_report_date(sym)
    except Exception:  # noqa: BLE001 — a bad snapshot DB must never 500 the endpoint
        _log.warning("expected-move history read failed for %s", sym, exc_info=True)
        history = []
        history_since = None
    return {
        "live": live,
        "history": history,
        "history_since": history_since,
    }
