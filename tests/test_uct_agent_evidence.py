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


def no_planner(**kw):
    raise AssertionError("the planner must not be called on this path")


@pytest.fixture(autouse=True)
def _brain(monkeypatch):
    monkeypatch.setenv("UCT_AGENT_KNOWLEDGE", "1")
    monkeypatch.setattr(ev, "approved_setups", lambda: [dict(s) for s in VOCAB])
    monkeypatch.setattr(turn, "_record_cost", lambda resp: 0.001)
    monkeypatch.setattr(ev, "CALL", Classifier(cls()))
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
                                  call=lambda category, fn, **kw: fn(**kw))
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


def test_chart_turns_stream_as_today(monkeypatch):
    use(monkeypatch, cls(evidence="none", topic="other", setups=(), concept=""))
    events = []

    def stream(feed, **kw):
        r = _resp(env("answer", reply=LONG.replace("EP", "bar chart")))
        feed(r.content[0].text)
        return r
    run("tell me a joke about bar charts", on_event=events.append, stream_caller=stream)
    assert any(x.get("t") == "delta" for x in events)


def test_v2_receives_the_stripped_manifest_and_never_a_playbook_turn(monkeypatch):
    from api.services.uct_agent import turn_v2
    got = []
    monkeypatch.setattr(turn_v2, "run_turn_v2", lambda **kw: (got.append(kw), {"envelope": env("answer", reply="ok"),
                                                                               "usage": {}, "title": None})[1])
    use(monkeypatch, cls(evidence="chart", topic="chart_or_symbol", setups=(), concept=""))
    run("make it bars", v2={"wait_step": None, "turn_token": "t"})
    assert got and not any(ev.is_playbook(c.get("name")) for c in got[0]["capabilities"])
    # v2's browser runner shows a final reply only (it never runs a final envelope's ops or choices), so a playbook /
    # mixed / ambiguous turn on v2 is UCT's fixed words, never the v2 planner
    for c, want in ((cls(), ev.V2_NOT_YET), (cls(evidence="mixed", chart_ask=True), ev.V2_NOT_YET),
                    (cls(evidence="ambiguous"), ev.CLARIFY_TEXT)):
        got.clear()
        use(monkeypatch, c)
        out = run("what is an EP", v2={"wait_step": None, "turn_token": "t"})
        assert got == [] and out["envelope"]["ops"] == [] and out["envelope"]["reply"] == want


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
    meter = types.SimpleNamespace(user_id=1, request_id=9, calls_left=lambda: 2, call=lambda category, fn, **kw: fn(**kw))
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
