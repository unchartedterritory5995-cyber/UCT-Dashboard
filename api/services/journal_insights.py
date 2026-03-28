"""
Insights engine — 8 pattern-derived coaching statements from trade data.
All server-side computation, no AI. Results cached 5 minutes in-memory.
"""

import time
from api.services.auth_db import get_connection

# Simple in-memory cache: {user_id: (timestamp, results)}
_cache: dict[str, tuple[float, list[dict]]] = {}
_CACHE_TTL = 300  # 5 minutes


def get_insights(user_id: str, limit: int = 8) -> list[dict]:
    """Generate up to 8 pattern-derived coaching statements."""
    now = time.time()
    cached = _cache.get(user_id)
    if cached and (now - cached[0]) < _CACHE_TTL:
        return cached[1][:limit]

    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM journal_entries WHERE user_id = ? AND status = 'closed' ORDER BY entry_date",
            (user_id,),
        ).fetchall()
        entries = [dict(r) for r in rows]

        if len(entries) < 5:
            return []  # Not enough data for insights

        insights = []

        # 1. Time-of-day win rates
        _insight_time_of_day(entries, insights)
        # 2. Setup comparison
        _insight_setup_comparison(entries, insights)
        # 3. Mistake correlation
        _insight_mistake_correlation(entries, insights)
        # 4. Position size clustering
        _insight_size_clustering(entries, insights)
        # 5. Trades-per-day analysis
        _insight_daily_count(entries, insights)
        # 6. Day-of-week analysis
        _insight_day_of_week(entries, insights)
        # 7. Playbook vs unlinked
        _insight_playbook_performance(entries, insights)
        # 8. Streak detection
        _insight_streaks(entries, insights)

        result = sorted(insights, key=lambda x: x["priority"])[:limit]
        _cache[user_id] = (now, result)
        return result
    finally:
        conn.close()


def _insight_time_of_day(entries: list[dict], insights: list[dict]):
    """Compare win rate by session buckets."""
    buckets: dict[str, dict] = {}
    for e in entries:
        t = e.get("entry_time") or ""
        if not t or ":" not in t:
            continue
        try:
            parts = t.split(":")
            hour = int(parts[0])
            minute = int(parts[1])
        except (ValueError, IndexError):
            continue

        if hour < 9 or (hour == 9 and minute < 30):
            key = "Pre-market"
        elif hour < 11:
            key = "First 90min"
        elif hour < 14:
            key = "Midday"
        elif hour < 16:
            key = "Power hour"
        else:
            key = "After hours"

        if key not in buckets:
            buckets[key] = {"wins": 0, "total": 0}
        buckets[key]["total"] += 1
        if e.get("pnl_pct") is not None and e["pnl_pct"] > 0:
            buckets[key]["wins"] += 1

    if len(buckets) < 2:
        return

    rates = {k: v["wins"] / v["total"] * 100 for k, v in buckets.items() if v["total"] >= 3}
    if len(rates) < 2:
        return

    best = max(rates, key=rates.get)
    worst = min(rates, key=rates.get)
    overall_total = sum(v["total"] for v in buckets.values())
    if rates[best] - rates[worst] >= 15:
        insights.append({
            "id": "time_of_day",
            "type": "time_of_day",
            "statement": f"Your win rate is {rates[best]:.0f}% during {best} vs {rates[worst]:.0f}% during {worst}.",
            "evidence": f"Based on {overall_total} trades with timestamps.",
            "action_type": "filter",
            "action_label": f"View {best} trades",
            "priority": 2,
        })


def _insight_setup_comparison(entries: list[dict], insights: list[dict]):
    """Find best and worst setups by expectancy."""
    setups: dict[str, list[float]] = {}
    for e in entries:
        s = e.get("setup") or "Unknown"
        if e.get("pnl_pct") is not None:
            setups.setdefault(s, []).append(e["pnl_pct"])

    qualified = {k: v for k, v in setups.items() if len(v) >= 3}
    if len(qualified) < 2:
        return

    avgs = {k: sum(v) / len(v) for k, v in qualified.items()}
    best = max(avgs, key=avgs.get)
    worst = min(avgs, key=avgs.get)
    if avgs[best] - avgs[worst] >= 1:
        insights.append({
            "id": "setup_comparison",
            "type": "setup_comparison",
            "statement": f"{best} averages +{avgs[best]:.1f}% per trade vs {worst} at {avgs[worst]:+.1f}%.",
            "evidence": f"{len(qualified[best])} {best} trades, {len(qualified[worst])} {worst} trades.",
            "action_type": "analytics",
            "action_label": "View by setup",
            "priority": 1,
        })


