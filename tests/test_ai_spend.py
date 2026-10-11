"""The AI spend guard (`api/services/ai_spend.py`), on the REAL Anthropic SDK.

Every call here goes through `anthropic.Anthropic` / `AsyncAnthropic` with an
`httpx.MockTransport`: the SDK's own request building, response parsing and streaming
run for real, and nothing leaves the process (no key, no network, no spend).
"""
from __future__ import annotations

import asyncio
import json

import anthropic
import httpx
import pytest

from api.services import ai_spend, daily_counters

MODEL = "claude-haiku-4-5"


def _message(input_tokens=1000, output_tokens=500):
    return {"id": "msg_test", "type": "message", "role": "assistant", "model": MODEL,
            "content": [{"type": "text", "text": "ok"}], "stop_reason": "end_turn",
            "stop_sequence": None,
            "usage": {"input_tokens": input_tokens, "output_tokens": output_tokens}}


def _sse(input_tokens=1000, output_tokens=500):
    events = [
        ("message_start", {"type": "message_start", "message": {**_message(input_tokens, 1), "content": []}}),
        ("content_block_start", {"type": "content_block_start", "index": 0,
                                 "content_block": {"type": "text", "text": ""}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 0,
                                 "delta": {"type": "text_delta", "text": "ok"}}),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                           "usage": {"output_tokens": output_tokens}}),
        ("message_stop", {"type": "message_stop"}),
    ]
    return "".join(f"event: {name}\ndata: {json.dumps(body)}\n\n" for name, body in events)


class Server:
    def __init__(self):
        self.calls = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        body = json.loads(request.content)
        if body.get("stream"):
            return httpx.Response(200, text=_sse(), headers={"content-type": "text/event-stream"})
        return httpx.Response(200, json=_message())


@pytest.fixture
def server(monkeypatch):
    ai_spend.install()
    ai_spend.reset_process_state()
    for k in ("AI_SPEND_DAILY_CAP_USD", "AI_SPEND_BATCH_CAP_USD", "AI_SPEND_DISABLED",
              "AI_SPEND_FEATURE_MAX_PER_MIN", "AI_SPEND_MAX_IN_FLIGHT", "RAILWAY_ENVIRONMENT"):
        monkeypatch.delenv(k, raising=False)
    daily_counters.clear()
    return Server()


def client(server):
    return anthropic.Anthropic(api_key="sk-test", max_retries=0,
                               http_client=httpx.Client(transport=httpx.MockTransport(server.handler)))


def ask(c):
    return c.messages.create(model=MODEL, max_tokens=600, messages=[{"role": "user", "content": "hi"}])


HAIKU_COST = (1000 * 1.0 + 500 * 5.0) / 1_000_000          # cost_guard._PRICING, $1 in / $5 out


def test_every_call_is_counted_by_feature_and_priced_by_the_one_table(server):
    out = ask(client(server))
    assert out.content[0].text == "ok" and server.calls == 1
    rep = ai_spend.report()
    assert rep["calls"] == 1 and rep["total_usd"] == pytest.approx(HAIKU_COST)
    assert rep["features"] == [{"feature": __name__, "usd": pytest.approx(HAIKU_COST, abs=1e-4), "calls": 1}]


def test_the_day_ceiling_refuses_BEFORE_the_request_and_says_so(server, monkeypatch):
    monkeypatch.setenv("AI_SPEND_DAILY_CAP_USD", str(HAIKU_COST * 1.5))
    c = client(server)
    ask(c)
    ask(c)                                           # 2 x cost > cap, but the 2nd was admitted at 1x
    with pytest.raises(ai_spend.AiSpendRefused) as e:
        ask(c)
    assert e.value.code == "daily-cap" and server.calls == 2   # nothing sent for the refused call
    assert ai_spend.report()["remaining_usd"] == 0.0


def test_off_railway_the_default_ceiling_is_the_dev_day_and_on_railway_it_only_records(server, monkeypatch):
    assert ai_spend.daily_cap_usd() == ai_spend.DEV_DAILY_CAP_USD == 10.0
    monkeypatch.setenv("RAILWAY_ENVIRONMENT", "production")
    assert ai_spend.daily_cap_usd() is None           # no production change until the owner sets it
    ask(client(server))
    assert ai_spend.report()["enforcing"] is False and ai_spend.report()["calls"] == 1
    monkeypatch.setenv("AI_SPEND_DAILY_CAP_USD", "25")
    assert ai_spend.daily_cap_usd() == 25.0
    monkeypatch.setenv("AI_SPEND_DAILY_CAP_USD", "off")
    assert ai_spend.daily_cap_usd() is None


