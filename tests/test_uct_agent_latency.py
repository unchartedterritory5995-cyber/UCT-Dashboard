"""UCT Agent latency work (2026-10-12): streamed answers, stage timings, the board check's key filter.

What these pin:
  * ReplyStream — the ONLY door for early text — streams an ANSWER's decoded reply and nothing else:
    never a plan's words (so never a local-only lookup's), never a reply that claims work, never a
    reply written before its disposition; escapes and emoji survive chunking intact.
  * run_turn(on_event=…) — the first call never streams when UCT will force research; streamed text
    that turns out to be a placeholder is retracted before research; the post-research answer streams.
  * POST /api/agent/turn/stream — flag OFF: exactly one event, /api/agent/turn's own JSON; flag ON:
    deltas then that final; a refusal is an error event with /turn's status and sentence.
  * stage timings are numbers only; the timing log line carries no words.
  * GET /api/auth/preferences?keys=… answers only those keys; absent → the whole blob, unchanged.
"""
from __future__ import annotations

import json
import logging
import types

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import uct_agent as rx
from api.services import daily_counters
from api.services.uct_agent import store, turn

ADMIN = {"id": "b7e5a1c0-0000-4000-8000-000000001a71", "plan": "pro", "role": "admin"}
LONG = ("RSI measures the speed and size of recent price changes on a 0 to 100 scale. Readings above 70 are "
        "often called overbought and below 30 oversold, but in strong trends it can stay extreme for weeks — "
        "so traders read it with trend and structure, not alone. A “divergence” — price making a new high "
        "while RSI does not — hints that momentum is fading. 📈 Use it as context.")
SENTINEL = "73.4567"


def envelope(disposition="answer", reply=LONG, ops=None, research=None, question=None, title=None):
    return {"disposition": disposition, "reply": reply, "question": question, "ops": ops or [],
            "unsupported_category": None, "research": research, "title": title}


def _chunks(text: str, n: int = 7):
    return [text[i:i + n] for i in range(0, len(text), n)]


def _resp(env: dict):
    return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=json.dumps(env))],
                                 usage=None, stop_reason="end_turn")


class StreamModel:
    """Stands in for the streamed model call: feeds the envelope JSON in small chunks (the escaped,
    serialized form the API streams), then returns the final message. Captures every request."""
    def __init__(self, *envs, chunk=7):
        self.queue, self.calls, self.chunk = list(envs), [], chunk

    def __call__(self, on_text, **kw):
        self.calls.append(kw)
        env = self.queue.pop(0)
        for c in _chunks(json.dumps(env), self.chunk):
            on_text(c)
        return _resp(env)


def run(model, message="what does RSI measure, in detail?", **kw):
    events = []
    out = turn.run_turn(message=message, context={"charts": [{"ref": "c1"}], "breadth": [{"ref": "b1"}]},
                        history=[], capabilities=kw.pop("capabilities", []), on_event=events.append,
                        stream_caller=model, **kw)
    return out, events


def streamed_text(events):
    return "".join(e["text"] for e in events if e["t"] == "delta")


@pytest.fixture(autouse=True)
def _no_cost(monkeypatch):
    monkeypatch.setattr(turn, "_record_cost", lambda resp: 0.0)


# ── ReplyStream ────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("chunk", [1, 3, 7, 64, 4096])
def test_an_answer_streams_its_exact_decoded_reply_at_any_chunking(chunk):
    out, events = run(StreamModel(envelope(), chunk=chunk))
    assert streamed_text(events) == LONG == out["envelope"]["reply"]


def test_a_short_answer_is_held_and_arrives_with_the_envelope():
    out, events = run(StreamModel(envelope(reply="RSI measures momentum.")))
    assert events == []
    assert out["envelope"]["reply"] == "RSI measures momentum."


def test_nothing_is_streamed_before_the_hold_is_checked():
    seen = []
    rs = turn.ReplyStream(seen.append, allowed=True)
    raw = json.dumps(envelope())
    cut = raw.index('"reply"') + len('"reply": "') + turn.STREAM_HOLD - 20
    rs.feed(raw[:cut])
    assert seen == []
    rs.feed(raw[cut:])
    assert "".join(seen) == LONG


@pytest.mark.parametrize("disposition", ["apply", "propose", "clarify", "unsupported"])
def test_only_an_answer_ever_streams(disposition):
    seen = []
    rs = turn.ReplyStream(seen.append, allowed=True)
    for c in _chunks(json.dumps(envelope(disposition=disposition))):
        rs.feed(c)
    assert seen == []


