"""Historical breadth reconstruction — recompute past breadth values from stored bars.

The breadth collector only began storing daily snapshots on 2026-01-02, but our daily
stock bars go back decades. The breadth value at any past day's CLOSE is a deterministic
recomputation from those bars via the EXACT live method (`breadth_live._metrics_at_close`
= build levels from prior sessions, fold in the day's close, `compute_metrics`). This
module wraps that so we can (Phase 0) VALIDATE it against days we actually collected, then
(Phase 1+) backfill years of accurate close-basis history.

Phase 0 only: recompute + validation. No writes to any chart store yet.
"""
from __future__ import annotations

import math
from collections import defaultdict
from typing import Optional


def _f(v) -> Optional[float]:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def recompute_close(target_ts: int, tickers: Optional[list[str]] = None) -> dict:
    """All price-derived breadth metrics at a past session's CLOSE (the live method applied
    to a completed day). Returns {} if the day can't be built (not enough prior sessions /
    no bars). `tickers` defaults to the current universe."""
    from api.services import breadth_live as bl
    conn = bl._bars_conn()
    if tickers is None:
        tickers, _ = bl.universe()
    if not tickers:
        return {}
    try:
        out = bl._metrics_at_close(conn, tickers, int(target_ts))
    except Exception:
        return {}
    return out or {}


def recompute_close_with_members(target_ts: int, tickers: Optional[list[str]] = None):
    """Like recompute_close but also returns the per-metric member ticker lists + the set
    of names that had a price today — so we can diff against the collector's stored drill
    lists and classify WHY a name differs. Returns (metrics, members, priced_set, universe_set)."""
    from datetime import date as _date, timedelta as _td
    from api.services import breadth_live as bl
    import numpy as _np
    conn = bl._bars_conn()
    if tickers is None:
        tickers, _ = bl.universe()
    if not tickers:
        raise ValueError("no universe (bl.universe returned empty)")
    row = conn.execute(
        "SELECT MAX(ts) FROM ohlcv WHERE tf='D' AND ticker='SPY' AND ts < ?", (int(target_ts),)
    ).fetchone()
    prior = int(row[0]) if row and row[0] else None
    if not prior:
        raise ValueError(f"no prior SPY session before ts={target_ts}")
    start = bl._ts_int(_date.fromisoformat(bl._iso(prior)) - _td(days=bl._LOAD_CALENDAR_DAYS))
    dates = bl._session_dates(conn, prior, start)
    if len(dates) < 221:
        raise ValueError(f"only {len(dates)} sessions (need 221) prior={prior} start={start}")
    closes, volumes = bl._load_frame(conn, tickers, dates)
    try:
        closes = bl._apply_dividend_basis(tickers, dates, closes, int(target_ts))
    except Exception:
        pass
    levels = bl.build_levels(tickers, closes, volumes, prior)
    index_levels = bl.build_index_levels(bl._load_index_series(conn, prior, start))
    del closes, volumes
    day_c, day_v = bl._load_frame(conn, tickers, [int(target_ts)])
    prices = {t: float(day_c[i, 0]) for i, t in enumerate(tickers)
              if not _np.isnan(day_c[i, 0]) and day_c[i, 0] > 0}
    vols = {t: float(day_v[i, 0]) for i, t in enumerate(tickers)
            if not _np.isnan(day_v[i, 0]) and day_v[i, 0] > 0}
    if not prices:
        raise ValueError(f"no prices for day ts={target_ts} (universe={len(tickers)})")
    members: dict = {}
    out = bl.compute_metrics(levels, prices, vols, members=members)
    out.update(bl.compute_index_metrics(index_levels, {}))
    return out, members, set(prices.keys()), set(tickers)


def _tickers_of(lst) -> set:
    out = set()
    for it in (lst or []):
        if isinstance(it, str):
            out.add(it.upper())
        elif isinstance(it, dict):
            t = it.get("t") or it.get("ticker") or it.get("sym")
            if t:
                out.add(str(t).upper())
    return out


