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
    adapt_bearish_engulfing,
    adapt_bullish_engulfing,
    adapt_bull_flag,
    adapt_flat_base,
    adapt_high_tight_flag,
    adapt_power_earnings_gap,
    adapt_pullback_to_50sma,
    adapt_vcp,
)
from api.services.pattern_engine.detectors.candlestick.bearish_engulfing import (
    detect_bearish_engulfing,
)
from api.services.pattern_engine.detectors.candlestick.bullish_engulfing import (
    detect_bullish_engulfing,
)
from api.services.pattern_engine.detectors.classical.bull_flag import detect_bull_flag
from api.services.pattern_engine.detectors.uct.flat_base import detect_flat_base
from api.services.pattern_engine.detectors.uct.high_tight_flag import detect_high_tight_flag
from api.services.pattern_engine.detectors.uct.power_earnings_gap import detect_power_earnings_gap
from api.services.pattern_engine.detectors.uct.pullback_to_50sma import detect_pullback_to_50sma
from api.services.pattern_engine.detectors.uct.vcp import detect_vcp
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
BE_ADAPTED = _adapted_detections("bullish_engulfing", detect_bullish_engulfing, adapt_bullish_engulfing)
BRE_ADAPTED = _adapted_detections("bearish_engulfing", detect_bearish_engulfing, adapt_bearish_engulfing)
BULL_FLAG_ADAPTED = _adapted_detections("bull_flag", detect_bull_flag, adapt_bull_flag)
FLAT_BASE_ADAPTED = _adapted_detections("flat_base", detect_flat_base, adapt_flat_base)
VCP_ADAPTED = _adapted_detections("vcp", detect_vcp, adapt_vcp)
P50_ADAPTED = _adapted_detections("pullback_to_50sma", detect_pullback_to_50sma, adapt_pullback_to_50sma)


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


# ─── semantic fixture tests — Bullish Engulfing ────────────────────────────

