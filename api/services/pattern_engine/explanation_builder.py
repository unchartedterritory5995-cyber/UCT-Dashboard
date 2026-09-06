"""Phase 8, Package 8E — structured explanation builder (SHADOW MODE ONLY).

Converts an already-canonical (adapted — see `canonical_adapter.py`)
`Detection` into an `Explanation`: a deterministic set of structured facts
answering WHY this detection matched, what currently strengthens or weakens
it, what stage it's in, and whether the scanner currently considers it
eligible. Nine families now (`high_tight_flag`, `power_earnings_gap`,
`bullish_engulfing` — Package 8F, `bearish_engulfing` — Package 8G,
`bull_flag` — Package 8H, `flat_base` — Package 8I, `vcp`, `pullback_to_50sma`,
and `episodic_pivot` — the last added in a later, separately-authorized
package) — every other `pattern_id` gets an Explanation with an empty
`sections` list, not a crash and not fabricated facts.

`episodic_pivot`'s `event` section is a real, deliberate case of "HONEST
ABSENCE" (rule 5 below): its detector carries no event-provenance data of any
kind (event-provenance-adjudicated Category C — see
`canonical_adapter.adapt_episodic_pivot`'s own docstring), so `_event_facts`
gives it its OWN branch rather than falling through PEG's earnings-flavored
wording, which would otherwise imply an earnings hypothesis this family's
detector never makes.

GOVERNING RULES (this package's authorization; directly motivated by a
historical Phase-4A defect where a narrative layer stated things the
underlying evidence did not actually support):

  1. NO LLM DEPENDENCY. Every fact here is a deterministic read or
     re-derivation of a field already on the Detection — no generation, no
     synthesis, no free text beyond a fixed template filled with real values.

  2. NO DUPLICATED DETECTOR LOGIC. This module never re-implements a
     detector's own judgment about what counts as "good context." Where the
     detector already exposes that judgment as a separately-callable
     function (`_dcr_score_adjustment`, `_can_slim_score_adjustment` —
     identical in both detector modules, verified by direct read), this
     module calls that SAME function against the Detection's own stored
     `context` rather than a materialized fact already on the Detection
     (ChatGPT relay review, 2026-09-04: this is real runtime re-derivation
     from stored inputs, not a bare field read — described precisely rather
     than folded into "no recomputation"). Where no such separable function
     exists (e.g. the trend-stage/MA-alignment bonus logic is inlined inside
     each family's own monolithic `_score_context`), this module does NOT
     invent an equivalent judgment — it omits the fact rather than risk
     silently diverging from the detector's real scoring.

     KNOWN, ACCEPTED LIMITATION (relay review): calling the detector's
     CURRENT helper against a historical Detection means an old Detection
     could be re-explained through a newer helper version if the detector
     module changes — a version-drift risk. Not a blocker today, since the
     canonical production path is still dormant and every Detection this
     module ever sees today is built and explained in the same process run.
     A real requirement before broad live/historical explanation use, at
     which point some detector-version provenance (not yet modeled anywhere
     in this engine) would need to gate which helper version explains a
     given historical Detection.

  3. GEOMETRY/EXPLANATION CONSISTENCY. `why_it_matched` facts read the exact
     same `geometry.extras` keys the Package-8D chart geometry adapter reads
     for anchor roles, and PEG's facts read the exact same `gate_trace`
     entries the canonical adapter built — an explanation can never describe
     evidence the chart isn't also drawing from.

  4. WHY MATCHED, NEVER WHY OTHERS FAILED. Every fact here describes THIS
     surviving detection. Nothing here instruments or references candidates
     a detector considered and rejected (`gate_trace` itself carries the
     same limitation — see `canonical_adapter.py`'s module docstring).

  5. HONEST ABSENCE. A section with no facts is omitted entirely, never
     emitted empty. A value the Detection doesn't carry (no `eligibility`,
     no `event`, no per-family freshness gate) is described as unavailable/
     qualified — never guessed, never defaulted to a plausible-looking value.

Nothing here is persisted (Explanation is not one of `pattern_db.py`'s
columns) and nothing here is wired into any production code path — same
"shadow mode only" status as `canonical_adapter.py` ahead of its own,
separately-authorized reachability stage.
"""
from __future__ import annotations

from api.services.pattern_engine.detectors.candlestick import bearish_engulfing as _bre
from api.services.pattern_engine.detectors.candlestick import bullish_engulfing as _be
from api.services.pattern_engine.detectors.classical import bull_flag as _bf
from api.services.pattern_engine.detectors.uct import episodic_pivot as _ep
from api.services.pattern_engine.detectors.uct import flat_base as _flat_base
from api.services.pattern_engine.detectors.uct import high_tight_flag as _htf
from api.services.pattern_engine.detectors.uct import power_earnings_gap as _peg
from api.services.pattern_engine.detectors.uct import pullback_to_50sma as _p50
from api.services.pattern_engine.detectors.uct import vcp as _vcp
from api.services.pattern_engine.types import Detection, Explanation, ExplanationFact

