"""READ ONLY: the forward dividends and splits this server already holds for one stock.

`dividends_calendar.get_events_with_status()` asks the market-data vendor (two reference reads per stock) whenever
nothing is held for the symbol set it is asked. A reader that must never start that work (the UCT Agent's
`calendar.dividends` data kind, MD-1 §4.17) reads through `held_events()` instead: what the service last stored for
that ONE stock (the answer `GET /api/calendar/dividends?syms=<sym>` serves, the dividend calendar panel's one-stock
read), with the time it stored it and whether the service marked that read incomplete, or nothing. It never fetches,
never calls a vendor and never writes to the cache.

It lives beside the service and not inside it, so the service's own calls are unchanged. The cache keys are the
service's own (`_syms_cache_key`, `_partial_key`) and so are the lifetimes (`_CACHE_TTL`, `_CACHE_TTL_PARTIAL`), all
read at call time, never retyped here.
"""
from __future__ import annotations

from typing import Optional


def held_events(sym: str) -> tuple[Optional[list], Optional[float], str]:
    """READ ONLY: `(rows, stored_at, how)` for one stock, without asking a vendor.

    `how` is `complete` (the rows the service stored for that stock alone, untouched, and every vendor read behind them
    answered), `incomplete` (the service stored them and marked the read incomplete: a vendor read failed or was cut by
    its deadline, so events may be missing) or `not_held` (nothing is held for that stock alone, or the entry is not a
    list). `stored_at` is the unix time the service stored the rows: the entry's expiry less the service's own lifetime
    for that kind of entry (the cache keeps an absolute expiry, also across a restart). Never fetches."""
    from api.services import dividends_calendar as svc
    from api.services.cache import cache

    key = svc._syms_cache_key([sym])
    partial = svc._partial_key(key)
    found = {k: (value, expires_at) for k, value, expires_at in cache.items_with_expiry() if k in (key, partial)}
    if key not in found or not isinstance(found[key][0], list):
        return None, None, "not_held"
    rows, expires_at = found[key]
    incomplete = partial in found and bool(found[partial][0])
    ttl = svc._CACHE_TTL_PARTIAL if incomplete else svc._CACHE_TTL
    return rows, float(expires_at) - float(ttl), "incomplete" if incomplete else "complete"
