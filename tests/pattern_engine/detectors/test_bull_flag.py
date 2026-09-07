"""Battery test for the bull_flag detector. Runs every fixture in
tests/fixtures/bull_flag/ and asserts the expected outcome."""
import pytest

from api.services.pattern_engine.detectors.classical import bull_flag as bf
from api.services.pattern_engine.detectors.classical.bull_flag import detect_bull_flag
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("bull_flag", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_bull_flag_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_bull_flag(fixture.bars, ctx)

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
        if detections:
            for d in detections:
                assert d["confidence"] < 50.0, (
                    f"Fixture {fixture.name!r} expected NOT to fire, but got "
                    f"confidence {d['confidence']:.1f}"
                )


def test_fixture_battery_has_minimum_coverage():
    """Phase 0 Gate 1 requires >=5 positive, >=8 negative, >=2 edge fixtures."""
    fixtures = load_all_fixtures("bull_flag", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 2, f"need >=2 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Each narrative body field must contain Phase 2-depth paragraph content."""
    fixtures = load_all_fixtures("bull_flag", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"

    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_bull_flag(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name} did not fire"
    d = max(detections, key=lambda x: x["confidence"])

    narrative = d["narrative"]
    # headline shorter (one sentence) — at least 90 chars
    assert "headline" in narrative
    assert len(narrative["headline"]) >= 90, (
        f"narrative.headline too short ({len(narrative['headline'])} chars): "
        f"{narrative['headline']!r}"
    )
    # body fields must each be >=700 chars (Phase 2 depth standard)
    for field in ("what_it_is", "why_it_matters", "what_to_watch_for", "failure_signal"):
        assert field in narrative, f"missing narrative.{field}"
        text = narrative[field]
        assert len(text) >= 700, (
            f"narrative.{field} too short ({len(text)} chars): {text[:120]!r}..."
        )


# ---------------------------------------------------------------------------
# Stale-pole-top regression tests
# ---------------------------------------------------------------------------
#
# Independent blind-corpus evidence (lab/bullflag_recognition_quality on
# branch bullflag-recognition-quality-lab, Corpus B) found 7 of 9 real-world
# false positives shared one root cause, hard-verified against real OHLCV for
# two tickers: the candidate pole top can be several bars stale (only
# CONFIRMED swing-high pivots qualify as candidates), and the retrace/depth
# math never checked whether the flag's high had since exceeded the pole
# top's price. BHP's selected pole top (2026-02-11, $75.14) sat 9.6% below a
# real subsequent high ($82.34, 2026-02-25) that occurred before the pullback
# the old code scored as a valid 33% retrace; CMBT showed the identical shape
# at +13.5%. Fixed by rejecting a candidate whose flag_high exceeds the pole
# top price by more than a small (2%) noise tolerance.
#
# All constructions here call `_try_extract_pattern` directly (bypassing
# `_candidate_pole_tops`/`detect_pivots` pivot-confirmation timing, which is
# a separate, unproven concern) with an empty pivots list, which forces the
# function's own documented fallback path ("scan bar lows directly in the
# window") for the pole base -- this gives exact, deterministic control over
# every input the new gate depends on.

_T0 = 1700000000
_DT = 86400


def _mk_bar(t, o, h, l, c, v=100_000.0):
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}


def _base_and_pole(t=_T0):
    """10 flat base bars at ~50, then a clean 50->60 pole over 5 bars
    (bar index 14 is the pole top, price ~60.2, pole_pct ~21%)."""
    bars = []
    for _ in range(10):
        bars.append(_mk_bar(t, 49.9, 50.2, 49.7, 50.0)); t += _DT
    for i in range(5):
        px = 50 + (60 - 50) * (i + 1) / 5
        bars.append(_mk_bar(t, px - 0.3, px + 0.2, px - 0.5, px)); t += _DT
    return bars, t


_POLE_TOP_IDX = 14
_POLE_TOP_PRICE = 50.2 + (60 - 50)  # matches bar 14's high, ~60.2


def _pole_top_at(bars):
    return {"price": bars[_POLE_TOP_IDX]["h"], "t": bars[_POLE_TOP_IDX]["t"],
            "bar_index": _POLE_TOP_IDX, "type": "high", "strength": 90}


def _build_overshoot_case(overshoot_pct, n_cont=5, n_pull=10, pullback_frac=0.30):
    """Pole (bars 0-14) + a continuation phase whose final bar's HIGH sits
    exactly `overshoot_pct` above the pole top (bars 15..15+n_cont-1) + a
    pullback phase retracing `pullback_frac` of the pole's height measured
    from the pole top (not the continuation's new high)."""
    bars, t = _base_and_pole()
    pole_top_price = bars[_POLE_TOP_IDX]["h"]
    target_h = pole_top_price * (1 + overshoot_pct)
    for i in range(n_cont):
        h = pole_top_price + (target_h - pole_top_price) * (i + 1) / n_cont
        c, o, l = h - 0.15, h - 0.25, h - 0.45
        bars.append(_mk_bar(t, o, h, l, c)); t += _DT
    pole_height = pole_top_price - bars[0]["l"]  # base sits at ~49.7
    target_low = pole_top_price - pullback_frac * pole_height
    for i in range(n_pull):
        px = target_h - (target_h - target_low) * (i + 1) / n_pull
        bars.append(_mk_bar(t, px + 0.2, px + 0.35, px - 0.2, px)); t += _DT
    return bars


def test_a_stale_pole_with_continued_advance_does_not_fire():
    """A. Price establishes a candidate pole top, continues materially
    higher (well past any noise tolerance), THEN pulls back into an
    otherwise-valid retrace/duration/channel band. The stale pole must not
    produce a valid Bull Flag candidate."""
    bars = _build_overshoot_case(overshoot_pct=0.15)  # +15%, unambiguous
    pole_top = _pole_top_at(bars)
    result = bf._try_extract_pattern(bars, [], _POLE_TOP_IDX, pole_top)
    assert result is None, (
        "REGRESSION: a candidate whose flag materially exceeds the pole top "
        "(price kept running after the 'pole') must be rejected, not scored "
        "as a valid retrace."
    )


def test_b_bhp_like_overshoot_does_not_fire():
    """B. Distilled reproduction of the real BHP failure mode: the flag's
    high sits ~9.6% above the selected pole top before the pullback begins
    (real data: pole top $75.14 on 2026-02-11, real subsequent high $82.34
    on 2026-02-25)."""
    bars = _build_overshoot_case(overshoot_pct=0.096)
    pole_top = _pole_top_at(bars)
    result = bf._try_extract_pattern(bars, [], _POLE_TOP_IDX, pole_top)
    assert result is None, "REGRESSION: BHP-shaped stale-pole overshoot (+9.6%) must not extract."


def test_c_cmbt_like_overshoot_does_not_fire():
    """C. Distilled reproduction of the real CMBT failure mode: +13.5%
    overshoot (real data: pole top $13.16 on 2026-01-30, real subsequent
    high $14.93)."""
    bars = _build_overshoot_case(overshoot_pct=0.135)
    pole_top = _pole_top_at(bars)
    result = bf._try_extract_pattern(bars, [], _POLE_TOP_IDX, pole_top)
    assert result is None, "REGRESSION: CMBT-shaped stale-pole overshoot (+13.5%) must not extract."


def test_d_legitimate_flag_with_no_overshoot_still_fires():
    """D. A valid impulse reaches its real pole high, then a controlled
    pullback follows WITHOUT ever exceeding the pole top -- the existing
    Bull Flag detection must continue to work. (The wider fixture battery
    already exercises this end-to-end via detect_bull_flag; this checks the
    same invariant directly at the _try_extract_pattern level, isolating it
    from pivot-selection.)"""
    bars, t = _base_and_pole()
    pole_top_price = bars[_POLE_TOP_IDX]["h"]
    pole_height = pole_top_price - bars[0]["l"]
    target_low = pole_top_price - 0.30 * pole_height  # ideal 30% retrace
    for i in range(10):
        px = pole_top_price - (pole_top_price - target_low) * (i + 1) / 10
        bars.append(_mk_bar(t, px + 0.2, px + 0.35, px - 0.2, px)); t += _DT
    pole_top = _pole_top_at(bars)
    result = bf._try_extract_pattern(bars, [], _POLE_TOP_IDX, pole_top)
    assert result is not None, (
        "A clean pullback that never exceeds the pole top must still extract "
        "as a valid candidate -- the stale-pole fix must not reject legitimate flags."
    )
    assert 0.15 <= result["retrace_pct"] <= 0.50


def test_e_boundary_overshoot_tolerance():
    """E. The fix allows a small (<=2%) overshoot as ordinary noise (a flag
    oscillating right at the pole's high is a normal, valid shape) but
    rejects anything materially beyond it -- verify both sides of that
    boundary explicitly so the fix doesn't reject legitimate flags because
    of tiny wick noise near the transition."""
    bars_within = _build_overshoot_case(overshoot_pct=0.015)  # 1.5% < 2% tolerance
    pole_top_within = _pole_top_at(bars_within)
    result_within = bf._try_extract_pattern(bars_within, [], _POLE_TOP_IDX, pole_top_within)
    assert result_within is not None, (
        "A 1.5% overshoot (within the noise tolerance) must still extract."
    )

    bars_outside = _build_overshoot_case(overshoot_pct=0.025)  # 2.5% > 2% tolerance
    pole_top_outside = _pole_top_at(bars_outside)
    result_outside = bf._try_extract_pattern(bars_outside, [], _POLE_TOP_IDX, pole_top_outside)
    assert result_outside is None, (
        "A 2.5% overshoot (beyond the noise tolerance) must be rejected."
    )


def test_stale_pole_fix_does_not_touch_unrelated_semantics():
    """Sanity guard: the new constant exists and the pre-existing thresholds
    it sits beside are untouched (pins the values so a future edit to this
    fix can't silently widen scope into a threshold-tuning change)."""
    assert bf._MAX_FLAG_HIGH_OVERSHOOT_PCT == 0.02
    assert bf._MIN_POLE_PCT == 0.08
    assert bf._MAX_POLE_BARS == 20
    assert bf._MIN_FLAG_BARS == 3
    assert bf._MAX_FLAG_BARS == 20
    assert bf._MIN_FLAG_RETRACE == 0.15
    assert bf._MAX_FLAG_RETRACE == 0.50
    assert bf._MIN_PARALLEL_SCORE == 0.55
    assert bf._CONFIDENCE_FLOOR == 50.0
