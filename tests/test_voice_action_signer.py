"""Voice action signer — HMAC-signed action IDs with TTL + replay prevention."""

import time
import pytest
from api.services.voice_action_signer import (
    sign_action, verify_action, consume_action,
    ActionExpired, ActionReplayed, ActionInvalid,
)


def test_sign_and_verify_happy_path():
    aid = sign_action(tool="create_position", args={"symbol": "NVDA"}, user_id="u-1")
    payload = verify_action(aid)
    assert payload["tool"] == "create_position"
    assert payload["user_id"] == "u-1"


def test_verify_rejects_tampered_token():
    aid = sign_action(tool="x", args={}, user_id="u-1")
    tampered = aid[:-4] + "AAAA"
    with pytest.raises(ActionInvalid):
        verify_action(tampered)


def test_verify_rejects_expired_token(monkeypatch):
    monkeypatch.setattr("api.services.voice_action_signer.TTL_SECONDS", 1)
    aid = sign_action(tool="x", args={}, user_id="u-1")
    time.sleep(1.2)
    with pytest.raises(ActionExpired):
        verify_action(aid)


def test_consume_action_prevents_replay():
    aid = sign_action(tool="x", args={}, user_id="u-1")
    consume_action(aid)
    with pytest.raises(ActionReplayed):
        consume_action(aid)
