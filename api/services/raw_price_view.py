"""api/services/raw_price_view.py — TERM-055 (FB-D5-01), the M half: a RAW (as-traded)
price view beside the split-adjusted one.

The chart is drawn on the split-adjusted basis (Massive `adjusted=true`, healed by
`bars_sanitize` on D/W/M). A member reading "Split-adjusted · last split 2024-06-10"
can ask what the stock actually TRADED at around that date. This answers with the
vendor's own two answers for the same daily window, paired by session:
`adjusted=false` (as traded) and `adjusted=true` (split-adjusted), plus the factor
between them. Same vendor, same endpoint, only the adjustment flag differs — so the
pair is a like-for-like comparison and never a cross-source one.

Gate: ``RAW_PRICE_VIEW_ENABLED`` — an ENABLEMENT gate, default OFF, read per call.
Off: the route answers 404, the adjustment-basis payload carries no `raw_view` key,
and nothing here is called. It ships dark.

⛔ THIS IS A VENDOR CALL ON A REQUEST PATH, so it is bounded three ways: a fixed
window (``WINDOW_DAYS`` calendar days either side of the asked date), daily bars only,
and a cache keyed on (ticker, window) so a member toggling the view does not re-fetch.
It never touches the chart's bars route, the store, or the served series.
"""
from __future__ import annotations

import datetime as _dt
import os
from concurrent.futures import ThreadPoolExecutor

from api.services.cache import cache

FLAG = "RAW_PRICE_VIEW_ENABLED"
WINDOW_DAYS = 14                # calendar days either side of `around` (~10 sessions)
_TTL = 6 * 3600
_KEY = "raw_price_view:{}:{}:{}"


def enabled() -> bool:
    """Read per call, never captured at import — a flip needs no rebuild."""
    return os.environ.get(FLAG, "0").strip().lower() in ("1", "true", "yes", "on")


def _session(t_ms) -> str | None:
    """Massive daily `t` (unix ms at the session's start) → its ET session date."""
    from zoneinfo import ZoneInfo
    try:
        return _dt.datetime.fromtimestamp(int(t_ms) / 1000,
                                          tz=ZoneInfo("America/New_York")).date().isoformat()
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def pair_rows(raw: list[dict], adjusted: list[dict]) -> list[dict]:
    """Pure: pair the vendor's raw and adjusted daily bars by session.

    `factor` = raw close / adjusted close, rounded to 4 places: 1.0 on a session after
    the newest split, the split ratio before it. A session either side is missing
    from is dropped — a half row is not a comparison."""
    adj = {}
    for b in adjusted or []:
        d = _session(b.get("t"))
        if d:
            adj[d] = b
    out = []
    for b in raw or []:
        d = _session(b.get("t"))
        a = adj.get(d) if d else None
        if a is None:
            continue
        rc, ac = b.get("c"), a.get("c")
        factor = round(rc / ac, 4) if rc and ac else None
        out.append({"t": d,
                    "raw": {k: b.get(k) for k in ("o", "h", "l", "c", "v")},
                    "adjusted": {k: a.get(k) for k in ("o", "h", "l", "c", "v")},
                    "factor": factor})
    return out


def raw_view(ticker: str, around: str | None) -> dict:
    """The paired window for one ticker. `around` = an ISO date (the split the label
    names); absent or unreadable ⇒ the window ends today. Never raises: a vendor
    failure is an empty `rows`, reported as `available: False`, never a fabricated row."""
    today = _dt.date.today()
    try:
        center = _dt.date.fromisoformat(str(around)[:10]) if around else today
    except ValueError:
        center = today
    end = min(center + _dt.timedelta(days=WINDOW_DAYS), today)
    start = center - _dt.timedelta(days=WINDOW_DAYS if around else 2 * WINDOW_DAYS)
    key = _KEY.format(ticker, start.isoformat(), end.isoformat())
    hit = cache.get(key)
    if hit is not None:
        return hit

    from api.services import massive
    f, t = start.isoformat(), end.isoformat()
    try:
        with ThreadPoolExecutor(max_workers=2) as ex:
            raw_f = ex.submit(massive.get_daily_agg, ticker, f, t, adjusted=False)
            adj_f = ex.submit(massive.get_daily_agg, ticker, f, t, adjusted=True)
            rows = pair_rows(raw_f.result(), adj_f.result())
    except Exception:
        rows = []
    out = {"ticker": ticker, "tf": "D", "from": f, "to": t, "source": "massive",
           "available": bool(rows), "rows": rows}
    if rows:
        cache.set(key, out, ttl=_TTL)   # an empty answer is never cached
    return out
