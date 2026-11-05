"""E-1 evidence routing (owner 2026-11-04; docs/agent/knowledge/EVIDENCE-ROUTING-DESIGN.md).

Scripted classifier and scripted planner only: no network, no cost. The classifier is `evidence.CALL`; the planner
is run_turn's `caller`. Brain's switch is UCT_AGENT_KNOWLEDGE (monkeypatched per test).
"""
from __future__ import annotations

import json
import types

import pytest

from api.services.uct_agent import turn
from api.services.uct_agent.knowledge import evidence as ev
from tests.test_uct_agent import CAPS, CTX, OP, _resp, caller_of, env
from tests.test_uct_agent_knowledge_reply import ALL, INVENTED, KCAPS, KCTX, LONG
from tests.test_uct_agent_spend_limits import ZERO_SITE, clean  # noqa: F401  (the real budget ledger fixture)

VOCAB = [{"name": "Episodic Pivot", "aliases": ["EP"]}, {"name": "Undercut & Rally", "aliases": ["U&R"]}]
NAMES = [s["name"] for s in VOCAB]
PROPOSE_CAP = {"name": "watchlist.delete", "domain": "watchlist", "target": "chart", "summary": "Delete a watchlist.",
               "hints": None, "risk": "confirm", "reversible": False,
               "args": {"type": "object", "properties": {}, "required": [], "additionalProperties": False}}


def cls(evidence="playbook", topic="setup_definition", setups=("Episodic Pivot",), concept="EP", chart_ask=False):
    return {"evidence": evidence, "topic": topic, "setups": list(setups), "concept": concept, "chart_ask": chart_ask}


def _cresp(obj=None, text=None, stop="end_turn"):
    t = text if text is not None else json.dumps(obj)
    return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=t)], stop_reason=stop,
                                 usage=types.SimpleNamespace(input_tokens=1500, output_tokens=40))


class Classifier:
    def __init__(self, *outs):
        self.outs, self.calls = list(outs), []

    def __call__(self, **kw):
        self.calls.append(kw)
        o = self.outs[min(len(self.calls), len(self.outs)) - 1]
        if isinstance(o, BaseException):
            raise o
        return o if isinstance(o, types.SimpleNamespace) else _cresp(o)


JUDGE_CLEAR = {"prescribes_trading_action": False, "presents_uct_methodology": False, "defines_a_setup": False}


def no_planner(**kw):
    raise AssertionError("the planner must not be called on this path")


@pytest.fixture(autouse=True)
def _brain(monkeypatch):
    monkeypatch.setenv("UCT_AGENT_KNOWLEDGE", "1")
    monkeypatch.setenv(ev.E1_FLAG, "1")
    monkeypatch.setattr(ev, "pack_present", lambda: True)
    monkeypatch.setattr(ev, "approved_setups", lambda: [dict(s) for s in VOCAB])
    monkeypatch.setattr(turn, "_record_cost", lambda resp: 0.001)
    monkeypatch.setattr(ev, "_priced", lambda resp, model_id: 0.001)           # never the real cost ledger in tests
    monkeypatch.setattr(ev, "CALL", Classifier(cls()))
    monkeypatch.setattr(ev, "JUDGE_CALL", Classifier(JUDGE_CLEAR))     # the scripted output judge: all false by default
    ev._reset_for_test()
    yield
    ev._reset_for_test()


def use(monkeypatch, *outs):
    c = Classifier(*outs)
    monkeypatch.setattr(ev, "CALL", c)
    return c


def run(message, caller=no_planner, caps=ALL, ctx=KCTX, **kw):
    return turn.run_turn(message=message, context=ctx, history=kw.pop("history", []), capabilities=caps, caller=caller, **kw)


def offered_to_planner(call_kw) -> str:
    return json.dumps(call_kw.get("system")) + json.dumps(call_kw.get("output_config"))


# ── switch ───────────────────────────────────────────────────────────────────────────────────────────────────
def test_brain_off_the_classifier_never_runs_and_the_turn_is_the_planners(monkeypatch):
    monkeypatch.delenv("UCT_AGENT_KNOWLEDGE")
    c = use(monkeypatch, AssertionError("no classifier with Brain off"))
    out = run("what is an EP", caller=caller_of(_resp(env("answer", reply="An EP is an episodic pivot."))), caps=CAPS, ctx=CTX)
    assert c.calls == [] and out["envelope"]["reply"] == "An EP is an episodic pivot."
    assert "evidence" not in out["usage"]


def test_brain_off_identity_with_and_without_the_module(monkeypatch):
    monkeypatch.delenv("UCT_AGENT_KNOWLEDGE")
    e = env("apply", [OP], reply="A bar chart shows open, high, low and close.")
    a = run("make it bars", caller=caller_of(_resp(e)), caps=CAPS, ctx=CTX)
    monkeypatch.setattr(ev, "active", lambda *a, **k: False)
    b = run("make it bars", caller=caller_of(_resp(e)), caps=CAPS, ctx=CTX)
    a["usage"].pop("latency_ms"), b["usage"].pop("latency_ms")
    a["usage"]["stages"] = b["usage"]["stages"] = None
    assert a == b


@pytest.mark.parametrize("flag", ["0", "", "off"])
def test_active_reads_the_knowledge_flag(monkeypatch, flag):
    monkeypatch.setenv("UCT_AGENT_KNOWLEDGE", flag)
    assert ev.active(KCTX, None) is False


def test_coach_turns_and_v2_resumes_are_not_reclassified(monkeypatch):
    from api.services.uct_agent import coach
    monkeypatch.setattr(coach, "is_coach_turn", lambda ctx: True)
    assert ev.active(KCTX, None) is False
    monkeypatch.setattr(coach, "is_coach_turn", lambda ctx: False)
    assert ev.active(KCTX, {"resume": {"x": 1}}) is False
    assert ev.active(KCTX, {"wait_step": None}) is True


# ── playbook: UCT's reads only, no planner call ─────────────────────────────────────────────────────────────────
def test_playbook_definition_is_served_by_the_setup_read_with_no_planner_call(monkeypatch):
    c = use(monkeypatch, cls())
    out = run("what's an EP?")
    e = out["envelope"]
    assert e["disposition"] == "apply" and e["reply"] == ""
    assert e["ops"] == [{"action": "playbook.setup", "target": "playbook", "args": {"setup": "Episodic Pivot"}}]
    assert len(c.calls) == 1
    assert out["usage"]["evidence"]["class"] == "playbook" and out["usage"]["model_calls"] == 1


def test_the_review_rounds_phrasings_reach_the_read_whatever_the_wording(monkeypatch):
    # wants_knowledge() misses these (the #768 known gap); E-1 does not depend on any word list
    for msg in ("what's a VCP?", "whats an EP", "tell me about\ncup and handle", "EP??"):
        use(monkeypatch, cls(setups=(), concept=msg.split()[-1][:20]))
        e = run(msg)["envelope"]
        assert e["disposition"] == "apply" and e["reply"] == "" and e["ops"][0]["action"] == "playbook.setup"


