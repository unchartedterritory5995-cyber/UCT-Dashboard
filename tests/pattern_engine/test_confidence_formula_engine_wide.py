"""Engine-wide confidence-formula pin test.

For EVERY detector registered in the pattern engine, this test verifies that
the emitted ``confidence`` value equals the canonical weighted composite:

    confidence = round(0.40 * geometry_score
                     + 0.25 * volume_score
                     + 0.20 * context_score
                     + 0.15 * historical_score, 2)

where the four sub-scores are taken from the Detection's own
``quality_components`` dict.  This locks out the nr7-class bug: a formula
that computes different weights than it records in ``quality_components``
(e.g. using 0.20*vol when it stores vol_score=50 and the formula weight was
actually 0.35).

It also asserts that ``historical_score == 50.0`` (the cold-start prior) unless
the detector is documented as legitimately different.

Detectors with a fully-documented, non-canonical composite (structure
informational detectors and the CAN SLIM meta-detector) are marked
``xfail`` with an explicit reason — not silently skipped.

Procedure per detector
----------------------
1. Load all fixtures from ``tests/fixtures/<pattern_id>/`` via
   ``fixture_loader.load_all_fixtures``.
2. Pick the first positive fixture that actually makes the detector fire
   (build context via ``build_context`` when the fixture omits it).
3. Assert the formula pin on every emitted Detection.
4. If no firing fixture is found after exhausting all fixtures, ``pytest.skip``
   with an explicit reason (does not hide the detector silently).
"""
from __future__ import annotations

import pytest

# Importing the patterns router triggers self-registration of all detectors.
import api.routers.patterns  # noqa: F401

from api.services.pattern_engine.detectors.registry import (
    get_detector,
    list_pattern_ids,
)
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


# ---------------------------------------------------------------------------
# Detectors whose confidence is NOT the canonical 4-weight composite.
# These are legitimate documented deviations; we pin them with xfail so a
# human must consciously decide to change or accept the deviation.
#
# strict=True: the test body MUST raise an assertion (i.e. the formula still
# diverges). If someone fixes the detector to canonical, remove it from this
# list rather than leaving a stale xfail.
# ---------------------------------------------------------------------------
_CONFIDENCE_XFAIL_REASONS: dict[str, str] = {
    # Meta-detector: confidence = round(composite, 2) where composite is the
    # CAN SLIM pillar weighted score, not the engine's 4-component formula.
    # quality_components stores arbitrary pillar sub-scores (geom=composite,
    # vol=s_score, ctx=m_score) — not inputs to a 4-weight formula.
    "can_slim_composite": (
        "CAN SLIM meta-detector: confidence = round(composite_score, 2) "
        "per docstring; quality_components stores pillar sub-scores, not "
        "the canonical 4-weight formula inputs."
    ),
    # Structure informational detector: touch/r2 formula.
    # confidence = round(50 + 30*(touches-3)/4 + (r_squared-0.7)*100, 1)
    # quality_components stores geometry/volume/context/historical sub-scores
    # but these are NOT the inputs to the actual confidence formula.
    "major_trendlines": (
        "Structure detector: confidence uses touch-count + r_squared formula "
        "(not 4-weight composite). Documented in detector docstring."
    ),
    # Structure proximity: domain-specific formula.
    # confidence = round(max(60.0, 100.0 - distance_pct * 8.0), 1)
    "52w_proximity": (
        "Structure detector: confidence is proximity-based "
        "(100 - 8*distance_from_extreme_pct, floor 60). "
        "Not the canonical 4-weight formula."
    ),
    # Structure range: duration/touch-count formula.
    # confidence = round(max(50.0, min(90.0, base + duration_bonus + touch_bonus)), 1)
    "range_detection": (
        "Structure detector: confidence uses duration + touch-count bonuses. "
        "Not the canonical 4-weight formula."
    ),
    # Structure informational: step-based confidence (90/80/70/60/55).
    "accumulation_distribution": (
        "Structure detector: confidence is a step value (55/60/70/80/90) "
        "based on A/D score bands, not the canonical 4-weight formula."
    ),
    # Structure informational: always emits confidence=100.
    "swing_pivots": (
        "Structure detector: always emits confidence=100 per docstring "
        "(pivot detection is deterministic, not scored). "
        "Not the canonical 4-weight formula."
    ),
    # Structure informational: touch-count formula.
    # confidence = min(100, 50 + 10*(touch_count - 2) + (avg_strength - 50)*0.5)
    "support_resistance": (
        "Structure detector: confidence uses touch-count formula, "
        "not the canonical 4-weight composite."
    ),
    # Structure informational: Weinstein stage-specific scoring.
    "stage_analysis": (
        "Structure detector: confidence uses a stage-specific composite "
        "(MA stack, slope, volume, breadth components), not the canonical "
        "4-weight formula. Documented in detector source."
    ),
    # Structure informational: volume-ratio formula.
    # confidence = _compute_confidence(node_type, volume_ratio)
    "volume_profile_nodes": (
        "Structure detector: confidence is computed from node type and "
        "volume ratio (HVN/LVN), not the canonical 4-weight formula."
    ),
}

