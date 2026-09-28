"""F-I1-2 — a refusal NAMES the missing thing, and the name is DERIVED.

Gate: `intelligence-layer-pre-implementation-gate.md`, slice 3 (F-I1-2). MEMBER-VISIBLE:
the refusal sentence changes. The refusal DECISION does not — same five response states,
same conditions — which is what the last test here pins.

⛔⛔ THE LOAD-BEARING PROPERTY IS THAT NOTHING THE MODEL WROTE REACHES THE SENTENCE.
Slice 1 measured that a fabricated number inside a refusal passed every mechanical check,
because the checker could not see that field. F-I1-2 makes refusals say MORE, which would
have made that hole matter more. Deriving the sentence from a CLOSED VOCABULARY closes it
by construction: there is no free text to police.
"""
from __future__ import annotations

import sys
import pathlib

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from api.services import ticker_explain as te  # noqa: E402


EV = [{"id": "e1"}]


# ── what it says ────────────────────────────────────────────────────────────

def test_an_empty_bundle_says_nothing_was_retrieved():
    out = te.derive_refusal_reason("NVDA", [], [])
    assert "no evidence for NVDA" in out
    assert "nothing was retrieved" in out


def test_a_populated_bundle_names_the_domains_it_does_cover():
    out = te.derive_refusal_reason("NVDA", EV, ["news", "analyst"])
    assert "news and analyst coverage" in out
    assert "not in it" in out


def test_it_uses_the_MEMBER_facing_label_not_the_machine_name():
    out = te.derive_refusal_reason("AAPL", EV, ["filings"])
    assert "SEC filings" in out
    assert "'filings'" not in out


def test_domains_are_listed_in_the_declared_order_not_call_order():
    # ⛔ Derived from _DOMAIN_ORDER so two callers passing the same set in
    # different orders cannot produce two different sentences.
    a = te.derive_refusal_reason("X", EV, ["analyst", "news"])
    b = te.derive_refusal_reason("X", EV, ["news", "analyst"])
    assert a == b


def test_it_returns_EMPTY_rather_than_inventing_a_specific_reason():
    """⚠️ An empty return is honest; an invented specific is not."""
    assert te.derive_refusal_reason("X", EV, []) == ""
    assert te.derive_refusal_reason("X", EV, ["not_a_domain"]) == ""


# ── the safety property ─────────────────────────────────────────────────────

def test_the_sentence_is_assembled_ONLY_from_the_closed_vocabulary():
    """No model text can reach it, whatever the model returned."""
    for dom in te._DOMAIN_ORDER:
        out = te.derive_refusal_reason("SYM", EV, [dom])
        assert te._DOMAIN_LABEL[dom] in out
    assert set(te._DOMAIN_LABEL) == set(te._DOMAIN_ORDER), "a domain with no member-facing label"


def test_no_digits_can_appear_in_a_derived_reason():
    """⛔ The slice-1 hole was a fabricated NUMBER inside a refusal. A derived
    sentence cannot carry one unless the SYMBOL does."""
    out = te.derive_refusal_reason("NVDA", EV, list(te._DOMAIN_ORDER))
    assert not any(ch.isdigit() for ch in out)


# ── the served result ───────────────────────────────────────────────────────

def _served(**kw):
    return te._result(sym="NVDA", question="q", response_state="refuse", **kw)


def test_a_refusal_with_NO_reason_gains_a_derived_one():
    r = _served(evidence=EV, domains=["news"], refusal_reason="")
    assert "What I can read for NVDA covers news" in r["insufficient_evidence_reason"]


def test_a_refusal_that_ALREADY_names_its_cause_is_left_alone(capsys):
    """⚰⚰ THE REGRESSION THIS EXISTS TO PREVENT, and it was nearly shipped.

    The first version replaced every refusal sentence. A COST-BUDGET refusal
    ("usage limit") became "nothing was retrieved" -- telling a member there is no data
    when the truth is the service stopped spending. A caller-supplied reason knows its
    own cause better than a function reading the evidence bundle ever can."""
    r = _served(evidence=[], domains=[], refusal_reason="Daily usage limit reached.")
    assert r["insufficient_evidence_reason"] == "Daily usage limit reached."
    assert "nothing was retrieved" not in r["insufficient_evidence_reason"]


def test_an_empty_bundle_with_no_reason_still_gains_one():
    r = _served(evidence=[], domains=[], refusal_reason="")
    assert "no evidence for NVDA" in r["insufficient_evidence_reason"]


def test_the_refusal_DECISION_is_untouched():
    """⛔ Only the sentence changes — the gate says so twice."""
    r = _served(evidence=EV, domains=["news"], refusal_reason="x")
    assert r["response_state"] == "refuse"
    assert r["insufficient_evidence"] is True


def test_ask_for_clarification_is_NOT_rewritten():
    r = te._result(sym="NVDA", question="q", response_state="ask_for_clarification",
                   evidence=EV, domains=["news"], clarification_question="which quarter?")
    assert r["insufficient_evidence_reason"] == "which quarter?"


def test_an_answering_state_still_carries_no_reason():
    r = te._result(sym="NVDA", question="q", response_state="answer",
                   evidence=EV, domains=["news"], summary="s")
    assert r["insufficient_evidence_reason"] == ""
    assert r["insufficient_evidence"] is False


