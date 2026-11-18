"""The AI-spend ledger (api/services/llm_usage.py): every Anthropic call lands in
ONE table with the feature that made it, through the SDK hook, with no call-site
change. Driven through the REAL SDK over an httpx MockTransport, so a hook that
stops firing on an SDK upgrade fails here, by name."""
from __future__ import annotations

import asyncio
import contextlib
import json
import os

import anthropic
import httpx
import pytest

from api.services import llm_usage

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAKE_DOOR = "api/services/zz_fake_feature.py"

MSG = {"id": "msg_1", "type": "message", "role": "assistant", "model": "claude-sonnet-5-5",
       "content": [{"type": "text", "text": "hi"}], "stop_reason": "end_turn", "stop_sequence": None,
       "usage": {"input_tokens": 1000, "output_tokens": 200, "cache_read_input_tokens": 5000,
                 "cache_creation_input_tokens": 300, "server_tool_use": {"web_search_requests": 2}}}


def _sse() -> bytes:
    start = dict(MSG, content=[], stop_reason=None,
                 usage={"input_tokens": 1000, "output_tokens": 1, "cache_read_input_tokens": 5000,
                        "cache_creation_input_tokens": 300})
    ev = [("message_start", {"type": "message_start", "message": start}),
          ("content_block_start", {"type": "content_block_start", "index": 0,
                                   "content_block": {"type": "text", "text": ""}}),
          ("content_block_delta", {"type": "content_block_delta", "index": 0,
                                   "delta": {"type": "text_delta", "text": "hi"}}),
          ("content_block_stop", {"type": "content_block_stop", "index": 0}),
          ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                             "usage": {"output_tokens": 200}}),
          ("message_stop", {"type": "message_stop"})]
    return "".join(f"event: {n}\ndata: {json.dumps(d)}\n\n" for n, d in ev).encode()


def _handler(request: httpx.Request) -> httpx.Response:
    if request.url.path.endswith("/count_tokens"):
        return httpx.Response(200, json={"input_tokens": 42})
    body = json.loads(request.content or b"{}")
    if body.get("stream"):
        return httpx.Response(200, content=_sse(), headers={"content-type": "text/event-stream"})
    return httpx.Response(200, json=MSG)


@pytest.fixture
def ledger(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_USAGE_LEDGER", "1")
    monkeypatch.setenv("LLM_USAGE_DB_PATH", str(tmp_path / "llm_usage.db"))
    monkeypatch.setenv("RAILWAY_SERVICE_NAME", "web")
    monkeypatch.delenv("LLM_USAGE_FORWARD_URL", raising=False)
    assert llm_usage.install()
    llm_usage._drain(10_000)

    def rows():
        llm_usage.flush()
        with contextlib.closing(llm_usage.connect()) as c:
            cur = c.execute("SELECT * FROM llm_usage_calls ORDER BY id")
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, r)) for r in cur.fetchall()]
    return rows


def _as_feature(src: str, **ns):
    """Run `src` as if it lived in an api/ module -- the stack the hook attributes by."""
    code = compile(src, os.path.join(REPO, *FAKE_DOOR.split("/")), "exec")
    exec(code, ns)
    return ns


def _client():
    return anthropic.Anthropic(api_key="test", http_client=httpx.Client(transport=httpx.MockTransport(_handler)))


def test_plain_create_is_recorded_with_its_feature_and_cache_aware_price(ledger):
    ns = _as_feature("def generate_preview(c):\n"
                     "    return c.messages.create(model='claude-sonnet-5-5', max_tokens=10,"
                     " messages=[{'role':'user','content':'x'}])\n")
    ns["generate_preview"](_client())
    [r] = ledger()
    assert (r["door"], r["func"], r["kind"], r["service"]) == (FAKE_DOOR, "generate_preview", "sync", "web")
    assert (r["input_tokens"], r["output_tokens"], r["cache_read_tokens"], r["cache_write_tokens"],
            r["web_searches"]) == (1000, 200, 5000, 300, 2)
    assert r["cost_usd"] == pytest.approx(llm_usage.price("claude-sonnet-5-5", 1000, 200, 5000, 300, 2))
    assert r["cost_usd"] > 0.02  # the two web searches alone are $0.02 -- a price that ignored them reads lower


def test_messages_stream_helper_is_recorded_when_the_stream_ends(ledger):
    ns = _as_feature("def ask(c):\n"
                     "    with c.messages.stream(model='claude-sonnet-5-5', max_tokens=10,"
                     " messages=[{'role':'user','content':'x'}]) as s:\n"
                     "        for _ in s.text_stream: pass\n")
    ns["ask"](_client())
    [r] = ledger()
    assert (r["door"], r["func"], r["kind"]) == (FAKE_DOOR, "ask", "stream")
    # output comes from message_delta (200), not message_start's placeholder (1)
    assert (r["input_tokens"], r["output_tokens"], r["cache_read_tokens"]) == (1000, 200, 5000)


