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


_DEEP_RESULTS: dict = {}   # date -> result (validation / proof runs, in-memory)


def run_deep_async(date: str, limit: int = 0) -> None:
    """Background: recompute one past date's breadth from the deep pipeline and stash the
    result. Deep fetches (uncached history from Massive) are slow, so this can't run inline."""
    import time as _t
    from api.services import breadth_live as bl
    _DEEP_RESULTS[date] = {"status": "running", "started": True}
    try:
        tickers, _ = bl.universe()
        if limit:
            tickers = tickers[:limit]
        t0 = _t.perf_counter()
        out = recompute_close_deep(date, tickers)
        out["elapsed_s"] = round(_t.perf_counter() - t0, 1)
        out["tickers_used"] = len(tickers)
        out["status"] = "done"
        _DEEP_RESULTS[date] = out
    except Exception as e:
        _DEEP_RESULTS[date] = {"status": "error", "reason": f"{type(e).__name__}: {e}"}


import glob as _glob
import json as _json
import os as _os
from concurrent.futures import ThreadPoolExecutor as _Pool
from datetime import datetime as _dt, timezone as _tz

_DEEP_DIR = _os.path.join(_os.environ.get("DATA_DIR", "/data"), "bars_cache_deep")
_CACHE_DIR = _os.path.join(_os.environ.get("DATA_DIR", "/data"), "bars_cache")


def _norm_date(t) -> Optional[str]:
    """A bar's `t` (unix ms/s, or 'YYYY-MM-DD') -> 'YYYY-MM-DD'."""
    if isinstance(t, str):
        return t[:10] if len(t) >= 10 else None
    try:
        tv = int(t)
        if tv > 1_000_000_000_000:   # ms -> s
            tv //= 1000
        if tv > 20_000_000:          # unix seconds
            return _dt.fromtimestamp(tv, tz=_tz.utc).date().isoformat()
    except (TypeError, ValueError):
        return None
    return None


def _lean_deep_daily(ticker: str) -> list:
    """One ticker's DEEP daily bars — LEAN: read the deep disk cache we already warmed
    (free, no chart machinery), fall back to a single direct Massive daily-agg call. Skips
    _get_bars_inner entirely (its per-request overhead made bulk use crawl). Returns
    [{t,o,h,l,c,v}] or []."""
    tk = ticker.upper()
    for d in (_DEEP_DIR, _CACHE_DIR):
        try:
            for p in sorted(_glob.glob(_os.path.join(d, f"{tk}_D_*.json")), reverse=True):
                with open(p) as f:
                    data = _json.load(f)
                bars = data.get("bars")
                if bars and len(bars) > 250:      # deep enough to bother
                    return bars
        except Exception:
            continue
    try:
        from api.services import massive
        return massive.get_agg_bars(tk, "1995-01-01", "2027-01-01") or []
    except Exception:
        return []


def load_deep_frame(tickers: list[str], since: Optional[str] = None, workers: int = 12) -> dict:
    """Compact aligned frame for the WHOLE universe: {dates:[...], date_pos:{}, closes:np,
    vols:np} with closes/vols shaped [n_tickers x n_dates]. NumPy (not dict-of-dicts) keeps
    memory ~90MB for a few years x 3,700 names — safe against the pod-OOM class. `since`
    trims each ticker to dates >= since (bound memory for a bounded sweep). Fetched PARALLEL
    via the lean loader. Load ONCE; recompute every date off it."""
    import numpy as np
    def _one(t):
        d = {}
        for b in (_lean_deep_daily(t) or []):
            ds = _norm_date(b.get("t"))
            if ds and (since is None or ds >= since):
                cf = _f(b.get("c"))
                if cf is not None and cf > 0:
                    vf = _f(b.get("v"))
                    d[ds] = (cf, vf if vf is not None else float("nan"))
        return t, d
    raw: dict = {}
    with _Pool(max_workers=workers) as ex:
        for t, d in ex.map(_one, tickers):
            if d:
                raw[t] = d
    all_dates = sorted({ds for d in raw.values() for ds in d})
    date_pos = {ds: i for i, ds in enumerate(all_dates)}
    n, D = len(tickers), len(all_dates)
    closes = np.full((n, D), np.nan)
    vols = np.full((n, D), np.nan)
    for ti, t in enumerate(tickers):
        d = raw.get(t)
        if not d:
            continue
        for ds, (c, v) in d.items():
            j = date_pos[ds]
            closes[ti, j] = c
            vols[ti, j] = v
    del raw
    return {"dates": all_dates, "date_pos": date_pos, "closes": closes, "vols": vols,
            "names": sum(1 for i in range(n) if not np.all(np.isnan(closes[i])))}


def recompute_from_frame(frame: dict, tickers: list[str], target_date: str,
                         window: int = 320) -> dict:
    """PURE recompute for one date by SLICING the pre-loaded numpy frame — no fetching, no
    per-date allocation of the whole universe. Levels from the window's sessions strictly
    before target; target's close folded in as the price (mirrors _metrics_at_close)."""
    import numpy as np
    from api.services import breadth_live as bl
    dp = frame["date_pos"]
    tj = dp.get(target_date)
    if tj is None:
        return {"ok": False, "reason": f"no bar on {target_date} (holiday / no data)"}
    lo = max(0, tj - int(window) + 1)
    cols = slice(lo, tj + 1)
    win = tj - lo + 1
    if win < 221:
        return {"ok": False, "reason": f"only {win} sessions <=target (need 221)"}
    closes = frame["closes"][:, cols]
    vols = frame["vols"][:, cols]
    # Levels from sessions STRICTLY BEFORE target (drop the last column = target day).
    levels = bl.build_levels(tickers, closes[:, :-1], vols[:, :-1], 0)
    last_c = closes[:, -1]
    last_v = vols[:, -1]
    prices = {tickers[i]: float(last_c[i]) for i in range(len(tickers))
              if not np.isnan(last_c[i]) and last_c[i] > 0}
    dvols = {tickers[i]: float(last_v[i]) for i in range(len(tickers))
             if not np.isnan(last_v[i]) and last_v[i] > 0}
    if not prices:
        return {"ok": False, "reason": "no prices on target"}
    metrics = bl.compute_metrics(levels, prices, dvols)
    return {"ok": True, "date": target_date, "universe": len(tickers),
            "priced": len(prices), "measured": int(metrics.get("universe_count", 0)),
            "metrics": {k: v for k, v in metrics.items() if not k.startswith("_")}}


