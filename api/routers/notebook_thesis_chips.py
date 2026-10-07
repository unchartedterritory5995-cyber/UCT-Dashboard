"""Thesis chips route (wave 13, lane 13G-2).

  POST /api/j2/thesis-chips    {symbols: [string]} -> {SYMBOL: chip}

One router-level gate, the name the route census and the switch-rehearsal tool look
for (`_require_enabled`): a flag off answers the single 404 before any session or plan
check runs (the `notebook_research_capture.py` precedent).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import request_body_cap as body_cap
from api.services.auth_db import get_connection
from api.services.journal_two import public_note_payload as public
from api.services.journal_two import thesis_chips as tcj


def _require_enabled() -> None:
    if not tcj.enabled():
        raise public.not_found()
_require_enabled.__qualname__ = "_require_enabled"


router = APIRouter(
    prefix="/api/j2/thesis-chips",
    tags=["journal-2-0", "notebook-thesis-chips"],
    dependencies=[Depends(_require_enabled)],
)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router module, with its own sentence (tests/test_user_definitions_auth.py
    reads the sentence as a literal in the HTTPException call)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Thesis chips require a paid plan")
    return user


# ⛔ FIN (2026-10-06, security review I-5): the body is NOT a declared parameter.
# FastAPI reads a declared body before it solves any dependency, so with the flag
# off this door answered 422 to malformed JSON (every other request: 404) and
# buffered an anonymous body of any size. `_json` reads it capped, after the
# router's gate and after the plan check. Rail: tests/test_notebook_body_census.py.
# The body is a list of at most `MAX_SYMBOLS` tickers.
MAX_BODY_BYTES = 64 * 1024
TOO_LARGE_SENTENCE = "Request too large"


def _json(annotation):
    return body_cap.capped_json(annotation, lambda: MAX_BODY_BYTES, lambda: TOO_LARGE_SENTENCE,
                                after=require_paid)


@router.post("")
def chips(payload: dict[str, Any] = Depends(_json(dict[str, Any])), user: dict = Depends(require_paid)) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="A JSON object is required")
    symbols = payload.get("symbols")
    if not isinstance(symbols, list):
        raise HTTPException(status_code=400, detail="symbols must be an array")
    conn = get_connection()
    try:
        return tcj.batch_chips(conn, str(user["id"]), symbols)
    finally:
        conn.close()
