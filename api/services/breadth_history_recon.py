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
