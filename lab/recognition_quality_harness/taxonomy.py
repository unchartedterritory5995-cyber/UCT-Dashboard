"""Reusable root-cause taxonomy + classification rubrics for the
recognition-quality program, generalized from the Hammer / Bull Flag /
Pullback-to-21-EMA lab cycles.

This module has NO behavior beyond documenting fixed vocabularies as plain
Python enums/dataclasses -- it is the shared vocabulary every future family
(deep OR Tier-1) should classify findings against, so results are
comparable across families instead of each lab inventing its own labels
(which is what happened organically across the first three cycles: the
taxonomy strings were consistent in SPIRIT but typed by hand each time).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class RootCause(str, Enum):
    """Why a blind-judge verdict disagreed with detector_fired (or, for a
    disputed-but-agreeing case, why it was hard to call). Every disputed
    case in a corpus should be tagged with exactly one of these (or OTHER
    with a free-text explanation)."""

    DETECTOR_DEFECT = "DETECTOR_DEFECT"                # the code is objectively wrong per its OWN definition
    CORPUS_LABEL_DEFECT = "CORPUS_LABEL_DEFECT"         # the sampled case itself is a bad exemplar (data artifact, wrong window, etc.)
    JUDGE_ERROR = "JUDGE_ERROR"                         # the judge's stated reasoning is factually contradicted by the real numbers
    RENDERING_DEFECT = "RENDERING_DEFECT"               # the harness's own chart failed to show what the judge needed to see
    SEMANTIC_AMBIGUITY = "SEMANTIC_AMBIGUITY"           # a genuine, reasonable human/detector definitional disagreement (e.g. touch-by-close vs touch-by-wick)
    CONTEXT_DISAGREEMENT = "CONTEXT_DISAGREEMENT"       # the pattern is geometrically real but a human weighs surrounding context differently than the score does
    QUALITY_VS_IDENTITY = "QUALITY_VS_IDENTITY"         # the disagreement is really about how GOOD the setup is, not whether it exists at all
    FRESHNESS_LIFECYCLE = "FRESHNESS_LIFECYCLE"         # the trigger was real but the CURRENT bar's relationship to it has moved on (extended/failed/stale)
    GEOMETRY_DEFECT = "GEOMETRY_DEFECT"                 # the detector's exposed geometry payload does not (or cannot) show what actually happened
    DATA_DEFECT = "DATA_DEFECT"                         # the underlying OHLCV itself is wrong/corrupted (split, bad tick, provider gap)
    OTHER = "OTHER"                                      # explain in free text; do not force-fit


@dataclass
class Disagreement:
    """One disputed case's classification -- the atomic unit both Tier-1
    and Tier-2 passes should emit, so a future rollup can query across
    every family/case ever run without re-parsing free-text reports."""
    case_id: str
    detector_id: str
    root_cause: RootCause
    explanation: str
    verified_with_real_data: bool = False
    other_label: str | None = None  # required text when root_cause == OTHER


class RawConditionLevel(str, Enum):
    """How much intelligence a detector layers on top of its bare
    mathematical trigger condition. Assessed by reading the source, not by
    any automated proxy -- this is a judgment call, but a STRUCTURED one:
    answer it by checking which of the gates below are actually present in
    the code, not by vibes."""

    LEVEL_A_RAW_CONDITION = "A_RAW_CONDITION"
    # Pure math: "price crossed X" / "value exceeded threshold." No context
    # gate at all -- would fire identically in a raging bull market or a
    # dead flat chop.

    LEVEL_B_CONTEXT_AWARE = "B_CONTEXT_AWARE"
    # The raw condition is gated by at least one real market-context check
    # (trend stage, MA alignment, RS, regime) that can independently reject
    # a mathematically-true trigger.

    LEVEL_C_CONTEXT_AND_QUALITY = "C_CONTEXT_AND_QUALITY"
    # B, plus a genuine QUALITY scoring layer (not just pass/fail) that
    # differentiates a clean example from a marginal one -- e.g. a
    # composite confidence score, a grade, a parallel-channel score.

    LEVEL_D_CONTEXT_QUALITY_CURRENTNESS = "D_CONTEXT_QUALITY_CURRENTNESS"
    # C, plus the detector re-validates CURRENTNESS -- it checks not just
    # "did the trigger happen" but "is this still true as of the bar being
    # evaluated" (not already resolved/failed/extended past the trigger).

    LEVEL_E_FLAGSHIP = "E_FLAGSHIP"
    # D, plus rich, verified, member-ready geometry AND narrative/
    # explanation grounded in the same facts that gated the detection (no
    # daylight between "why it fired" and "what the member is shown").


class GeometryQuality(str, Enum):
    """Independent axis from RawConditionLevel -- a detector can have
    excellent identity/quality logic and still expose geometry too thin for
    a frontend to actually SHOW what happened (pullback_to_21ema: a single
    EMA-value anchor, no touch/reclaim markers) or vice versa."""

    NO_GEOMETRY = "NO_GEOMETRY"                    # detection carries no geometry payload at all
    MINIMAL_GEOMETRY = "MINIMAL_GEOMETRY"          # a single point/line, insufficient to show the actual event (e.g. one anchor)
    USEFUL_GEOMETRY = "USEFUL_GEOMETRY"            # enough anchors to draw the pattern's basic shape, but timestamps/coordinates may be approximate
    SEMANTIC_GEOMETRY = "SEMANTIC_GEOMETRY"        # anchors are tied to the actual bars/prices that gated the detection (pivots, touch bar, reclaim bar all identifiable)
    VERIFIED_MEMBER_READY = "VERIFIED_MEMBER_READY"  # SEMANTIC_GEOMETRY, AND independently checked to render correctly end-to-end (timestamps convert correctly, no leak of internal indices as raw values)


class Tier1Outcome(str, Enum):
    """The recommended disposition after a Tier-1 rapid triage pass."""
    HEALTHY = "HEALTHY"
    LIKELY_HEALTHY = "LIKELY_HEALTHY"
    NEEDS_DEEP_EVALUATION = "NEEDS_DEEP_EVALUATION"
    HARD_DEFECT_SUSPECTED = "HARD_DEFECT_SUSPECTED"
    PRODUCT_INTELLIGENCE_SHALLOW = "PRODUCT_INTELLIGENCE_SHALLOW"
    EVALUATION_HARNESS_INADEQUATE = "EVALUATION_HARNESS_INADEQUATE"


class RecommendedAction(str, Enum):
    KEEP_HEALTHY = "KEEP_HEALTHY"
    DEEP_EVALUATION = "DEEP_EVALUATION"
    FIX_HARD_DEFECT = "FIX_HARD_DEFECT"
    ENHANCE_PRODUCT_INTELLIGENCE = "ENHANCE_PRODUCT_INTELLIGENCE"
    GEOMETRY_WORK = "GEOMETRY_WORK"
    DEFER = "DEFER"
    DEPRECATION_RESEARCH = "DEPRECATION_RESEARCH"


# Lesson from the 2026-09 shared-freshness-defect remediation (shooting_star,
# hanging_man, bearish_engulfing, pullback_to_50sma): when a detector's OWN
# docstring/narrative already documents an explicit confirmation/invalidation
# lifecycle in English (e.g. "confirmation = a later close below the trigger's
# low; invalidation = a later close back above the trigger's high") but the
# code never checks it against the bars after the trigger, that gap is an
# OBJECTIVELY-DERIVABLE, safe fix -- no new semantics need to be invented,
# just make the code enforce what the docs already promise. Check for this
# BEFORE assuming a detector "requires lifecycle design" (Q7-Q9 above): read
# the docstring/narrative text for an already-authored lifecycle first.
FRESHNESS_STRESS_QUESTIONS = [
    "What bar/event caused qualification?",
    "How many bars can pass between that event and the evaluated bar?",
    "Does the detector inspect the bars AFTER the trigger, up to the eval bar?",
    "Can price materially move away from the trigger and the setup still be emitted?",
    "Can the setup already have SUCCEEDED (broken out) and still be emitted as current?",
    "Can the setup already have FAILED (broken down) and still be emitted as current?",
    "Is a search/lookback window being mistaken for a freshness guarantee?",
    "Does the detector have explicit forming/current/triggered/failed/stale semantics?",
    "Should it? (Not every family needs a full lifecycle state machine -- say why.)",
]


@dataclass
class FreshnessStressAnswers:
    detector_id: str
    answers: dict[str, str] = field(default_factory=dict)  # question -> answer, keyed by the exact strings above

    def missing_questions(self) -> list[str]:
        return [q for q in FRESHNESS_STRESS_QUESTIONS if q not in self.answers]