def test_an_excluded_setup_is_asked_by_name_so_the_server_refuses_it_explicitly(monkeypatch):
    use(monkeypatch, cls(setups=(), concept="VCP"))
    e = run("what is a VCP")["envelope"]
    assert e["ops"] == [{"action": "playbook.setup", "target": "playbook", "args": {"setup": "VCP"}}]


def test_rules_record_and_concept_topics_pick_their_reads(monkeypatch):
    use(monkeypatch, cls(topic="setup_record", setups=("Episodic Pivot", "Undercut & Rally")))
    e = run("win rate of EP vs U&R")["envelope"]
    assert [(o["action"], o["args"]) for o in e["ops"]] == [
        ("playbook.record", {"setup": "Episodic Pivot", "regime": None}),
        ("playbook.record", {"setup": "Undercut & Rally", "regime": None})]
    use(monkeypatch, cls(topic="setup_rules"))
    assert run("max stop on an EP")["envelope"]["ops"][0]["action"] == "playbook.setup"
    use(monkeypatch, cls(topic="trading_concept", setups=(), concept="patience"))
    assert run("how does the team think about patience")["envelope"]["ops"] == [
        {"action": "playbook.explain", "target": "playbook", "args": {"question": "patience"}}]
    use(monkeypatch, cls(topic="trading_concept", setups=(), concept=""))
    assert run("how does the team think about patience")["envelope"]["ops"][0]["args"] == {
        "question": "how does the team think about patience"}


def test_a_trading_concept_classed_none_is_forced_to_the_playbook(monkeypatch):
    use(monkeypatch, cls(evidence="none", topic="trading_concept", setups=(), concept="position sizing"))
    out = run("what is position sizing")
    assert out["envelope"]["ops"][0]["action"] == "playbook.explain"
    assert out["usage"]["evidence"]["why"] == "concept_forced"


def test_a_named_setup_classed_none_is_forced_to_the_playbook(monkeypatch):
    use(monkeypatch, cls(evidence="none", topic="other"))
    out = run("EP")
    assert out["envelope"]["ops"][0]["action"] == "playbook.setup"
    assert out["usage"]["evidence"]["why"] == "setup_forced"


def test_playbook_with_no_knowledge_offered_and_no_group_is_the_fixed_sentence(monkeypatch):
    use(monkeypatch, cls())
    e = run("what is an EP", caps=CAPS, ctx=CTX)["envelope"]
    assert e == {"disposition": "answer", "reply": ev.NOT_RETRIEVED, "question": None, "ops": [], "unsupported_category": None}


def test_playbook_with_the_group_unselected_asks_the_browser_to_reroute_once(monkeypatch):
    c = use(monkeypatch, cls())
    meter = types.SimpleNamespace(user_id=7, request_id=41, calls_left=lambda: 1,
                                  call=lambda category, fn, counts_as_call=True, **kw: fn(**kw))
    routing = {"groups": [{"id": "chart", "title": "c"}, {"id": "playbook", "title": "p"}], "selected": ["chart"]}
    e = run("what is an EP", caps=CAPS, ctx=CTX, routing=routing, meter=meter)["envelope"]
    assert e.get("need_groups") == ["playbook"] and e["reply"] == ""
    # the reroute (same request) carries the group: the cached class is used, no second paid classification
    out = run("what is an EP", routing={**routing, "selected": ["chart", "playbook"]}, meter=meter, reroute=True)
    assert out["envelope"]["ops"][0]["action"] == "playbook.setup"
    assert len(c.calls) == 1 and out["usage"]["evidence"]["cached"] is True
    # a reroute is never asked to reroute again
    ev._reset_for_test()
    e = run("what is an EP", caps=CAPS, ctx=CTX, routing=routing, meter=meter, reroute=True)["envelope"]
    assert "need_groups" not in e and e["reply"] == ev.NOT_RETRIEVED


def test_playbook_turns_never_stream_anything(monkeypatch):
    use(monkeypatch, cls())
    events = []
    run("what is an EP", on_event=events.append, stream_caller=lambda feed, **kw: no_planner())
    assert [x for x in events if x.get("t") == "delta"] == []


# ── chart / none: the planner without playbook.* ─────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("evidence", ["chart", "none"])
def test_chart_and_none_run_the_planner_with_every_playbook_capability_removed(monkeypatch, evidence):
    use(monkeypatch, cls(evidence=evidence, topic="chart_or_symbol" if evidence == "chart" else "other", setups=(), concept=""))
    p = caller_of(_resp(env("apply", [OP], reply="")))
    routing = {"groups": [{"id": "chart", "title": "c"}, {"id": "playbook", "title": "p"}], "selected": ["chart"]}
    out = run("make it bars", caller=p, routing=routing)
    assert [o["action"] for o in out["envelope"]["ops"]] == ["chart.setType"]
    seen = offered_to_planner(p.calls[0])
    assert "playbook." not in seen and "chart.setType" in seen
    assert "playbook" not in json.dumps(p.calls[0].get("system"))   # nor the unselected group's name
    assert out["usage"]["evidence"]["class"] == evidence and out["usage"]["model_calls"] == 2


def test_a_chart_turn_planner_cannot_emit_a_playbook_read(monkeypatch):
    use(monkeypatch, cls(evidence="chart", topic="chart_or_symbol", setups=(), concept=""))
    with pytest.raises(turn.TurnError):           # an action the planner was not offered is refused, never run
        run("make it bars", caller=caller_of(_resp(env("apply", [OP, {"action": "playbook.setup", "target": "playbook",
                                                                       "args": {"setup": "EP"}}]))))


def test_chart_and_none_turns_never_stream_while_brain_is_on_and_carry_the_general_label(monkeypatch):
    # review #781 findings 1-2: #768's backstop stays on (no stream) and model-written prose is labelled, deterministically
    use(monkeypatch, cls(evidence="none", topic="other", setups=(), concept=""))
    events = []
    text = "A bar chart draws open, high, low and close for each period. " * 4

    def stream(feed, **kw):
        r = _resp(env("answer", reply=text))
        feed(r.content[0].text)
        return r
    out = run("tell me a joke about bar charts", on_event=events.append, stream_caller=stream)
    assert not any(x.get("t") == "delta" for x in events)
    assert out["envelope"]["reply"] == text.strip() + "\n\n" + ev.GENERAL_LABEL
    assert out["usage"]["general_label"] is True


@pytest.mark.parametrize("disp,ops,reply,labelled", [
    ("apply", [OP], "Bar charts show the open and close as small ticks on each bar.", True),
    ("apply", [OP], "", False),
    ("answer", [], turn.NOTHING_DONE, False),
    ("answer", [], ev.NOT_RETRIEVED, False),
])
def test_the_general_label_is_decided_deterministically(monkeypatch, disp, ops, reply, labelled):
    use(monkeypatch, cls(evidence="chart", topic="chart_or_symbol", setups=(), concept=""))
    out = run("make it bars", caller=caller_of(_resp(env(disp, ops, reply=reply))))
    assert out["envelope"]["reply"].endswith(ev.GENERAL_LABEL) is labelled
    if not labelled:
        assert ev.GENERAL_LABEL not in out["envelope"]["reply"]


