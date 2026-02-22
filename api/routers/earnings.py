from fastapi import APIRouter, HTTPException
from api.services.engine import get_earnings

router = APIRouter()


@router.get("/api/earnings")
def earnings():
    try:
        return get_earnings()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