BUILDER_VERSION = "phase8.8e.1"

_IN_SCOPE_FAMILIES = (
    _htf._PATTERN_ID, _peg._PATTERN_ID, _be._PATTERN_ID, _bre._PATTERN_ID, _bf._PATTERN_ID,
    _flat_base._PATTERN_ID, _vcp._PATTERN_ID, _p50._PATTERN_ID, _ep._PATTERN_ID,
)


def build_explanation(detection: Detection) -> Explanation:
    """Build the structured explanation for one Detection.

    A `pattern_id` outside this package's two in-scope families returns an
    Explanation with an empty `sections` list — honest absence, not a guess
    at a family this module was never authorized to explain.
    """
    sections: list[dict] = []
    if detection.get("pattern_id") in _IN_SCOPE_FAMILIES:
        for section_name, facts in (
            ("why_it_matched", _why_it_matched_facts(detection)),
            ("strengths", _strength_facts(detection)),
            ("weaknesses", _weakness_facts(detection)),
            ("current_stage", _current_stage_facts(detection)),
            ("scanner_eligibility", _scanner_eligibility_facts(detection)),
            ("event", _event_facts(detection)),
            ("warnings", _warning_facts(detection)),
        ):
            if facts:
                sections.append({"section": section_name, "facts": facts})

    return {
        "detection_id": detection["id"],
        "pattern_id": detection.get("pattern_id", ""),
        "generator_version": BUILDER_VERSION,
        "sections": sections,
    }


def _fact(
    fact_id: str, category: str, claim_type: str, label: str,
    supporting_evidence: str, polarity: str, priority: int,
) -> ExplanationFact:
    return {
        "fact_id": fact_id,
        "category": category,
        "claim_type": claim_type,
        "label": label,
        "supporting_evidence": supporting_evidence,
        "polarity": polarity,
        "priority": priority,
    }


# ─── why_it_matched — identity facts, straight off geometry.extras / gate_trace ──

def _why_it_matched_facts(detection: Detection) -> list[ExplanationFact]:
    pid = detection.get("pattern_id")
    if pid == _htf._PATTERN_ID:
        return _htf_why_it_matched_facts(detection)
    if pid == _peg._PATTERN_ID:
        return _peg_why_it_matched_facts(detection)
    if pid == _be._PATTERN_ID:
        return _bullish_engulfing_why_it_matched_facts(detection)
    if pid == _bre._PATTERN_ID:
        return _bearish_engulfing_why_it_matched_facts(detection)
    if pid == _bf._PATTERN_ID:
        return _bull_flag_why_it_matched_facts(detection)
    if pid == _flat_base._PATTERN_ID:
        return _flat_base_why_it_matched_facts(detection)
    if pid == _vcp._PATTERN_ID:
        return _vcp_why_it_matched_facts(detection)
    if pid == _p50._PATTERN_ID:
        return _p50_why_it_matched_facts(detection)
    if pid == _ep._PATTERN_ID:
        return _ep_why_it_matched_facts(detection)
    return []


def _flat_base_why_it_matched_facts(detection: Detection) -> list[ExplanationFact]:
    extras = detection.get("geometry", {}).get("extras", {})
    facts: list[ExplanationFact] = []
    p = 1

    prior_advance_pct = extras.get("prior_advance_pct")
    prior_advance_bars = extras.get("prior_advance_bars")
    if prior_advance_pct is not None and prior_advance_bars is not None:
        facts.append(_fact(
            "flat_base_prior_advance", "identity", "direct",
            f"Prior advance: {prior_advance_pct:.1f}% over {prior_advance_bars} bars "
            f"into the base (this family's own floor is "
            f"{_flat_base._MIN_PRIOR_ADVANCE * 100:.0f}%).",
            "geometry.extras.prior_advance_pct", "supports", p,
        ))
        p += 1

    base_depth_pct = extras.get("base_depth_pct")
    base_bars = extras.get("base_bars")
    if base_depth_pct is not None and base_bars is not None:
        facts.append(_fact(
            "flat_base_depth", "identity", "direct",
            f"Base depth {base_depth_pct:.1f}% over {base_bars} bars (this family's "
            f"own ceiling is {_flat_base._MAX_BASE_DEPTH * 100:.0f}%).",
            "geometry.extras.base_depth_pct", "supports", p,
        ))
        p += 1

    volume_contraction_pct = extras.get("volume_contraction_pct")
    if volume_contraction_pct is not None:
        facts.append(_fact(
            "flat_base_volume_contraction", "identity", "direct",
            f"Volume contracted {volume_contraction_pct:.1f}% from the base's first "
            f"half to its second half (this family's own gate requires the second "
            f"half to average under {_flat_base._MAX_VOL_LATTER_RATIO * 100:.0f}% of "
            f"the first half -- i.e. contraction above "
            f"{(1.0 - _flat_base._MAX_VOL_LATTER_RATIO) * 100:.0f}%).",
            "geometry.extras.volume_contraction_pct", "supports", p,
        ))
        p += 1

    return facts


