"""
Journal analytics service — aggregation by 12 dimensions with per-bucket metrics.
"""

from datetime import datetime

from api.services.auth_db import get_connection


_HOLDING_BUCKETS = [
    (0, 60, "< 1hr"),
    (60, 390, "1hr-1D"),
    (390, 1950, "1-5D"),
    (1950, 9750, "1-5W"),
    (9750, 999999, "5W+"),
]

_PROCESS_BUCKETS = [
    (0, 30, "0-30 (Poor)"),
    (31, 60, "31-60 (Average)"),
    (61, 80, "61-80 (Good)"),
    (81, 100, "81-100 (Elite)"),
]

VALID_GROUP_BY = {
    "setup", "symbol", "direction", "day_of_week", "session",
    "asset_class", "playbook", "month", "week", "mistake_tag",
    "emotion_tag", "holding_period_bucket", "process_score_bucket",
}


def get_analytics(user_id: str, group_by: str, date_from: str = None, date_to: str = None) -> dict:
    """Aggregate trade metrics by dimension.

    Returns {"buckets": [...], "totals": {...}, "equity_curve": [...]}.
    """
    conn = get_connection()
    try:
        where = "user_id = ? AND status = 'closed'"
        params = [user_id]
        if date_from:
            where += " AND entry_date >= ?"
            params.append(date_from)
        if date_to:
            where += " AND entry_date <= ?"
            params.append(date_to)

        rows = conn.execute(
            f"SELECT * FROM journal_entries WHERE {where} ORDER BY entry_date",
            params,
        ).fetchall()
        entries = [dict(r) for r in rows]

        # Group entries into buckets
        buckets: dict[str, list[dict]] = {}

        for e in entries:
            keys = _get_bucket_keys(e, group_by)
            for key in keys:
                if key not in buckets:
                    buckets[key] = []
                buckets[key].append(e)

        # Compute per-bucket metrics
        result = []
        for key, trades in buckets.items():
            result.append(_compute_bucket_metrics(key, trades))

        result.sort(key=lambda x: x["trade_count"], reverse=True)

        # Totals
        totals = _compute_bucket_metrics("ALL", entries) if entries else None

        # Equity curve (cumulative P&L per trade, chronological)
        equity = []
        cum = 0
        for e in entries:
            if e.get("pnl_pct") is not None:
                cum += e["pnl_pct"]
                equity.append({
                    "date": e["entry_date"],
                    "sym": e["sym"],
                    "cum_pnl": round(cum, 2),
                })

        return {"buckets": result, "totals": totals, "equity_curve": equity}
    finally:
        conn.close()


def _get_bucket_keys(entry: dict, group_by: str) -> list[str]:
    """Return bucket key(s) for an entry.

    Most dimensions return a single key, but comma-separated fields
    (mistake_tag, emotion_tag) can produce multiple keys so the trade
    appears in each relevant bucket.
    """
    if group_by == "setup":
        return [entry.get("setup") or "No Setup"]
    elif group_by == "symbol":
        return [entry.get("sym") or "Unknown"]
    elif group_by == "direction":
        return [entry.get("direction") or "Unknown"]
    elif group_by == "day_of_week":
        return [entry.get("day_of_week") or "Unknown"]
    elif group_by == "session":
        return [entry.get("session") or "Unknown"]
    elif group_by == "asset_class":
        return [entry.get("asset_class") or "equity"]
    elif group_by == "playbook":
        return [entry.get("playbook_id") or "No Playbook"]
    elif group_by == "month":
        ed = entry.get("entry_date", "")
        return [ed[:7]] if ed and len(ed) >= 7 else ["Unknown"]
    elif group_by == "week":
        try:
            dt = datetime.strptime(entry["entry_date"][:10], "%Y-%m-%d")
            iso = dt.isocalendar()
            return [f"{iso[0]}-W{iso[1]:02d}"]
        except (ValueError, KeyError, TypeError):
            return ["Unknown"]
    elif group_by == "mistake_tag":
        tags = (entry.get("mistake_tags") or "").strip()
        if not tags:
            return ["No Mistakes"]
        return [t.strip() for t in tags.split(",") if t.strip()]
    elif group_by == "emotion_tag":
        tags = (entry.get("emotion_tags") or "").strip()
        if not tags:
            return ["No Emotion Tag"]
        return [t.strip() for t in tags.split(",") if t.strip()]
    elif group_by == "holding_period_bucket":
        mins = entry.get("holding_minutes")
        if mins is None:
            return ["Unknown"]
        for lo, hi, label in _HOLDING_BUCKETS:
            if lo <= mins < hi:
                return [label]
        return ["5W+"]
    elif group_by == "process_score_bucket":
        ps = entry.get("process_score")
        if ps is None:
            return ["Unscored"]
        for lo, hi, label in _PROCESS_BUCKETS:
            if lo <= ps <= hi:
                return [label]
        return ["Unscored"]
    return ["Unknown"]


def _compute_bucket_metrics(key: str, trades: list[dict]) -> dict:
    """Compute aggregate metrics for a bucket of trades."""
    with_pnl = [t for t in trades if t.get("pnl_pct") is not None]
    wins = [t for t in with_pnl if t["pnl_pct"] > 0]
    losses = [t for t in with_pnl if t["pnl_pct"] <= 0]

    total_win = sum(t["pnl_pct"] for t in wins)
    total_loss = sum(abs(t["pnl_pct"]) for t in losses)
    pf = total_win / total_loss if total_loss > 0 else 0

    with_r = [t for t in with_pnl if t.get("realized_r") is not None]
    with_ps = [t for t in trades if t.get("process_score") is not None]

    best = max(with_pnl, key=lambda t: t["pnl_pct"]) if with_pnl else None
    worst = min(with_pnl, key=lambda t: t["pnl_pct"]) if with_pnl else None

    # Average holding minutes (only for trades that have it)
    with_holding = [t for t in trades if t.get("holding_minutes") is not None]
    avg_holding = (
        round(sum(t["holding_minutes"] for t in with_holding) / len(with_holding))
        if with_holding else None
    )

    return {
        "key": key,
        "trade_count": len(trades),
        "win_rate": round(len(wins) / len(with_pnl) * 100, 1) if with_pnl else 0,
        "avg_pnl_pct": round(sum(t["pnl_pct"] for t in with_pnl) / len(with_pnl), 2) if with_pnl else 0,
        "total_pnl_pct": round(sum(t["pnl_pct"] for t in with_pnl), 2) if with_pnl else 0,
        "avg_r": round(sum(t["realized_r"] for t in with_r) / len(with_r), 2) if with_r else None,
        "profit_factor": round(pf, 2),
        "avg_process_score": round(sum(t["process_score"] for t in with_ps) / len(with_ps), 1) if with_ps else None,
        "avg_holding_minutes": avg_holding,
        "best_trade": {"sym": best["sym"], "pnl_pct": best["pnl_pct"]} if best else None,
        "worst_trade": {"sym": worst["sym"], "pnl_pct": worst["pnl_pct"]} if worst else None,
    }
