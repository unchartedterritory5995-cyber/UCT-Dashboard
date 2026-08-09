"""Analyst intel + institutional ownership endpoints (FMP Ultimate).

🔴 PAID since 2026-08-09. Both routes were `get_current_user` only — a session,
never a plan — and signup is open and free, so a free registration read them.

Every byte here is bought on the firm's **FMP Ultimate** subscription: consensus
ratings, price targets, the 13F institutional book with top holders and the
biggest buyers/sellers. That is a paid data feed we relay under our own key, so
an open route is our subscription answering someone else's questions.

Consumers are `hooks/useAnalystIntel.js` → `components/fundamentals/AnalystPanel.jsx`
and `hooks/useOwnership.js` → `OwnershipPanel.jsx` / `pages/research/tabs/OwnershipTab.jsx`
— all of them on paid surfaces, none on `/morning-wire`. Both hooks already treat
a non-`ok` response as `null`, so a free member sees the panel empty rather than
broken.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.analyst_intel import get_analyst_intel
from api.services.institutional_holdings import get_ownership

_log = logging.getLogger(__name__)
router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for analyst + ownership.

    ⛔ Defined HERE, never imported from a sibling — each router owns its own
    402 sentence so "which surface refused me" is readable off the message.
    Rail: `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="Analyst and ownership data require a paid plan")
    return user


_OWNERSHIP_EMPTY = {"ticker": "", "inst_pct": None, "inst_holders_count": None,
                    "as_of": None, "top_holders": [], "biggest_buyers": [], "biggest_sellers": []}


@router.get("/api/analyst/{sym}")
def analyst_endpoint(sym: str, debug: int = 0, user: dict = Depends(require_paid)):
    s = (sym or "").upper().strip()
    if not s:
        return {"ticker": "", "consensus": None, "price_target": None, "recent_actions": []}
    try:
        return get_analyst_intel(s, debug=bool(debug))
    except Exception as e:
        _log.warning("analyst endpoint failed for %s: %s", s, e)
        return {"ticker": s, "consensus": None, "price_target": None, "recent_actions": []}


@router.get("/api/ownership/{sym}")
def ownership_endpoint(sym: str, debug: int = 0, user: dict = Depends(require_paid)):
    s = (sym or "").upper().strip()
    if not s:
        return dict(_OWNERSHIP_EMPTY)
    try:
        return get_ownership(s, debug=bool(debug))
    except Exception as e:
        _log.warning("ownership endpoint failed for %s: %s", s, e)
        return dict(_OWNERSHIP_EMPTY, ticker=s)
