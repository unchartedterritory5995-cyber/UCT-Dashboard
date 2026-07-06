"""api/routers/sector_strength.py

GET /api/sector-strength?period=Today — the 11 SPDR Select Sector ETFs ranked
strongest-first by period return ('Today' / '1W' / '1M' / '3M'). Thin wrapper
over the already-built, cached + single-flight `get_sector_strength` service.
"""
from fastapi import APIRouter

from api.services.sector_strength import get_sector_strength

router = APIRouter()


@router.get("/api/sector-strength")
def sector_strength(period: str = "Today"):
    return {"period": period, "sectors": get_sector_strength(period)}
