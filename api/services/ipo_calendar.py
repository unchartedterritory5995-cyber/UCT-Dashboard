"""IPO calendar service — Finnhub /calendar/ipo.

Normalises Finnhub ipoCalendar rows into:
  { sym, name, date, exchange, price_range, shares, value, status }

Cached 6 hours.  Never raises — returns [] on any failure.
"""

from __future__ import annotations
import logging

from api.services.cache import cache
from api.services.finnhub_client import fh_get

_logger = logging.getLogger(__name__)

_CACHE_TTL = 21_600   # 6 hours
_TIMEOUT   = 10       # seconds


def _fh_ipo_get(from_date: str, to_date: str) -> list | None:
    """Call Finnhub /calendar/ipo for the given range.

    Routed through the shared finnhub_client.fh_get (2026-08-05) so this call
    shares the process-wide token bucket / 429 cooldown with every other
    Finnhub caller instead of spending the same account budget uncoordinated.
    Returns the raw ipoCalendar list, or None on failure/budget-shed.
    """
    data = fh_get("/calendar/ipo", {"from": from_date, "to": to_date}, timeout=_TIMEOUT)
    return data.get("ipoCalendar") if isinstance(data, dict) else None


def _normalize_row(row: dict) -> dict:
    """Normalize a single Finnhub ipoCalendar row.

    Finnhub fields (verified on our tier):
      date, exchange, name, numberOfShares, price, status, symbol, totalSharesValue
    """
    sym    = (row.get("symbol") or "").strip().upper() or None
    name   = (row.get("name") or "").strip() or None
    date   = (row.get("date") or "").strip()[:10] or None
    exch   = (row.get("exchange") or "").strip() or None
    status = (row.get("status") or "").strip() or None

    # price field is a string like "$18.00-$20.00" or "$19.00" — keep as-is
    price_raw = row.get("price")
    price_range = str(price_raw).strip() if price_raw not in (None, "", "-") else None

    # numberOfShares — Finnhub may return int or string
    shares_raw = row.get("numberOfShares")
    shares: int | None = None
    if shares_raw is not None:
        try:
            shares = int(float(str(shares_raw).replace(",", "")))
        except (ValueError, TypeError):
            shares = None

    # totalSharesValue — total offering value in dollars
    value_raw = row.get("totalSharesValue")
    value: float | None = None
    if value_raw is not None:
        try:
            value = float(str(value_raw).replace(",", ""))
        except (ValueError, TypeError):
            value = None

    return {
        "sym":         sym,
        "name":        name,
        "date":        date,
        "exchange":    exch,
        "price_range": price_range,
        "shares":      shares,
        "value":       value,
        "status":      status,
    }


def get_ipos(from_date: str, to_date: str) -> list[dict]:
    """Return normalized IPO calendar entries for the given date range.

    Result: list of { sym, name, date, exchange, price_range, shares, value, status }
    Rows with no symbol or date are silently dropped.
    Cached per (from_date, to_date) for 6 hours.
    Never raises — returns [] on any failure.
    """
    cache_key = f"ipo_calendar_{from_date}_{to_date}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    raw = _fh_ipo_get(from_date, to_date)
    result: list[dict] = []

    if raw:
        for row in raw:
            if not isinstance(row, dict):
                continue
            try:
                entry = _normalize_row(row)
            except Exception as exc:
                _logger.debug("ipo_calendar: row normalize error: %s", exc)
                continue
            # Drop rows missing both sym and name (noise rows)
            if not entry.get("sym") and not entry.get("name"):
                continue
            if not entry.get("date"):
                continue
            result.append(entry)

    cache.set(cache_key, result, ttl=_CACHE_TTL)
    return result
