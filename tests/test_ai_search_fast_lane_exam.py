"""The FAST-lane exam + a median-of-N harness (2026-08-29).

Two measured facts forced this:

  * `by_mode` in the prod capture log is fast 49 / agent 1 — but the report card
    only ever drove the AGENT lane. The lane 49 of 50 member asks actually take
    has never been graded.
  * Three report-card runs on IDENTICAL code scored 19, 20 and 16 out of 30
    (rung 3 swung 1→4). A single run cannot detect a change smaller than its own
    noise, so it can neither gate a deploy nor set a baseline.

The fast lane fires NO tools, so the agent lane's tool gate cannot transfer to
it. Its evidence is the DESK GROUNDING BLOCK, and that is what its gate reads.
"""
import ast
import io

import pytest

import api.routers.ai_search as ai
from api.services.ai_search_eval import runner


# ── 1. one definition of the fast lane, not three copies ────────────────────
def test_every_fast_lane_provider_call_goes_through_one_helper():
    """The router held THREE byte-identical `perplexity_search.web_search(...)`
    calls — same max_tokens, domain_pack, recency, salt, cost_surface. Three
    hand-written copies of one call is how the 700-token cap and the domain
    allowlist survived review for months: a reader fixes the one they found.
    Derived by AST so a fourth copy fails BY NAME, never by my spelling."""
    src = io.open(ai.__file__, encoding="utf-8").read()
    tree = ast.parse(src)
    helper = next((n for n in ast.walk(tree)
                   if isinstance(n, ast.FunctionDef) and n.name == "fast_lane_answer"), None)
    assert helper is not None, "fast_lane_answer() is gone — the lane has no single owner"
    inside = {n.lineno for n in ast.walk(helper) if hasattr(n, "lineno")}

    calls = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        f = node.func
        if (isinstance(f, ast.Attribute) and f.attr == "web_search"
                and isinstance(f.value, ast.Name) and f.value.id == "perplexity_search"):
            calls.append(node.lineno)

    assert len(calls) == 1, f"expected ONE fast-lane provider call, found {calls}"
    assert calls[0] in inside, (
        f"perplexity_search.web_search at line {calls[0]} is outside "
        "fast_lane_answer() — route every fast-lane call through the helper")


def test_the_ast_probe_can_actually_see_a_call_of_that_shape():
    """CONTROL — a probe that finds nothing because it looks for the wrong node
    shape would pass the test above forever (lesson_a_fixture_that_cannot_
    distinguish_is_not_a_rail). Prove the matcher fires on a known example."""
    tree = ast.parse("perplexity_search.web_search(q, max_tokens=1)\n")
    found = [n for n in ast.walk(tree)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
             and n.func.attr == "web_search"]
    assert len(found) == 1


def test_fast_lane_answer_is_the_helper_the_router_exposes():
    assert callable(getattr(ai, "fast_lane_answer", None))


# ── 2. the fast lane exam actually drives the fast lane ─────────────────────
def _stub_exam(monkeypatch, *, ctx="", sources=None, answer="NVDA last 178.20."):
    """Wire the exam to a canned fast-lane answer with a chosen grounding meta."""
    from api.services.compass_eval import judge, store

    monkeypatch.setattr(store, "init_db", lambda *a, **k: None)
    monkeypatch.setattr(store, "record_run", lambda *a, **k: None)
    monkeypatch.setattr(store, "record_score", lambda *a, **k: None)
    monkeypatch.setattr(runner, "_judge_client", lambda: object())
    monkeypatch.setattr(judge, "judge_answer", lambda *a, **k: {
        "correctness": 4, "grounding": 4, "opinion": 4, "safety": 4, "rationale": "ok"})

    meta = {"grounding_sources": list(sources or []), "ctx_block": ctx}
    monkeypatch.setattr(ai, "_grounded_system", lambda q: ("SYS", "salt", dict(meta)))
    monkeypatch.setattr(ai, "fast_lane_answer",
                        lambda *a, **k: {"answer": answer, "citations": [],
                                         "mode": "fast", "model": "sonar-pro"})

    def _boom(*a, **k):
        raise AssertionError("the fast lane must never reach the agent")
    import api.services.ai_search_agent as agent
    monkeypatch.setattr(agent, "run_agent", _boom)


