"""Voice write tools — preview + confirm for 5 journal write actions."""

import pytest
from unittest.mock import patch
from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services import voice_write_tools as vwt
from api.services.voice_action_signer import verify_action


def _user():
    init_db()
    return create_user(f"vw_{__import__('uuid').uuid4()}@example.com", "p")["id"]


def test_preview_create_position_returns_narration_and_action_id():
    uid = _user()
    out = vwt.preview_create_position(
        user_id=uid, account="Swing", symbol="NVDA",
        shares=100, entry=200.20, stop=199.10,
    )
    assert "NVDA" in out["narration"]
    assert "100" in out["narration"]
    assert "200" in out["narration"] or "200.20" in out["narration"]
    payload = verify_action(out["action_id"])
    assert payload["tool"] == "create_position"


def test_preview_create_position_rejects_bad_shares():
    uid = _user()
    with pytest.raises(ValueError, match="shares"):
        vwt.preview_create_position(
            user_id=uid, account="Swing", symbol="NVDA",
            shares=1_000_000, entry=200.20, stop=199.10,
        )


def test_preview_create_position_rejects_nonpositive_prices():
    uid = _user()
    with pytest.raises(ValueError, match="entry"):
        vwt.preview_create_position(
            user_id=uid, account="Swing", symbol="NVDA",
            shares=100, entry=-1, stop=199.10,
        )


def test_preview_close_position_with_unknown_symbol_says_so():
    uid = _user()
    out = vwt.preview_close_position(user_id=uid, symbol="NONEXISTENT", exit=10.0)
    assert "narration" in out


def test_preview_add_daily_note():
    uid = _user()
    out = vwt.preview_add_daily_note(user_id=uid, text="Felt FOMO on the open")
    assert "note" in out["narration"].lower() or "FOMO" in out["narration"]
    payload = verify_action(out["action_id"])
    assert payload["tool"] == "add_daily_note"


def test_preview_log_mistake():
    uid = _user()
    out = vwt.preview_log_mistake(user_id=uid, mistake_type="overtrading", text="Took 8 trades today")
    assert "narration" in out
    payload = verify_action(out["action_id"])
    assert payload["tool"] == "log_mistake"
