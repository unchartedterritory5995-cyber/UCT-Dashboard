"""Phase 8, Package 8E — structured explanation builder tests.

Runs the REAL detectors against REAL fixtures, adapts the resulting
Detection objects (Package 8A/8B/8C/8D's `canonical_adapter.py`), and builds
structured explanations from those real, canonical Detections — never
hand-authored fixture JSON. Two kinds of coverage, per this package's own
authorization:

  1. SEMANTIC FIXTURE TESTS — canonical Detection -> expected explanation
     facts, asserting exact values (not just "some list is non-empty").

  2. NEGATIVE "UNSUPPORTED-CLAIM" TESTS — directly motivated by a historical
     Phase-4A narrative-fabrication defect elsewhere in this program. Each
     proves the builder reports an honest "unavailable/qualified" state
     rather than fabricating a claim the underlying Detection doesn't
     support, and that no fact ever references candidates a detector
     rejected (the "why matched, never why others failed" boundary).
"""
import copy

import pytest

from api.services.pattern_engine.canonical_adapter import (
    adapt_high_tight_flag,
    adapt_power_earnings_gap,
)
from api.services.pattern_engine.detectors.uct.high_tight_flag import detect_high_tight_flag
from api.services.pattern_engine.detectors.uct.power_earnings_gap import detect_power_earnings_gap
from api.services.pattern_engine.explanation_builder import BUILDER_VERSION, build_explanation
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


def _adapted_detections(family, detect_fn, adapt_fn):
    out = []
    for fx in load_all_fixtures(family, include_internal=False):
        if not fx.expected_fires:
            continue
        ctx = fx.context if fx.context is not None else build_context(fx.bars, sym="TEST")
        detections = detect_fn(fx.bars, ctx)
        if detections:
            best = max(detections, key=lambda d: d["confidence"])
            out.append((fx.name, adapt_fn(best)))
    return out


HTF_ADAPTED = _adapted_detections("high_tight_flag", detect_high_tight_flag, adapt_high_tight_flag)
PEG_ADAPTED = _adapted_detections("power_earnings_gap", detect_power_earnings_gap, adapt_power_earnings_gap)


def _sections(explanation) -> dict:
    return {s["section"]: s["facts"] for s in explanation["sections"]}


def _all_facts(explanation) -> list:
    return [f for s in explanation["sections"] for f in s["facts"]]


# ─── shape / version ────────────────────────────────────────────────────────

