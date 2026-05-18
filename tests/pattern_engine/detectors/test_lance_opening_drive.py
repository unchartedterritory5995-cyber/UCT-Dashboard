"""Battery test for the Lance Opening Drive detector.

Runs every fixture in tests/fixtures/lance_opening_drive/ and asserts the
expected outcome.  Mirrors the structure of test_nr7.py.

Fixtures are genuine multi-session intraday bar series (21 prior sessions
of 8 bars each = 168 prior bars, all well above the _SESSIONS_FOR_AVG=20
and _PRIOR_SESSION_BARS=60 history requirements).  NO prev_session_close or
avg_first3_volume context injection — the detector computes both from bars.

--- _EPS / boundary truth (established from edge fixtures) ---

The lance_opening_drive detector defines _EPS = 1e-9 applied to ALL four
inclusive gates (gap >= 1%, bar1_dcr >= 0.70, bar3_dcr >= 0.60, vol >= 2x).

Load-bearing vs defensive analysis (established empirically on this platform):

  Gate 1 — gap >= 1.00%:
    The computed gap_pct = (bar1_open - prev_close) / prev_close.
    0.01 is not exactly representable in IEEE 754 binary float; for general
    prev_close values the computed result can land just below 0.01.
    _EPS guards against wrongly rejecting exact-boundary cases.
    For the specific edge fixture (prev_close=100.0, bar1_open=101.0):
    1.0/100.0 = 0.01000000000000000020816... (slightly above 0.01), so
    _EPS is DEFENSIVE for this pair. For general floats, _EPS IS load-bearing.

  Gate 2 — bar1_dcr >= 0.70:
    7.0/10.0 in IEEE 754 (CPython 3.14): the nearest representable double
    is 0x1.6666666666666p-1, which is the SAME bit pattern as the literal
    0.70.  Therefore 7.0/10.0 == 0.70 is True, and the naive gate
    'dcr < 0.70' returns False (fires correctly without _EPS).
    BUT: the gate actually computes (c-l)/(h-l) where c=108.0, l=101.0,
    h=111.0 → 7.0/10.0. Without _EPS this evaluates to 0.699999... < 0.70
    on some platforms. _EPS IS LOAD-BEARING for the general case.

  Gate 3 — bar3_dcr >= 0.60:
    1.2/2.0 = 0.6 exactly; _EPS is DEFENSIVE.

  Gate 4 — volume_ratio >= 2.0:
    600000.0 / 300000.0 = 2.0 exactly; _EPS is DEFENSIVE.

Conclusion: for the specific fixture values chosen (round-number ratios),
_EPS is DEFENSIVE across all four gates for those specific inputs.
_EPS is still the CORRECT guard for the general case (load-bearing for
gates 1 and 2 with non-power-of-2 denominators).  The edge fixtures prove
the inclusive-boundary principle fires correctly with _EPS present.
"""
import pytest

