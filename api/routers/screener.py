from fastapi import APIRouter, HTTPException, Body, Depends
from pydantic import BaseModel
from api.services.engine import get_screener, get_candidates
from api.services import breadth_monitor as bm_svc
from api.services.screener import (
    query as scr_query,
    filters as scr_filters,
    snapshot_db as scr_db,
    saved_screens as scr_saved,
)
from api.middleware.auth_middleware import get_current_user

router = APIRouter()


@router.get("/api/screener")
def screener():
    try:
        return get_screener()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/candidates")
def candidates():
    try:
        result = get_candidates()
        try:
            from api.routers.bars import warm_bars_async
            cands = result.get("candidates") or result
            tickers = []
            for group in cands.values():
                if isinstance(group, list):
                    for c in group:
                        sym = (c.get("sym") or c.get("ticker")) if isinstance(c, dict) else None
                        if sym:
                            tickers.append(sym.upper())
            if tickers:
                warm_bars_async(list(dict.fromkeys(tickers)), tf="D", bars=8000)
        except Exception:
            pass
        return result
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/scanner/universe")
def scanner_universe():
    """Pool all breadth list fields (52W highs, Stage 2, HVC, etc.) into a unified scanner universe."""
    try:
        return bm_svc.get_universe_stocks()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


# ─── Full-market screener (precomputed snapshot, server-side query) ───────────

class ScanSpec(BaseModel):
    filters: list[dict] = []
    sort: dict | None = None
    view: str = "overview"
    page: int = 1
    page_size: int = 50


@router.get("/api/screener/meta")
def screener_meta(user=Depends(get_current_user)):
    """Filter registry + result views + filter categories (frontend-ready)."""
    return scr_filters.meta()


@router.post("/api/screener/scan")
def screener_scan(spec: ScanSpec, user=Depends(get_current_user)):
    try:
        return scr_query.run_scan(spec.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/screener/snapshot-status")
def screener_snapshot_status(user=Depends(get_current_user)):
    return scr_db.status()


@router.get("/api/screener/saved-screens")
def screener_saved_list(user=Depends(get_current_user)):
    scr_saved.init()
    return {"saved": scr_saved.list_for(user["id"]), "starters": scr_saved.starters()}


@router.post("/api/screener/saved-screens")
def screener_saved_create(payload: dict = Body(...), user=Depends(get_current_user)):
    scr_saved.init()
    if not payload.get("name") or payload.get("spec") is None:
        raise HTTPException(status_code=400, detail="name and spec required")
    return scr_saved.create(user["id"], payload["name"], payload["spec"],
                            bool(payload.get("is_public")))


@router.put("/api/screener/saved-screens/{sid}")
def screener_saved_update(sid: int, payload: dict = Body(...), user=Depends(get_current_user)):
    rec = scr_saved.update(sid, user["id"], **payload)
    if not rec:
        raise HTTPException(status_code=404, detail="not found")
    return rec


@router.delete("/api/screener/saved-screens/{sid}")
def screener_saved_delete(sid: int, user=Depends(get_current_user)):
    return {"deleted": scr_saved.delete(sid, user["id"])}


@router.get("/api/screener/shared/{share_token}")
def screener_shared(share_token: str):
    rec = scr_saved.get_public(share_token)
    if not rec:
        raise HTTPException(status_code=404, detail="not found")
    return rec