def diff_members(date: str, metric: str) -> dict:
    """For one day + one drillable metric, diff the recomputed member set against the
    collector's stored drill list, and CLASSIFY why each mismatch happens: name absent from
    our universe, no price in our bars that day, or a genuine threshold flip. This tells us
    whether the count drift is a fixable data gap or inherent threshold sensitivity."""
    from api.services import breadth_live as bl
    from api.services import breadth_monitor
    conn = bl._bars_conn()
    # resolve the SPY session ts for `date`
    ts = None
    for r in conn.execute("SELECT ts FROM ohlcv WHERE tf='D' AND ticker='SPY' ORDER BY ts DESC LIMIT 400").fetchall():
        if bl._iso(int(r[0])) == date:
            ts = int(r[0]); break
    if ts is None:
        return {"ok": False, "reason": f"no SPY session for {date}"}

    try:
        metrics, members, priced, uni = recompute_close_with_members(ts)
    except Exception as e:
        import traceback
        return {"ok": False, "reason": f"recompute raised: {type(e).__name__}: {e}",
                "trace": traceback.format_exc()[-800:], "ts": ts}
    if not members:
        return {"ok": False, "reason": "recompute produced no members",
                "ts": ts, "universe": len(uni), "priced": len(priced),
                "metric_keys": sorted(list(metrics.keys()))[:6]}
    recompute_set = _tickers_of(members.get(metric))

    stored_row = None
    for r in breadth_monitor.get_history(400):
        if r.get("date") == date:
            stored_row = r; break
    collector_set = _tickers_of((stored_row or {}).get(f"{metric}_list"))

    only_recompute = recompute_set - collector_set
    only_collector = collector_set - recompute_set

    # classify the collector-only names (present for the collector, missing for us)
    cls = {"not_in_universe": 0, "no_price_today": 0, "threshold_or_history": 0}
    sample_not_in_uni, sample_no_price = [], []
    for t in only_collector:
        if t not in uni:
            cls["not_in_universe"] += 1
            if len(sample_not_in_uni) < 15:
                sample_not_in_uni.append(t)
        elif t not in priced:
            cls["no_price_today"] += 1
            if len(sample_no_price) < 15:
                sample_no_price.append(t)
        else:
            cls["threshold_or_history"] += 1

    return {
        "ok": True, "date": date, "metric": metric,
        "recompute_count": len(recompute_set), "collector_count": len(collector_set),
        "overlap": len(recompute_set & collector_set),
        "only_recompute": len(only_recompute), "only_collector": len(only_collector),
        "collector_only_classified": cls,
        "sample_not_in_universe": sorted(sample_not_in_uni),
        "sample_no_price_today": sorted(sample_no_price),
        "universe_size": len(uni), "priced_today": len(priced),
    }


def validate_recent(days: int = 10) -> dict:
    """Recompute the last `days` COLLECTED sessions and diff each metric against the value
    the collector stored (breadth_monitor). Small diffs => the recompute faithfully
    reproduces the collector and the backfill can be trusted. Read-only."""
    from api.services import breadth_live as bl
    from api.services import breadth_monitor
    conn = bl._bars_conn()
    tickers, uni_date = bl.universe()
    if not tickers:
        return {"ok": False, "reason": "no universe"}

    # recent SPY sessions -> {date: ts}
    rows = conn.execute(
        "SELECT ts FROM ohlcv WHERE tf='D' AND ticker='SPY' ORDER BY ts DESC LIMIT ?",
        (int(days) + 3,),
    ).fetchall()
    date_ts = {bl._iso(int(r[0])): int(r[0]) for r in rows}

    stored = {}
    try:
        for r in breadth_monitor.get_history(int(days) + 6):
            if r.get("date"):
                stored[r["date"]] = r
    except Exception:
        stored = {}

    diffs = defaultdict(lambda: {"sum": 0.0, "max": 0.0, "n": 0})
    per_day = []
    for date in sorted(date_ts)[-int(days):]:
        s = stored.get(date)
        if not s:
            continue
        rc = recompute_close(date_ts[date], tickers)
        if not rc:
            continue
        worst = ("", 0.0)
        for k, v in rc.items():
            if k.startswith("_"):
                continue
            rv, sv = _f(v), _f(s.get(k))
            if rv is None or sv is None:
                continue
            d = abs(rv - sv)
            e = diffs[k]
            e["sum"] += d
            e["max"] = max(e["max"], d)
            e["n"] += 1
            if d > worst[1]:
                worst = (k, d)
        per_day.append({"date": date, "worst_metric": worst[0], "worst_diff": round(worst[1], 3)})

    summary = {k: {"mean": round(v["sum"] / v["n"], 3), "max": round(v["max"], 3), "n": v["n"]}
               for k, v in diffs.items() if v["n"]}
    # headline: the largest mean diff across metrics (should be tiny if the engine is faithful)
    worst_metric = max(summary.items(), key=lambda kv: kv[1]["mean"], default=(None, {"mean": 0}))
    return {
        "ok": True,
        "universe": len(tickers),
        "universe_date": uni_date,
        "days_checked": len(per_day),
        "worst_mean_diff": {"metric": worst_metric[0], **({"mean": worst_metric[1]["mean"]} if worst_metric[0] else {})},
        "per_metric": summary,
        "per_day": per_day,
    }
