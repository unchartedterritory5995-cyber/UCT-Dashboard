# Process Scorecard Enhancements — Psychology Timeline + Coaching Feed

**Date:** 2026-05-04  
**Status:** Approved  

---

## Goal

Add a psychology timeline to the Analytics tab and upgrade the coaching feed on the Overview tab — both drawing on existing process scores (5 dimensions × 0–20), emotion tags (15 options), mistake tags (17 types), and discipline scores stored in `journal_entries` and `daily_journals`.

---

## Architecture

**Two additions, shared backend data:**

1. **Psychology Timeline** — a new "Psychology" dimension in the Analytics tab. When selected it replaces the standard dimension chart with a multi-panel psychology view: process score trend, emotion frequency by week, and an emotion → P&L outcome matrix.

2. **Enhanced Coaching Feed** — upgrade the existing 8-insight panel on the Overview tab. Add 4 psychology-focused insight functions, add `category` and `trend` fields to all insights, group by category in the UI, and add trend arrows to `InsightCard`.

No new pages or routes beyond a single new API endpoint. All fits within existing tab structure.

---

## Backend

### New: `api/services/journal_psychology.py`

Single-responsibility module. One public function:

```python
def get_psychology_data(user_id: str, days: int = 90) -> dict
```

Returns:
```json
{
  "process_trend": [
    { "date": "2026-04-01", "avg_process": 72.4, "trade_count": 3 }
  ],
  "emotion_by_week": [
    { "week": "2026-W13", "emotions": { "calm": 4, "anxious": 2, "confident": 3 } }
  ],
  "emotion_outcomes": [
    { "emotion": "calm", "avg_pnl": 1.8, "trade_count": 12, "win_rate": 66.7 },
    { "emotion": "anxious", "avg_pnl": -0.4, "trade_count": 8, "win_rate": 37.5 }
  ],
  "mistake_trend": [
    { "week": "2026-W13", "mistake_count": 5, "top_mistake": "FOMO" }
  ]
}
```

Logic:
- `process_trend`: group `journal_entries` by `entry_date`, average `process_score` per day (skip null)
- `emotion_by_week`: parse `emotion_tags` CSV per entry, bucket by ISO week, count per emotion
- `emotion_outcomes`: for each distinct emotion tag, compute avg `pnl_pct` and win rate across entries that contain it
- `mistake_trend`: parse `mistake_tags` CSV per entry, bucket by ISO week, count total and find most common
- Filtered to `entry_date >= today - days` and `status = 'closed'`
- 10-minute in-memory cache per `(user_id, days)` key

### New route in `api/routers/journal.py`

```python
from api.services import journal_psychology as psych_svc

@router.get("/api/journal/psychology")
def get_psychology_data_route(days: int = 90, user=Depends(require_auth)):
    return psych_svc.get_psychology_data(user["id"], days)
```

### Updated: `api/services/journal_insights.py`

Add 4 new insight functions. Each insight gets two new fields:
- `category`: `"performance"` | `"process"` | `"psychology"` | `"risk"`
- `trend`: `"improving"` | `"worsening"` | `"stable"` | `null`

All 8 existing functions get `category` + `trend` patched in (no behavior change):
- time_of_day → `"performance"`, trend null
- setup_comparison → `"performance"`, trend null
- mistake_correlation → `"process"`, trend null
- size_clustering → `"risk"`, trend null
- daily_count → `"risk"`, trend null
- day_of_week → `"performance"`, trend null
- playbook_performance → `"process"`, trend null
- streak_detection → `"psychology"`, trend null

**New function 1: `_insight_emotion_outcome`** (`category: "psychology"`)
- For each emotion that appears in ≥5 entries, compare avg pnl_pct
- If best emotion avg and worst emotion avg differ by ≥1.0%:
  - Statement: "You average +X% when {best_emotion} vs {worst_avg}% when {worst_emotion}."
  - Evidence: "{N} trades tagged each."
  - trend: null

