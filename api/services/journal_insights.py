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
    """Generate up to 12 pattern-derived coaching statements."""
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

        daily_rows = conn.execute(
            """SELECT entry_date, discipline_score, pnl_total_pct
               FROM daily_journals
               WHERE user_id = ? AND discipline_score IS NOT NULL
               ORDER BY entry_date""",
            (user_id,),
        ).fetchall()
        daily_journals = [dict(r) for r in daily_rows]

        if len(entries) < 5:
            return []

        insights = []

        _insight_time_of_day(entries, insights)
        _insight_setup_comparison(entries, insights)
        _insight_mistake_correlation(entries, insights)
        _insight_size_clustering(entries, insights)
        _insight_daily_count(entries, insights)
        _insight_day_of_week(entries, insights)
        _insight_playbook_performance(entries, insights)
        _insight_streaks(entries, insights)
        _insight_emotion_outcome(entries, insights)
        _insight_process_trend(entries, insights)
        _insight_discipline_consistency(entries, daily_journals, insights)
        _insight_mistake_recurrence(entries, insights)

        result = sorted(insights, key=lambda x: x["priority"])[:12]
        _cache[user_id] = (now, result)
        return result[:limit]
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
            "category": "performance",
            "trend": None,
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
            "category": "performance",
            "trend": None,
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
            "category": "process",
            "trend": None,
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
            "category": "risk",
            "trend": None,
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
            "category": "risk",
            "trend": None,
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
            "category": "performance",
            "trend": None,
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
            "category": "process",
            "trend": None,
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
            "category": "psychology",
            "trend": None,
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
            "category": "psychology",
            "trend": None,
            "statement": f"Your best winning streak was {max_win} trades — stay disciplined when hot.",
            "evidence": "Winning streaks can lead to oversized positions or FOMO.",
            "action_type": "review",
            "action_label": "Review streak",
            "priority": 5,
        })


def _insight_emotion_outcome(entries: list[dict], insights: list[dict]):
    """Compare avg pnl_pct across emotional states."""
    from collections import defaultdict
    emotion_data: dict[str, list[float]] = defaultdict(list)
    for e in entries:
        tags = e.get("emotion_tags") or ""
        pnl = e.get("pnl_pct")
        if not tags.strip() or pnl is None:
            continue
        for tag in [t.strip() for t in tags.split(",") if t.strip()]:
            emotion_data[tag].append(float(pnl))

    qualified = {k: v for k, v in emotion_data.items() if len(v) >= 5}
    if len(qualified) < 2:
        return

    avgs = {k: sum(v) / len(v) for k, v in qualified.items()}
    best = max(avgs, key=avgs.get)
    worst = min(avgs, key=avgs.get)
    if avgs[best] - avgs[worst] < 1.0:
        return

    insights.append({
        "id": "emotion_outcome",
        "type": "emotion_outcome",
        "category": "psychology",
        "trend": None,
        "statement": f"You average {avgs[best]:+.1f}% when {best} vs {avgs[worst]:+.1f}% when {worst}.",
        "evidence": f"{len(qualified[best])} {best} trades, {len(qualified[worst])} {worst} trades.",
        "action_type": "analytics",
        "action_label": "View psychology",
        "priority": 2,
    })


def _insight_process_trend(entries: list[dict], insights: list[dict]):
    """Detect improvement or decline in process score over time."""
    scored = [e for e in entries if e.get("process_score") is not None]
    if len(scored) < 10:
        return

    mid = len(scored) // 2
    older = scored[:mid]
    recent = scored[mid:]

    if len(older) < 5 or len(recent) < 5:
        return

    older_avg = sum(e["process_score"] for e in older) / len(older)
    recent_avg = sum(e["process_score"] for e in recent) / len(recent)

    diff = recent_avg - older_avg
    if abs(diff) < 5:
        return

    direction = "up" if diff > 0 else "down"
    trend = "improving" if diff > 0 else "worsening"

    insights.append({
        "id": "process_trend",
        "type": "process_trend",
        "category": "process",
        "trend": trend,
        "statement": f"Your process score is trending {direction}: {older_avg:.0f} → {recent_avg:.0f} avg.",
        "evidence": f"Based on last {len(scored)} scored trades.",
        "action_type": "analytics",
        "action_label": "View by process score",
        "priority": 2,
    })


