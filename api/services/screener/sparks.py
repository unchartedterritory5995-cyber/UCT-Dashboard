"""Short daily-close series for the Focus list's per-row price line.

One request answers up to ``MAX_TICKERS`` symbols from the local bars store (no
provider call), so a page of 60 rows costs one round trip, not 60. The series is
the newest ``SESSIONS`` daily bars as stored, oldest first, with the date of the
newest one, so a row can say what its line runs through.

Cached per ticker for ``TTL_S``: daily bars change once a night (and the forming
bar a little during the session), and the list re-asks for the same names as a
member pages and re-sorts.
"""
from __future__ import annotations

import math
import time

#: ~3 months of sessions.
SESSIONS = 63
#: The largest batch one request may ask for (one page of the Focus list).
MAX_TICKERS = 60
TTL_S = 600
#: The cache is cleared rather than grown past this many symbols.
CACHE_MAX = 6000

_CACHE: dict = {}


def _series(ticker: str) -> dict:
    from api.services import bars_sqlite
    rows = bars_sqlite.get_bars(ticker, "D", SESSIONS) or []
    closes, asof = [], None
    for r in rows:
        try:
            c = float(r[4])
        except (TypeError, ValueError, IndexError):
            continue
        if math.isfinite(c) and c > 0:
            closes.append(round(c, 4))
            asof = r[0]
    return {"c": closes, "asof": asof}


def closes_for(tickers) -> dict:
    """``{TICKER: {"c": [closes oldest-first], "asof": YYYYMMDD | None}}``.

    A symbol with no stored bars answers an empty series, never an error; one
    unreadable symbol never fails the batch.
    """
    now = time.time()
    if len(_CACHE) > CACHE_MAX:
        _CACHE.clear()
    out = {}
    for t in tickers:
        hit = _CACHE.get(t)
        if hit and now - hit[0] < TTL_S:
            out[t] = hit[1]
            continue
        try:
            val = _series(t)
        except Exception:                                   # noqa: BLE001
            val = {"c": [], "asof": None}
        _CACHE[t] = (now, val)
        out[t] = val
    return out


def parse_tickers(raw: str) -> list:
    """Comma list -> upper-case, de-duplicated, order kept, capped at MAX_TICKERS."""
    seen, out = set(), []
    for part in (raw or "").split(","):
        t = part.strip().upper()
        if t and t not in seen and len(t) <= 12:
            seen.add(t)
            out.append(t)
        if len(out) >= MAX_TICKERS:
            break
    return out