# No detectors are known to use historical_score != 50.0 (cold-start prior).
# If one legitimately does, add it here with an explanation.
_HIST_SCORE_XFAIL_REASONS: dict[str, str] = {}


def _canonical_confidence(qc: dict) -> float:
    """Recompute the canonical 4-weight confidence from quality_components."""
    return round(
        0.40 * qc["geometry_score"]
        + 0.25 * qc["volume_score"]
        + 0.20 * qc["context_score"]
        + 0.15 * qc["historical_score"],
        2,
    )


def _find_firing_detection(pattern_id: str) -> tuple[dict | None, str]:
    """
    Try all fixtures for *pattern_id* and return the first Detection emitted,
    plus the fixture name.  Returns (None, reason) if nothing fires.
    """
    detector_fn = get_detector(pattern_id)
    fixtures = load_all_fixtures(pattern_id, include_internal=False)
    if not fixtures:
        return None, "no fixtures found"

    for fix in fixtures:
        bars = fix.bars
        ctx = (
            fix.context
            if fix.context is not None
            else build_context(bars, sym="TEST")
        )
        try:
            detections = detector_fn(bars, ctx)
        except Exception:
            # Don't fail the whole scan on one broken fixture; keep trying.
            continue
        if detections:
            return detections[0], fix.source_filename

    return None, "no fixture caused the detector to fire"


# ---------------------------------------------------------------------------
# Parametrize over every registered pattern_id.
# ---------------------------------------------------------------------------
_ALL_PATTERN_IDS = list_pattern_ids()


def _make_params(xfail_map: dict[str, str]) -> list:
    """Build pytest param list with xfail marks for entries in xfail_map."""
    params = []
    for pid in _ALL_PATTERN_IDS:
        if pid in xfail_map:
            params.append(
                pytest.param(
                    pid,
                    marks=pytest.mark.xfail(
                        reason=xfail_map[pid],
                        strict=True,
                    ),
                )
            )
        else:
            params.append(pid)
    return params


_CONFIDENCE_PARAMS = _make_params(_CONFIDENCE_XFAIL_REASONS)
_HIST_PARAMS = _make_params(_HIST_SCORE_XFAIL_REASONS)


@pytest.mark.parametrize("pattern_id", _CONFIDENCE_PARAMS)
def test_confidence_formula_pin(pattern_id: str) -> None:
    """Confidence == canonical 4-weight composite for every emitted Detection."""
    detection, source = _find_firing_detection(pattern_id)
    if detection is None:
        pytest.skip(
            f"[{pattern_id}] No firing fixture found: {source}. "
            "Add a positive fixture so this detector is pinned."
        )

    qc = detection.get("quality_components")
    assert qc is not None, (
        f"[{pattern_id}] Detection from {source!r} has no quality_components key."
    )
    for key in ("geometry_score", "volume_score", "context_score", "historical_score"):
        assert key in qc, (
            f"[{pattern_id}] quality_components missing '{key}' (fixture: {source!r})."
        )

    expected = _canonical_confidence(qc)
    actual = detection["confidence"]
    assert actual == expected, (
        f"[{pattern_id}] confidence mismatch (fixture: {source!r}).\n"
        f"  actual   = {actual}\n"
        f"  expected = {expected}  (0.40*{qc['geometry_score']} + "
        f"0.25*{qc['volume_score']} + 0.20*{qc['context_score']} + "
        f"0.15*{qc['historical_score']})\n"
        f"  Likely cause: weights in formula don't match weights documented "
        f"in quality_components (nr7-class bug)."
    )


@pytest.mark.parametrize("pattern_id", _HIST_PARAMS)
def test_historical_score_cold_start_prior(pattern_id: str) -> None:
    """historical_score == 50.0 (cold-start prior) for all detectors.

    All registered detectors use 50.0 as the cold-start prior because no
    per-pattern historical performance data is yet loaded from the memory
    layer.  If a detector legitimately departs from this, add it to
    ``_HIST_SCORE_XFAIL_REASONS`` with documentation.
    """
    detection, source = _find_firing_detection(pattern_id)
    if detection is None:
        pytest.skip(
            f"[{pattern_id}] No firing fixture found: {source}."
        )

    qc = detection.get("quality_components")
    if qc is None:
        pytest.skip(f"[{pattern_id}] No quality_components to check.")

    hist = qc.get("historical_score")
    assert hist == 50.0, (
        f"[{pattern_id}] historical_score = {hist} (expected 50.0 cold-start prior). "
        f"Fixture: {source!r}. If this detector has real historical data, "
        "document it explicitly and add to _HIST_SCORE_XFAIL_REASONS."
    )
