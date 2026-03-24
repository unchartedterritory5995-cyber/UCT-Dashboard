from fastapi import APIRouter, HTTPException
from api.services.engine import get_screener, get_candidates
from api.services import breadth_monitor as bm_svc

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
        return get_candidates()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/scanner/universe")
def scanner_universe():
    """Pool all breadth list fields (52W highs, Stage 2, HVC, etc.) into a unified scanner universe."""
    try:
        return bm_svc.get_universe_stocks()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
