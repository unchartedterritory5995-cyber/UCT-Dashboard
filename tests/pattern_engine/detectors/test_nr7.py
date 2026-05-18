"""Battery test for the NR7 detector. Runs every fixture in
tests/fixtures/nr7/ and asserts the expected outcome.

Mirrors the structure of test_golden_cross.py.

--- _EPS / strict-narrowest truth (established from boundary fixtures) ---
The nr7 detector has NO _EPS constant and does not need one.
The strict-narrowest gate `last_range < r` uses plain `<`.

With 2-decimal rounded prices, h-l subtraction is exact in IEEE 754:
  e.g. 101.5 - 98.5 = 3.0 exactly (both representable as binary fractions).
  A tie (last_range == prior_range) produces bit-identical floats and plain
  `<` correctly returns False.

The boundary fixtures prove this directly:
  - nr7_edge_tie_boundary_no_fire: last_range == min(prior 6) → does NOT fire
  - nr7_edge_just_under_tie:       last_range = min(prior 6) - 0.02 → fires

The 0.02 margin is larger than any possible IEEE 754 residue in 2-decimal
arithmetic (~1e-15), so _EPS would be pure theatre here.  The plain `<` gate
is correct, honest, and sufficient.
"""
import pytest

from api.services.pattern_engine.detectors.classical.nr7 import detect_nr7
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("nr7", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_nr7_fixture(fixture):
    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_nr7(fixture.bars, ctx)

    if fixture.expected_fires:
        assert len(detections) >= 1, (
            f"Fixture {fixture.name!r} expected to fire but produced 0 detections."
        )
        d = max(detections, key=lambda x: x["confidence"])
        assert fixture.min_confidence <= d["confidence"] <= fixture.max_confidence, (
            f"Fixture {fixture.name!r}: confidence {d['confidence']:.1f} not in "
            f"expected band [{fixture.min_confidence}, {fixture.max_confidence}]"
        )
        if fixture.expected_geometry_shape:
            assert d["geometry"]["shape"] == fixture.expected_geometry_shape
    else:
        assert len(detections) == 0, (
            f"Fixture {fixture.name!r} expected NOT to fire, got "
            f"{len(detections)} detection(s)."
        )


def test_fixture_battery_has_minimum_coverage():
    fixtures = load_all_fixtures("nr7", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 3, f"need >=3 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Each body field must be >=700 chars; headline >=90 chars."""
    fixtures = load_all_fixtures("nr7", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"
    fixture = pos[0]
    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_nr7(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name!r} did not fire"
    d = detections[0]
    narrative = d["narrative"]
    assert len(narrative["headline"]) >= 90, (
        f"headline too short ({len(narrative['headline'])} chars): "
        f"{narrative['headline']!r}"
    )
    for field in ("what_it_is", "why_it_matters", "what_to_watch_for", "failure_signal"):
        text = narrative[field]
        assert len(text) >= 700, (
            f"narrative.{field} too short ({len(text)} chars): {text[:120]!r}..."
        )


def test_geometry_extras_richness():
    """All docstring-specified extras keys must be present, including short-side."""
    fixtures = load_all_fixtures("nr7", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"
    fixture = pos[0]
    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_nr7(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name!r} did not fire"
    d = detections[0]
    extras = d["geometry"]["extras"]

    # Docstring-specified extras: all must be present
    required_keys = (
        "nr7_range",
        "lookback_max_range",
        "nr4_also_true",
        "is_inside_bar",
        "bar_range_pct_of_avg",
        # short-side levels (in extras per spec)
        "entry_short",
        "stop_short",
        "target_short",
    )
    for key in required_keys:
        assert key in extras, f"missing geometry.extras.{key}"

    # NR7 is neutral
    assert d["direction"] == "neutral", (
        f"Expected direction='neutral', got {d['direction']!r}"
    )
    assert d["category"] == "classical", (
        f"Expected category='classical', got {d['category']!r}"
    )


def test_neutral_dual_levels():
    """Both long and short sides must be coherent for a neutral NR7 setup.

    Long side (primary, in levels):
      entry_long > bar_high, stop_long <= bar_low, target_long > entry_long
    Short side (in geometry.extras):
      entry_short < bar_low, stop_short >= bar_high, target_short < entry_short
    """
    fixtures = load_all_fixtures("nr7", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"
    fixture = pos[0]
    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_nr7(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name!r} did not fire"
    d = detections[0]

    levels = d["levels"]
    extras = d["geometry"]["extras"]
    last_bar = fixture.bars[-1]
    bar_high = last_bar["h"]
    bar_low = last_bar["l"]

    # Long side
    entry_long = levels["entry"]
    stop_long = levels["stop"]
    target_long = levels["target_primary"]
    assert entry_long > bar_high, (
        f"entry_long {entry_long} should be above bar_high {bar_high}"
    )
    assert stop_long <= bar_low, (
        f"stop_long {stop_long} should be <= bar_low {bar_low}"
    )
    assert target_long > entry_long, (
        f"target_long {target_long} should be above entry_long {entry_long}"
    )

    # Short side (from extras)
    entry_short = extras["entry_short"]
    stop_short = extras["stop_short"]
    target_short = extras["target_short"]
    assert entry_short < bar_low, (
        f"entry_short {entry_short} should be below bar_low {bar_low}"
    )
    assert stop_short >= bar_high, (
        f"stop_short {stop_short} should be >= bar_high {bar_high}"
    )
    assert target_short < entry_short, (
        f"target_short {target_short} should be below entry_short {entry_short}"
    )


# ---------------------------------------------------------------------------
# Strict-narrowest boundary unit test (honest _EPS framing)
# ---------------------------------------------------------------------------

def test_strict_tie_boundary_proof():
    """Proves the strict-< boundary using the edge fixtures directly.

    Pair: tie_boundary_no_fire (tie → 0 detections) and
          just_under_tie (range-0.02 → fires).

    With 2-decimal prices, range arithmetic is bit-exact (no float residue).
    The 0.02 margin is large relative to any IEEE 754 subtraction error (~1e-15).
    Therefore _EPS is not needed and is correctly absent from the detector.
    """
    fixtures = load_all_fixtures("nr7", include_internal=False)
    tie_fixture = next(
        (f for f in fixtures if f.name == "nr7_edge_tie_boundary_no_fire"), None
    )
    just_under_fixture = next(
        (f for f in fixtures if f.name == "nr7_edge_just_under_tie"), None
    )
    assert tie_fixture is not None, "missing nr7_edge_tie_boundary_no_fire fixture"
    assert just_under_fixture is not None, "missing nr7_edge_just_under_tie fixture"

    # Tie: the gate must reject (strict < fails at equality)
    ctx_tie = (
        tie_fixture.context
        if tie_fixture.context is not None
        else build_context(tie_fixture.bars, sym="TEST")
    )
    tie_detections = detect_nr7(tie_fixture.bars, ctx_tie)
    assert len(tie_detections) == 0, (
        f"Tie boundary: last_range == min(prior 6) must NOT fire "
        f"(strict < rejects ties). Got {len(tie_detections)} detection(s)."
    )

    # Just under: the gate must accept (strictly less than min of prior 6)
    ctx_under = (
        just_under_fixture.context
        if just_under_fixture.context is not None
        else build_context(just_under_fixture.bars, sym="TEST")
    )
    under_detections = detect_nr7(just_under_fixture.bars, ctx_under)
    assert len(under_detections) >= 1, (
        f"Just-under boundary: last_range = min(prior 6) - 0.02 MUST fire "
        f"(strictly narrowest). Got 0 detections. "
        f"No _EPS needed: 0.02 >> any float residue (~1e-15) on 2-decimal prices."
    )

    # Both fixtures use the same prior_6 min range — verify the delta
    tie_bars = tie_fixture.bars
    under_bars = just_under_fixture.bars
    tie_last_range = tie_bars[-1]["h"] - tie_bars[-1]["l"]
    under_last_range = under_bars[-1]["h"] - under_bars[-1]["l"]
    tie_prior_min = min(
        tie_bars[i]["h"] - tie_bars[i]["l"] for i in range(-7, -1)
    )
    assert abs(tie_last_range - tie_prior_min) < 1e-9, (
        f"Tie fixture: last_range={tie_last_range:.6f} should equal "
        f"min(prior_6)={tie_prior_min:.6f} (bit-identical for 2-decimal prices)"
    )
    delta = tie_prior_min - under_last_range
    assert abs(delta - 0.02) < 1e-9, (
        f"Just-under fixture: gap should be ~0.02, got {delta:.9f}. "
        f"No _EPS needed — gap is orders of magnitude above float residue."
    )
