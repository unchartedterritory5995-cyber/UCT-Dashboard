"""COV-04 — filing-to-filing blacklining for the Research page (roadmap RM-L12).

`GET /api/research/blackline/{sym}`: the two most recent 10-Ks of a symbol,
section by section (Item 1A Risk Factors, Item 7 MD&A), as a paragraph-level
diff. Built by `api.services.filing_blackline` from SEC EDGAR (class A).

DARK behind FILING_BLACKLINE_ENABLED: unset, the route answers FastAPI's 404
before identity is read. The handler is a plain `def`; it reads the cache only
and never calls SEC (a miss answers `state: pending` and queues one refresh on
the service's own worker).
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import filing_blackline as svc

router = APIRouter()
_SYM_RE = re.compile(r"^[A-Z0-9.\-]{1,12}$")


def is_enabled() -> bool:
    return svc.is_enabled()


def _armed() -> None:
    if not svc.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for filing changes. Defined HERE (each router owns its own 402 sentence)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Filing changes require a paid plan")
    return user


@router.get("/api/research/blackline/{sym}", dependencies=[Depends(_armed)])
def blackline(sym: str, _user: dict = Depends(require_paid)):
    s = (sym or "").upper().strip()
    if not _SYM_RE.match(s):
        raise HTTPException(status_code=400, detail="Not a ticker")
    return {"ticker": s, "source": "SEC EDGAR, the two most recent 10-K filings",
            **svc.blackline_snapshot(s)}