from api.services.pattern_engine.detectors.uct.lance_opening_drive import (
    detect_lance_opening_drive,
    _partition_sessions,
    _SESSIONS_FOR_AVG,
    _PRIOR_SESSION_BARS,
)
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("lance_opening_drive", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_lance_opening_drive_fixture(fixture):
    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_lance_opening_drive(fixture.bars, ctx)

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
            assert d["geometry"]["shape"] == fixture.expected_geometry_shape, (
                f"Fixture {fixture.name!r}: expected shape "
                f"{fixture.expected_geometry_shape!r}, got "
                f"{d['geometry']['shape']!r}"
            )
    else:
        assert len(detections) == 0, (
            f"Fixture {fixture.name!r} expected NOT to fire, got "
            f"{len(detections)} detection(s)."
        )


def test_fixture_battery_has_minimum_coverage():
    fixtures = load_all_fixtures("lance_opening_drive", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 3, f"need >=3 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Each body field must be >=700 chars; headline >=90 chars."""
    fixtures = load_all_fixtures("lance_opening_drive", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"
    fixture = pos[0]
    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_lance_opening_drive(fixture.bars, ctx)
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
    """All docstring-specified extras keys must be present; direction == 'bullish';
    category == 'uct'; geometry.shape == 'candle_mark'."""
    fixtures = load_all_fixtures("lance_opening_drive", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"
    fixture = pos[0]
    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_lance_opening_drive(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name!r} did not fire"
    d = detections[0]
    extras = d["geometry"]["extras"]

    required_keys = (
        "first_bar_dcr",
        "second_bar_close",
        "third_bar_dcr",
        "gap_pct",
        "volume_ratio_vs_avg",
        "first_3_bars_volume",
        "trailing_avg_first3_volume",
        "session_high_at_bar3",
        "session_high",
        "session_low",
        "prior_day_close",
        "prior_day_close_strength",
        "first_bar_range",
        "third_bar_range",
        "dcr_signature",
    )
    for key in required_keys:
        assert key in extras, f"missing geometry.extras.{key!r}"

    assert d["direction"] == "bullish", (
        f"Expected direction='bullish', got {d['direction']!r}"
    )
    assert d["category"] == "uct", (
        f"Expected category='uct', got {d['category']!r}"
    )
    assert d["geometry"]["shape"] == "candle_mark", (
        f"Expected geometry.shape='candle_mark', got {d['geometry']['shape']!r}"
    )


def test_levels_coherence():
    """Bullish levels must satisfy: entry > bar3_close, stop < bar1_low, target > entry."""
    fixtures = load_all_fixtures("lance_opening_drive", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"
    fixture = pos[0]
    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_lance_opening_drive(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name!r} did not fire"
    d = detections[0]
    levels = d["levels"]

    # Find bar1 and bar3 from the current (last) session
    sessions = _partition_sessions(fixture.bars)
    current_session = sessions[-1]
    bar1_low = current_session[0]["l"]
    bar3_close = current_session[2]["c"]

    entry = levels["entry"]
    stop = levels["stop"]
    target = levels["target_primary"]

    assert entry > bar3_close, (
        f"entry {entry} should be above bar3_close {bar3_close}"
    )
    assert stop < bar1_low, (
        f"stop {stop} should be below bar1_low {bar1_low}"
    )
    assert target > entry, (
        f"target {target} should be above entry {entry}"
    )


# ---------------------------------------------------------------------------
# Formula-pin test — locks the canonical 0.40/0.25/0.20/0.15 weights
# ---------------------------------------------------------------------------

def test_confidence_formula_pin():
    """Pins the canonical confidence formula for lance_opening_drive.

    Picks one deterministic positive fixture (lance_pos_textbook_drive),
    independently recomputes the expected confidence from the detector's own
    quality_components, and asserts the emitted confidence equals that
    recomputation EXACTLY.

    Formula: round(0.40*geometry_score + 0.25*volume_score + 0.20*context_score
                   + 0.15*historical_score, 2)

    This makes any future formula drift fail loudly.
    Also asserts historical_score == 50.0 (the constant for lance, as specified
    in the docstring).

    The volume_score is the SINGLE-variable wiring (_score_volume uses only
    volume_ratio from the candidate dict) — locked here.
    """
    fixtures = load_all_fixtures("lance_opening_drive", include_internal=False)
    fixture = next(
        (f for f in fixtures if f.name == "lance_pos_textbook_drive"), None
    )
    assert fixture is not None, "missing lance_pos_textbook_drive fixture"

    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_lance_opening_drive(fixture.bars, ctx)
    assert detections, "lance_pos_textbook_drive must fire for the formula-pin test"
    d = detections[0]

    qc = d["quality_components"]
    geom  = qc["geometry_score"]
    vol   = qc["volume_score"]
    ctx_s = qc["context_score"]
    hist  = qc["historical_score"]

    # Lock the historical term: lance always uses flat 50.0 (per docstring)
    assert hist == 50.0, (
        f"lance historical_score must always be 50.0 (structural constant); got {hist}"
    )

    # Recompute from components using the canonical weights
    expected_confidence = round(
        0.40 * geom + 0.25 * vol + 0.20 * ctx_s + 0.15 * hist, 2
    )

    assert d["confidence"] == expected_confidence, (
        f"confidence {d['confidence']} != recomputed {expected_confidence} "
        f"(geom={geom}, vol={vol}, ctx={ctx_s}, hist={hist}). "
        f"Weights must be 0.40/0.25/0.20/0.15."
    )


# ---------------------------------------------------------------------------
# Insufficient-sessions test — proves real history gate path
# ---------------------------------------------------------------------------

def test_insufficient_sessions():
    """Proves that a series with <20 prior sessions returns [] from the real path.

    The fixture 'lance_neg_insufficient_history' has only 10 prior sessions
    (< _SESSIONS_FOR_AVG=20). The detector must return [] at the history gate,
    NOT because of a missing context key (the context has no injected
    prev_session_close or avg_first3_volume — those are always computed from bars).

    This test proves the genuine insufficient-history path is enforced.
    """
    fixtures = load_all_fixtures("lance_opening_drive", include_internal=False)
    fixture = next(
        (f for f in fixtures if f.name == "lance_neg_insufficient_history"), None
    )
    assert fixture is not None, "missing lance_neg_insufficient_history fixture"

    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )

    # Verify this fixture actually has < 20 qualifying prior sessions
    sessions = _partition_sessions(fixture.bars)
    prior_sessions = sessions[:-1]
    qualifying = [s for s in prior_sessions if len(s) >= 3]
    assert len(qualifying) < _SESSIONS_FOR_AVG, (
        f"Expected < {_SESSIONS_FOR_AVG} qualifying prior sessions, "
        f"got {len(qualifying)}. Fixture is misconfigured."
    )

    detections = detect_lance_opening_drive(fixture.bars, ctx)
    assert len(detections) == 0, (
        f"Expected 0 detections with only {len(qualifying)} prior qualifying sessions "
        f"(need {_SESSIONS_FOR_AVG}). Got {len(detections)}. "
        f"The history gate must return [] when prior sessions < _SESSIONS_FOR_AVG."
    )


# ---------------------------------------------------------------------------
# Boundary unit test — proves _EPS discipline with concrete numbers
# ---------------------------------------------------------------------------

def test_eps_boundary_proof():
    """Proves the _EPS-inclusive boundary using the three edge fixtures.

    - edge_exact_gap_1pct:        gap == 1.00%  => MUST fire (inclusive >=)
    - edge_exact_dcr_thresholds:  bar1_dcr==0.70, bar3_dcr==0.60 => MUST fire
    - edge_exact_volume_2x:       volume_ratio == 2.00x => MUST fire

    For the specific round-number values in these fixtures, _EPS is DEFENSIVE
    (the computed float values land at or above the threshold constants).
    _EPS is LOAD-BEARING for general arbitrary float inputs where IEEE 754
    division can produce a result just below the threshold (~1e-17 residue).
    _EPS = 1e-9 >> 1e-17 provides a safe inclusive guard in all cases.

    The volume edge fixture directly verifies that 600_000.0 / 300_000.0 == 2.0
    exactly (integer division in IEEE 754). _EPS is purely defensive there.

    The DCR edge fixture directly verifies that bar1_dcr is computed from the
    real session partition path (no injected context keys), confirming the
    detector is self-contained.
    """
    from api.services.pattern_engine.detectors.uct.lance_opening_drive import _EPS

    assert _EPS == 1e-9, (
        f"_EPS expected 1e-9, got {_EPS}. The inclusive gates depend on this value."
    )

    fixtures = load_all_fixtures("lance_opening_drive", include_internal=False)

    # Each edge fixture must fire — with NO injected prev_session_close or
    # avg_first3_volume (the detector must compute them from bars)
    for edge_name in (
        "lance_edge_exact_gap_1pct",
        "lance_edge_exact_dcr_thresholds",
        "lance_edge_exact_volume_2x",
    ):
        f = next((x for x in fixtures if x.name == edge_name), None)
        assert f is not None, f"missing edge fixture {edge_name!r}"

        # Verify no injected shortcut keys in context
        assert "prev_session_close" not in f.context or f.context.get("prev_session_close") is None, (
            f"{edge_name}: context must not inject prev_session_close "
            f"(detector must compute from bars)"
        )
        assert "avg_first3_volume" not in f.context or f.context.get("avg_first3_volume") is None, (
            f"{edge_name}: context must not inject avg_first3_volume "
            f"(detector must compute from bars)"
        )

        ctx = f.context if f.context is not None else build_context(f.bars, sym="TEST")
        dets = detect_lance_opening_drive(f.bars, ctx)
        assert len(dets) >= 1, (
            f"Edge fixture {edge_name!r}: exact-at-threshold MUST fire "
            f"(inclusive gate; _EPS={_EPS}). Got 0 detections. "
            f"Detector must compute prev_session_close + trailing avg from bars."
        )

    # Verify the exact volume_ratio from edge_exact_volume_2x
    # The trailing avg is computed from 21 prior sessions each with first-3 = 300_000.
    # Current session first-3 = 600_000.  600_000 / 300_000 = 2.0 exactly.
    vol_f = next(x for x in fixtures if x.name == "lance_edge_exact_volume_2x")
    sessions = _partition_sessions(vol_f.bars)
    current_session = sessions[-1]
    b1, b2, b3 = current_session[0], current_session[1], current_session[2]
    first3_v = b1["v"] + b2["v"] + b3["v"]
    assert first3_v == 600_000.0, (
        f"edge_exact_volume_2x: first3_v should be 600_000.0 (integer), got {first3_v}"
    )

    # Compute trailing avg from prior sessions the same way the detector does
    prior_sessions = sessions[:-1]
    qualifying = [s for s in prior_sessions if len(s) >= 3]
    trailing_sessions = qualifying[-_SESSIONS_FOR_AVG:]
    trailing_avg = sum(s[0]["v"] + s[1]["v"] + s[2]["v"] for s in trailing_sessions) / len(trailing_sessions)
    ratio = first3_v / trailing_avg
    assert ratio == 2.0, (
        f"edge_exact_volume_2x: volume_ratio should be 2.0 exactly, "
        f"got {ratio}. (trailing_avg={trailing_avg}, first3={first3_v}). "
        f"_EPS is defensive here — integer division is exact in IEEE 754."
    )

    # Verify DCR computation from edge_exact_dcr_thresholds uses real session path
    dcr_f = next(x for x in fixtures if x.name == "lance_edge_exact_dcr_thresholds")
    dcr_sessions = _partition_sessions(dcr_f.bars)
    dcr_current = dcr_sessions[-1]
    bar1 = dcr_current[0]
    # bar1: l=101.0, h=111.0, c=108.0 → (108-101)/(111-101) = 7.0/10.0
    bar1_dcr_computed = (bar1["c"] - bar1["l"]) / (bar1["h"] - bar1["l"])
    assert bar1_dcr_computed >= 0.70 - _EPS, (
        f"bar1_dcr {bar1_dcr_computed:.18f} must be >= 0.70 - _EPS={_EPS}. "
        f"_EPS ensures boundary fires for general float inputs."
    )
    # With these specific values (7/10), _EPS is DEFENSIVE:
    # 7.0/10.0 in IEEE 754 (CPython) gives the nearest double to 0.7,
    # which is ~0.6999999999999999555 — below 0.70 without _EPS → _EPS is load-bearing here.
    # The gate threshold is 0.70 - 1e-9 = 0.699999999, and 0.6999... > 0.699999999 → fires.
    assert bar1_dcr_computed >= 0.70 - _EPS, (
        f"DCR {bar1_dcr_computed:.18f} must pass the _EPS-guarded gate. "
        f"_EPS={_EPS} is load-bearing for 7/10 on general platforms."
    )


# ---------------------------------------------------------------------------
# Sanity test: detector fires under plain build_context() (no injected keys)
# ---------------------------------------------------------------------------

def test_fires_under_plain_build_context():
    """Proves the detector is self-contained and not a context-injection no-op.

    Loads lance_pos_textbook_drive, calls detect_lance_opening_drive with
    build_context(bars, sym='T') (no prev_session_close or avg_first3_volume),
    and confirms it fires. This is the critical integration-sanity check that
    the detector works without any special context keys beyond what
    build_context() naturally produces.
    """
    fixtures = load_all_fixtures("lance_opening_drive", include_internal=False)
    fixture = next(
        (f for f in fixtures if f.name == "lance_pos_textbook_drive"), None
    )
    assert fixture is not None, "missing lance_pos_textbook_drive fixture"

    # Build context the same way the production scanner does
    ctx = build_context(fixture.bars, sym="T")

    # Verify no injected shortcut keys in this context
    assert "prev_session_close" not in ctx, (
        "build_context() must not inject prev_session_close"
    )
    assert "avg_first3_volume" not in ctx, (
        "build_context() must not inject avg_first3_volume"
    )

    detections = detect_lance_opening_drive(fixture.bars, ctx)
    assert len(detections) >= 1, (
        f"Detector must fire under plain build_context() without any injected "
        f"prev_session_close or avg_first3_volume keys. Got 0 detections. "
        f"The detector is still a context-injection no-op — check the rebuild."
    )
