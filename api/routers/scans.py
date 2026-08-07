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
    return scan_volume.status()