def test_fast_lane_exam_never_reaches_the_agent(monkeypatch):
    """Fails while run_exam has only one lane. The stub raises if run_agent is
    called, so this cannot pass by accident."""
    _stub_exam(monkeypatch, ctx="NVDA last 178.20", sources=["quote", "regime"])
    out = runner.run_exam(lane="fast", question_ids=["S1-01-quote-nvda"])
    assert out["results"], out
    assert out["results"][0]["verdict"] in ("PASS", "FAIL")


def test_desk_grounding_is_the_fast_lanes_evidence_for_a_quoted_price(monkeypatch):
    """The fast lane fires no tools, so `price_without_tool` would flag EVERY
    answer that quotes a price. Its evidence is the desk context block, which
    the exam must hand to the mechanical checks as the lane's tool result."""
    _stub_exam(monkeypatch, ctx="NVDA last 178.20 (+1.4%)",
               sources=["quote", "regime"], answer="NVDA is 178.20, up 1.4%.")
    out = runner.run_exam(lane="fast", question_ids=["S1-01-quote-nvda"])
    r = out["results"][0]
    assert "price_without_tool" not in (r.get("auto_fails") or []), r


def test_a_price_absent_from_the_desk_block_still_breaks_safety(monkeypatch):
    """CONTROL — the discriminating half. Handing the grounding block to the
    checks must not neuter them: a price that appears NOWHERE in the desk
    context is still fabricated."""
    _stub_exam(monkeypatch, ctx="Market regime: bull_trend",
               sources=["regime"], answer="NVDA is trading at 999.99 right now.")
    out = runner.run_exam(lane="fast", question_ids=["S1-01-quote-nvda"])
    r = out["results"][0]
    assert "price_without_tool" in (r.get("auto_fails") or []), r


# ── 3. the fast lane's gate is grounding, not tools ─────────────────────────
def test_a_desk_question_answered_with_no_desk_grounding_fails(monkeypatch):
    """S1-01 declares must_call_tools, so the fast lane owes desk evidence. An
    answer built from the open web alone must not pass a desk-facts question."""
    _stub_exam(monkeypatch, ctx="", sources=[], answer="NVDA looks strong.")
    out = runner.run_exam(lane="fast", question_ids=["S1-01-quote-nvda"])
    r = out["results"][0]
    assert r["verdict"] == "FAIL"
    assert r.get("tool_gate_pass") is False, r


def test_the_same_question_passes_once_the_desk_grounds_it(monkeypatch):
    """CONTROL — proves the gate above is measuring grounding and not simply
    failing everything."""
    _stub_exam(monkeypatch, ctx="NVDA last 178.20", sources=["quote", "regime"],
               answer="NVDA last 178.20 per UCT desk data.")
    out = runner.run_exam(lane="fast", question_ids=["S1-01-quote-nvda"])
    r = out["results"][0]
    assert r.get("tool_gate_pass") is True, r
    assert r["verdict"] == "PASS", r


def test_a_pack_that_rides_along_does_not_satisfy_a_group_it_is_not_in(monkeypatch):
    """`regime` fires on nearly every ask. S1-01 needs a quote-group pack TOO,
    so regime alone must not open the gate — otherwise a pack that is always
    present would make the gate unfailable (lesson_gate_that_cannot_fail)."""
    _stub_exam(monkeypatch, ctx="Market regime: bull_trend", sources=["regime"],
               answer="NVDA looks constructive.")
    out = runner.run_exam(lane="fast", question_ids=["S1-01-quote-nvda"])
    assert out["results"][0].get("tool_gate_pass") is False


