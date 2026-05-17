from fastapi import APIRouter

from api.services.ticker_meta import get_ticker_meta

router = APIRouter()


@router.get("/api/ticker-meta/{ticker}")
def ticker_meta(ticker: str):
    try:
        return get_ticker_meta(ticker)
    except Exception:
        return {"name": None, "sector": None, "industry": None}
