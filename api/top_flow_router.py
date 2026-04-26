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
