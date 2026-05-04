# Process Scorecard Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Psychology Timeline to the Journal Analytics tab and upgrade the coaching feed on Overview with category grouping, trend indicators, and 4 new psychology-focused insight functions.

**Architecture:** New `api/services/journal_psychology.py` aggregates process/emotion/mistake time-series data for the `/api/journal/psychology` endpoint. `journal_insights.py` gains 4 new functions and `category`/`trend` fields on all 12 insights. Frontend: new `PsychologyTimeline.jsx` (3 ECharts panels) wired into Analytics when the "Psychology" dimension is selected; `InsightCard` gets a category badge and trend arrow; `Overview` groups insights by category.

**Tech Stack:** Python/SQLite (journal_psychology.py), FastAPI (journal.py router), React + useSWR, ECharts (echarts-for-react already installed), CSS Modules.

---

## File Map

| File | Change |
|------|--------|
| `api/services/journal_psychology.py` | Create — psychology data aggregation |
| `api/services/journal_insights.py` | Modify — 4 new functions + category/trend on all |
| `api/routers/journal.py` | Modify — add GET /api/journal/psychology |
| `app/src/pages/journal/tabs/PsychologyTimeline.jsx` | Create — 3-panel ECharts component |
| `app/src/pages/journal/tabs/PsychologyTimeline.module.css` | Create — panel layout styles |
| `app/src/pages/journal/tabs/Analytics.jsx` | Modify — add Psychology chip, render PsychologyTimeline |
| `app/src/pages/journal/components/InsightCard.jsx` | Modify — category badge + trend arrow |
| `app/src/pages/journal/components/InsightCard.module.css` | Modify — badge + trend styles |
| `app/src/pages/journal/tabs/Overview.jsx` | Modify — group insights by category, request limit=12 |
| `app/src/pages/journal/tabs/Overview.module.css` | Modify — insightGroupHeader style |
| `tests/test_journal_psychology.py` | Create — 4 psychology data tests |
| `tests/test_journal_insights.py` | Create — 6 insight function tests |

---

### Task 1: `journal_psychology.py` service

**Files:**
- Create: `api/services/journal_psychology.py`
- Test: `tests/test_journal_psychology.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_journal_psychology.py
"""Tests for journal_psychology.get_psychology_data aggregation helpers."""
import pytest
from api.services import journal_psychology


def _entry(entry_date, process_score=None, emotion_tags=None, mistake_tags=None, pnl_pct=None):
    return {
        "entry_date": entry_date,
        "process_score": process_score,
        "emotion_tags": emotion_tags or "",
        "mistake_tags": mistake_tags or "",
        "pnl_pct": pnl_pct,
    }


def test_process_trend_groups_by_date():
    """Two entries on the same date should be averaged into one row."""
    entries = [
        _entry("2026-04-01", process_score=60),
        _entry("2026-04-01", process_score=80),
        _entry("2026-04-02", process_score=70),
    ]
    result = journal_psychology._compute_process_trend(entries)
    assert len(result) == 2
    assert result[0]["date"] == "2026-04-01"
    assert result[0]["avg_process"] == 70.0
    assert result[0]["trade_count"] == 2


def test_emotion_by_week_parses_csv():
    """A comma-separated emotion_tags string should count each emotion separately."""
    entries = [_entry("2026-03-31", emotion_tags="calm,anxious")]
    result = journal_psychology._compute_emotion_by_week(entries)
    assert len(result) == 1
    assert result[0]["emotions"]["calm"] == 1
    assert result[0]["emotions"]["anxious"] == 1


def test_emotion_outcomes_win_rate():
    """2 wins and 1 loss should produce a 66.7% win rate."""
    entries = [
        _entry("2026-04-01", emotion_tags="calm", pnl_pct=1.0),
        _entry("2026-04-02", emotion_tags="calm", pnl_pct=2.0),
        _entry("2026-04-03", emotion_tags="calm", pnl_pct=-0.5),
    ]
    result = journal_psychology._compute_emotion_outcomes(entries)
    assert len(result) == 1
    assert result[0]["emotion"] == "calm"
    assert result[0]["trade_count"] == 3
    assert abs(result[0]["win_rate"] - 66.7) < 0.1


def test_empty_when_no_entries():
    """All helpers should return empty lists for an empty input, not crash."""
    entries = []
    assert journal_psychology._compute_process_trend(entries) == []
    assert journal_psychology._compute_emotion_by_week(entries) == []
    assert journal_psychology._compute_emotion_outcomes(entries) == []
    assert journal_psychology._compute_mistake_trend(entries) == []
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd C:\Users\Patrick\uct-dashboard
python -m pytest tests/test_journal_psychology.py -v
```
Expected: `ModuleNotFoundError` or `ImportError` — `journal_psychology` does not exist yet.

