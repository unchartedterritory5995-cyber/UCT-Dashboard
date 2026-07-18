"""Multi-Chart Groups endpoints.

GET /api/groups                     -> theme list for the picker (rotation-sorted)
GET /api/groups/{group_id}/top      -> ranked, chartable top-N of a theme
GET /api/groups/peers?sym=&n=       -> a ticker's peers (taxonomy, similarity)
"""
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from api.services import groups as svc

router = APIRouter()


@router.get("/api/groups")
def list_groups():
    try:
        return {"groups": svc.list_groups()}
    except Exception as e:
        return JSONResponse(status_code=503, content={"error": f"groups unavailable: {e}"})


@router.get("/api/groups/{group_id}/top")
def group_top(group_id: str, n: int = Query(9, ge=1, le=16), by: str = Query("today")):
    try:
        return svc.top_n(group_id, n, by=by)
    except Exception as e:
        return JSONResponse(status_code=503, content={"error": f"groups unavailable: {e}"})


@router.get("/api/groups/peers")
def group_peers(sym: str = Query(..., max_length=12), n: int = Query(8, ge=1, le=16)):
    try:
        return svc.resolve_peers(sym, n)
    except Exception as e:
        return JSONResponse(status_code=503, content={"error": f"groups unavailable: {e}"})
