"""UCT Agent Phase 2 — the server half (docs/agent/PHASE2.md)."""
from __future__ import annotations

import types

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import uct_agent as rx
from api.services import daily_counters, narrative_cost_guard
from api.services.uct_agent import store, turn

ADMIN = {"id": "38c023cf-0e81-4187-aa43-ac51a751a001", "plan": "pro", "role": "admin"}


@pytest.fixture
def client(monkeypatch):
    daily_counters.clear()
    store._reset_for_tests()
    narrative_cost_guard._reset_for_test(turn.COST_SURFACE)
    monkeypatch.setattr(rx, "is_paid_user", lambda u: True)
    from api.middleware.auth_middleware import get_current_user_with_plan
    app = FastAPI()
    app.include_router(rx.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: ADMIN
    yield TestClient(app)
    narrative_cost_guard._reset_for_test(turn.COST_SURFACE)
    daily_counters.clear()


def _caller(calls):
    env = '{"disposition":"answer","reply":"hi","question":null,"ops":[],"unsupported_category":null,"research":null,"title":null}'

    def call(**kw):
        calls.append(kw)
        return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=env)], stop_reason="end_turn",
                                     usage=types.SimpleNamespace(input_tokens=10_000, output_tokens=200))
    return call


def test_COST_CEILING_unset_changes_nothing(client, monkeypatch):
    calls = []
    monkeypatch.delenv(rx.COST_CAP_ENV, raising=False)
    monkeypatch.setattr(turn, "_default_caller", _caller(calls))
    narrative_cost_guard.record(turn.COST_SURFACE, "claude-haiku-4-5", cost_usd=999.0)
    assert client.post("/api/agent/turn", json={"message": "hi"}).status_code == 200
    assert calls


def test_COST_CEILING_set_refuses_BEFORE_the_model_call_once_reached(client, monkeypatch):
    calls = []
    monkeypatch.setenv(rx.COST_CAP_ENV, "0.05")
    monkeypatch.setattr(turn, "_default_caller", _caller(calls))
    assert client.post("/api/agent/turn", json={"message": "hi"}).status_code == 200     # $0.011 spent
    narrative_cost_guard.record(turn.COST_SURFACE, "claude-haiku-4-5", cost_usd=0.05)
    n = len(calls)
    r = client.post("/api/agent/turn", json={"message": "hi again"})
    assert r.status_code == 429 and "spending limit" in r.json()["detail"]
    assert len(calls) == n                                                              # no model call
    assert rx.over_cost_cap() is True


def test_COST_CEILING_also_stops_the_background_naming_call(monkeypatch):
    monkeypatch.setattr(rx, "over_cost_cap", lambda: True)
    named = []
    monkeypatch.setattr(turn, "name_conversation", lambda *a, **k: named.append(1) or "X")
    rx._name_unnamed(1, "c")
    assert named == []


def test_PROMPT_concepts_use_UCTs_own_definitions_never_invented_ones():
    p = turn._SYSTEM_HEAD + turn._SYSTEM_TAIL
    assert "starter or saved screens" in p and "never invent your own criteria" in p
    assert "Strongest\" means highest RS Rank (say so)" in p
    # still no capability names hard-coded in the generic prompt (the manifest carries them)
    import re
    assert not set(re.findall(r"\b(?:screener|watchlist|chart|layout)\.[a-z][A-Za-z]+\b", p)) - {"screener.run", "widget.addCharts"}


def test_LIVE_BATCH_scoring_and_refusals(monkeypatch, tmp_path, capsys):
    import importlib.util
    spec = importlib.util.spec_from_file_location("agent_live_batch", "tools/agent_live_batch.py")
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    item = {"want": {"actions": ["chart.setTimeframe"], "args": {"timeframe": "15"}, "noClarify": True}}
    assert m.score(item, {"disposition": "apply", "ops": [{"action": "chart.setTimeframe", "args": {"timeframe": "15"}}]})["ok"]
    assert not m.score(item, {"disposition": "clarify", "ops": []})["ok"]
    assert not m.score({"want": {"honest": True}}, {"disposition": "apply", "ops": [{"action": "indicator.add", "args": {"defId": "movingAverage"}}]})["ok"]
    bodies = tmp_path / "b.json"
    bodies.write_text("[]", encoding="utf-8")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    called = []
    monkeypatch.setattr(turn, "_default_caller", lambda **k: called.append(1))
    for argv, code in ((["x", str(bodies), "--run"], 2), (["x", str(bodies), "--run", "--max-usd", "1"], 2), (["x", str(bodies)], 0)):
        monkeypatch.setattr("sys.argv", argv)
        assert m.main() == code
    assert called == []                                          # never a model call without key + ceiling