- [ ] **Step 3: Create `api/services/journal_psychology.py`**

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

```
python -m pytest tests/test_journal_psychology.py -v
```
Expected: 4 PASSED.

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_psychology.py tests/test_journal_psychology.py
git commit -m "feat: add journal_psychology service with process/emotion/mistake aggregation"
```

---

### Task 2: Backend route `/api/journal/psychology`

**Files:**
- Modify: `api/routers/journal.py` (add import + route at end of file)

- [ ] **Step 1: Add import at the top of `api/routers/journal.py`**

Find the existing imports block (lines ~1-30). After the existing `from api.services import ...` line, add:

```python
from api.services import journal_psychology as psych_svc
```

- [ ] **Step 2: Add the route at the bottom of `api/routers/journal.py`**

After the last existing `@router` route, append:

```python
@router.get("/api/journal/psychology")
def get_psychology_data_route(days: int = 90, user=Depends(require_auth)):
    """Time-series psychology data: process trend, emotion/week, emotion outcomes, mistake trend."""
    return psych_svc.get_psychology_data(user["id"], days)
```

- [ ] **Step 3: Verify the server starts and the route is reachable**

```
uvicorn api.main:app --reload --port 8000
```
In another terminal:
```
curl -s "http://localhost:8000/api/journal/psychology" -H "Cookie: ..." | python -m json.tool
```
Expected: `{"process_trend": [...], "emotion_by_week": [...], "emotion_outcomes": [...], "mistake_trend": [...]}` (arrays may be empty if no data).

- [ ] **Step 4: Commit**

```bash
git add api/routers/journal.py
git commit -m "feat: add GET /api/journal/psychology endpoint"
```

---

### Task 3: `journal_insights.py` — category/trend fields + 4 new functions

**Files:**
- Modify: `api/services/journal_insights.py`
- Test: `tests/test_journal_insights.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_journal_insights.py
"""Tests for new journal_insights functions — emotion outcome, process trend,
mistake recurrence, and discipline consistency."""
import pytest
from api.services import journal_insights


def _entry(entry_date="2026-04-01", pnl_pct=None, process_score=None,
           emotion_tags=None, mistake_tags=None):
    return {
        "entry_date": entry_date,
        "pnl_pct": pnl_pct,
        "process_score": process_score,
        "emotion_tags": emotion_tags or "",
        "mistake_tags": mistake_tags or "",
        "setup": "unknown",
        "playbook_id": None,
        "size_pct": None,
        "entry_time": "",
        "day_of_week": "Monday",
        "status": "closed",
    }


def test_emotion_outcome_insufficient_data():
    """Fewer than 5 entries per emotion → no insight appended."""
    entries = [_entry(emotion_tags="calm", pnl_pct=1.0) for _ in range(4)]
    insights = []
    journal_insights._insight_emotion_outcome(entries, insights)
    assert insights == []


def test_emotion_outcome_generates_when_significant():
    """≥5 entries per emotion with ≥1% avg gap → insight appended with psychology category."""
    entries = (
        [_entry(emotion_tags="calm", pnl_pct=2.0) for _ in range(5)] +
        [_entry(emotion_tags="anxious", pnl_pct=0.5) for _ in range(5)]
    )
    insights = []
    journal_insights._insight_emotion_outcome(entries, insights)
    assert len(insights) == 1
    assert insights[0]["category"] == "psychology"
    assert "calm" in insights[0]["statement"] or "anxious" in insights[0]["statement"]


def test_process_trend_improving():
    """Recent half with higher scores → trend='improving', category='process'."""
    older = [_entry(entry_date=f"2026-01-{i:02d}", process_score=50) for i in range(1, 8)]
    recent = [_entry(entry_date=f"2026-04-{i:02d}", process_score=75) for i in range(1, 8)]
    insights = []
    journal_insights._insight_process_trend(older + recent, insights)
    assert len(insights) == 1
    assert insights[0]["trend"] == "improving"
    assert insights[0]["category"] == "process"


