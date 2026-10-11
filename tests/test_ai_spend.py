"""The AI spend guard (`api/services/ai_spend.py`), on the REAL Anthropic SDK.

Every call here goes through `anthropic.Anthropic` / `AsyncAnthropic` with an
`httpx.MockTransport`: the SDK's own request building, retries, response parsing and
streaming run for real, and nothing leaves the process (no key, no network, no spend).
The budget store is the real one (`daily_counters` in the test sandbox's auth.db).
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import threading

import anthropic
import httpx
import pytest

from api.services import ai_spend, auth_db, daily_counters

MODEL = "claude-haiku-4-5"
MAX_TOKENS = 600
IN_TOKENS, OUT_TOKENS = 10, 500


def _message(input_tokens=IN_TOKENS, output_tokens=OUT_TOKENS, usage=True):
    m = {"id": "msg_test", "type": "message", "role": "assistant", "model": MODEL,
         "content": [{"type": "text", "text": "ok"}], "stop_reason": "end_turn", "stop_sequence": None}
    if usage:
        m["usage"] = {"input_tokens": input_tokens, "output_tokens": output_tokens}
    return m


def _sse(input_tokens=IN_TOKENS, output_tokens=OUT_TOKENS, finish=True):
    events = [
        ("message_start", {"type": "message_start", "message": {**_message(input_tokens, 1), "content": [],
                                                                "stop_reason": None}}),
        ("content_block_start", {"type": "content_block_start", "index": 0,
                                 "content_block": {"type": "text", "text": ""}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 0,
                                 "delta": {"type": "text_delta", "text": "ok"}}),
    ]
    if finish:
        events += [
            ("content_block_stop", {"type": "content_block_stop", "index": 0}),
            ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                               "usage": {"output_tokens": output_tokens}}),
            ("message_stop", {"type": "message_stop"}),
        ]
    return "".join(f"event: {name}\ndata: {json.dumps(body)}\n\n" for name, body in events)


class Server:
    """A fake Anthropic. `script` is a list of per-attempt behaviours, then 200s."""

    def __init__(self):
        self.calls = 0
        self.script = []
        self.gate = None                 # a threading.Event every request waits on

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        if self.gate is not None:
            self.gate.wait(10)
        if self.script:
            step = self.script.pop(0)
            if isinstance(step, BaseException):
                raise step
            if callable(step):
                return step(request)
            return httpx.Response(step, json={"type": "error", "error": {"type": "api_error", "message": "x"}})
        if request.url.path.endswith("/batches"):
            return httpx.Response(200, json={"id": "msgbatch_1", "type": "message_batch",
                                             "processing_status": "in_progress",
                                             "request_counts": {"processing": 3, "succeeded": 0, "errored": 0,
                                                                "canceled": 0, "expired": 0},
                                             "created_at": "2026-10-11T00:00:00Z",
                                             "expires_at": "2026-10-12T00:00:00Z",
                                             "ended_at": None, "cancel_initiated_at": None,
                                             "archived_at": None, "results_url": None})
        body = json.loads(request.content)
        if body.get("stream"):
            return httpx.Response(200, text=_sse(), headers={"content-type": "text/event-stream"})
        return httpx.Response(200, json=_message())


_ENV = ("AI_SPEND_DAILY_CAP_USD", "AI_SPEND_BATCH_CAP_USD", "AI_SPEND_DISABLED", "AI_SPEND_MODE",
        "AI_SPEND_FEATURE_MAX_PER_MIN", "AI_SPEND_MAX_IN_FLIGHT", "AI_SPEND_ALLOW_REALTIME",
        "RAILWAY_ENVIRONMENT")


@pytest.fixture
def server(monkeypatch):
    ai_spend.install()
    ai_spend.reset_process_state()
    for k in _ENV:
        monkeypatch.delenv(k, raising=False)
    # the SDK's retry back-off, made instant (the retry LOGIC is the SDK's own)
    monkeypatch.setattr(anthropic._base_client.SyncAPIClient, "_calculate_retry_timeout",
                        lambda self, *a, **k: 0.0)
    daily_counters.clear()
    return Server()


def client(server, retries=0):
    return anthropic.Anthropic(api_key="sk-test", max_retries=retries,
                               http_client=httpx.Client(transport=httpx.MockTransport(server.handler)))


PARAMS = dict(model=MODEL, max_tokens=MAX_TOKENS, messages=[{"role": "user", "content": "hi"}])


def ask(c):
    return c.messages.create(**PARAMS)


COST = (IN_TOKENS * 1.0 + OUT_TOKENS * 5.0) / 1_000_000          # cost_guard._PRICING, $1 in / $5 out
RESERVE = ai_spend.reservation_usd(PARAMS)


def rep():
    return ai_spend.report()


# ── the basics ──────────────────────────────────────────────────────────────────

def test_every_call_is_reserved_then_settled_to_its_confirmed_cost_by_feature(server):
    assert RESERVE > COST                            # the reservation is the worst case
    out = ask(client(server))
    assert out.content[0].text == "ok" and server.calls == 1
    r = rep()
    assert r["mode"] == "enforce" and r["calls"] == 1
    assert r["committed_usd"] == pytest.approx(COST, abs=1e-6)
    assert r["confirmed_usd"] == pytest.approx(COST, abs=1e-6)
    assert r["reserved_usd"] == 0 and r["unconfirmed_usd"] == 0
    assert r["features"] == [{"feature": __name__, "usd": pytest.approx(COST, abs=1e-4), "calls": 1,
                              "unconfirmed_usd": 0}]


def test_the_reservation_covers_any_answer_the_request_permits():
    """Input at 3 chars/token as a cache write (the dearest input rate) + max_tokens of output."""
    text = "word " * 2000                                       # ~10,000 chars ≈ 2,500 real tokens
    p = dict(model="claude-opus-5", max_tokens=8192, system="s" * 3000,
             messages=[{"role": "user", "content": text}],
             tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}])
    worst = ai_spend.cost_of("claude-opus-5", {"input_tokens": (10_000 + 3000) // 3, "output_tokens": 8192,
                                               "server_tool_use": {"web_search_requests": 3}})
    assert ai_spend.reservation_usd(p) >= worst
    img = dict(PARAMS, messages=[{"role": "user", "content": [
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "A" * 2_000_000}}]}])
    assert ai_spend.reservation_usd(img) < 0.02                 # an image is priced by its ceiling, not its bytes


def test_the_day_ceiling_refuses_a_call_whose_worst_case_does_not_fit_BEFORE_sending(server, monkeypatch):
    monkeypatch.setenv("AI_SPEND_DAILY_CAP_USD", str(COST + RESERVE + 1e-6))
    c = client(server)
    ask(c)                                           # reserve R, settle to C
    ask(c)                                           # C + R fits
    with pytest.raises(ai_spend.AiSpendRefused) as e:
        ask(c)                                       # 2C + R does not
    assert e.value.code == "daily-cap" and server.calls == 2
    assert rep()["reserved_usd"] == 0


# ── modes, and fail-closed ──────────────────────────────────────────────────────

def test_the_mode_table(server, monkeypatch):
    assert ai_spend.mode() == "enforce" and ai_spend.daily_cap_usd() == ai_spend.DEV_DAILY_CAP_USD == 10.0
    monkeypatch.setenv("AI_SPEND_DAILY_CAP_USD", "off")
    assert ai_spend.mode() == "record"               # switched off BY NAME off Railway
    monkeypatch.delenv("AI_SPEND_DAILY_CAP_USD")
    monkeypatch.setenv("RAILWAY_ENVIRONMENT", "production")
    assert ai_spend.mode() == "record" and ai_spend.daily_cap_usd() is None   # production unchanged
    monkeypatch.setenv("AI_SPEND_DAILY_CAP_USD", "25")
    assert ai_spend.mode() == "enforce" and ai_spend.daily_cap_usd() == 25.0  # the owner sets a ceiling
    monkeypatch.setenv("AI_SPEND_MODE", "record")
    assert ai_spend.mode() == "record"
    monkeypatch.setenv("AI_SPEND_MODE", "enforec")   # a typo enforces
    assert ai_spend.mode() == "enforce"


def test_production_record_mode_counts_and_refuses_nothing_for_money(server, monkeypatch):
    monkeypatch.setenv("RAILWAY_ENVIRONMENT", "production")
    ask(client(server))
    r = rep()
    assert r["enforcing"] is False and r["calls"] == 1 and r["committed_usd"] == pytest.approx(COST, abs=1e-6)


def test_enforcement_with_no_valid_ceiling_refuses_rather_than_running_unbounded(server, monkeypatch):
    for env in ({"AI_SPEND_MODE": "enforce", "RAILWAY_ENVIRONMENT": "production"},
                {"AI_SPEND_MODE": "enforce", "AI_SPEND_DAILY_CAP_USD": "ten dollars"},
                {"AI_SPEND_DAILY_CAP_USD": "-5"}):
        for k in _ENV:
            monkeypatch.delenv(k, raising=False)
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        with pytest.raises(ai_spend.AiSpendRefused) as e:
            ask(client(server))
        assert e.value.code == "misconfigured", env
    assert server.calls == 0


def _break_store(monkeypatch):
    def boom():
        raise OSError("disk I/O error")
    monkeypatch.setattr(daily_counters, "_connect", boom)


def test_a_store_outage_refuses_every_paid_call_and_recovery_is_clean(server, monkeypatch):
    c = client(server)
    with monkeypatch.context() as m:
        _break_store(m)
        for _ in range(3):
            with pytest.raises(ai_spend.AiSpendRefused) as e:
                ask(c)
            assert e.value.code == "store-unavailable"
        assert daily_counters.take("2026-10-11", [daily_counters.Charge("x", "*", 1, 5)], strict=True) \
            == daily_counters.STORE_UNAVAILABLE          # a failed reservation is never "admitted"
    assert server.calls == 0
    ask(c)                                           # the store is back: so are calls, nothing leaked
    r = rep()
    assert server.calls == 1 and r["calls"] == 1 and r["reserved_usd"] == 0
    ai_spend.admit("probe")                          # every in-flight slot came back
    ai_spend.release()


def test_record_mode_still_fails_open_on_a_store_outage(server, monkeypatch):
    monkeypatch.setenv("AI_SPEND_MODE", "record")
    _break_store(monkeypatch)
    ask(client(server))
    assert server.calls == 1


def test_a_store_failure_while_settling_keeps_the_reservation_held(server, monkeypatch):
    real_take = daily_counters.take
    n = {"i": 0}

    def flaky(day, charges, **kw):
        n["i"] += 1
        if n["i"] == 2:                              # the reservation lands; the settle write fails
            return daily_counters.STORE_UNAVAILABLE
        return real_take(day, charges, **kw)
    monkeypatch.setattr(daily_counters, "take", flaky)
    ask(client(server))
    r = rep()
    assert r["committed_usd"] == pytest.approx(RESERVE, abs=1e-6)   # over-count, never under
    assert r["reserved_usd"] == pytest.approx(RESERVE, abs=1e-6)


# ── concurrency and restarts ────────────────────────────────────────────────────

def test_simultaneous_requests_cannot_overspend_the_shared_ceiling(server, monkeypatch):
    monkeypatch.setenv("AI_SPEND_DAILY_CAP_USD", str(5 * RESERVE + 1e-9))
    server.gate = threading.Event()
    outcomes = []

    def go():
        try:
            ask(client(server))
            outcomes.append("sent")
        except ai_spend.AiSpendRefused as e:
            outcomes.append(e.code)

    threads = [threading.Thread(target=go) for _ in range(12)]
    for t in threads:
        t.start()
    waited = 0
    while server.calls + outcomes.count("daily-cap") < 12 and waited < 200:
        threading.Event().wait(0.05)
        waited += 1
    in_flight_at_peak = server.calls
    server.gate.set()
    for t in threads:
        t.join(10)
    assert in_flight_at_peak == 5                    # all five in flight AT ONCE, no sixth
    assert sorted(outcomes) == ["daily-cap"] * 7 + ["sent"] * 5
    assert rep()["reserved_usd"] == 0 and rep()["committed_usd"] == pytest.approx(5 * COST, abs=1e-6)


_CHILD = r"""
import json, os, sys
sys.path.insert(0, os.getcwd())
from api.services import ai_spend
ok = refused = 0
for _ in range(4):
    t = ai_spend._Ticket("child", "claude-haiku-4-5", 1.0, True)
    try:
        ai_spend._reserve(t, 1.0)
        ok += 1                       # reserved, and the process exits WITHOUT settling (a crash)
    except ai_spend.AiSpendRefused as e:
        refused += 1
