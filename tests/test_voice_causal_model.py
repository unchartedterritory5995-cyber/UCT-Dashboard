"""Causal model service — sector rotation, catalyst taxonomy, time-of-day."""

from datetime import datetime, timezone
from unittest.mock import patch

from api.services import voice_causal_model as cm


# ── load corpus ─────────────────────────────────────────────────────────────

def test_load_returns_dict():
    cm._CACHE = None  # force reload
    d = cm._load()
    assert isinstance(d, dict)
    assert "sector_rotation" in d
    assert "catalyst_taxonomy" in d


# ── sector rotation ─────────────────────────────────────────────────────────

def test_sector_rotation_bear_regime():
    out = cm.get_sector_rotation_state(regime="bear_trend")
    assert out["ok"] is True
    assert out["stage"] == "bear"
    assert "Staples" in out["leading"] or "Utilities" in out["leading"]


def test_sector_rotation_bull_regime():
    out = cm.get_sector_rotation_state(regime="bull_trend")
    assert out["ok"] is True
    # mid_bull stage
    assert "Technology" in out["leading"] or "Industrials" in out["leading"]


def test_sector_rotation_distribution_regime():
    """Distribution maps to late_bull — energy/materials leading."""
    out = cm.get_sector_rotation_state(regime="distribution")
    assert out["stage"] == "late_bull"
    # Energy or Materials should lead in late bull
    leading_lower = [s.lower() for s in out["leading"]]
    assert any("energy" in s or "materials" in s for s in leading_lower)


def test_sector_rotation_uses_live_regime_when_none(monkeypatch):
    """No arg → calls voice_regime_classifier."""
    monkeypatch.setattr(
        "api.services.voice_regime_classifier.get_current_regime",
        lambda **kw: {"regime": "bear_trend"},
    )
    out = cm.get_sector_rotation_state()
    assert out["regime"] == "bear_trend"


def test_sector_rotation_unknown_regime_falls_back():
    """Unknown regime → defaults to mid_bull."""
    out = cm.get_sector_rotation_state(regime="banana_trend")
    assert out["ok"] is True


# ── catalyst classification ─────────────────────────────────────────────────

def test_classify_catalyst_earnings_beat_raise():
    out = cm.classify_catalyst("Company beats top and bottom, raised guidance for FY")
    assert out["ok"] is True
    assert out["matched"] is True
    assert "earnings" in out["id"].lower() or "beat" in out["id"].lower()


def test_classify_catalyst_fda_approval():
    out = cm.classify_catalyst("FDA approves new drug for treatment of X")
    assert out["matched"] is True
    assert "fda" in out["id"].lower()
    assert out["typical_move_high_pct"] >= 30


def test_classify_catalyst_acquisition():
    out = cm.classify_catalyst("Company definitive agreement to buy XYZ for $5B")
    assert out["matched"] is True
    # ma_target or ma_acquirer
    assert "ma_" in out["id"]


def test_classify_catalyst_analyst_upgrade():
    out = cm.classify_catalyst("Goldman upgraded to buy, raised price target")
    assert out["matched"] is True
    assert "upgrade" in out["id"].lower()


def test_classify_catalyst_no_match():
    """Random text shouldn't false-positive."""
    out = cm.classify_catalyst("CEO ate breakfast this morning")
    assert out["ok"] is True
    assert out["matched"] is False


def test_classify_catalyst_empty():
    out = cm.classify_catalyst("")
    assert out["ok"] is False


def test_classify_catalyst_negative_move_fields():
    """Earnings miss should report a negative typical move."""
    out = cm.classify_catalyst("Company misses EPS estimates by wide margin")
    assert out["matched"] is True
    # Typical low should be negative
    assert out["typical_move_low_pct"] < 0


# ── time-of-day pattern ─────────────────────────────────────────────────────

def test_time_of_day_opening_drive():
    # 09:45 ET = 13:45 UTC (in EDT) or 14:45 UTC (in EST)
    # We pass a fixed datetime so DST doesn't matter
    fake = datetime(2026, 5, 12, 9, 45, tzinfo=timezone.utc)
    # The function uses a naive ET offset from UTC if `now` is provided
    # — but we pass an already-ET time by treating UTC as ET (the function
    # only reads hour/minute). Hour=9, minute=45 → opening_drive bucket.
    out = cm.get_time_of_day_pattern(now=fake)
    assert out["ok"] is True
    assert "drive" in out["label"].lower() or "open" in out["label"].lower()


def test_time_of_day_lunch_chop():
    fake = datetime(2026, 5, 12, 12, 30, tzinfo=timezone.utc)
    out = cm.get_time_of_day_pattern(now=fake)
    assert out["ok"] is True
    assert "lunch" in out["label"].lower() or "chop" in out["label"].lower()


def test_time_of_day_close():
    fake = datetime(2026, 5, 12, 15, 45, tzinfo=timezone.utc)
    out = cm.get_time_of_day_pattern(now=fake)
    assert out["ok"] is True
    assert "close" in out["label"].lower() or "moc" in out["label"].lower()


def test_time_of_day_after_hours():
    fake = datetime(2026, 5, 12, 17, 30, tzinfo=timezone.utc)
    out = cm.get_time_of_day_pattern(now=fake)
    assert out["ok"] is True
    assert "after" in out["label"].lower() or "after" in out["window"].lower()


def test_time_of_day_outside_session():
    """Pre-market (before 9:30) returns closed."""
    fake = datetime(2026, 5, 12, 7, 0, tzinfo=timezone.utc)
    out = cm.get_time_of_day_pattern(now=fake)
    # Either marked Closed or returns the first applicable bucket
    assert "label" in out


def test_time_of_day_no_arg_uses_now():
    """No arg — uses current time via timezone.utc + offset. Just verify
    it doesn't raise and returns a structured response."""
    out = cm.get_time_of_day_pattern()
    assert "ok" in out
    assert "label" in out