def test_process_trend_stable_when_diff_small():
    """Diff < 5 points → no insight appended."""
    scored = [_entry(entry_date=f"2026-01-{i:02d}", process_score=60 + i % 3) for i in range(1, 15)]
    insights = []
    journal_insights._insight_process_trend(scored, insights)
    assert insights == []


def test_mistake_recurrence_detected():
    """Same mistake in all three thirds → insight with category='process'."""
    entries = (
        [_entry(entry_date=f"2026-01-{i:02d}", mistake_tags="FOMO") for i in range(1, 4)] +
        [_entry(entry_date=f"2026-02-{i:02d}", mistake_tags="FOMO") for i in range(1, 4)] +
        [_entry(entry_date=f"2026-03-{i:02d}", mistake_tags="FOMO") for i in range(1, 4)]
    )
    insights = []
    journal_insights._insight_mistake_recurrence(entries, insights)
    assert len(insights) == 1
    assert "FOMO" in insights[0]["statement"]
    assert insights[0]["category"] == "process"


def test_discipline_consistency_no_daily_data():
    """Empty daily_journals list → no insight appended."""
    insights = []
    journal_insights._insight_discipline_consistency([], [], insights)
    assert insights == []
```

- [ ] **Step 2: Run tests to verify they fail**

```
python -m pytest tests/test_journal_insights.py -v
```
Expected: `AttributeError` — new functions not yet defined.

- [ ] **Step 3: Update `api/services/journal_insights.py` — add category/trend to existing functions**

Open `api/services/journal_insights.py`. In each of the 8 existing `insights.append(...)` calls, add `"category"` and `"trend"` fields as shown below.

In `_insight_time_of_day` — find the append and add two fields:
```python
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
```

In `_insight_setup_comparison`:
```python
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
```

In `_insight_mistake_correlation`:
```python
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
```

In `_insight_size_clustering`:
```python
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
```

In `_insight_daily_count`:
```python
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
```

In `_insight_day_of_week`:
```python
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
```

In `_insight_playbook_performance`:
```python
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
```

In `_insight_streaks` (losing streak append):
```python
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
```

In `_insight_streaks` (winning streak append):
```python
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
```

- [ ] **Step 4: Add `get_insights` — fetch daily_journals and call 4 new functions**

Replace the existing `get_insights` function body (keep the signature and cache logic, just extend the inner block):

```python
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

        result = sorted(insights, key=lambda x: x["priority"])[:limit]
        _cache[user_id] = (now, result)
        return result
    finally:
        conn.close()
```

- [ ] **Step 5: Add the 4 new functions at the end of `api/services/journal_insights.py`**

```python
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
```

- [ ] **Step 6: Run all insight tests to verify they pass**

```
python -m pytest tests/test_journal_insights.py -v
```
Expected: 6 PASSED.

- [ ] **Step 7: Commit**

```bash
git add api/services/journal_insights.py tests/test_journal_insights.py
git commit -m "feat: add category/trend to all insights + 4 new psychology-focused insight functions"
```

---

### Task 4: `PsychologyTimeline.jsx` + CSS

**Files:**
- Create: `app/src/pages/journal/tabs/PsychologyTimeline.jsx`
- Create: `app/src/pages/journal/tabs/PsychologyTimeline.module.css`

- [ ] **Step 1: Create `PsychologyTimeline.module.css`**

```css
/* PsychologyTimeline.module.css */

.wrap {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-top: 4px;
}

.periodBar {
  display: flex;
  gap: 3px;
  margin-bottom: 16px;
}

.periodBtn {
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.8px;
  padding: 4px 10px;
  background: transparent;
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 3px;
  color: rgba(255,255,255,0.4);
  cursor: pointer;
  transition: all var(--duration-fast);
}

.periodBtn:hover {
  color: rgba(255,255,255,0.6);
  border-color: rgba(255,255,255,0.1);
}

.periodActive {
  color: var(--ut-gold);
  border-color: var(--ut-gold);
  background: var(--ut-gold-dim);
}

.panel {
  margin-bottom: 24px;
}

.panelHeader {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}

.panelTitle {
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 600;
  color: rgba(255,255,255,0.4);
  letter-spacing: 0.6px;
  text-transform: uppercase;
}

.emptyState {
  font-family: var(--font-sans);
  font-size: 12px;
  color: rgba(255,255,255,0.25);
  padding: 20px 0;
  text-align: center;
}

