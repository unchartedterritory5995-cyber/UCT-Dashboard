import logging

from fastapi import APIRouter

from pydantic import BaseModel

from api.services.ticker_meta import get_ticker_meta, peek_ticker_meta
from api.services.ticker_ipo import get_ipo_date

_logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/ticker-meta/{ticker}")
def ticker_meta(ticker: str):
    try:
        meta = get_ticker_meta(ticker.upper())
    except Exception:
        _logger.warning("ticker_meta endpoint error for %s", ticker, exc_info=True)
        return {"name": None, "sector": None, "industry": None}
    # Wave-2 audit: an all-null answer for a symbol that is not a ticker carries the additive
    # `not_found` marker (api/services/symbol_presence.py). A provider failure (the except
    # above) never does -- that is "we could not read it", not "it does not exist".
    from api.services.symbol_presence import mark_if_empty
    empty = isinstance(meta, dict) and not any(
        meta.get(k) for k in ("name", "sector", "industry", "exchange"))
    return mark_if_empty(meta, ticker, empty)


# The most names one batch answers: a screen's first page and then some.
BATCH_MAX = 100


class TickerMetaBatchIn(BaseModel):
    tickers: list[str]


@router.post("/api/ticker-meta/batch")
def ticker_meta_batch(body: TickerMetaBatchIn):
    """The details the server ALREADY holds for many tickers, in one round-trip.

    A list's warm asked one request per stock. This answers every cached one and names the
    rest `missing`, never calling a provider: a cold name costs a provider round-trip, and a
    batch of them would serialise every one behind a single request. The client sends the
    missing names down the per-symbol route."""
    syms = list(dict.fromkeys((t or "").upper().strip() for t in (body.tickers or []) if t and t.strip()))[:BATCH_MAX]
    results, missing = {}, []
    for sym in syms:
        try:
            meta = peek_ticker_meta(sym)
        except Exception:
            _logger.warning("ticker_meta batch peek failed for %s", sym, exc_info=True)
            meta = None
        if meta is None:
            missing.append(sym)
        else:
            results[sym] = meta
    return {"results": results, "missing": missing}


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
