from fastapi import APIRouter, HTTPException
from api.services.massive import get_movers, get_extended_movers

router = APIRouter()


@router.get("/api/movers")
def movers():
    try:
        return get_movers()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/extended-movers")
def extended_movers():
    try:
        return get_extended_movers()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
