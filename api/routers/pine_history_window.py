"""W9-T11-F1 -- the chart lane's history window: ``GET /api/pine/history-window``.

W9 design 3.4, "The chart": a broker run on a member's chart takes the most recent
``historyWindowBars`` of the bars the chart has loaded, and "the value arrives in the run context
(T11) from the server, which reads ``bars_window``". Section 9 item 6 names the follow-up: the
chart lane "reads ``bars_window`` through an endpoint". This is that endpoint, and nothing else.

  * The value is ``bars_window.HISTORY_WINDOW_BARS`` (rulings R10/R13, D9: it stays 5000), imported,
    never restated: ``tests/test_history_window_one_authority.py`` parses this file.
  * ⭐⭐ (2026-11-19, D9 strategy-only, coordinator ruling) a SECOND field, ``strategyHistoryWindowBars``
    (``bars_window.STRATEGY_HISTORY_WINDOW_BARS``, this endpoint its one consumer): the window a strategy run on a
    member's chart takes. ``historyWindowBars`` keeps its value and its meaning to every reader that knows only it
    (a bundle from before this field reads 5,000, exactly as before); a reader that knows both runs over the
    strategy window and reads ``historyWindowBars`` as the depth a run from the listing is served at without the
    deep-start rule (B-START-DEEP, ``runtime/brokerRules.js``).
  * It answers a constant, so it decides nothing: which bars a run covers, whether it reaches the
    listing, and the refusals (``runtime:strategy-start``, Q-S1n) stay the runtime's
    (``runtimeColumns.js::computeStrategyWindow``, ``vm.js`` [B-START]).
  * Signed-in only (the auth-surface census reads every GET). No flag of its own: the browser asks
    only while ``VITE_PINE_STRATEGY_BROKER_ENABLED`` is on (``strategyWindow.js``), so with the
    gate off no chart ever calls it.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from api.middleware.auth_middleware import get_current_user
from api.services.bars_window import HISTORY_WINDOW_BARS, STRATEGY_HISTORY_WINDOW_BARS

router = APIRouter()


@router.get("/api/pine/history-window")
def history_window(user: dict = Depends(get_current_user)) -> dict:
    """The history windows a strategy run on the chart reads, for its run context."""
    return {"historyWindowBars": HISTORY_WINDOW_BARS, "strategyHistoryWindowBars": STRATEGY_HISTORY_WINDOW_BARS}
