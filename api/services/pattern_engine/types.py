"""TypedDict definitions for the pattern recognition engine.

These are the source-of-truth shapes for everything the engine emits.
Consumers (detectors, memory, API, UI) all import from here.
"""
from __future__ import annotations

from typing import Literal, NotRequired, TypedDict


class Bar(TypedDict):
    t: int    # unix seconds, bar start
    o: float
    h: float
    l: float
    c: float
    v: float


class Anchor(TypedDict):
    t: int
    price: float


class Pivot(TypedDict):
    t: int
    price: float
    type: Literal["high", "low"]
    strength: int   # 0-100, how dominant relative to neighbors
    bar_index: int  # index into the bars list it came from


class Trendline(TypedDict):
    """A fitted boundary line, TAGGED WITH THE SPACE IT WAS FITTED IN.

    ⛔ `space` IS LOAD-BEARING, NOT METADATA. `slope` carries a different
    UNIT in each space and `p1`/`p2` describe a different CURVE:

      - "price": slope is price-per-bar; the curve between p1 and p2 is the
                 straight line through them, so a linear read is exact.
      - "log":   slope is d(log price)/bar - a fractional growth rate per bar,
                 dimensionless. p1/p2 are exponentiated back into price for
                 drawing, but the curve BETWEEN them is exponential, so a
                 linear read between the endpoints is a CHORD, not the line.

    Read a price off a line with `geometry.price_at`, which respects this, and
    NEVER with `geometry.line_at`, which is unconditionally linear. Convert a
    slope to a comparable unit with `geometry.fractional_slope`.

    A line built by hand (a synthesized flat boundary, say) may omit `space`;
    every reader treats a missing value as "price", which is what such a line
    has always been. That is why it is NotRequired rather than defaulted at
    every construction site.
    """
    p1: Anchor
    p2: Anchor
    slope: float       # price per bar in "price" space; log-units per bar in "log"
    r_squared: float   # 0-1 fit quality
    touches: int       # number of pivots near the line
    validity: float    # 0-1 composite quality
    space: NotRequired[Literal["price", "log"]]   # absent == "price"


class Geometry(TypedDict):
    shape: Literal[
        "trendline_pair", "neckline", "cup_curve",
        "rectangle", "candle_mark", "horizontal_line",
    ]
    anchors: list[Anchor]
    extras: dict   # pattern-specific extras (height_pct, depth_pct, etc.)
    # Phase 8 Package 8D: optional, additive semantic labels for `anchors` —
    # the Phase-7 spec's own finding was that every renderer today addresses
    # anchors POSITIONALLY (anchors[0], anchors[1]...), which is exactly what
    # made VCP's variable-length zigzag and flat_base's 4th "prior advance
    # origin" anchor ambiguous under the same `shape` string as families
    # whose anchor count/meaning is fixed. `anchor_roles` (same length as
    # `anchors` when present) and `semantic_subtype` (a family-specific label
    # disambiguating intent beyond the 6 shape primitives, e.g.
    # "pole_and_flag" vs. "gap_event" — both still render as `trendline_pair`/
    # `candle_mark`) let a renderer opt into role-aware behavior without
    # breaking positional access for every family that hasn't been updated
    # yet — omission is the correct, honest state for any family this hasn't
    # been wired to, never a broken/incomplete-looking object.
    anchor_roles: NotRequired[list[str]]
    semantic_subtype: NotRequired[str]


class Levels(TypedDict):
    entry: float
    entry_condition: str
    stop: float
    stop_basis: str
    target_primary: float
    target_secondary: float | None
    risk_reward: float


class Context(TypedDict):
    trend_stage: int                                            # Weinstein 1-4
    rs_trend: Literal["up", "flat", "down"]
    ma_alignment: Literal["stacked_bullish", "mixed", "stacked_bearish"]
    volume_signature: Literal["contracting", "expanding", "neutral"]
    regime: str
    nearest_resistance: float | None
    nearest_support: float | None
    days_to_earnings: int | None
    sector_strength_rank: int | None
    # Phase 3 additions:
    recent_dcr_avg: float                                       # average DCR over last 10 bars, 0.0-1.0
    dcr_signature: Literal["accumulation", "distribution", "neutral"]  # trend-scale classifier
    # Phase 7.5 additions (CAN SLIM meta-pillar):
    can_slim_grade: Literal["A", "B", "C", "D"]                 # O'Neil 7-pillar composite grade
    can_slim_score: float                                       # 0-100 composite CAN SLIM score


