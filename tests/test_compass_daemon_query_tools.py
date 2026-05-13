"""
Compass P4-E — daemon-query conversational tools.

Verifies whats_my_focus_today and what_compass_noticed tools work and
are wired into the Compass agent allowlist.
"""

import uuid
from unittest.mock import patch

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services.voice_proactive_service import add_insight
from api.services import voice_daily_focus as df
from api.services.voice_tool_impls import (
    _whats_my_focus_today, _what_compass_noticed,
)


def _user():
    init_db()
    return create_user(f"p4e_{uuid.uuid4()}@x.com", "p")["id"]


# ── whats_my_focus_today ────────────────────────────────────────────────────

def test_focus_returns_posted_when_available():
    uid = _user()
    with patch.object(df, "_regime_phrase", return_value="GREEN, exposure 95"), \
         patch.object(df, "_flagged_gappers", return_value=[]), \
         patch.object(df, "_earnings_on_watchlist", return_value=[]), \
         patch.object(df, "_active_interventions", return_value=[]):
        df.post_daily_focus(uid)
    out = _whats_my_focus_today(user={"id": uid})
    assert out["ok"] is True
    assert out["source"] == "posted"
    assert "GREEN" in out["body"]


def test_focus_composes_fresh_when_none_posted():
    uid = _user()
    with patch.object(df, "_regime_phrase", return_value="AMBER, mixed"), \
         patch.object(df, "_flagged_gappers", return_value=[]), \
         patch.object(df, "_earnings_on_watchlist", return_value=[]), \
         patch.object(df, "_active_interventions", return_value=[]):
        out = _whats_my_focus_today(user={"id": uid})
    assert out["ok"] is True
    assert out["source"] == "fresh"
    assert "AMBER" in out["body"]


def test_focus_returns_quiet_when_no_content():
    """No regime, no gappers, no earnings, no interventions → friendly message."""
    uid = _user()
    with patch.object(df, "_regime_phrase", return_value=""), \
         patch.object(df, "_flagged_gappers", return_value=[]), \
         patch.object(df, "_earnings_on_watchlist", return_value=[]), \
         patch.object(df, "_active_interventions", return_value=[]):
        out = _whats_my_focus_today(user={"id": uid})
    assert out["ok"] is True
    assert "Nothing notable" in out["narration"]


# ── what_compass_noticed ────────────────────────────────────────────────────

def test_noticed_empty_when_no_insights():
    uid = _user()
    out = _what_compass_noticed(user={"id": uid})
    assert out["ok"] is True
    assert out["count"] == 0
    assert out["insights"] == []


def test_noticed_returns_recent_insights():
    uid = _user()
    add_insight(uid, kind="regime_shift", headline="GREEN to AMBER",
                importance=9)
    add_insight(uid, kind="watchlist_alert", symbol="NVDA",
                headline="Gap up 5 percent", importance=8)
    out = _what_compass_noticed(user={"id": uid})
    assert out["ok"] is True
    assert out["count"] >= 2
    # Highest importance first → regime_shift (9) over watchlist_alert (8)
    assert out["insights"][0]["kind"] == "regime_shift"


def test_noticed_clamps_hours_param():
    uid = _user()
    # Out-of-range hours should clamp, not crash
    out = _what_compass_noticed(user={"id": uid}, hours=10000)
    assert out["ok"] is True
    out2 = _what_compass_noticed(user={"id": uid}, hours=0)
    assert out2["ok"] is True


# ── Wiring: registered in Compass allowlist ────────────────────────────────

def test_p4e_tools_in_compass_allowlist():
    """The new tools must be in Compass's allowlist."""
    # Ensure tool registration ran
    import api.services.voice_tool_impls  # noqa: F401
    from api.services.voice_agents import get_agent
    compass = get_agent("compass")
    assert compass is not None
    assert "whats_my_focus_today" in compass["tool_allowlist"]
    assert "what_compass_noticed" in compass["tool_allowlist"]


def test_p4e_tools_in_registry():
    """The tools must be registered in the global voice tool registry."""
    import api.services.voice_tool_impls  # noqa: F401
    from api.services.voice_tools import _REGISTRY
    assert "whats_my_focus_today" in _REGISTRY
    assert "what_compass_noticed" in _REGISTRY