@pytest.mark.parametrize("name,detection", BE_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_be_why_it_matched_reflects_real_geometry_extras(name, detection):
    exp = build_explanation(detection)
    facts = _sections(exp)["why_it_matched"]
    extras = detection["geometry"]["extras"]

    by_id = {f["fact_id"]: f for f in facts}
    ratio_fact = by_id["be_engulfment_ratio"]
    assert ratio_fact["claim_type"] == "direct"
    assert ratio_fact["supporting_evidence"] == "geometry.extras.engulfment_ratio"
    assert f"{extras['engulfment_ratio']:.2f}x" in ratio_fact["label"]

    dcr_fact = by_id["be_engulfing_bar_dcr"]
    assert f"{extras['curr_bar_dcr'] * 100:.0f}%" in dcr_fact["label"]

    # every why_it_matched fact for Bullish Engulfing supports (they're all
    # pre-conditions the surviving detection already satisfied)
    assert all(f["polarity"] == "supports" for f in facts)


@pytest.mark.parametrize("name,detection", BE_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_be_reversal_context_fact_names_the_gate_that_actually_fired(name, detection):
    """The reversal-context fact must name only the reasons this SPECIFIC
    candidate cleared -- never all three unconditionally."""
    exp = build_explanation(detection)
    facts = _sections(exp)["why_it_matched"]
    extras = detection["geometry"]["extras"]
    ctx_fact = next((f for f in facts if f["fact_id"] == "be_reversal_context"), None)
    assert ctx_fact is not None, "a firing detection must have cleared the hard reversal gate"
    if extras.get("at_swing_low"):
        assert "swing low" in ctx_fact["label"]
    if extras.get("below_50sma"):
        assert "50-bar SMA" in ctx_fact["label"]
    if not extras.get("at_swing_low") and not extras.get("below_50sma"):
        assert "recent decline" in ctx_fact["label"]


@pytest.mark.parametrize("name,detection", BE_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_be_has_no_event_section(name, detection):
    assert "event" not in _sections(build_explanation(detection))


@pytest.mark.parametrize("name,detection", BE_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_be_warnings_flag_the_absent_sections_it_actually_lacks(name, detection):
    warnings = _sections(build_explanation(detection))["warnings"]
    by_id = {f["fact_id"]: f for f in warnings}
    assert "gate_trace_absent" in by_id
    assert by_id["gate_trace_absent"]["claim_type"] == "qualified"
    assert "event_absent" in by_id
    assert by_id["event_absent"]["claim_type"] == "qualified"


@pytest.mark.parametrize("name,detection", BE_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_be_market_context_uses_its_own_phrase_fns_without_duplicating_the_word(name, detection):
    """Bullish Engulfing's `_ma_phrase` omits the word "moving-average" (like
    PEG's) -- the composed market_context fact must therefore say it exactly
    once, never zero times and never twice."""
    facts = _sections(build_explanation(detection))["current_stage"]
    context_fact = next(f for f in facts if f["fact_id"] == "market_context")
    assert context_fact["label"].count("moving-average") == 0
    assert "alignment" in context_fact["label"]


@pytest.mark.parametrize("name,detection", BE_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_be_has_no_strengths_or_weaknesses_section(name, detection):
    """Bullish Engulfing's own `_score_context` is monolithic (no separable
    DCR/CAN-SLIM helper functions like HTF/PEG/Bull Flag) -- per this
    builder's rule 2 (no duplicated/invented detector judgment), strengths
    and weaknesses must be honestly OMITTED, never approximated."""
    sections = _sections(build_explanation(detection))
    assert "strengths" not in sections
    assert "weaknesses" not in sections


# ─── semantic fixture tests — Bearish Engulfing ────────────────────────────

@pytest.mark.parametrize("name,detection", BRE_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_bre_why_it_matched_reflects_real_geometry_extras(name, detection):
    exp = build_explanation(detection)
    facts = _sections(exp)["why_it_matched"]
    extras = detection["geometry"]["extras"]

    by_id = {f["fact_id"]: f for f in facts}
    ratio_fact = by_id["bre_engulfment_ratio"]
    assert ratio_fact["claim_type"] == "direct"
    assert ratio_fact["supporting_evidence"] == "geometry.extras.engulfment_ratio"
    assert f"{extras['engulfment_ratio']:.2f}x" in ratio_fact["label"]

    dcr_fact = by_id["bre_engulfing_bar_dcr"]
    assert f"{extras['curr_bar_dcr'] * 100:.0f}%" in dcr_fact["label"]

    assert all(f["polarity"] == "supports" for f in facts)


@pytest.mark.parametrize("name,detection", BRE_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_bre_reversal_context_fact_names_the_gate_that_actually_fired(name, detection):
    """The reversal-context fact must name only the reasons this SPECIFIC
    candidate cleared -- never all three unconditionally."""
    exp = build_explanation(detection)
    facts = _sections(exp)["why_it_matched"]
    extras = detection["geometry"]["extras"]
    ctx_fact = next((f for f in facts if f["fact_id"] == "bre_reversal_context"), None)
    assert ctx_fact is not None, "a firing detection must have cleared the hard reversal gate"
    if extras.get("at_swing_high"):
        assert "swing high" in ctx_fact["label"]
    if extras.get("above_50sma"):
        assert "50-bar SMA" in ctx_fact["label"]
    if not extras.get("at_swing_high") and not extras.get("above_50sma"):
        assert "recent advance" in ctx_fact["label"]


def test_bre_extras_are_read_with_the_bearish_specific_key_names_not_bullish_ones():
    """⛔⛔ THE CROSS-WIRE GUARD THIS PACKAGE EXISTS FOR. The owner-required
    semantic diff found 3 of 12 `geometry.extras` keys are DIRECTIONALLY
    RENAMED between the two families (`at_swing_high`/`above_50sma`/
    `recent_advance_pct` here vs the bullish side's `at_swing_low`/
    `below_50sma`/`recent_decline_pct`). If the explanation builder had
    accidentally been written against the BULLISH key names, this fixture
    (real bearish_engulfing extras) would silently produce NO reversal-context
    fact at all -- proving the read is real, not a copy-paste that happens to
    import cleanly."""
    assert BRE_ADAPTED, "fixture set must be non-empty for this rail to mean anything"
    _, detection = BRE_ADAPTED[0]
    extras = detection["geometry"]["extras"]
    # the bullish-named keys must be genuinely absent from a real bearish
    # detection -- otherwise this control proves nothing
    assert "at_swing_low" not in extras
    assert "below_50sma" not in extras
    assert "recent_decline_pct" not in extras
    assert any(k in extras for k in ("at_swing_high", "above_50sma", "recent_advance_pct"))
    facts = _sections(build_explanation(detection))["why_it_matched"]
    assert any(f["fact_id"] == "bre_reversal_context" for f in facts), (
        "the reversal-context fact never fired against real bearish extras -- "
        "the builder is reading the wrong (bullish-shaped) key names"
    )


@pytest.mark.parametrize("name,detection", BRE_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_bre_dcr_fact_does_not_reuse_bullish_directional_framing(name, detection):
    """The DCR confirmation direction is INVERTED for this family (a LOW
    curr_bar_dcr is the confirming signal) -- the fact must say so explicitly
    rather than implying "high DCR = good" the way the bullish family's own
    fact would."""
    facts = _sections(build_explanation(detection))["why_it_matched"]
    dcr_fact = next(f for f in facts if f["fact_id"] == "bre_engulfing_bar_dcr")
    assert "opposite of a bullish engulfing" in dcr_fact["label"]


@pytest.mark.parametrize("name,detection", BRE_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_bre_has_no_event_section(name, detection):
    assert "event" not in _sections(build_explanation(detection))


@pytest.mark.parametrize("name,detection", BRE_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_bre_warnings_flag_the_absent_sections_it_actually_lacks(name, detection):
    warnings = _sections(build_explanation(detection))["warnings"]
    by_id = {f["fact_id"]: f for f in warnings}
    assert "gate_trace_absent" in by_id
    assert by_id["gate_trace_absent"]["claim_type"] == "qualified"
    assert "event_absent" in by_id
    assert by_id["event_absent"]["claim_type"] == "qualified"


@pytest.mark.parametrize("name,detection", BRE_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_bre_market_context_uses_its_own_phrase_fns_without_duplicating_the_word(name, detection):
    facts = _sections(build_explanation(detection))["current_stage"]
    context_fact = next(f for f in facts if f["fact_id"] == "market_context")
    assert context_fact["label"].count("moving-average") == 0
    assert "alignment" in context_fact["label"]


@pytest.mark.parametrize("name,detection", BRE_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_bre_has_no_strengths_or_weaknesses_section(name, detection):
    """Bearish Engulfing's own `_score_context` is monolithic (no separable
    DCR/CAN-SLIM helper functions) -- strengths/weaknesses must be honestly
    OMITTED, matching Bullish Engulfing's own precedent."""
    sections = _sections(build_explanation(detection))
    assert "strengths" not in sections
    assert "weaknesses" not in sections


def test_bullish_and_bearish_engulfing_facts_never_cross_wire():
    """⛔ CROSS-WIRE GUARD (integration rehearsal). Both families are now
    genuinely registered in `_IN_SCOPE_FAMILIES` in this branch (Package 8F +
    8G, integrated together) -- unlike either family's own isolated branch,
    where the sibling family was never registered at all and a stub
    `pattern_id` with empty `sections` was enough to prove non-aliasing. Here
    the real proof is stronger: every BE_ADAPTED detection's `why_it_matched`
    facts must carry ONLY `be_`-prefixed fact_ids, and every BRE_ADAPTED
    detection's must carry ONLY `bre_`-prefixed ones -- across every real
    firing fixture in both batteries, not a single hand-built stub."""
    assert BE_ADAPTED and BRE_ADAPTED
    for _, detection in BE_ADAPTED:
        facts = _sections(build_explanation(detection)).get("why_it_matched", [])
        for f in facts:
            assert f["fact_id"].startswith("be_"), f"bullish detection produced non-bullish fact {f['fact_id']!r}"
    for _, detection in BRE_ADAPTED:
        facts = _sections(build_explanation(detection)).get("why_it_matched", [])
        for f in facts:
            assert f["fact_id"].startswith("bre_"), f"bearish detection produced non-bearish fact {f['fact_id']!r}"


# ─── semantic fixture tests — Bull Flag (Package 8H) ───────────────────────

@pytest.mark.parametrize("name,detection", BULL_FLAG_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_bull_flag_why_it_matched_reflects_real_geometry_extras(name, detection):
    exp = build_explanation(detection)
    facts = _sections(exp)["why_it_matched"]
    extras = detection["geometry"]["extras"]

    by_id = {f["fact_id"]: f for f in facts}
    pole_fact = by_id["bull_flag_pole_advance"]
    assert pole_fact["claim_type"] == "direct"
    assert pole_fact["supporting_evidence"] == "geometry.extras.pole_pct"
    assert f"{extras['pole_pct']:.1f}%" in pole_fact["label"]

    retrace_fact = by_id["bull_flag_retrace"]
    assert f"{extras['retrace_pct']:.1f}%" in retrace_fact["label"]
    if extras.get("flag_bars") is not None:
        assert str(extras["flag_bars"]) in retrace_fact["label"]

    parallel_fact = by_id["bull_flag_channel_parallel"]
    assert f"{extras['parallel_score']:.2f}" in parallel_fact["label"]

    # every why_it_matched fact for Bull Flag supports (they're all
    # pre-conditions the surviving detection already satisfied)
    assert all(f["polarity"] == "supports" for f in facts)


@pytest.mark.parametrize("name,detection", BULL_FLAG_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_bull_flag_has_no_event_section(name, detection):
    exp = build_explanation(detection)
    assert "event" not in _sections(exp)


@pytest.mark.parametrize("name,detection", BULL_FLAG_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_bull_flag_warnings_flag_the_absent_sections_it_actually_lacks(name, detection):
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


# ─── semantic fixture tests — VCP ──────────────────────────────────────────

@pytest.mark.parametrize("name,detection", VCP_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_vcp_why_it_matched_reflects_real_geometry_extras(name, detection):
    exp = build_explanation(detection)
    facts = _sections(exp)["why_it_matched"]
    extras = detection["geometry"]["extras"]

    by_id = {f["fact_id"]: f for f in facts}
    seq_fact = by_id["vcp_contraction_sequence"]
    assert seq_fact["claim_type"] == "direct"
    assert seq_fact["supporting_evidence"] == "geometry.extras.contraction_pcts"
    assert str(extras["n_contractions"]) in seq_fact["label"]
    for pct in extras["contraction_pcts"]:
        assert f"{pct:.1f}%" in seq_fact["label"]

    final_fact = by_id["vcp_final_contraction_tightness"]
    assert f"{extras['contraction_pcts'][-1]:.1f}%" in final_fact["label"]

    vol_fact = by_id["vcp_final_contraction_volume"]
    assert f"{extras['final_contraction_volume_ratio']:.0%}" in vol_fact["label"]

    # every why_it_matched fact for VCP supports (they're all pre-conditions
    # the surviving detection already satisfied)
    assert all(f["polarity"] == "supports" for f in facts)


@pytest.mark.parametrize("name,detection", VCP_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_vcp_has_no_event_section(name, detection):
    exp = build_explanation(detection)
    assert "event" not in _sections(exp)


@pytest.mark.parametrize("name,detection", VCP_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_vcp_warnings_flag_the_absent_sections_it_actually_lacks(name, detection):
    warnings = _sections(build_explanation(detection))["warnings"]
    by_id = {f["fact_id"]: f for f in warnings}
    assert "gate_trace_absent" in by_id
    assert by_id["gate_trace_absent"]["claim_type"] == "qualified"
    assert "event_absent" in by_id
    assert by_id["event_absent"]["claim_type"] == "qualified"


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


# ─── semantic fixture tests — Flat Base ────────────────────────────────────

@pytest.mark.parametrize("name,detection", FLAT_BASE_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_flat_base_why_it_matched_reflects_real_geometry_extras(name, detection):
    exp = build_explanation(detection)
    facts = _sections(exp)["why_it_matched"]
    extras = detection["geometry"]["extras"]

    by_id = {f["fact_id"]: f for f in facts}
    advance_fact = by_id["flat_base_prior_advance"]
    assert advance_fact["claim_type"] == "direct"
    assert advance_fact["supporting_evidence"] == "geometry.extras.prior_advance_pct"
    assert f"{extras['prior_advance_pct']:.1f}%" in advance_fact["label"]
    assert str(extras["prior_advance_bars"]) in advance_fact["label"]

    depth_fact = by_id["flat_base_depth"]
    assert f"{extras['base_depth_pct']:.1f}%" in depth_fact["label"]
    assert str(extras["base_bars"]) in depth_fact["label"]

    vol_fact = by_id["flat_base_volume_contraction"]
    assert f"{extras['volume_contraction_pct']:.1f}%" in vol_fact["label"]

    # every why_it_matched fact for Flat Base supports (they're all
    # pre-conditions the surviving detection already satisfied)
    assert all(f["polarity"] == "supports" for f in facts)


@pytest.mark.parametrize("name,detection", FLAT_BASE_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_flat_base_has_no_event_section(name, detection):
    exp = build_explanation(detection)
    assert "event" not in _sections(exp)


@pytest.mark.parametrize("name,detection", FLAT_BASE_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_flat_base_warnings_flag_the_absent_sections_it_actually_lacks(name, detection):
    warnings = _sections(build_explanation(detection))["warnings"]
    by_id = {f["fact_id"]: f for f in warnings}
    assert "gate_trace_absent" in by_id
    assert by_id["gate_trace_absent"]["claim_type"] == "qualified"
    assert "event_absent" in by_id
    assert by_id["event_absent"]["claim_type"] == "qualified"


# ─── semantic fixture tests — Pullback to 50-SMA ───────────────────────────

@pytest.mark.parametrize("name,detection", P50_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_p50_why_it_matched_reflects_real_geometry_extras(name, detection):
    exp = build_explanation(detection)
    facts = _sections(exp)["why_it_matched"]
    extras = detection["geometry"]["extras"]

    by_id = {f["fact_id"]: f for f in facts}
    adv_fact = by_id["p50_prior_advance"]
    assert adv_fact["claim_type"] == "direct"
    assert adv_fact["supporting_evidence"] == "geometry.extras.prior_advance_pct"
    assert f"{extras['prior_advance_pct']:.0f}%" in adv_fact["label"]
    assert str(extras["prior_advance_bars"]) in adv_fact["label"]

    slope_fact = by_id["p50_sma_rising"]
    assert f"{extras['sma_50_slope_pct_over_20']:.2f}%" in slope_fact["label"]

    vol_fact = by_id["p50_test_reclaim_volume"]
    assert f"{extras['test_volume_ratio'] * 100:.0f}%" in vol_fact["label"]
    assert f"{extras['reclaim_volume_ratio'] * 100:.0f}%" in vol_fact["label"]


@pytest.mark.parametrize("name,detection", P50_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_p50_never_calls_a_below_average_reclaim_an_expansion(name, detection):
    """The settled Phase 2B/3A narrative correction (pullback_to_50sma.py's
    own header comment): a reclaim volume ratio below 1.0 is BELOW average,
    so calling it "expansion" would be a literal contradiction the detector's
    own narrative deliberately avoids. This explanation layer must not
    reintroduce that removed claim."""
    extras = detection["geometry"]["extras"]
    exp = build_explanation(detection)
    vol_fact = next(f for f in _sections(exp)["why_it_matched"] if f["fact_id"] == "p50_test_reclaim_volume")
    if extras["reclaim_volume_ratio"] < 1.0:
        assert "expansion" not in vol_fact["label"].lower()
        assert vol_fact["polarity"] == "neutral"
    else:
        assert vol_fact["polarity"] == "supports"


@pytest.mark.parametrize("name,detection", P50_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_p50_has_no_event_section(name, detection):
    exp = build_explanation(detection)
    assert "event" not in _sections(exp)


@pytest.mark.parametrize("name,detection", P50_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_p50_warnings_flag_the_absent_sections_it_actually_lacks(name, detection):
    warnings = _sections(build_explanation(detection))["warnings"]
    by_id = {f["fact_id"]: f for f in warnings}
    assert "gate_trace_absent" in by_id
    assert by_id["gate_trace_absent"]["claim_type"] == "qualified"
    assert "event_absent" in by_id
    assert by_id["event_absent"]["claim_type"] == "qualified"


# ─── current_stage / scanner_eligibility ───────────────────────────────────

@pytest.mark.parametrize("name,detection", HTF_ADAPTED + PEG_ADAPTED + BE_ADAPTED + BRE_ADAPTED + BULL_FLAG_ADAPTED + FLAT_BASE_ADAPTED + VCP_ADAPTED + P50_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_current_stage_status_fact_matches_detection_status(name, detection):
    facts = _sections(build_explanation(detection))["current_stage"]
    status_fact = next(f for f in facts if f["fact_id"] == "detection_status")
    assert detection["status"] in status_fact["label"]


@pytest.mark.parametrize("name,detection", HTF_ADAPTED + PEG_ADAPTED + BE_ADAPTED + BRE_ADAPTED + BULL_FLAG_ADAPTED + FLAT_BASE_ADAPTED + VCP_ADAPTED + P50_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
def test_market_context_never_says_moving_average_twice(name, detection):
    """Regression (found against real market-shaped data, Package 8F, not
    the fixture suite): HTF's own `_ma_alignment_phrase` already returns a
    phrase ending in "moving-average" ("fully stacked-bullish
    moving-average"); the explanation template used to append its own
    literal " moving-average alignment" after it, producing "...
    moving-average moving-average alignment" for every real HTF detection.
    PEG's phrase omits the word, so this bug was invisible on PEG alone."""
    facts = _sections(build_explanation(detection))["current_stage"]
    context_fact = next(f for f in facts if f["fact_id"] == "market_context")
    assert "moving-average moving-average" not in context_fact["label"]


@pytest.mark.parametrize("name,detection", HTF_ADAPTED + PEG_ADAPTED + BE_ADAPTED + BRE_ADAPTED + BULL_FLAG_ADAPTED + FLAT_BASE_ADAPTED + VCP_ADAPTED + P50_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
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


@pytest.mark.parametrize("name,detection", HTF_ADAPTED + PEG_ADAPTED + BE_ADAPTED + BRE_ADAPTED + BULL_FLAG_ADAPTED + FLAT_BASE_ADAPTED + VCP_ADAPTED + P50_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
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


@pytest.mark.parametrize("name,detection", HTF_ADAPTED + PEG_ADAPTED + BE_ADAPTED + BRE_ADAPTED + BULL_FLAG_ADAPTED + FLAT_BASE_ADAPTED + VCP_ADAPTED + P50_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
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


@pytest.mark.parametrize("name,detection", HTF_ADAPTED + PEG_ADAPTED + BE_ADAPTED + BRE_ADAPTED + BULL_FLAG_ADAPTED + FLAT_BASE_ADAPTED + VCP_ADAPTED + P50_ADAPTED, ids=lambda x: x if isinstance(x, str) else "")
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