print(json.dumps({"ok": ok, "refused": refused}))
"""


def test_separate_processes_share_one_ceiling_and_a_crash_never_frees_its_reservation(server):
    env = {**os.environ, "AUTH_DB_PATH": auth_db._DB_PATH, "AI_SPEND_DAILY_CAP_USD": "5",
           "AI_SPEND_MODE": "enforce"}
    env.pop("RAILWAY_ENVIRONMENT", None)
    procs = [subprocess.Popen([sys.executable, "-c", _CHILD], env=env, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True) for _ in range(4)]
    results = [json.loads(p.communicate(timeout=120)[0].strip().splitlines()[-1]) for p in procs]
    assert sum(r["ok"] for r in results) == 5 and sum(r["refused"] for r in results) == 11
    r = rep()                                        # every child died holding its reservations
    assert r["committed_usd"] == pytest.approx(5.0) and r["reserved_usd"] == pytest.approx(5.0)


def test_a_worker_restart_mid_call_keeps_the_budget_held(server, monkeypatch):
    monkeypatch.setenv("AI_SPEND_DAILY_CAP_USD", str(RESERVE * 1.5))
    ai_spend._open("api.services.some_job", MODEL, RESERVE)    # in flight when the worker dies
    ai_spend.reset_process_state()                           # the new process knows nothing of it
    with pytest.raises(ai_spend.AiSpendRefused) as e:
        ask(client(server))
    assert e.value.code == "daily-cap" and server.calls == 0


# ── failures, retries, timeouts, missing usage ──────────────────────────────────

def test_an_error_answer_is_not_billed_and_frees_everything(server, monkeypatch):
    monkeypatch.setenv("AI_SPEND_MAX_IN_FLIGHT", "1")
    server.script = [400]
    with pytest.raises(anthropic.BadRequestError):
        ask(client(server))
    r = rep()
    assert r["committed_usd"] == 0 and r["reserved_usd"] == 0 and r["calls"] == 1
    ask(client(server))                              # the slot came back


def test_a_timeout_keeps_its_reservation_as_unconfirmed_spend(server):
    server.script = [httpx.ReadTimeout("slow")]
    with pytest.raises(anthropic.APITimeoutError):
        ask(client(server))
    r = rep()
    assert r["unconfirmed_usd"] == pytest.approx(RESERVE, abs=1e-6)
    assert r["committed_usd"] == pytest.approx(RESERVE, abs=1e-6) and r["reserved_usd"] == 0


def test_sdk_retries_count_every_attempt_that_may_have_been_billed(server):
    # attempt 1 times out (maybe billed), attempt 2 is a 529 answer (not billed), attempt 3 succeeds
    server.script = [httpx.ReadTimeout("slow"), 529]
    ask(client(server, retries=2))
    r = rep()
    assert server.calls == 3
    assert r["confirmed_usd"] == pytest.approx(COST, abs=1e-6)
    assert r["unconfirmed_usd"] == pytest.approx(RESERVE, abs=1e-6)      # the timed-out attempt
    assert r["reserved_usd"] == 0


def test_a_retry_with_no_room_left_is_refused_by_name_not_sent(server, monkeypatch):
    monkeypatch.setenv("AI_SPEND_DAILY_CAP_USD", str(RESERVE * 1.5))
    server.script = [httpx.ConnectTimeout("no route")]
    with pytest.raises(ai_spend.AiSpendRefused) as e:
        ask(client(server, retries=2))
    assert e.value.code == "daily-cap" and server.calls == 1        # the retry never left
    assert rep()["unconfirmed_usd"] == pytest.approx(RESERVE, abs=1e-6)


def test_missing_usage_metadata_is_held_at_the_reservation(server):
    server.script = [lambda req: httpx.Response(200, json=_message(usage=False))]
    ask(client(server))
    r = rep()
    assert r["unconfirmed_usd"] == pytest.approx(RESERVE, abs=1e-6) and r["confirmed_usd"] == 0


def test_a_stream_that_never_finishes_is_held_not_priced_from_its_partial_usage(server):
    server.script = [lambda req: httpx.Response(200, text=_sse(finish=False),
                                                headers={"content-type": "text/event-stream"})]
    list(client(server).messages.create(stream=True, **PARAMS))
    r = rep()
    assert r["unconfirmed_usd"] == pytest.approx(RESERVE, abs=1e-6) and r["reserved_usd"] == 0


# ── the other doors: streams, async, batches, raw HTTP, other providers ────────

def test_create_stream_true_is_confirmed_from_its_events(server):
    events = list(client(server).messages.create(stream=True, **PARAMS))
    assert [e.type for e in events][-1] == "message_stop"
    assert rep()["confirmed_usd"] == pytest.approx(COST, abs=1e-6)


def test_messages_stream_is_confirmed_from_its_final_snapshot(server):
    with client(server).messages.stream(**PARAMS) as s:
        text = "".join(s.text_stream)
    assert text == "ok"
    r = rep()
    assert r["calls"] == 1 and r["confirmed_usd"] == pytest.approx(COST, abs=1e-6) and r["reserved_usd"] == 0


def test_the_async_client_is_guarded_too(server, monkeypatch):
    async def go():
        c = anthropic.AsyncAnthropic(api_key="sk-test", max_retries=0, http_client=httpx.AsyncClient(
            transport=httpx.MockTransport(server.handler)))
        return await c.messages.create(**PARAMS)
    asyncio.run(go())
    assert rep()["confirmed_usd"] == pytest.approx(COST, abs=1e-6)
    monkeypatch.setenv("AI_SPEND_DISABLED", "1")
    with pytest.raises(ai_spend.AiSpendRefused):
        asyncio.run(go())


def test_a_message_batch_holds_its_discounted_worst_case_at_submission(server, monkeypatch):
    reqs = [{"custom_id": f"r{i}", "params": PARAMS} for i in range(3)]
    client(server).messages.batches.create(requests=reqs)
    r = rep()
    held = 3 * RESERVE * ai_spend.BATCH_DISCOUNT
    assert r["unconfirmed_usd"] == pytest.approx(held, abs=1e-6) and r["calls"] == 3
    monkeypatch.setenv("AI_SPEND_DAILY_CAP_USD", str(held * 1.5))
    with pytest.raises(ai_spend.AiSpendRefused) as e:
        client(server).messages.batches.create(requests=reqs)
    assert e.value.code == "daily-cap" and server.calls == 1


def test_a_background_job_on_a_worker_thread_is_attributed_and_capped_the_same(server, monkeypatch):
    ns = {"__name__": "api.services.catalyst.nightly_job", "PARAMS": PARAMS, "client": client, "server": server}
    exec("def job():\n    return client(server).messages.create(**PARAMS)\n", ns)
    t = threading.Thread(target=ns["job"])
    t.start()
    t.join(10)
    assert [f["feature"] for f in rep()["features"]] == ["api.services.catalyst.nightly_job"]
    monkeypatch.setenv("AI_SPEND_DAILY_CAP_USD", "0")
    with pytest.raises(ai_spend.AiSpendRefused):
        ns["job"]()


def test_raw_http_to_anthropic_cannot_bypass_enforcement(server, monkeypatch):
    raw = httpx.Client(transport=httpx.MockTransport(server.handler))
    with pytest.raises(ai_spend.AiSpendRefused) as e:
        raw.post("https://api.anthropic.com/v1/messages", json={**PARAMS})
    assert e.value.code == "unmetered" and server.calls == 0
    server.script = [lambda req: httpx.Response(200, json={"input_tokens": 3})]
    raw.post("https://api.anthropic.com/v1/messages/count_tokens", json={})   # free: allowed
    monkeypatch.setenv("AI_SPEND_MODE", "record")
    raw.post("https://api.anthropic.com/v1/messages", json={**PARAMS})        # record mode: passes
    assert server.calls == 2


def test_openai_and_perplexity_requests_reserve_a_flat_estimate(server, monkeypatch):
    seen = []

    def other(request):
        seen.append(request.url.path)
        return httpx.Response(429 if "fail" in request.url.path else 200, json={})
    c = httpx.Client(transport=httpx.MockTransport(other))
    c.post("https://api.perplexity.ai/chat/completions", json={"model": "sonar-pro"})
    c.post("https://api.perplexity.ai/chat/completions", json={"model": "sonar-deep-research"})
    c.post("https://api.openai.com/v1/audio/speech", json={})
    c.post("https://api.openai.com/v1/fail", json={})                         # an error answer: free
    r = rep()
    assert r["unconfirmed_usd"] == pytest.approx(0.05 + 1.50 + 0.07, abs=1e-6) and r["calls"] == 4
    with pytest.raises(ai_spend.AiSpendRefused) as e:
        c.post("https://api.openai.com/v1/realtime/sessions", json={})       # billed off-server
    assert e.value.code == "unmetered" and len(seen) == 4
    monkeypatch.setenv("AI_SPEND_DAILY_CAP_USD", "1.65")              # 1.62 committed + 0.05 > 1.65
    with pytest.raises(ai_spend.AiSpendRefused) as e:
        c.post("https://api.perplexity.ai/chat/completions", json={"model": "sonar-pro"})
    assert e.value.code == "daily-cap"


def test_requests_library_calls_are_gated_too(server):
    import requests
    from requests.adapters import BaseAdapter

    class Fake(BaseAdapter):
        def send(self, request, **kw):
            resp = requests.Response()
            resp.status_code, resp._content, resp.url = 200, b"{}", request.url
            return resp

        def close(self):
            pass
    s = requests.Session()
    s.mount("https://", Fake())
    s.post("https://api.perplexity.ai/chat/completions", json={"model": "sonar"})
    assert rep()["unconfirmed_usd"] == pytest.approx(0.05, abs=1e-6)
    with pytest.raises(ai_spend.AiSpendRefused):
        s.post("https://api.anthropic.com/v1/messages", json={})


# ── the per-process valves (both modes) ─────────────────────────────────────────

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


def test_the_batch_ceiling_bounds_one_authorized_live_run_by_worst_case(server, monkeypatch):
    monkeypatch.setenv("AI_SPEND_BATCH_CAP_USD", str(COST + RESERVE + 1e-9))
    c = client(server)
    ask(c)
    ask(c)
    with pytest.raises(ai_spend.AiSpendRefused) as e:
        ask(c)
    assert e.value.code == "batch-cap" and server.calls == 2


def test_install_is_idempotent_and_the_shared_factory_installs_it():
    from anthropic.resources.messages import Messages
    from anthropic.resources.messages.batches import Batches
    assert ai_spend.install() and ai_spend.install()
    for fn in (Messages.create, Messages.stream, Messages.parse, Batches.create, httpx.Client.send,
               httpx.AsyncClient.send):
        assert getattr(fn, "_uct_ai_spend", False), fn
    src = open("api/services/engine.py", encoding="utf-8").read()
    assert "ai_spend.install()" in src


def test_conftest_refuses_a_real_request_to_a_model_host():
    """⛔ The suite-wide transport block: nothing reaches a model provider from a test."""
    with pytest.raises(RuntimeError, match="tests may not call api.anthropic.com"):
        httpx.Client().post("https://api.anthropic.com/v1/messages/count_tokens", json={})
    import requests
    with pytest.raises(RuntimeError, match="tests may not call api.perplexity.ai"):
        requests.post("https://api.perplexity.ai/chat/completions", json={}, timeout=1)


def test_every_deployed_process_entry_point_installs_the_guard():
    """Railway runs `api.main` or one of the `api/*_main.py` workers (`railway.json`); each
    installs the guard at import, so a client a job builds itself is still reserved."""
    import ast
    import glob
    mains = sorted(glob.glob("api/*_main.py")) + ["api/main.py"]
    assert len(mains) >= 7
    for path in mains:
        tree = ast.parse(open(path, encoding="utf-8").read())
        assert any("ai_spend" in ast.unparse(n) and "install()" in ast.unparse(n)
                   for n in tree.body if isinstance(n, ast.Try)), path