def _htf_why_it_matched_facts(detection: Detection) -> list[ExplanationFact]:
    extras = detection.get("geometry", {}).get("extras", {})
    facts: list[ExplanationFact] = []
    p = 1

    pole_pct = extras.get("pole_pct")
    pole_bars = extras.get("pole_bars")
    if pole_pct is not None and pole_bars is not None:
        facts.append(_fact(
            "htf_pole_advance", "identity", "direct",
            f"Prior advance: {pole_pct:.1f}% over {pole_bars} bars into the pole top "
            f"(this family's own floor is {_htf._MIN_POLE_PCT * 100:.0f}%).",
            "geometry.extras.pole_pct", "supports", p,
        ))
        p += 1

    flag_volume_ratio = extras.get("flag_volume_ratio")
    if flag_volume_ratio is not None:
        facts.append(_fact(
            "htf_flag_volume_contraction", "identity", "direct",
            f"Flag volume contracted to {flag_volume_ratio * 100:.0f}% of the pole's "
            f"average volume (this family's own ceiling is "
            f"{_htf._MAX_FLAG_VOLUME_RATIO * 100:.0f}%).",
            "geometry.extras.flag_volume_ratio", "supports", p,
        ))
        p += 1

    retrace_pct = extras.get("retrace_pct")
    if retrace_pct is not None:
        facts.append(_fact(
            "htf_flag_retrace", "identity", "direct",
            f"Flag retraced {retrace_pct:.1f}% of the pole "
            f"(this family's own ceiling is {_htf._MAX_FLAG_RETRACE * 100:.0f}%).",
            "geometry.extras.retrace_pct", "supports", p,
        ))
        p += 1

    return facts


def _bullish_engulfing_why_it_matched_facts(detection: Detection) -> list[ExplanationFact]:
    """Bullish Engulfing has no `gate_trace` (no canonical adapter reconstructs
    one for it — see `adapt_bullish_engulfing`'s own docstring), so unlike
    PEG this reads directly off `geometry.extras`, the same identity fields
    the detector's own hard reversal-context gate (`detect_bullish_engulfing`)
    already computed and stored -- never re-derived or guessed here."""
    extras = detection.get("geometry", {}).get("extras", {})
    facts: list[ExplanationFact] = []
    p = 1

    ratio = extras.get("engulfment_ratio")
    if ratio is not None:
        facts.append(_fact(
            "be_engulfment_ratio", "identity", "direct",
            f"Bar N's body is {ratio:.2f}x bar N-1's body "
            f"(this family's own floor is {_be._MIN_ENGULF_BODY_RATIO:.1f}x).",
            "geometry.extras.engulfment_ratio", "supports", p,
        ))
        p += 1

    reversal_reasons = []
    if extras.get("at_swing_low"):
        reversal_reasons.append("at a near-term swing low")
    if extras.get("below_50sma"):
        reversal_reasons.append("below the 50-bar SMA")
    decline = extras.get("recent_decline_pct")
    if decline is not None and decline >= _be._MIN_DECLINE_FOR_REVERSAL * 100:
        reversal_reasons.append(f"after a {decline:.1f}% recent decline")
    if reversal_reasons:
        facts.append(_fact(
            "be_reversal_context", "identity", "direct",
            "Reversal-context gate cleared: " + "; ".join(reversal_reasons) + " "
            "(the detector requires at least one of these before it will build "
            "a detection at all).",
            "geometry.extras.at_swing_low|below_50sma|recent_decline_pct", "supports", p,
        ))
        p += 1

    dcr = extras.get("curr_bar_dcr")
    if dcr is not None:
        facts.append(_fact(
            "be_engulfing_bar_dcr", "identity", "direct",
            f"The engulfing bar closed at DCR {dcr * 100:.0f}% of its own range "
            f"({extras.get('dcr_strength', 'unclassified')}).",
            "geometry.extras.curr_bar_dcr", "supports", p,
        ))
        p += 1

    return facts


