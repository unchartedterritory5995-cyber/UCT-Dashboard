"""Revenue by segment for the Terminal's SEG screen: one stock's revenue split by product (or business line)
and by region, period by period, with each segment's share worked out here.

    get_segments(sym, period) -> the body of GET /api/research/revenue-segments/{ticker}?period=
      status   'ok' | 'computing' | 'failed'
      failed:  reason 'source' (neither of the two reads answered: a 5xx, a timeout, a dropped
               connection, the local FMP budget spent)
      ok:      sym, period ('annual' | 'quarter'), read_at (UTC instant of the read), source, check,
               product, region: each
                 {state: 'ok' | 'none' | 'not_in_plan' | 'not_configured' | 'rate_limited' | 'failed',
                  http_status, periods [newest first, at most PERIOD_CAP:
                    {date, fiscal_year, label, currency, total, segments [largest first, at most
                     SEGMENT_CAP: {name, revenue, share}], cut (more segments than the cap)}],
                  dropped (rows without a date, or without one segment figure, skipped and counted),
                  cut (more periods than the cap; the OLDEST are left out)}

THE SOURCE is Financial Modeling Prep, through the one adapter (`fmp_client`): its two typed functions
`get_revenue_product_segmentation` and `get_revenue_geographic_segmentation`
(`/stable/revenue-product-segmentation`, `/stable/revenue-geographic-segmentation`, the two paths
`fmp_response_cache` already names with a one-day lifetime). Licence: the adapter stamps
`data_class="segments"`, which has no licensing-register row and so reads "U" (unknown, never inferred),
exactly as FMP's IPO calendar does; nothing gates display on that stamp. A plan that does not include an
endpoint (401, 402, 403, 404, or the adapter's 24-hour refused window) is the leg's own state
`not_in_plan`, an answer about the source, never an error and never an empty table.

THE SHAPE READ. FMP's stable answer is a list of `{symbol, fiscalYear, period, reportedCurrency, date,
data: {segment: revenue}}`; the older v4 answer was a list of `{date: {segment: revenue}}`. Both are read;
every other field is dropped. A row without a date is skipped and counted; a segment whose figure is not a
number is left out. The SHARE is the segment's revenue over the sum of the period's positive segment
figures, in percent: segments as a company reports them may not add up to its total revenue, so the
share is of the segments listed, and `total` is that sum (never the income statement's revenue).

IT NEVER ASKS THE VENDOR ON A MEMBER'S REQUEST. One answer per (stock, period) is held in this module
(`held_reads.KeyedHeld`, the house hold-and-build way, at most `MAX_KEYS` held): one background build
makes the two reads; a request with nothing held waits a few seconds on it and is otherwise told
`computing`. A refresh is due after `TTL_S` (one day, the response cache's own lifetime for both paths;
segments change once a quarter), or after `RETRY_S` when a leg failed or was rate-limited. So one stock
costs at most two vendor reads per period per day, whatever the number of members.
"""
from __future__ import annotations

import math
import re
import time
from typing import Any, Optional

from api.services import held_build
from api.services.held_reads import KeyedHeld, fmp_leg

SOURCE = "Financial Modeling Prep"
PERIODS = ("annual", "quarter")
PERIOD_CAP = 12
SEGMENT_CAP = 25
TTL_S = 24 * 3600
RETRY_S = 300
MAX_KEYS = 64
_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_FAILED = ("failed", "rate_limited")


def _figure(v: Any) -> Optional[float]:
    if isinstance(v, bool) or v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _day(v: Any) -> Optional[str]:
    s = str(v or "")[:10]
    return s if _ISO_DAY.match(s) else None


def _text(v: Any) -> Optional[str]:
    s = str(v).strip() if v is not None else ""
    return s or None


def _label(fiscal_year, period, date) -> str:
    fy = str(fiscal_year).strip() if fiscal_year not in (None, "") else ""
    p = str(period).strip().upper() if period not in (None, "") else ""
    if fy and p and p != "FY":
        return f"{p} FY{fy}"
    if fy:
        return f"FY{fy}"
    return date


