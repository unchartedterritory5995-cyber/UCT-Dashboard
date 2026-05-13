"""
Compass P4-D — daily focus message tests.

Verifies that compose_daily_focus assembles a useful message and that
post_daily_focus is idempotent per (user, date).
"""

import uuid
from unittest.mock import patch

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services import voice_daily_focus as df
from api.services.voice_proactive_service import list_history


def _user():
    init_db()
    return create_user(f"daily_{uuid.uuid4()}@x.com", "p")["id"]


# ── compose_daily_focus ────────────────────────────────────────────────────

def test_compose_returns_none_when_no_content():
    uid = _user()
    # No mocks → flagged empty, no earnings, no interventions, regime likely
    # empty in test env (no live wire data).
    with patch.object(df, "_regime_phrase", return_value=""), \
         patch.object(df, "_flagged_gappers", return_value=[]), \
         patch.object(df, "_earnings_on_watchlist", return_value=[]), \
         patch.object(df, "_active_interventions", return_value=[]):
        out = df.compose_daily_focus(uid)
    assert out is None


def test_compose_with_regime_only():
    uid = _user()
    with patch.object(df, "_regime_phrase", return_value="AMBER, exposure 55"), \
         patch.object(df, "_flagged_gappers", return_value=[]), \
         patch.object(df, "_earnings_on_watchlist", return_value=[]), \
         patch.object(df, "_active_interventions", return_value=[]):
        out = df.compose_daily_focus(uid)
    assert out is not None
    assert "AMBER" in out["body"]
    assert out["headline"] == "Today's focus"


def test_compose_includes_gappers():
    uid = _user()
    with patch.object(df, "_regime_phrase", return_value="GREEN"), \
         patch.object(df, "_flagged_gappers", return_value=[
             {"sym": "NVDA", "pct": "+5.2%"},
             {"sym": "AAPL", "pct": "-3.1%"},
         ]), \
         patch.object(df, "_earnings_on_watchlist", return_value=[]), \
         patch.object(df, "_active_interventions", return_value=[]):
        out = df.compose_daily_focus(uid)
    assert "NVDA" in out["body"]
    assert "5.2%" in out["body"]
    assert "AAPL" in out["body"]


def test_compose_includes_earnings():
    uid = _user()
    with patch.object(df, "_regime_phrase", return_value="GREEN"), \
         patch.object(df, "_flagged_gappers", return_value=[]), \
         patch.object(df, "_earnings_on_watchlist",
                       return_value=["TSLA", "NVDA"]), \
         patch.object(df, "_active_interventions", return_value=[]):
        out = df.compose_daily_focus(uid)
    assert "TSLA" in out["body"]
    assert "NVDA" in out["body"]
    assert "Earnings" in out["body"]


def test_compose_intervention_surfaces_first():
    """Active intervention takes priority over everything else."""
    uid = _user()
    with patch.object(df, "_regime_phrase", return_value="AMBER"), \
         patch.object(df, "_flagged_gappers",
                       return_value=[{"sym": "NVDA", "pct": "+5%"}]), \
         patch.object(df, "_earnings_on_watchlist", return_value=["AAPL"]), \
         patch.object(df, "_active_interventions",
                       return_value=["cooling_off_active"]):
        out = df.compose_daily_focus(uid)
    # The intervention sentence should be FIRST in the body
    body = out["body"]
    intervention_idx = body.lower().find("intervention")
    regime_idx = body.find("AMBER")
    assert intervention_idx >= 0
    assert intervention_idx < regime_idx
    assert "cooling_off_active" in body


# ── post_daily_focus + idempotency ────────────────────────────────────────

def test_post_creates_insight():
    uid = _user()
    with patch.object(df, "_regime_phrase", return_value="GREEN, healthy"), \
         patch.object(df, "_flagged_gappers", return_value=[]), \
         patch.object(df, "_earnings_on_watchlist", return_value=[]), \
         patch.object(df, "_active_interventions", return_value=[]):
        iid = df.post_daily_focus(uid)
    assert iid is not None
    # Insight is now in history
    hist = list_history(uid, limit=10)
    assert any(h["kind"] == "daily_focus" for h in hist)


def test_post_is_idempotent_per_day():
    """Second call on same day returns None (idempotency guard)."""
    uid = _user()
    with patch.object(df, "_regime_phrase", return_value="GREEN"), \
         patch.object(df, "_flagged_gappers", return_value=[]), \
         patch.object(df, "_earnings_on_watchlist", return_value=[]), \
         patch.object(df, "_active_interventions", return_value=[]):
        first = df.post_daily_focus(uid)
        second = df.post_daily_focus(uid)
    assert first is not None
    assert second is None


def test_post_force_bypasses_idempotency():
    uid = _user()
    with patch.object(df, "_regime_phrase", return_value="GREEN"), \
         patch.object(df, "_flagged_gappers", return_value=[]), \
         patch.object(df, "_earnings_on_watchlist", return_value=[]), \
         patch.object(df, "_active_interventions", return_value=[]):
        first = df.post_daily_focus(uid)
        forced = df.post_daily_focus(uid, force=True)
    assert first is not None
    assert forced is not None
    assert first != forced


def test_post_skips_when_no_content():
    """No regime + no gappers + no earnings + no interventions → no post."""
    uid = _user()
    with patch.object(df, "_regime_phrase", return_value=""), \
         patch.object(df, "_flagged_gappers", return_value=[]), \
         patch.object(df, "_earnings_on_watchlist", return_value=[]), \
         patch.object(df, "_active_interventions", return_value=[]):
        iid = df.post_daily_focus(uid)
    assert iid is None


# ── Importance is high enough to trigger speak ────────────────────────────

def test_focus_importance_is_speakable():
    """The focus message MUST be at importance ≥ 7 so it cascades through
    proactive_speak when the user has it ON."""
    assert df._FOCUS_IMPORTANCE >= 7
