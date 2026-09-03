"""System-D VCP Trend Template precondition (Phase 3C, 2026-09-03).

⛔⛔ THE CONFIRMED DEFECT. `vcp_state` (`api/services/screener/base_catalog.py`)
enforced a point-to-point prior-advance check (VCP_PRIOR_ADVANCE over
VCP_ADVANCE_LOOKBACK bars) and NOTHING about price's position relative to its
own long-term moving averages. VCP is explicitly a CONTINUATION pattern -- this
Structure's own criteria already cite Minervini saying so -- and a sharp
point-to-point rally can occur inside an overall downtrend, satisfying "prior
advance" on a stock that is structurally still below its 150/200-day SMAs
(`[TTLAC]`'s own worked counter-example, GoPro: "the 150-day line was below the
200-day, and both were trending down").

Evidence, on the frozen 82-case VCP gold-standard set
(docs/uct-scanner-intelligence/vcp_gold_standard/): 11 of System D's 14
reviewer-confirmed unique false positives (78.6%) have
`trend_template_150_200=False` in the blinded neutral_context; its only 2
reviewer-confirmed true positives both already have `trend_template_150_200=
True`. System A already enforces the identical precondition
(`api/services/pattern_engine/detectors/uct/vcp.py::_passes_trend_template_
precondition`, Phase 3A) -- this brings System D's OWN stated continuation-
pattern requirement in line with its own cited source, independent of System A.

⛔ WHY THE FIXTURES ARE HAND-BUILT, NOT DRAWN FROM `C:/data/bars.db`. The
gold-standard evidence itself lives in `docs/uct-scanner-intelligence/
vcp_gold_standard/` precisely because it needs the owner's live bars database
and cannot run in CI (see that directory's own scripts). This file follows the
same synthetic-series convention as `test_go_signal.py` / `test_three_weeks_
tight.py` / `test_no_detector_raises.py`: every move is large and unambiguous
so the zigzag segmenter confirms every swing deterministically, with no
database dependency.
"""
import sys, pathlib, datetime, random
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from api.services.screener import base_catalog as bc
from api.services.screener.bases import BaseCtx

_DAY0 = datetime.date(2020, 1, 1)


def _t(i: int) -> int:
    return int((_DAY0 + datetime.timedelta(days=i)).strftime("%Y%m%d"))


def _bar(o, h, l, c, v, i):
    return {"t": _t(i), "o": o, "h": h, "l": l, "c": c, "v": v}


def _flat_slope(n, p0, p1, i0, vol=1_000_000, noise=0.0015, seed=42):
    """`n` bars drifting linearly from `p0` to `p1` with a small realistic
    wiggle -- long enough (>=200 bars, combined with the tail below) to make
    the 150/200-day SMAs a function of a real trend, not a handful of points.
    """
    rng = random.Random(seed)
    out = []
    for k in range(n):
        frac = k / max(1, n - 1)
        base = p0 + (p1 - p0) * frac
        o = base * (1 + rng.uniform(-noise, noise))
        c = base * (1 + rng.uniform(-noise, noise))
        h = max(o, c) * (1 + abs(rng.uniform(0, noise)))
        l = min(o, c) * (1 - abs(rng.uniform(0, noise)))
        out.append(_bar(o, h, l, c, vol, i0 + k))
    return out


def _contraction_tail(i0, base_price):
    """A clean 2-contraction VCP tail, independent of the precondition under
    test: +40% prior advance -> -25% pullback (declining volume) -> partial
    bounce -> -12% pullback (lighter volume, ratio ~0.48, inside VCP_RATIO_MIN/
    MAX) -> a few quiet bars still inside the base. Every leg is large enough
    that the zigzag segmenter confirms it unambiguously.
    """
    bars, i, p = [], i0, base_price

    for k in range(50):
        c = p * (1 + 0.40 * (k + 1) / 50)
        bars.append(_bar(c * 0.995, c * 1.01, c * 0.985, c, 2_000_000, i)); i += 1
    top1 = p * 1.40

    for k in range(10):
        c = top1 * (1 - 0.25 * (k + 1) / 10)
        vol = int(1_600_000 * (1 - 0.5 * (k + 1) / 10))
        bars.append(_bar(c * 1.01, c * 1.015, c * 0.99, c, vol, i)); i += 1
    low1 = top1 * 0.75

    for k in range(8):
        c = low1 * (1 + 0.18 * (k + 1) / 8)
        bars.append(_bar(c * 0.99, c * 1.01, c * 0.985, c, 1_200_000, i)); i += 1
    top2 = low1 * 1.18

    for k in range(8):
        c = top2 * (1 - 0.12 * (k + 1) / 8)
        vol = int(700_000 * (1 - 0.3 * (k + 1) / 8))
        bars.append(_bar(c * 1.005, c * 1.01, c * 0.995, c, vol, i)); i += 1
    low2 = top2 * 0.88

    for k in range(5):
        c = low2 * (1 + 0.02 * k)
        bars.append(_bar(c * 0.998, c * 1.005, c * 0.995, c, 500_000, i)); i += 1

    return bars