# ═════════════════════════════════════════════════════════════════════════
# TERM-034 — I1-SPEC PART 3 (the refusal shape): the clauses nothing above
# enforced. Spec: docs/terminal-research/08-ai/
# i1-tool-contract-grounding-refusal-spec.md, Part 3. Already railed elsewhere
# and NOT re-railed: schema enum == `_RESPONSE_STATES` for EXPLAIN_SCHEMA and the
# `_clean_history` fail-closed coercion (test_ticker_explain_full_text_completeness
# .py), an invalid model state refused (test_ticker_explain.py::
# TestExplainRecentActivity::test_an_invalid_response_state_is_rejected_by_the_gate).
# ═════════════════════════════════════════════════════════════════════════

#: The five states, verbatim from the spec's code block. ⛔ Pinned on purpose:
#: "there is no sixth state" is a claim about the VALUE, and a rail that read the
#: tuple and compared it to itself would pass at any size.
_SPEC_STATES = ("answer", "answer_with_caveat", "partially_answer",
                "ask_for_clarification", "refuse")


def test_PART3_exactly_the_five_spec_states__no_sixth():
    print(f"[i1-rail:refusal] denominator: {len(te._RESPONSE_STATES)} response states "
          f"{list(te._RESPONSE_STATES)}")
    assert tuple(te._RESPONSE_STATES) == _SPEC_STATES, (
        f"`_RESPONSE_STATES` is now {te._RESPONSE_STATES}; I1-SPEC Part 3 defines "
        f"exactly {_SPEC_STATES}. A sixth state is a spec change — every consumer "
        "(AskAiTab, ComparisonAskAi, `_result`, `_clean_history`) branches on this set.")


def test_PART3_the_states_are_DEFINED_ONCE_across_every_I1_door():
    """*"Five response states, defined once."* Every I1 door's schema enum must BE
    `_RESPONSE_STATES`, never a second hand-typed copy — the compare door's
    schema is derived from the door list, not named here."""
    import importlib
    from tests.test_i1_tool_registry_contract import door_output_schemas
    schemas = door_output_schemas()
    print(f"[i1-rail:refusal] denominator: {len(schemas)} door schemas {sorted(schemas)}")
    assert len(schemas) >= 2, f"door derivation found only {schemas}"
    drift = {}
    for dotted, name in schemas.items():
        enum = getattr(importlib.import_module(dotted), name)["properties"]["response_state"]["enum"]
        if tuple(enum) != tuple(te._RESPONSE_STATES):
            drift[f"{dotted}.{name}"] = enum
    assert not drift, f"a door's response_state enum is not `_RESPONSE_STATES`: {drift}"


_MODEL_SENTENCE = "Sentinel model-authored refusal sentence, never derived."


def _served_model_refusal(monkeypatch):
    """Drive the REAL orchestrator with a model that refuses in its own words."""
    import json
    from types import SimpleNamespace
    monkeypatch.setattr(te, "_build_evidence", lambda sym, question="", prior_domains=None: (
        {"status": "resolved"}, [{"id": "E1", "type": "news", "date": "d", "source": "s",
                                  "text": "t", "url": None}], ["news"]))
    monkeypatch.setattr("api.services.narrative_cost_guard.over_budget", lambda *a, **kw: False)
    payload = {"response_state": "refuse", "summary": "", "key_facts": [],
               "interpretation": "", "caveat": "", "clarification_question": "",
               "refusal_reason": _MODEL_SENTENCE}
    resp = SimpleNamespace(stop_reason="end_turn",
                           content=[SimpleNamespace(type="text", text=json.dumps(payload))])
    monkeypatch.setattr(te, "_call_model", lambda *a, **kw: resp)
    return te.explain_recent_activity("NVDA", "what do transcripts say?")


def test_PART3_CONTROL_the_orchestrator_really_serves_a_refusal_here(monkeypatch):
    """Non-vacuity for the xfail below: the path is the model-refuse branch and a
    reason IS served, so the xfail cannot pass by the answer being empty."""
    out = _served_model_refusal(monkeypatch)
    assert out["response_state"] == "refuse"
    assert out["insufficient_evidence_reason"]


@pytest.mark.xfail(strict=True, reason=(
    "VIOLATION (I1-SPEC Part 3): 'the name is derived, never model-authored' — "
    "explain_recent_activity passes the MODEL's own refusal_reason to _result, whose "
    "`refusal_reason or derive_refusal_reason(...)` serves it verbatim as "
    "insufficient_evidence_reason. Known partial compliance, recorded in "
    "docs/terminal-research/verification/2026-09-14/F-I1-2-refusal-before-after.md "
    "('Full compliance would need the caller to distinguish a server reason from a "
    "model reason at _result'). Mitigated, not closed: the sentence is inside "
    "_full_answer_text, so a number or verdict in it is still caught. ⚠ Fixing it "
    "also changes tests/test_ticker_explain.py::test_model_declaring_refuse_is_passed"
    "_through_honestly, which pins the current behaviour. strict=True: the day it is "
    "fixed this goes red and the marker must be removed."))
def test_PART3_a_MODEL_authored_refusal_sentence_never_reaches_the_member(monkeypatch):
    out = _served_model_refusal(monkeypatch)
    assert _MODEL_SENTENCE not in out["insufficient_evidence_reason"], (
        "the member was shown the model's own explanation of its refusal")