**New function 2: `_insight_process_trend`** (`category: "process"`)
- Split entries into two halves by date (older half vs recent half)
- If both halves have ≥5 scored entries:
  - Compute avg process score per half
  - If |diff| ≥ 5 points:
    - trend: "improving" if recent > older, "worsening" if recent < older
    - Statement: "Your process score is trending {up/down}: {older_avg:.0f} → {recent_avg:.0f} avg."
    - Evidence: "Based on last {total} scored trades."

**New function 3: `_insight_discipline_consistency`** (`category: "psychology"`)
- From `daily_journals`, read `discipline_score` for last 30 days
- If ≥10 days with discipline scores:
  - Compute % of days above 70 ("high discipline")
  - Avg pnl_pct on high-discipline days vs low-discipline days
  - If high-discipline avg P&L > low-discipline avg P&L by ≥0.5%:
    - Statement: "High-discipline days ({pct}% of sessions) average {high_avg:+.1f}% vs {low_avg:+.1f}%."
    - Evidence: "Based on {n} daily discipline scores."
    - trend: "improving" if recent 10 days avg > prior 10 days avg, else "stable"

**New function 4: `_insight_mistake_recurrence`** (`category: "process"`)
- Split entries into thirds by date
- For each mistake that appears in first third, check if it appears in last third
- If a mistake appears in all three thirds with count ≥ 2 each:
  - Statement: "'{mistake}' is a recurring pattern — it appeared in all three periods reviewed."
  - Evidence: "Consider adding a checklist rule to address this before entry."
  - trend: "worsening" if last-third count > first-third count, else "stable"

Limit raised from 8 to 12 to accommodate new psychology insights. The existing route `GET /api/journal/insights?limit=8` default stays at 8 for backwards compatibility; Overview.jsx explicitly passes `?limit=12`.

---

## Frontend

### `app/src/pages/journal/tabs/Analytics.jsx`

Add `{ key: 'psychology', label: 'Psychology' }` to `DIMENSIONS`.

When `dimension === 'psychology'`, render `<PsychologyTimeline days={periodDays || 90} />` instead of the existing bucketed bar chart.

`PsychologyTimeline` is a new component in `app/src/pages/journal/tabs/PsychologyTimeline.jsx`:
- SWR fetch `GET /api/journal/psychology?days={days}` (5-min dedup)
- Three ECharts panels stacked vertically:

**Panel 1 — Process Score Trend** (line chart):
- X: date, Y: avg_process (0–100)
- Reference lines at 30 (red dashed) and 70 (green dashed)
- Color: green if value ≥70, amber if ≥30, red otherwise — use a `visualMap` piecewise config
- Shows trade_count as tooltip secondary info

**Panel 2 — Emotion by Week** (stacked bar):
- X: week label, Y: count
- Each emotion is a color-coded series (up to 8 most frequent emotions shown)
- Palette: calm=green, anxious=orange, confident=teal, fearful=red, disciplined=blue, frustrated=amber, euphoric=purple, focused=cyan, impulsive=coral, patient=sage — others=#888

**Panel 3 — Emotion vs Outcome** (horizontal bar chart):
- X: avg pnl_pct, Y: emotion label
- Bars colored green (positive) / red (negative)
- Sorted by avg_pnl descending
- Only emotions with ≥3 trades shown
- Tooltip includes win_rate and trade_count

Each panel has a section header. `PsychologyTimeline` maintains its own `days` state (default 90) with period tab buttons (30 / 90 / 180 / All) at the top — independent of the parent Analytics period selector so switching to Psychology doesn't alter other dimension views.

### `app/src/pages/journal/tabs/PsychologyTimeline.module.css`

Styles for the three-panel layout: `.wrap`, `.panel`, `.panelHeader`, `.panelTitle`, `.chart`, `.emptyState`.

### `app/src/pages/journal/components/InsightCard.jsx`

Add two new visual elements:
- **Category badge**: small pill top-right. Colors: performance=blue, process=amber, psychology=purple, risk=red.
- **Trend arrow**: next to the statement, only when `insight.trend` is not null. `▲ Improving` in green, `▼ Worsening` in red, `→ Stable` in muted.

No layout changes — badge floats top-right within the existing card.

