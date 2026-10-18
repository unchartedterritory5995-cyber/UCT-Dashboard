"""Your trading year (P2 Tier 3, Task 7): the read behind the year review page.

  member  GET  /api/j2/wrapped/{year}?account_id=   paid   the year's four sections (wrapped.year_wrapped)

ONE AUTHORITY. Every number is `wrapped.year_wrapped`; this router only gates, checks the year and
reads. It writes nothing.

The rules (the Checklist-from-my-winners router's shape, `notebook_winners_checklist.py`; ruling
R-T3-T7-R1):
  * THE GATE IS A ROUTER DEPENDENCY: `JOURNAL_TIER3_ENABLED` off answers the one 404 before the
    session or the plan is read.
  * ITS OWN `require_paid`, with its own 402 sentence, so a refused member reads which surface
    refused them (tests/test_user_definitions_auth.py reads the sentence as a literal).
  * MEMBER-SCOPED: every read is keyed on the session member's id; `account_id` only narrows the
    member's OWN trades, notes and rules (another member's account id matches nothing).
  * THE YEAR: 2000 up to the current ET year, else 400 with wrapped.YEAR_UNAVAILABLE_SENTENCE.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.journal_two import wrapped


def _require_tier3() -> None:
    """Router-level: the switch answers first, with the one 404 a dark route gives. Read per request."""
    if not wrapped.enabled():
        raise HTTPException(status_code=404, detail="Not found")


router = APIRouter(
    prefix="/api/j2/wrapped",
    tags=["journal-2-0", "notebook-wrapped"],
    dependencies=[Depends(_require_tier3)],
)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence. Owner ruling 2026-10-02: there is no free
    tier, so every Notebook member route takes a paid plan (tests/test_paywall_gate_free_tier.py)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Your trading year requires a paid plan")
    return user


# ⛔ ROUTE ORDER (Task 8): `GET /years` belongs in THIS router and must be declared ABOVE this
# route. FastAPI answers on first match, and `/{year}` matches the segment "years" (then fails the
# int check with a 422), so a `/years` declared below it is never reached.
@router.get("/{year}")
def get_wrapped(year: int,
                account_id: str | None = Query(None, max_length=128),
                user: dict = Depends(require_paid)) -> dict[str, Any]:
    """Read-only. `account_id` absent means All Accounts."""
    if not wrapped.year_in_range(year):
        raise HTTPException(status_code=400, detail=wrapped.YEAR_UNAVAILABLE_SENTENCE)
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        return wrapped.year_wrapped(conn, user["id"], year, account_id or None)
    finally:
        conn.close()