def _bearish_engulfing_why_it_matched_facts(detection: Detection) -> list[ExplanationFact]:
    """Bearish Engulfing has no `gate_trace` (same reasoning as Bullish
    Engulfing's own docstring), so this reads directly off `geometry.extras`.

    ⛔ NOT a mechanical copy of `_bullish_engulfing_why_it_matched_facts` --
    the owner-required semantic diff (Package 8G) found 3 of the 12 extras
    keys are DIRECTIONALLY RENAMED (`at_swing_high`/`above_50sma`/
    `recent_advance_pct` here, not the bullish side's `at_swing_low`/
    `below_50sma`/`recent_decline_pct`), and the DCR confirmation direction
    is INVERTED: a LOW `curr_bar_dcr` is this family's confirming signal, the
    opposite of bullish_engulfing's high-DCR signal. `dcr_strength()` is
    direction-unaware (`"weak"` just means DCR<=0.30), so the fact below
    describes the raw DCR position rather than reusing that label as if it
    universally meant something is wrong with the pattern.
    """
    extras = detection.get("geometry", {}).get("extras", {})
    facts: list[ExplanationFact] = []
    p = 1

    ratio = extras.get("engulfment_ratio")
    if ratio is not None:
        facts.append(_fact(
            "bre_engulfment_ratio", "identity", "direct",
            f"Bar N's body is {ratio:.2f}x bar N-1's body "
            f"(this family's own floor is {_bre._MIN_ENGULF_BODY_RATIO:.1f}x).",
            "geometry.extras.engulfment_ratio", "supports", p,
        ))
        p += 1

    reversal_reasons = []
    if extras.get("at_swing_high"):
        reversal_reasons.append("at a near-term swing high")
    if extras.get("above_50sma"):
        reversal_reasons.append("above the 50-bar SMA")
    advance = extras.get("recent_advance_pct")
    if advance is not None and advance >= _bre._MIN_ADVANCE_FOR_REVERSAL * 100:
        reversal_reasons.append(f"after a {advance:.1f}% recent advance")
    if reversal_reasons:
        facts.append(_fact(
            "bre_reversal_context", "identity", "direct",
            "Reversal-context gate cleared: " + "; ".join(reversal_reasons) + " "
            "(the detector requires at least one of these before it will build "
            "a detection at all).",
            "geometry.extras.at_swing_high|above_50sma|recent_advance_pct", "supports", p,
        ))
        p += 1

    dcr = extras.get("curr_bar_dcr")
    if dcr is not None:
        facts.append(_fact(
            "bre_engulfing_bar_dcr", "identity", "direct",
            f"The engulfing bar closed at DCR {dcr * 100:.0f}% of its own range -- "
            f"for this family a LOW value (close near the bar's own low) is the "
            f"confirming signal, the opposite of a bullish engulfing's high-DCR read.",
            "geometry.extras.curr_bar_dcr", "supports", p,
        ))
        p += 1

    return facts


_GATE_RESULT_POLARITY = {"pass": "supports", "fail": "weakens", "weak": "weakens", "missing": "neutral"}


def _peg_why_it_matched_facts(detection: Detection) -> list[ExplanationFact]:
    """One fact per `gate_trace` entry (ChatGPT relay review, 2026-09-04):
    `supporting_evidence` cites the gate's own `criterion_id` — a stable
    semantic identifier GateEvaluation already carries — rather than the
    entry's ordinal position in the list, which identifies position, not
    identity, and isn't safe as a durable reference. Reading `gate` straight
    out of the same `gate_trace` list this loop is iterating means the
    reference can never point at the wrong gate by construction; there is no
    separate lookup step that could drift from it."""
    gate_trace = detection.get("gate_trace") or []
    facts: list[ExplanationFact] = []
    for i, gate in enumerate(gate_trace):
        polarity = _GATE_RESULT_POLARITY.get(gate.get("result"), "neutral")
        criterion_id = gate.get("criterion_id", str(i))
        facts.append(_fact(
            f"peg_gate_{criterion_id}", "identity", "direct",
            f"{gate.get('criterion_name', 'gate')}: observed "
            f"{gate.get('observed_value')} vs. required {gate.get('operator', '')} "
            f"{gate.get('expected_value')} — {gate.get('result')}.",
            f"gate_trace[criterion_id={criterion_id}]", polarity, i + 1,
        ))
    return facts


def _bull_flag_why_it_matched_facts(detection: Detection) -> list[ExplanationFact]:
    extras = detection.get("geometry", {}).get("extras", {})
    facts: list[ExplanationFact] = []
    p = 1

    pole_pct = extras.get("pole_pct")
    if pole_pct is not None:
        facts.append(_fact(
            "bull_flag_pole_advance", "identity", "direct",
            f"Prior advance: {pole_pct:.1f}% into the pole top "
            f"(this family's own floor is {_bf._MIN_POLE_PCT * 100:.0f}%).",
            "geometry.extras.pole_pct", "supports", p,
        ))
        p += 1

    retrace_pct = extras.get("retrace_pct")
    flag_bars = extras.get("flag_bars")
    if retrace_pct is not None:
        duration_clause = f" over a {flag_bars}-bar flag" if flag_bars is not None else ""
        facts.append(_fact(
            "bull_flag_retrace", "identity", "direct",
            f"Flag retraced {retrace_pct:.1f}% of the pole{duration_clause} "
            f"(this family's own band is {_bf._MIN_FLAG_RETRACE * 100:.0f}-"
            f"{_bf._MAX_FLAG_RETRACE * 100:.0f}%).",
            "geometry.extras.retrace_pct", "supports", p,
        ))
        p += 1

    parallel_score = extras.get("parallel_score")
    if parallel_score is not None:
        facts.append(_fact(
            "bull_flag_channel_parallel", "identity", "direct",
            f"Flag channel parallel score {parallel_score:.2f} "
            f"(this family's own floor is {_bf._MIN_PARALLEL_SCORE:.2f}).",
            "geometry.extras.parallel_score", "supports", p,
        ))
        p += 1

    return facts


