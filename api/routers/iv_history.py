"""`GET /api/research/iv-history/{sym}` and `.../{sym}/implied-vs-realized`.

The member door onto OUR options log (`api/services/research/iv_history.py`): the ATM
IV series a symbol has accumulated since logging began, IV rank only from 20 sessions,
and BRK-10's first slice (a print's implied move against its realized move).

⛔ DARK behind `IV_HISTORY_ENABLED` (read per request, unset = OFF). Unset, both
routes answer the FastAPI 404 body before any identity is read (`_armed` first).
⛔ PAID, with its own 402 sentence (`tests/test_user_definitions_auth.py`).
⛔ Plain `def`: the store reads R2 and gzip files, which block; FastAPI runs a `def`
handler in its threadpool (`tests/test_async_routes_do_not_block.py`).

Rails: `tests/test_iv_history.py`.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.research import iv_history

router = APIRouter(prefix="/api/research", tags=["iv-history"])


def _armed() -> None:
    if not iv_history.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the IV history."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The IV history requires a paid plan")
    return user


def _sym(sym: str) -> str:
    s = iv_history.normalize_symbol(sym)
    if not s:
        raise HTTPException(status_code=422, detail="not a ticker symbol")
    return s


def _read(fn, s: str) -> dict:
    """A store that cannot be read is a 503 the page says in words -- never an empty
    series presented as "no history"."""
    try:
        return fn(s)
    except Exception as e:  # noqa: BLE001 -- surfaced by name, never as an empty answer
        raise HTTPException(status_code=503,
                            detail=f"The options log is unavailable: {type(e).__name__}") from e


@router.get("/iv-history/{sym}", dependencies=[Depends(_armed)])
def iv_history_series(sym: str = Path(..., min_length=1, max_length=16),
                      _user: dict = Depends(require_paid)):
    return _read(iv_history.iv_history, _sym(sym))


@router.get("/iv-history/{sym}/implied-vs-realized", dependencies=[Depends(_armed)])
def iv_history_implied_vs_realized(sym: str = Path(..., min_length=1, max_length=16),
                                   _user: dict = Depends(require_paid)):
    return _read(iv_history.implied_vs_realized, _sym(sym))
