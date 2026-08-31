"""The VCP: a property, not a shape, and a tolerance nobody published."""
from api.services.screener import base_catalog as bc
from api.services.screener import bases


import random

#: ⚠️ THE FIXTURE NEEDS REALISTIC NOISE. A perfectly smooth leg has near-zero
#: volatility, and the segmenter is volatility-SCALED -- so on a frictionless
#: series it confirmed a swing on every bar's intrabar range and produced
#: high/low pairs at the same bar index. That is the fixture being unrealistic,
#: not the segmenter misbehaving, and a test built on it would have been
#: measuring an artefact.
_RNG = random.Random(11)


def _bar(i, c, v=1_000_000):
    c = c * (1.0 + _RNG.gauss(0, 0.006))
    return {"t": 20240000 + i, "o": c, "c": c, "v": v,
            "h": c * 1.008, "l": c * 0.992}


def _leg(bars, n, to, v):
    start = bars[-1]["c"] if bars else 100.0
    step = (to - start) / max(1, n)
    for i in range(n):
        bars.append(_bar(len(bars), start + step * (i + 1), v=v))
    return bars


def _vcp(depths=(0.25, 0.15, 0.08), prior_gain=0.60, vols=None, top=100.0,
         tail=3, seed=11):
    """A prior advance, then successive pullbacks of the given depths.

    Each contraction is a fall from the running top to `top * (1 - d)` and a
    recovery back toward the top, on the volume given for that leg.
    """
    _RNG.seed(seed)
    if vols is None:
        vols = [2_000_000 - 400_000 * i for i in range(len(depths))]
    base = top / (1.0 + prior_gain)
    bars = [_bar(0, base, v=1_000_000)]
    _leg(bars, 45, top, v=1_500_000)          # the advance being continued
    for d, v in zip(depths, vols):
        _leg(bars, 10, top * (1 - d), v=v)    # the pullback
        _leg(bars, 8, top * 0.99, v=v)        # recovery toward the top
    _leg(bars, tail, top * 0.985, v=vols[-1])
    return bars


def _ctx(bars):
    return bases._context(bars, bars)


def _state(bars, **kw):
    return bc.vcp_state(_ctx(bars), **kw)


def _det(bars):
    return bc.by_key("vcp").detect(_ctx(bars))


# ── the defining property ──────────────────────────────────────────────────

def test_minervinis_own_worked_sequence_is_ACCEPTED():
    """25% -> 15% -> 8%, the example the book itself gives."""
    st = _state(_vcp(depths=(0.25, 0.15, 0.08)))
    assert st is not None
    assert st["contractions"] >= bc.VCP_MIN_CONTRACTIONS
    ratios = [b / a for a, b in zip(st["depths"], st["depths"][1:])]
    assert all(bc.VCP_RATIO_MIN <= r <= bc.VCP_RATIO_MAX for r in ratios), ratios


def test_the_contraction_count_is_a_LOWER_BOUND_and_says_so():
    """⚠️⚠️ MEASURED LIMITATION, PINNED SO IT CANNOT BE FORGOTTEN.

    Contractions are read off CONFIRMED swings, and the segmenter confirms a
    reversal only past k*sigma. So a pullback tighter than that never
    registers -- and the tight end of the sequence is exactly where the pattern
    lives. Minervini's own 25/15/8 example yields TWO confirmed contractions on
    a series with ordinary daily noise, not three.

    The honest response is to report the count as conservative, NOT to lower k
    until the third leg appears: that would trade a non-repainting
    segmentation for a repainting one, which is the defect the whole library
    is built to avoid.
    """
    st = _state(_vcp(depths=(0.25, 0.15, 0.08)))
    assert st is not None
    assert st["contractions"] == 2, (
        "the 8%% leg is expected to fall below the confirmation threshold; "
        "got %d contractions" % st["contractions"])

    v = bc.by_key("vcp")
    lim = [c for c in v.criteria if c.value == "count-is-a-lower-bound"]
    assert lim, "the limitation must be recorded on the structure"
    assert lim[0].origin == "uct" and lim[0].source_id is None


def test_an_EXPANDING_sequence_is_refused():
    """Volatility widening left-to-right is the opposite of the pattern."""
    assert _state(_vcp(depths=(0.08, 0.15, 0.25))) is None


def test_contractions_that_barely_tighten_are_refused():
    """Each must be MEANINGFULLY tighter, or the label says nothing."""
    assert _state(_vcp(depths=(0.25, 0.24, 0.23))) is None


def test_a_trivial_blip_does_not_complete_a_sequence():
    """⭐ Why the ratio band has a LOWER bound, which is ours.

    Without one, a 1% wobble after a 25% pullback counts as a contraction, and
    noise produces those constantly -- the count would measure how jittery a
    series is rather than whether supply is drying up.
    """
    assert _state(_vcp(depths=(0.25, 0.01))) is None


# ── the sourced gates ──────────────────────────────────────────────────────