def test_raw_create_stream_true_is_recorded(ledger):
    ns = _as_feature("def raw(c):\n"
                     "    for _ in c.messages.create(model='claude-sonnet-5-5', max_tokens=10, stream=True,"
                     " messages=[{'role':'user','content':'x'}]): pass\n")
    ns["raw"](_client())
    [r] = ledger()
    assert (r["kind"], r["output_tokens"]) == ("stream", 200)


def test_async_create_is_recorded(ledger):
    ns = _as_feature("async def a(c):\n"
                     "    return await c.messages.create(model='claude-sonnet-5-5', max_tokens=10,"
                     " messages=[{'role':'user','content':'x'}])\n")
    client = anthropic.AsyncAnthropic(api_key="t", http_client=httpx.AsyncClient(
        transport=httpx.MockTransport(_handler)))
    asyncio.run(ns["a"](client))
    [r] = ledger()
    assert (r["door"], r["func"], r["kind"]) == (FAKE_DOOR, "a", "sync")


def test_count_tokens_is_not_a_billed_call(ledger):
    ns = _as_feature("def n(c):\n    return c.messages.count_tokens(model='claude-sonnet-5-5',"
                     " messages=[{'role':'user','content':'x'}])\n")
    ns["n"](_client())
    assert ledger() == []


def test_door_override_wins_over_the_stack(ledger):
    with llm_usage.door("api/services/explicit.py"):
        _client().messages.create(model="claude-sonnet-5-5", max_tokens=10,
                                  messages=[{"role": "user", "content": "x"}])
    assert ledger()[0]["door"] == "api/services/explicit.py"


def test_batch_results_price_at_half(ledger):
    llm_usage.record_message(MSG, door="api/services/llm_batch.py", func="call_recap", kind="batch")
    [r] = ledger()
    full = llm_usage.price("claude-sonnet-5-5", 1000, 200, 5000, 300, 0)
    assert r["cost_usd"] == pytest.approx(full / 2 + 0.02)  # tokens halved, searches not


def test_ledger_off_under_pytest_by_default(monkeypatch, tmp_path):
    monkeypatch.delenv("LLM_USAGE_LEDGER", raising=False)
    assert os.environ.get("PYTEST_CURRENT_TEST")
    assert llm_usage.enabled() is False


def test_a_broken_ledger_never_breaks_the_model_call(ledger, monkeypatch):
    monkeypatch.setattr(llm_usage, "record_message", lambda *a, **k: 1 / 0)
    out = _client().messages.create(model="claude-sonnet-5-5", max_tokens=10,
                                    messages=[{"role": "user", "content": "x"}])
    assert out.usage.output_tokens == 200


# ── the admin page and the ingest door ───────────────────────────────────────

@pytest.fixture
def api_client(ledger, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import require_admin
    from api.routers import admin_llm_usage as r
    app = FastAPI()
    app.include_router(r.router)
    app.include_router(r.internal_router)
    app.dependency_overrides[require_admin] = lambda: {"role": "admin"}
    return TestClient(app), ledger


def test_summary_names_the_feature_and_ranks_by_cost(api_client):
    client, rows = api_client
    llm_usage.record(door="api/services/engine.py", func="_generate_earnings_preview",
                     model="claude-opus-5-5", input_tokens=50_000, output_tokens=2_000)
    llm_usage.record(door="api/services/zz_unlisted.py", model="claude-haiku-5-5", input_tokens=100)
    rows()
    body = client.get("/api/admin/llm-usage/summary?days=7").json()
    top = body["by_door"][0]
    assert top["door"] == "api/services/engine.py" and top["kind"] != "unlisted"
    assert body["unlisted_doors"] == ["api/services/zz_unlisted.py"]
    assert "api/services/engine.py" not in body["silent_doors"]
    assert body["totals"]["calls"] == 2
    detail = client.get("/api/admin/llm-usage/door", params={"door": "api/services/engine.py"}).json()
    assert detail["by_func"][0]["func"] == "_generate_earnings_preview"


def test_ingest_fails_closed_and_writes_with_a_secret(api_client, monkeypatch):
    client, rows = api_client
    row = {"door": "morning-wire/morning_wire_engine.py", "model": "claude-sonnet-5-5",
           "service": "morning-wire", "input_tokens": 10, "output_tokens": 5}
    monkeypatch.delenv("PUSH_SECRET", raising=False)
    assert client.post("/api/internal/llm-usage/ingest", json={"rows": [row]}).status_code == 401
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    assert client.post("/api/internal/llm-usage/ingest", json={"rows": [row]},
                       headers={"Authorization": "Bearer wrong"}).status_code == 401
    ok = client.post("/api/internal/llm-usage/ingest", json={"rows": [row]},
                     headers={"Authorization": "Bearer s3cret"})
    assert ok.status_code == 200 and ok.json()["written"] == 1
    [r] = rows()
    assert (r["service"], r["door"]) == ("morning-wire", "morning-wire/morning_wire_engine.py")
    assert r["cost_usd"] > 0