def _above_trend_template_series():
    """A VCP-shaped tail sitting on top of a long, smooth UPTREND -- price
    ends above both its 150- and 200-day SMA, with the 150 above the 200."""
    return _flat_slope(230, 40.0, 90.0, 0) + _contraction_tail(230, 90.0)


def _below_trend_template_series():
    """The IDENTICAL contraction tail (same percentages, same volume shape,
    same base price of 90 -> same VCP geometry), but preceded by a long
    DECLINING trend instead of a rising one -- last close ends up below both
    SMAs, with the 150-day below the 200-day (the GoPro shape). Nothing about
    the tail itself changed; only the precondition should differ."""
    return _flat_slope(230, 300.0, 90.0, 0) + _contraction_tail(230, 90.0)


def _ctx(bars):
    return BaseCtx(bars=bars, bars_full=bars)


# ─── the controls, first ────────────────────────────────────────────────────

def test_the_above_trend_template_fixture_actually_fires():
    """⛔ NON-VACUITY. If the baseline fixture never fired, every refusal test
    below would pass while proving nothing."""
    st = bc.vcp_state(_ctx(_above_trend_template_series()))
    assert st is not None
    assert st["contractions"] == 2


def test_the_two_fixtures_share_the_same_contraction_geometry():
    """The only thing that differs between the two series is the PRE-HISTORY
    (uptrend vs downtrend feeding the SMAs) -- the contraction tail itself
    (depths, ratio, prior_advance, still-in-base) is byte-identical in shape.
    Pinning this is what makes the refusal below about the precondition and
    nothing else."""
    above = bc.vcp_state(_ctx(_above_trend_template_series()))
    below_bars = _below_trend_template_series()
    # bypass the new precondition to read the SAME geometry the old code saw
    orig = bc._passes_vcp_trend_template_precondition
    bc._passes_vcp_trend_template_precondition = lambda bars: True
    try:
        below_bypassed = bc.vcp_state(_ctx(below_bars))
    finally:
        bc._passes_vcp_trend_template_precondition = orig
    assert above is not None and below_bypassed is not None
    assert above["contractions"] == below_bypassed["contractions"]
    assert above["depths"] == pytest.approx(below_bypassed["depths"], rel=1e-9)


# ─── the defect, reproduced and fixed ───────────────────────────────────────

def test_a_vcp_shaped_sequence_below_a_declining_trend_is_now_refused():
    """⭐⭐ THE FIX. Before Phase 3C this fixture fired -- see the previous
    test's bypass proving the SAME geometry produces a detection once the
    precondition is disabled. With the precondition wired in, `vcp_state`
    correctly refuses it: this is a base forming on top of a declining
    long-term trend, which `[TTLAC]`'s own GoPro counter-example rules out."""
    bars = _below_trend_template_series()
    assert bc._passes_vcp_trend_template_precondition(bars) is False
    assert bc.vcp_state(_ctx(bars)) is None


def test_a_vcp_above_its_trend_template_still_fires():
    """The positive case that must remain valid: nothing about a VCP forming
    on top of a genuine uptrend should change."""
    bars = _above_trend_template_series()
    assert bc._passes_vcp_trend_template_precondition(bars) is True
    assert bc.vcp_state(_ctx(bars)) is not None


# ─── boundary cases on the precondition itself ──────────────────────────────

def test_insufficient_history_fails_open():
    """Fewer than 200 bars -> the 200-day SMA cannot be computed -> the
    precondition does not gate (same fail-open convention System A already
    uses for the identical check)."""
    bars = [_bar(100, 100, 100, 100, 100, i) for i in range(150)]
    assert bc._passes_vcp_trend_template_precondition(bars) is True


def test_exact_equality_does_not_pass_the_precondition():
    """A perfectly flat 200-bar series: close == sma150 == sma200. All three
    inequalities are strict, so this must fail -- not a rounding accident."""
    bars = [_bar(100, 100, 100, 100, 100, i) for i in range(200)]
    sma150 = bc._sma(bars, 150)
    sma200 = bc._sma(bars, 200)
    assert sma150 == sma200 == 100
    assert bc._passes_vcp_trend_template_precondition(bars) is False


def test_price_sitting_between_the_two_smas_fails_the_precondition():
    """sma150 > sma200 holds (an uptrend in the moving averages themselves),
    but the LAST close has pulled back below the 150-day -- the "both" in
    "price above BOTH the 150-day and 200-day" is load-bearing on its own,
    independent of the sma150>sma200 ordering."""
    bars = [_bar(50, 50, 50, 50, 50, i) for i in range(50)]
    for k in range(150):
        p = 50.0 + (150.0 - 50.0) * (k / 149)
        bars.append(_bar(p, p, p, p, 50, 50 + k))
    bars.append(_bar(95, 95, 95, 95, 50, 200))
    sma150 = bc._sma(bars, 150)
    sma200 = bc._sma(bars, 200)
    assert sma200 < 95 < sma150, (
        "fixture drifted: expected close to sit strictly between the two "
        "SMAs -- adjust the ramp before trusting this as the boundary case")
    assert bc._passes_vcp_trend_template_precondition(bars) is False


