"""IPO calendar service — Finnhub /calendar/ipo merged with FMP stable/ipos-calendar.

Normalises rows into:
  { sym, name, date, exchange, price_range, shares, value, status }

Data-dependability migration plan, Phase 2 Task 11. `/calendar/ipo` is NOT one
of the permanently-forbidden Finnhub endpoints (unlike T1/T2/T6's targets) —
it works — but it is narrower than FMP's equivalent. Live-probed 2026-08-05
for the same 31-day window: Finnhub returned 12 rows (100% carrying shares/
price/value); FMP's `stable/ipos-calendar` returned 31 rows, but only ~1/3
carry numeric detail (`shares`/`priceRange`/`marketCap` are often null).
Neither source alone is complete, so both are merged rather than one
replacing the other: FMP supplies BREADTH (the extra symbols Finnhub never
returns), Finnhub supplies the richer per-row DETAIL when a symbol appears in
both. A symbol FMP alone knows about is still emitted with FMP's own
(possibly partial) numeric fields — better than dropping it.

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


def _fmp_ipo_get(from_date: str, to_date: str) -> list | None:
    """Call FMP `stable/ipos-calendar` for the given range.

    A different provider entirely — its own bounded timeout, never touches
    Finnhub's token bucket/cooldown. Returns the raw row list, or None on
    failure (missing key, network error, non-200 — `_fmp_get` already
    swallows all of that and returns None).
    """
    from api.services.earnings_estimates import _fmp_get
    data = _fmp_get("/stable/ipos-calendar", {"from": from_date, "to": to_date}, timeout=8)
    return data if isinstance(data, list) else None


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


def _normalize_fmp_row(row: dict) -> dict:
    """Normalize a single FMP `stable/ipos-calendar` row to the SAME shape
    `_normalize_row` produces from Finnhub, so callers never see a difference.

    FMP fields (live-verified 2026-08-05):
      symbol, company, date, exchange, actions, shares, priceRange, marketCap
    `actions` is `"Expected"`/`"Priced"` (capitalized) — lowercased here to
    match the existing `status` vocabulary (`"expected"`/`"priced"`) the
    Finnhub leg already produces and every consumer already expects.
    `shares`/`priceRange`/`marketCap` are frequently null on this endpoint —
    left as None, never defaulted to 0/"" (an absent detail is not a zero
    one).
    """
    sym    = (row.get("symbol") or "").strip().upper() or None
    name   = (row.get("company") or "").strip() or None
    date   = (row.get("date") or "").strip()[:10] or None
    exch   = (row.get("exchange") or "").strip() or None
    status = (row.get("actions") or "").strip().lower() or None

    price_raw = row.get("priceRange")
    price_range = str(price_raw).strip() if price_raw not in (None, "", "-") else None

    shares_raw = row.get("shares")
    shares: int | None = None
    if shares_raw is not None:
        try:
            shares = int(float(str(shares_raw).replace(",", "")))
        except (ValueError, TypeError):
            shares = None

    value_raw = row.get("marketCap")
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


def _merge_ipo_rows(fh_entries: list[dict], fmp_entries: list[dict]) -> list[dict]:
    """Merge Finnhub + FMP entries keyed on (sym, date).

    FMP supplies breadth: any (sym, date) it has that Finnhub doesn't is kept
    as-is (FMP's own, possibly partial, numeric fields). Where BOTH sources
    cover the same (sym, date), Finnhub's numeric fields (price_range/shares/
    value) win when present — it is the richer per-row source — falling back
    to FMP's only when Finnhub's own value for that field is None. Keyed on
    (sym, date) rather than sym alone so a company appearing twice in one
    window under two different dates (e.g. a postponed IPO) is never
    collapsed into one row — matching the pre-merge Finnhub-only behavior,
    which never deduped at all.
    """
    merged: dict[tuple, dict] = {}
    for entry in fmp_entries:
        key = (entry.get("sym"), entry.get("date"))
        merged[key] = dict(entry)
    for entry in fh_entries:
        key = (entry.get("sym"), entry.get("date"))
        base = merged.get(key)
        if base is None:
            merged[key] = dict(entry)
            continue
        merged[key] = {
            "sym":         entry.get("sym") or base.get("sym"),
            "name":        entry.get("name") or base.get("name"),
            "date":        entry.get("date") or base.get("date"),
            "exchange":    entry.get("exchange") or base.get("exchange"),
            "price_range": entry.get("price_range") if entry.get("price_range") is not None else base.get("price_range"),
            "shares":      entry.get("shares") if entry.get("shares") is not None else base.get("shares"),
            "value":       entry.get("value") if entry.get("value") is not None else base.get("value"),
            "status":      entry.get("status") or base.get("status"),
        }
    return sorted(merged.values(), key=lambda r: (r.get("date") or "", r.get("sym") or ""))


def get_ipos(from_date: str, to_date: str) -> list[dict]:
    """Return normalized IPO calendar entries for the given date range,
    merging Finnhub `/calendar/ipo` (numeric detail) with FMP
    `stable/ipos-calendar` (breadth) -- see module docstring.

    Result: list of { sym, name, date, exchange, price_range, shares, value, status }
    Rows with no symbol or date are silently dropped.
    Cached per (from_date, to_date) for 6 hours.
    Never raises — returns [] on any failure of EITHER provider; a failure
    of one still serves the other's rows.
    """
    cache_key = f"ipo_calendar_{from_date}_{to_date}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    def _normalize_all(raw, normalize_fn):
        out = []
        if not raw:
            return out
        for row in raw:
            if not isinstance(row, dict):
                continue
            try:
                entry = normalize_fn(row)
            except Exception as exc:
                _logger.debug("ipo_calendar: row normalize error: %s", exc)
                continue
            # Drop rows missing both sym and name (noise rows)
            if not entry.get("sym") and not entry.get("name"):
                continue
            if not entry.get("date"):
                continue
            out.append(entry)
        return out

    fh_entries = _normalize_all(_fh_ipo_get(from_date, to_date), _normalize_row)
    fmp_entries = _normalize_all(_fmp_ipo_get(from_date, to_date), _normalize_fmp_row)

    result = _merge_ipo_rows(fh_entries, fmp_entries)

    cache.set(cache_key, result, ttl=_CACHE_TTL)
    return result
