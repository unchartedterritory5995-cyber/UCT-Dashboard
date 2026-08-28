"""Agent-lane rails (2026-08-28): the one-brain tool loop. Every LLM call is
faked; the loop's mechanics (tool dispatch through the SHARED voice registry,
citation indexing, off-allowlist refusal, step budget), the read-only
allowlist discipline, the dollar-cap gate, and the stream endpoint's
activity/final/fallback contract."""
import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.ai_search as ai
import api.services.ai_search_agent as agent
from api.middleware.auth_middleware import (
    get_current_user,
    get_current_user_with_plan,
)


def _client(user_id=1, role="user", plan="pro"):
    app = FastAPI()
    app.include_router(ai.router)
    who = {"id": user_id, "role": role, "plan": plan}
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who)
    return TestClient(app)


def _reset():
    # Flush the async ledger writer + wipe today's durable rows so the seed
    # can't inherit another test's units (same hygiene as the resilience suite).
    try:
        ai._USAGE_IO.submit(lambda: None).result(timeout=5)
    except Exception:
        pass
    ai._usage_day = ""
    ai._usage_by_user = {}
    ai._usage_global = 0
    ai._usage_seeded_day = None
    ai._stats = ai._fresh_stats()
    try:
        import contextlib
        import api.services.ai_search_log as _ail
        _ail._reset_for_tests()
        import os
        if os.path.isdir(os.path.dirname(_ail._db_path()) or "."):
            _ail._ensure_init()
            with contextlib.closing(_ail._connect()) as _c:
                _c.execute("DELETE FROM ai_search_usage")
                _c.commit()
    except Exception:
        pass


class _Blk:
    def __init__(self, type_, **kw):
        self.type = type_
        for k, v in kw.items():
            setattr(self, k, v)


class _Resp:
    def __init__(self, blocks):
        self.content = blocks
        self.usage = None


class _FakeClient:
    """Scripted Anthropic client: pops one response per messages.create."""
    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def with_options(self, **kw):
        return self

    class _M:
        def __init__(self, outer):
            self.outer = outer

        def create(self, **kw):
            self.outer.calls.append(kw)
            return self.outer.script.pop(0)

    @property
    def messages(self):
        return self._M(self)


def _wire(monkeypatch, script):
    fake = _FakeClient(script)
    import api.services.engine as engine
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: fake, raising=False)
    import api.services.narrative_cost_guard as guard
    monkeypatch.setattr(guard, "record_from_response", lambda *a, **k: 0.0)
    monkeypatch.setattr(guard, "spend_today_usd", lambda s: 0.0)
    # a tiny fake registry so _tool_schemas doesn't import the 150-tool module
    import api.services.voice_tools as vt
    monkeypatch.setattr(vt, "_REGISTRY", {
        "get_quote": {"name": "get_quote", "description": "live quote",
                      "parameters": {"symbol": {"type": "string"}},
                      "contexts": {"global"}, "wants_user": False,
                      "fn": lambda symbol: {"ok": True, "last": 252.05, "symbol": symbol}},
    })
    import sys, types
    monkeypatch.setitem(sys.modules, "api.services.voice_tool_impls", types.ModuleType("api.services.voice_tool_impls"))
    return fake


def test_agent_loop_dispatches_shared_tools_and_answers(monkeypatch):
    fake = _wire(monkeypatch, [
        _Resp([_Blk("tool_use", id="t1", name="get_quote", input={"symbol": "CRM"})]),
        _Resp([_Blk("text", text="CRM trades at $252.05 per UCT desk data.")]),
    ])
    out = agent.run_agent("where is CRM trading?", "SYSTEM", [], None)
    assert out["answer"].startswith("CRM trades")
    assert out["tools_used"] == ["get_quote"]
    # the tool result reached the second call as a tool_result block
    second_msgs = fake.calls[1]["messages"]
    tr = second_msgs[-1]["content"][0]
    assert tr["type"] == "tool_result" and "252.05" in tr["content"]


def test_web_search_tool_collects_globally_indexed_citations(monkeypatch):
    _wire(monkeypatch, [
        _Resp([_Blk("tool_use", id="t1", name="web_search", input={"query": "CRM earnings"})]),
        _Resp([_Blk("tool_use", id="t2", name="web_search", input={"query": "CRM guidance"})]),
        _Resp([_Blk("text", text="Beat and raised [1][2].")]),
    ])
    import api.services.perplexity_search as pplx
    calls = {"n": 0}

    def fake_web(q, **kw):
        calls["n"] += 1
        return {"answer": f"finding {calls['n']}",
                "citations": ["https://a.com/1"] if calls["n"] == 1
                else ["https://b.com/2", "https://a.com/1"]}

    monkeypatch.setattr(pplx, "web_search", fake_web)
    out = agent.run_agent("CRM after the print?", "SYSTEM", [], None)
    assert out["citations"] == ["https://a.com/1", "https://b.com/2"]   # deduped, stable
    assert out["tools_used"] == ["web_search"]


