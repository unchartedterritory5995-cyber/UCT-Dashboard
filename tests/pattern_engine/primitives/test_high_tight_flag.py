"""High Tight Flag: rare by construction, and the anecdotes stay anecdotes."""
from api.services.screener import base_catalog as bc
from api.services.screener import bases


def _bar(i, c, v=1_000_000):
    return {"t": 20240000 + i, "o": c, "c": c, "v": v,
            "h": c * 1.01, "l": c * 0.99}


def _htf(pole_gain=1.10, pole_bars=30, flag_depth=0.18, flag_bars=20,
         flag_vol=300_000, lead=40, start=10.0):
    """A quiet lead, a near-doubling, then a shallow flag on light volume."""
    bars = [_bar(i, start * (1 + 0.001 * i)) for i in range(lead)]
    low = bars[-1]["c"]
    top = low * (1 + pole_gain)
    for i in range(pole_bars):
        bars.append(_bar(len(bars), low + (top - low) * (i + 1) / pole_bars,
                         v=2_000_000))
    bottom = top * (1 - flag_depth)
    for i in range(flag_bars):
        # down into the flag low, then a shallow drift sideways
        frac = (i + 1) / flag_bars
        c = top - (top - bottom) * min(1.0, frac * 1.6)
        bars.append(_bar(len(bars), max(bottom, c), v=flag_vol))
    return bars


def _ctx(bars):
    return bases._context(bars, bars)


def _state(bars):
    return bc.high_tight_flag_state(_ctx(bars))


def _det(bars):
    return bc.by_key("high-tight-flag").detect(_ctx(bars))


# ── the published bands ────────────────────────────────────────────────────

def test_a_textbook_flag_is_ACCEPTED():
    st = _state(_htf())
    assert st is not None
    assert bc.HTF_POLE_MIN_GAIN <= st["pole_gain"] <= bc.HTF_POLE_MAX_GAIN
    assert bc.HTF_FLAG_MIN_DEPTH <= st["flag_depth"] <= bc.HTF_FLAG_MAX_DEPTH
    assert bc.HTF_POLE_MIN_BARS <= st["pole_bars"] <= bc.HTF_POLE_MAX_BARS


def test_a_pole_that_does_not_nearly_double_is_refused():
    assert _state(_htf(pole_gain=0.55)) is None


def test_a_pole_that_more_than_doubles_past_the_band_is_refused():
    assert _state(_htf(pole_gain=1.80)) is None


def test_a_flag_deeper_than_the_band_is_refused():
    assert _state(_htf(flag_depth=0.40)) is None


def test_a_flag_that_is_too_shallow_is_refused():
    assert _state(_htf(flag_depth=0.04)) is None


def test_a_flag_whose_volume_does_not_dry_up_is_refused():
    """"Volume generally dries up." A direction, and the only volume rule the
    house states for the flag itself.
    """
    assert _state(_htf(flag_vol=4_000_000)) is None


# ── the mis-detection the corpus warns about ───────────────────────────────

def test_the_pole_is_anchored_to_a_SWING_LOW_not_a_window_edge():
    """⛔⛔ THE NAMED FAILURE MODE, PINNED.

    The corpus says the natural way to get this wrong is a loose flagpole
    anchor: any 40-day slice of a long advance shows a large rise, so a
    window-edge anchor fires constantly on a pattern IBD calls RARE. A steady
    multi-year climb that doubles many times over must produce nothing.
    """
    steady = [_bar(i, 10.0 * (1.008 ** i)) for i in range(400)]
    total = steady[-1]["c"] / steady[0]["c"]
    assert total > 20, "fixture: this series doubles repeatedly"
    assert _state(steady) is None


def test_a_THIN_coverage_verdict_is_the_expected_answer_here():
    """⭐ THIN IS CORRECT FOR THIS ONE, AND THAT NEEDS SAYING OUT LOUD.

    The coverage bands treat anything under 0.5% as thin and worth justifying.
    IBD calls this pattern rare and the corpus warns that a screener emitting
    high tight flags at any meaningful rate is almost certainly mis-detecting.
    So a thin number is evidence the detector is RIGHT, and the failure to
    watch for is the opposite one -- a comfortable-looking hit rate.
    Measured on 3,705 symbols: 3 hits (0.08%), every one inside the published
    bands (+112%/23%, +104%/17%, +105%/21%).
    """
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__),
                                    "..", "..", "..", "tools"))
    import base_coverage

    htf = bc.by_key("high-tight-flag")
    assert htf.coverage_pct is not None, "the measured rate must be recorded"
    assert htf.coverage_pct < base_coverage.THIN_PCT
    assert base_coverage.classify(htf.coverage_pct) == "thin"


# ── provenance ─────────────────────────────────────────────────────────────

def test_the_published_upside_figures_are_recorded_as_REFUSALS():
    """200%, 450%, 1,300% -- every one a named winner, and the house says
    'many fail'. Treating them as expectancy would be survivorship bias with
    a citation attached.
    """
    htf = bc.by_key("high-tight-flag")
    anec = [c for c in htf.criteria if "ANECDOTES" in c.condition]
    assert anec and anec[0].value is None and anec[0].missing
    assert "survivorship" in anec[0].missing


def test_the_failure_rate_behind_many_fail_is_a_refusal():
    htf = bc.by_key("high-tight-flag")
    f = [c for c in htf.criteria if "Failure rate" in c.condition]
    assert f and f[0].value is None and f[0].missing


def test_the_pivot_follows_IBD_and_records_the_third_party_dime():
    """IBD editorial says the flagpole peak, full stop. The +$0.10 appears only
    in a third-party summary, so it is recorded at low confidence, not applied.
    """
    htf = bc.by_key("high-tight-flag")
    st = _state(_htf())
    assert st is not None
    assert st["pivot"] == st["pole_high"], "the pivot must be the bare peak"
    conflict = [c for c in htf.criteria if "CONFLICT on the pivot" in c.condition]
    assert conflict and conflict[0].confidence == "low"


def test_no_tightness_number_was_invented_for_the_flag():
    htf = bc.by_key("high-tight-flag")
    t = [c for c in htf.criteria if c.condition.startswith("Tightness")]
    assert t and t[0].value is None and t[0].missing
    assert not [c for c in htf.criteria if c.origin == "uct"], (
        "this structure needs no number of ours -- the published bands already "
        "constrain it hard")
