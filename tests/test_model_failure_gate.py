"""O7: a provider that refuses OUR ACCOUNT is not a network failure.

Both used to read ``model:transport``, so an empty credit balance or a dead key looked like a blip in
every report. ``model:unavailable`` is the account refusal: its own gate, its own monitoring class
(``provider_account``), and the same calm sentence for the member, who is told neither detail.

No paid calls: the model call is replaced by one that raises.
"""
from __future__ import annotations

import anthropic
import httpx
import pytest

from api.services import definition_concierge as dc
from api.services import indicator_telemetry as telemetry
from tests.test_p2_truth_server import conv, out, view, RSI_GT_70  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name


def _status_error(status: int, text: str = "x") -> anthropic.APIStatusError:
    resp = httpx.Response(status, request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"))
    return anthropic.APIStatusError(text, response=resp, body=None)


ACCOUNT = [
    _status_error(401, "invalid x-api-key"),
    _status_error(403, "permission denied"),
    _status_error(402, "payment required"),
    _status_error(400, "Your credit balance is too low to access the API"),
]
NOT_ACCOUNT = [
    _status_error(500), _status_error(529, "overloaded"), _status_error(429, "rate limited"),
    _status_error(400, "messages: at least one message is required"),     # our request's fault, not the account
    RuntimeError("connection reset"), TimeoutError("timed out"), None,
]


@pytest.mark.parametrize("exc", ACCOUNT, ids=lambda e: f"{e.status_code}:{str(e)[:18]}")
def test_an_account_refusal_is_model_unavailable(exc):
    assert dc.model_failure_gate(exc) == "model:unavailable"


@pytest.mark.parametrize("exc", NOT_ACCOUNT, ids=lambda e: type(e).__name__ + ":" + str(getattr(e, "status_code", ""))[:4])
def test_everything_else_is_still_transport(exc):
    assert dc.model_failure_gate(exc) == "model:transport"


def test_the_member_is_told_nothing_about_keys_or_money():
    words = dc.REFUSALS["model:unavailable"]
    assert words and words != dc.REFUSALS["model:transport"]
    for banned in ("credit", "billing", "key", "payment", "anthropic", "provider", "401", "403"):
        assert banned not in words.lower()


def test_the_converse_door_answers_with_the_gate_and_charges_nothing(conv, clean_env, monkeypatch):
    monkeypatch.setattr(conv, "_call_model", lambda _m: (_ for _ in ()).throw(_status_error(401, "invalid x-api-key")))
    r = conv.converse("make it 80", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    assert r["ok"] is False and r["gate"] == "model:unavailable"
    assert r["reason"] == dc.REFUSALS["model:unavailable"]
    assert not r.get("cost_usd")                        # an HTTP error response is not billed


def test_CONTROL_a_timeout_through_the_same_door_is_still_transport(conv, clean_env, monkeypatch):
    monkeypatch.setattr(conv, "_call_model", lambda _m: (_ for _ in ()).throw(TimeoutError("timed out")))
    r = conv.converse("make it 80", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    assert r["ok"] is False and r["gate"] == "model:transport"


def test_monitoring_gets_its_own_class_not_platform(conv):
    assert "provider_account" in telemetry.FAILURE_CLASSES
    assert conv.failure_class({"ok": False, "gate": "model:unavailable"}) == "provider_account"
    # control: an outage keeps its class
    assert conv.failure_class({"ok": False, "gate": "model:transport"}) == "platform"
