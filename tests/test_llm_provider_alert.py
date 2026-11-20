"""A person is told when the model provider refuses OUR ACCOUNT, once, and told when it is back.

2026-11-20: the provider refused the account, every model-backed feature answered "not available right now",
and nobody was told for half an hour. See ``api/services/llm_provider_alert.py``.

No paid calls and NO REAL POST: the channel is a list in every test, and the module is inert without a
Railway service name.
"""
from __future__ import annotations

import anthropic
import httpx
import pytest

from api.services import definition_concierge as dc
from api.services import llm_provider_alert as alert
from tests.test_p2_truth_server import conv, out, view, RSI_GT_70  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

T0 = 1_795_000_000.0                                  # a fixed moment (never the wall clock)


def _status_error(status: int, text: str = "x") -> anthropic.APIStatusError:
    resp = httpx.Response(status, request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"))
    return anthropic.APIStatusError(text, response=resp, body=None)


@pytest.fixture
def channel(monkeypatch):
    """The ops channel as a list, on a named service, with a clean state before and after."""
    sent = []
    alert._reset_for_tests()
    monkeypatch.setenv(alert.SERVICE_ENV, "web")
    monkeypatch.setattr(alert, "_post", sent.append)
    yield sent
    alert._reset_for_tests()


def test_the_first_refusal_pages_and_the_page_says_the_kind_the_service_the_time_and_the_one_thing_to_do(channel):
    assert alert.refused("credit balance", "converse", now=T0) is True
    assert len(channel) == 1
    text = channel[0]
    assert "refusing UCT's account" in text and "(credit balance)" in text and "Service: web" in text
    assert "First seen " in text and text.rstrip(".").endswith("top up the provider's credit balance")


def test_at_most_one_page_per_half_hour_while_it_lasts(channel):
    assert alert.refused("credit balance", now=T0) is True
    for dt in (1, 60, 900, alert.ALERT_EVERY_S - 1):
        assert alert.refused("credit balance", now=T0 + dt) is False
    assert len(channel) == 1
    assert alert.refused("credit balance", now=T0 + alert.ALERT_EVERY_S) is True
    assert len(channel) == 2
    # the later page still says when it FIRST started, and the kind it first saw
    assert channel[1] == channel[0]


def test_one_back_line_on_the_first_answer_and_then_silence(channel):
    alert.refused("key or sign-in", now=T0)
    assert alert.answered(now=T0 + 4000) is True
    assert len(channel) == 2 and "answering again" in channel[1] and "(key or sign-in)" in channel[1]
    assert alert.answered(now=T0 + 4001) is False and alert.answered(now=T0 + 9000) is False
    assert len(channel) == 2
    # and a NEW refusal after that pages at once (the half hour belongs to the outage that ended)
    assert alert.refused("credit balance", now=T0 + 4002) is True
    assert len(channel) == 3 and "(credit balance)" in channel[2]


def test_CONTROL_an_answer_with_no_refusal_outstanding_says_nothing(channel):
    assert alert.answered(now=T0) is False
    assert channel == []


def test_every_kind_the_classifier_can_return_has_its_one_thing_to_do():
    kinds = {name for name, _p in dc._ACCOUNT_REFUSAL_CLASSES} | set(dc._ACCOUNT_REFUSAL_BY_STATUS.values()) | {"unclassified"}
    assert set(alert.ACTIONS) == kinds
    assert len(set(alert.ACTIONS.values())) == len(alert.ACTIONS)        # each says something different
    for kind in kinds:
        assert alert.ACTIONS[kind] in alert.page_text(kind, "web", T0)


def test_the_providers_own_text_can_never_reach_the_channel(channel):
    """Through the real path: the door logs the refusal and the page goes out with the KIND only."""
    secret = "request req_011CabcSECRET org_9f3 sk-ant-NEVER Your credit balance is too low to access the API"

    class Quiet:
        def error(self, *_a):
            pass
    assert dc.log_account_refusal(Quiet(), "converse", _status_error(400, secret)) == "credit balance"
    assert len(channel) == 1
    for leaked in ("req_011", "org_9f3", "sk-ant", "too low", "access the API"):
        assert leaked not in channel[0]
    # and a caller that hands the module the provider's text instead of a kind still cannot post it
    alert._reset_for_tests()
    channel.clear()
    alert.refused(secret, now=T0)
    assert len(channel) == 1 and "(unclassified)" in channel[0]
    for leaked in ("req_011", "sk-ant", "too low"):
        assert leaked not in channel[0]
    assert alert.back_text(secret, "web", T0, T0 + 5).count("unclassified") == 1


def test_off_railway_nothing_is_ever_posted(monkeypatch):
    sent = []
    alert._reset_for_tests()
    monkeypatch.delenv(alert.SERVICE_ENV, raising=False)
    monkeypatch.setattr(alert, "_post", sent.append)
    assert alert.refused("credit balance", now=T0) is False
    assert alert.answered(now=T0 + 10) is False
    assert sent == []
    alert._reset_for_tests()


def test_the_destination_is_the_ops_class_at_the_highest_severity_under_this_producers_name(monkeypatch):
    """The wire, without a network: what `_post` asks the resolver for, and what it would POST."""
    from api.services import alert_destination
    asked, posted = [], []
    monkeypatch.setattr(alert_destination, "ops_webhook", lambda severity="", *, producer=None: (asked.append((severity, producer)), "https://discord.invalid/ops")[1])

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *_a):
            return False

        def read(self, _n):
            return b""
    monkeypatch.setattr(alert.urllib.request, "urlopen", lambda req, timeout=0: (posted.append((req.full_url, req.data)), _Resp())[1])

    class _Now:
        def __init__(self, target=None, **_k):
            self.target = target

        def start(self):
            self.target()
    monkeypatch.setattr(alert.threading, "Thread", _Now)
    alert._post("hello ops")
    assert asked == [("critical", "llm_provider_account_refusal")]
    assert posted == [("https://discord.invalid/ops", b'{"content": "hello ops"}')]
    # nothing configured: nothing posted, nothing raised
    posted.clear()
    monkeypatch.setattr(alert_destination, "ops_webhook", lambda *a, **k: "")
    alert._post("hello ops")
    assert posted == []


def test_the_conversation_door_pages_on_a_refusal_and_says_back_on_the_next_answer(conv, clean_env, monkeypatch, channel):
    from tests.test_p2_truth_server import emits, env, model
    monkeypatch.setattr(conv, "_call_model", lambda _m: (_ for _ in ()).throw(_status_error(400, "Your credit balance is too low")))
    r = conv.converse("make it 80", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    assert r["gate"] == "model:unavailable"
    assert len(channel) == 1 and "(credit balance)" in channel[0]
    # the member is told nothing of it
    assert "credit" not in r["reason"].lower() and "provider" not in r["reason"].lower()
    # CONTROL: an ordinary failure pages nobody
    monkeypatch.setattr(conv, "_call_model", lambda _m: (_ for _ in ()).throw(TimeoutError("timed out")))
    conv.converse("make it 80", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    assert len(channel) == 1
