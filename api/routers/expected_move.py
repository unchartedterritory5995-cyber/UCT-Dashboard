"""Expected-move research endpoint — live ATM-straddle read + captured history.

GET /api/research/expected-move/{sym} → {live, history, history_since}
Always mounted (safe read). The nightly capture job that populates history is
separately flag-gated in main.py (IMPLIED_STORE_ENABLED=1).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from api.middleware.auth_middleware import get_current_user
from api.services import implied_move, implied_store

router = APIRouter(prefix="/api/research", tags=["research"])


@router.get("/expected-move/{sym}")
def expected_move(sym: str, report_date: str | None = Query(default=None),
                   user=Depends(get_current_user)):
    live = implied_move.get_expected_move(sym, report_date)
    history = implied_store.get_implied_history(sym, limit=8)
    return {
        "live": live,
        "history": history,
        "history_since": min((h["report_date"] for h in history), default=None),
    }
