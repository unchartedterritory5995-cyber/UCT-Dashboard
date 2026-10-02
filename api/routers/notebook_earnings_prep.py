"""Earnings prep routes (wave 13, lane 13C phase 1).

The service is `api/services/journal_two/earnings_prep.py`; the client is
`app/src/pages/journal-2-0/lib/earningsPrep.js` + `components/notebook/ReportingSoon.jsx`.

  member  GET   /api/j2/earnings-prep/soon              paid  the member's names reporting soon
  member  POST  /api/j2/earnings-prep/{symbol}/draft    paid  the facts a prep note opens with

The rules (the template gallery's, `notebook_template_gallery.py`):
  * THE GATE IS A ROUTER DEPENDENCY: `NOTEBOOK_EARNINGS_PREP_ENABLED` off answers the one 404
    for every route before the session or the plan is read.
  * PAID: both routes read paid calendar and earnings data (the Calendar's own routes are
    `require_paid`), so both take this router's own `require_paid`.
  * NO NOTE IS WRITTEN HERE. The draft returns facts; the member's click creates the note
    through the client's one create door (`createNoteViaApi`), so this router can never
    create a note on its own (decision R5).
  * THE CAP: 20 drafts a member an ET day (`NOTEBOOK_EARNINGS_PREP_DAILY_CAP`, read per call),
    durable in `daily_usage_counters`, so a deploy never resets it. A draft that fails is
    given back. The list is not counted: it is one cached calendar walk and DB reads.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import daily_counters
from api.services.journal_two import earnings_prep as prep
from api.services.journal_two import public_note_payload as public


def _require_enabled() -> None:
    """Router-level, so it runs BEFORE any route's own dependencies: an off gate reads no
    session, checks no plan, and answers the one not-found."""
    if not prep.enabled():
        raise public.not_found()


router = APIRouter(
    prefix="/api/j2/earnings-prep",
    tags=["journal-2-0", "notebook-earnings-prep"],
    dependencies=[Depends(_require_enabled)],
)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence (tests/test_user_definitions_auth.py
    reads the sentence as a literal in the HTTPException call)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Earnings prep requires a paid plan")
    return user


def _usage(day: str, user: dict) -> dict[str, Any]:
    return {"used": int(daily_counters.value(day, prep.DAILY_SCOPE, str(user["id"]))),
            "cap": prep.daily_cap()}


@router.get("/soon")
def reporting_soon(user: dict = Depends(require_paid)) -> dict[str, Any]:
    return prep.reporting_soon(str(user["id"]))


@router.post("/{symbol}/draft")
def draft_prep(symbol: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        sym = prep.clean_symbol(symbol)
    except prep.PrepRequestError as e:
        raise HTTPException(status_code=400, detail=str(e))
    from api.services.journal_two.calendar import et_today
    day = et_today()
    charge = daily_counters.Charge(prep.DAILY_SCOPE, str(user["id"]), 1, prep.daily_cap())
    if daily_counters.take(day, [charge]) is not None:
        raise HTTPException(status_code=429, detail=prep.cap_sentence())
    try:
        out = prep.draft(str(user["id"]), sym)
    except Exception:
        daily_counters.give_back(day, [daily_counters.Charge(prep.DAILY_SCOPE, str(user["id"]), 1)])
        raise
    out["usage"] = _usage(day, user)
    return out
