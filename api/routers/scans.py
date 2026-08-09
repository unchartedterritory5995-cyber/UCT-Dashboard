"""Scanner presets — universe-wide screens for the /charts Scanner widget.

Thin HTTP layer; the scanning logic lives in api/services/scan_volume.py.

⛔ EVERY ROUTE HERE IS PAID, AND `require_paid` IS DECLARED PER HANDLER.
These thirteen routes served the firm's proprietary whole-market scan output to
anyone who could type the URL — measured 2026-08-08:
`GET /api/scans/top-gainers-30d` answered an anonymous caller **200 with 18,892
bytes of ranked whole-market data**. `main.py` calls `include_router` with no
router-level dependency, so a route that omits its own gate is reachable by
anybody; the shape is copied from `api/routers/signature.py:174`, which defines
its own `require_paid` and repeats it on every route.

⛔ AND THE `/status` ROUTES ARE GATED TOO. Their docstrings used to say
"(no auth — read-only diagnostics)". That was a description of an accident, not a
ruling: `status()` publishes the reference-build state of a premium scan (its
session date, its universe size, whether today's answer is ready), it has NO
consumer anywhere in `app/` or in any sibling repo (swept 2026-08-08), and a
diagnostics exemption is exactly the half-gated router
`test_a_free_user_is_refused_on_EVERY_route` exists to catch. Owner ruling
2026-08-06, reaffirmed 08-07: *"everything is paid, almost nothing is accessible
for free."*

⛔ THE COVERAGE TEST IS DERIVED FROM `router.routes` WITH THE COUNT ASSERTED —
`tests/test_scan_screener_auth.py`. Phase C Task 13 MEASURED why: it dropped
`Depends(require_paid)` from `/confluence` and the shipped test stayed GREEN,
because the test hand-listed THREE paths while the router had FIVE. A hand-listed
test here would leave the fourteenth route uncovered the day someone adds it.

Consumers (swept 2026-08-08, and every one of them is behind the paywall):
  * the six preset scans → `app/src/pages/charts/widgets/ScannerResults.jsx`
  * `/period-change`     → `app/src/pages/charts/PeriodSortPanel.jsx`
Both live on `/charts`, which `AuthGuard` serves only to a paid or admin user
(`FREE_PAGES = ['/morning-wire']`). No `/status` route has a consumer at all.
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import ORJSONResponse as JSONResponse

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Scanner presets require a paid plan")
    return user


@router.get("/api/scans/highest-volume-1y")
def highest_volume_1y(_user: dict = Depends(require_paid)):
    """Stocks trading their highest volume in ~1 year (today's volume > trailing
    252-session max). Live all day; recomputed at most ~once/min server-side."""
    from api.services import scan_volume
    return JSONResponse(content=scan_volume.get_highest_volume_1y())


@router.get("/api/scans/highest-volume-1y/status")
def highest_volume_1y_status(_user: dict = Depends(require_paid)):
    """Reference-build readiness for a premium scan — paid, like the scan itself."""
    from api.services import scan_volume
    return scan_volume.status("1y")


@router.get("/api/scans/highest-volume-ever")
def highest_volume_ever(_user: dict = Depends(require_paid)):
    """Stocks trading their highest volume EVER (today's volume > all-time / since-
    inception max daily volume). Live all day; recomputed at most ~once/min."""
    from api.services import scan_volume
    return JSONResponse(content=scan_volume.get_highest_volume_ever())


@router.get("/api/scans/highest-volume-ever/status")
def highest_volume_ever_status(_user: dict = Depends(require_paid)):
    """Reference-build readiness for a premium scan — paid, like the scan itself."""
    from api.services import scan_volume
    return scan_volume.status("ever")


@router.get("/api/scans/ipo-1y")
def ipo_1y(_user: dict = Depends(require_paid)):
    """Stocks that first traded within the last year (IPO'd in the trailing 365 days).
    The only filter is that date window; live price/change attached per name."""
    from api.services import scan_ipo
    return JSONResponse(content=scan_ipo.get_ipo_last_1y())


@router.get("/api/scans/ipo-1y/status")
def ipo_1y_status(_user: dict = Depends(require_paid)):
    """Recent-IPO set readiness for a premium scan — paid, like the scan itself."""
    from api.services import scan_ipo
    return scan_ipo.status()


@router.get("/api/scans/top-gainers-30d")
def top_gainers_30d(_user: dict = Depends(require_paid)):
    """Top 5% of non-ETF stocks by 30-trading-day % change. Live all day."""
    from api.services import scan_gainers
    return JSONResponse(content=scan_gainers.get_top_gainers_30d())


@router.get("/api/scans/top-gainers-30d/status")
def top_gainers_30d_status(_user: dict = Depends(require_paid)):
    from api.services import scan_gainers
    return scan_gainers.status("30d")


@router.get("/api/scans/top-gainers-60d")
def top_gainers_60d(_user: dict = Depends(require_paid)):
    """Top 5% of non-ETF stocks by 60-trading-day % change. Live all day."""
    from api.services import scan_gainers
    return JSONResponse(content=scan_gainers.get_top_gainers_60d())


@router.get("/api/scans/top-gainers-60d/status")
def top_gainers_60d_status(_user: dict = Depends(require_paid)):
    from api.services import scan_gainers
    return scan_gainers.status("60d")


@router.get("/api/scans/top-gainers-90d")
def top_gainers_90d(_user: dict = Depends(require_paid)):
    """Top 5% of non-ETF stocks by 90-trading-day % change. Live all day."""
    from api.services import scan_gainers
    return JSONResponse(content=scan_gainers.get_top_gainers_90d())


@router.get("/api/scans/top-gainers-90d/status")
def top_gainers_90d_status(_user: dict = Depends(require_paid)):
    from api.services import scan_gainers
    return scan_gainers.status("90d")


@router.get("/api/scans/period-change")
def period_change(start: int, end: int, _user: dict = Depends(require_paid)):
    """Every US common stock ranked by % change over [start, end] (YYYYMMDD ints) — powers
    the Custom-Period Sort tool. Whole-market via two grouped-daily calls; sorted gainers-first."""
    from api.services import scan_period
    return JSONResponse(content=scan_period.get_period_change(int(start), int(end)))


@router.get("/api/scans/period-change-groups")
def period_change_groups(start: int, end: int, group: str, _user: dict = Depends(require_paid)):
    """Themes / sectors / industries ranked by equal-weight mean % change over [start, end].
    `group` ∈ {theme, sector, industry}; each result carries its member symbols for drill-down."""
    from api.services import scan_period
    return JSONResponse(content=scan_period.get_period_change_groups(int(start), int(end), group))


@router.get("/api/scans/period-change-debug")
def period_change_debug(start: int, end: int, _user: dict = Depends(require_paid)):
    """Ground-truth probe for a stuck pre-2004 Custom-Period Sort: grouped-daily coverage,
    whether bars.db actually HOLDS daily data near the dates, the by-date index state, and
    the current cache/inflight state. Paid, like every route here."""
    from api.services import scan_period
    return JSONResponse(content=scan_period.debug_period(int(start), int(end)))
