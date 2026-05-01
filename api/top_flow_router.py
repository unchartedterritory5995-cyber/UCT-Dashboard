"""
top_flow_router.py — API routes for Top Flow performance tracker.

POST /api/top-flow/save   — auto-called by frontend when CSV loads (saves picks)
GET  /api/top-flow/history — returns all active + archived picks with daily history
POST /api/top-flow/snapshot — manual trigger to snapshot current prices
"""

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api/top-flow", tags=["top-flow"])


class Pick(BaseModel):
    sym: str
    cp: str
    strike: float
    exp: str
    entry: float = 0
    grade: str = ""
    dir: str = ""
    cap: str = ""
    hits: int = 0
    prem: float = 0
    dateSaved: str = ""


@router.post("/save")
def save_picks(picks: list[Pick]):
    from api.top_flow_tracker import save_picks as _save
    result = _save([p.model_dump() for p in picks])
    return result


@router.get("/history")
def get_history():
    from api.top_flow_tracker import get_all
    return get_all()


@router.post("/snapshot")
async def trigger_snapshot():
    import asyncio
    from api.top_flow_tracker import snapshot_prices

    async def _run():
        try:
            result = await snapshot_prices()
            import logging
            logging.getLogger(__name__).info("[top-flow-router] Background snapshot done: %s", result)
        except Exception as e:
            import logging
            logging.getLogger(__name__).error("[top-flow-router] Background snapshot error: %s", e)

    asyncio.create_task(_run())
    return {"status": "started", "message": "Snapshot running in background. Check Railway logs for results."}


@router.post("/archive-now")
def trigger_archive():
    """Debug endpoint — just archive expired picks, no Schwab calls."""
    from api.top_flow_tracker import archive_expired, get_all
    count = archive_expired()
    data = get_all()
    return {"archived_now": count, "active": len(data["active"]), "archived_total": len(data["archived"])}


@router.get("/purge-old/{keep_days}")
def purge_old(keep_days: int = 30):
    """Remove active picks older than keep_days by dateSaved. Moves them to archived."""
    from api.top_flow_tracker import _data, _save
    from datetime import date, timedelta
    cutoff = (date.today() - timedelta(days=keep_days)).isoformat()
    still_active = []
    purged = 0
    for p in _data.get("active", []):
        if p.get("dateSaved", "9999") < cutoff:
            p["archivedDate"] = date.today().isoformat()
            p["purgeReason"] = f"older than {keep_days}d"
            entry = p.get("entry", 0)
            hist = p.get("history", [])
            final = hist[-1]["price"] if hist else 0
            p["finalPrice"] = final
            p["finalPnl"] = round((final - entry) / entry * 100, 1) if entry > 0 and final > 0 else 0
            _data["archived"].append(p)
            purged += 1
        else:
            still_active.append(p)
    _data["active"] = still_active
    if purged:
        _save()
    return {"purged": purged, "active": len(still_active), "archived_total": len(_data["archived"])}