def test_a_reply_written_before_its_disposition_never_streams():
    seen = []
    rs = turn.ReplyStream(seen.append, allowed=True)
    raw = '{"reply": ' + json.dumps(LONG) + ', "disposition": "answer"}'
    for c in _chunks(raw):
        rs.feed(c)
    assert seen == []


def test_an_answer_that_claims_work_is_never_streamed_and_ends_as_NOTHING_DONE():
    claim = "I've added RSI to your chart and switched it to weekly. " + LONG
    out, events = run(StreamModel(envelope(reply=claim)))
    assert streamed_text(events) == ""
    assert out["envelope"]["reply"] == turn.NOTHING_DONE


def test_a_not_allowed_call_streams_nothing():
    seen = []
    rs = turn.ReplyStream(seen.append, allowed=False)
    for c in _chunks(json.dumps(envelope())):
        rs.feed(c)
    assert seen == []


# ── run_turn: research and the local-result boundary ───────────────────────────────────────────────

def test_a_forced_research_question_streams_only_the_researched_answer(monkeypatch):
    monkeypatch.setattr(turn, "_research", lambda q, r: {"answer": "web text", "citations": ["https://x.example"]})
    first = envelope(reply="From memory: " + LONG)               # answered from memory → forced research
    second = envelope(reply="Researched: " + LONG)
    out, events = run(StreamModel(first, second), message="what's the latest news on NVDA?")
    kinds = [e["t"] for e in events]
    assert kinds.index("status") < kinds.index("delta")         # the search is announced, then the answer
    assert "retract" not in kinds                                # the memory answer never streamed at all
    assert streamed_text(events) == second["reply"] == out["envelope"]["reply"]


def test_a_streamed_placeholder_is_retracted_before_the_research_answer(monkeypatch):
    monkeypatch.setattr(turn, "_research", lambda q, r: {"answer": "web text", "citations": []})
    placeholder = envelope(reply="Let me look that up for you. " + LONG, research={"query": "AMD call", "recency": "week"})
    final = envelope(reply="Researched: " + LONG)
    out, events = run(StreamModel(placeholder, final), message="explain what AMD's CEO meant about margins")
    kinds = [e["t"] for e in events]
    assert kinds.index("retract") < kinds.index("status") < len(kinds) - 1
    after = events[kinds.index("status") + 1:]
    assert streamed_text(after) == final["reply"] == out["envelope"]["reply"]


def test_a_local_only_breadth_plan_streams_nothing_and_its_reply_stays_blank():
    caps = [{"name": "breadth.show", "target": "breadth", "summary": "breadth", "risk": "local",
             "args": {"type": "object", "properties": {"mode": {"type": "string"}}, "required": ["mode"],
                      "additionalProperties": False}}]
    plan = envelope(disposition="apply", reply=f"Breadth is {SENTINEL}% today. " + LONG,
                    ops=[{"action": "breadth.show", "target": "b1", "args": {"mode": "value"}}])
    out, events = run(StreamModel(plan), message="how's breadth today?", capabilities=caps)
    assert events == []
    assert SENTINEL not in json.dumps(out["envelope"])
    assert out["envelope"]["reply"] == ""


def test_a_mixed_request_planned_before_research_never_streams(monkeypatch):
    monkeypatch.setattr(turn, "_research", lambda q, r: {"answer": "web text", "citations": []})
    caps = [{"name": "chart.setTimeframe", "target": "chart", "summary": "tf", "risk": "local",
             "args": {"type": "object", "properties": {"timeframe": {"type": "string"}}, "required": ["timeframe"],
                      "additionalProperties": False}}]
    plan = envelope(disposition="apply", reply="", research={"query": "nvda news", "recency": "day"},
                    ops=[{"action": "chart.setTimeframe", "target": "c1", "args": {"timeframe": "W"}}])
    answer = envelope(reply="Researched: " + LONG)
    out, events = run(StreamModel(plan, answer), message="why is NVDA moving today? also make it weekly", capabilities=caps)
    assert streamed_text(events) == ""
    assert out["envelope"]["ops"] and out["envelope"]["reply"] == answer["reply"]


def test_stage_timings_are_numbers_only():
    out, _ = run(StreamModel(envelope()))
    st = out["usage"]["stages"]
    assert set(st) == {"build", "model", "research"}
    assert isinstance(st["build"], int) and all(isinstance(x, int) for x in st["model"]) and len(st["model"]) == 1


# ── the route ──────────────────────────────────────────────────────────────────────────────────────

