"""Anchor closes for an article's tickers — the last daily close on/before the
issue's publish moment.

The reader shows each covered name's move SINCE the issue ran ("did the call
already work, or is it still at the level"). Only the anchor half of that
number lives here — the live half is the price feed the page already polls, so
serving both would put a second authority on the current price.

Reads the LOCAL bars store only (bars_sqlite — one indexed seek per ticker),
never a provider. A ticker the store doesn't hold is OMITTED, not guessed.
Anchors are immutable — the close preceding a fixed timestamp never changes —
so results memoize permanently, bounded by the archive size.
"""
from __future__ import annotations

import json
from datetime import datetime
from functools import lru_cache
from zoneinfo import ZoneInfo

from api.services import bars_sqlite

_ET = ZoneInfo("America/New_York")
# An issue covers ~44 names; anything wildly beyond that is a malformed row.
_MAX_TICKERS = 80


def _date_key(published_at: int) -> int:
    """The publish moment as an ET YYYYMMDD key — daily bar rows key on that.

    ET, not UTC: a Sunday-evening letter published 23:30 UTC is still Sunday in
    the market's own calendar, and the anchor must be Friday's close either way.
    """
    d = datetime.fromtimestamp(int(published_at), tz=_ET)
    return d.year * 10000 + d.month * 100 + d.day


@lru_cache(maxsize=256)
def _anchors_cached(published_at: int, tickers_json: str) -> tuple:
    try:
        tickers = [t for t in json.loads(tickers_json) if isinstance(t, str)]
    except (TypeError, ValueError):
        return ()
    key = _date_key(published_at)
    out = []
    for sym in tickers[:_MAX_TICKERS]:
        try:
            rows = bars_sqlite.get_bars_before(sym.upper(), "D", 1, key)
        except Exception:  # noqa: BLE001 — a bars hiccup must not 500 the reader
            continue
        if rows:
            close = rows[-1][4]
            if isinstance(close, (int, float)) and close > 0:
                out.append((sym.upper(), float(close)))
    return tuple(out)


def anchors_for(post: dict) -> dict:
    """{SYM: close_on_or_before_publish} for every ticker the store holds."""
    published_at = post.get("published_at")
    tickers_json = post.get("tickers_json") or ""
    if not published_at or not tickers_json:
        return {}
    return dict(_anchors_cached(int(published_at), tickers_json))
