"""Let the member's own browser keep a reference answer for a while.

WHY. A ticker change asks for the same reference facts every time: is it delisted, its IPO day,
its single-stock ETFs, its name and sector, its earnings markers. Measured 2026-11-13 (Cloudflare,
real members): these per-ticker reads were about a quarter of all requests reaching `web` and about
40% of its time, and each symbol was asked for about five times. No `/api/*` answer carried a
`Cache-Control`, so every pop-out window, every reload and every return to a symbol went back to
the server for a fact that had not changed.

WHAT. `allow(response, seconds)` sets `Cache-Control: private, max-age=N`. `private` means only the
member's own browser may keep it: Cloudflare and any shared cache must not, so a paid answer never
reaches another person. The browser then answers a repeat `fetch` itself until the time is up.

RULES for a handler that calls it:
  * only for a fact that is the same for every entitled member and is not edited by the member;
  * only for a COMPLETE answer. An empty, "not resolved yet" or failed answer is never marked, so
    the next ask goes to the server and can get the real one;
  * the time is no longer than the page already goes without asking again inside one window.

Kill switch: `REFERENCE_CACHE_ENABLED=0` (unset or anything else = on). Off, no header is set and
every answer is byte-for-byte what it was.
"""
from __future__ import annotations

import os

SWITCH = "REFERENCE_CACHE_ENABLED"
_OFF = frozenset({"0", "false", "no", "off"})

#: Seconds, per fact. Each is at or under the time the page already waits before re-asking.
DELISTED_S = 3600          # the registry changes only with a release; the page holds it for 1 h
TICKER_IPO_FINAL_S = 86400  # a FINAL first-trade day does not change
SINGLE_STOCK_ETFS_S = 300  # the server holds a family for 600 s; the page for 5 min
TICKER_META_S = 300        # name, sector, industry, primary theme
CHART_MARKERS_S = 600      # earnings, splits and dividends history; the server holds it for 12 h


def enabled() -> bool:
    return (os.environ.get(SWITCH) or "1").strip().lower() not in _OFF


def allow(response, seconds: int) -> None:
    """Mark `response` as keepable by the member's own browser for `seconds`. Never raises."""
    try:
        if response is not None and seconds > 0 and enabled():
            response.headers["Cache-Control"] = "private, max-age=%d" % int(seconds)
    except Exception:
        pass
