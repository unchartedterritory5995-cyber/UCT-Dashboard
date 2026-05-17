import logging

from fastapi import APIRouter

from api.services.ticker_meta import get_ticker_meta

_logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/ticker-meta/{ticker}")
def ticker_meta(ticker: str):
    try:
        return get_ticker_meta(ticker.upper())
    except Exception:
        _logger.warning("ticker_meta endpoint error for %s", ticker, exc_info=True)
        return {"name": None, "sector": None, "industry": None}
