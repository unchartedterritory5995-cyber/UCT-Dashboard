"""Fill the CBOE Total Put/Call Ratio into stored breadth rows once CBOE publishes it.

⛔ WHY THIS EXISTS. The 4:15 PM collector correctly stopped stamping the PRIOR session's
ratio onto today's row (2026-08-07: 12 of 13 stored readings were a day late), and now
writes null when CBOE has not published yet — which is every day, since CBOE publishes in
the evening. Its docstring says "the next run, or `--backfill-cboe`, fills it"; nothing ever
ran that, so `cboe_putcall` (UCTPC) stopped on 2026-08-10.

⭐ This is that fill, on a clock, on the web pod: for each recent stored session whose
`cboe_putcall` is null, read CBOE's PER-DATE endpoint (the value belongs to exactly that
session — never a walk-back) and patch it in with `breadth_monitor.patch_fields`, the same
write the collector's `--patch-cboe-date` uses over HTTP. A session CBOE has not published
yet is left null and retried on the next run.
"""
from __future__ import annotations

import logging
from typing import Callable, Optional

_log = logging.getLogger("breadth_putcall_backfill")

URL = "https://cdn.cboe.com/data/us/options/market_statistics/daily/{d}_daily_options"
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"),
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.cboe.com/us/options/market_statistics/daily/",
}


def fetch_for_date(date_str: str, get: Optional[Callable] = None) -> Optional[float]:
    """CBOE's TOTAL PUT/CALL RATIO for exactly `date_str`, or None (unpublished / bad data)."""
    try:
        if get is None:
            import requests
            get = requests.get
        r = get(URL.format(d=date_str), timeout=12, headers=HEADERS)
        if getattr(r, "status_code", 0) != 200:
            return None
        ratios = {it.get("name"): it.get("value") for it in (r.json() or {}).get("ratios", [])}
        v = float(ratios.get("TOTAL PUT/CALL RATIO"))
    except Exception:
        return None
    return round(v, 2) if 0.3 <= v <= 3.0 else None


def fill(sessions: int = 90, fetch: Callable = fetch_for_date) -> dict:
    """Patch every recent stored session missing `cboe_putcall`. Returns counts."""
    from api.services import breadth_monitor as bm
    rows = bm.get_history(sessions) or []
    missing = [r["date"] for r in rows if r.get("date") and r.get("cboe_putcall") is None]
    filled, unpublished, failed = [], [], []
    for d in sorted(missing):
        v = fetch(d)
        if v is None:
            unpublished.append(d)
            continue
        (filled if bm.patch_fields(d, {"cboe_putcall": v}) else failed).append(d)
    out = {"missing": len(missing), "filled": len(filled), "unpublished": unpublished,
           "failed": failed, "first_filled": filled[0] if filled else None,
           "last_filled": filled[-1] if filled else None}
    _log.info("[putcall-backfill] %s", out)
    return out
