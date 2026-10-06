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


class HistoryPending(Exception):
    """L8: the serve answered with a PARTIAL daily history (a cold read: the store's
    shallow tail while the deep backfill runs in the background)."""


class NoDailyHistory(Exception):
    """The bar serve said, in so many words, that it carries no bars for this symbol
    (`no_data`). That is an answer -- a 404 -- not an outage."""


class BarsUnavailable(Exception):
    """The bar serve failed (a non-200 that is not a fetch in flight). Carries the
    serve's own classified reason so the 503 says which failure it was."""


def _history_is_partial(sym: str, n_bars: int) -> bool:
    """The bar serve's OWN test for a partial deep read (bars_fetch: fewer than 90% of
    the requested bars AND no "this is all there is" marker), so the two cannot
    disagree about what "partial" means. A short-lived listing whose full history has
    been read carries the marker and is not partial."""
    from api.services import bars_fetch
    return n_bars < DAILY_BARS * 0.9 and not bars_fetch._history_complete(sym.upper(), "D")


def _daily_bars(sym: str) -> list:
    """The LOCAL serve core, every parameter explicit (an omitted Query(...) default is a
    truthy FieldInfo when called directly). Only a 200 with a list counts. Raises
    HistoryPending when the serve handed back a partial cold read (L8).

    ⛔ THE SERVE'S OWN VERDICT IS READ, NEVER FLATTENED. This used to turn every
    non-200 into `[]`, so a "warming" 503 (a cold fetch already running, which the
    serve answers with Retry-After so the client re-polls) and a real fault both
    reached the member as "unavailable right now" with no Retry-After -- and a
    "this symbol is not carried" 200 read the same way. Each is now its own answer:
    warming -> HistoryPending (503 + Retry-After), not carried -> NoDailyHistory
    (404), any other failure -> BarsUnavailable carrying the serve's reason."""
    from api.routers import bars as bars_router
    resp = bars_router.serve_bars(sym, "D", DAILY_BARS, "", "", 0)
    status = getattr(resp, "status_code", 200)
    body = getattr(resp, "body", b"") or b""
    try:
        payload = json.loads(body)
    except ValueError:
        payload = None
    payload = payload if isinstance(payload, dict) else {}
    if status != 200:
        if payload.get("warming") is True or payload.get("error") == "warming":
            raise HistoryPending(sym)
        raise BarsUnavailable(str(payload.get("error") or f"status {status}"))
    out = payload.get("bars")
    out = out if isinstance(out, list) else []
    if not out and payload.get("no_data"):
        raise NoDailyHistory(sym)
    if out and _history_is_partial(sym, len(out)):
        raise HistoryPending(sym)
    return out


@router.get("/api/research/seasonality/{sym}", dependencies=[Depends(_armed)])
def seasonality(sym: str, _user: dict = Depends(require_paid)):
    # The one route spelling: the bar store holds BRK-B, never BRK.B.
    from api.services.ticker_resolver import require_route_symbol
    s = require_route_symbol(sym)
    from api.services import seasonality as svc
    try:
        bars = _daily_bars(s)
    except HistoryPending:
        # L8: a cold read measured 2024-09-16..today (n=2 per month) where the warm
        # call covers 2021+. A table computed from that would state a short record as
        # THE record. The full read is already running behind the serve; ask again.
        raise HTTPException(
            status_code=503,
            detail=f"The full daily history for {s} is still being read; try again shortly",
            headers={"Retry-After": "15"})
    except NoDailyHistory:
        raise HTTPException(status_code=404, detail=f"No daily bars are held for {s}")
    except BarsUnavailable as e:
        raise HTTPException(
            status_code=503,
            detail=f"Daily bars for {s} are unavailable right now ({e})",
            headers={"Retry-After": "30"})
    if not bars:
        # unavailable, never an empty table presented as "no pattern"
        raise HTTPException(status_code=503, detail=f"Daily bars for {s} are unavailable right now")
    out = svc.compute(bars)
    return {"ticker": s, "source": "UCT daily bar store, close to close", **out}
