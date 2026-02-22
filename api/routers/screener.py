from fastapi import APIRouter, HTTPException
from api.services.engine import get_screener

router = APIRouter()


@router.get("/api/screener")
def screener():
    try:
        return get_screener()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
