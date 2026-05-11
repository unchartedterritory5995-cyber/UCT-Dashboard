"""
Voice self-Q&A — let the user ask the assistant about THEIR OWN trading
performance, setups, mistakes, and history.

Each function:
  - calls into the existing journal_service / journal_analytics / journal_insights
  - returns {narration: str, ...structured_data} so the model can speak the
    narration AND optionally reference the structured fields

If an underlying service is unavailable, the function returns a graceful
fallback narration ("I couldn't pull your journal data") rather than failing.
"""

import logging
from datetime import datetime, timedelta

_log = logging.getLogger(__name__)


# ── Indirections — monkeypatchable in tests ────────────────────────────────

def _date_from_for_period(period: str) -> str | None:
    """Convert a period name to an ISO date_from string (None = no filter)."""
    period = (period or "").lower()
    if period in {"all", "year"}:
        return None
    from datetime import date, timedelta
    today = date.today()
    if period == "today":
        return today.isoformat()
    if period == "week":
        return (today - timedelta(days=7)).isoformat()
    if period == "month":
        return (today - timedelta(days=30)).isoformat()
    if period == "ytd":
        return date(today.year, 1, 1).isoformat()
    return None


def _stats_for_period(user_id: str, period: str) -> dict:
    """Return aggregate stats. Normalizes get_stats's shape to what our
    narration code expects: {trade_count, total_pnl_pct, total_pnl_dollar,
    win_rate, best_trade, worst_trade}."""
    try:
        from api.services.journal_service import get_stats
    except ImportError:
        return {}
    date_from = _date_from_for_period(period)
    raw = get_stats(user_id, date_from=date_from) or {}

    # get_stats returns various aggregate keys — normalize.
    out = {
        "trade_count": int(raw.get("total_trades") or raw.get("trade_count") or 0),
        "total_pnl_pct": raw.get("total_pnl_pct") or raw.get("avg_pnl_pct"),
        "total_pnl_dollar": raw.get("total_pnl_dollar") or raw.get("net_pnl"),
        "win_rate": raw.get("win_rate"),
        "best_trade": (raw.get("best_trade") or {}).get("sym") if isinstance(raw.get("best_trade"), dict) else raw.get("best_trade"),
        "worst_trade": (raw.get("worst_trade") or {}).get("sym") if isinstance(raw.get("worst_trade"), dict) else raw.get("worst_trade"),
    }
    return out


def _setup_breakdown(user_id: str) -> list[dict]:
    """Per-setup performance breakdown. Uses get_analytics(group_by='setup')."""
    try:
        from api.services.journal_analytics import get_analytics
    except ImportError:
        return []
    data = get_analytics(user_id, group_by="setup") or {}
    buckets = data.get("buckets") or data.get("rows") or []
    out = []
    for b in buckets:
        if not isinstance(b, dict):
            continue
        out.append({
            "setup": b.get("key") or b.get("setup") or "unknown",
            "trade_count": int(b.get("trade_count") or b.get("count") or 0),
            "win_rate": b.get("win_rate"),
            "avg_pnl_pct": b.get("avg_pnl_pct"),
            "expectancy": b.get("expectancy"),
        })
    return out


def _recent_mistakes(user_id: str, days: int = 30) -> list[dict]:
    """Aggregate mistake_tags across the user's journal entries in the period."""
    try:
        from api.services.journal_service import list_entries
    except ImportError:
        return []
    date_from = _date_from_for_period("month") if days == 30 else None
    if days != 30:
        from datetime import date, timedelta
        date_from = (date.today() - timedelta(days=days)).isoformat()

    result = list_entries(user_id, filters={"date_from": date_from} if date_from else {},
                          limit=500) or {}
    entries = result.get("trades") or []
    counts: dict[str, int] = {}
    for e in entries:
        tags = (e.get("mistake_tags") or "").strip()
        if not tags:
            continue
        for t in tags.split(","):
            t = t.strip().lower()
            if t:
                counts[t] = counts.get(t, 0) + 1
    return [{"mistake_type": k, "count": v} for k, v in sorted(counts.items(), key=lambda x: -x[1])]


def _psychology_trend(user_id: str, days: int = 90) -> dict:
    try:
        from api.services.journal_psychology import get_psychology_data
        return get_psychology_data(user_id, days=days) or {}
    except (ImportError, AttributeError):
        return {}


def _find_trades(user_id: str, *, symbol: str = "", status: str = "",
                 setup: str = "", days: int = 30) -> list[dict]:
    """Filtered trade search using list_entries (returns {trades:[], total})."""
    try:
        from api.services.journal_service import list_entries
    except ImportError:
        return []
    filters: dict = {}
    if symbol:
        filters["sym"] = symbol.upper().strip()
    if status:
        filters["status"] = status
    if setup:
        filters["setup"] = setup
    if days:
        from datetime import date, timedelta
        filters["date_from"] = (date.today() - timedelta(days=int(days))).isoformat()
    result = list_entries(user_id, filters=filters, limit=20) or {}
    return result.get("trades") or []


# ── Tools ──────────────────────────────────────────────────────────────────

