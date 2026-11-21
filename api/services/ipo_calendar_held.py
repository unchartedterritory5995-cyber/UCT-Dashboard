"""READ ONLY: the IPO calendar this server already holds for one date range.

`ipo_calendar.get_ipos_with_status()` asks two vendors (Finnhub and FMP) whenever nothing is held for the range it is
asked. A reader that must never start that work (the UCT Agent's `calendar.ipos` data kind, MD-1 §4.17) reads through
`held_ipos()` instead: the merged rows the service last stored for exactly that range, with the time it stored them,
or the service's own record that both vendors failed for that range, or nothing. It never fetches, never calls a
vendor and never writes to the cache.

It lives beside the service and not inside it, so the service's own calls are unchanged. The cache keys are the ones
`get_ipos_with_status()` writes (`ipo_calendar_<from>_<to>` for the rows, `ipo_calendar_failed_<from>_<to>` for the
both-vendors-failed record); a rail drives the service itself and reads its answer back through this reader, so a key
that drifted fails it. The lifetimes are the service's own (`_CACHE_TTL`, `_CACHE_TTL_FAILED`), read at call time,
never retyped here.
"""
from __future__ import annotations

from typing import Optional


def rows_key(from_date: str, to_date: str) -> str:
    return f"ipo_calendar_{from_date}_{to_date}"


def failed_key(from_date: str, to_date: str) -> str:
    return f"ipo_calendar_failed_{from_date}_{to_date}"


def held_ipos(from_date: str, to_date: str) -> tuple[Optional[list], Optional[float], str]:
    """READ ONLY: `(rows, stored_at, how)` for the range, without asking a vendor.

    `how` is `held` (the merged rows the service stored, untouched, with `stored_at` the unix time it stored them: the
    entry's expiry less the service's own lifetime; the cache keeps an absolute expiry, also across a restart),
    `failed` (the service's own record that both vendors failed for this range: no rows, `stored_at` when it recorded
    that) or `not_held` (nothing is held for this range, or the entry is not a list). Never fetches."""
    from api.services import ipo_calendar as svc
    from api.services.cache import cache

    want_rows, want_failed = rows_key(from_date, to_date), failed_key(from_date, to_date)
    found = {key: (value, expires_at) for key, value, expires_at in cache.items_with_expiry()
             if key in (want_rows, want_failed)}
    if want_rows in found:
        value, expires_at = found[want_rows]
        if not isinstance(value, list):
            return None, None, "not_held"
        return value, float(expires_at) - float(svc._CACHE_TTL), "held"
    if want_failed in found and found[want_failed][0]:
        return None, float(found[want_failed][1]) - float(svc._CACHE_TTL_FAILED), "failed"
    return None, None, "not_held"