def recompute_close_deep(target_date: str, tickers: Optional[list[str]] = None,
                         window: int = 320) -> dict:
    """One-date convenience: LEAN-load the deep frame (parallel) then recompute. For many
    dates, call load_deep_frame once + recompute_from_frame per date instead."""
    from api.services import breadth_live as bl
    if tickers is None:
        tickers, _ = bl.universe()
    if not tickers:
        return {"ok": False, "reason": "no universe"}
    from datetime import date as _date, timedelta as _td
    since = (_date.fromisoformat(target_date) - _td(days=560)).isoformat()
    frame = load_deep_frame(tickers, since=since)
    out = recompute_from_frame(frame, tickers, target_date, window)
    out["frame_names"] = frame.get("names")
    return out


_SWEEP_STATE: dict = {"status": "idle"}


def sweep_history(from_date: str, to_date: Optional[str] = None,
                  tickers: Optional[list[str]] = None, window: int = 320,
                  batch: int = 4000) -> dict:
    """Backfill close-basis breadth history for [from_date, to_date]: load the deep frame
    ONCE, recompute every session, write close-to-close BODIES to breadth_daily_ohlc
    (source 'close_recon'). Bounded memory (numpy frame) + batched writes. This is the
    workhorse — heavy, so run it in a background thread (run_sweep_async)."""
    from datetime import date as _date, timedelta as _td
    from api.services import breadth_live as bl
    from api.services import breadth_daily_ohlc, breadth_monitor
    if tickers is None:
        tickers, _ = bl.universe()
    if not tickers:
        return {"ok": False, "reason": "no universe"}
    since = (_date.fromisoformat(from_date) - _td(days=560)).isoformat()  # ~1.6yr warmup for 200MA/52w
    frame = load_deep_frame(tickers, since=since)
    dates = frame["dates"]
    to_date = to_date or (dates[-1] if dates else from_date)
    # Start the derived-metric buffer ~15 sessions before from_date so ratios/score aren't
    # cold at the range start (ratio_10day needs 10 prior days).
    warm_start = next((d for d in dates if d >= from_date), from_date)
    warm_idx = max(0, dates.index(warm_start) - 15) if warm_start in dates else 0
    sweep = [d for d in dates[warm_idx:] if d <= to_date]
    prev: dict = {}
    recent: list = []          # full derived rows, NEWEST-FIRST (derive_live_row wants that)
    rows: list = []
    computed = written = 0
    for ds in sweep:
        r = recompute_from_frame(frame, tickers, ds, window)
        if not r.get("ok"):
            continue
        base = dict(r["metrics"])
        base["date"] = ds
        try:
            full = breadth_monitor.derive_live_row(base, recent)   # + breadth_score, ratios, hi/lo, A/D cum
        except Exception:
            full = base
        recent.insert(0, full)
        if len(recent) > 30:
            recent.pop()
        if ds < from_date:      # warmup only — seed the buffer, don't store
            continue
        for metric, val in full.items():
            if metric == "date":
                continue
            fv = _f(val)
            if fv is None:
                continue
            o = prev.get(metric, fv)                       # close-to-close body
            rows.append((ds, metric, round(o, 4), round(max(o, fv), 4),
                         round(min(o, fv), 4), round(fv, 4)))
            prev[metric] = fv
        computed += 1
        _SWEEP_STATE.update(progress=f"{ds} ({computed} written)")
        if len(rows) >= batch:
            written += breadth_daily_ohlc.write_bulk(rows, source="close_recon")
            rows = []
    if rows:
        written += breadth_daily_ohlc.write_bulk(rows, source="close_recon")
    return {"ok": True, "from": from_date, "to": to_date, "sessions": computed, "rows": written,
            "frame_names": frame.get("names"),
            "first_date": sweep[0] if sweep else None, "last_date": sweep[-1] if sweep else None}


def run_sweep_async(from_date: str, to_date: Optional[str] = None, limit: int = 0) -> None:
    """Background wrapper: recompute-and-store the close-basis history for a range."""
    import time as _t
    from api.services import breadth_live as bl
    _SWEEP_STATE.clear()
    _SWEEP_STATE.update(status="running", **{"from": from_date, "to": to_date})
    try:
        tickers, _ = bl.universe()
        if limit:
            tickers = tickers[:limit]
        t0 = _t.perf_counter()
        res = sweep_history(from_date, to_date, tickers)
        res["elapsed_s"] = round(_t.perf_counter() - t0, 1)
        res["status"] = "done"
        _SWEEP_STATE.clear()
        _SWEEP_STATE.update(res)
    except Exception as e:
        import traceback
        _SWEEP_STATE.clear()
        _SWEEP_STATE.update(status="error", reason=f"{type(e).__name__}: {e}",
                            trace=traceback.format_exc()[-600:])


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
