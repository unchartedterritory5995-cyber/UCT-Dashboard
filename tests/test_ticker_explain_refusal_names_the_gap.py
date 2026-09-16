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