def test_off_allowlist_tool_is_refused_not_dispatched(monkeypatch):
    _wire(monkeypatch, [
        _Resp([_Blk("tool_use", id="t1", name="create_position", input={})]),
        _Resp([_Blk("text", text="understood.")]),
    ])
    called = []
    import api.services.voice_tools as vt
    monkeypatch.setattr(vt, "dispatch", lambda *a, **k: called.append(a) or {"ok": True})
    out = agent.run_agent("buy CRM for me", "SYSTEM", [], None)
    assert out["answer"] == "understood."
    assert called == [], "an off-allowlist (write) tool must NEVER be dispatched"


def test_step_budget_exhaustion_is_an_error(monkeypatch):
    _wire(monkeypatch, [
        _Resp([_Blk("tool_use", id=f"t{i}", name="get_quote", input={"symbol": "CRM"})])
        for i in range(agent._MAX_STEPS)
    ])
    out = agent.run_agent("loop forever", "SYSTEM", [], None)
    assert not out["answer"] and "budget" in out["error"]


def test_allowlist_is_read_only_by_naming_discipline():
    # Structural rail: every allowed tool is a reader. A write tool
    # (create_/add_/close_/cancel_/change_/flag_…) slipping in here would give
    # the ask box unconsented mutations.
    for name in agent._AGENT_ALLOWED:
        assert name.split("_")[0] in ("get", "find", "grade", "ask"), name


def test_available_gates_on_the_dollar_cap(monkeypatch):
    import api.services.narrative_cost_guard as guard
    monkeypatch.setattr(guard, "spend_today_usd", lambda s: 99.0)
    assert agent.available() is False


def _read_sse(text):
    out = []
    for block in text.split("\n\n"):
        block = block.strip()
        if block.startswith("data:"):
            out.append(json.loads(block[5:]))
    return out


def test_stream_agent_mode_emits_activity_then_final(monkeypatch):
    _reset()
    monkeypatch.setattr(ai, "_grounded_system", lambda q: ("SYSTEM", "", ai._empty_meta()))
    import api.services.ai_search_agent as ag
    monkeypatch.setattr(ag, "available", lambda: True)

    def fake_run(query, system, history, user, emit=None, cancel=None):
        if emit:
            emit("checking the live quote — CRM…")
        return {"answer": "CRM is strong.", "citations": ["https://x.com/1"],
                "tools_used": ["get_quote", "web_search"]}

    monkeypatch.setattr(ag, "run_agent", fake_run)
    r = _client().post("/api/ai-search/stream", json={"query": "how is CRM?", "mode": "agent"})
    assert r.status_code == 200
    events = _read_sse(r.text)
    assert events[0]["type"] == "meta" and events[0]["mode"] == "agent"
    assert any(e.get("type") == "activity" for e in events)
    final = [e for e in events if e.get("type") == "final"][-1]
    assert final["answer"] == "CRM is strong." and final["mode"] == "agent"
    assert final["grounding"]["intents"] == ["get_quote", "web_search"]
    assert ai._usage_global == 2   # agent bills 2 units


def test_stream_agent_unavailable_falls_back_to_auto(monkeypatch):
    _reset()
    import api.services.ai_search_agent as ag
    monkeypatch.setattr(ag, "available", lambda: False)

    async def fake_stream(query, **kw):
        yield {"type": "final", "answer": "fast answer", "citations": [],
               "related_questions": [], "cached": False}

    monkeypatch.setattr(ai.perplexity_search, "stream_search", fake_stream)
    r = _client().post("/api/ai-search/stream", json={"query": "how is CRM?", "mode": "agent"})
    events = _read_sse(r.text)
    assert events[0]["mode"] == "fast"   # graceful degrade, never a dead lane
    assert [e for e in events if e.get("type") == "final"][-1]["answer"] == "fast answer"
    assert ai._usage_global == 1


def test_stream_agent_empty_walks_the_ladder(monkeypatch):
    _reset()
    monkeypatch.setattr(ai, "_grounded_system", lambda q: ("SYSTEM", "", ai._empty_meta()))
    import api.services.ai_search_agent as ag
    monkeypatch.setattr(ag, "available", lambda: True)
    monkeypatch.setattr(ag, "run_agent",
                        lambda *a, **k: {"answer": "", "error": "agent llm error"})
    monkeypatch.setattr(ai.perplexity_search, "web_search",
                        lambda *a, **k: {"answer": "fallback web answer", "citations": [],
                                         "related_questions": [], "cached": False})
    r = _client().post("/api/ai-search/stream", json={"query": "how is CRM?", "mode": "agent"})
    final = [e for e in _read_sse(r.text) if e.get("type") == "final"][-1]
    assert final["answer"] == "fallback web answer"
    assert ai._usage_global == 1   # 2 agent units refunded, 1 fast unit billed
