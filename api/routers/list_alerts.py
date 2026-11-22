"""The member's switches for the Terminal list alerts (`api/services/list_alerts.py`).

"Alert me when a stock I follow appears here", one switch per list: New 52-week highs
(H52), the confluence board (CONFL) and repeat-hit option contracts (ACCUM). ONE source of
truth for every place a switch is drawn (the three panels and Settings, Notifications).

  GET /api/alerts/lists           the three switches, and the numbers the controls say
  PUT /api/alerts/lists/{kind}    body {"on": true | false}; answers the same shape as GET

DARK: ``TERMINAL_LIST_ALERTS_ENABLED``. Off, both routes 404 to everyone, signed in or not
(the setting is asked before the paywall, the way the RS screens' alert routes do it), and
no table is created. ``admin`` (the owner's preview): everyone who is not an admin gets the
same 404. On: paid (401 signed out, 402 not on a paid plan).
Plain `def`: SQLite only.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()


def _armed() -> None:
    from api.services import list_alerts
    if not list_alerts.enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="List alerts require a paid plan")
    return user


def _for(user: dict):
    """The service, for a member the feature is on for; the same 404 as dark for one it is
    not (under the owner's preview, the lists' alerts do not exist for anyone else)."""
    from api.services import list_alerts
    if not list_alerts.allowed(user):
        raise HTTPException(status_code=404, detail="Not Found")
    return list_alerts


class SwitchIn(BaseModel):
    on: bool


@router.get("/api/alerts/lists", dependencies=[Depends(_armed)])
def list_alerts_state(user: dict = Depends(require_paid)):
    return _for(user).state(user["id"])


@router.put("/api/alerts/lists/{kind}", dependencies=[Depends(_armed)])
def list_alerts_switch(kind: str, body: SwitchIn, user: dict = Depends(require_paid)):
    """Only the three lists: any other word is a 404. The answer is the member's whole
    state after the write, so a control draws what the server holds, never its own guess."""
    alerts = _for(user)
    try:
        alerts.set_switch(user["id"], kind, body.on)
    except alerts.UnknownKind:
        raise HTTPException(status_code=404, detail="No such list")
    return alerts.state(user["id"])
