"""TERM-088 (item 15 ACC-02) -- `GET /api/decision-record/ticker/{ticker}`.

The member door onto the Morning Wire's decision record: every issue that
considered a ticker, the stage each rejection happened at, beside the issues it
passed -- with the record's own derived coverage. Read-only over the Brain
Pack's copy of the engine DB (`api/services/decision_record.py`).

⛔ DARK behind `DECISION_RECORD_MEMBER_ENABLED` (read per request, unset = OFF).
Unset, the route answers the FastAPI 404 body to EVERY caller, admin included,
before any identity is read, and the engine DB is never opened. `_armed` is
the first dependency on purpose.

⛔ PAID. `require_paid` is defined HERE with its own 402 sentence
(`tests/test_user_definitions_auth.py` walks `api/routers/` and fails on a
shared import).

⛔ NOT a Wisdom router. Those are admin-by-contract and owned by another
programme (backlog §6.3); this is a separate member mount.

Rails: `tests/test_decision_record_member.py`.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.ticker_resolver import ticker_shape
from api.services import decision_record

router = APIRouter(prefix="/api/decision-record", tags=["decision-record-member"])


def _armed() -> None:
    if not decision_record.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the decision record."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The decision record requires a paid plan")
    return user


@router.get("/ticker/{ticker}", dependencies=[Depends(_armed)])
def ticker_decision_record(
    ticker: str = Depends(ticker_shape),
    limit: int = Query(decision_record.DEFAULT_LIMIT, ge=1, le=decision_record.MAX_LIMIT),
    offset: int = Query(0, ge=0),
    _user: dict = Depends(require_paid),
):
    """`{ticker, status, reason, rows, counts, coverage, paging, entity, source}`.

    `status` is `considered` | `not_considered` | `empty_record` |
    `unavailable`; `unavailable` names its `reason` and is never read as "not
    considered". Rows are newest issue first."""
    if not decision_record.normalize_ticker(ticker):
        raise HTTPException(status_code=422, detail="ticker is blank")
    return decision_record.ticker_record(ticker, limit=limit, offset=offset)