.loading {
  font-family: var(--font-sans);
  font-size: 12px;
  color: rgba(255,255,255,0.3);
  padding: 40px 0;
  text-align: center;
}
```

- [ ] **Step 2: Create `PsychologyTimeline.jsx`**

```jsx
// app/src/pages/journal/tabs/PsychologyTimeline.jsx
import { useState, useMemo } from 'react'
import useSWR from 'swr'
import ReactECharts from 'echarts-for-react'
import styles from './PsychologyTimeline.module.css'

const fetcher = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json() })

const PERIOD_OPTIONS = [
  { key: '30', label: '30D' },
  { key: '90', label: '90D' },
  { key: '180', label: '180D' },
  { key: '0', label: 'All' },
]

const EMOTION_COLORS = {
  calm: '#3cb868',
  anxious: '#f97316',
  confident: '#14b8a6',
  fearful: '#ef4444',
  disciplined: '#3b82f6',
  frustrated: '#c9a84c',
  euphoric: '#a855f7',
  focused: '#06b6d4',
  impulsive: '#f43f5e',
  patient: '#84cc16',
}

function getEmotionColor(emotion) {
  return EMOTION_COLORS[emotion?.toLowerCase()] || '#888'
}

const CHART_AXIS = {
  axisLine: { show: false },
  axisTick: { show: false },
  splitLine: { lineStyle: { color: '#2e312720' } },
}
const CHART_LABEL = { color: '#706b5e', fontFamily: 'Instrument Sans', fontSize: 9 }
const CHART_TOOLTIP = {
  backgroundColor: '#1a1c17',
  borderColor: '#2e3127',
  textStyle: { color: '#e0dac8', fontFamily: 'Instrument Sans', fontSize: 11 },
}

