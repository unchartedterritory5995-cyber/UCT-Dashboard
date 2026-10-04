"""TERMINAL-NEXT gap 6 -- the `ALRT` alert centre's one read (api/services/alert_centre.py).

Gates, in the T3 order (terminal_grammar.py): the dark flag `ALERT_CENTRE_ENABLED` first (404
before identity is read), then `require_terminal_next` (404, byte-identical to an unknown route,
dies with the master switch), then the paid 402. The shell this serves is itself paid and
cohort-gated, so neither gate narrows a real member.

⛔ READ ONLY. Create / pause / resume / delete go through the EXISTING routers
(`watchlist_alerts`, `indicator_alerts`, `screen_promote`, `alert_taxonomy`); this route only
lists what they own. Plain `def`: SQLite reads run on the threadpool, never on the event loop
(tests/test_async_routes_do_not_block.py). OWNER-SCOPED: no route takes a user id.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import alert_centre
from api.services.rollout_gate import require_terminal_next


def _require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, never imported from a sibling (this codebase's per-router 402 rule)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The UCT Terminal requires a paid plan")
    return user


def _require_enabled() -> None:
    """The dark flag: off means the route does not exist (404, the same as an unknown path)."""
    if not alert_centre.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


router = APIRouter(dependencies=[Depends(_require_enabled), Depends(require_terminal_next),
                                 Depends(_require_paid)])


@router.get("/api/terminal/alerts")
def alert_centre_overview(user: dict = Depends(get_current_user_with_plan)):
    """ALRT: the caller's price, indicator, screen and S7 alerts, plus recent `alert_fires`."""
    return alert_centre.overview(str(user["id"]))
