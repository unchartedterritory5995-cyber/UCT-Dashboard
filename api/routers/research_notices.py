"""Lane R (D-11, D-12): the Research page notices that sit under the header.

One router, one dark flag PER SURFACE, each read per request by its service
module's `is_enabled()`; unset, that surface's route answers FastAPI's 404 before
identity is read (the research_depth form).

  ENTITY_RENAME_NOTICE_ENABLED   GET /api/research/rename-notice/{sym}        D-11
  METRIC_DISAGREEMENT_ENABLED    GET /api/research/metric-disagreement/{sym}  D-12

(D-9's line, MEMBER_INTEREST_LINE_ENABLED, reads the existing
`GET /api/member/interest` and adds no route.)

Every handler is a plain `def`: each reads local SQLite stores, which is blocking
I/O (tests/test_async_routes_do_not_block.py). No handler calls a vendor.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()
_SYM_RE = re.compile(r"^[A-Z0-9.\-]{1,12}$")


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the Research notices. Defined HERE (each router owns its own 402 sentence)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Research notices require a paid plan")
    return user


def _sym(sym: str) -> str:
    # The one route spelling (BRK.B -> BRK-B), refused with a sentence when it is
    # not a ticker -- `ticker_resolver.route_symbol` owns both rules.
    from api.services.ticker_resolver import require_route_symbol
    return require_route_symbol(sym)


# ── D-11 "formerly / now trades as" ────────────────────────────────────────

def _rename_notice_armed() -> None:
    from api.services import entity_rename_notice
    if not entity_rename_notice.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


@router.get("/api/research/rename-notice/{sym}", dependencies=[Depends(_rename_notice_armed)])
def rename_notice_route(sym: str, _user: dict = Depends(require_paid)):
    from api.services import entity_rename_notice as svc
    return svc.notice_for(_sym(sym))


# ── D-12 two computations of one metric ────────────────────────────────────

def _metric_disagreement_armed() -> None:
    from api.services import metric_disagreement
    if not metric_disagreement.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


@router.get("/api/research/metric-disagreement/{sym}", dependencies=[Depends(_metric_disagreement_armed)])
def metric_disagreement_route(sym: str, _user: dict = Depends(require_paid)):
    from api.services import metric_disagreement as svc
    return svc.disagreements_for(_sym(sym))
