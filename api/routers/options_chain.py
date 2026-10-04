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

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()
ENABLED_ENV = "OPTIONS_CHAIN_ENABLED"
# BRK-01 increment 3: the implied-vol surface under the chain. Its OWN switch, and it rides on top
# of the chain's: the surface is served only while BOTH are "1".
SURFACE_ENABLED_ENV = "OPTIONS_VOL_SURFACE_ENABLED"
# BRK-01 increment 4: the options strategy backtester. Its OWN switch, riding on top of the
# chain's exactly like the surface: served only while BOTH are "1".
BACKTEST_ENABLED_ENV = "OPTIONS_BACKTEST_ENABLED"


def is_enabled() -> bool:
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


def is_surface_enabled() -> bool:
    return is_enabled() and os.environ.get(SURFACE_ENABLED_ENV, "").strip() == "1"


def is_backtest_enabled() -> bool:
    return is_enabled() and os.environ.get(BACKTEST_ENABLED_ENV, "").strip() == "1"


def _backtest_armed() -> None:
    if not is_backtest_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def _armed() -> None:
    if not is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def _surface_armed() -> None:
    if not is_surface_enabled():
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


@router.get("/api/research/options/{sym}/surface", dependencies=[Depends(_surface_armed)])
def option_vol_surface(sym: str,
                       expiration: str = Query("", max_length=10, pattern=r"^(\d{4}-\d{2}-\d{2})?$"),
                       _user: dict = Depends(require_paid)):
    """BRK-01 increment 3: smile, term structure and grid off TODAY'S chain (vendor IV, every
    point with its quote time). Bounded fan-out + 60 s cache live in api/services/vol_surface.py.
    Plain `def`: it blocks on the provider."""
    from api.services import vol_surface
    out = vol_surface.get_surface(sym, selected=expiration)
    _unavailable(out)
    return out


@router.post("/api/research/options/{sym}/backtest", status_code=202,
             dependencies=[Depends(_backtest_armed)])
def submit_option_backtest(sym: str, body: dict = Body(...), user: dict = Depends(require_paid)):
    """BRK-01 increment 4: queue one historical SIMULATION and hand back its job. NEVER computes:
    the run happens on api/services/options_backtest.py's bounded pool, off this request.
    Nothing here places, stages or sends an order. Per member: at most
    RUNS_PER_MEMBER_PER_HOUR new runs; a cached or in-flight identical run is free.
    Plain `def`: the submit takes a lock and returns."""
    from api.services import options_backtest as ob
    try:
        job = ob.submit(str(user["id"]), sym, body or {})
    except ob.BadParams as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ob.Refused as exc:
        headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else None
        raise HTTPException(status_code=exc.status, detail=str(exc), headers=headers) from exc
    return JSONResponse(status_code=202, content=ob.job_status(job, str(user["id"])))


def _backtest_more_armed() -> None:
    """FT-011 rides on the backtester's switches AND its own (OPTIONS_BACKTEST_MORE_ENABLED)."""
    from api.services import options_backtest as ob
    if not (is_backtest_enabled() and ob.more_enabled()):
        raise HTTPException(status_code=404, detail="Not Found")


@router.get("/api/research/options/{sym}/backtest-catalog", dependencies=[Depends(_backtest_more_armed)])
def option_backtest_catalog(sym: str, _user: dict = Depends(require_paid)):
    """FT-011: the structures and entry anchors the backtester will run while the switch is on.
    Plain `def`: it returns a constant table."""
    from api.services import options_backtest as ob
    return ob.catalog()


@router.get("/api/research/options/{sym}/backtest/{job}", dependencies=[Depends(_backtest_armed)])
def read_option_backtest(sym: str, job: str, user: dict = Depends(require_paid)):
    """One job's state -- the caller's own, or 404 (not-there and not-yours read the same). A
    failed run is still a 200 whose state says `failed`, so the client's poll stops."""
    from api.services import options_backtest as ob
    try:
        return ob.job_status(job, str(user["id"]))
    except ob.JobNotFound as exc:
        raise HTTPException(status_code=404, detail="Not found") from exc