def _vcp_why_it_matched_facts(detection: Detection) -> list[ExplanationFact]:
    """VCP has no `gate_trace` (see `canonical_adapter.adapt_vcp`'s own
    docstring on why) — these facts instead read `geometry.extras` directly,
    citing the SAME `contraction_pcts`/`final_contraction_volume_ratio`
    values the chart's `why-it-matched` evidence and the detector's own
    narrative both already draw from, against `vcp.py`'s own real threshold
    constants (never a restated literal)."""
    extras = detection.get("geometry", {}).get("extras", {})
    facts: list[ExplanationFact] = []
    p = 1

    n = extras.get("n_contractions")
    pcts = extras.get("contraction_pcts")
    if n is not None and pcts:
        facts.append(_fact(
            "vcp_contraction_sequence", "identity", "direct",
            f"{n} contractions tightening {' -> '.join(f'{x:.1f}%' for x in pcts)} "
            f"(this family's own floor is {_vcp._MIN_CONTRACTIONS} contractions).",
            "geometry.extras.contraction_pcts", "supports", p,
        ))
        p += 1

        final_pct = pcts[-1]
        facts.append(_fact(
            "vcp_final_contraction_tightness", "identity", "direct",
            f"Final contraction tightened to {final_pct:.1f}% "
            f"(this family's own ceiling is "
            f"{_vcp._MAX_FINAL_CONTRACTION_PCT * 100:.0f}%).",
            "geometry.extras.contraction_pcts", "supports", p,
        ))
        p += 1

    vol_ratio = extras.get("final_contraction_volume_ratio")
    if vol_ratio is not None:
        facts.append(_fact(
            "vcp_final_contraction_volume", "identity", "direct",
            f"Final contraction volume ran {vol_ratio:.0%} of the 50-bar "
            f"average — lower means more of the prior supply has been absorbed.",
            "geometry.extras.final_contraction_volume_ratio", "supports", p,
        ))
        p += 1

    return facts


def _p50_why_it_matched_facts(detection: Detection) -> list[ExplanationFact]:
    """Pullback to 50-SMA has no `gate_trace` (see `adapt_pullback_to_50sma`'s
    own docstring on why) — these facts read `geometry.extras` directly.
    `_MIN_PRIOR_ADVANCE_PCT` is this family's own named constant (cited, not
    restated); the test/reclaim volume-ratio gates are bare inline literals
    in the detector (1.3 / 0.9, never named), so — matching the detector's
    OWN restraint in its narrative — these facts state the OBSERVED ratios
    only, never assert an un-named threshold number.

    The reclaim-volume clause deliberately reuses the SAME
    `reclaim_vol_ratio >= 1.0` boolean the detector's own
    `_compose_narrative` computes before calling anything "expansion" — the
    settled Phase 2B/3A correction (this file's own header comment: the 0.9
    gate floor is BELOW average, so calling it "expanding" would be a literal
    contradiction). This module must not reintroduce that removed claim."""
    extras = detection.get("geometry", {}).get("extras", {})
    facts: list[ExplanationFact] = []
    p = 1

    prior_adv = extras.get("prior_advance_pct")
    prior_bars = extras.get("prior_advance_bars")
    if prior_adv is not None and prior_bars is not None:
        facts.append(_fact(
            "p50_prior_advance", "identity", "direct",
            f"Prior advance: {prior_adv:.0f}% over {prior_bars} bars "
            f"(this family's own floor is "
            f"{_p50._MIN_PRIOR_ADVANCE_PCT * 100:.0f}%).",
            "geometry.extras.prior_advance_pct", "supports", p,
        ))
        p += 1

    slope = extras.get("sma_50_slope_pct_over_20")
    sma_val = extras.get("sma_50_value")
    if slope is not None and sma_val is not None:
        facts.append(_fact(
            "p50_sma_rising", "identity", "direct",
            f"50-SMA at {sma_val:.2f} rising {slope:.2f}% over the trailing "
            f"20 bars (this family requires a rising 50-SMA — falling or "
            f"flat disqualifies the setup before a Detection is ever built).",
            "geometry.extras.sma_50_slope_pct_over_20", "supports", p,
        ))
        p += 1

    test_ratio = extras.get("test_volume_ratio")
    reclaim_ratio = extras.get("reclaim_volume_ratio")
    if test_ratio is not None and reclaim_ratio is not None:
        reclaim_is_expansion = reclaim_ratio >= 1.0
        reclaim_clause = (
            f"reclaimed on volume at {reclaim_ratio * 100:.0f}% of the "
            f"20-bar average — an expansion back into the level"
            if reclaim_is_expansion else
            f"reclaimed on volume at {reclaim_ratio * 100:.0f}% of the "
            f"20-bar average — below average, not an expansion, but inside "
            f"this detector's own floor for 'enough volume returned to hold "
            f"the level'"
        )
        facts.append(_fact(
            "p50_test_reclaim_volume", "identity", "direct",
            f"Tested the 50-SMA on volume at {test_ratio * 100:.0f}% of "
            f"average, then {reclaim_clause}.",
            "geometry.extras.reclaim_volume_ratio",
            "supports" if reclaim_is_expansion else "neutral", p,
        ))
        p += 1

    return facts


