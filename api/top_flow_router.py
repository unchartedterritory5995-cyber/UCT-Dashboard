"""
top_flow_router.py — API routes for Top Flow performance tracker.

POST /api/top-flow/save     — auto-called by frontend when CSV loads (saves picks)
GET  /api/top-flow/history  — returns all active + archived picks with daily history (READ snapshots here)
POST /api/top-flow/snapshot — WRITE-only: manual trigger to record a new price snapshot for active picks.
                              Returns 202-style {"status": "started"} immediately and runs in a background task.
                              There is intentionally no GET handler — anonymous GETs fall through to the SPA
                              and return the index.html shell. To read the most recent snapshot, use /history.
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
    """Trigger a new price snapshot for all active top-flow picks.

    POST-only by design — this is a write/side-effect endpoint that records a
    point-in-time price observation. To READ the latest snapshot or full
    history, GET /api/top-flow/history instead.

    A GET against /api/top-flow/snapshot will fall through to the React SPA
    catch-all and return index.html (this is expected, not a bug).
    """
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


@router.post("/wipe")
def wipe_all():
    """Wipe ALL picks (active + archived). Use carefully — irreversible.
    Intended for one-time clean-slate before switching tracker data sources."""
    from api.top_flow_tracker import _data, _save
    n_active = len(_data.get("active", []))
    n_archived = len(_data.get("archived", []))
    _data["active"] = []
    _data["archived"] = []
    _save()
    return {"wiped_active": n_active, "wiped_archived": n_archived}


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
