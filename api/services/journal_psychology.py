"""
Psychology data aggregation for the Journal — process score trend, emotion/week,
emotion → P&L outcomes, mistake trend. Cached 10 minutes per (user_id, days).
"""
import time
from datetime import date, timedelta
from collections import defaultdict
from api.services.auth_db import get_connection

_cache: dict[tuple, tuple[float, dict]] = {}
_CACHE_TTL = 600  # 10 minutes


def get_psychology_data(user_id: str, days: int = 90) -> dict:
    """Return psychology time-series data for user over the given lookback."""
    key = (user_id, days)
    now = time.time()
    cached = _cache.get(key)
    if cached and (now - cached[0]) < _CACHE_TTL:
        return cached[1]

    since = (date.today() - timedelta(days=days)).isoformat() if days > 0 else "2000-01-01"

    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT entry_date, process_score, emotion_tags, mistake_tags, pnl_pct
               FROM journal_entries
               WHERE user_id = ? AND status = 'closed' AND entry_date >= ?
               ORDER BY entry_date""",
            (user_id, since),
        ).fetchall()
        entries = [dict(r) for r in rows]

        result = {
            "process_trend": _compute_process_trend(entries),
            "emotion_by_week": _compute_emotion_by_week(entries),
            "emotion_outcomes": _compute_emotion_outcomes(entries),
            "mistake_trend": _compute_mistake_trend(entries),
        }
        _cache[key] = (now, result)
        return result
    finally:
        conn.close()


def _iso_week(date_str: str) -> str:
    """Return ISO week string like '2026-W13' from a date string."""
    try:
        d = date.fromisoformat(date_str)
        return f"{d.isocalendar().year}-W{d.isocalendar().week:02d}"
    except (ValueError, AttributeError):
        return "unknown"


def _compute_process_trend(entries: list[dict]) -> list[dict]:
    by_date: dict[str, list[float]] = defaultdict(list)
    for e in entries:
        d = e.get("entry_date")
        ps = e.get("process_score")
        if d and ps is not None:
            by_date[d].append(float(ps))

    return [
        {"date": d, "avg_process": round(sum(vals) / len(vals), 1), "trade_count": len(vals)}
        for d in sorted(by_date)
        for vals in [by_date[d]]
    ]


def _compute_emotion_by_week(entries: list[dict]) -> list[dict]:
    by_week: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for e in entries:
        d = e.get("entry_date")
        tags = e.get("emotion_tags") or ""
        if not d or not tags.strip():
            continue
        week = _iso_week(d)
        for tag in [t.strip() for t in tags.split(",") if t.strip()]:
            by_week[week][tag] += 1

    return [{"week": w, "emotions": dict(by_week[w])} for w in sorted(by_week)]


def _compute_emotion_outcomes(entries: list[dict]) -> list[dict]:
    data: dict[str, dict] = defaultdict(lambda: {"pnl_sum": 0.0, "count": 0, "wins": 0})
    for e in entries:
        tags = e.get("emotion_tags") or ""
        pnl = e.get("pnl_pct")
        if not tags.strip() or pnl is None:
            continue
        for tag in [t.strip() for t in tags.split(",") if t.strip()]:
            data[tag]["pnl_sum"] += float(pnl)
            data[tag]["count"] += 1
            if float(pnl) > 0:
                data[tag]["wins"] += 1

    result = [
        {
            "emotion": emotion,
            "avg_pnl": round(d["pnl_sum"] / d["count"], 2),
            "trade_count": d["count"],
            "win_rate": round(d["wins"] / d["count"] * 100, 1),
        }
        for emotion, d in data.items()
        if d["count"] >= 3
    ]
    result.sort(key=lambda x: x["avg_pnl"], reverse=True)
    return result


def _compute_mistake_trend(entries: list[dict]) -> list[dict]:
    by_week: dict[str, dict] = {}
    for e in entries:
        d = e.get("entry_date")
        tags = e.get("mistake_tags") or ""
        if not d or not tags.strip():
            continue
        week = _iso_week(d)
        if week not in by_week:
            by_week[week] = {"count": 0, "mistakes": defaultdict(int)}
        for tag in [t.strip() for t in tags.split(",") if t.strip()]:
            by_week[week]["count"] += 1
            by_week[week]["mistakes"][tag] += 1

    result = []
    for week in sorted(by_week):
        wd = by_week[week]
        top = max(wd["mistakes"], key=wd["mistakes"].get) if wd["mistakes"] else None
        result.append({"week": week, "mistake_count": wd["count"], "top_mistake": top})
    return result