def _ep_why_it_matched_facts(detection: Detection) -> list[ExplanationFact]:
    """One fact per `gate_trace` entry -- same shape as PEG's own, above
    (reads the identical gate_trace `canonical_adapter.adapt_episodic_pivot`
    built from `geometry.extras`; kept as a separate function rather than
    shared with PEG's to avoid touching that already-tested code)."""
    gate_trace = detection.get("gate_trace") or []
    facts: list[ExplanationFact] = []
    for i, gate in enumerate(gate_trace):
        polarity = _GATE_RESULT_POLARITY.get(gate.get("result"), "neutral")
        criterion_id = gate.get("criterion_id", str(i))
        facts.append(_fact(
            f"ep_gate_{criterion_id}", "identity", "direct",
            f"{gate.get('criterion_name', 'gate')}: observed "
            f"{gate.get('observed_value')} vs. required {gate.get('operator', '')} "
            f"{gate.get('expected_value')} — {gate.get('result')}.",
            f"gate_trace[criterion_id={criterion_id}]", polarity, i + 1,
        ))
    return facts


# ─── strengths / weaknesses — DERIVED, by calling the detector's own separable
#     context-scoring helpers on the Detection's own stored context ─────────

_FAMILY_CONTEXT_FNS = {
    _htf._PATTERN_ID: (_htf._dcr_score_adjustment, _htf._can_slim_score_adjustment),
    _peg._PATTERN_ID: (_peg._dcr_score_adjustment, _peg._can_slim_score_adjustment),
    _bf._PATTERN_ID: (_bf._dcr_score_adjustment, _bf._can_slim_score_adjustment),
    _flat_base._PATTERN_ID: (
        _flat_base._dcr_score_adjustment, _flat_base._can_slim_score_adjustment,
    ),
    _vcp._PATTERN_ID: (_vcp._dcr_score_adjustment, _vcp._can_slim_score_adjustment),
    _p50._PATTERN_ID: (_p50._dcr_score_adjustment, _p50._can_slim_score_adjustment),
    _ep._PATTERN_ID: (_ep._dcr_score_adjustment, _ep._can_slim_score_adjustment),
}


def _strength_facts(detection: Detection) -> list[ExplanationFact]:
    return _context_facts(detection, want_positive=True)


def _weakness_facts(detection: Detection) -> list[ExplanationFact]:
    return _context_facts(detection, want_positive=False)


def _context_facts(detection: Detection, *, want_positive: bool) -> list[ExplanationFact]:
    pid = detection.get("pattern_id")
    fns = _FAMILY_CONTEXT_FNS.get(pid)
    context = detection.get("context")
    if fns is None or not context:
        return []
    dcr_fn, can_slim_fn = fns
    category = "context_strength" if want_positive else "context_weakness"
    polarity = "supports" if want_positive else "weakens"
    facts: list[ExplanationFact] = []
    p = 1

    dcr_adj = dcr_fn(context)
    dcr_is_relevant = dcr_adj > 0 if want_positive else dcr_adj < 0
    if dcr_is_relevant:
        sig = context.get("dcr_signature")
        avg = context.get("recent_dcr_avg")
        if want_positive:
            label = (
                f"Distribution/accumulation signature reads accumulation "
                f"(recent 10-bar average {avg:.2f}) — a tailwind this detector's own "
                f"context scoring already credits."
            )
        else:
            label = (
                f"Distribution/accumulation signature reads {sig} — a headwind this "
                f"detector's own context scoring already penalizes."
            )
        facts.append(_fact(
            "dcr_signature", category, "derived", label,
            "context.dcr_signature", polarity, p,
        ))
        p += 1

    can_slim_adj = can_slim_fn(context)
    if want_positive and can_slim_adj > 0:
        grade = context.get("can_slim_grade")
        score = context.get("can_slim_score")
        facts.append(_fact(
            "can_slim_grade", category, "derived",
            f"CAN SLIM composite grade {grade} ({score:.0f}/100) clears this "
            f"detector's own bonus threshold for leadership quality.",
            "context.can_slim_grade", polarity, p,
        ))
        p += 1
    # No CAN SLIM weakness fact: `_can_slim_score_adjustment` never returns a
    # negative value (grade below threshold = 0.0, not a penalty) — a
    # weakness fact here would fabricate a penalty the detector doesn't apply.

    return facts


# ─── current_stage — lifecycle facts: the Detection's own status + the same
#     stage/MA/RS phrasing the detector's own narrative already uses ──────

# pullback_to_50sma.py imports its phrase functions straight from the SHARED
# `narrative_helpers` module (`ma_alignment_phrase`, `trend_stage_description`,
# `rs_trend_phrase`) rather than defining its own family-local variants like
# HTF/PEG do — and, verified by direct read of `narrative_helpers.py`, those
# shared functions take a single already-extracted SCALAR
# (`Optional[str]`/`Optional[int]`), not the full `context` dict HTF/PEG's
# local copies take. `_current_stage_facts` below calls every registered
# triple as `fn(context)` uniformly, so these three thin wrappers extract the
# right scalar first — this is the ONLY way to reuse pullback_to_50sma's
# real, already-imported phrase functions without either changing the
# detector file or changing the shared dispatch every other family relies on.
def _p50_trend_stage_description(context: dict) -> str:
    return _p50.trend_stage_description(context.get("trend_stage"))


