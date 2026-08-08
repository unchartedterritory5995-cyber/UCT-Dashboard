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
_GROUP_STEPS = 9     # snap a target date back over a holiday/weekend up to this many days (covers year-end gaps)


def _to_date(ymd: int) -> date:
    s = str(int(ymd))
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def _grouped_near(target: date):
    """({TICKER: adjusted close}, actual_date, partial) for the first trading day on/before
    target. Tries the whole-market grouped-daily endpoint first; if it's empty across the
    snap-back window (a PRE-~2003 date the provider doesn't cover), falls back to bars.db's
    deep per-ticker history (yfinance-sourced). partial=True marks the bars.db fallback —
    it's SURVIVORSHIP-BIASED (only names still in the warmed universe, no delisted tail)."""
    dt = target
    for _ in range(_GROUP_STEPS):
        try:
            m = massive.get_grouped_daily_closes(dt.isoformat(), adjusted=True)
        except Exception:
            m = {}
        if m:
            return m, dt, False
        dt = dt - timedelta(days=1)
    # Provider floor — reach into bars.db's deep daily history (one windowed scan snaps over
    # holidays). App/hyphen-form keys; partial coverage.
    from api.services import bars_sqlite
    try:
        frm = target - timedelta(days=_GROUP_STEPS + 4)
        m = bars_sqlite.closes_near_date(int(target.strftime("%Y%m%d")), int(frm.strftime("%Y%m%d")))
    except Exception:
        m = {}
    if m:
        return m, target, True
    return {}, target, False


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

    start_closes, sd, sp = _grouped_near(_to_date(start_ymd))
    end_closes, ed, ep = _grouped_near(_to_date(end_ymd))
    partial = sp or ep   # bars.db fallback was used (pre-coverage) → surviving universe only
    if not start_closes or not end_closes:
        # Distinguish a genuine coverage gap from a transient warm-up: whole-market
        # grouped-daily data begins ~2003 (provider limit), so a date well in the past that
        # returns nothing after snapping back over holidays is a hard boundary, not
        # "still computing" — say so clearly + cache it so we don't re-hit the empty
        # endpoint every 30s poll. A RECENT empty (today still warming) stays "computing".
        bad = _to_date(start_ymd) if not start_closes else _to_date(end_ymd)
        if (_now_et().date() - bad).days > 30:
            out = {"status": "unavailable", "results": [], "count": 0,
                   "error": "Market-wide data isn't available this far back — it begins around 2003.",
                   "as_of": None}
            cache.set(ck, out, ttl=3600)
            return out
        return {"status": "computing", "results": [], "count": 0, "as_of": None}

    # Normalize both sides to app/hyphen form so grouped (BRK.B) and bars.db (BRK-B) keys
    # join. The main loop then works purely in app-form.
    start_closes = {k.replace(".", "-"): v for k, v in start_closes.items()}
    end_closes = {k.replace(".", "-"): v for k, v in end_closes.items()}

    cs = _common_stock_symbols()
    if not cs:
        return {"status": "computing", "results": [], "count": 0, "as_of": None}
    etfs = _etf_symbols()
    try:
        snap = massive._get_client().get_full_market_snapshot()
    except Exception:
        snap = {}
    # On the bars.db (pre-coverage) path, drop RECYCLED tickers whose CURRENT listing began
    # after the start date — their start close belongs to a different, prior company (SQ,
    # WTW, RMIX…), which would otherwise show a wildly wrong % change.
    reuse = {}
    if partial:
        try:
            from api.services import bars_sqlite
            reuse = bars_sqlite.current_listing_starts(int(start_ymd))
        except Exception:
            reuse = {}

    results = []
    for app, sc in start_closes.items():
        if not sc or sc <= 0:
            continue
        ec = end_closes.get(app)
        if not ec or ec <= 0:
            continue
        if app not in cs or app in etfs or app.endswith("ZZT"):
            continue
        if partial and reuse.get(app, 0) > int(start_ymd):
            continue   # recycled symbol — start close is a different company
        # Currently-trading filter (whole-market path): require the ticker in the live
        # snapshot to drop delisted names. On the partial path we KEEP names bars.db has
        # even if the live snapshot doesn't (price/volume just show blank).
        s = snap.get(app) or _snap_lookup(snap, app) if snap else None
        if snap and not s and not partial:
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
        # True = a pre-coverage date sourced from bars.db (surviving-universe only, so the
        # delisted tail is missing) — the UI flags it rather than claiming "every stock".
        "partial": partial,
    }
    cache.set(ck, out, ttl=_TTL if results else 15)
    return out


