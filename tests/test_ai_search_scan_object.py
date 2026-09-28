"""TERM-087 (item 14 WF-C12) -- an AI Search answer returns the product's own
editable object: a SCAN the builder opens, beside the prose, never instead of it.

Every model call is faked at the CLIENT (`engine._get_anthropic_client`), never
at `definition_concierge._call_model`, so the concierge's real pipeline --
schema, canonical shape, budget, condition stage, linter, interpreter -- runs on
every case here. Perplexity is faked at `fast_lane_answer` / `stream_search`.
No network, no production store: the cost guard's SQLite, the AI Search log and
the usage ledger are all pointed at tmp paths.

The rails:
  * flag OFF -> no `scan_object` key and no model call, single AND stream;
  * flag ON, a non-screen ask -> nothing added, nothing spent;
  * flag ON, a screen ask -> a whole object that round-trips through the
    product's own validators and matches the builder door's answer exactly;
  * an invalid model output -> an honest refusal with NO tree and NO source;
  * an `ok` answer with a hole in it -> refused, never passed on;
  * a slow build -> a refusal on the final, never a hung answer.
"""
from __future__ import annotations

import importlib
import json
import time
from typing import Any, Dict, List

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.ai_search as ai
from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.services import ai_search_scan_object as so
from api.services import scan_definition, user_definitions

SCAN_ASK = "find stocks trading above their 50 day moving average"
PLAIN_ASK = "why is NVDA up today?"

#: `close > sma(close, 50)` -- a condition, the object a member would edit.
CONDITION = {"type": "op", "name": ">", "args": [
    {"type": "series", "name": "close"},
    {"type": "call", "name": "sma", "args": [
        {"type": "series", "name": "close"}, {"type": "num", "value": 50}]},
]}
#: `sma(close, 20)` -- a NUMBER. A fine indicator, a wrong screen.
NUMBER = {"type": "call", "name": "sma", "args": [
    {"type": "series", "name": "close"}, {"type": "num", "value": 20}]}
#: A name no table declares.
OUT_OF_TABLE = {"type": "call", "name": "nosuch_function", "args": [
    {"type": "series", "name": "close"}]}

PROSE = {"answer": "Several leaders are holding their 50-day.", "citations": [],
         "related_questions": [], "model": "sonar-pro", "cached": False}


# ═══ fakes ══════════════════════════════════════════════════════════════════

class _Block:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class FakeClient:
    """Scripted Anthropic client. ⛔ An unarmed call RAISES -- so "the flag off
    spends nothing" is falsifiable, not a fake that happily answers."""

    def __init__(self, answers: List[Any]):
        self.answers = list(answers)
        self.calls: List[dict] = []
        self.messages = self

    def with_options(self, **_):
        return self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if not self.answers:
            raise AssertionError(f"model called {len(self.calls)} times, armed "
                                 f"{len(self.calls) - 1}")
        return self.answers.pop(0)


def tool_use(tree, tool_id="tu_1"):
    from api.services import definition_concierge as dc
    block = _Block(type="tool_use", id=tool_id, name=dc.TOOL_NAME, input={"ast": tree})
    return _Block(content=[block], stop_reason="tool_use",
                  usage=_Block(input_tokens=120, output_tokens=40))


@pytest.fixture
def env(monkeypatch, tmp_path):
    """Isolate every store this path touches, reset the router's counters."""
    monkeypatch.setenv("CATALYST_DB_PATH", str(tmp_path / "catalysts.db"))
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(tmp_path / "ai_search_log.db"))
    monkeypatch.delenv(so.FLAG_ENV, raising=False)
    from api.services.catalyst import store as _store
    importlib.reload(_store)
    _store._init_db()
    from api.services import definition_concierge as dc
    dc.reset_spend()
    ai._usage_day = ""
    ai._usage_by_user = {}
    ai._usage_global = 0
    ai._usage_seeded_day = None
    ai._stats = ai._fresh_stats()
    monkeypatch.setattr(ai, "_grounded_system", lambda q: ("SYSTEM", "", ai._empty_meta()))
    monkeypatch.setattr(ai, "_log_answer", lambda **k: None)
    monkeypatch.setattr(ai, "_persist_usage", lambda *a, **k: None)
    monkeypatch.setattr(ai, "fast_lane_answer", lambda *a, **k: dict(PROSE))
    yield monkeypatch
    dc.reset_spend()
    monkeypatch.delenv("CATALYST_DB_PATH", raising=False)
    importlib.reload(_store)


def arm(monkeypatch, answers):
    client = FakeClient(answers)
    monkeypatch.setattr("api.services.engine._get_anthropic_client", lambda: client)
    return client


def flag_on(monkeypatch):
    monkeypatch.setenv(so.FLAG_ENV, "1")


def _client(*routers):
    app = FastAPI()
    for r in routers or (ai.router,):
        app.include_router(r)
    who = {"id": 7, "role": "user", "plan": "pro"}
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who)
    return TestClient(app)