def get_my_pnl(*, user_id: str, period: str = "week") -> dict:
    period = (period or "week").lower().strip()
    if period not in {"today", "week", "month", "ytd", "year", "all"}:
        period = "week"
    stats = _stats_for_period(user_id, period) or {}
    count = int(stats.get("trade_count") or 0)
    pnl_pct = stats.get("total_pnl_pct")
    pnl_dol = stats.get("total_pnl_dollar")
    win_rate = stats.get("win_rate")
    best = stats.get("best_trade")
    worst = stats.get("worst_trade")

    if count == 0:
        return {"narration": f"No trades logged for {period} yet.", "trade_count": 0}

    parts = [f"For {period}: {count} trades"]
    if pnl_pct is not None:
        parts.append(f"{round(float(pnl_pct), 1)} percent net")
    if pnl_dol is not None:
        parts.append(f"that's {round(float(pnl_dol), 0)} dollars")
    if win_rate is not None:
        parts.append(f"{round(float(win_rate) * 100)} percent win rate")
    narration = "; ".join(parts) + "."
    if best:
        narration += f" Best was {best}."
    if worst:
        narration += f" Worst was {worst}."

    return {"narration": narration, "trade_count": count,
            "pnl_pct": pnl_pct, "pnl_dollar": pnl_dol, "win_rate": win_rate}


def get_my_setup_performance(*, user_id: str, setup: str = "") -> dict:
    setups = _setup_breakdown(user_id)
    if not setups:
        return {"narration": "No setup data yet — I need more closed trades to compute breakdown.",
                "count": 0}

    if setup:
        # Filter to specific setup
        match = next((s for s in setups if (s.get("setup") or "").lower() == setup.lower()), None)
        if not match:
            return {"narration": f"I don't see any trades on the {setup} setup yet.", "count": 0}
        wr = match.get("win_rate")
        avg = match.get("avg_pnl_pct")
        cnt = match.get("trade_count")
        parts = [f"{setup}: {cnt} trades"]
        if wr is not None:
            parts.append(f"{round(float(wr) * 100)} percent win rate")
        if avg is not None:
            parts.append(f"{round(float(avg), 1)} percent average")
        return {"narration": "; ".join(parts) + ".", "count": 1, "setup": setup}

    # Sorted by expectancy or avg_pnl
    ranked = sorted(setups, key=lambda s: float(s.get("expectancy") or s.get("avg_pnl_pct") or 0), reverse=True)
    top3 = ranked[:3]
    bottom1 = ranked[-1] if len(ranked) > 3 else None

    parts = ["Your strongest setups: "]
    parts.append(", ".join(
        f"{s.get('setup')} at {round(float(s.get('avg_pnl_pct') or 0), 1)} percent average"
        for s in top3
    ))
    if bottom1 and bottom1 not in top3:
        parts.append(
            f". Weakest is {bottom1.get('setup')} at {round(float(bottom1.get('avg_pnl_pct') or 0), 1)} percent."
        )
    else:
        parts.append(".")

    return {"narration": "".join(parts), "count": len(setups)}


def get_my_recent_mistakes(*, user_id: str, days: int = 30) -> dict:
    days = max(1, min(int(days or 30), 365))
    mistakes = _recent_mistakes(user_id, days=days)
    if not mistakes:
        return {"narration": f"No mistakes logged in the last {days} days. Clean tape.", "count": 0}

    top3 = sorted(mistakes, key=lambda m: int(m.get("count") or 0), reverse=True)[:3]
    parts = ", ".join(
        f"{m.get('mistake_type')} {int(m.get('count') or 0)} times"
        for m in top3
    )
    return {
        "narration": f"In the last {days} days: {parts}.",
        "count": len(mistakes),
    }


def get_my_psychology(*, user_id: str, period: str = "month") -> dict:
    days_map = {"week": 7, "month": 30, "quarter": 90, "year": 365}
    days = days_map.get((period or "month").lower(), 30)
    data = _psychology_trend(user_id, days=days)
    if not data or not data.get("process_trend"):
        return {"narration": "I don't have enough process data to comment yet — keep logging.", "count": 0}

    # Average process score from trend
    trend = data.get("process_trend") or {}
    if isinstance(trend, dict):
        vals = [v for v in trend.values() if v is not None]
    else:
        vals = []
    avg_process = round(sum(vals) / len(vals), 1) if vals else None

    emo = data.get("emotion_outcomes") or {}
    best_emo = None
    if isinstance(emo, dict):
        for k, v in emo.items():
            pnl = v.get("avg_pnl") if isinstance(v, dict) else None
            if pnl is not None and (best_emo is None or pnl > best_emo[1]):
                best_emo = (k, pnl)

    parts = []
    if avg_process is not None:
        parts.append(f"Average process score is {avg_process}")
    if best_emo:
        parts.append(f"You trade best when you feel {best_emo[0]}")
    if not parts:
        return {"narration": "Process data is sparse for this period.", "count": 0}

    return {"narration": ". ".join(parts) + ".", "count": 1}


def find_my_trades(*, user_id: str, symbol: str = "", status: str = "",
                   setup: str = "", days: int = 30) -> dict:
    trades = _find_trades(user_id, symbol=symbol, status=status, setup=setup, days=days)
    if not trades:
        filters_desc = []
        if symbol:
            filters_desc.append(symbol.upper())
        if status:
            filters_desc.append(status)
        if setup:
            filters_desc.append(setup)
        desc = " ".join(filters_desc) if filters_desc else "your filter"
        return {"narration": f"I couldn't find any trades matching {desc}.", "count": 0}

    parts = [f"Found {len(trades)} matching trade{'s' if len(trades) != 1 else ''}."]
    # Mention the most recent 3
    for t in trades[:3]:
        sym = (t.get("sym") or "").upper()
        status_t = t.get("status") or "open"
        pnl = t.get("pnl_pct")
        if pnl is not None:
            parts.append(f"{sym} {status_t}, {round(float(pnl), 1)} percent")
        else:
            parts.append(f"{sym} {status_t}")

    return {"narration": " ".join(parts), "count": len(trades)}