def _client(monkeypatch):
    monkeypatch.setattr(rx, "_et_day", lambda: "2026-10-12")
    monkeypatch.setattr(rx, "is_paid_user", lambda u: True)
    from api.middleware.auth_middleware import get_current_user_with_plan
    app = FastAPI()
    app.include_router(rx.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: ADMIN
    return TestClient(app)


@pytest.fixture
def client(monkeypatch):
    daily_counters.clear()
    store._reset_for_tests()
    yield _client(monkeypatch)
    daily_counters.clear()


def _events(r):
    return [json.loads(line[6:]) for line in r.text.split("\n") if line.startswith("data: ")]


BODY = {"message": "what does RSI measure, in detail?", "context": {}, "capabilities": []}


def _install(monkeypatch, *envs):
    m = StreamModel(*envs)
    plain = iter(envs)
    monkeypatch.setattr(turn, "_default_stream_caller", m)
    monkeypatch.setattr(turn, "_default_caller", lambda **kw: _resp(next(plain)))
    return m


def test_flag_off_the_stream_is_one_final_event_equal_to_turn(client, monkeypatch):
    monkeypatch.delenv(rx.STREAM_ENV, raising=False)
    _install(monkeypatch, envelope(title="RSI Basics"), envelope(title="RSI Basics"))
    r = client.post("/api/agent/turn/stream", json=BODY)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    evs = _events(r)
    assert [e["t"] for e in evs] == ["final"]
    plain = client.post("/api/agent/turn", json=BODY).json()
    final = {k: v for k, v in evs[0].items() if k != "t"}
    assert final["envelope"] == plain["envelope"]
    assert set(final) == set(plain) and set(final["usage"]) == set(plain["usage"])


def test_flag_on_deltas_then_the_authoritative_final(client, monkeypatch):
    monkeypatch.setenv(rx.STREAM_ENV, "1")
    _install(monkeypatch, envelope())
    evs = _events(client.post("/api/agent/turn/stream", json=BODY))
    assert evs[-1]["t"] == "final" and all(e["t"] == "delta" for e in evs[:-1]) and len(evs) > 2
    assert "".join(e["text"] for e in evs[:-1]) == evs[-1]["envelope"]["reply"] == LONG


def test_a_refused_turn_is_an_error_event_with_turns_status_and_sentence(client, monkeypatch):
    monkeypatch.setenv(rx.STREAM_ENV, "1")
    monkeypatch.setattr(rx, "_take", lambda uid: False)
    evs = _events(client.post("/api/agent/turn/stream", json=BODY))
    assert evs == [{"t": "error", "status": 429, "detail": "You've reached today's UCT Agent limit."}]


def test_the_timing_log_line_carries_numbers_not_words(client, monkeypatch, caplog):
    monkeypatch.delenv(rx.STREAM_ENV, raising=False)
    secret = "my secret plan for TSLA"
    _install(monkeypatch, envelope(reply=f"About {secret}: " + LONG))
    with caplog.at_level(logging.INFO, logger=rx.log.name):
        d = client.post("/api/agent/turn", json={**BODY, "message": secret}).json()
    lines = [r.getMessage() for r in caplog.records if "turn timing" in r.getMessage()]
    assert len(lines) == 1 and secret not in lines[0] and "RSI" not in lines[0]
    assert {"pre", "build", "model", "research", "post", "server"} <= set(d["usage"]["stages"])


def test_the_stream_route_is_gzip_exempt():
    from api.main import _is_gzip_exempt
    assert _is_gzip_exempt("/api/agent/turn/stream")


# ── the board check's key filter ───────────────────────────────────────────────────────────────────

@pytest.fixture
def prefs_app(monkeypatch, tmp_path):
    from api.services import auth_db, auth_service
    from api.middleware.auth_middleware import get_current_user
    from api.routers import auth as auth_router
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "prefs.db"))
    auth_db.init_db()
    uid = "u-latency-prefs"
    auth_service.set_user_preference(uid, "charts_workspace_layout", json.dumps({"widgets": []}))
    auth_service.set_user_preference(uid, "charts_active_template", json.dumps({"id": 1, "scope": "user"}))
    auth_service.set_user_preference(uid, "tracings_doc", json.dumps({"doc": {"big": "x" * 5000}}))
    app = FastAPI()
    app.include_router(auth_router.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": uid, "role": "member"}
    return TestClient(app)


def test_keys_answers_only_those_keys_read_the_same_way(prefs_app):
    full = prefs_app.get("/api/auth/preferences").json()
    some = prefs_app.get("/api/auth/preferences?keys=charts_workspace_layout,charts_active_template").json()
    assert set(some) == {"charts_workspace_layout", "charts_active_template"}
    assert all(some[k] == full[k] for k in some)
    assert "tracings_doc" in full


def test_no_keys_is_the_whole_blob_unchanged(prefs_app):
    assert "tracings_doc" in prefs_app.get("/api/auth/preferences").json()
