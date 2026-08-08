"""Custom-period % change scan — every US common stock ranked by its % change over a
user-selected [start, end] date range. Powers the Custom-Period Sort tool.

Whole-market by construction: TWO grouped-daily calls (the start + end date, each snapped
to the nearest trading day) give split-adjusted closes for the entire market, so
% change = (end_close - start_close) / start_close for every ticker in two calls. Filtered
to US common stock (currently trading), sorted gainers-first. Cached per date range.
"""
import threading
import time as _time
from datetime import date, timedelta

from api.services import massive
from api.services.cache import cache
from api.services.scan_volume import _now_et, _snap_lookup, _etf_symbols
from api.services.scan_ipo import _common_stock_symbols

_TTL = 300           # results cache (s) — the range is fixed; only live price/vol drift
_GROUP_STEPS = 6     # snap a target date back over a holiday/weekend up to this many days


def _to_date(ymd: int) -> date:
    s = str(int(ymd))
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def _grouped_near(target: date):
    """({TICKER: adjusted close}, actual_date) for the first trading day on/before target."""
    dt = target
    for _ in range(_GROUP_STEPS):
        try:
            m = massive.get_grouped_daily_closes(dt.isoformat(), adjusted=True)
        except Exception:
            m = {}
        if m:
            return m, dt
        dt = dt - timedelta(days=1)
    return {}, target


def get_period_change(start_ymd: int, end_ymd: int) -> dict:
    """Every US common stock's % change over [start, end], sorted desc (biggest gainers
    first). Shape: {status, results:[{sym, period_change, net_change, start_close,
    end_close}], count, start, end, as_of}."""
    if start_ymd >= end_ymd:
        return {"status": "error", "results": [], "count": 0, "error": "start must be before end"}
    ck = f"scan_period_{start_ymd}_{end_ymd}"
    cached = cache.get(ck)
    if cached is not None:
        return cached

    start_closes, sd = _grouped_near(_to_date(start_ymd))
    end_closes, ed = _grouped_near(_to_date(end_ymd))
    if not start_closes or not end_closes:
        return {"status": "computing", "results": [], "count": 0, "as_of": None}

    cs = _common_stock_symbols()
    if not cs:
        return {"status": "computing", "results": [], "count": 0, "as_of": None}
    etfs = _etf_symbols()
    try:
        snap = massive._get_client().get_full_market_snapshot()
    except Exception:
        snap = {}

    results = []
    for prov, sc in start_closes.items():
        if not sc or sc <= 0:
            continue
        ec = end_closes.get(prov)
        if not ec or ec <= 0:
            continue
        app = prov.replace(".", "-")
        if app not in cs or app in etfs or app.endswith("ZZT"):
            continue
        # Currently-trading filter: if we have a snapshot, require the ticker to be in it
        # (drops delisted names). No liquidity floor — this tool lists EVERY common stock.
        s = snap.get(prov) or _snap_lookup(snap, app) if snap else None
        if snap and not s:
            continue
        results.append({
            "sym": app,
            "period_change": round((ec - sc) / sc * 100, 2),
            "net_change": round(ec - sc, 2),
            "start_close": round(sc, 4),
            "end_close": round(ec, 4),
            # Live-ish baseline for the results table (SWR-refreshed; not per-row streamed).
            "price": (s.get("last_price") if s else None),
            "volume": (s.get("today_vol") if s else None),
        })

    results.sort(key=lambda r: r["period_change"], reverse=True)
    out = {
        "status": "ok",
        "results": results,
        "count": len(results),
        "start": int(sd.strftime("%Y%m%d")),   # the trading days actually used
        "end": int(ed.strftime("%Y%m%d")),
        "as_of": _now_et().isoformat(),
    }
    cache.set(ck, out, ttl=_TTL if results else 15)
    return out
