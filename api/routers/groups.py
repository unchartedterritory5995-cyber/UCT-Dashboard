"""Multi-Chart Groups endpoints.

GET /api/groups                     -> theme list for the picker (rotation-sorted)
GET /api/groups/{group_id}/top      -> ranked, chartable top-N of a theme
GET /api/groups/peers?sym=&n=       -> a ticker's peers (taxonomy, similarity)


🔴 ALL THREE WERE ANONYMOUS (auth/paywall sweep, 2026-08-09) — `GET /api/groups`
alone returned **15,265 bytes**. This is the firm's theme taxonomy plus its
rotation ranking and its peer-similarity model: what we think the groups ARE and
which names lead them. Their only consumers are `/charts` widgets, which
`AuthGuard` serves to paid/admin only, so gating costs no member anything.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import groups as svc

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the theme-group + peers surface.

    ⛔ Defined HERE, not imported from a sibling. Every router that gates on
    `require_paid` defines its own with its OWN 402 sentence, so "which surface
    locked me out" is answerable from the message alone. The rail is
    `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`,
    which walks `api/routers/` by AST and fails on a shared import.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Group and peer data requires a paid plan")
    return user


@router.get("/api/groups")
def list_groups(_user: dict = Depends(require_paid)):
    try:
        return {"groups": svc.list_groups()}
    except Exception as e:
        return JSONResponse(status_code=503, content={"error": f"groups unavailable: {e}"})


@router.get("/api/groups/{group_id}/top")
def group_top(group_id: str, n: int = Query(9, ge=1, le=16), by: str = Query("today"),
              _user: dict = Depends(require_paid)):
    try:
        return svc.top_n(group_id, n, by=by)
    except Exception as e:
        return JSONResponse(status_code=503, content={"error": f"groups unavailable: {e}"})


@router.get("/api/groups/peers")
def group_peers(sym: str = Query(..., max_length=12), n: int = Query(8, ge=1, le=16),
                _user: dict = Depends(require_paid)):
    try:
        return svc.resolve_peers(sym, n)
    except Exception as e:
        return JSONResponse(status_code=503, content={"error": f"groups unavailable: {e}"})