def test_playbook_mixed_and_ambiguous_turns_are_never_labelled(monkeypatch):
    for c in (cls(), cls(evidence="ambiguous")):
        use(monkeypatch, c)
        assert ev.GENERAL_LABEL not in json.dumps(run("what is an EP")["envelope"])
    use(monkeypatch, cls(evidence="mixed", chart_ask=True))
    e = run("make it bars and what is an EP", caller=caller_of(_resp(env("apply", [OP], reply="Bars it is."))))["envelope"]
    assert ev.GENERAL_LABEL not in json.dumps(e)


# ── review #781 finding 1: a misroute never serves a model-written playbook definition ────────────────────────────
MISROUTES = [cls(evidence="chart", topic="chart_or_symbol", setups=(), concept=""),
             cls(evidence="none", topic="other", setups=(), concept="")]


@pytest.mark.parametrize("raw", MISROUTES)
@pytest.mark.parametrize("msg", ["what's an EP", "whats an EP?", "what is an EP", "tell me about cup and handle",
                                 "Episodic Pivot?", "what\u2019s a VCP"])
def test_a_misrouted_playbook_question_gets_ucts_card_not_the_models_definition(monkeypatch, raw, msg):
    # every one of these names a setup, so (review #781 delta d) the turn becomes MIXED: UCT's read answers, the
    # planner's words are dropped, nothing streams
    use(monkeypatch, raw)
    events = []

    def stream(feed, **kw):
        feed(json.dumps(env("answer", reply=LONG)))
        return _resp(env("answer", reply=LONG))
    out = run(msg, on_event=events.append, stream_caller=stream, caller=caller_of(_resp(env("answer", reply=LONG))))
    e = out["envelope"]
    assert e["reply"] == "" and [o["action"] for o in e["ops"]] == ["playbook.setup"]
    assert out["usage"]["evidence"]["class"] == "mixed"
    assert not any(x.get("t") == "delta" for x in events)
    for s_ in ("10%", "3%", "72%", "gap on earnings"):
        assert s_ not in json.dumps(out["envelope"])


def test_a_misrouted_question_about_a_specific_chart_is_still_answered_with_the_label(monkeypatch):
    use(monkeypatch, cls(evidence="chart", topic="chart_or_symbol", setups=(), concept=""))
    out = run("what's the breakout level on this chart", caller=caller_of(_resp(env("answer", reply="Around the prior high."))))
    assert out["envelope"]["reply"] == "Around the prior high.\n\n" + ev.GENERAL_LABEL




@pytest.mark.parametrize("evidence", ["chart", "none"])
def test_a_trading_concept_is_forced_to_the_playbook_whatever_the_primary_class(evidence):
    d = ev.decide(cls(evidence=evidence, topic="trading_concept", setups=(), concept="risk"), NAMES)
    assert d["route"] == ("mixed" if evidence == "chart" else "playbook")


# ── review #781 finding 3: the classifier is off the request's call ceiling (real budget ledger) ──────────────────
def test_a_reroute_and_research_still_fit_the_two_call_ceiling_with_brain_on(monkeypatch, clean):
    from api.services.uct_agent import budget
    c = use(monkeypatch, cls(evidence="chart", topic="chart_or_symbol", setups=(), concept=""))
    rid = budget.open_request("u", "c1", "hide volume")
    meter = budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE)
    routing = {"groups": [{"id": "chart", "title": "c"}, {"id": "volume", "title": "v"}], "selected": ["chart"]}
    first = run("hide volume", routing=routing, meter=meter,
                caller=caller_of(_resp({**env("answer", reply=""), "need_groups": ["volume"]})))
    assert first["envelope"]["need_groups"] == ["volume"]
    assert budget.open_request("u", "c1", "hide volume", reroute=True) == rid
    vop = {"action": "volume.setState", "target": "c1", "args": {"state": "hidden"}}
    out = run("hide volume", routing={**routing, "selected": ["chart", "volume"]}, meter=meter, reroute=True,
              caller=caller_of(_resp(env("apply", [vop]))))
    assert [o["action"] for o in out["envelope"]["ops"]] == ["volume.setState"]
    assert len(c.calls) == 1 and budget.calls_used(rid) == 2        # planner + reroute; the classifier is not counted
    assert budget.state()["calls"]["settled"] == 3                  # but all three are metered against the daily cap


def test_the_classifier_still_counts_against_the_daily_cap(monkeypatch, clean):
    from api.services.uct_agent import budget
    monkeypatch.setenv("UCT_AGENT_BUDGET_USD", "0.000001")
    use(monkeypatch, cls())
    meter = budget.Meter(user_id="u", request_id=budget.open_request("u", "c", "what is an EP"), site_reader=ZERO_SITE)
    with pytest.raises(budget.BudgetRefused):
        run("what is an EP", meter=meter)


# ── review #781 finding 5: the manifest is checked before the paid call, on the stripped manifest ────────────────
def test_a_full_manifest_plus_playbook_capabilities_is_accepted(monkeypatch):
    use(monkeypatch, cls())
    fill = [{**CAPS[0], "name": f"chart.fill{i}"} for i in range(turn.MAX_CAPABILITIES - len(CAPS))]
    assert len(CAPS + fill + KCAPS) > turn.MAX_CAPABILITIES
    assert run("what is an EP", caps=CAPS + fill + KCAPS)["envelope"]["ops"][0]["action"] == "playbook.setup"


def test_an_invalid_manifest_is_refused_before_the_classifier_is_paid(monkeypatch):
    c = use(monkeypatch, cls())
    fill = [{**CAPS[0], "name": f"chart.fill{i}"} for i in range(turn.MAX_CAPABILITIES + 1)]
    with pytest.raises(turn.TurnError):
        run("what is an EP", caps=fill + KCAPS)
    assert c.calls == []




# ── mixed: chart actions kept, the planner's words dropped, UCT's reads appended ────────────────────────────────
def test_mixed_keeps_the_chart_change_drops_the_reply_and_adds_the_read(monkeypatch):
    use(monkeypatch, cls(evidence="mixed", chart_ask=True))
    p = caller_of(_resp(env("apply", [OP], reply=f"Done. {INVENTED}")))
    out = run("make it bars and what is an EP", caller=p)
    e = out["envelope"]
    assert [o["action"] for o in e["ops"]] == ["chart.setType", "playbook.setup"]
    assert e["ops"][0] == OP and e["reply"] == ""
    assert "playbook." not in offered_to_planner(p.calls[0])
    for s in ("10%", "3%", "72%"):
        assert s not in json.dumps(e)
    assert out["usage"]["evidence"]["mixed"] == "apply"


def test_mixed_is_never_streamed_even_when_the_request_streams(monkeypatch):
    use(monkeypatch, cls(evidence="mixed", chart_ask=True))
    events = []
    out = run("make it bars and what is an EP", caller=caller_of(_resp(env("apply", [OP], reply=LONG))),
              on_event=events.append, stream_caller=lambda feed, **kw: (feed(json.dumps(env("apply", [OP], reply=LONG))),
                                                                       _resp(env("apply", [OP], reply=LONG)))[1])
    assert not any(x.get("t") == "delta" for x in events)
    assert out["envelope"]["reply"] == ""


