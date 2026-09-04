"""Phase 8, Package 8E — structured explanation builder (SHADOW MODE ONLY).

Converts an already-canonical (adapted — see `canonical_adapter.py`)
`Detection` into an `Explanation`: a deterministic set of structured facts
answering WHY this detection matched, what currently strengthens or weakens
it, what stage it's in, and whether the scanner currently considers it
eligible. Two families only (`high_tight_flag`, `power_earnings_gap`), per
this package's authorization — every other `pattern_id` gets an Explanation
with an empty `sections` list, not a crash and not fabricated facts.

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

from api.services.pattern_engine.detectors.uct import high_tight_flag as _htf
from api.services.pattern_engine.detectors.uct import power_earnings_gap as _peg
from api.services.pattern_engine.types import Detection, Explanation, ExplanationFact

BUILDER_VERSION = "phase8.8e.1"

_IN_SCOPE_FAMILIES = (_htf._PATTERN_ID, _peg._PATTERN_ID)


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
    return []


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


# ─── strengths / weaknesses — DERIVED, by calling the detector's own separable
#     context-scoring helpers on the Detection's own stored context ─────────

_FAMILY_CONTEXT_FNS = {
    _htf._PATTERN_ID: (_htf._dcr_score_adjustment, _htf._can_slim_score_adjustment),
    _peg._PATTERN_ID: (_peg._dcr_score_adjustment, _peg._can_slim_score_adjustment),
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

_FAMILY_PHRASE_FNS = {
    _htf._PATTERN_ID: (
        _htf._trend_stage_description, _htf._ma_alignment_phrase, _htf._rs_trend_phrase,
    ),
    _peg._PATTERN_ID: (
        _peg._trend_stage_description, _peg._ma_alignment_phrase, _peg._rs_trend_phrase,
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
        facts.append(_fact(
            "market_context", "lifecycle", "direct",
            f"Forming in {stage_fn(context)} with {ma_fn(context)} moving-average "
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