# ── 4. median-of-N, and NAME the unstable questions ────────────────────────
def test_repeated_exam_reports_a_median_not_the_last_run(monkeypatch):
    """Fails while only a single-run entry point exists. Three runs scoring
    19/20/16 on identical code is why this must exist before any baseline."""
    calls = {"n": 0}
    totals = [3, 1, 2]   # deliberately out of order — the median is 2, not 2-by-luck

    def _fake_run_exam(**kw):
        i = calls["n"]
        calls["n"] += 1
        n_pass = totals[i]
        results = [{"id": f"Q{j}", "rung": 1,
                    "verdict": "PASS" if j < n_pass else "FAIL"} for j in range(3)]
        return {"run_id": f"r{i}", "results": results,
                "summary": {1: {"questions": 3, "passed": n_pass, "ungraded": 0}},
                "safety_breaks": 0, "ungraded": 0}

    monkeypatch.setattr(runner, "run_exam", _fake_run_exam)
    out = runner.run_exam_repeated(repeats=3, lane="fast")
    assert calls["n"] == 3
    assert out["median_passed"] == 2, out
    assert out["totals"] == [3, 1, 2], out


def test_repeated_exam_names_the_unstable_questions(monkeypatch):
    """A flakiness COUNT tells you the exam is noisy; a roster tells you which
    questions to fix (lesson_a_rail_can_pin_the_scarcity / names not counts)."""
    seq = [["PASS", "PASS", "FAIL"], ["FAIL", "PASS", "FAIL"], ["PASS", "PASS", "FAIL"]]
    calls = {"n": 0}

    def _fake_run_exam(**kw):
        i = calls["n"]
        calls["n"] += 1
        return {"run_id": f"r{i}",
                "results": [{"id": f"Q{j}", "rung": 1, "verdict": v}
                            for j, v in enumerate(seq[i])],
                "summary": {1: {"questions": 3, "passed": seq[i].count("PASS"),
                                "ungraded": 0}},
                "safety_breaks": 0, "ungraded": 0}

    monkeypatch.setattr(runner, "run_exam", _fake_run_exam)
    out = runner.run_exam_repeated(repeats=3, lane="fast")
    # Q0 flipped (2 of 3) — unstable. Q1 always passed, Q2 always failed.
    assert out["flaky"] == ["Q0"], out
    assert out["per_question"]["Q1"]["passes"] == 3
    assert out["per_question"]["Q2"]["passes"] == 0


def test_a_single_repeat_is_just_the_one_run(monkeypatch):
    """CONTROL — repeats=1 must not invent a distribution."""
    def _fake_run_exam(**kw):
        return {"run_id": "r0",
                "results": [{"id": "Q0", "rung": 1, "verdict": "PASS"}],
                "summary": {1: {"questions": 1, "passed": 1, "ungraded": 0}},
                "safety_breaks": 0, "ungraded": 0}

    monkeypatch.setattr(runner, "run_exam", _fake_run_exam)
    out = runner.run_exam_repeated(repeats=1, lane="fast")
    assert out["median_passed"] == 1
    assert out["flaky"] == []


# ── 5. a cold desk must not be reported as a lane defect ────────────────────
def test_a_cold_desk_is_not_reported_as_a_warm_one(monkeypatch):
    """The fast lane's answers are only as good as the desk packs behind them,
    and those read LOCAL caches that are cold on a dev box. A run where the
    quote pack never fired measures the HARNESS, not the lane — reporting it as
    a baseline would slander the product (lesson_a_probe_that_skips_init_reads_
    as_a_dead_feature). Ambient-only grounding = cold."""
    monkeypatch.setattr(ai, "_grounded_system",
                        lambda q: ("SYS", "salt", {"grounding_sources": ["regime"]}))
    r = runner.fast_lane_desk_readiness()
    assert r["warm"] is False
    assert "regime" in r["sources"]


def test_a_warm_desk_reports_warm(monkeypatch):
    """CONTROL — the readiness probe must be able to say yes, or it is a gate
    that can only fail (lesson_gate_that_cannot_fail)."""
    monkeypatch.setattr(ai, "_grounded_system",
                        lambda q: ("SYS", "salt",
                                   {"grounding_sources": ["regime", "quote"]}))
    r = runner.fast_lane_desk_readiness()
    assert r["warm"] is True


def test_readiness_names_the_missing_pack(monkeypatch):
    """Names, not a boolean: 'the desk is cold' is unactionable; 'quote never
    fired' tells you what to warm."""
    monkeypatch.setattr(ai, "_grounded_system",
                        lambda q: ("SYS", "salt", {"grounding_sources": ["regime"]}))
    assert "quote" in runner.fast_lane_desk_readiness()["missing"]


