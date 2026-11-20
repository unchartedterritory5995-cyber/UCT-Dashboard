"""Fill the CBOE EQUITY Put/Call Ratio into stored breadth rows once CBOE publishes it.

⭐ EQUITY, NOT TOTAL (owner 2026-11-19). `cboe_putcall` is CBOE's equity-only ratio — put
volume over call volume on CBOE stock options. 2003-2019 history (tools/build_breadth_sentiment.py,
CBOE's equitypc archives) was always equity; until 2026-11-19 this fill read TOTAL, so the column
was two different series spliced at 2026. `tools/breadth/refill_equity_putcall.py` re-filled
2019-10-07 onward from the same per-date endpoint as the equity ratio. Never read TOTAL here.

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


#: The one ratio `cboe_putcall` holds. ⛔ Not "TOTAL PUT/CALL RATIO" (index + ETP + equity).
RATIO_NAME = "EQUITY PUT/CALL RATIO"
#: Sanity bounds for the equity ratio — its 2003+ history sits well inside these; a value
#: outside is a bad print, not a reading.
LO, HI = 0.2, 2.5


def ratio_from(body) -> Optional[float]:
    """The equity put/call ratio from one per-date JSON body, or None (absent / absurd)."""
    try:
        ratios = {it.get("name"): it.get("value") for it in (body or {}).get("ratios", [])}
        v = float(ratios.get(RATIO_NAME))
    except Exception:
        return None
    return round(v, 2) if LO <= v <= HI else None


def fetch_for_date(date_str: str, get: Optional[Callable] = None) -> Optional[float]:
    """CBOE's EQUITY PUT/CALL RATIO for exactly `date_str`, or None (unpublished / bad data)."""
    try:
        if get is None:
            import requests
            get = requests.get
        r = get(URL.format(d=date_str), timeout=12, headers=HEADERS)
        if getattr(r, "status_code", 0) != 200:
            return None
        return ratio_from(r.json())
    except Exception:
        return None


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


def keep_stored(date_str: str, metrics: dict, existing: Optional[dict] = None) -> dict:
    """⛔ `cboe_putcall` IS SERVER-OWNED. The PC collector (uct-intelligence
    `breadth_collector.py`) still reads CBOE's TOTAL ratio; its push must not write the
    column, or one TOTAL print lands in the EQUITY series (and a re-push with null would
    erase a filled reading). Returns the metrics to store: the pushed `cboe_putcall`
    dropped, the stored equity value (if any) kept. Identity when the push has no key."""
    if "cboe_putcall" not in (metrics or {}):
        return metrics
    out = dict(metrics)
    out.pop("cboe_putcall", None)
    if existing is None:
        from api.services import breadth_monitor as bm
        existing = bm.raw_row(date_str) or {}
    if existing.get("cboe_putcall") is not None:
        out["cboe_putcall"] = existing["cboe_putcall"]
    return out
