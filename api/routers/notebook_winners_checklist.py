"""Checklist from my winners (P2 Tier 3, Task 6): the one read behind Insights > Checklist from my winners.

  member  GET  /api/j2/insights/checklist-suggestions?account_id=   paid   the suggestions, with
                                                                           their evidence trades

ONE AUTHORITY. Every number is `checklist_suggestions.suggest` (the population, the cut, the share
and the lift); this router only gates and reads. It writes nothing: accepting a suggestion is the
member's own write, through the rules doors that already exist (R-T3-V4).

The rules (the My Playbook router's shape, `notebook_playbook.py`; fix round 1, ruling R-T3-T6-R1):
  * THE GATE IS A ROUTER DEPENDENCY: `JOURNAL_TIER3_ENABLED` off answers the one 404 before the
    session or the plan is read.
  * ITS OWN `require_paid`, with its own 402 sentence, so a refused member reads which surface
    refused them (tests/test_user_definitions_auth.py reads the sentence as a literal).
  * MEMBER-SCOPED: every read is keyed on the session member's id; `account_id` only narrows the
    member's OWN trades and rules (another member's account id matches nothing). The picker's
    All Accounts value `'_all_'` and an empty value both mean no account (ruling R-T3-T7-R6,
    `notebook_wrapped.plain_account_id`).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.routers.notebook_wrapped import plain_account_id
from api.services.journal_two import checklist_suggestions


def _require_tier3() -> None:
    """Router-level: the switch answers first, with the one 404 a dark route gives. Read per request."""
    if not checklist_suggestions.enabled():
        raise HTTPException(status_code=404, detail="Not found")


router = APIRouter(
    prefix="/api/j2/insights",
    tags=["journal-2-0", "notebook-winners-checklist"],
    dependencies=[Depends(_require_tier3)],
)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence. Owner ruling 2026-10-02: there is no free
    tier, so every Notebook member route takes a paid plan (tests/test_paywall_gate_free_tier.py)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Checklist from my winners requires a paid plan")
    return user


@router.get("/checklist-suggestions")
def get_checklist_suggestions(account_id: str | None = Query(None, max_length=128),
                              user: dict = Depends(require_paid)) -> dict[str, Any]:
    """Read-only. `account_id` absent means All Accounts."""
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        return checklist_suggestions.suggest(conn, user["id"], plain_account_id(account_id))
    finally:
        conn.close()