export default function PsychologyTimeline() {
  const [days, setDays] = useState('90')

  const { data, isLoading } = useSWR(
    `/api/journal/psychology?days=${days}`,
    fetcher,
    { refreshInterval: 300000, dedupingInterval: 300000, revalidateOnFocus: false }
  )

  const processTrend = data?.process_trend || []
  const emotionByWeek = data?.emotion_by_week || []
  const emotionOutcomes = data?.emotion_outcomes || []

  // Top 8 emotions by total count across all weeks
  const topEmotions = useMemo(() => {
    const totals = {}
    emotionByWeek.forEach(w => {
      Object.entries(w.emotions).forEach(([e, c]) => {
        totals[e] = (totals[e] || 0) + c
      })
    })
    return Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([e]) => e)
  }, [emotionByWeek])

  const qualifiedOutcomes = emotionOutcomes.filter(e => e.trade_count >= 3)

  // Panel 1: Process score trend line
  const processTrendOption = useMemo(() => {
    if (processTrend.length === 0) return null
    return {
      backgroundColor: 'transparent',
      grid: { top: 24, right: 20, bottom: 50, left: 46 },
      tooltip: {
        ...CHART_TOOLTIP,
        trigger: 'axis',
        formatter: (params) => {
          const p = params[0]
          if (!p) return ''
          const tc = processTrend[p.dataIndex]?.trade_count
          const col = p.value >= 70 ? '#3cb868' : p.value >= 30 ? '#c9a84c' : '#ef4444'
          return `<div style="font-size:10px;color:#706b5e;">${p.axisValue}</div>
            <div style="font-size:13px;color:${col};font-weight:700;">${p.value} / 100</div>
            ${tc != null ? `<div style="font-size:10px;color:#706b5e;">${tc} trade${tc !== 1 ? 's' : ''}</div>` : ''}`
        },
      },
      visualMap: {
        show: false,
        pieces: [
          { lte: 30, color: '#ef4444' },
          { gt: 30, lte: 70, color: '#c9a84c' },
          { gt: 70, color: '#3cb868' },
        ],
      },
      xAxis: {
        type: 'category',
        data: processTrend.map(p => p.date),
        axisLine: { lineStyle: { color: '#2e3127' } },
        axisTick: { show: false },
        axisLabel: { ...CHART_LABEL, rotate: 45 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0, max: 100,
        ...CHART_AXIS,
        axisLabel: { ...CHART_LABEL, fontSize: 10 },
      },
      series: [{
        type: 'line',
        data: processTrend.map(p => p.avg_process),
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { width: 2 },
        markLine: {
          silent: true,
          symbol: 'none',
          data: [
            { yAxis: 30, lineStyle: { color: '#ef444460', type: 'dashed' }, label: { formatter: '30', color: '#ef4444', fontSize: 9, position: 'end' } },
            { yAxis: 70, lineStyle: { color: '#3cb86860', type: 'dashed' }, label: { formatter: '70', color: '#3cb868', fontSize: 9, position: 'end' } },
          ],
        },
      }],
    }
  }, [processTrend])

  // Panel 2: Emotion by week stacked bar
  const emotionWeekOption = useMemo(() => {
    if (emotionByWeek.length === 0 || topEmotions.length === 0) return null
    return {
      backgroundColor: 'transparent',
      grid: { top: 14, right: 20, bottom: 60, left: 40 },
      tooltip: {
        ...CHART_TOOLTIP,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
      },
      legend: {
        data: topEmotions,
        textStyle: { ...CHART_LABEL },
        bottom: 0,
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
      },
      xAxis: {
        type: 'category',
        data: emotionByWeek.map(w => w.week),
        axisLine: { lineStyle: { color: '#2e3127' } },
        axisTick: { show: false },
        axisLabel: { ...CHART_LABEL, rotate: 45 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        ...CHART_AXIS,
        axisLabel: { ...CHART_LABEL, fontSize: 10 },
      },
      series: topEmotions.map(emotion => ({
        name: emotion,
        type: 'bar',
        stack: 'total',
        data: emotionByWeek.map(w => w.emotions[emotion] || 0),
        itemStyle: { color: getEmotionColor(emotion) },
      })),
    }
  }, [emotionByWeek, topEmotions])

  // Panel 3: Emotion vs outcome horizontal bar
  const emotionOutcomeOption = useMemo(() => {
    if (qualifiedOutcomes.length === 0) return null
    return {
      backgroundColor: 'transparent',
      grid: { top: 10, right: 60, bottom: 20, left: 90 },
      tooltip: {
        ...CHART_TOOLTIP,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params) => {
          const p = params[0]
          if (!p) return ''
          const d = qualifiedOutcomes.find(e => e.emotion === p.name)
          const col = p.value >= 0 ? '#3cb868' : '#ef4444'
          return `<div style="font-size:11px;font-weight:700;color:#e0dac8;">${p.name}</div>
            <div style="color:${col};font-size:12px;">${p.value >= 0 ? '+' : ''}${p.value}%</div>
            ${d ? `<div style="font-size:10px;color:#706b5e;">Win rate: ${d.win_rate}% · ${d.trade_count} trades</div>` : ''}`
        },
      },
      xAxis: {
        type: 'value',
        ...CHART_AXIS,
        axisLabel: { ...CHART_LABEL, fontSize: 10, formatter: v => `${v >= 0 ? '+' : ''}${v}%` },
      },
      yAxis: {
        type: 'category',
        data: qualifiedOutcomes.map(e => e.emotion),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#a8a290', fontFamily: 'Instrument Sans', fontSize: 11 },
      },
      series: [{
        type: 'bar',
        data: qualifiedOutcomes.map(e => ({
          value: e.avg_pnl,
          itemStyle: { color: e.avg_pnl >= 0 ? '#3cb868' : '#ef4444' },
        })),
      }],
    }
  }, [qualifiedOutcomes])

  if (isLoading && !data) {
    return <div className={styles.wrap}><div className={styles.loading}>Loading psychology data...</div></div>
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.periodBar}>
        {PERIOD_OPTIONS.map(p => (
          <button
            key={p.key}
            className={`${styles.periodBtn} ${days === p.key ? styles.periodActive : ''}`}
            onClick={() => setDays(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>Process Score Trend</span>
        </div>
        {processTrendOption
          ? <ReactECharts option={processTrendOption} style={{ height: 220 }} notMerge lazyUpdate />
          : <div className={styles.emptyState}>No scored trades in this period.</div>
        }
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>Emotional State by Week</span>
        </div>
        {emotionWeekOption
          ? <ReactECharts option={emotionWeekOption} style={{ height: 220 }} notMerge lazyUpdate />
          : <div className={styles.emptyState}>No emotion tags recorded yet.</div>
        }
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>Average P&L by Emotional State</span>
        </div>
        {emotionOutcomeOption
          ? <ReactECharts
              option={emotionOutcomeOption}
              style={{ height: Math.max(160, qualifiedOutcomes.length * 28 + 40) }}
              notMerge
              lazyUpdate
            />
          : <div className={styles.emptyState}>Need ≥3 trades per emotion to show outcomes.</div>
        }
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/pages/journal/tabs/PsychologyTimeline.jsx app/src/pages/journal/tabs/PsychologyTimeline.module.css
git commit -m "feat: add PsychologyTimeline component (3-panel ECharts: process trend, emotion/week, emotion outcomes)"
```

---

### Task 5: Wire Psychology dimension into `Analytics.jsx`

**Files:**
- Modify: `app/src/pages/journal/tabs/Analytics.jsx`

- [ ] **Step 1: Add the import at the top of `Analytics.jsx`**

After the existing imports (around line 6), add:

```javascript
import PsychologyTimeline from './PsychologyTimeline'
```

- [ ] **Step 2: Add `{ key: 'psychology', label: 'Psychology' }` to `DIMENSIONS`**

Current `DIMENSIONS` array (lines ~10-22):
```javascript
const DIMENSIONS = [
  { key: 'setup', label: 'Setup' },
  { key: 'symbol', label: 'Symbol' },
  { key: 'direction', label: 'Direction' },
  { key: 'day_of_week', label: 'Day of Week' },
  { key: 'session', label: 'Session' },
  { key: 'holding_period_bucket', label: 'Holding Period' },
  { key: 'process_score_bucket', label: 'Process Score' },
  { key: 'mistake_tag', label: 'Mistake' },
  { key: 'playbook', label: 'Playbook' },
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
]
```

Replace with:
```javascript
const DIMENSIONS = [
  { key: 'setup', label: 'Setup' },
  { key: 'symbol', label: 'Symbol' },
  { key: 'direction', label: 'Direction' },
  { key: 'day_of_week', label: 'Day of Week' },
  { key: 'session', label: 'Session' },
  { key: 'holding_period_bucket', label: 'Holding Period' },
  { key: 'process_score_bucket', label: 'Process Score' },
  { key: 'mistake_tag', label: 'Mistake' },
  { key: 'playbook', label: 'Playbook' },
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
  { key: 'psychology', label: 'Psychology' },
]
```

- [ ] **Step 3: Render `PsychologyTimeline` when `dimension === 'psychology'`**

In the JSX return block, find where the dimension chip bar and period selector end and the results area begins (around line 200, where it checks `buckets.length === 0` or renders the table). Before that conditional, add:

```jsx
      {/* Psychology timeline — replaces standard table when dimension === 'psychology' */}
      {dimension === 'psychology' && (
        <PsychologyTimeline />
      )}

      {/* Standard dimension results — hidden when Psychology selected */}
      {dimension !== 'psychology' && (
        <>
```

Then wrap the rest of the existing JSX content (totals strip, table, equity curve) inside the closing `</>` of that fragment. The closing `</div>` of the outer `.wrap` stays at the end:

```jsx
        </>
      )}
    </div>
  )
```

Effectively the structure becomes:
```jsx
  return (
    <div className={styles.wrap}>
      {/* Dimension chip bar */}
      <div className={styles.dimBar}>...</div>

      {/* Period selector */}
      <div className={styles.periodBar}>...</div>

      {/* Psychology timeline */}
      {dimension === 'psychology' && <PsychologyTimeline />}

      {/* Standard results */}
      {dimension !== 'psychology' && (
        <>
          {totals && <div className={styles.totalsStrip}>...</div>}
          {buckets.length === 0 ? (...) : (...)}
          {chartOption && (...)}
        </>
      )}
    </div>
  )
```

- [ ] **Step 4: Verify in browser**

Start dev server:
```
cd app && npm run dev
```
Navigate to Journal → Analytics tab. Click "Psychology" chip. Confirm 3 ECharts panels render (or empty states if no data). Confirm switching back to Setup shows the standard table.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal/tabs/Analytics.jsx
git commit -m "feat: wire Psychology dimension into Analytics tab → renders PsychologyTimeline"
```

---

### Task 6: `InsightCard` badge + trend arrow + `Overview` grouping

**Files:**
- Modify: `app/src/pages/journal/components/InsightCard.jsx`
- Modify: `app/src/pages/journal/components/InsightCard.module.css`
- Modify: `app/src/pages/journal/tabs/Overview.jsx`
- Modify: `app/src/pages/journal/tabs/Overview.module.css`

- [ ] **Step 1: Add styles to `InsightCard.module.css`**

Append to the end of `app/src/pages/journal/components/InsightCard.module.css`:

```css
/* ── Category badge ── */
.categoryBadge {
  flex-shrink: 0;
  font-family: var(--font-sans);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 3px;
  white-space: nowrap;
}

.categoryPerformance { background: rgba(59,130,246,0.15); color: #60a5fa; }
.categoryProcess     { background: rgba(201,168,76,0.15); color: #c9a84c; }
.categoryPsychology  { background: rgba(168,85,247,0.15); color: #c084fc; }
.categoryRisk        { background: rgba(239,68,68,0.15);  color: #f87171; }

/* ── Trend arrow ── */
.trendArrow {
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  margin-left: 6px;
}

.trendUp   { color: #3cb868; }
.trendDown { color: #ef4444; }
.trendStable { color: #706b5e; }
```

- [ ] **Step 2: Update `InsightCard.jsx`**

Replace the full contents of `app/src/pages/journal/components/InsightCard.jsx`:

```jsx
// app/src/pages/journal/components/InsightCard.jsx
import styles from './InsightCard.module.css'

const PRIORITY_COLORS = {
  5: '#c9a84c',
  4: '#3cb868',
  3: '#6ba3be',
  2: '#706b5e',
  1: '#4a4a4a',
}

const CATEGORY_CLASS = {
  performance: styles.categoryPerformance,
  process:     styles.categoryProcess,
  psychology:  styles.categoryPsychology,
  risk:        styles.categoryRisk,
}

function TrendArrow({ trend }) {
  if (!trend) return null
  if (trend === 'improving') return <span className={`${styles.trendArrow} ${styles.trendUp}`}>▲ Improving</span>
  if (trend === 'worsening') return <span className={`${styles.trendArrow} ${styles.trendDown}`}>▼ Worsening</span>
  return <span className={`${styles.trendArrow} ${styles.trendStable}`}>→ Stable</span>
}

export default function InsightCard({ insight, onAction }) {
  const accentColor = PRIORITY_COLORS[insight.priority] || PRIORITY_COLORS[3]
  const catClass = insight.category ? CATEGORY_CLASS[insight.category] : null

  return (
    <div className={styles.card} style={{ borderLeftColor: accentColor }}>
      <div className={styles.body}>
        <div className={styles.statement}>
          {insight.statement}
          <TrendArrow trend={insight.trend} />
        </div>
        <div className={styles.evidence}>{insight.evidence}</div>
      </div>
      {catClass && (
        <span className={`${styles.categoryBadge} ${catClass}`}>
          {insight.category}
        </span>
      )}
      {insight.action_label && onAction && (
        <button
          className={styles.actionBtn}
          onClick={() => onAction(insight)}
        >
          {insight.action_label} &rarr;
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Add `.insightGroupHeader` to `Overview.module.css`**

Append to the end of `app/src/pages/journal/tabs/Overview.module.css`:

```css
/* ── Insight category group header ── */
.insightGroupHeader {
  font-family: var(--font-sans);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: rgba(255,255,255,0.25);
  margin-top: 16px;
  margin-bottom: 8px;
}

.insightGroupHeader:first-child {
  margin-top: 0;
}
```

- [ ] **Step 4: Update `Overview.jsx` — request limit=12, group by category**

Find the SWR call for insights (around line 55):
```javascript
  const { data: insights } = useSWR(
    '/api/journal/insights',
    fetcher,
    { refreshInterval: 300000, dedupingInterval: 60000, revalidateOnFocus: false }
  )
```

Change the URL to request 12:
```javascript
  const { data: insights } = useSWR(
    '/api/journal/insights?limit=12',
    fetcher,
    { refreshInterval: 300000, dedupingInterval: 60000, revalidateOnFocus: false }
  )
```

Then find the insights section in the JSX (around line 185):
```jsx
      {/* Insights section */}
      {insights && insights.length > 0 && (
        <div className={styles.insightsSection}>
          <div className={styles.insightsLabel}>Insights</div>
          <div className={styles.insightsList}>
            {insights.slice(0, 5).map(insight => (
              <InsightCard
                key={insight.id}
                insight={insight}
                onAction={...}
              />
            ))}
          </div>
        </div>
      )}
```

Replace with (keep the existing `onAction` handler logic unchanged):
```jsx
      {/* Insights section — grouped by category */}
      {insights && insights.length > 0 && (
        <div className={styles.insightsSection}>
          <div className={styles.insightsLabel}>Insights</div>
          <div className={styles.insightsList}>
            {['performance', 'process', 'psychology', 'risk'].map(cat => {
              const group = insights.filter(ins => ins.category === cat)
              if (group.length === 0) return null
              return (
                <div key={cat}>
                  <div className={styles.insightGroupHeader}>{cat}</div>
                  {group.map(insight => (
                    <InsightCard
                      key={insight.id}
                      insight={insight}
                      onAction={(ins) => {
                        if (ins.action_type === 'filter') {
                          if (onSwitchTab) onSwitchTab('log')
                        } else if (ins.action_type === 'analytics') {
                          if (onSwitchTab) onSwitchTab('analytics')
                        } else if (ins.action_type === 'playbooks') {
                          if (onSwitchTab) onSwitchTab('playbooks')
                        } else if (ins.action_type === 'review') {
                          if (onSwitchTab) onSwitchTab('queue')
                        }
                      }}
                    />
                  ))}
                </div>
              )
            })}
            {/* Fallback: insights with no category (backwards compat) */}
            {insights.filter(ins => !ins.category).map(insight => (
              <InsightCard
                key={insight.id}
                insight={insight}
                onAction={(ins) => {
                  if (ins.action_type === 'filter') {
                    if (onSwitchTab) onSwitchTab('log')
                  } else if (ins.action_type === 'analytics') {
                    if (onSwitchTab) onSwitchTab('analytics')
                  } else if (ins.action_type === 'playbooks') {
                    if (onSwitchTab) onSwitchTab('playbooks')
                  } else if (ins.action_type === 'review') {
                    if (onSwitchTab) onSwitchTab('queue')
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}
```

- [ ] **Step 5: Verify in browser**

Reload Journal → Overview tab. Confirm:
- Insights appear grouped under section headers: "performance", "process", "psychology", "risk"
- Each InsightCard shows a category badge (blue/amber/purple/red pill)
- Insights with a non-null `trend` show the trend arrow next to the statement text

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/journal/components/InsightCard.jsx app/src/pages/journal/components/InsightCard.module.css app/src/pages/journal/tabs/Overview.jsx app/src/pages/journal/tabs/Overview.module.css
git commit -m "feat: InsightCard category badge + trend arrow; Overview groups insights by category"
```

---

### Task 7: Run all tests + deploy to Railway

**Files:** None (validation + deploy)

- [ ] **Step 1: Run the full test suite**

```
cd C:\Users\Patrick\uct-dashboard
python -m pytest tests/ -v
```
Expected: all tests PASS. There should be at least 10 tests for the new code (4 psychology + 6 insights).

- [ ] **Step 2: Push to Railway**

```bash
git push origin master
```
Expected: Railway build starts automatically. Monitor at Railway dashboard for green deployment.

- [ ] **Step 3: Smoke test on production**

1. Open `https://uctintelligence.com/journal`
2. Overview tab: confirm insights show with category badges and group headers
3. Analytics tab: click "Psychology" chip — confirm 3 panels render (or graceful empty states)
4. Check `GET https://uctintelligence.com/api/journal/psychology` returns valid JSON

---

## Self-Review

**Spec coverage:**
- ✅ `journal_psychology.py` — Task 1
- ✅ `/api/journal/psychology` route — Task 2
- ✅ 4 new insight functions + category/trend on all 8 existing — Task 3
- ✅ `PsychologyTimeline.jsx` with 3 ECharts panels — Task 4
- ✅ Analytics.jsx Psychology dimension — Task 5
- ✅ InsightCard category badge + trend arrow — Task 6
- ✅ Overview grouping by category + limit=12 — Task 6
- ✅ 4 psychology service tests — Task 1
- ✅ 6 insight function tests — Task 3

**Placeholder scan:** No TBD or TODO found. All steps have complete code.

**Type consistency:**
- `get_psychology_data` returns `dict` with keys `process_trend`, `emotion_by_week`, `emotion_outcomes`, `mistake_trend` — used in PsychologyTimeline as `data?.process_trend` etc. ✅
- `_insight_discipline_consistency` signature: `(entries, daily_journals, insights)` — called with same signature in `get_insights`. ✅
- `category` and `trend` fields added to all 12 insight appends. ✅
