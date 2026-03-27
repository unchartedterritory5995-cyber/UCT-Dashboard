from fastapi import APIRouter, HTTPException

from api.services.sector_flow import compute_sector_flows

router = APIRouter()


@router.get("/api/sector-flow")
def sector_flow():
    """Return money flow analysis for 11 SPDR sector ETFs."""
    try:
        return compute_sector_flows()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