def _sector_industry_map():
    """{app_sym: {'sector', 'industry'}} read from the prewarmed ticker_meta disk cache
    (the only whole-universe sector/industry source — no bulk API exists). Globbing ~4k
    small JSON files is ~1s, so cache it for 6h."""
    ck = "period_sector_industry_map"
    cached = cache.get(ck)
    if cached is not None:
        return cached
    import glob
    import json
    import os
    from api.services.ticker_meta import _CACHE_DIR
    out = {}
    try:
        for path in glob.glob(os.path.join(_CACHE_DIR, "*.json")):
            sym = os.path.splitext(os.path.basename(path))[0]
            try:
                with open(path) as fh:
                    d = json.load(fh)
            except Exception:
                continue
            out[sym] = {"sector": d.get("sector"), "industry": d.get("industry")}
    except Exception:
        pass
    cache.set(ck, out, ttl=21600)
    return out


def get_period_change_groups(start_ymd: int, end_ymd: int, group: str) -> dict:
    """Rank THEMES / SECTORS / INDUSTRIES by their equal-weight mean % change over
    [start, end], reusing the whole-market per-stock period_change. Each group carries its
    member symbols so the UI can drill into it. `group` ∈ {'theme','sector','industry'}."""
    if group not in ("theme", "sector", "industry"):
        return {"status": "error", "group": group, "results": [], "count": 0, "error": "bad group"}
    base = get_period_change(start_ymd, end_ymd)
    if base.get("status") != "ok":
        return {"status": base.get("status", "computing"), "group": group, "results": [], "count": 0, "error": base.get("error")}
    chg = {r["sym"]: r["period_change"] for r in base["results"]}

    buckets = {}  # name -> {"_sum", "count", "members"}
    if group == "theme":
        from api.services import theme_db
        try:
            themes = theme_db.get_all_themes().get("themes", [])
        except Exception:
            themes = []
        for th in themes:
            name = th.get("name")
            if not name:
                continue
            members, vals = [], []
            for h in th.get("holdings", []):
                if h.get("source") == "engine":   # owner-only aggregate (matches every UCT group metric)
                    continue
                s = str(h.get("sym", "")).replace(".", "-")   # taxonomy is dot-form; scan is hyphen-form
                if s in chg:
                    members.append(s)
                    vals.append(chg[s])
            if vals:
                buckets[name] = {"_sum": sum(vals), "count": len(vals), "members": members}
    else:
        smap = _sector_industry_map()
        field = group  # 'sector' | 'industry'
        for sym, c in chg.items():
            g = (smap.get(sym) or {}).get(field)
            if not g:
                continue
            b = buckets.setdefault(g, {"_sum": 0.0, "count": 0, "members": []})
            b["_sum"] += c
            b["count"] += 1
            b["members"].append(sym)

    results = []
    for name, b in buckets.items():
        results.append({
            "name": name,
            "period_change": round(b["_sum"] / b["count"], 2) if b["count"] else 0.0,
            "count": b["count"],
            "members": b["members"],
        })
    results.sort(key=lambda r: r["period_change"], reverse=True)
    return {
        "status": "ok",
        "group": group,
        "results": results,
        "count": len(results),
        "start": base.get("start"),
        "end": base.get("end"),
        "as_of": base.get("as_of"),
    }
