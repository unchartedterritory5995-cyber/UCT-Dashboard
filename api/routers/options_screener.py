"""COV-02 / COV-03 -- the option screener and the market-wide option rankings.

  GET /api/options-screener/screen           -- screen the OPTION: contracts of the
                                                latest logged session that pass the
                                                filters (or a preset)
  GET /api/options-screener/unusual-volume   -- today's option volume / own average
  GET /api/options-screener/iv-percentile    -- today's ATM IV in its own history

All three read OUR options log's prebuilt per-session files
(`api/services/research/options_screener.py`); nothing scans the universe per request.

⛔ DARK behind `OPTIONS_SCREENER_ENABLED` (read per request, unset = OFF). Unset, every
route answers the FastAPI 404 body before any identity is read (`_armed` first).
⛔ PAID, with its own 402 sentence.
⛔ Plain `def`: SQLite, gzip and R2 reads block; FastAPI runs a `def` handler in its
threadpool (`tests/test_async_routes_do_not_block.py`).
⛔ Read-only: no route here places, stages or simulates a trade.

Rails: `tests/test_options_screener.py`.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.research import options_screener as svc

router = APIRouter(prefix="/api/options-screener", tags=["options-screener"])


def _armed() -> None:
    if not svc.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the option screener."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The option screener requires a paid plan")
    return user


def _read(fn, *a, **kw) -> dict:
    """A log that cannot be read is a 503 in words -- never an empty screen presented
    as "nothing matched"."""
    try:
        return fn(*a, **kw)
    except svc.BadQuery as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001 -- surfaced by name, never as an empty answer
        raise HTTPException(status_code=503,
                            detail=f"The options log is unavailable: {type(e).__name__}") from e


@router.get("/screen", dependencies=[Depends(_armed)])
def options_screen(request: Request, _user: dict = Depends(require_paid)):
    return _read(svc.screen, dict(request.query_params))


@router.get("/unusual-volume", dependencies=[Depends(_armed)])
def options_unusual_volume(_user: dict = Depends(require_paid)):
    return _read(svc.cached, "unusual_volume", svc.unusual_volume)


@router.get("/iv-percentile", dependencies=[Depends(_armed)])
def options_iv_percentile(_user: dict = Depends(require_paid)):
    return _read(svc.cached, "iv_percentile", svc.iv_percentile)