def test_the_kill_switch_refuses_every_call(server, monkeypatch):
    monkeypatch.setenv("AI_SPEND_DISABLED", "1")
    with pytest.raises(ai_spend.AiSpendRefused) as e:
        ask(client(server))
    assert e.value.code == "disabled" and server.calls == 0


def test_a_runaway_feature_trips_its_breaker_and_no_other_feature(server, monkeypatch):
    monkeypatch.setenv("AI_SPEND_FEATURE_MAX_PER_MIN", "3")
    c = client(server)
    for _ in range(3):
        ask(c)
    with pytest.raises(ai_spend.AiSpendRefused) as e:
        ask(c)
    assert e.value.code == "breaker" and server.calls == 3
    with pytest.raises(ai_spend.AiSpendRefused):
        ask(c)                                       # still tripped
    ai_spend.admit("api.services.some_other_feature")   # another feature is unaffected
    ai_spend.release()


def test_the_in_flight_cap_refuses_rather_than_queues(server, monkeypatch):
    monkeypatch.setenv("AI_SPEND_MAX_IN_FLIGHT", "1")
    ai_spend.admit("f")
    with pytest.raises(ai_spend.AiSpendRefused) as e:
        ai_spend.admit("g")
    assert e.value.code == "in-flight"
    ai_spend.release()
    ai_spend.admit("g")
    ai_spend.release()


def test_a_failed_call_frees_its_slot(server, monkeypatch):
    monkeypatch.setenv("AI_SPEND_MAX_IN_FLIGHT", "1")
    bad = anthropic.Anthropic(api_key="sk-test", max_retries=0, http_client=httpx.Client(
        transport=httpx.MockTransport(lambda r: httpx.Response(500, json={"error": {"type": "api_error"}}))))
    with pytest.raises(anthropic.APIStatusError):
        ask(bad)
    ask(client(server))                              # the slot came back


def test_the_batch_ceiling_bounds_one_authorized_live_run(server, monkeypatch):
    monkeypatch.setenv("AI_SPEND_BATCH_CAP_USD", str(HAIKU_COST * 1.5))
    c = client(server)
    ask(c)
    ask(c)
    with pytest.raises(ai_spend.AiSpendRefused) as e:
        ask(c)
    assert e.value.code == "batch-cap" and server.calls == 2


def test_create_stream_true_is_counted_from_its_events(server):
    events = list(client(server).messages.create(model=MODEL, max_tokens=600, stream=True,
                                                 messages=[{"role": "user", "content": "hi"}]))
    assert [e.type for e in events][-1] == "message_stop"
    assert ai_spend.report()["total_usd"] == pytest.approx(HAIKU_COST)


def test_messages_stream_is_counted_from_its_final_snapshot(server):
    with client(server).messages.stream(model=MODEL, max_tokens=600,
                                        messages=[{"role": "user", "content": "hi"}]) as s:
        text = "".join(s.text_stream)
    assert text == "ok"
    rep = ai_spend.report()
    assert rep["calls"] == 1 and rep["total_usd"] == pytest.approx(HAIKU_COST)


def test_the_async_client_is_guarded_too(server, monkeypatch):
    async def go():
        c = anthropic.AsyncAnthropic(api_key="sk-test", max_retries=0, http_client=httpx.AsyncClient(
            transport=httpx.MockTransport(server.handler)))
        return await c.messages.create(model=MODEL, max_tokens=600, messages=[{"role": "user", "content": "hi"}])
    asyncio.run(go())
    assert ai_spend.report()["calls"] == 1
    monkeypatch.setenv("AI_SPEND_DISABLED", "1")
    with pytest.raises(ai_spend.AiSpendRefused):
        asyncio.run(go())


def test_install_is_idempotent_and_the_shared_factory_installs_it(monkeypatch):
    from anthropic.resources.messages import Messages
    assert ai_spend.install() and ai_spend.install()
    assert getattr(Messages.create, "_uct_ai_spend", False)
    src = open("api/services/engine.py", encoding="utf-8").read()
    assert "ai_spend.install()" in src


def test_conftest_refuses_a_real_request_to_a_model_host():
    """⛔ The suite-wide transport block: nothing reaches a model provider from a test."""
    with pytest.raises(RuntimeError, match="tests may not call api.anthropic.com"):
        httpx.Client().post("https://api.anthropic.com/v1/messages", json={})
    import requests
    with pytest.raises(RuntimeError, match="tests may not call api.perplexity.ai"):
        requests.post("https://api.perplexity.ai/chat/completions", json={}, timeout=1)