def _insight_mistake_correlation(entries: list[dict], insights: list[dict]):
    """Compare P&L on trades with vs without mistakes."""
    with_mistakes = [e for e in entries if e.get("mistake_tags") and e.get("pnl_pct") is not None]
    without = [e for e in entries if not e.get("mistake_tags") and e.get("pnl_pct") is not None]

    if len(with_mistakes) < 3 or len(without) < 3:
        return

    avg_with = sum(e["pnl_pct"] for e in with_mistakes) / len(with_mistakes)
    avg_without = sum(e["pnl_pct"] for e in without) / len(without)

    if avg_without - avg_with >= 0.5:
        insights.append({
            "id": "mistake_correlation",
            "type": "mistake_correlation",
            "statement": f"Trades with mistakes average {avg_with:+.1f}% vs {avg_without:+.1f}% without.",
            "evidence": f"{len(with_mistakes)} trades had mistakes tagged, {len(without)} did not.",
            "action_type": "analytics",
            "action_label": "View by mistake",
            "priority": 3,
        })


def _insight_size_clustering(entries: list[dict], insights: list[dict]):
    """Detect if larger positions lose more often."""
    sized = [e for e in entries if e.get("size_pct") and e.get("pnl_pct") is not None]
    if len(sized) < 10:
        return

    sorted_by_size = sorted(sized, key=lambda e: e["size_pct"])
    mid = len(sorted_by_size) // 2
    small = sorted_by_size[:mid]
    large = sorted_by_size[mid:]

    small_wr = sum(1 for e in small if e["pnl_pct"] > 0) / len(small) * 100
    large_wr = sum(1 for e in large if e["pnl_pct"] > 0) / len(large) * 100

    if abs(small_wr - large_wr) >= 15:
        better = "smaller" if small_wr > large_wr else "larger"
        insights.append({
            "id": "size_clustering",
            "type": "size_clustering",
            "statement": f"You perform better on {better} positions ({max(small_wr, large_wr):.0f}% vs {min(small_wr, large_wr):.0f}% WR).",
            "evidence": "Compared top vs bottom half of positions by size.",
            "action_type": "review",
            "action_label": "Review sizing",
            "priority": 4,
        })


def _insight_daily_count(entries: list[dict], insights: list[dict]):
    """Compare performance by # trades per day."""
    by_date: dict[str, list[dict]] = {}
    for e in entries:
        d = e.get("entry_date")
        if d:
            by_date.setdefault(d, []).append(e)

    low_days = [d for d, ts in by_date.items() if len(ts) <= 2]
    high_days = [d for d, ts in by_date.items() if len(ts) >= 4]

    if len(low_days) < 3 or len(high_days) < 3:
        return

    low_trades = [e for d in low_days for e in by_date[d] if e.get("pnl_pct") is not None]
    high_trades = [e for d in high_days for e in by_date[d] if e.get("pnl_pct") is not None]

    if not low_trades or not high_trades:
        return

    low_pnl = sum(e["pnl_pct"] for e in low_trades) / len(low_trades)
    high_pnl = sum(e["pnl_pct"] for e in high_trades) / len(high_trades)

    if abs(low_pnl - high_pnl) >= 0.5:
        better = "1-2 trade" if low_pnl > high_pnl else "4+ trade"
        insights.append({
            "id": "daily_count",
            "type": "daily_count",
            "statement": f"You average {max(low_pnl, high_pnl):+.1f}% per trade on {better} days vs {min(low_pnl, high_pnl):+.1f}% on others.",
            "evidence": f"{len(low_days)} low-activity days, {len(high_days)} high-activity days.",
            "action_type": "review",
            "action_label": "Review overtrading",
            "priority": 3,
        })