@pytest.mark.parametrize("disp", ["answer", "clarify", "unsupported"])
def test_mixed_talk_from_the_planner_is_replaced_by_the_read(monkeypatch, disp):
    use(monkeypatch, cls(evidence="mixed", chart_ask=True))
    q = {"text": f"Which chart? {INVENTED}", "choices": ["An EP is a gap"]} if disp == "clarify" else None
    e = run("make it bars and what is an EP", caller=caller_of(_resp(env(disp, reply=INVENTED, question=q,
                                                                          cat="x" if disp == "unsupported" else None))))["envelope"]
    assert e["disposition"] == "apply" and e["reply"] == "" and e.get("question") is None
    assert [o["action"] for o in e["ops"]] == ["playbook.setup"]
    assert "gap" not in json.dumps(e)


def test_mixed_proposal_keeps_its_card_and_says_ucts_fixed_words(monkeypatch):
    use(monkeypatch, cls(evidence="mixed", chart_ask=True))
    op = {"action": "watchlist.delete", "target": "c1", "args": {}}
    e = run("delete this list and what is an EP", caps=ALL + [PROPOSE_CAP],
            caller=caller_of(_resp(env("propose", [op], reply=INVENTED))))["envelope"]
    assert e["disposition"] == "propose" and e["ops"] == [op] and e["reply"] == ev.MIXED_PROPOSE


def test_mixed_reroute_request_passes_through_untouched(monkeypatch):
    use(monkeypatch, cls(evidence="mixed", chart_ask=True))
    routing = {"groups": [{"id": "chart", "title": "c"}, {"id": "volume", "title": "v"}], "selected": ["chart"]}
    e = run("hide volume and what is an EP", routing=routing,
            caller=caller_of(_resp({**env("answer", reply=INVENTED), "need_groups": ["volume"]})))["envelope"]
    assert e.get("need_groups") == ["volume"] and e["reply"] == ""


def test_mixed_without_knowledge_offered_keeps_the_chart_change_and_says_so(monkeypatch):
    use(monkeypatch, cls(evidence="mixed", chart_ask=True))
    e = run("make it bars and what is an EP", caps=CAPS, ctx=CTX,
            caller=caller_of(_resp(env("apply", [OP], reply=INVENTED))))["envelope"]
    assert e["ops"] == [OP] and e["reply"] == ev.NOT_RETRIEVED


def test_mixed_over_the_op_limit_keeps_the_chart_changes_only(monkeypatch):
    use(monkeypatch, cls(evidence="mixed", chart_ask=True))
    ops = [OP] * turn.MAX_OPS
    e = run("lots of changes and what is an EP", caller=caller_of(_resp(env("apply", ops, reply=INVENTED))))["envelope"]
    assert len(e["ops"]) == turn.MAX_OPS and all(o["action"] == "chart.setType" for o in e["ops"])
    assert e["reply"] == ev.MIXED_TOO_MANY


@pytest.mark.parametrize("raw,why", [
    (cls(evidence="chart", topic="setup_definition"), "setup_with_chart"),
    (cls(evidence="playbook", chart_ask=True), "playbook_with_chart"),
    (cls(evidence="none", topic="trading_concept", setups=(), chart_ask=True), "concept_with_chart"),
    (cls(evidence="chart", topic="chart_or_symbol", setups=("Episodic Pivot",)), "setup_with_chart"),
])
def test_a_setup_or_concept_beside_a_chart_ask_is_mixed(raw, why):
    d = ev.decide(raw, NAMES)
    assert d["route"] == "mixed" and d["why"] == why


# ── ambiguous and fail closed ────────────────────────────────────────────────────────────────────────────────────
def test_ambiguous_is_ucts_fixed_clarify_with_enum_choices(monkeypatch):
    use(monkeypatch, cls(evidence="ambiguous", setups=("Episodic Pivot",)))
    e = run("the EP")["envelope"]
    assert e["disposition"] == "clarify" and e["reply"] == "" and e["ops"] == []
    assert e["question"] == {"text": ev.CLARIFY_TEXT, "choices": ["UCT's definition of Episodic Pivot", "Read my chart"]}
    use(monkeypatch, cls(evidence="ambiguous", setups=()))
    assert run("hmm that one")["envelope"]["question"]["choices"] == [ev.CHOICE_PLAYBOOK, ev.CHOICE_CHART]


@pytest.mark.parametrize("out", [
    RuntimeError("boom"), TimeoutError("slow"),
    _cresp(text="not json"), _cresp(text=""), _cresp(cls(), stop="refusal"), _cresp(cls(), stop="max_tokens"),
    {"evidence": "playbook"},                                                    # keys missing
    {**cls(), "reply": "An EP is a 10% gap."},                                   # an extra field (a reply) is off-schema
    cls(evidence="definitely"), cls(topic="vibes"), cls(setups=("VCP",)),       # off-enum class / topic / setup
    {**cls(), "chart_ask": "yes"}, {**cls(), "setups": "Episodic Pivot"}, [cls()],
])
def test_every_classifier_failure_is_the_fixed_clarify_and_no_planner_runs(monkeypatch, out):
    use(monkeypatch, out)
    res = run("what is an EP and make it bars")
    e = res["envelope"]
    assert e["disposition"] == "clarify" and e["question"]["text"] == ev.CLARIFY_TEXT and e["ops"] == []
    assert res["usage"]["evidence"]["class"] == "ambiguous"
    assert "10%" not in json.dumps(e)


def test_a_failed_classification_is_never_cached(monkeypatch):
    c = use(monkeypatch, RuntimeError("down"), cls())
    meter = types.SimpleNamespace(user_id=1, request_id=9, calls_left=lambda: 2, call=lambda category, fn, counts_as_call=True, **kw: fn(**kw))
    assert run("what is an EP", meter=meter)["envelope"]["disposition"] == "clarify"
    assert run("what is an EP", meter=meter, reroute=True)["envelope"]["ops"][0]["action"] == "playbook.setup"
    assert len(c.calls) == 2


def test_a_budget_refusal_is_not_swallowed(monkeypatch):
    from api.services.uct_agent.budget import BudgetRefused

    class M:
        user_id, request_id = 1, 2

        def calls_left(self):
            return 0

        def call(self, category, fn, **kw):
            assert category == ev.CATEGORY
            raise BudgetRefused("daily_cap", "UCT Agent has reached today's limit.")
    with pytest.raises(BudgetRefused):
        run("what is an EP", meter=M())


# ── the classifier's request ─────────────────────────────────────────────────────────────────────────────────────
def test_the_classifier_sees_names_and_symbols_only_and_its_setups_enum_is_the_approved_list(monkeypatch):
    c = use(monkeypatch, cls())
    history = [{"role": "member", "text": "secret member text"},
               {"role": "agent", "text": INVENTED, "data": {"actions": ["chart.setType"]}}]
    run("what is an EP", history=history)
    kw = c.calls[0]
    body = json.dumps(kw["messages"])
    assert "chart.setType" in body and "SPY" in body and "what is an EP" in body
    assert INVENTED not in body and "secret member text" not in body
    sch = kw["output_config"]["format"]["schema"]
    assert sch["properties"]["setups"]["items"]["enum"] == NAMES
    assert sch["additionalProperties"] is False and set(sch["required"]) == set(ev.KEYS)
    assert "reply" not in sch["properties"]
    assert kw["max_tokens"] == ev.MAX_TOKENS


