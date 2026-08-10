"""Reconstruct historical breadth OHLC (wicks) from stored daily stock bars.

We never recorded the intraday high/low of a breadth metric for past days, but we DO
have every stock's daily high/low in bars.db. For a price-driven metric ("% above the
50-day MA", "new 52-week highs"), the value's intraday range is bounded by evaluating it
at the day's extremes:

    value_at_highs = compute_metrics(levels, {ticker: daily_HIGH})
    value_at_lows  = compute_metrics(levels, {ticker: daily_LOW})
    value_at_close = the stored EOD value
    high = max(the three)   low = min(the three)

One rule covers BOTH directions: "% above MA" peaks when prices are at their highs, "new
52-week lows" peaks when prices are at their lows — max/min of all three captures either.
Reuses breadth_live's own `build_levels` + `compute_metrics` (the exact live method), so a
reconstructed candle is consistent with the live one; only the price frame differs.

Covers only metrics `compute_metrics` produces (the price-derived set — the flagship
% above MA family, highs/lows, movers, stages). Sentiment/exposure/VIX metrics (NOT_LIVE)
have no price basis and stay bodies. Writes to breadth_daily_ohlc with source='reconstruct'
and never clobbers a real 'live' row.
"""
from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Optional

import numpy as np


def _f(v) -> Optional[float]:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _load_hlc_frame(conn, tickers: list[str], target_ts: int) -> dict:
    """{ticker: (high, low, close, volume)} for one session — the piece `_load_frame`
    omits (it selects only c, v)."""
    out: dict = {}
    CHUNK = 800
    for i in range(0, len(tickers), CHUNK):
        chunk = tickers[i:i + CHUNK]
        qm = ",".join("?" * len(chunk))
        rows = conn.execute(
            f"SELECT ticker, h, l, c, v FROM ohlcv "
            f"WHERE tf='D' AND ts=? AND ticker IN ({qm})",
            [target_ts, *chunk],
        ).fetchall()
        for tk, h, l, c, v in rows:
            out[tk] = (h, l, c, v)
    return out


def reconstruct_day(target_ts: int) -> dict:
    """{metric_key: {'h':.., 'l':.., 'c':..}} for one past session, or {} if it can't be
    built. `c` is the reconstruction's close-basis value; the chart uses the authoritative
    EOD close and only widens with h/l, so a small method drift is harmless."""
    from api.services import breadth_live as bl
    conn = bl._bars_conn()
    tickers, _ = bl.universe()
    if not tickers:
        return {}
    # Levels from sessions STRICTLY BEFORE the target day (mirrors _metrics_at_close).
    row = conn.execute(
        "SELECT MAX(ts) FROM ohlcv WHERE tf='D' AND ticker='SPY' AND ts < ?", (target_ts,)
    ).fetchone()
    prior = int(row[0]) if row and row[0] else None
    if not prior:
        return {}
    start = bl._ts_int(date.fromisoformat(bl._iso(prior)) - timedelta(days=bl._LOAD_CALENDAR_DAYS))
    dates = bl._session_dates(conn, prior, start)
    if len(dates) < 221:
        return {}
    closes, volumes = bl._load_frame(conn, tickers, dates)
    try:
        closes = bl._apply_dividend_basis(tickers, dates, closes, target_ts)
    except Exception:
        pass
    levels = bl.build_levels(tickers, closes, volumes, prior)
    del closes, volumes

    hlcv = _load_hlc_frame(conn, tickers, target_ts)
    highs = {t: _f(h) for t, (h, l, c, v) in hlcv.items() if _f(h) and _f(h) > 0}
    lows = {t: _f(l) for t, (h, l, c, v) in hlcv.items() if _f(l) and _f(l) > 0}
    closesd = {t: _f(c) for t, (h, l, c, v) in hlcv.items() if _f(c) and _f(c) > 0}
    vols = {t: _f(v) for t, (h, l, c, v) in hlcv.items() if _f(v) and _f(v) > 0}
    if not closesd:
        return {}

    m_hi = bl.compute_metrics(levels, highs, vols)
    m_lo = bl.compute_metrics(levels, lows, vols)
    m_cl = bl.compute_metrics(levels, closesd, vols)

    out: dict = {}
    for k, vc in m_cl.items():
        if k.startswith("_"):
            continue
        vc = _f(vc)
        if vc is None:
            continue
        vals = [x for x in (vc, _f(m_hi.get(k)), _f(m_lo.get(k))) if x is not None]
        out[k] = {"h": max(vals), "l": min(vals), "c": vc}
    return out


def reconstruct_recent(days: int = 45, overwrite_live: bool = False) -> dict:
    """Backfill the last `days` sessions' OHLC into breadth_daily_ohlc. Returns a summary.
    Open = the prior session's EOD value per metric (so the body reads prior→today, with
    the reconstructed wick), from breadth_monitor's stored history."""
    from api.services import breadth_live as bl
    from api.services import breadth_monitor, breadth_daily_ohlc
    conn = bl._bars_conn()
    # Newest `days`+1 SPY sessions (oldest-first), so each day has a prior for `open`.
    rows = conn.execute(
        "SELECT ts FROM ohlcv WHERE tf='D' AND ticker='SPY' ORDER BY ts DESC LIMIT ?",
        (int(days) + 1,),
    ).fetchall()
    sessions = sorted(int(r[0]) for r in rows)
    if len(sessions) < 2:
        return {"ok": False, "reason": "no sessions"}

    # EOD values per date, for the `open` seed + authoritative close.
    hist = {}
    try:
        for r in breadth_monitor.get_history(int(days) + 40):
            if r.get("date"):
                hist[r["date"]] = r
    except Exception:
        hist = {}

    days_done, rows_written, prev_date = 0, 0, None
    for ts in sessions:
        d = bl._iso(ts)
        recon = {}
        try:
            recon = reconstruct_day(ts)
        except Exception:
            recon = {}
        if not recon:
            prev_date = d
            continue
        prev_row = hist.get(prev_date) or {}
        cur_row = hist.get(d) or {}
        for metric, hlc in recon.items():
            # authoritative close from the EOD snapshot when present, else recon close
            c = _f(cur_row.get(metric))
            c = c if c is not None else hlc["c"]
            o = _f(prev_row.get(metric))
            o = o if o is not None else c
            h = max(hlc["h"], o, c)
            l = min(hlc["l"], o, c)
            if breadth_daily_ohlc.set_ohlc(d, metric, o, h, l, c,
                                           source="reconstruct", overwrite_live=overwrite_live):
                rows_written += 1
        days_done += 1
        prev_date = d
    return {"ok": True, "days": days_done, "rows": rows_written,
            "from": bl._iso(sessions[0]), "to": bl._iso(sessions[-1])}