def _insight_discipline_consistency(
    entries: list[dict], daily_journals: list[dict], insights: list[dict]
):
    """Compare trading P&L on high-discipline days vs low-discipline days."""
    if len(daily_journals) < 10:
        return

    from collections import defaultdict
    pnl_by_date: dict[str, list[float]] = defaultdict(list)
    for e in entries:
        d = e.get("entry_date")
        pnl = e.get("pnl_pct")
        if d and pnl is not None:
            pnl_by_date[d].append(float(pnl))

    high_pnls: list[float] = []
    low_pnls: list[float] = []
    scores: list[int] = []

    for dj in daily_journals:
        ds = dj.get("discipline_score")
        d = dj.get("entry_date")
        if ds is None:
            continue
        scores.append(int(ds))
        if d not in pnl_by_date:
            continue
        avg_pnl = sum(pnl_by_date[d]) / len(pnl_by_date[d])
        if ds >= 70:
            high_pnls.append(avg_pnl)
        else:
            low_pnls.append(avg_pnl)

    if len(high_pnls) < 3 or len(low_pnls) < 3:
        return

    high_avg = sum(high_pnls) / len(high_pnls)
    low_avg = sum(low_pnls) / len(low_pnls)

    if high_avg - low_avg < 0.5:
        return

    pct_high = round(len(high_pnls) / (len(high_pnls) + len(low_pnls)) * 100)

    trend = "stable"
    if len(scores) >= 20:
        recent_avg = sum(scores[-10:]) / 10
        prior_avg = sum(scores[-20:-10]) / 10
        if recent_avg > prior_avg + 5:
            trend = "improving"
        elif recent_avg < prior_avg - 5:
            trend = "worsening"

    insights.append({
        "id": "discipline_consistency",
        "type": "discipline_consistency",
        "category": "psychology",
        "trend": trend,
        "statement": f"High-discipline days ({pct_high}% of sessions) average {high_avg:+.1f}% vs {low_avg:+.1f}%.",
        "evidence": f"Based on {len(high_pnls) + len(low_pnls)} daily discipline scores.",
        "action_type": "analytics",
        "action_label": "View analytics",
        "priority": 3,
    })


def _insight_mistake_recurrence(entries: list[dict], insights: list[dict]):
    """Detect a mistake that appears consistently across all three time periods."""
    with_mistakes = [e for e in entries if e.get("mistake_tags")]
    if len(with_mistakes) < 9:
        return

    third = len(with_mistakes) // 3
    first_third = with_mistakes[:third]
    mid_third = with_mistakes[third: third * 2]
    last_third = with_mistakes[third * 2:]

    from collections import defaultdict

    def count_mistakes(group: list[dict]) -> dict[str, int]:
        counts: dict[str, int] = defaultdict(int)
        for e in group:
            for t in [x.strip() for x in (e.get("mistake_tags") or "").split(",") if x.strip()]:
                counts[t] += 1
        return counts

    first_c = count_mistakes(first_third)
    mid_c = count_mistakes(mid_third)
    last_c = count_mistakes(last_third)

    for mistake in first_c:
        if first_c[mistake] >= 2 and mid_c.get(mistake, 0) >= 2 and last_c.get(mistake, 0) >= 2:
            trend = "worsening" if last_c[mistake] > first_c[mistake] else "stable"
            insights.append({
                "id": f"mistake_recurrence_{mistake}",
                "type": "mistake_recurrence",
                "category": "process",
                "trend": trend,
                "statement": f"'{mistake}' is a recurring pattern — it appeared in all three periods reviewed.",
                "evidence": "Consider adding a checklist rule to address this before entry.",
                "action_type": "review",
                "action_label": "Review mistakes",
                "priority": 1,
            })
            break  # report only the worst recurring mistake