def test_an_empty_vocabulary_still_has_a_valid_closed_schema():
    s = ev.schema([])
    assert s["properties"]["setups"]["items"]["enum"] == [""]
    assert ev.decide(cls(setups=("",)), [])["route"] == "ambiguous"


def test_the_concept_is_bounded_and_never_shown(monkeypatch):
    use(monkeypatch, cls(topic="trading_concept", setups=(), concept="<b>x</b>" + "y" * 200))
    e = run("what is patience")["envelope"]
    q = e["ops"][0]["args"]["question"]
    assert len(q) <= ev.MAX_CONCEPT and "<" not in q
    assert e["reply"] == ""


def test_approved_setups_admits_only_policy_approved_templates(monkeypatch, tmp_path):
    import sqlite3
    from api.services.uct_agent.knowledge import pack, policy
    monkeypatch.undo()
    db = tmp_path / "pack.db"
    c = sqlite3.connect(db)
    c.execute("CREATE TABLE setup_templates (name TEXT, aliases TEXT, origin_trader TEXT, active INTEGER)")
    c.executemany("INSERT INTO setup_templates VALUES (?,?,?,?)", [
        ("Team Setup", "TS, T-S", "team", 1), ("Third Party", "VCP", "someone", 1), ("Retired", "R", "team", 0)])
    c.commit()
    c.close()

    def conn():
        k = sqlite3.connect(db)
        k.row_factory = sqlite3.Row
        return k
    monkeypatch.setattr(pack, "connect", conn)
    monkeypatch.setattr(policy, "classify_template",
                        lambda o, n=None: {"state": "admitted" if o == "team" else "excluded"})
    assert ev.approved_setups() == [{"name": "Team Setup", "aliases": ["TS", "T-S"]}]


# ── the News Ask box and fixed-sentence paths ────────────────────────────────────────────────────────────────────
def test_the_news_box_never_plans_a_playbook_turn(monkeypatch):
    use(monkeypatch, cls())
    e = run("what is an EP", answer_only=True, headline={"id": 1, "title": "x"})["envelope"]
    assert e["reply"] == ev.NEWS_BOX and e["ops"] == []


def test_nonsense_gets_ucts_clarify_without_a_classifier_call(monkeypatch):
    c = use(monkeypatch, AssertionError("no call"))
    e = run("asdf qwer zxcv")["envelope"]
    assert c.calls == [] and e["disposition"] == "clarify"


# ── review #781 delta: paraphrases, alias tolerance, a named setup beside a stock, the output backstop ───────────────
NEUTRAL = "It is an up day whose volume beats every down day of the prior ten sessions, bought on the close."


@pytest.mark.parametrize("raw", MISROUTES)
@pytest.mark.parametrize("msg", ["describe a pocket pivot", "how does a flat base work", "what makes a good pivot",
                                 "walk me through a wedge pop", "entry and stop for a parabolic short",
                                 "what is a power earnings gap"])
def test_delta_paraphrases_never_serve_the_models_definition(monkeypatch, raw, msg):
    use(monkeypatch, raw)
    out = run(msg, caller=caller_of(_resp(env("answer", reply=NEUTRAL))))
    assert out["envelope"]["reply"] == turn.KNOWLEDGE_NOT_RETRIEVED
    assert NEUTRAL not in json.dumps(out["envelope"])


@pytest.mark.parametrize("raw", MISROUTES)
@pytest.mark.parametrize("msg,setup", [("teach me the undercut rally", "Undercut & Rally"), ("e.p. setup?", "Episodic Pivot"),
                                       ("what's SPY's EP setup look like", "Episodic Pivot"), ("EP", "Episodic Pivot")])
def test_delta_a_named_setup_on_a_chart_or_none_turn_is_mixed_and_gets_ucts_card(monkeypatch, raw, msg, setup):
    use(monkeypatch, raw)
    out = run(msg, caller=caller_of(_resp(env("answer", reply=NEUTRAL))))
    e = out["envelope"]
    assert out["usage"]["evidence"]["class"] == "mixed" and out["usage"]["evidence"]["why"] == "words_named_setup"
    assert e["reply"] == "" and [o["args"] for o in e["ops"]] == [{"setup": setup}]
    assert NEUTRAL not in json.dumps(e)


def test_delta_a_known_but_unapproved_setup_name_is_asked_by_name_and_refused_by_the_server(monkeypatch):
    use(monkeypatch, MISROUTES[0])
    e = run("vcp?", caller=caller_of(_resp(env("answer", reply=NEUTRAL))))["envelope"]
    assert [o["args"] for o in e["ops"]] == [{"setup": "vcp"}] and e["reply"] == ""


@pytest.mark.parametrize("reply", ["UCT enters at the open with a 3% stop.", "Our rules say buy the first pullback.",
                                   "The team's entry is the opening range high.", "An EP's stop goes under the gap-day low.",
                                   "Undercut and Rally entries trigger on the reclaim."])
def test_delta_output_backstop_replaces_presented_ucts_methodology(monkeypatch, reply):
    use(monkeypatch, MISROUTES[1])
    out = run("tell me something interesting", caller=caller_of(_resp(env("answer", reply=reply))))
    assert out["envelope"]["reply"] == ev.NOT_RETRIEVED and out["usage"]["output_backstop"] is True


def test_delta_output_backstop_keeps_a_writes_ops(monkeypatch):
    use(monkeypatch, cls(evidence="chart", topic="chart_or_symbol", setups=(), concept=""))
    e = run("make it bars", caller=caller_of(_resp(env("apply", [OP], reply="Bars it is; UCT's rules say enter on the pivot."))))["envelope"]
    assert e["ops"] == [OP] and e["reply"] == ev.NOT_RETRIEVED


@pytest.mark.parametrize("msg,reply", [("how do I add RSI", "Open the indicator menu in UCT and pick RSI."),
                                       ("tell me a joke", "Why did the candle blush? It saw the wick."),
                                       ("what are eps estimates for SPY", "Analysts expect growth this quarter.")])
def test_delta_ordinary_chart_and_general_turns_are_untouched_apart_from_the_label(monkeypatch, msg, reply):
    use(monkeypatch, MISROUTES[1])
    out = run(msg, caller=caller_of(_resp(env("answer", reply=reply))))
    assert out["envelope"]["reply"] == reply + "\n\n" + ev.GENERAL_LABEL
    assert out["usage"]["evidence"]["class"] == "none"


