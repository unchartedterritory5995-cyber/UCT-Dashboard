"""The visual playbook and before/after (wave 13, lane 13I-2).

  paid    GET /api/j2/notebook-visual-playbook/cards?setup=&setup=&outcome=&timeframe=&range=&regime=
                                     the member's tagged chart blocks, filtered, + slice stats
  member  GET /api/j2/notebook-visual-playbook/trades/{trade_id}/before-after
                                     the trade's fills and its frozen plan levels

The service is `api/services/journal_two/visual_playbook.py`; it reads 13I-1's chart-block
index, 13A's frozen plan links and the per-setup stats authority, and re-derives none of them.

  * THE GATE IS A ROUTER DEPENDENCY: `NOTEBOOK_VISUAL_PLAYBOOK_ENABLED` off answers the one
    404 for every route before the session, the plan or a parameter is read.
  * PAID on the grid: its cards carry the fingerprint (the Screener's columns and the pattern
    engine's confirmed verdicts, both paid surfaces), the same reason 13I-1's routes are paid.
    Before/after shows the member's own trade and plan only, so it needs a session, not a plan.
  * READS NEVER WRITE A NOTE (plan R-12). The grid may bring 13I-1's index up to the member's
    notes (`chart_blocks.catch_up`); before/after reads 13A's link and freezes nothing.
    No model call and no vendor call is reachable.
"""
from __future__ import annotations

import logging
import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan, is_paid_user
from api.services.auth_db import get_connection
from api.services.journal_two import public_note_payload as public
from api.services.journal_two import visual_playbook as vp

log = logging.getLogger(__name__)

UNREADABLE_SENTENCE = "Your playbook could not be read just now. Try again in a minute."


def _require_enabled() -> None:
    """Router-level, so it runs BEFORE any route's own dependencies."""
    if not vp.enabled():
        raise public.not_found()


router = APIRouter(
    prefix="/api/j2/notebook-visual-playbook",
    tags=["journal-2-0", "notebook-visual-playbook"],
    dependencies=[Depends(_require_enabled)],
)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence (tests/test_user_definitions_auth.py
    reads the sentence as a literal in the HTTPException call)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The visual playbook requires a paid plan")
    return user


@router.get("/cards")
def list_cards(setups: list[str] = Query(default=[], alias="setup"),
               outcome: Optional[str] = Query(default=None, max_length=16),
               timeframe: Optional[str] = Query(default=None, max_length=8),
               ranges: list[str] = Query(default=[], alias="range"),
               regime: Optional[str] = Query(default=None, max_length=16),
               user: dict = Depends(require_paid)):
    uid = str(user["id"])
    if any(len(s) > 80 for s in setups) or any(len(r) > 64 for r in ranges):
        raise HTTPException(status_code=422, detail="A setup or range is too long")
    try:
        return vp.cards(uid, setups=setups, outcome=outcome or None, timeframe=timeframe or None,
                        ranges=ranges, regime=regime or None)
    except vp.PlaybookRequestError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    except sqlite3.Error:
        log.warning("[notebook_visual_playbook] cards unreadable for %s", uid, exc_info=True)
        raise HTTPException(status_code=503, detail=UNREADABLE_SENTENCE) from None


@router.get("/trades/{trade_id}/before-after")
def before_after(trade_id: str, user: dict = Depends(require_paid)):
    uid = str(user["id"])
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    try:
        out = vp.before_after(uid, trade_id, conn)
    except sqlite3.Error:
        log.warning("[notebook_visual_playbook] before/after unreadable for %s", uid, exc_info=True)
        raise HTTPException(status_code=503, detail=UNREADABLE_SENTENCE) from None
    finally:
        conn.close()
    if out is None:
        raise public.not_found()
    return out