def test_LIVE_BATCH_the_ceiling_is_checked_before_EVERY_call_and_nothing_else_is_paid_or_written(monkeypatch, tmp_path, capsys):
    import importlib.util
    import json as _json
    spec = importlib.util.spec_from_file_location("agent_live_batch2", "tools/agent_live_batch.py")
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    item = {"id": "x", "want": {"actions": []}, "body": {"message": "hi", "context": {}, "capabilities": [], "routing": None}}
    bodies = tmp_path / "b.json"
    bodies.write_text(_json.dumps([item, {**item, "id": "y"}]), encoding="utf-8")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-not-a-key")
    from api.services import engine
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: types.SimpleNamespace(models=types.SimpleNamespace(retrieve=lambda name: {"id": name})))
    calls, ledger, research = [], [], []
    monkeypatch.setattr(turn, "_default_caller", lambda **k: calls.append(k) or _caller([])(**k))
    monkeypatch.setattr(narrative_cost_guard, "record", lambda *a, **k: ledger.append(a))
    monkeypatch.setattr("api.services.perplexity_search.web_search", lambda **k: research.append(k), raising=False)
    # a ceiling below one call's worst case: NOTHING is called
    monkeypatch.setattr("sys.argv", ["x", str(bodies), "--run", "--max-usd", "0.001"])
    assert m.main() == 0 and calls == []
    assert "STOP before the next call" in capsys.readouterr().out
    # a ceiling that fits ONE call's worst case but not two: exactly one call, then it stops
    monkeypatch.setattr("sys.argv", ["x", str(bodies), "--run", "--max-usd", "0.02"])
    assert m.main() == 0
    assert len(calls) == 1
    assert ledger == [] and research == []                 # no ledger write, no research spend


def test_PROMPT_ranking_words_are_UCTs_own_never_invented():
    p = turn._SYSTEM_HEAD + turn._SYSTEM_TAIL
    assert '"weakest" means lowest RS Rank' in p
    assert "UCT Composite, the Screener's own default ranking (say so)" in p and "never a ranking of your own" in p


# ── EXECUTION TRUTHFULNESS: the remaining gap, pinned (stabilization review 2026-10-11) ──
# Only a BARE "Done."-style reply on a mutating plan is blanked (`_CLAIMS_DONE`). A first-person
# completion claim in `reply` / `question.text` on ANY disposition — including `answer` with no ops —
# reaches the member verbatim. When the proposed fix lands, this xfail turns into a pass (strict=True
# then FAILS the suite until the marker is removed — the gap cannot close silently either way).
CLAIMS_WITHOUT_EXECUTION = [
    ("answer", "I've switched your chart to the 15-minute timeframe."),
    ("answer", "Opening your Main Trading layout now."),
    ("answer", "Here are your strongest stocks, filtered to those above $50."),
    ("clarify", "I filtered your list to stocks above $50 — which list should I save them to?"),
]


@pytest.mark.xfail(strict=True, reason="GAP: model free-text completion claims are not yet checked (proposed fix in docs)")
@pytest.mark.parametrize("disp,text", CLAIMS_WITHOUT_EXECUTION)
def test_GAP_no_reply_claims_an_action_that_did_not_execute(disp, text):
    env = {"disposition": disp, "reply": text, "question": ({"text": text, "choices": []} if disp == "clarify" else None),
           "ops": [], "unsupported_category": None}
    out = turn.sanitize_envelope(env, set(), set())
    shown = out["question"]["text"] if disp == "clarify" else out["reply"]
    assert shown != text
