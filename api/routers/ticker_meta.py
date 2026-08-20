import logging

from fastapi import APIRouter

from api.services.ticker_meta import get_ticker_meta
from api.services.ticker_ipo import get_ipo_date

_logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/ticker-meta/{ticker}")
def ticker_meta(ticker: str):
    try:
        return get_ticker_meta(ticker.upper())
    except Exception:
        _logger.warning("ticker_meta endpoint error for %s", ticker, exc_info=True)
        return {"name": None, "sector": None, "industry": None}


@router.get("/api/ticker-ipo/{ticker}")
def ticker_ipo(ticker: str):
    """Official first-listing day (YYYY-MM-DD) or null. Powers the chart's
    first-bar 'IPO' badge: the badge shows only when the earliest loaded bar is at
    this date, so an absent/earlier list_date correctly reads as 'more history
    exists than is on screen'. Cheap + heavily cached (list_date is immutable)."""
    try:
        return get_ipo_date(ticker.upper())
    except Exception:
        _logger.warning("ticker_ipo endpoint error for %s", ticker, exc_info=True)
        return {"symbol": ticker.upper(), "list_date": None}
