"""Voice settings service — get/upsert per-user voice preferences."""

import pytest
from api.services.auth_db import init_db, get_connection
from api.services.auth_service import create_user
from api.services.voice_settings_service import (
    get_voice_settings,
    update_voice_settings,
    ALLOWED_VOICES,
)


def _make_user():
    init_db()
    user = create_user(f"voicetest_{__import__('uuid').uuid4()}@example.com", "password123", "Test")
    return user["id"]


def test_get_returns_defaults_for_new_user():
    uid = _make_user()
    s = get_voice_settings(uid)
    assert s["enabled"] is True
    assert s["voice"] == "verse"
    assert s["speed"] == 1.0
    assert s["retention_days"] == 30


def test_update_persists_changes():
    uid = _make_user()
    update_voice_settings(uid, voice="ash", speed=1.25, enabled=False)
    s = get_voice_settings(uid)
    assert s["voice"] == "ash"
    assert s["speed"] == 1.25
    assert s["enabled"] is False


def test_update_rejects_unknown_voice():
    uid = _make_user()
    with pytest.raises(ValueError, match="voice"):
        update_voice_settings(uid, voice="not-a-real-voice")


def test_update_rejects_speed_out_of_range():
    uid = _make_user()
    with pytest.raises(ValueError, match="speed"):
        update_voice_settings(uid, speed=3.0)
    with pytest.raises(ValueError, match="speed"):
        update_voice_settings(uid, speed=0.1)


def test_allowed_voices_includes_verse():
    assert "verse" in ALLOWED_VOICES
    assert "alloy" in ALLOWED_VOICES


# ── P3-C unification: proactive_speak field ────────────────────────────────

def test_proactive_speak_defaults_to_false_for_new_user():
    uid = _make_user()
    s = get_voice_settings(uid)
    assert s["proactive_speak"] is False


def test_update_proactive_speak_roundtrip():
    uid = _make_user()
    update_voice_settings(uid, proactive_speak=True)
    assert get_voice_settings(uid)["proactive_speak"] is True
    update_voice_settings(uid, proactive_speak=False)
    assert get_voice_settings(uid)["proactive_speak"] is False


def test_update_proactive_speak_partial_doesnt_clobber():
    """Updating other fields shouldn't reset proactive_speak."""
    uid = _make_user()
    update_voice_settings(uid, proactive_speak=True)
    update_voice_settings(uid, voice="alloy")  # no proactive arg
    s = get_voice_settings(uid)
    assert s["proactive_speak"] is True
    assert s["voice"] == "alloy"
