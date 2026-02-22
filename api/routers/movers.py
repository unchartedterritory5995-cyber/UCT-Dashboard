from fastapi import APIRouter, HTTPException
from api.services.massive import get_movers

router = APIRouter()


@router.get("/api/movers")
def movers():
    try:
        return get_movers()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
