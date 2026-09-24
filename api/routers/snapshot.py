from fastapi import APIRouter, Depends, HTTPException
from api.middleware.auth_middleware import get_current_user
from api.services.massive import get_snapshot, get_ticker_snapshot

router = APIRouter()


@router.get("/api/snapshot")
def snapshot(user: dict = Depends(get_current_user)):
    try:
        return get_snapshot()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/snapshot/{ticker}")
def ticker_snapshot(ticker: str, user: dict = Depends(get_current_user)):
    try:
        data = get_ticker_snapshot(ticker.upper())
        return data if data else {}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