def test_volume_must_fall_across_the_contractions():
    """"on successively lower volume as the supply diminishes" -- a direction,
    and the book publishes no ratio, so the test is first versus last.
    """
    rising = _vcp(depths=(0.25, 0.15, 0.08),
                  vols=[1_000_000, 2_000_000, 3_000_000])
    assert _state(rising) is None


def test_a_VCP_with_no_advance_to_continue_is_refused():
    """He is explicit that it is a CONTINUATION pattern, occurring after the
    stock has "already moved up 30, 40, 50 percent or even much more".
    """
    assert _state(_vcp(prior_gain=0.05)) is None


def test_a_base_corrected_sixty_percent_is_off_the_radar():
    deep = _vcp(depths=(0.62, 0.35, 0.18))
    assert _state(deep) is None


# ── what must NOT become a gate ────────────────────────────────────────────

def test_the_TYPICAL_contraction_count_is_not_enforced_as_a_limit():
    """"Typically ... two to four ... although sometimes there can be as many
    as five or six." Gating on the typical case would refuse bases the same
    sentence explicitly allows.
    """
    assert bc.VCP_MAX_CONTRACTIONS == 6
    five = _vcp(depths=(0.34, 0.24, 0.16, 0.10, 0.06))
    assert _state(five) is not None


def test_the_worked_example_is_recorded_as_ILLUSTRATIVE_not_a_threshold():
    v = bc.by_key("vcp")
    ex = [c for c in v.criteria if "EXAMPLE" in c.condition]
    assert ex and "For example" in (ex[0].quote or "")


# ── provenance ─────────────────────────────────────────────────────────────

def test_the_unpublished_tolerance_is_a_REFUSAL_and_our_band_is_ours():
    """The book says "about half (plus or minus a reasonable amount)" and never
    quantifies it. The refusal and our band must both be present, separately.
    """
    v = bc.by_key("vcp")
    refused = [c for c in v.criteria if "reasonable amount" in c.condition]
    assert refused and refused[0].value is None and refused[0].missing
    ours = [c for c in v.criteria if c.origin == "uct"
            and c.value == (bc.VCP_RATIO_MIN, bc.VCP_RATIO_MAX)]
    assert ours and ours[0].source_id is None


def test_the_missing_minimum_duration_is_not_borrowed_from_another_pattern():
    """The book publishes a 3-week floor for the 3-C pattern. Importing it here
    would be carrying a number across rules.
    """
    v = bc.by_key("vcp")
    dur = [c for c in v.criteria if "Minimum base duration" in c.condition]
    assert dur and dur[0].value is None and dur[0].missing
    assert "3-C" in dur[0].missing


def test_the_named_outcomes_are_recorded_as_refusals():
    """465%, 118%, 525%, 75% -- selected illustrations of winning trades."""
    v = bc.by_key("vcp")
    perf = [c for c in v.criteria if "NOT performance" in c.condition]
    assert perf and perf[0].value is None and perf[0].missing
    assert "survivorship" in perf[0].missing
    assert "in about half" in perf[0].missing, (
        "the relative 20-day claim must be recorded as unconvertible too")


def test_the_market_relative_depth_rule_is_recorded_as_a_known_gap():
    """It is computable in principle but needs the index decline, which a
    per-symbol detector is not given. Recorded so it is visible, not forgotten.
    """
    v = bc.by_key("vcp")
    rel = [c for c in v.criteria if "general market" in c.condition]
    assert rel and rel[0].value is None and rel[0].missing


def test_a_base_price_has_already_BROKEN_OUT_of_is_no_longer_a_VCP():
    """The structural half of the recency test: through the pivot, the
    consolidation has resolved and the label would describe the past.
    """
    bars = _vcp()
    top = max(b["h"] for b in bars)
    for i in range(4):                       # push decisively through the top
        bars.append(_bar(len(bars), top * 1.08, v=3_000_000))
    assert _state(bars) is None


def test_a_base_price_has_broken_DOWN_from_is_no_longer_a_VCP():
    bars = _vcp()
    floor = min(b["l"] for b in bars[50:])
    for i in range(4):
        bars.append(_bar(len(bars), floor * 0.85, v=3_000_000))
    assert _state(bars) is None


def test_a_FIVE_contraction_base_survives_the_confirmation_lag():
    """⛔ THE INTERACTION THAT A TIGHT AGE GATE GOT WRONG.

    The tighter a VCP's final contractions, the less likely they clear the
    confirmation threshold -- so the last CONFIRMED contraction sits further
    back the more complete the pattern is. A 30-bar age gate refused this
    five-contraction base at 47 bars: it rejected the pattern for being too
    well formed. The age bound is now loose and the real question is asked
    structurally instead.
    """
    five = _vcp(depths=(0.34, 0.24, 0.16, 0.10, 0.06))
    st = _state(five)
    assert st is not None
    assert st["contractions"] >= bc.VCP_MIN_CONTRACTIONS
