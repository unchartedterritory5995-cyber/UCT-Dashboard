"""UCT Agent program, agent-qa: ADR-005 L2 / L6 proofs (agent-lead's adr005-l2-l5-l6), audit cells #8 and #17.

Every proof has a CONTROL (the same sentinel, unmarked, IS forwarded), so a strip that removed everything would
fail. Two strict OPEN pins mark where the layers do NOT reach by design, for agent-lead to decide:
  F-21  copy-out: L2 marks the ENVELOPE only. `env.data`, a row, or a value copied out of it carries no marker,
        so L5/L6 cannot see it. That is exactly how a capability answer is built; L3 + L4 hold that boundary.
  F-22  L6 runs inside `run_turn` only. The conversation-NAMING call (`name_conversation`, router
        `_name_unnamed`) reads stored rows without `strip_isolated_request`.
The browser half (L5) is app/src/agent/qa/isolationLayers.test.jsx.
"""
from __future__ import annotations

import json
import types

import pytest

from api.services.uct_agent import turn
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw

# token-aware sentinels, shared (tests/test_uct_agent_qa_sentinels.py)
from tests.test_uct_agent_qa_sentinels import SENT_NUM as SENT, leaks as _leaks
OK = "UNMARKED-CONTROL-55"
KINDS_ENV = "UCT_AGENT_DATA_KINDS"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for k in (gw.DATA_ENV, gw.SCAN_ENV, gw.ISOLATED_ENV, KINDS_ENV):
        monkeypatch.delenv(k, raising=False)
    gw._reset_for_test(None)
    yield
    gw._reset_for_test(None)


def marked(**extra):
    return {"isolated": True, "kind": "ratings", "data": {"composite": float(SENT)}, **extra}


# ── L2: the gateway stamps the marker ─────────────────────────────────────────────────────────────────────────
def _activated(monkeypatch, name):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")
    monkeypatch.setenv(KINDS_ENV, name)


def _kind_with(name, fn):
    k = gw.registry().get(name)
    r = gw.Registry()
    r.register(gw.Kind(name=name, fn=fn, freshness=k.freshness, category=k.category, owner=k.owner,
                       max_symbols=k.max_symbols, validate=None, model_isolated=k.model_isolated))
    return r


@pytest.mark.parametrize("name", ["breadth.current", "ratings"])
@pytest.mark.parametrize("adapter_says", [None, False, "true", 0])
def test_L2_an_isolated_read_is_stamped_True_whatever_the_adapter_wrote(monkeypatch, name, adapter_says):
    _activated(monkeypatch, name)
    k = gw.registry().get(name)

    def fn(params, ctx):
        e = env.make_envelope(name, params, status="ok", freshness=k.freshness, as_of="2026-10-30T20:00:00Z",
                              source="x", data={"v": 1})
        if adapter_says is not None:
            e["isolated"] = adapter_says
        return e
    gw._reset_for_test(_kind_with(name, fn))
    out = gw.read(name, {"symbol": "NVDA"} if k.max_symbols else {}, user_id=1, turn_id="l2", purpose="answer")
    assert out["isolated"] is True, out                     # stamped by the gateway, never left to the adapter
    if adapter_says is not None:                              # a non-true value breaks MD-1: the read is replaced
        assert out["status"] == "unavailable" and out["data"] is None, out


def test_L2_CONTROL_a_non_isolated_kind_carries_no_marker(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(KINDS_ENV, "quote")
    k = gw.registry().get("quote")
    gw._reset_for_test(_kind_with("quote", lambda p, c: env.make_envelope(
        "quote", p, status="ok", freshness=k.freshness, as_of="2026-10-30T20:00:00Z", source="x", data={"v": 1})))
    out = gw.read("quote", {"symbol": "NVDA"}, user_id=1, turn_id="c", purpose="answer")
    assert out["status"] == "ok" and "isolated" not in out


@pytest.mark.parametrize("bad", [False, "true", 1, None])
def test_L2_validation_rejects_any_marker_value_but_True(bad):
    e = env.make_envelope("ratings", {}, status="ok", freshness="periodic", as_of="2026-10-30T20:00:00Z", source="x", data={})
    assert env.validate_envelope({**e, "isolated": True}) == []
    assert env.validate_envelope({**e, "isolated": bad}), bad


@pytest.mark.parametrize("name", ["breadth.current", "ratings"])
def test_L2_F21_OPEN_PIN_the_marker_is_on_the_envelope_only_not_on_its_data_or_rows(monkeypatch, name):
    """F-21 (agent-lead): a capability builds its answer from `env.data`/rows. Copied out, they carry no marker, so
    L5/L6 cannot recognise them. Suggest stamping `data` (and each row) too. STRICT pin: fails when they are marked."""
    _activated(monkeypatch, name)
    k = gw.registry().get(name)
    gw._reset_for_test(_kind_with(name, lambda p, c: env.make_envelope(
        name, p, status="ok", freshness=k.freshness, as_of="2026-10-30T20:00:00Z", source="x",
        data={"rows": [{"v": float(SENT)}]})))
    out = gw.read(name, {"symbol": "NVDA"} if k.max_symbols else {}, user_id=1, turn_id="f21", purpose="answer")
    assert out["isolated"] is True
    assert "isolated" not in out["data"] and "isolated" not in out["data"]["rows"][0]


# ── L6: run_turn strips marked objects from every model-bound input ───────────────────────────────────────────
_ANSWER = '{"disposition":"answer","reply":"ok","question":null,"ops":[],"unsupported_category":null,"research":null,"title":null}'


@pytest.fixture
def scripted(monkeypatch):
    monkeypatch.setattr(turn, "_record_cost", lambda resp: 0.0)
    monkeypatch.setattr(turn, "_research", lambda q, r: pytest.fail("no research in this rail"))
    calls = []

    def call(**kw):
        calls.append(kw)
        return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=_ANSWER)], stop_reason="end_turn",
                                     usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))
    return call, calls