# ─── regression: unrelated System-D VCP gates are untouched ────────────────

def test_unrelated_vcp_gates_still_apply_when_the_trend_template_passes():
    """A trend-template-PASSING series with only ONE confirmed pullback (the
    contraction tail truncated before its second leg) must still be refused
    for the OLD reason (VCP_MIN_CONTRACTIONS=2) -- proving the new
    precondition is purely additive and did not touch the contraction-count/
    depth/ratio/volume/recency logic downstream."""
    pre = _flat_slope(230, 40.0, 90.0, 0)
    bars_full_tail, i, p = [], 230, 90.0
    for k in range(50):
        c = p * (1 + 0.40 * (k + 1) / 50)
        bars_full_tail.append(_bar(c * 0.995, c * 1.01, c * 0.985, c, 2_000_000, i)); i += 1
    top1 = p * 1.40
    for k in range(10):
        c = top1 * (1 - 0.25 * (k + 1) / 10)
        vol = int(1_600_000 * (1 - 0.5 * (k + 1) / 10))
        bars_full_tail.append(_bar(c * 1.01, c * 1.015, c * 0.99, c, vol, i)); i += 1
    low1 = top1 * 0.75
    for k in range(5):                    # settle only -- NO second contraction
        c = low1 * (1 + 0.02 * k)
        bars_full_tail.append(_bar(c * 0.998, c * 1.005, c * 0.995, c, 500_000, i)); i += 1
    bars = pre + bars_full_tail
    assert bc._passes_vcp_trend_template_precondition(bars) is True, (
        "fixture drifted: this case is meant to isolate the contraction-"
        "count gate, so the trend template must independently hold here")
    assert bc.vcp_state(_ctx(bars)) is None


def test_a_series_too_short_for_swings_is_still_refused_not_crashed():
    """Guards ahead of the new precondition (empty bars, <3 swings) must keep
    winning first -- the precondition must not be reached on a series that was
    always going to be refused for a more basic reason, and must never raise."""
    assert bc.vcp_state(_ctx([])) is None
    assert bc.vcp_state(_ctx(_above_trend_template_series()[:40])) is None


# ─── provenance ─────────────────────────────────────────────────────────────

def _trend_template_criteria():
    st = bc._BY_KEY["vcp"]
    return [c for c in st.criteria if "Trend Template" in c.condition]


def test_the_new_criteria_are_recorded_on_the_vcp_structure():
    crits = _trend_template_criteria()
    assert len(crits) == 2, (
        f"expected exactly 2 new Trend Template criteria on VCP, found "
        f"{len(crits)}")


def test_the_new_criteria_are_sourced_not_invented():
    for c in _trend_template_criteria():
        assert c.origin != "uct", (
            "this is Minervini's own published Trend Template, not our "
            "invention -- it must not read as `origin='uct'`")
        assert c.source_id == bc._MINERVINI
        assert c.quote, "a sourced criterion must carry its verbatim quote"
        assert c.confidence == "high"


def test_the_new_criteria_use_the_same_source_id_as_every_other_vcp_criterion():
    """This is NOT a new attribution -- it is the SAME `[TTLAC]` book already
    cited for all 15 pre-existing VCP criteria."""
    st = bc._BY_KEY["vcp"]
    other_sourced = [c.source_id for c in st.criteria
                     if c.source_id and "Trend Template" not in c.condition]
    assert other_sourced and all(sid == bc._MINERVINI for sid in other_sourced)


def test_provenance_endpoint_surfaces_the_new_criteria():
    """`base_catalog.provenance("vcp")` is the live surface a member's
    provenance panel reads -- confirm the new criteria round-trip through it,
    not just through the raw Structure object."""
    doc = bc.provenance("vcp")
    conditions = [c["condition"] for c in doc["criteria"]]
    assert sum("Trend Template" in c for c in conditions) == 2
    for c in doc["criteria"]:
        if "Trend Template" in c["condition"]:
            assert c["state"] == "sourced"
            assert c["quote"]
            assert c["source_id"] == bc._MINERVINI


def test_every_criterion_is_still_in_exactly_one_provenance_state():
    """Same invariant `test_go_signal.py` pins for its own structure -- run
    here too since this Structure gained two new criteria."""
    st = bc._BY_KEY["vcp"]
    for c in st.criteria:
        states = [c.origin == "uct",
                  c.value is None and bool(c.missing),
                  bool(c.source_id) and c.value is not None]
        assert sum(states) == 1, f"{c.condition!r} is in {sum(states)} states"