def test_delta_alias_tolerance():
    v = [{"name": "Undercut & Rally", "aliases": ["U&R", "undercut and rally"]}, {"name": "Episodic Pivot", "aliases": ["EP"]}]
    for m, want in (("undercut rally?", "Undercut & Rally"), ("the U & R", "Undercut & Rally"), ("an E.P.", "Episodic Pivot"),
                    ("UNDERCUT AND RALLY", "Undercut & Rally")):
        assert want in ev.named_setups(m, v)[0], m
    assert ev.named_setups("sleep and rally", v) == ([], [])


# ── review #781 delta 2 ─────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("reply,msg", [
    ("An EP is a 10% earnings gap; you buy at the open and sell below the day's low.", "tell me something interesting"),
    ("We buy EPs at the open and trim into strength.", "tell me something interesting"),
    ("Our crew's favourite play: EP, buy the ORH.", "tell me something interesting"),
    ("This setup's buy point is the prior high.", "what makes a good pivot"),
    ("The trigger is a close above the pivot.", "describe a pocket pivot"),
    ("EP = gap + volume.", "tell me something interesting"),
])
def test_delta2_output_backstop_catches_the_reviewers_evasions(monkeypatch, reply, msg):
    use(monkeypatch, MISROUTES[1])
    # bypass the input check so the OUTPUT backstop is what is tested
    monkeypatch.setattr(ev, "playbook_worded", lambda *a, **k: False)
    monkeypatch.setattr(ev, "named_setups", lambda m, v: ([], []) if m == msg else _real_named(m, v))
    out = run(msg, caller=caller_of(_resp(env("answer", reply=reply))))
    assert out["envelope"]["reply"] == ev.NOT_RETRIEVED, reply


_real_named = ev.named_setups


@pytest.mark.parametrize("msg", ["open the indicator menu in UCT", "how do I add a breakout scan", "show me how to draw a flag",
                                 "how do I set up a gap scanner", "what does the pullback column mean in the screener",
                                 "how do I set an alert for a breakout", "what are the rules for the momentum screen",
                                 "how do I save this pattern drawing", "explain the gaps tab"])
def test_delta2_ordinary_uct_help_is_not_a_playbook_question(monkeypatch, msg):
    use(monkeypatch, MISROUTES[1])
    reply = "Use the menu at the top of the panel; pick the item and press Save."
    out = run(msg, caller=caller_of(_resp(env("answer", reply=reply))))
    assert out["envelope"]["reply"] == reply + "\n\n" + ev.GENERAL_LABEL
    assert ev.playbook_worded(msg, VOCAB, []) is False


@pytest.mark.parametrize("reply", ["In UCT, set a stop alert from the alert menu.", "Open the indicator menu in UCT and pick RSI.",
                                   "We can add that indicator from the toolbar."])
def test_delta2_feature_help_mentioning_uct_is_not_methodology(monkeypatch, reply):
    use(monkeypatch, MISROUTES[1])
    out = run("how do I set a stop alert", caller=caller_of(_resp(env("answer", reply=reply))))
    assert out["envelope"]["reply"] == reply + "\n\n" + ev.GENERAL_LABEL


def test_delta2_playbook_paraphrases_still_caught_with_feature_words_absent():
    for m in ("how do I trade a flat base", "describe a pocket pivot", "walk me through a wedge pop"):
        assert ev.playbook_worded(m, VOCAB, []) is True, m


def test_delta2_a_v2_resume_gets_the_output_backstop_and_the_label(monkeypatch):
    from api.services.uct_agent import turn_v2
    replies = iter([INVENTED, "Done: your chart is on bars now, and the volume pane is hidden."])
    monkeypatch.setattr(turn_v2, "run_turn_v2", lambda **kw: {"envelope": env("answer", reply=next(replies)),
                                                               "usage": {}, "title": None})
    c = use(monkeypatch, AssertionError("a resume is never classified again"))
    v2 = {"wait_step": None, "turn_token": "t", "resume": {"x": 1}, "resume_result": {"status": "done"}}
    out = run("make it bars", v2=v2)
    assert c.calls == [] and out["envelope"]["reply"] == ev.NOT_RETRIEVED
    out = run("make it bars", v2=v2)
    assert out["envelope"]["reply"].endswith(ev.GENERAL_LABEL)


def test_delta2_a_paused_v2_resume_passes_through(monkeypatch):
    from api.services.uct_agent import turn_v2
    paused = {"paused": True, "turn_token": "t", "envelope": {"paused": True}, "usage": {}}
    monkeypatch.setattr(turn_v2, "run_turn_v2", lambda **kw: paused)
    v2 = {"wait_step": None, "turn_token": "t", "resume": {"x": 1}, "resume_result": {"status": "done"}}
    assert run("make it bars", v2=v2) is paused


def test_delta2_brain_off_resume_is_untouched(monkeypatch):
    from api.services.uct_agent import turn_v2
    monkeypatch.delenv("UCT_AGENT_KNOWLEDGE")
    monkeypatch.setattr(turn_v2, "run_turn_v2", lambda **kw: {"envelope": env("answer", reply=INVENTED), "usage": {}, "title": None})
    v2 = {"wait_step": None, "turn_token": "t", "resume": {"x": 1}, "resume_result": {"status": "done"}}
    assert run("make it bars", v2=v2, caps=CAPS, ctx=CTX)["envelope"]["reply"] == INVENTED


# ── review #781 delta 3: the eval seed file pins every evasion and false positive found in reviews 1-3 ──────────────
_SEEDS = None


def _seeds():
    global _SEEDS
    if _SEEDS is None:
        from pathlib import Path
        p = Path(__file__).resolve().parents[1] / "docs" / "agent" / "knowledge" / "e1-eval-seeds.json"
        _SEEDS = json.loads(p.read_text(encoding="utf-8"))
    return _SEEDS


def test_delta3_the_seed_file_is_well_formed_and_covers_every_review():
    s = _seeds()
    assert s["format"] == "uct-e1-eval-seeds/1" and len(s["input"]) >= 30 and len(s["reply"]) >= 12
    assert {x["expect"] for x in s["input"]} <= {"playbook", "mixed", "chart", "none", "ambiguous"}
    assert {x["expect"] for x in s["reply"]} <= {"replace", "keep"}
    srcs = " ".join(x["source"] for x in s["input"] + s["reply"])
    for r in ("review 1", "delta 1", "delta 2", "delta 3", "delta 4", "delta 5"):
        assert r in srcs


def test_delta3_every_playbook_seed_is_caught_by_the_deterministic_input_layer_and_every_help_seed_is_not():
    vocab = VOCAB + [{"name": "Kicker", "aliases": []}]
    for x in _seeds()["input"]:
        named = any(ev.named_setups(x["text"], vocab))
        worded = ev.playbook_worded(x["text"], vocab, ["NVDA"])
        if x.get("layer") == "classifier_only":
            assert ev.decide({"evidence": "none", "topic": "trading_concept", "setups": [], "concept": "",
                              "chart_ask": False}, NAMES)["route"] == "playbook"
        elif x["expect"] in ("playbook", "mixed"):
            assert named or worded, x["text"]
        elif x["expect"] == "chart":
            assert not named and not worded, x["text"]


