"""P5-L — Compass weekly digest tool tests."""

import uuid
from unittest.mock import patch

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services.voice_proactive_service import add_insight
from api.services.voice_tool_impls import _what_compass_did_this_week


def _user():
    init_db()
    return create_user(f"wkd_{uuid.uuid4()}@x.com", "p")["id"]


def test_empty_returns_friendly_message():
    uid = _user()
    out = _what_compass_did_this_week(user={"id": uid})
    assert out["ok"] is True
    assert out["total_outputs"] == 0
    assert "Nothing from Compass" in out["narration"]


def test_counts_insights_by_kind():
    uid = _user()
    add_insight(uid, kind="regime_shift", headline="Phase A", importance=8)
    add_insight(uid, kind="regime_shift", headline="Phase B", importance=8)
    add_insight(uid, kind="watchlist_alert", symbol="NVDA",
                headline="NVDA breakout", importance=7)
    out = _what_compass_did_this_week(user={"id": uid})
    assert out["total_outputs"] >= 3
    assert out["insights_by_kind"]["regime_shift"] == 2
    assert out["insights_by_kind"]["watchlist_alert"] == 1


def test_high_importance_count():
    uid = _user()
    add_insight(uid, kind="drift_warning", headline="High", importance=9)
    add_insight(uid, kind="scanner_match", symbol="ABC",
                headline="Medium", importance=5)
    out = _what_compass_did_this_week(user={"id": uid})
    assert out["high_importance_insights"] >= 1


def test_daily_focus_separately_tracked():
    uid = _user()
    add_insight(uid, kind="daily_focus", headline="Focus today", importance=7)
    add_insight(uid, kind="daily_focus", headline="Focus yesterday", importance=7)
    out = _what_compass_did_this_week(user={"id": uid})
    assert out["daily_focus_count"] == 2


def test_narration_includes_total_and_breakdown():
    uid = _user()
    add_insight(uid, kind="regime_shift", headline="r1", importance=8)
    add_insight(uid, kind="daily_focus", headline="f1", importance=7)
    out = _what_compass_did_this_week(user={"id": uid})
    n = out["narration"]
    assert "Compass produced" in n
    assert "regime shift" in n.lower() or "insight" in n.lower()


def test_days_param_clamps():
    uid = _user()
    # Out-of-range should clamp, not crash
    out1 = _what_compass_did_this_week(user={"id": uid}, days=10000)
    assert out1["days"] <= 90
    out2 = _what_compass_did_this_week(user={"id": uid}, days=0)
    assert out2["days"] >= 1


def test_tool_in_compass_allowlist():
    import api.services.voice_tool_impls  # noqa: F401
    from api.services.voice_tools import _REGISTRY
    from api.services.voice_agents import get_agent
    assert "what_compass_did_this_week" in _REGISTRY
    compass = get_agent("compass")
    assert "what_compass_did_this_week" in compass["tool_allowlist"]