def sent(calls) -> str:
    assert calls, "no model call: vacuous"
    return json.dumps([{k: c.get(k) for k in ("system", "messages")} for c in calls], default=str)


def test_L6_marked_objects_at_ANY_depth_in_context_are_never_sent_and_an_unmarked_sibling_is(scripted):
    call, calls = scripted
    ctx = {"charts": [{"ref": "c1", "label": OK, "deep": {"list": [marked(), {"keep": OK}]}}], "top": marked()}
    turn.run_turn(message="hello", context=ctx, history=[], caller=call)
    s = sent(calls)
    assert SENT not in _leaks(s)
    assert s.count(OK) >= 2, "CONTROL: the unmarked siblings are forwarded"


def test_L6_a_wholly_marked_context_becomes_empty_never_partial(scripted):
    call, calls = scripted
    turn.run_turn(message=f"hello {OK}", context=marked(), history=[], caller=call)
    s = sent(calls)
    assert SENT not in _leaks(s) and OK in s


@pytest.mark.parametrize("field", ["pending", "reference"])
def test_L6_pending_and_reference_are_stripped_too(scripted, field):
    call, calls = scripted
    kw = {field: {"a": marked(), "b": OK}}
    turn.run_turn(message="hello", context={}, history=[], caller=call, **kw)
    s = sent(calls)
    assert SENT not in _leaks(s)
    if field == "pending":                                   # pending is always forwarded; reference only under NL-1
        assert OK in s, "CONTROL"


@pytest.mark.parametrize("role", ["outcome", "agent"])
def test_L6_a_stored_row_carrying_a_marked_object_is_replayed_as_unreadable_text_and_all(scripted, role):
    call, calls = scripted
    data = {"kind": "answered", "actions": ["chart.setType"], "views": [marked()]} if role == "outcome" else \
        {"envelope": {"disposition": "apply", "ops": [{"action": "chart.setType", "args": {}}]}, "attach": marked()}
    hist = [{"role": "member", "text": f"q {OK}", "data": {}},
            {"role": role, "text": f"it is {SENT}", "data": data}]
    turn.run_turn(message="and?", context={}, history=hist, caller=call)
    s = sent(calls)
    assert SENT not in _leaks(s), "the row's TEXT is not replayed once its data carries the marker"
    assert OK in s, "CONTROL: the member's own words are"


def test_L6_CONTROL_the_same_row_WITHOUT_the_marker_is_replayed(scripted):
    call, calls = scripted
    hist = [{"role": "member", "text": "q", "data": {}},
            {"role": "outcome", "text": f"it is {SENT}", "data": {"kind": "answered", "actions": ["chart.setType"]}}]
    turn.run_turn(message="and?", context={}, history=hist, caller=call)
    assert SENT in _leaks(sent(calls)), "the detector can see a replayed value"


def test_L6_the_strip_is_logged_as_a_count_never_its_content(scripted, caplog):
    call, calls = scripted
    with caplog.at_level("DEBUG"):
        turn.run_turn(message="hello", context={"x": marked()}, history=[], caller=call)
    assert "removed 1 isolated value" in caplog.text and SENT not in _leaks(caplog.text)


def test_L6_F21_OPEN_PIN_a_value_COPIED_OUT_of_an_isolated_read_passes_the_strip(scripted):
    """The other side of F-21: the composite copied into an unmarked object is forwarded. L3/L4 must hold."""
    call, calls = scripted
    turn.run_turn(message="hello", context={"stock": {"composite": float(SENT)}}, history=[], caller=call)
    assert SENT in _leaks(sent(calls))


def test_L6_F22_OPEN_PIN_the_naming_call_does_not_go_through_strip_isolated_request():
    """F-22 (agent-lead): `name_conversation` reads stored member/agent TEXT without the L6 strip. An agent row whose
    data carries the marker is still read (only `is_local_row` is consulted, and it knows action names, not the
    marker). Latent: agent text is the model's own words. STRICT pin: fails when naming applies the marker check."""
    rows = [{"role": "member", "text": "q", "data": {}},
            {"role": "agent", "text": f"reads {SENT}",
             "data": {"envelope": {"disposition": "answer", "ops": []}, "attach": marked()}}]
    seen = []

    def caller(**kw):
        seen.append(kw)
        return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text='{"title": "t"}')], usage=None)
    turn.name_conversation(rows, caller=caller)
    assert seen, "vacuous"
    assert SENT in _leaks(json.dumps(seen, default=str))
