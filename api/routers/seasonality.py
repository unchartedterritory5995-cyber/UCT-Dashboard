"""COV-01 — per-ticker seasonality for the Research page (roadmap RM-L11).

Monthly and weekday return distributions, computed from the daily bars this pod
already serves (`api.services.seasonality`). No vendor, no licence question.

DARK behind SEASONALITY_ENABLED: unset, the route answers FastAPI's 404 before
identity is read. The handler is a plain `def`: the bar read is blocking SQLite /
provider I/O, and an `async def` that awaits nothing would run it ON the event loop
(tests/test_async_routes_do_not_block.py).
"""
from __future__ import annotations

import json
import os
import re

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()
ENABLED_ENV = "SEASONALITY_ENABLED"
DAILY_BARS = 8000          # ~31 years of sessions; the store answers with what it holds
_SYM_RE = re.compile(r"^[A-Z0-9.\-]{1,12}$")


def is_enabled() -> bool:
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


def _armed() -> None:
    if not is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for seasonality. Defined HERE (each router owns its own 402 sentence)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Seasonality requires a paid plan")
    return user


def _daily_bars(sym: str) -> list:
    """The LOCAL serve core, every parameter explicit (an omitted Query(...) default is a
    truthy FieldInfo when called directly). Only a 200 with a list counts."""
    from api.routers import bars as bars_router
    resp = bars_router.serve_bars(sym, "D", DAILY_BARS, "", "", 0)
    if getattr(resp, "status_code", 200) != 200:
        return []
    body = getattr(resp, "body", b"") or b""
    try:
        payload = json.loads(body)
    except ValueError:
        return []
    out = payload.get("bars") if isinstance(payload, dict) else None
    return out if isinstance(out, list) else []


@router.get("/api/research/seasonality/{sym}", dependencies=[Depends(_armed)])
def seasonality(sym: str, _user: dict = Depends(require_paid)):
    s = (sym or "").upper().strip()
    if not _SYM_RE.match(s):
        raise HTTPException(status_code=400, detail="Not a ticker")
    from api.services import seasonality as svc
    bars = _daily_bars(s)
    if not bars:
        # unavailable, never an empty table presented as "no pattern"
        raise HTTPException(status_code=503, detail=f"Daily bars for {s} are unavailable right now")
    out = svc.compute(bars)
    return {"ticker": s, "source": "UCT daily bar store, close to close", **out}