def _sse(text: str) -> List[dict]:
    return [json.loads(line[6:]) for line in text.splitlines() if line.startswith("data: ")]


def _stream_final(monkeypatch, query: str) -> dict:
    async def fake_stream(q, **kw):
        yield {"type": "delta", "text": PROSE["answer"]}
        yield {"type": "final", **PROSE}
    monkeypatch.setattr(ai.perplexity_search, "stream_search", fake_stream)
    r = _client().post("/api/ai-search/stream", json={"query": query})
    assert r.status_code == 200, r.text
    finals = [e for e in _sse(r.text) if e.get("type") == "final"]
    assert len(finals) == 1, finals
    return finals[0]


REFUSAL_KEYS = {"ok", "kind", "gate", "reason"}


# ═══ 1. flag OFF: nothing changes ═══════════════════════════════════════════

def test_flag_off_single_answer_is_unchanged_and_spends_nothing(env):
    client = arm(env, [])                      # any model call would raise
    r = _client().post("/api/ai-search", json={"query": SCAN_ASK})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "scan_object" not in body
    assert body["answer"] == PROSE["answer"]
    assert client.calls == []


def test_flag_off_stream_final_is_unchanged(env):
    client = arm(env, [])
    final = _stream_final(env, SCAN_ASK)
    assert "scan_object" not in final
    assert final["answer"] == PROSE["answer"]
    assert client.calls == []


def test_flag_on_a_question_that_is_not_a_screen_adds_nothing(env):
    flag_on(env)
    client = arm(env, [])
    r = _client().post("/api/ai-search", json={"query": PLAIN_ASK})
    assert "scan_object" not in r.json()
    assert client.calls == []


# ═══ 2. flag ON: the object, whole, through the product's validators ═══════

def test_a_screen_ask_returns_the_editable_object_BESIDE_the_prose(env):
    flag_on(env)
    arm(env, [tool_use(CONDITION)])
    body = _client().post("/api/ai-search", json={"query": SCAN_ASK}).json()

    # ⛔ PROSE BESIDE THE OBJECT, NEVER INSTEAD OF IT.
    assert body["answer"] == PROSE["answer"]
    obj = body["scan_object"]
    assert obj["ok"] is True, obj
    assert obj["kind"] == "scan"
    assert obj["ast"] == CONDITION

    # ⭐ THE ROUND TRIP, THROUGH THE PRODUCT'S OWN VALIDATORS -- the store's
    # canonical-shape door and the screener's condition classifier -- and the
    # source is the printer's spelling of exactly this tree.
    from api.services import definition_concierge as dc
    user_definitions.assert_canonical(obj["ast"])
    assert scan_definition.is_boolean_tree(obj["ast"]) is True
    assert obj["source"] == dc.formula_for(obj["ast"])
    assert isinstance(obj["import_id"], str) and obj["import_id"]


def test_the_object_is_the_SAME_object_the_builder_door_proposes(env):
    """⭐ PARITY, NOT A LOOKALIKE. The builder's English box and this door, fed
    the same model answer, hand back the same tree (by the store's own hash)
    and the same source. A parallel generator would drift from this the first
    time either was edited."""
    flag_on(env)
    from api.routers import user_definitions as ud_router
    arm(env, [tool_use(CONDITION), tool_use(CONDITION)])
    c = _client(ai.router, ud_router.router)
    via_ai = c.post("/api/ai-search", json={"query": SCAN_ASK}).json()["scan_object"]
    via_builder = c.post("/api/user-definitions/propose",
                         json={"prompt": SCAN_ASK, "kind": "scan"}).json()
    assert via_builder["ok"] is True, via_builder
    assert user_definitions.ast_hash(via_ai["ast"]) == user_definitions.ast_hash(via_builder["ast"])
    assert via_ai["source"] == via_builder["source"]
    for k in ("repaint", "freshness", "cadence"):
        assert via_ai[k] == via_builder[k], k


def test_the_stream_final_carries_the_object(env):
    flag_on(env)
    arm(env, [tool_use(CONDITION)])
    final = _stream_final(env, SCAN_ASK)
    assert final["answer"] == PROSE["answer"]
    assert final["scan_object"]["ok"] is True
    assert final["scan_object"]["ast"] == CONDITION


# ═══ 3. an invalid model output is REFUSED, never half-applied ══════════════

@pytest.mark.parametrize("bad, gate", [
    (NUMBER, "scan:not-a-condition"),
    (OUT_OF_TABLE, None),
])
def test_an_invalid_model_output_is_an_honest_refusal_with_no_tree(env, bad, gate):
    flag_on(env)
    client = arm(env, [tool_use(bad), tool_use(bad, "tu_2")])   # generate + ONE repair
    body = _client().post("/api/ai-search", json={"query": SCAN_ASK}).json()
    obj = body["scan_object"]
    assert obj["ok"] is False, obj
    # ⛔ NOTHING BUT THE REFUSAL: no `ast`, no `source`, no `import_id` a client
    # could mistake for something to open.
    assert set(obj) == REFUSAL_KEYS, obj
    assert obj["reason"]
    if gate:
        assert obj["gate"] == gate
    assert len(client.calls) == 2
    # …and the prose answer still stands on its own.
    assert body["answer"] == PROSE["answer"]


