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
    from api.top_flow_tracker import snapshot_prices
    result = await snapshot_prices()
    return result
