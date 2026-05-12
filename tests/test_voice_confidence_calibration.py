"""Confidence calibration — rules + signals + caveats."""

import uuid
from unittest.mock import patch

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services import voice_confidence_calibration as vcc


def _user():
    init_db()
    return create_user(f"vcc_{uuid.uuid4()}@x.com", "p")["id"]


# ── Rules block always present ──────────────────────────────────────────────

def test_block_always_includes_rules():
    uid = _user()
    block = vcc.build_confidence_block(uid)
    assert "CONFIDENCE CALIBRATION" in block
    assert "%" in block  # the rules mention percentages


# ── Per-signal caveats ──────────────────────────────────────────────────────

def test_stale_data_signal_triggers_caveat():
    uid = _user()
    with patch("api.services.voice_temporal_awareness._data_freshness",
                return_value={"is_fresh": False, "label": "5 days old"}):
        snapshot = vcc._signal_snapshot(uid)
    assert snapshot["stale_data"] is True
    assert "5 days" in snapshot["stale_data_label"]


def test_low_confidence_regime_signal():
    uid = _user()
    with patch("api.services.voice_regime_classifier.get_current_regime",
                return_value={"regime": "chop", "confidence": 0.20}):
        snapshot = vcc._signal_snapshot(uid)
    assert snapshot["regime_low_confidence"] is True


def test_high_confidence_regime_no_signal():
    uid = _user()
    with patch("api.services.voice_regime_classifier.get_current_regime",
                return_value={"regime": "bull_trend", "confidence": 0.65}):
        snapshot = vcc._signal_snapshot(uid)
    assert snapshot["regime_low_confidence"] is False


def test_drift_signal_when_pending_warnings():
    uid = _user()
    fake_pending = [
        {"kind": "drift_warning", "headline": "win rate down"},
        {"kind": "scanner_match", "headline": "x"},
        {"kind": "drift_warning", "headline": "size creep"},
    ]
    with patch("api.services.voice_proactive_service.list_pending_insights",
                return_value=fake_pending):
        snapshot = vcc._signal_snapshot(uid)
    assert snapshot["active_drift"] is True
    assert snapshot["drift_count"] == 2


def test_recent_negative_feedback_signal():
    uid = _user()
    fake_scoreboard = [
        {"variant_id": "v1", "thumbs_up": 2, "thumbs_down": 8,
         "total_sessions": 10},
    ]
    with patch("api.services.voice_reward_model.variant_scoreboard",
                return_value=fake_scoreboard):
        snapshot = vcc._signal_snapshot(uid)
    assert snapshot["recent_negative_feedback"] is True
    assert snapshot["recent_thumbs_ratio"] == 0.2


def test_positive_feedback_no_signal():
    uid = _user()
    fake_scoreboard = [
        {"variant_id": "v1", "thumbs_up": 8, "thumbs_down": 2,
         "total_sessions": 10},
    ]
    with patch("api.services.voice_reward_model.variant_scoreboard",
                return_value=fake_scoreboard):
        snapshot = vcc._signal_snapshot(uid)
    assert snapshot["recent_negative_feedback"] is False


def test_low_feedback_volume_no_signal():
    """<5 total feedback shouldn't trigger negative signal regardless of ratio."""
    uid = _user()
    fake_scoreboard = [
        {"variant_id": "v1", "thumbs_up": 0, "thumbs_down": 3},
    ]
    with patch("api.services.voice_reward_model.variant_scoreboard",
                return_value=fake_scoreboard):
        snapshot = vcc._signal_snapshot(uid)
    assert snapshot["recent_negative_feedback"] is False


# ── Block composition ──────────────────────────────────────────────────────

def test_block_includes_caveats_when_signals_present():
    uid = _user()
    with patch.object(vcc, "_signal_snapshot",
                       return_value={
                           "stale_data": True,
                           "stale_data_label": "3 days old",
                           "regime_low_confidence": False,
                           "active_drift": True,
                           "drift_count": 2,
                           "recent_negative_feedback": False,
                       }):
        block = vcc.build_confidence_block(uid)
    assert "CURRENT-SESSION CAVEATS" in block
    assert "stale" in block.lower()
    assert "drift" in block.lower()


def test_block_omits_caveats_when_clean():
    uid = _user()
    with patch.object(vcc, "_signal_snapshot",
                       return_value={
                           "stale_data": False,
                           "regime_low_confidence": False,
                           "active_drift": False,
                           "recent_negative_feedback": False,
                       }):
        block = vcc.build_confidence_block(uid)
    assert "CURRENT-SESSION CAVEATS" not in block
    # Rules still present
    assert "CONFIDENCE CALIBRATION" in block