def test_delta3_every_reply_seed_meets_its_expectation_in_the_best_effort_output_backstop():
    for x in _seeds()["reply"]:
        got = ev.presents_methodology(x["text"], VOCAB, x["after"])
        assert got is (x["expect"] == "replace"), x["text"]


# ── Brain-OFF QA: the single-switch rule ──────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("knowledge,e1,pack", [("1", "", True), ("1", "0", True), ("", "1", True), ("1", "1", False),
                                               ("1", "yes please", True)])
def test_e1_needs_the_knowledge_flag_its_own_key_and_a_pack(monkeypatch, knowledge, e1, pack):
    monkeypatch.setenv("UCT_AGENT_KNOWLEDGE", knowledge)
    monkeypatch.setenv(ev.E1_FLAG, e1)
    monkeypatch.setattr(ev, "pack_present", lambda: pack)
    assert ev.active(KCTX, None) is False


def test_the_knowledge_flag_alone_changes_nothing_and_costs_nothing(monkeypatch):
    monkeypatch.delenv(ev.E1_FLAG)
    c = use(monkeypatch, AssertionError("no classifier call: E-1 is not switched on"))
    e = env("answer", reply="A bar chart shows open, high, low and close for each period, drawn as ticks.")
    a = run("tell me about bar charts", caller=caller_of(_resp(e)))
    monkeypatch.setattr(ev, "active", lambda *x, **k: False)
    b = run("tell me about bar charts", caller=caller_of(_resp(e)))
    assert c.calls == [] and "evidence" not in a["usage"] and a["usage"]["model_calls"] == 1
    for r in (a, b):
        r["usage"].pop("latency_ms"); r["usage"]["stages"] = None
    assert a == b
    assert ev.GENERAL_LABEL not in a["envelope"]["reply"]


# ── the output judge (owner 2026-11-04: fix hidden-method detection; scripted, no paid call) ─────────────────────────
HIDDEN = "Load up when it clears last week's high, and bail the second it loses the breakout day's low."


def _judge(monkeypatch, *outs):
    j = Classifier(*outs)
    monkeypatch.setattr(ev, "JUDGE_CALL", j)
    return j


@pytest.mark.parametrize("flag", ev.JUDGE_KEYS)
def test_judge_any_flag_replaces_a_hidden_method_the_patterns_missed(monkeypatch, flag):
    use(monkeypatch, MISROUTES[1])
    j = _judge(monkeypatch, {**JUDGE_CLEAR, flag: True})
    assert ev.presents_methodology(HIDDEN, VOCAB, "tell me something interesting") is False      # patterns miss it
    out = run("tell me something interesting", caller=caller_of(_resp(env("answer", reply=HIDDEN))))
    assert out["envelope"]["reply"] == ev.NOT_RETRIEVED and out["usage"]["judge"] == f"judge:{flag}"
    body = json.dumps(j.calls[0]["messages"])
    assert "Load up" in body and j.calls[0]["output_config"]["format"]["schema"]["additionalProperties"] is False
    assert "reply" not in j.calls[0]["output_config"]["format"]["schema"]["properties"]


def test_judge_clear_keeps_the_reply_with_the_label(monkeypatch):
    use(monkeypatch, MISROUTES[1])
    _judge(monkeypatch, JUDGE_CLEAR)
    reply = "VWAP is the volume-weighted average price for the session."
    out = run("what is vwap", caller=caller_of(_resp(env("answer", reply=reply))))
    assert out["envelope"]["reply"] == reply + "\n\n" + ev.GENERAL_LABEL and out["usage"]["judge"] == "judge:clear"


@pytest.mark.parametrize("bad", [RuntimeError("down"), TimeoutError("slow"), _cresp(text="nope"),
                                 _cresp(JUDGE_CLEAR, stop="refusal"), _cresp(JUDGE_CLEAR, stop="max_tokens"),
                                 {**JUDGE_CLEAR, "extra": False}, {"prescribes_trading_action": False},
                                 {**JUDGE_CLEAR, "defines_a_setup": "no"}])
def test_judge_fails_closed(monkeypatch, bad):
    use(monkeypatch, MISROUTES[1])
    _judge(monkeypatch, bad)
    out = run("what is vwap", caller=caller_of(_resp(env("answer", reply="VWAP is a volume-weighted average."))))
    assert out["envelope"]["reply"] == ev.NOT_RETRIEVED


def test_judge_keeps_a_writes_ops(monkeypatch):
    use(monkeypatch, cls(evidence="chart", topic="chart_or_symbol", setups=(), concept=""))
    _judge(monkeypatch, {**JUDGE_CLEAR, "prescribes_trading_action": True})
    e = run("make it bars", caller=caller_of(_resp(env("apply", [OP], reply="Bars now; grab some on the dip."))))["envelope"]
    assert e["ops"] == [OP] and e["reply"] == ev.NOT_RETRIEVED


def test_judge_is_not_called_without_model_text_or_on_other_classes(monkeypatch):
    j = _judge(monkeypatch, AssertionError("no judge call"))
    use(monkeypatch, cls(evidence="chart", topic="chart_or_symbol", setups=(), concept=""))
    run("make it bars", caller=caller_of(_resp(env("apply", [OP], reply=""))))      # no reply text
    for c in (cls(), cls(evidence="ambiguous")):                                         # playbook / ambiguous
        use(monkeypatch, c)
        run("what is an EP")
    use(monkeypatch, cls(evidence="mixed", chart_ask=True))
    run("make it bars and what is an EP", caller=caller_of(_resp(env("apply", [OP], reply="Bars it is."))))
    assert j.calls == []


def test_judge_never_runs_while_e1_is_off(monkeypatch):
    monkeypatch.delenv(ev.E1_FLAG)
    j = _judge(monkeypatch, AssertionError("no judge call with E-1 off"))
    run("tell me something", caller=caller_of(_resp(env("answer", reply=HIDDEN))))
    assert j.calls == []








def test_judge_model_is_pinned_whatever_the_planner_model(monkeypatch):
    use(monkeypatch, MISROUTES[1])
    j = _judge(monkeypatch, JUDGE_CLEAR)
    monkeypatch.setenv("UCT_AGENT_MODEL", "claude-opus-5-5")
    run("what is vwap", caller=caller_of(_resp(env("answer", reply="VWAP is an average."))))
    assert j.calls[0]["model"] == ev.JUDGE_MODEL == "claude-haiku-4-5"


def test_judge_covers_a_clarifys_question_and_choices(monkeypatch):
    use(monkeypatch, MISROUTES[1])
    j = _judge(monkeypatch, {**JUDGE_CLEAR, "prescribes_trading_action": True})
    q = {"text": "Want me to load up on the break, or wait?", "choices": ["Load up on the break", "Wait"]}
    e = run("hmm", caller=caller_of(_resp(env("clarify", question=q))))["envelope"]
    assert e["disposition"] == "answer" and e["reply"] == ev.NOT_RETRIEVED and e["question"] is None
    assert "load up on the break" in json.dumps(j.calls[0]["messages"]).lower()
    j2 = _judge(monkeypatch, AssertionError("UCT's own fixed clarify is never judged"))
    e = run("hmm", caller=caller_of(_resp(env("clarify", question={"text": "Which one do you mean?", "choices": []}))))["envelope"]
    assert j2.calls == [] and e["disposition"] == "clarify"


