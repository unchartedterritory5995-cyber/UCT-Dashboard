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