def _insight_day_of_week(entries: list[dict], insights: list[dict]):
    """Best and worst day of week."""
    by_dow: dict[str, list[float]] = {}
    for e in entries:
        dow = e.get("day_of_week")
        if dow and e.get("pnl_pct") is not None:
            by_dow.setdefault(dow, []).append(e["pnl_pct"])

    qualified = {k: v for k, v in by_dow.items() if len(v) >= 3}
    if len(qualified) < 3:
        return

    avgs = {k: sum(v) / len(v) for k, v in qualified.items()}
    best = max(avgs, key=avgs.get)
    worst = min(avgs, key=avgs.get)
    if avgs[best] - avgs[worst] >= 1:
        insights.append({
            "id": "day_of_week",
            "type": "day_of_week",
            "statement": f"{best}s average {avgs[best]:+.1f}% while {worst}s average {avgs[worst]:+.1f}%.",
            "evidence": f"Across {sum(len(v) for v in qualified.values())} trades with day data.",
            "action_type": "analytics",
            "action_label": "View by day",
            "priority": 5,
        })


def _insight_playbook_performance(entries: list[dict], insights: list[dict]):
    """Compare playbook-linked vs unlinked trades."""
    linked = [e for e in entries if e.get("playbook_id") and e.get("pnl_pct") is not None]
    unlinked = [e for e in entries if not e.get("playbook_id") and e.get("pnl_pct") is not None]

    if len(linked) < 3 or len(unlinked) < 3:
        return

    avg_linked = sum(e["pnl_pct"] for e in linked) / len(linked)
    avg_unlinked = sum(e["pnl_pct"] for e in unlinked) / len(unlinked)

    if abs(avg_linked - avg_unlinked) >= 0.5:
        insights.append({
            "id": "playbook_performance",
            "type": "playbook_performance",
            "statement": f"Playbook trades average {avg_linked:+.1f}% vs {avg_unlinked:+.1f}% without.",
            "evidence": f"{len(linked)} playbook-linked, {len(unlinked)} unlinked.",
            "action_type": "playbooks",
            "action_label": "View playbooks",
            "priority": 4,
        })


def _insight_streaks(entries: list[dict], insights: list[dict]):
    """Detect significant losing or winning streaks."""
    with_pnl = [e for e in entries if e.get("pnl_pct") is not None]
    if len(with_pnl) < 10:
        return

    # Find longest losing streak
    max_lose = 0
    current_lose = 0
    streak_trades = []
    current_streak = []
    for e in with_pnl:
        if e["pnl_pct"] <= 0:
            current_lose += 1
            current_streak.append(e)
            if current_lose > max_lose:
                max_lose = current_lose
                streak_trades = list(current_streak)
        else:
            current_lose = 0
            current_streak = []

    if max_lose >= 5:
        # Check if streak trades share common tags
        all_tags = []
        for t in streak_trades:
            if t.get("mistake_tags"):
                all_tags.extend([tag.strip() for tag in t["mistake_tags"].split(",")])

        tag_note = ""
        if all_tags:
            from collections import Counter
            common = Counter(all_tags).most_common(1)
            if common and common[0][1] >= 2:
                tag_note = f" — {common[0][0]} appeared in {common[0][1]} of them"

        insights.append({
            "id": "losing_streak",
            "type": "streak_detection",
            "statement": f"Your longest losing streak was {max_lose} trades in a row{tag_note}.",
            "evidence": "Consider reducing size after 3 consecutive losses.",
            "action_type": "review",
            "action_label": "Review streak",
            "priority": 2,
        })

    # Find longest winning streak too
    max_win = 0
    current_win = 0
    for e in with_pnl:
        if e["pnl_pct"] > 0:
            current_win += 1
            max_win = max(max_win, current_win)
        else:
            current_win = 0

    if max_win >= 7:
        insights.append({
            "id": "winning_streak",
            "type": "streak_detection",
            "statement": f"Your best winning streak was {max_win} trades — stay disciplined when hot.",
            "evidence": "Winning streaks can lead to oversized positions or FOMO.",
            "action_type": "review",
            "action_label": "Review streak",
            "priority": 5,
        })