def _p50_ma_alignment_phrase(context: dict) -> str:
    return _p50.ma_alignment_phrase(context.get("ma_alignment"))


def _p50_rs_trend_phrase(context: dict) -> str:
    return _p50.rs_trend_phrase(context.get("rs_trend"))


_FAMILY_PHRASE_FNS = {
    _htf._PATTERN_ID: (
        _htf._trend_stage_description, _htf._ma_alignment_phrase, _htf._rs_trend_phrase,
    ),
    _peg._PATTERN_ID: (
        _peg._trend_stage_description, _peg._ma_alignment_phrase, _peg._rs_trend_phrase,
    ),
    # bullish_engulfing's own phrase fns are named _trend_phrase/_ma_phrase/
    # _rs_phrase (not the HTF/PEG names) but share the identical (context) ->
    # str signature. Its _ma_phrase omits the word "moving-average" (like
    # PEG's), so composing "{ma_fn(context)} alignment" here cannot repeat it.
    _be._PATTERN_ID: (_be._trend_phrase, _be._ma_phrase, _be._rs_phrase),
    # bearish_engulfing's own phrase fns are named _trend_phrase/_ma_phrase/
    # _rs_phrase (verified identical (context) -> str signature to bullish's
    # own trio during the Package 8G semantic diff). Its `_ma_phrase` omits
    # the word "moving-average" (confirmed by direct read), so composing
    # "{ma_fn(context)} alignment" here cannot repeat it.
    _bre._PATTERN_ID: (_bre._trend_phrase, _bre._ma_phrase, _bre._rs_phrase),
    _bf._PATTERN_ID: (
        _bf._trend_stage_description, _bf._ma_alignment_phrase, _bf._rs_trend_phrase,
    ),
    _flat_base._PATTERN_ID: (
        _flat_base._trend_stage_description, _flat_base._ma_alignment_phrase,
        _flat_base._rs_trend_phrase,
    ),
    _vcp._PATTERN_ID: (
        _vcp._trend_stage_description, _vcp._ma_alignment_phrase, _vcp._rs_trend_phrase,
    ),
    _p50._PATTERN_ID: (
        _p50_trend_stage_description, _p50_ma_alignment_phrase, _p50_rs_trend_phrase,
    ),
    _ep._PATTERN_ID: (
        _ep._trend_stage_description, _ep._ma_alignment_phrase, _ep._rs_trend_phrase,
    ),
}


def _current_stage_facts(detection: Detection) -> list[ExplanationFact]:
    facts: list[ExplanationFact] = []
    status = detection.get("status")
    if status:
        facts.append(_fact(
            "detection_status", "lifecycle", "direct",
            f"Detection status: {status}.",
            "status", "neutral", 1,
        ))

    pid = detection.get("pattern_id")
    context = detection.get("context")
    phrase_fns = _FAMILY_PHRASE_FNS.get(pid)
    if phrase_fns and context:
        stage_fn, ma_fn, rs_fn = phrase_fns
        # ma_fn(context) already includes the word "moving-average" for
        # HTF's own phrasing ("fully stacked-bullish moving-average") but
        # not PEG's ("fully stacked-bullish") — matching each detector's own
        # narrative template exactly (`{ma_phrase} alignment`, no extra word
        # inserted here) avoids a "moving-average moving-average" duplication
        # for HTF. Caught against real market data, Package 8F.
        facts.append(_fact(
            "market_context", "lifecycle", "direct",
            f"Forming in {stage_fn(context)} with {ma_fn(context)} "
            f"alignment and {rs_fn(context)} relative strength vs. the broader market.",
            "context.trend_stage", "neutral", 2,
        ))

    return facts


# ─── scanner_eligibility — direct where computed, explicitly qualified where not ──

def _scanner_eligibility_facts(detection: Detection) -> list[ExplanationFact]:
    eligibility = detection.get("eligibility")
    if eligibility is None:
        return [_fact(
            "eligibility_unavailable", "eligibility", "qualified",
            "Scanner eligibility has not been evaluated for this detection — it has "
            "not been through the canonical adapter, so eligible/not-eligible is "
            "UNKNOWN, not false.",
            "eligibility", "neutral", 1,
        )]

    facts: list[ExplanationFact] = []
    eligible = eligibility.get("eligible")
    facts.append(_fact(
        "eligibility_verdict", "eligibility", "direct",
        f"Scanner eligibility: {'eligible' if eligible else 'not eligible'} "
        f"(evaluated at unix {eligibility.get('evaluated_at')}).",
        "eligibility.eligible", "supports" if eligible else "weakens", 1,
    ))

    freshness_bars = eligibility.get("freshness_bars")
    if freshness_bars is not None:
        facts.append(_fact(
            "eligibility_freshness", "eligibility", "direct",
            f"Family-specific freshness: {freshness_bars}/"
            f"{eligibility.get('freshness_window_bars')} bars.",
            "eligibility.freshness_bars", "neutral", 2,
        ))
    else:
        facts.append(_fact(
            "eligibility_freshness_absent", "eligibility", "qualified",
            "This family has no per-family freshness gate — eligibility relies only "
            "on the shared active-window check, so 'eligible now' does not by itself "
            "guarantee freshness of the underlying structure.",
            "eligibility.freshness_bars", "neutral", 2,
        ))

    reasons = eligibility.get("eligibility_reasons")
    if reasons:
        facts.append(_fact(
            "eligibility_reasons", "eligibility", "direct",
            "; ".join(reasons) + ".",
            "eligibility.eligibility_reasons", "neutral", 3,
        ))

    return facts