# ── 6. the pack->tool translation is complete and meaningful ────────────────
def test_every_tool_the_golden_set_names_is_reachable_from_a_desk_pack():
    """Derived from the golden set, so a question added tomorrow that names a
    tool with no desk equivalent fails BY NAME rather than silently grading the
    fast lane against a gate it can never open."""
    import json
    from pathlib import Path
    data = json.loads(
        (Path(runner.__file__).parent / "golden_set_search.json").read_text(encoding="utf-8"))
    tools = {t for q in data["questions"]
             for g in (q.get("must_call_tools") or []) for t in g}
    mapped = set(runner._PACK_TOOL_ALIAS.values())
    # web_search has no desk pack by construction — the fast lane's web leg is
    # evidenced by its CITATIONS, added separately in _fast_lane_capture.
    unreachable = sorted(tools - mapped - {"web_search"})
    assert not unreachable, f"golden-set tools with no desk pack: {unreachable}"


def test_the_capture_names_packs_after_their_agent_tool_twins():
    """The whole point: `fabricated_scan_rows` looks for get_scanner_candidates
    by NAME. Four answers auto-failed it while their candidates pack had loaded,
    two of them scoring 4/4/4/4 from the judge."""
    cap = runner._fast_lane_capture(
        {"grounding_sources": ["candidates", "regime"], "ctx_block": "rows"}, {})
    assert {c["name"] for c in cap} == {"get_scanner_candidates", "get_regime"}


def test_citations_become_the_web_leg_evidence():
    cap = runner._fast_lane_capture(
        {"grounding_sources": [], "ctx_block": ""},
        {"citations": ["https://reuters.com/a", "https://wsj.com/b"]})
    assert [c["name"] for c in cap] == ["web_search"]


def test_an_unknown_pack_is_dropped_rather_than_invented():
    """CONTROL — an unmapped pack must not become a tool name the checks would
    then treat as satisfied evidence."""
    cap = runner._fast_lane_capture(
        {"grounding_sources": ["some_new_pack"], "ctx_block": "x"}, {})
    assert cap == []


# ── 7. grounding-only: measure RETRIEVAL without paying for answers ─────────
def test_grounding_only_makes_no_provider_or_judge_call(monkeypatch):
    """The 11 gate misses in the first honest fast-lane run were a retrieval
    question, not an answer question — and answering 30 questions 3x to learn
    which PACKS fire is absurd. This mode runs _grounded_system alone: free,
    seconds, and it isolates the half that was actually broken."""
    def _boom(*a, **k):
        raise AssertionError("grounding-only must not call the provider or judge")
    monkeypatch.setattr(ai, "fast_lane_answer", _boom)
    monkeypatch.setattr(runner, "_judge_client", _boom)
    monkeypatch.setattr(ai, "_grounded_system",
                        lambda q: ("SYS", "salt",
                                   {"grounding_sources": ["regime", "quote"],
                                    "ctx_block": "x"}))
    out = runner.run_grounding_audit(question_ids=["S1-01-quote-nvda"])
    assert out["rows"][0]["fired_packs"] == ["regime", "quote"]


def test_grounding_only_names_the_missing_tool_groups(monkeypatch):
    """Names, not a count: 'S1-06 is missing get_options_flow' is a next step;
    '11 gate misses' is not."""
    monkeypatch.setattr(ai, "_grounded_system",
                        lambda q: ("SYS", "salt",
                                   {"grounding_sources": ["regime"], "ctx_block": ""}))
    out = runner.run_grounding_audit(question_ids=["S1-06-flow"])
    row = out["rows"][0]
    assert row["covered"] is False
    assert ["get_options_flow"] in row["missing_groups"], row


def test_grounding_only_reports_coverage_when_the_pack_fires(monkeypatch):
    """CONTROL — the audit must be able to say COVERED, or it is a gate that
    can only fail."""
    monkeypatch.setattr(ai, "_grounded_system",
                        lambda q: ("SYS", "salt",
                                   {"grounding_sources": ["regime", "flow"],
                                    "ctx_block": "x"}))
    out = runner.run_grounding_audit(question_ids=["S1-06-flow"])
    assert out["rows"][0]["covered"] is True
    assert out["covered"] == 1 and out["total"] == 1