def test_judge_covers_v2_resumes(monkeypatch):
    from api.services.uct_agent import turn_v2
    monkeypatch.setattr(turn_v2, "run_turn_v2", lambda **kw: {"envelope": env("answer", reply=HIDDEN), "usage": {}, "title": None})
    _judge(monkeypatch, {**JUDGE_CLEAR, "prescribes_trading_action": True})
    v2 = {"wait_step": None, "turn_token": "t", "resume": {"x": 1}, "resume_result": {"status": "done"}}
    assert run("ok", v2=v2)["envelope"]["reply"] == ev.NOT_RETRIEVED


# ── QA #781 round 3: #785's per-turn meter, the judge's own allowance, pinned models, E-1 refuses v2 ────────────────
class _Meter:
    def __init__(self, request_id=7, calls=2, affords=True):
        self.request_id, self.user_id, self._calls, self._affords, self.seen = request_id, 1, calls, affords, []

    def calls_left(self):
        return self._calls

    def affords(self, *worst):
        self.seen.append(("affords", round(sum(worst), 6)))
        return self._affords

    def call(self, category, fn, counts_as_call=True, **kw):
        self.seen.append((category, counts_as_call, kw.get("model")))
        return fn(**kw)


def test_r3_the_judge_has_its_own_call_allowance_inside_the_dollar_cap(monkeypatch):
    use(monkeypatch, MISROUTES[1])
    _judge(monkeypatch, JUDGE_CLEAR)
    m = _Meter(calls=0)                     # a rerouted / repaired / researched turn: no call left on the ceiling
    out = run("what is vwap", meter=m, caller=caller_of(_resp(env("answer", reply="VWAP is an average."))))
    assert out["usage"]["judge"] == "judge:clear"
    assert (ev.JUDGE_CATEGORY, False, ev.JUDGE_MODEL) in m.seen and any(x[0] == "affords" for x in m.seen)


def test_r3_a_turn_the_per_turn_cap_cannot_cover_gets_the_fixed_sentence_and_no_judge_call(monkeypatch):
    use(monkeypatch, MISROUTES[1])
    j = _judge(monkeypatch, AssertionError("no judge call over the per-turn cap"))
    out = run("what is vwap", meter=_Meter(affords=False), caller=caller_of(_resp(env("answer", reply="VWAP is an average."))))
    assert out["envelope"]["reply"] == ev.NOT_RETRIEVED and out["usage"]["judge"] == "judge_unaffordable:turn_cap"
    assert j.calls == []


def test_r3_a_meter_without_a_request_cannot_cap_the_judge(monkeypatch):
    use(monkeypatch, MISROUTES[1])
    j = _judge(monkeypatch, AssertionError("no judge call without a per-turn meter"))
    out = run("what is vwap", meter=_Meter(request_id=None), caller=caller_of(_resp(env("answer", reply="VWAP is an average."))))
    assert out["envelope"]["reply"] == ev.NOT_RETRIEVED and out["usage"]["judge"] == "judge_unaffordable:no_turn_meter"
    assert j.calls == []


def test_r3_the_classifier_is_pinned_and_goes_through_the_turn_meter(monkeypatch):
    use(monkeypatch, MISROUTES[1])
    c = use(monkeypatch, MISROUTES[1])
    monkeypatch.setenv("UCT_AGENT_MODEL", "claude-opus-5-5")
    m = _Meter()
    run("what is vwap", meter=m, caller=caller_of(_resp(env("answer", reply="VWAP is an average."))))
    assert c.calls[0]["model"] == ev.CLASSIFIER_MODEL == "claude-haiku-4-5"
    assert (ev.CATEGORY, False, ev.CLASSIFIER_MODEL) in m.seen


def test_r3_the_classifier_counts_toward_the_real_per_turn_cap(monkeypatch, clean):
    from api.services.uct_agent import budget
    use(monkeypatch, cls())
    rid = budget.open_request("u", "c1", "what is an EP")
    meter = budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE)
    run("what is an EP", meter=meter)
    assert budget.turn_committed_usd(rid) > 0 and budget.calls_used(rid) == 0     # dollars yes, the call ceiling no


def test_r3_e1_refuses_planner_v2_with_no_paid_call(monkeypatch):
    from api.services.uct_agent import turn_v2
    c = use(monkeypatch, AssertionError("no classifier call on v2"))
    monkeypatch.setattr(turn_v2, "run_turn_v2", lambda **kw: (_ for _ in ()).throw(AssertionError("v2 never runs")))
    for msg in ("make it bars", "what is an EP", "tell me a joke"):
        out = run(msg, v2={"wait_step": None, "turn_token": "t"})
        assert out["envelope"]["reply"] == ev.V2_NOT_YET and out["envelope"]["ops"] == []
        assert out["usage"]["evidence"]["why"] == "e1_refuses_v2"
    assert c.calls == []



def test_r4_a_reroute_with_the_same_text_is_not_judged_twice_but_new_text_is(monkeypatch):
    use(monkeypatch, MISROUTES[1])
    j = _judge(monkeypatch, JUDGE_CLEAR)
    m = _Meter(request_id=99)
    for _ in range(2):                                                          # first request, then its reroute
        out = run("what is vwap", meter=m, caller=caller_of(_resp(env("answer", reply="VWAP is an average."))))
    assert len(j.calls) == 1 and out["usage"]["judge"] == "judge:clear:cached"
    run("what is vwap", meter=m, caller=caller_of(_resp(env("answer", reply="VWAP weights price by volume."))))
    assert len(j.calls) == 2                                                    # different text: judged again
    run("what is vwap", meter=_Meter(request_id=100), caller=caller_of(_resp(env("answer", reply="VWAP is an average."))))
    assert len(j.calls) == 3                                                    # another request: judged again


def test_r4_a_failed_judgement_is_never_cached(monkeypatch):
    use(monkeypatch, MISROUTES[1])
    j = _judge(monkeypatch, RuntimeError("down"), JUDGE_CLEAR)
    m = _Meter(request_id=5)
    a = run("what is vwap", meter=m, caller=caller_of(_resp(env("answer", reply="VWAP is an average."))))
    b = run("what is vwap", meter=m, caller=caller_of(_resp(env("answer", reply="VWAP is an average."))))
    assert a["envelope"]["reply"] == ev.NOT_RETRIEVED and b["usage"]["judge"] == "judge:clear" and len(j.calls) == 2


def test_r5_the_judge_cache_key_includes_the_members_message(monkeypatch):
    use(monkeypatch, MISROUTES[1])
    j = _judge(monkeypatch, JUDGE_CLEAR)
    m = _Meter(request_id=77)
    run("what is vwap", meter=m, caller=caller_of(_resp(env("answer", reply="VWAP is an average."))))
    run("explain vwap please", meter=m, caller=caller_of(_resp(env("answer", reply="VWAP is an average."))))
    assert len(j.calls) == 2                                                    # same reply, different message: judged