# ─── event — PEG only; absent entirely for a family with no event concept ──

def _event_facts(detection: Detection) -> list[ExplanationFact]:
    event = detection.get("event")
    if event is None:
        return []

    if detection.get("pattern_id") == _ep._PATTERN_ID:
        # EP's "unavailable" is NOT "we don't have earnings data for this
        # candidate yet" (PEG's meaning, below) -- EP's own identity
        # criteria are price/volume-only and never establish any external
        # cause at all (canonical_adapter.adapt_episodic_pivot's own
        # EVENT PROVENANCE ADJUDICATION). Falling through to PEG's
        # earnings-flavored wording here would imply an earnings hypothesis
        # this family's detector never makes -- exactly the "a gap is not
        # event provenance" mistake this whole package exists to avoid.
        return [_fact(
            "event_absent_by_design", "event", "qualified",
            "Episodic Pivot's own identity criteria are price/volume-derived "
            "only (gap, range expansion, volume expansion, close strength) — "
            "the detector carries no external-event data of any kind, so "
            "causal provenance (why the gap happened) is unavailable and is "
            "not inferred from the gap itself.",
            "event.verification_status", "neutral", 1,
        )]

    verification = event.get("verification_status")
    days = event.get("days_from_event")
    if verification == "verified":
        label = (
            f"An earnings event is on record {abs(days) if days is not None else '?'} "
            f"day(s) from this gap — the earnings linkage is VERIFIED."
        )
        claim_type, polarity = "direct", "supports"
    elif verification == "contradicted":
        label = (
            f"The nearest earnings event on record is "
            f"{abs(days) if days is not None else '?'} days away — too far to be this "
            f"gap's cause, so the earnings linkage is CONTRADICTED for this candidate "
            f"even though earnings-date data exists."
        )
        claim_type, polarity = "direct", "weakens"
    else:
        label = (
            "No earnings-date data was available for this evaluation, so the earnings "
            "linkage is UNVERIFIED — treat this as a price/volume/hold "
            "gap-continuation setup until a reported earnings date confirms the "
            "catalyst."
        )
        claim_type, polarity = "qualified", "neutral"

    return [_fact(
        "event_linkage", "event", claim_type, label,
        "event.verification_status", polarity, 1,
    )]


# ─── warnings — measurement-transparency facts; never instruments rejected
#     candidates (rule 4 above) ─────────────────────────────────────────────

def _warning_facts(detection: Detection) -> list[ExplanationFact]:
    facts: list[ExplanationFact] = []
    p = 1

    quality = detection.get("quality_components") or {}
    if quality.get("historical_score") == 50.0:
        # ChatGPT relay review (2026-09-04): don't surface the raw neutral-
        # prior number at all — a UI could mistake "50.0" for a measured
        # percentage even inside a disclaiming sentence. State the absence
        # of evidence instead of a value that looks like a measurement.
        facts.append(_fact(
            "historical_score_neutral_prior", "warning", "qualified",
            "Historical outcome evidence is unavailable for this specific "
            "setup — the historical-performance component is an unscored "
            "neutral prior, not a measured win rate.",
            "quality_components.historical_score", "warning", p,
        ))
        p += 1

    pid = detection.get("pattern_id")
    if pid in _IN_SCOPE_FAMILIES:
        if "gate_trace" not in detection:
            facts.append(_fact(
                "gate_trace_absent", "warning", "qualified",
                "No gate-evaluation trace is available for this family — it defers "
                "criteria/provenance to a different engine rather than recording its "
                "own gate trace.",
                "gate_trace", "warning", p,
            ))
            p += 1
        else:
            facts.append(_fact(
                "gate_trace_scope", "warning", "qualified",
                "This trace shows only the gates THIS detection cleared — it does not "
                "include candidates the detector considered and rejected, so it "
                "cannot answer why other setups were not flagged.",
                "gate_trace", "warning", p,
            ))
            p += 1

        if "event" not in detection:
            facts.append(_fact(
                "event_absent", "warning", "qualified",
                "This family has no event-provenance concept — there is no "
                "earnings/catalyst linkage to report for this detection.",
                "event", "warning", p,
            ))
            p += 1

    return facts
