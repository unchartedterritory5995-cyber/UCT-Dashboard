"""New-High / New-Low intraday scanner — the Charts "Situational Awareness" feed.

Thin HTTP layer; the stateful accumulation lives in `api/services/nhnl_live.py`.

⛔ EVERY ROUTE HERE IS PAID, AND `require_paid` IS DECLARED PER HANDLER — the same
contract as `api/routers/scans.py`. This serves the firm's live whole-market
new-HOD/new-LOD stream; `/charts` is a paid surface (`FREE_PAGES = ['/morning-wire']`)
and `main.py` mounts routers with no router-level dependency, so a route that omits
its own gate is reachable by anyone. `tests/test_nhnl_router.py` derives the route
set from `router.routes` and asserts every one is gated — a hand-listed test would
leave the next route uncovered the day someone adds it.
"""
from fastapi import APIRouter, Depends, Query
from fastapi.responses import ORJSONResponse as JSONResponse

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from fastapi import HTTPException

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        # "NH-NL", not the bare "scanner" volume_scan.py uses — every router's
        # 402 sentence is unique so "which surface locked me out" is answerable
        # from the message alone (test_user_definitions_auth pins the set).
        raise HTTPException(status_code=402, detail="The NH-NL scanner requires a paid plan")
    return user


def _appforms(sym: str) -> set[str]:
    """Every ticker spelling nhnl_live's state might key a class share under
    (app form uses a hyphen: BRK-B; providers vary), so a restrict-set match never
    misses on dot/hyphen notation."""
    s = (sym or "").strip().upper()
    if not s:
        return set()
    return {s, s.replace(".", "-"), s.replace("-", ".")}


def _resolve_restrict(etf: str | None, watchlist: str | None, user: dict) -> set[str] | None:
    """Resolve an ETF ticker or a watchlist id to the app-form symbol set that the
    live leaderboard should be limited to. None → no restriction (whole universe).
    Best-effort: any failure returns an empty set (an honest "no members" view) rather
    than silently widening back to the full market."""
    if etf:
        try:
            from api.services import etf_holdings
            out: set[str] = set()
            for h in etf_holdings.get_holdings(etf.strip().upper()) or []:
                out |= _appforms(h.get("sym"))
            return out
        except Exception:                                   # noqa: BLE001
            return set()
    if watchlist:
        try:
            from api.services import watchlist_service
            wl = watchlist_service.get_watchlist(watchlist, user["id"])
            out = set()
            for it in (wl or {}).get("items", []):
                out |= _appforms(it.get("sym"))
            return out
        except Exception:                                   # noqa: BLE001
            return set()
    return None


@router.get("/api/nhnl/live")
def nhnl_live(
    user: dict = Depends(require_paid),
    limit: int = Query(100, ge=1, le=600),
    min_price: float = Query(0.0, ge=0.0),
    min_count: int = Query(1, ge=1),
    group: str | None = Query(None, pattern="^(sector|industry|theme)$"),
    value: str | None = Query(None, max_length=120),
    etf: str | None = Query(None, max_length=12),
    watchlist: str | None = Query(None, max_length=64),
):
    """Ranked New-Highs / New-Lows leaderboards (busiest name per side first).

    `min_count` raises the bar to only persistent movers; `min_price` hides cheap
    stock. `group` (sector | industry | theme) scopes the view: with no `value` it
    ranks the whole universe and returns `categories` for the dropdown; with a
    `value` it restricts to that one category. `etf` (a fund ticker → its holdings) or
    `watchlist` (a list id → its symbols) restrict the whole leaderboard to that set,
    a FLAT view (they override `group`).
    """
    from api.services import nhnl_live
    restrict = _resolve_restrict(etf, watchlist, user)
    return JSONResponse(content=nhnl_live.get_live(
        limit=limit, min_price=min_price, min_count=min_count,
        group=group, value=(value or None), restrict=restrict))


@router.get("/api/nhnl/series")
def nhnl_series(_user: dict = Depends(require_paid)):
    """Intraday New-High vs New-Low activity time series (the "H/L Pulse" chart):
    two lines sampled through the session, plus the session's distinct-name totals
    for the bull/bear ratio bar."""
    from api.services import nhnl_live
    return JSONResponse(content=nhnl_live.get_series())


@router.get("/api/nhnl/status")
def nhnl_status(_user: dict = Depends(require_paid)):
    """Accumulator health (paid, like the feed it describes)."""
    from api.services import nhnl_live
    return nhnl_live.status()
