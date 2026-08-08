"""Scanner presets — universe-wide screens for the /charts Scanner widget.

Thin HTTP layer; the scanning logic lives in api/services/scan_volume.py.
"""
from fastapi import APIRouter
from fastapi.responses import ORJSONResponse as JSONResponse

router = APIRouter()


@router.get("/api/scans/highest-volume-1y")
def highest_volume_1y():
    """Stocks trading their highest volume in ~1 year (today's volume > trailing
    252-session max). Live all day; recomputed at most ~once/min server-side."""
    from api.services import scan_volume
    return JSONResponse(content=scan_volume.get_highest_volume_1y())


@router.get("/api/scans/highest-volume-1y/status")
def highest_volume_1y_status():
    """Reference-build readiness (no auth — read-only diagnostics)."""
    from api.services import scan_volume
    return scan_volume.status("1y")


@router.get("/api/scans/highest-volume-ever")
def highest_volume_ever():
    """Stocks trading their highest volume EVER (today's volume > all-time / since-
    inception max daily volume). Live all day; recomputed at most ~once/min."""
    from api.services import scan_volume
    return JSONResponse(content=scan_volume.get_highest_volume_ever())


@router.get("/api/scans/highest-volume-ever/status")
def highest_volume_ever_status():
    """Reference-build readiness (no auth — read-only diagnostics)."""
    from api.services import scan_volume
    return scan_volume.status("ever")


@router.get("/api/scans/ipo-1y")
def ipo_1y():
    """Stocks that first traded within the last year (IPO'd in the trailing 365 days).
    The only filter is that date window; live price/change attached per name."""
    from api.services import scan_ipo
    return JSONResponse(content=scan_ipo.get_ipo_last_1y())


@router.get("/api/scans/ipo-1y/status")
def ipo_1y_status():
    """Recent-IPO set readiness (no auth — read-only diagnostics)."""
    from api.services import scan_ipo
    return scan_ipo.status()


@router.get("/api/scans/top-gainers-30d")
def top_gainers_30d():
    """Top 5% of non-ETF stocks by 30-trading-day % change. Live all day."""
    from api.services import scan_gainers
    return JSONResponse(content=scan_gainers.get_top_gainers_30d())


@router.get("/api/scans/top-gainers-30d/status")
def top_gainers_30d_status():
    from api.services import scan_gainers
    return scan_gainers.status("30d")


@router.get("/api/scans/top-gainers-60d")
def top_gainers_60d():
    """Top 5% of non-ETF stocks by 60-trading-day % change. Live all day."""
    from api.services import scan_gainers
    return JSONResponse(content=scan_gainers.get_top_gainers_60d())


@router.get("/api/scans/top-gainers-60d/status")
def top_gainers_60d_status():
    from api.services import scan_gainers
    return scan_gainers.status("60d")


@router.get("/api/scans/top-gainers-90d")
def top_gainers_90d():
    """Top 5% of non-ETF stocks by 90-trading-day % change. Live all day."""
    from api.services import scan_gainers
    return JSONResponse(content=scan_gainers.get_top_gainers_90d())


@router.get("/api/scans/top-gainers-90d/status")
def top_gainers_90d_status():
    from api.services import scan_gainers
    return scan_gainers.status("90d")


@router.get("/api/scans/period-change")
def period_change(start: int, end: int):
    """Every US common stock ranked by % change over [start, end] (YYYYMMDD ints) — powers
    the Custom-Period Sort tool. Whole-market via two grouped-daily calls; sorted gainers-first."""
    from api.services import scan_period
    return JSONResponse(content=scan_period.get_period_change(int(start), int(end)))
