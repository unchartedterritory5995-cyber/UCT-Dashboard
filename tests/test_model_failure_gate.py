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


# ─── which kind of account refusal (2026-11-20) ────────────────────────────────────────
KINDS = [
    (_status_error(400, "Your credit balance is too low to access the API"), "credit balance"),
    (_status_error(400, "There is a problem with your billing details"), "billing or payment"),
    (_status_error(402, "payment required"), "billing or payment"),
    (_status_error(401, "invalid x-api-key"), "key or sign-in"),
    (_status_error(401, "x"), "key or sign-in"),                    # by status alone
    (_status_error(403, "x"), "permission"),
    (_status_error(402, "x"), "billing or payment"),
    (_status_error(400, "authentication_error: invalid bearer token"), "key or sign-in"),
    (RuntimeError("anything"), "unclassified"), (None, "unclassified"),
]


@pytest.mark.parametrize("exc, kind", KINDS, ids=[k + ":" + str(i) for i, (_e, k) in enumerate(KINDS)])
def test_the_kind_of_account_refusal_is_one_of_a_closed_set_of_words(exc, kind):
    assert dc.account_refusal_class(exc) == kind


def test_every_refusal_the_gate_calls_an_account_refusal_has_a_kind():
    for exc in ACCOUNT:
        assert dc.account_refusal_class(exc) != "unclassified", str(exc)


class _Log:
    def __init__(self):
        self.lines = []

    def error(self, fmt, *args):
        self.lines.append(("ERROR", fmt % args))

    def warning(self, fmt, *args):
        self.lines.append(("WARNING", fmt % args))

    def __getattr__(self, level):
        # (info, debug, exception: recorded under their own level, never as an ERROR or a WARNING)
        return lambda fmt="", *args, **_k: self.lines.append((level.upper(), str(fmt)))


def test_the_log_line_says_the_kind_and_never_the_providers_own_text():
    log = _Log()
    secret = "request req_011CabcSECRET for org 9f3 Your credit balance is too low to access the API"
    kind = dc.log_account_refusal(log, "converse", _status_error(400, secret))
    assert kind == "credit balance"
    assert log.lines == [("ERROR", "[converse] the provider refused the account: APIStatusError (status 400, credit balance)")]
    assert "req_011" not in log.lines[0][1] and "too low" not in log.lines[0][1]
    # a logger that itself fails does not fail the turn
    class Broken:
        def error(self, *a):
            raise RuntimeError("the log is gone")
    assert dc.log_account_refusal(Broken(), "converse", _status_error(401, "x")) == "key or sign-in"


@pytest.mark.parametrize("door", ["converse", "converse:script"])
def test_every_door_says_the_same_line_as_an_error(conv, clean_env, monkeypatch, door):
    """The formula turn and the script turn (which used to log it as a WARNING "model call failed")."""
    from api.services import script_conversation as sc
    seen = _Log()
    module = conv if door == "converse" else sc
    monkeypatch.setattr(module, "logger", seen)
    boom = lambda *_a, **_k: (_ for _ in ()).throw(_status_error(400, "Your credit balance is too low"))  # noqa: E731
    monkeypatch.setattr(module, "_call_model", boom)
    if door == "converse":
        r = conv.converse("make it 80", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    else:
        monkeypatch.setenv(sc.SCRIPT_ENABLED_ENV, "all")
        from tests.test_p2_truth_server import empty_view
        r = conv.converse("draw a table with the ATR in the corner", user_id="u1", view=empty_view(0), accepts=["script"])
    assert r["ok"] is False and r["gate"] == "model:unavailable", r
    errors = [line for level, line in seen.lines if level == "ERROR"]
    assert errors == [f"[{door}] the provider refused the account: APIStatusError (status 400, credit balance)"], seen.lines
    # CONTROL: a failure that is not the account's is still a WARNING, at the same door
    seen.lines.clear()
    monkeypatch.setattr(module, "_call_model", lambda *_a, **_k: (_ for _ in ()).throw(TimeoutError("timed out")))
    if door == "converse":
        r = conv.converse("make it 80", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    else:
        r = conv.converse("draw a table with the ATR in the corner", user_id="u1", view=empty_view(0), accepts=["script"])
    assert r["gate"] == "model:transport"
    assert [level for level, _l in seen.lines if level in ("ERROR", "WARNING")] == ["WARNING"]
