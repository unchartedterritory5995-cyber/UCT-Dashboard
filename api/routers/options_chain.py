"""BRK-01 increment 1 — the member-facing option chain (roadmap §3.3).

A chain grid with the full greek set, off the licensed Massive chain that TERM-069 made the one
implementation (`api/services/polygon_options.py`). Measured 2026-09-29 against our own key: the
live snapshot returns greeks, IV and open interest on 88/88 near-the-money SPY contracts, REAL-TIME
quotes — so the live half is CLEARED on the plan we already hold (the §3.3 condition). IV RANK is
NOT served: it needs IV history, which is the open question in the Massive vendor ask.

⛔ Charter edges (roadmap §3.3): no "run this", "execute" or send-to-broker affordance of any kind,
no position of record. This serves numbers to read, nothing to act on.

DARK behind OPTIONS_CHAIN_ENABLED: unset, both routes answer FastAPI's 404 before identity is read.
Both handlers are plain `def`: `polygon_options` makes blocking HTTP calls, and an `async def` that
awaits nothing would run them ON the event loop (tests/test_async_routes_do_not_block.py).
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()
ENABLED_ENV = "OPTIONS_CHAIN_ENABLED"


def is_enabled() -> bool:
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


def _armed() -> None:
    if not is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the option chain. Defined HERE (each router owns its own 402 sentence)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The option chain requires a paid plan")
    return user


def _unavailable(result: dict) -> None:
    """A provider failure is a 503 the page says in words -- never an empty chain presented as
    "no options trade on this name"."""
    if isinstance(result, dict) and result.get("error"):
        raise HTTPException(status_code=503, detail=f"Option chain unavailable: {result['error']}")


@router.get("/api/research/options/{sym}/expirations", dependencies=[Depends(_armed)])
def option_expirations(sym: str, _user: dict = Depends(require_paid)):
    from api.services import polygon_options
    out = polygon_options.list_expirations(sym)
    _unavailable(out)
    return out


@router.get("/api/research/options/{sym}/chain", dependencies=[Depends(_armed)])
def option_chain(sym: str,
                 expiration: str = Query("", max_length=10, pattern=r"^(\d{4}-\d{2}-\d{2})?$"),
                 strikes: int = Query(10, ge=2, le=20),
                 _user: dict = Depends(require_paid)):
    from api.services import polygon_options
    out = polygon_options.get_chain(sym, expiration=expiration, strikes_around_spot=strikes)
    _unavailable(out)
    return {**out, "served_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "cache_seconds": polygon_options._CHAIN_TTL,
            "iv_rank": None, "iv_rank_reason": "needs IV history, not yet licensed"}
