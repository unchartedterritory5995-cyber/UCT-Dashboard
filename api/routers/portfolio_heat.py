"""A14 CP1 (GATE-A14-PORTFOLIO-HEAT-CP1, signed 2026-09-21, fingerprint
417b6b853) -- the first member-facing door on `portfolio_heat.py`.

`api/services/portfolio_heat.py` has been computing real risk-heat, notional
exposure, per-position risk, by-sector concentration and broker-placeholder-
stop detection since Phase 2 of the Compass rung-4/5 mentor work -- but only
FOUR assistant-tool call sites could ever read it (Compass chat, voice, AI
Search, `grade_watchlist`'s internal reuse). A member could only see these
numbers by asking an AI to compute them on the fly. This route is a plain
pass-through: no new parameter, no change to `portfolio_heat()`'s signature
or return shape, no new computation. It is a renderer's door, not a second
implementation.

⛔ Zero corp-actions data (splits/dividends/M&A/etc). `portfolio_heat.py`
needs none of it and has no provider gap -- DEC-08's corp-actions calendar is
separate, unscoped, provider-gapped work (§2 DEFER).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import portfolio_heat as _ph

router = APIRouter(prefix="/api/portfolio", tags=["portfolio-heat"])


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for portfolio risk.

    ⛔ Defined HERE, never imported from a sibling — each router owns its own
    402 sentence so "which surface refused me" is readable off the message.
    Rail: `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Portfolio risk requires a paid plan")
    return user


@router.get("/heat")
def get_portfolio_heat(account_id: str | None = None, account_size: float | None = None,
                       user: dict = Depends(require_paid)) -> dict:
    """Exactly `portfolio_heat.portfolio_heat(user_id, account_id=account_id,
    account_size=account_size)` — the same call the two existing assistant-tool
    callers (`voice_tool_impls.py`, `coach_chat_tools.py`) already make. No new
    parameters, no field renamed/added/dropped in transit."""
    return _ph.portfolio_heat(user["id"], account_id=account_id, account_size=account_size)
