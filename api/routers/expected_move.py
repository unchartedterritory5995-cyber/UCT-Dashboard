"""Expected-move research endpoint — live ATM-straddle read + captured history.

GET /api/research/expected-move/{sym} → {live, history, history_since}
Always mounted (safe read). The nightly capture job that populates history is
separately flag-gated in main.py (IMPLIED_STORE_ENABLED=1).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query

from api.middleware.auth_middleware import get_current_user
from api.services import implied_move, implied_store, setup_grade

_log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/research", tags=["research"])


@router.get("/expected-move/{sym}")
def expected_move(sym: str, report_date: str | None = Query(default=None),
                   grade: bool = Query(default=True),
                   user=Depends(get_current_user)):
    # `live_oc` is the OUT-dict `get_expected_move` fills from the SAME
    # evaluation that withheld the payload — never a second pass, and never a
    # reason inferred out here from the shape of a `None`.
    live_oc: dict = {}
    try:
        live = implied_move.get_expected_move(sym, report_date, outcome=live_oc)
    except Exception:  # noqa: BLE001 — a bad live read must never 500 the endpoint
        _log.warning("expected-move live read failed for %s", sym, exc_info=True)
        live = None
        # The read RAISED — that is a fact we hold, so it is named. An empty
        # out-dict below stays empty and serializes to null: "we cannot say",
        # which is honest and is what `wire_outcome` reserves None for.
        live_oc = {"ok": False, "kind": implied_move.KIND_UNAVAILABLE,
                   "reason": implied_move.UNAVAILABLE_READ_ERROR}
    # Both reads share one try/except: get_earliest_report_date is computed
    # inside the same block as get_implied_history so a failure of either one
    # degrades both (history=[], history_since=None) rather than 500ing.
    try:
        history = implied_store.get_implied_history(sym, limit=8)
        history_since = implied_store.get_earliest_report_date(sym)
    except Exception:  # noqa: BLE001 — a bad snapshot DB must never 500 the endpoint
        _log.warning("expected-move history read failed for %s", sym, exc_info=True)
        history = []
        history_since = None
    # The Setup Grade rides THIS payload deliberately: its fourth input IS
    # `live`, so a separate endpoint would duplicate or race the chain read,
    # and the banner chip + Setup hero open together (one round trip). Its own
    # try/except so a grade failure degrades to null, never a 500. `?grade=0`
    # opts out entirely.
    grade_payload = None
    if grade:
        try:
            grade_payload = setup_grade.get_setup_grade(sym, live_move=live)
        except Exception:  # noqa: BLE001
            _log.warning("expected-move grade failed for %s", sym, exc_info=True)
    return {
        "live": live,
        # `{kind, reason}` beside the payload — the same projection the calendar
        # emits, from the same serializer, so the two member-facing surfaces can
        # never describe one absence two different ways. Null means the read was
        # never attempted; it never means "we could not price this".
        "live_outcome": implied_move.wire_outcome(live_oc),
        "history": history,
        "history_since": history_since,
        "grade": grade_payload,
    }
