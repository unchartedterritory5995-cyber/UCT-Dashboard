"""Voice-driven settings writes — voice/speed/enabled changes."""

import uuid
import pytest

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services import voice_settings_tools as vst
from api.services.voice_settings_service import get_voice_settings


def _user():
    init_db()
    return create_user(f"vst_{uuid.uuid4()}@example.com", "p")["id"]


# ── change_voice_setting ───────────────────────────────────────────────────

def test_change_voice_to_known_voice():
    uid = _user()
    out = vst.change_voice_setting(field="voice", value="alloy", user_id=uid)
    assert out["ok"] is True
    assert get_voice_settings(uid)["voice"] == "alloy"


def test_change_voice_via_alias():
    uid = _user()
    out = vst.change_voice_setting(field="voice", value="female", user_id=uid)
    assert out["ok"] is True
    assert get_voice_settings(uid)["voice"] == "shimmer"


def test_change_voice_unknown():
    uid = _user()
    out = vst.change_voice_setting(field="voice", value="darth_vader", user_id=uid)
    assert out["ok"] is False


def test_change_speed_numeric():
    uid = _user()
    out = vst.change_voice_setting(field="speed", value=1.25, user_id=uid)
    assert out["ok"] is True
    assert get_voice_settings(uid)["speed"] == 1.25


def test_change_speed_named():
    uid = _user()
    out = vst.change_voice_setting(field="speed", value="faster", user_id=uid)
    assert out["ok"] is True
    assert get_voice_settings(uid)["speed"] == 1.25


def test_change_speed_string_number():
    uid = _user()
    out = vst.change_voice_setting(field="speed", value="0.8", user_id=uid)
    assert out["ok"] is True
    assert get_voice_settings(uid)["speed"] == 0.8


def test_change_speed_out_of_range():
    uid = _user()
    out = vst.change_voice_setting(field="speed", value=99, user_id=uid)
    assert out["ok"] is False


def test_change_speed_garbage():
    uid = _user()
    out = vst.change_voice_setting(field="speed", value="sometime", user_id=uid)
    assert out["ok"] is False


def test_change_enabled_truthy_strings():
    uid = _user()
    for v in ("yes", "true", "on", "enable"):
        out = vst.change_voice_setting(field="enabled", value=v, user_id=uid)
        assert out["ok"] is True
        assert get_voice_settings(uid)["enabled"] is True


def test_change_enabled_falsy():
    uid = _user()
    out = vst.change_voice_setting(field="enabled", value="no", user_id=uid)
    assert out["ok"] is True
    assert get_voice_settings(uid)["enabled"] is False


def test_change_unknown_field():
    uid = _user()
    out = vst.change_voice_setting(field="hairstyle", value="curly", user_id=uid)
    assert out["ok"] is False


def test_list_voice_settings():
    uid = _user()
    out = vst.list_voice_settings(user_id=uid)
    assert out["ok"] is True
    assert "voice" in out["narration"].lower()
    assert "speed" in out["narration"].lower()
