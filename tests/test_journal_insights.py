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