def test_the_stream_refusal_is_the_same_honest_refusal(env):
    flag_on(env)
    arm(env, [tool_use(NUMBER), tool_use(NUMBER, "tu_2")])
    obj = _stream_final(env, SCAN_ASK)["scan_object"]
    assert set(obj) == REFUSAL_KEYS and obj["gate"] == "scan:not-a-condition"


@pytest.mark.parametrize("half", [
    {"ok": True, "kind": "scan", "ast": CONDITION},                        # no source
    {"ok": True, "kind": "scan", "source": "(close > open)"},              # no tree
    {"ok": True, "kind": "scan", "source": "   ", "ast": CONDITION},       # blank source
    {"ok": True, "kind": "indicator", "source": "sma(close, 20)", "ast": NUMBER},
])
def test_an_ok_answer_with_a_hole_in_it_is_refused_not_passed_on(half):
    obj = so.shape(half, "imp")
    assert obj == so.refusal("object:incomplete")
    assert set(obj) == REFUSAL_KEYS


def test_a_refusal_never_carries_a_tree_even_if_one_was_planted():
    obj = so.shape({"ok": False, "gate": "lint:repaint", "reason": "it repaints",
                    "ast": CONDITION, "source": "(close > open)"}, "imp")
    assert set(obj) == REFUSAL_KEYS
    assert obj["gate"] == "lint:repaint" and obj["reason"] == "it repaints"


# ═══ 4. the bound: an answer never hangs on its object ═════════════════════

def test_a_slow_build_becomes_a_refusal_on_the_final_not_a_hang(env):
    flag_on(env)
    env.setattr(so, "WAIT_SECONDS", 0.05)
    env.setattr(so, "emit", lambda q, uid: (time.sleep(0.5), {"ok": True})[1])
    body = _client().post("/api/ai-search", json={"query": SCAN_ASK}).json()
    assert body["scan_object"] == so.refusal("object:timeout")
    final = _stream_final(env, SCAN_ASK)
    assert final["scan_object"] == so.refusal("object:timeout")


def test_a_crashing_build_is_a_refusal(env):
    flag_on(env)

    def boom(*a, **k):
        raise RuntimeError("concierge exploded")
    from api.services import definition_concierge as dc
    env.setattr(dc, "propose", boom)
    body = _client().post("/api/ai-search", json={"query": SCAN_ASK}).json()
    assert body["scan_object"] == so.refusal("object:error")


# ═══ 5. observability: the builder's own telemetry, its own dialect ═══════

def test_the_door_logs_through_the_builders_telemetry_under_its_own_dialect(env):
    flag_on(env)
    arm(env, [tool_use(CONDITION)])
    seen: List[Dict[str, Any]] = []
    from api.services import indicator_telemetry
    env.setattr(indicator_telemetry, "log_event",
                lambda uid, event, **kw: seen.append({"event": event, **kw}) or True)
    obj = _client().post("/api/ai-search", json={"query": SCAN_ASK}).json()["scan_object"]
    events = [(e["event"], e.get("dialect"), e.get("import_id")) for e in seen]
    assert ("import_submitted", "ai-search", obj["import_id"]) in events
    finished = [e for e in seen if e["event"] == "compile_finished"]
    assert finished and finished[0]["success"] is True
    assert finished[0]["import_id"] == obj["import_id"]


# ═══ 6. which asks read as a screen ════════════════════════════════════════

@pytest.mark.parametrize("q", [
    SCAN_ASK,
    "show me stocks with rs_rank over 80",
    "screen for names closing above the open",
    "can you list tickers where the close is above the 200 day",
    "scan for high tight flags",
])
def test_screen_shaped_asks_are_recognised(q):
    assert so.looks_like_scan_ask(q) is True


@pytest.mark.parametrize("q", [
    PLAIN_ASK,
    "show me stocks moving today",
    "what are the best stocks",
    "alert me when NVDA breaks 190",
    "",
])
def test_other_asks_are_not(q):
    assert so.looks_like_scan_ask(q) is False


def test_the_flag_is_read_per_call(monkeypatch):
    monkeypatch.delenv(so.FLAG_ENV, raising=False)
    assert so.wanted(SCAN_ASK) is False
    monkeypatch.setenv(so.FLAG_ENV, "1")
    assert so.wanted(SCAN_ASK) is True
    monkeypatch.setenv(so.FLAG_ENV, "0")
    assert so.wanted(SCAN_ASK) is False