class QualityComponents(TypedDict):
    geometry_score: float       # 0-100
    volume_score: float
    context_score: float
    historical_score: float


class Narrative(TypedDict):
    headline: str
    what_it_is: str
    why_it_matters: str
    what_to_watch_for: str
    failure_signal: str


class Outcome(TypedDict):
    entry_hit: bool
    stop_hit: bool
    target_hit: bool
    max_favorable_excursion_pct: float
    max_adverse_excursion_pct: float
    bars_to_resolution: int
    resolved_at: int | None


class Eligibility(TypedDict, total=False):
    """Phase 7/8: whether a detection should surface in the scanner RIGHT NOW,
    kept explicitly separate from pattern identity/lifecycle. Recon (Phase 7)
    found this was previously 4 independently-coded, non-communicating
    mechanisms (the shared 7-day `memory.ACTIVE_WINDOW_SECS`, ad hoc per-
    detector age gates that disagree in units, `pattern_join.py`'s own
    re-implemented copy of the 7-day window) — this section makes the
    engine-level piece of that into DATA instead of something re-derived from
    `detected_at` by hand every time.

    `eligible` is a POINT-IN-TIME evaluation, not a timeless stored fact — a
    consumer must treat a stale `evaluated_at` as unknown, not true (ChatGPT
    relay review, 2026-09-03). `eligibility_scope` is always the
    detector/scanner's own DEFAULT eligibility; a member's personal filters
    are a separate, later layer that composes on top of this, never inside it.
    """
    eligible: bool
    evaluated_at: int                      # unix sec this verdict was computed
    eligibility_scope: Literal["system_default"]
    eligibility_version: str               # bumped when the RULE changes, independent
                                            # of detector_version
    eligibility_reasons: list[str]
    freshness_bars: int | None             # bars since the family's own structurally-
                                            # defining event, if it has one — None is a
                                            # legitimate, honestly-reported "this family
                                            # has no such gate", not a missing value
    freshness_window_bars: int | None      # this family's OWN ceiling, if any — surfaced
                                            # as data so a cross-engine mismatch (e.g. the
                                            # rules-engine VCP's 15-bar ceiling vs.
                                            # base_catalog's 60-bar ceiling for the same
                                            # pattern name) is visible, not silently
                                            # normalized away
    active_window_secs: int                # the shared engine-level constant actually applied


class EventProvenance(TypedDict, total=False):
    """Phase 7/8: real today in exactly one field, one family (PEG's
    `days_to_earnings`/`earnings_linkage_verified`, Phase 6 Group 3) — living
    in the untyped `geometry.extras` grab-bag. This promotes it to a typed,
    optional section so a family with no event concept (bull_flag) can omit
    it entirely, while PEG's sibling `episodic_pivot` (currently missing the
    equivalent despite prose citations) has somewhere real to put it later.

    `event_id`/`ingested_at` (ChatGPT relay review, 2026-09-03): a plain
    source STRING is not enough to answer "which actual earnings event caused
    this detector to fire" during a future debugging session — both are
    optional, so a family with no addressable event record can still omit them.
    """
    event_id: str | None
    event_type: str
    event_timestamp: int | None
    ingested_at: int | None
    days_from_event: int | None
    verification_status: Literal["verified", "contradicted", "unavailable"]
    source: str | None


class Criterion(TypedDict):
    """= `api/services/screener/base_catalog.py`'s existing `Criterion`
    dataclass, promoted verbatim (NOT reinvented) as the canonical vocabulary
    for THRESHOLD PROVENANCE — "is this threshold's own number sourced?"
    Phase 7 recon found 3 of the 7 rules-engine detector files' own header
    comments explicitly name base_catalog.py as the answer to a DIFFERENT
    question ("is this structure present, with sourced criteria") than what
    they themselves compute ("where do I enter one") — a deliberate,
    2026-08-31-ruled split. This type is reused where a family's threshold
    genuinely has a sourced citation; it is NOT force-populated onto the
    rules-engine detectors, which is what `GateEvaluation` below is for.
    """
    condition: str
    value: object
    quote: str | None
    source_id: str | None
    confidence: Literal["high", "med"]
    missing: str | None
    origin: Literal["source", "uct"]
    missing_kind: Literal["source_silent", "not_computable", "our_scope"] | None


