"""Tier 2 part A: the server half of the Notebook's smart chips.

ONE route: which tickers a short text names, by buzz_extract -- the resolver that already knows
RS, EMA, MA, GAP and PEG are words in prose (R-T2A-6). The browser parses a sentence locally and
asks only "is this word a ticker here?". The text is never stored and never logged.

  POST /api/j2/smart-chips/tickers   {text}  ->  {"tickers": [{"symbol": "NVDA", "tier": "exact"}, ...]}
                                     text is 1 to MAX_TEXT characters after strip; 422 otherwise.
                                     Sorted as buzz_extract.extract returns it.

Gate NOTEBOOK_SMART_CHIPS_ENABLED (enablement), read per request; off -> the one 404, before the
session is read (a router dependency, so it runs ahead of the plan check and the body). Paid, like
every Notebook route. The body is read CAPPED, and only after the gate and the plan check
(`capped_json`, `after=require_paid`), so a malformed body can never answer 422 ahead of them.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import buzz_extract
from api.services import request_body_cap as body_cap
from api.services.notebook_flags import flag_on

FLAG = "NOTEBOOK_SMART_CHIPS_ENABLED"
MAX_TEXT = 2000
NOT_FOUND = "Not found"
TOO_LARGE_SENTENCE = "Request too large"
#: 2,000 characters at up to 4 bytes each, JSON framing and escapes on top. A body past this is not
#: a sentence a person typed, so it is cut off while it is read.
MAX_BODY_BYTES = 16 * 1024


def enabled() -> bool:
    """The one read of the switch (default OFF). Per request, never latched at import."""
    return flag_on(FLAG, False)


def _require_enabled() -> None:
    """Router-level, so it runs BEFORE any route's own dependencies (the session, the plan, the body)."""
    if not enabled():
        raise HTTPException(status_code=404, detail=NOT_FOUND)


router = APIRouter(prefix="/api/j2/smart-chips", tags=["journal-2-0", "notebook-smart-chips"],
                   dependencies=[Depends(_require_enabled)])


class TextRefused(ValueError):
    """The text is empty, not text, or longer than MAX_TEXT."""


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence (tests/test_user_definitions_auth.py reads the
    sentence as a literal in the HTTPException call)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Smart chips require a paid plan")
    return user


def tickers_in(text) -> list[dict]:
    if not isinstance(text, str) or not text.strip():
        raise TextRefused("Send some text to check.")
    if len(text) > MAX_TEXT:
        raise TextRefused(f"Send at most {MAX_TEXT} characters.")
    return [{"symbol": sym, "tier": tier} for sym, tier in buzz_extract.extract(text)]


def _json(annotation):
    return body_cap.capped_json(annotation, lambda: MAX_BODY_BYTES, lambda: TOO_LARGE_SENTENCE,
                                after=require_paid)


@router.post("/tickers")
def tickers_endpoint(body: dict[str, Any] = Depends(_json(dict[str, Any])),
                     user: dict = Depends(require_paid)) -> dict[str, Any]:
    # `user` is only the plan check; the text is a pure function of the body and goes nowhere else.
    try:
        return {"tickers": tickers_in(body.get("text"))}
    except TextRefused as e:
        raise HTTPException(status_code=422, detail=str(e))