@pytest.mark.parametrize("name,detection", HTF_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_explanation_shape_and_version(name, detection):
    exp = build_explanation(detection)
    assert exp["detection_id"] == detection["id"]
    assert exp["pattern_id"] == detection["pattern_id"]
    assert exp["generator_version"] == BUILDER_VERSION
    assert isinstance(exp["sections"], list)


def test_out_of_scope_family_gets_empty_sections_not_a_crash():
    d = {"id": "x", "pattern_id": "cup_and_handle", "status": "ready"}
    exp = build_explanation(d)
    assert exp["sections"] == []


# ─── semantic fixture tests — HTF ──────────────────────────────────────────

@pytest.mark.parametrize("name,detection", HTF_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_htf_why_it_matched_reflects_real_geometry_extras(name, detection):
    exp = build_explanation(detection)
    facts = _sections(exp)["why_it_matched"]
    extras = detection["geometry"]["extras"]

    by_id = {f["fact_id"]: f for f in facts}
    pole_fact = by_id["htf_pole_advance"]
    assert pole_fact["claim_type"] == "direct"
    assert pole_fact["supporting_evidence"] == "geometry.extras.pole_pct"
    assert f"{extras['pole_pct']:.1f}%" in pole_fact["label"]
    assert str(extras["pole_bars"]) in pole_fact["label"]

    vol_fact = by_id["htf_flag_volume_contraction"]
    assert f"{extras['flag_volume_ratio'] * 100:.0f}%" in vol_fact["label"]

    retrace_fact = by_id["htf_flag_retrace"]
    assert f"{extras['retrace_pct']:.1f}%" in retrace_fact["label"]

    # every why_it_matched fact for HTF supports (they're all pre-conditions
    # the surviving detection already satisfied)
    assert all(f["polarity"] == "supports" for f in facts)


@pytest.mark.parametrize("name,detection", HTF_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_htf_has_no_event_section(name, detection):
    exp = build_explanation(detection)
    assert "event" not in _sections(exp)


@pytest.mark.parametrize("name,detection", HTF_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_htf_warnings_flag_the_absent_sections_it_actually_lacks(name, detection):
    warnings = _sections(build_explanation(detection))["warnings"]
    by_id = {f["fact_id"]: f for f in warnings}
    assert "gate_trace_absent" in by_id
    assert by_id["gate_trace_absent"]["claim_type"] == "qualified"
    assert "event_absent" in by_id
    assert by_id["event_absent"]["claim_type"] == "qualified"


# ─── semantic fixture tests — PEG ──────────────────────────────────────────

@pytest.mark.parametrize("name,detection", PEG_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_peg_why_it_matched_mirrors_gate_trace_exactly(name, detection):
    exp = build_explanation(detection)
    facts = _sections(exp)["why_it_matched"]
    gate_trace = detection["gate_trace"]

    assert len(facts) == len(gate_trace)
    for fact, gate in zip(facts, gate_trace):
        # supporting_evidence cites the gate's own stable criterion_id, never
        # its ordinal position in the list (ChatGPT relay review, 2026-09-04).
        assert fact["supporting_evidence"] == f"gate_trace[criterion_id={gate['criterion_id']}]"
        assert fact["claim_type"] == "direct"
        assert str(gate["observed_value"]) in fact["label"]
        assert gate["criterion_name"] in fact["label"]
        assert fact["polarity"] == "supports"  # every gate on a surviving detection passed


@pytest.mark.parametrize("name,detection", PEG_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_peg_gate_trace_fact_ties_to_the_same_gap_pct_the_geometry_extras_carry(name, detection):
    """Geometry/explanation consistency (this package's rule 3): the number
    cited in the why-it-matched fact for the gap-pct gate must be the SAME
    number `geometry.extras.gap_pct` carries (the field the Package-8D chart
    renderer's candle-emphasis geometry is built alongside)."""
    exp = build_explanation(detection)
    facts = _sections(exp)["why_it_matched"]
    gap_fact = next(f for f in facts if f["fact_id"] == "peg_gate_peg_gap_pct_floor")
    observed_fraction = next(
        g["observed_value"] for g in detection["gate_trace"]
        if g["criterion_id"] == "peg_gap_pct_floor"
    )
    assert observed_fraction * 100 == pytest.approx(detection["geometry"]["extras"]["gap_pct"], abs=0.05)
    assert str(observed_fraction) in gap_fact["label"]


@pytest.mark.parametrize("name,detection", PEG_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_peg_event_section_present_and_matches_verification_status(name, detection):
    facts = _sections(build_explanation(detection))["event"]
    assert len(facts) == 1
    fact = facts[0]
    status = detection["event"]["verification_status"]
    if status == "verified":
        assert fact["claim_type"] == "direct" and fact["polarity"] == "supports"
    elif status == "contradicted":
        assert fact["claim_type"] == "direct" and fact["polarity"] == "weakens"
    else:
        assert status == "unavailable"
        assert fact["claim_type"] == "qualified" and fact["polarity"] == "neutral"


# ─── current_stage / scanner_eligibility ───────────────────────────────────

@pytest.mark.parametrize("name,detection", HTF_ADAPTED + PEG_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_current_stage_status_fact_matches_detection_status(name, detection):
    facts = _sections(build_explanation(detection))["current_stage"]
    status_fact = next(f for f in facts if f["fact_id"] == "detection_status")
    assert detection["status"] in status_fact["label"]


@pytest.mark.parametrize("name,detection", HTF_ADAPTED + PEG_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_scanner_eligibility_verdict_matches_the_real_eligibility_field(name, detection):
    facts = _sections(build_explanation(detection))["scanner_eligibility"]
    verdict = next(f for f in facts if f["fact_id"] == "eligibility_verdict")
    eligible = detection["eligibility"]["eligible"]
    assert ("not eligible" not in verdict["label"]) == eligible
    assert verdict["polarity"] == ("supports" if eligible else "weakens")
    # HTF/PEG have no per-family freshness gate today — must be qualified, never fabricated.
    freshness = next(f for f in facts if f["fact_id"].startswith("eligibility_freshness"))
    assert freshness["fact_id"] == "eligibility_freshness_absent"
    assert freshness["claim_type"] == "qualified"


# ─── NEGATIVE "unsupported-claim" tests ────────────────────────────────────

@pytest.mark.parametrize("name,detection", HTF_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_raw_unadapted_detection_never_fabricates_an_eligibility_boolean(name, detection):
    """A Detection that never went through canonical_adapter has no
    `eligibility` key at all — the builder must say UNKNOWN, never guess
    True or False."""
    raw = copy.deepcopy(detection)
    del raw["eligibility"]
    facts = _sections(build_explanation(raw))["scanner_eligibility"]
    assert len(facts) == 1
    assert facts[0]["fact_id"] == "eligibility_unavailable"
    assert facts[0]["claim_type"] == "qualified"
    # The DIRECT "Scanner eligibility: eligible/not eligible" template is only
    # used once eligibility has actually been computed — this fact must use
    # the separate unavailable template instead.
    assert not facts[0]["label"].startswith("Scanner eligibility: ")


@pytest.mark.parametrize("name,detection", HTF_ADAPTED + PEG_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_historical_score_is_never_presented_as_a_measured_win_rate(name, detection):
    exp = build_explanation(detection)
    # "win rate" may appear ONLY inside the neutral-prior disclaimer itself
    # (explicitly disclaiming it) — never in a fact that asserts it as a fact.
    for fact in _all_facts(exp):
        if "win rate" in fact["label"].lower():
            assert fact["fact_id"] == "historical_score_neutral_prior"
            assert fact["claim_type"] == "qualified"
    if detection["quality_components"]["historical_score"] == 50.0:
        warnings = _sections(exp)["warnings"]
        neutral_fact = next(f for f in warnings if f["fact_id"] == "historical_score_neutral_prior")
        assert neutral_fact["claim_type"] == "qualified"
        assert "neutral prior" in neutral_fact["label"]
        assert "unavailable" in neutral_fact["label"]
        # ChatGPT relay review (2026-09-04): the raw score must never appear —
        # a UI could mistake "50.0" for a measured percentage even inside a
        # disclaiming sentence, so the fact states absence, not a value.
        assert "50" not in neutral_fact["label"]


@pytest.mark.parametrize("name,detection", HTF_ADAPTED + PEG_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_no_fact_anywhere_references_rejected_candidates(name, detection):
    """The 'why matched, never why others failed' boundary — a rail, not
    just a docstring claim. `gate_trace_scope`/`gate_trace_absent` are the
    ONE allowed exception: they exist specifically to DISCLOSE this
    limitation (this package's rule 4), never to describe what a specific
    other candidate did. Every other fact must be silent on the subject."""
    exp = build_explanation(detection)
    forbidden = ("other candidate", "rejected", "did not fire", "failed to qualify", "near-miss")
    allowed_scope_disclosure = {"gate_trace_scope", "gate_trace_absent"}
    for fact in _all_facts(exp):
        if fact["fact_id"] in allowed_scope_disclosure:
            continue
        low = fact["label"].lower()
        for term in forbidden:
            assert term not in low, f"fact {fact['fact_id']!r} references rejected candidates: {fact['label']!r}"


@pytest.mark.parametrize("name,detection", HTF_ADAPTED + PEG_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_context_strength_and_weakness_never_both_claim_the_same_signal(name, detection):
    sections = _sections(build_explanation(detection))
    strength_ids = {f["fact_id"] for f in sections.get("strengths", [])}
    weakness_ids = {f["fact_id"] for f in sections.get("weaknesses", [])}
    assert not (strength_ids & weakness_ids)


def test_dcr_fact_absent_when_signature_is_neutral_not_fabricated_as_neutral_claim():
    """A dcr_signature of 'neutral' (or missing) must produce NO context
    fact — not a fabricated 'neutral tailwind' or 'neutral headwind' claim."""
    assert HTF_ADAPTED, "fixture set must be non-empty for this rail to mean anything"
    _, base = HTF_ADAPTED[0]
    d = copy.deepcopy(base)
    d["context"] = {**d["context"], "dcr_signature": "neutral", "recent_dcr_avg": 0.5,
                     "can_slim_grade": "C", "can_slim_score": 50}
    sections = _sections(build_explanation(d))
    strength_ids = {f["fact_id"] for f in sections.get("strengths", [])}
    weakness_ids = {f["fact_id"] for f in sections.get("weaknesses", [])}
    assert "dcr_signature" not in strength_ids
    assert "dcr_signature" not in weakness_ids


def test_missing_context_does_not_crash_and_omits_context_dependent_sections():
    assert HTF_ADAPTED, "fixture set must be non-empty for this rail to mean anything"
    _, base = HTF_ADAPTED[0]
    d = copy.deepcopy(base)
    del d["context"]
    exp = build_explanation(d)  # must not raise
    sections = _sections(exp)
    assert "strengths" not in sections
    assert "weaknesses" not in sections
    status_facts = sections["current_stage"]
    assert any(f["fact_id"] == "detection_status" for f in status_facts)
    assert not any(f["fact_id"] == "market_context" for f in status_facts)


def test_malformed_geometry_extras_is_skipped_not_fabricated():
    assert HTF_ADAPTED, "fixture set must be non-empty for this rail to mean anything"
    _, base = HTF_ADAPTED[0]
    d = copy.deepcopy(base)
    d["geometry"] = {**d["geometry"], "extras": {}}  # strip every extras key
    exp = build_explanation(d)  # must not raise
    sections = _sections(exp)
    assert "why_it_matched" not in sections


def test_peg_missing_gate_trace_produces_no_why_it_matched_section():
    assert PEG_ADAPTED, "fixture set must be non-empty for this rail to mean anything"
    _, base = PEG_ADAPTED[0]
    d = copy.deepcopy(base)
    del d["gate_trace"]
    exp = build_explanation(d)  # must not raise
    sections = _sections(exp)
    assert "why_it_matched" not in sections
    warnings = sections["warnings"]
    assert any(f["fact_id"] == "gate_trace_absent" for f in warnings)