class GateEvaluation(TypedDict, total=False):
    """Phase 8 (added per ChatGPT relay review, 2026-09-03): distinct from
    `Criterion` above. `Criterion` answers "is this THRESHOLD sourced?" — a
    citation about a number's provenance. This answers a different question —
    "did THIS candidate clear THIS gate, and by how much?" — an evaluation
    trace, the vocabulary the 7 rules-engine detectors actually need to
    become explainable, since today every one of their gates is a bare
    `if not X: continue` with zero record kept of what passed or by how much
    margin. The two compose (`criterion_ref` may cite a `Criterion`'s
    `source_id` for the threshold's own provenance) without merging the two
    deliberately-separate engines.
    """
    criterion_id: str
    criterion_name: str
    observed_value: object
    expected_value: object | None
    operator: str | None                   # e.g. ">=", "<", "within_range"
    unit: str | None
    role: Literal["identity", "quality", "lifecycle", "eligibility", "context"]
    required: bool
    result: Literal["pass", "fail", "weak", "missing"]
    criterion_ref: str | None
    definition_version: str | None


class ScannerSummary(TypedDict, total=False):
    """Phase 8 Package 8C: the lightweight, scanner-facing projection of a
    canonical Detection (Phase-7 spec §16 / the Package-8C authorization §6).
    Built from an already-adapted Detection (one that has been through a
    `canonical_adapter.py` `adapt_*` function) by `canonical_adapter.
    build_scanner_summary` — every field is read straight off the Detection,
    never fabricated.

    ⛔ NOT YET WIRED INTO THE REAL SCANNER. `api/services/screener/
    pattern_join.py` (the actual, live scanner data path — traced directly,
    Package 8C) reads `pattern_detections` with a raw SQL projection of only
    5 existing columns (sym/pattern_id/direction/confidence/levels_json) and
    has no column for any Phase-7/8 canonical section. This type exists to
    prove the summary CONTRACT is correct in isolation; making it reach the
    real scanner requires the persistence change documented in this file's
    module docstring reference (Phase-7 spec, "Persistence Design for
    Canonical Sections" section) — a separately-owner-authorized schema
    change, not implied by this type's existence.
    """
    pattern_id: str
    pattern_name: str
    direction: Literal["bullish", "bearish", "neutral"]
    status: str                        # lifecycle, as the detector's own field — see
                                        # eligibility below for the SEPARATE concept
    scanner_eligible: bool | None       # None only if no Eligibility was ever computed
                                        # for this detection — never fabricated as True/False
    confidence: float
    quality_components: QualityComponents
    primary_reason: str                 # narrative.headline — already real, never invented
    freshness_note: str                 # honest description of the family's own freshness
                                        # gate, or its honest absence
    event_note: NotRequired[str]        # present only when the Detection carries `event`
    warnings: list[str]


class Detection(TypedDict):
    id: str
    sym: str
    tf: str
    pattern_id: str
    pattern_name: str
    category: Literal["classical", "candlestick", "uct", "structure"]
    direction: Literal["bullish", "bearish", "neutral"]
    start_t: int
    end_t: int
    pivot_ts: list[int]
    geometry: Geometry
    levels: Levels
    context: Context
    confidence: float                # 0-100
    quality_components: QualityComponents
    narrative: Narrative
    status: Literal["forming", "ready", "triggered", "completed", "failed", "expired"]
    outcome: Outcome | None
    detected_at: int
    last_seen_at: int
    # Phase 7/8 additive canonical extension — all optional-by-family, all
    # absent from every detection emitted before this change (see
    # NotRequired below). NOT YET PERSISTED: pattern_db.py's schema has 5
    # dedicated JSON columns (quality/geometry/levels/context/narrative), not
    # one blob for the whole Detection, so populating these sections does not
    # yet round-trip through storage — that is real future work (Phase 7
    # spec, migration Stage C+), not something this addition silently implies.
    eligibility: NotRequired[Eligibility]
    event: NotRequired[EventProvenance]
    criteria: NotRequired[list[Criterion]]
    gate_trace: NotRequired[list[GateEvaluation]]