### `app/src/pages/journal/components/InsightCard.module.css`

Add: `.categoryBadge`, `.categoryPerformance`, `.categoryProcess`, `.categoryPsychology`, `.categoryRisk`, `.trendArrow`, `.trendUp`, `.trendDown`, `.trendStable`.

### `app/src/pages/journal/tabs/Overview.jsx`

Group insights by category before rendering. Order: Performance → Process → Psychology → Risk.

Render a small section header (`.insightGroupHeader`) before each group that has ≥1 insight.

No structural layout changes — same vertical list, just with group headers between cards.

### `app/src/pages/journal/tabs/Overview.module.css`

Add `.insightGroupHeader` — small caps, muted color, 8px bottom margin, 16px top margin.

---

## Data Flow

```
journal_entries (process_score, emotion_tags, pnl_pct, entry_date)
daily_journals  (discipline_score, entry_date)
        ↓
journal_psychology.py.get_psychology_data()
        ↓
GET /api/journal/psychology
        ↓
PsychologyTimeline.jsx (Analytics tab, Psychology dimension)

journal_entries (same fields)
daily_journals  (discipline_score)
        ↓
journal_insights.py (12 insights, with category + trend)
        ↓
GET /api/journal/insights
        ↓
Overview.jsx (grouped by category, InsightCard with badge + trend)
```

---

## Error Handling

- `get_psychology_data` returns empty arrays for each field when no qualifying data exists
- `PsychologyTimeline` renders a `.emptyState` message per panel when data is empty (e.g., "No emotion tags recorded yet")
- New insight functions return nothing (no append) when data threshold not met — safe at any data volume
- All existing behavior unchanged when `category`/`trend` fields are absent (InsightCard null-guards both)

---

## Testing

- `tests/test_journal_insights.py` — test all 4 new insight functions with synthetic `entries` lists:
  - `test_emotion_outcome_insufficient_data` — fewer than 5 per emotion → no insight
  - `test_emotion_outcome_generates_when_significant` — ≥5 entries, ≥1% gap → insight appended
  - `test_process_trend_improving` — recent half score higher → trend = "improving"
  - `test_process_trend_stable` — diff < 5 → no insight
  - `test_mistake_recurrence_detected` — same mistake in all three thirds → insight appended
  - `test_discipline_consistency_no_daily_data` — no daily_journals rows → no insight
- `tests/test_journal_psychology.py` — test `get_psychology_data`:
  - `test_process_trend_groups_by_date` — two entries same date → averaged into one row
  - `test_emotion_by_week_parses_csv` — "calm,anxious" entry → both counted in same week
  - `test_emotion_outcomes_win_rate` — 2 wins, 1 loss for emotion → 66.7% win rate
  - `test_empty_when_no_entries` — empty DB → all arrays empty, no crash

---

## File Map

| File | Change |
|------|--------|
| `api/services/journal_psychology.py` | **Create** — psychology data aggregation |
| `api/services/journal_insights.py` | **Modify** — 4 new functions, category+trend fields, limit 12 |
| `api/routers/journal.py` | **Modify** — add GET /api/journal/psychology |
| `app/src/pages/journal/tabs/PsychologyTimeline.jsx` | **Create** — 3-panel ECharts component |
| `app/src/pages/journal/tabs/PsychologyTimeline.module.css` | **Create** — panel layout styles |
| `app/src/pages/journal/tabs/Analytics.jsx` | **Modify** — add Psychology dimension, render PsychologyTimeline |
| `app/src/pages/journal/components/InsightCard.jsx` | **Modify** — category badge + trend arrow |
| `app/src/pages/journal/components/InsightCard.module.css` | **Modify** — badge + trend styles |
| `app/src/pages/journal/tabs/Overview.jsx` | **Modify** — group insights by category |
| `app/src/pages/journal/tabs/Overview.module.css` | **Modify** — insightGroupHeader style |
| `tests/test_journal_insights.py` | **Create** — 6 insight tests |
| `tests/test_journal_psychology.py` | **Create** — 4 psychology data tests |