def _rows(raw: Any) -> list[tuple[Optional[str], dict, Any, Any, Optional[str]]]:
    """(date, data, fiscal_year, period, currency) for each row, in either known shape."""
    out = []
    for r in raw if isinstance(raw, list) else []:
        if not isinstance(r, dict):
            out.append((None, {}, None, None, None))
            continue
        if isinstance(r.get("data"), dict) or "date" in r:
            out.append((_day(r.get("date")), r.get("data") if isinstance(r.get("data"), dict) else {},
                        r.get("fiscalYear"), r.get("period"), _text(r.get("reportedCurrency"))))
            continue
        # the older answer: one key, the period's date, whose value is the segments
        keys = [k for k in r if isinstance(r.get(k), dict)]
        if len(keys) == 1:
            out.append((_day(keys[0]), r[keys[0]], None, None, None))
        else:
            out.append((None, {}, None, None, None))
    return out


def shape_periods(raw: Any) -> dict:
    """The vendor's rows -> `{periods, dropped, cut}`, newest period first."""
    periods, dropped, seen = [], 0, set()
    for date, data, fiscal_year, period, currency in _rows(raw):
        segs = []
        for name, value in (data or {}).items():
            n, f = _text(name), _figure(value)
            if n is None or f is None:
                continue
            segs.append({"name": n, "revenue": f})
        if not date or not segs:
            dropped += 1
            continue
        key = (date, str(period or ""))
        if key in seen:
            continue
        seen.add(key)
        total = sum(s["revenue"] for s in segs if s["revenue"] > 0)
        for s in segs:
            s["share"] = round(s["revenue"] / total * 100.0, 2) if total > 0 and s["revenue"] > 0 else None
        segs.sort(key=lambda s: (-s["revenue"], s["name"]))
        periods.append({
            "date": date, "fiscal_year": _text(fiscal_year), "label": _label(fiscal_year, period, date),
            "currency": currency.upper() if currency else None, "total": total if total > 0 else None,
            "segments": segs[:SEGMENT_CAP], "cut": len(segs) > SEGMENT_CAP,
        })
    periods.sort(key=lambda p: p["date"], reverse=True)
    return {"periods": periods[:PERIOD_CAP], "dropped": dropped, "cut": len(periods) > PERIOD_CAP}


def _leg(fn, sym: str, period: str) -> dict:
    state, value, status = fmp_leg(fn, sym, period=period)
    shaped = shape_periods(value) if state == "ok" else {"periods": [], "dropped": 0, "cut": False}
    if state == "ok" and not shaped["periods"]:
        state = "none"            # it answered, and not one row could be read as a period
    return {"state": state, "http_status": status, **shaped}


def _build_for(key):
    sym, period = key

    def build(_previous: Optional[dict] = None) -> tuple[dict, str]:
        from api.services import fmp_client as fc
        product = _leg(fc.get_revenue_product_segmentation, sym, period)
        region = _leg(fc.get_revenue_geographic_segmentation, sym, period)
        if product["state"] in _FAILED and region["state"] in _FAILED:
            raise held_build.Stop("failed", "source", hold=RETRY_S,
                                  note=f"fmp segments {sym} {period} failed ({product['state']}, {region['state']})")
        answer = {"status": "ok", "sym": sym, "period": period, "read_at": held_build.now_iso(), "source": SOURCE,
                  "product": product, "region": region}
        note = (f"fmp segments {sym} {period} product={product['state']}:{len(product['periods'])} "
                f"region={region['state']}:{len(region['periods'])}")
        return answer, note

    return build


def refresh_due(answer: dict, checked: float, now: Optional[float] = None) -> bool:
    """Pure: due after a day, or after five minutes when a leg failed or was rate-limited."""
    legs = [(answer or {}).get(k) or {} for k in ("product", "region")]
    ttl = RETRY_S if any(leg.get("state") in _FAILED for leg in legs) else TTL_S
    return ((time.time() if now is None else now) - float(checked or 0)) >= ttl


def _valid(held: dict) -> bool:
    return held.get("status") == "ok" and isinstance(held.get("product"), dict) and isinstance(held.get("region"), dict)


_held = KeyedHeld("revenue-segments", _build_for, refresh_due, max_keys=MAX_KEYS, valid=_valid)


def get_segments(sym: str, period: str = "annual", *, wait_s: Optional[float] = None) -> dict:
    """The route's body. Never builds on the caller's thread. `sym` is an already-checked ticker."""
    p = period if period in PERIODS else "annual"
    got = _held.get((sym, p), wait_s=wait_s)
    if got.get("status") != "ok":
        return {**got, "sym": sym, "period": p, "source": SOURCE}
    return got


def reset_for_tests() -> None:
    _held.reset()
