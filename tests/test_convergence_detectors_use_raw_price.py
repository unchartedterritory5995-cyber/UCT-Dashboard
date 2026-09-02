"""The eight convergence detectors now fit in LOG SPACE, and five unit defects
had to be fixed first. This file is the record of what shipped and the rail on it.

⭐ WHY, FROM THE RESEARCH. Edwards & Magee
(`docs/superpowers/research/bases/06-edwards-magee-murphy-canon.md:540`):

    "falling wedges are MANUFACTURED BY ARITHMETIC PRICE SCALING. Because a
     constant *percentage* swing shrinks in *points* as price falls, any
     extended decline plotted arithmetically converges by construction. A
     detector that fits lines to raw prices will emit falling wedges on
     essentially every sustained downtrend, and they will be artefacts, not
     patterns."

The corpus calls it "the single highest-value, most-ignored implementation
instruction in either book". `fit_trendline` has always taken `log_space` and
said so in its own docstring; until 2026-09-01 all fourteen call sites omitted
it — `lesson_built_tested_green_and_unreachable`, on an argument.

⛔⛔ AND THE ONE-LINE FIX WAS A TRAP, WHICH IS WHY IT SAT UNPASSED. Adding the
keyword at fourteen call sites is what the docstring asks for, and it would have
shipped a WORSE defect than the one it fixed, because five consumers read the
returned line in units that only hold in price space. Every one of them fails
SILENTLY — no exception, no empty result, just a different number:

  1. `geometry.line_at` interpolates LINEARLY between `p1`/`p2`. A log-fitted
     line is exponential in price, so every interior price read off it is a
     CHORD — exact at exactly the two points a spot-check would test, wrong
     everywhere a width or depth is actually measured. Asked of the AST rather
     than of grep: seven detectors scored through it across 34 call sites, and
     `structure/major_trendlines.py` — which never asked for log space — is the
     one caller left, which is why `line_at` was not changed in place.
  2. `geometry.line_intersect` has the same shape, and it is where the apex of
     a symmetrical triangle and a pennant comes from: two chords cross at a
     different bar than the two curves do.
  3. `channel._HORIZONTAL_SLOPE_FRACTION * mid_price` compared a dimensionless
     fraction times DOLLARS against a slope. Against a log slope that is ~1/price
     times too permissive.
  4. `rectangle` computed `abs(slope) / price` to get a fractional rate. A log
     slope IS that rate; dividing again buries it ~100x.
  5. ⛔⛔ AND THE ONE NOBODY HAD NAMED, WHICH TURNED OUT TO BE THE BIG ONE.
     `_fit_arithmetic` counts a "touch" with `abs(p - expected) / expected`.
     Handed logarithms that is a percentage OF A LOGARITHM: the tolerance it
     admits becomes `tol% x log(price)`, so it is ~4.6x too loose at $100,
     ~6.9x at $1000, SCALES WITH PRICE, and refuses every touch below $1 where
     `log(price) <= 0` trips the `expected <= 0` guard. `touches` is gated on
     directly and `validity` is `min(r_squared, touches / 4)`, so an inflated
     count walks through two gates at once.

  Plus two member-facing sentences that printed `slope {x:.4f} per bar`
  (`ascending_triangle`, `descending_triangle`) and a third in `channel` — a
  number whose UNIT changes with the space and whose words did not.

⭐⭐ THE MEASUREMENT REVERSED THE PREVIOUS CONCLUSION, AND DEFECT 5 IS WHY.
This file previously recorded 273 -> 498 and argued at length that log space
ADDS detections. That was measured with all five defects live. With them fixed,
on the same 744 tickers, same bars, same paired pass:

    pattern                raw %   log %   raw hits   log hits
    falling_wedge           2.3%    1.5%         17         11
    rising_wedge            3.9%    2.8%         29         21
    symmetrical_triangle    4.4%    4.3%         33         32
    pennant                 4.4%    4.6%         34         35
    ascending_triangle     11.7%   12.4%         87         92
    descending_triangle     6.6%    6.7%         49         50
    channel                 1.2%    0.9%          9          7
    rectangle               2.0%    2.0%         15         15
    TOTAL                                       273        263

Log space REMOVES detections, and it removes them exactly where Edwards & Magee
said it would: falling_wedge -35%, rising_wedge -28%. The triangles and the
pennant barely move. The earlier 498 was 217 detections manufactured by defect 5
alone — ablated one fix at a time on the same universe:

    put back defect 5 (touch tolerance)     263 -> 480   (+217; channel +119)
    put back defect 1 (chord price_at)      263 -> 263   (net 0, but 6 detections
                                                          swap in and out)
    put back defect 2 (chord intersect)     263 -> 264   (+1, symmetrical)
    put back defect 3 (channel threshold)   263 -> 263   (0 hits, see below)
    put back defect 4 (rectangle divide)    263 -> 263   (0 hits, see below)

⛔ A ZERO IN THAT COLUMN IS NOT "THE FIX DID NOT MATTER". Defect 3 changes the
LABEL, not the count: on the widened population (defect 5 restored, so 126-142
channels rather than 7) the price-scaled threshold labels **142 of 142 channels
"neutral"**, while the scale-correct one splits them 65 bullish / 26 bearish /
35 neutral — and 16 of those 142 exist only because `if not is_horizontal`
skipped the validity gate. Even in the shipped 7-channel population it moves 3
of 7 labels. Defect 4 has no measured consequence on this sample; it is kept
because the unit analysis is unambiguous and a gate that is 100x wrong is a
defect whether or not today's universe exercises it.

⭐ THE RAW ARM IS THE CONTROL, AND IT DID NOT MOVE. 273 before the refactor and
273 after, per pattern, on the same bars. Every accessor introduced here
delegates to the original for a price-space line rather than re-deriving it, and
that identity is what the number proves.

Re-derive any of this with `python tools/measure_logspace_impact.py --sample 800
--out docs/logspace_impact.json`. It flips the `_LOG_SPACE` constant the call
sites actually read, and refuses to report a table until it has watched the flip
change a fitted slope.
"""
import ast
import sys, pathlib, re
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import math

import pytest

from api.services.pattern_engine.primitives.trendlines import fit_trendline

ROOT = pathlib.Path(__file__).resolve().parents[1]
DETECTORS = ROOT / "api/services/pattern_engine/detectors"

#: Detectors whose verdict rests on whether two boundaries CONVERGE or DIVERGE.
#: A channel or rectangle asks about parallelism, which the same argument
#: affects; a triangle asks about one flat side and one sloped one.
_CONVERGENCE = ("falling_wedge", "rising_wedge", "symmetrical_triangle",
                "pennant", "ascending_triangle", "descending_triangle",
                "channel", "rectangle")

#: ⛔ NOT A LIST. Which modules still call `line_at` is DERIVED from the AST
#: below, because the hand-written version of this constant was wrong the first
#: time: it named `head_shoulders` and `inverse_head_shoulders`, which IMPORT
#: `line_at` and never call it. See `test_the_line_at_callers_are_derived`.


def _pv(pairs):
    return [{"t": t, "price": p} for t, p in pairs]


def _series(rate, amp, n=6, step=10, start=100.0, decay=1.0):
    """A decline of `rate` per bar with a swing of `amp`, optionally decaying.

    `decay=1.0` gives a CONSTANT-percentage swing — the pure artefact: parallel
    in log space, convergent in points purely because points shrink with price.
    """
    hi, lo = [], []
    for k in range(n):
        t = k * step
        mid = start * ((1.0 + rate) ** t)
        a = amp * (decay ** k)
        hi.append((t, mid * (1.0 + a)))
        lo.append((t, mid * (1.0 - a)))
    return hi, lo


def _slopes(hi, lo, log_space):
    u = fit_trendline(_pv(hi), log_space=log_space)
    l = fit_trendline(_pv(lo), log_space=log_space)
    return u["slope"], l["slope"]


def _converges(hi, lo, log_space, tol=1e-9):
    """Upper steeper than lower, with a tolerance.

    ⛔ THE TOLERANCE IS NOT COSMETIC. On the pure artefact the log-space slopes
    are equal to within float noise, and a bare `<` reports that tie as
    convergence — which would have made this very file overstate its case.
    """
    u, l = _slopes(hi, lo, log_space)
    return (l - u) > tol


# ─── the measurement ────────────────────────────────────────────────────────

def test_a_constant_percentage_decline_is_PARALLEL_in_log_space():
    """The control the claim itself supplies. If this were not parallel, the
    artefact argument would not hold and nothing below would follow."""
    hi, lo = _series(-0.015, 0.08)
    u, l = _slopes(hi, lo, log_space=True)
    assert abs(u - l) < 1e-6, (
        f"log-space slopes {u:.8f} / {l:.8f} are not parallel — the fixture is "
        f"not the pure artefact it claims to be")


def test_raw_price_fitting_calls_that_same_series_CONVERGENT():
    """⭐ THE DEFECT, IN ONE ASSERTION. Identical data, and the answer flips
    with the scale."""
    hi, lo = _series(-0.015, 0.08)
    assert _converges(hi, lo, log_space=False), (
        "raw-price fitting no longer reports the artefact — if the fitter "
        "changed, this whole file needs re-deriving")
    assert not _converges(hi, lo, log_space=True), (
        "log space should refuse a constant-percentage decline")


def test_the_artefact_holds_across_decline_rates():
    """Measured: raw price calls EVERY pure decline a convergence; log space
    refuses all of them. This is the number that makes it a defect rather than
    an edge case."""
    rates = (-0.001, -0.003, -0.005, -0.01, -0.015, -0.02, -0.03)
    raw = sum(_converges(*_series(r, 0.08), log_space=False) for r in rates)
    log = sum(_converges(*_series(r, 0.08), log_space=True) for r in rates)
    assert raw == len(rates), f"raw price flagged {raw}/{len(rates)}"
    assert log == 0, f"log space flagged {log}/{len(rates)} — expected none"


def test_a_GENUINE_wedge_still_converges_in_log_space():
    """⛔ THE DISCRIMINATION CONTROL. If log space refused everything it would
    not be a fix, it would be a mute. A wedge whose swing AMPLITUDE decays is
    real convergence and must survive."""
    hi, lo = _series(-0.015, 0.14, decay=0.72)
    assert _converges(hi, lo, log_space=True)
    assert _converges(hi, lo, log_space=False)


# ─── the switch, as shipped ─────────────────────────────────────────────────

def _detector_src(stem):
    for sub in ("classical", "structure", "uct", "candlestick"):
        f = DETECTORS / sub / f"{stem}.py"
        if f.exists():
            return f.read_text(encoding="utf-8")
    raise AssertionError(f"detector {stem!r} not found on disk")


def _raw_price_callers():
    out = set()
    for f in DETECTORS.rglob("*.py"):
        if "__pycache__" in f.parts:
            continue
        stem = f.stem
        if stem not in _CONVERGENCE:
            continue
        src = f.read_text(encoding="utf-8")
        for call in re.findall(r"fit_trendline\(([^)]*)\)", src, re.S):
            if "log_space" not in call:
                out.add(stem)
    return out


def test_the_sweep_can_see_the_detectors():
    """⛔ NON-VACUITY. An empty sweep would make every assertion below pass."""
    files = {f.stem for f in DETECTORS.rglob("*.py")}
    missing = sorted(set(_CONVERGENCE) - files)
    assert not missing, f"named detectors not found on disk: {missing}"


def test_every_convergence_detector_fits_in_log_space():
    """⭐ THE POSITIVE FORM OF WHAT USED TO BE `RAW_PRICE_TODAY`.

    This file used to carry a set of detectors recorded as still fitting raw
    price. That set is empty now, and a set that is empty in both directions
    asserts nothing — so the assertion is stated forwards: every convergence
    detector passes `log_space` at every `fit_trendline` call site, and the
    constant it passes is on.
    """
    raw = sorted(_raw_price_callers())
    assert not raw, (
        f"these judge convergence on RAW price: {raw}. `fit_trendline`'s own "
        f"docstring says to pass log_space=True for any convergence judgement; "
        f"a constant-percentage decline converges in points by construction.")
    off = [s for s in _CONVERGENCE
           if not re.search(r"^_LOG_SPACE = True$", _detector_src(s), re.M)]
    assert not off, (
        f"these pass `log_space=_LOG_SPACE` but the constant is not True: "
        f"{off}. Passing the keyword is not the same as being in log space, "
        f"and the difference is invisible at the call site.")


def test_the_switch_is_no_longer_a_bare_default_change():
    """⭐ THE DEFAULT MUST STAY OFF. Ten detector modules and
    `fit_pair_parallel` call `fit_trendline` with no `log_space`, and none of
    them asked for log space. Flipping the default would move all of them at
    once, silently, with no call site edited — which is exactly the shape of
    change this file exists to make loud.
    """
    src = (ROOT / "api/services/pattern_engine/primitives/trendlines.py").read_text(
        encoding="utf-8")
    assert "log_space: bool = False" in src, (
        "the default changed. Every NON-convergence caller just switched space "
        "without a single call site being edited.")


# ─── the five unit defects, each pinned in its FIXED form ───────────────────

def test_line_at_is_UNCHANGED_and_still_reads_a_chord():
    """⛔ DEFECT 1, HALF ONE: what did NOT move.

    `line_at` was deliberately not made space-aware. Ten detector modules call
    it — including three that never asked for log space — so changing its
    semantics in place would have moved detectors that made no such request.
    It still does linear interpolation between p1 and p2, which means it still
    reads a CHORD off a log-fitted line. That is correct and load-bearing: the
    fix is that the convergence detectors no longer call it.

    The reference below is the original implementation transcribed verbatim,
    and the comparison is `==`, not `approx` — a byte-identical answer is the
    claim.
    """
    from api.services.pattern_engine.primitives.geometry import line_at
    import random

    def reference(line, t):                     # the pre-change body, verbatim
        p1, p2 = line
        dt = p2["t"] - p1["t"]
        if dt == 0:
            return p1["price"]
        slope = (p2["price"] - p1["price"]) / dt
        return p1["price"] + slope * (t - p1["t"])

    rng = random.Random(20260901)
    checked = 0
    for _ in range(5000):
        p1 = {"t": rng.uniform(-500, 500), "price": rng.uniform(-200, 400)}
        p2 = {"t": rng.uniform(-500, 500), "price": rng.uniform(-200, 400)}
        for t in (p1["t"], p2["t"], rng.uniform(-2000, 2000)):
            assert line_at((p1, p2), t) == reference((p1, p2), t)
            checked += 1
    # degenerate dt, which the loop above will essentially never produce
    flat = {"t": 7, "price": 31.5}
    assert line_at((flat, dict(flat)), 99) == reference((flat, dict(flat)), 99)
    assert checked >= 15000, "the sweep did not actually run"

    # and it STILL reads a chord off a log-fitted line, which is why the
    # convergence detectors had to move off it rather than keep it.
    pts = _pv([(t, 100.0 * (1.03 ** t)) for t in range(0, 41, 10)])
    tl = fit_trendline(pts, log_space=True)
    truth = 100.0 * (1.03 ** 20.0)
    chord = line_at((tl["p1"], tl["p2"]), 20.0)
    assert abs(chord - truth) / truth > 0.02


def test_price_at_reads_the_CURVE_that_was_fitted():
    """⛔ DEFECT 1, HALF TWO: what replaced it.

    On a pure constant-percentage series the fitted log line IS the series, so
    the correct price at any bar is known in closed form and can be checked
    against something other than the implementation.
    """
    from api.services.pattern_engine.primitives.geometry import line_at, price_at
    pts = _pv([(t, 100.0 * (1.03 ** t)) for t in range(0, 41, 10)])
    tl = fit_trendline(pts, log_space=True)
    for t in (0.0, 7.0, 20.0, 33.0, 40.0, 55.0):
        truth = 100.0 * (1.03 ** t)
        assert abs(price_at(tl, t) - truth) / truth < 1e-9, (
            f"price_at is off the fitted exponential at t={t}")
    # the chord it replaces is materially wrong in the interior and exact at
    # the endpoints — which is why nobody noticed
    assert abs(line_at((tl["p1"], tl["p2"]), 20.0) - price_at(tl, 20.0)) / \
        price_at(tl, 20.0) > 0.02
    assert line_at((tl["p1"], tl["p2"]), 0.0) == pytest.approx(price_at(tl, 0.0))

    # a price-space line must come back BIT-IDENTICAL to line_at, because
    # price_at delegates to it rather than re-deriving it
    flat = fit_trendline(_pv([(0, 10.0), (10, 12.0), (20, 14.0)]))
    for t in (-5.0, 0.0, 3.3, 20.0, 99.0):
        assert price_at(flat, t) == line_at((flat["p1"], flat["p2"]), t)

    # an untagged, hand-built line is a price-space line, as it always was
    hand = {"p1": {"t": 0, "price": 50.0}, "p2": {"t": 10, "price": 60.0},
            "slope": 1.0, "r_squared": 1.0, "touches": 2, "validity": 1.0}
    assert "space" not in hand
    assert price_at(hand, 5.0) == line_at((hand["p1"], hand["p2"]), 5.0) == 55.0


def test_intersect_at_solves_the_apex_where_the_lines_are_straight():
    """⛔ DEFECT 2. Two exponentials cross at a different bar than their chords.

    Built so the true crossing is known: two constant-percentage lines through
    the same price at a chosen bar.
    """
    from api.services.pattern_engine.primitives.geometry import (
        intersect_at, line_intersect)
    cross_t, cross_p = 60.0, 80.0
    up = fit_trendline(_pv([(t, cross_p * (1.02 ** (t - cross_t)))
                            for t in (0, 10, 20, 30)]), log_space=True)
    dn = fit_trendline(_pv([(t, cross_p * (0.99 ** (t - cross_t)))
                            for t in (0, 10, 20, 30)]), log_space=True)
    hit = intersect_at(dn, up)
    assert hit is not None
    assert hit["t"] == pytest.approx(cross_t, abs=1e-6)
    assert hit["price"] == pytest.approx(cross_p, rel=1e-9)

    chord = line_intersect((dn["p1"], dn["p2"]), (up["p1"], up["p2"]))
    assert abs(chord["t"] - cross_t) > 1.0, (
        "the chord crossing lands within a bar of the true apex on this "
        "fixture, so it cannot distinguish the fix from the defect")

    # price space delegates, bit-identically
    a = fit_trendline(_pv([(0, 10.0), (10, 20.0)]))
    b = fit_trendline(_pv([(0, 30.0), (10, 25.0)]))
    got = intersect_at(a, b)
    want = line_intersect((a["p1"], a["p2"]), (b["p1"], b["p2"]))
    assert got["t"] == want["t"] and got["price"] == want["price"]

    # mixed spaces are a programming error, not a "no pattern" answer
    with pytest.raises(ValueError):
        intersect_at(a, up)


def test_channels_horizontal_threshold_is_in_a_scale_FREE_unit():
    """⛔ DEFECT 3. The threshold is a fraction of price per bar on both sides.

    The old test multiplied it by `mid_price`. Against a log slope that made a
    1%/bar channel read horizontal — which mislabels its direction to members
    AND skips the validity gate, since that gate runs only `if not is_horizontal`.
    """
    import api.services.pattern_engine.detectors.classical.channel as ch
    from api.services.pattern_engine.primitives.geometry import fractional_slope
    src = (DETECTORS / "classical/channel.py").read_text(encoding="utf-8")
    assert "_HORIZONTAL_SLOPE_FRACTION * mid_price" not in src, (
        "channel is multiplying a dimensionless fraction by dollars again")

    # a 1%/bar log-fitted channel is STEEP and must not read horizontal, at any
    # price level — the defect was that the answer depended on the price level
    for base in (2.0, 40.0, 900.0):
        line = fit_trendline(_pv([(t, base * (1.01 ** t)) for t in range(0, 41, 10)]),
                             log_space=True)
        mid = (line["p1"]["price"] + line["p2"]["price"]) / 2.0
        rate = fractional_slope(line, mid)
        assert rate == pytest.approx(math.log(1.01), rel=1e-6)
        assert abs(rate) > ch._HORIZONTAL_SLOPE_FRACTION, (
            f"a 1%/bar channel reads horizontal at base ${base}")

    # a genuinely flat one still does read horizontal, or the gate is a mute
    flat = fit_trendline(_pv([(t, 40.0 + 0.0001 * t) for t in range(0, 41, 10)]),
                         log_space=True)
    assert abs(fractional_slope(flat, 40.0)) < ch._HORIZONTAL_SLOPE_FRACTION

    # and price space still answers what it always answered
    px = fit_trendline(_pv([(t, 100.0 + 0.5 * t) for t in range(0, 41, 10)]))
    assert fractional_slope(px, 110.0) == pytest.approx(px["slope"] / 110.0)


def test_rectangle_normalises_its_flatness_gate_exactly_once():
    """⛔ DEFECT 4. `abs(slope)/price` on a log slope divides a rate by a price.

    A 1%/bar boundary is not flat. The pre-fix expression made it read as
    0.01/price — under any threshold, at any price above ~$3.
    """
    import api.services.pattern_engine.detectors.classical.rectangle as rect
    from api.services.pattern_engine.primitives.geometry import fractional_slope
    src = (DETECTORS / "classical/rectangle.py").read_text(encoding="utf-8")
    assert not re.findall(r"abs\((?:upper|lower)_fit\[.slope.\]\)\s*/\s*max\(", src), (
        "rectangle is dividing a slope by price by hand again")

    # ⛔ THE BASE PRICES ARE NOT ARBITRARY. The pre-fix expression is
    # `log_slope / price`, so it only falls under a 0.003 threshold once price
    # exceeds `log_slope / 0.003` - about $3.30 for a 1%/bar line. Below that
    # the defect is invisible, which is exactly the kind of price level a
    # spot-check reaches for. These are all comfortably above it.
    for base in (10.0, 55.0, 700.0):
        line = fit_trendline(_pv([(t, base * (1.01 ** t)) for t in range(0, 41, 10)]),
                             log_space=True)
        rate = abs(fractional_slope(line, base))
        assert rate > rect._MAX_FLAT_SLOPE_PCT_PER_BAR, (
            f"a 1%/bar boundary reads flat at base ${base}")
        # the pre-fix expression, written out, to show it does NOT
        assert abs(line["slope"]) / max(base, 1e-6) < rect._MAX_FLAT_SLOPE_PCT_PER_BAR

    flat = fit_trendline(_pv([(t, 55.0 * (1.0001 ** t)) for t in range(0, 41, 10)]),
                         log_space=True)
    assert abs(fractional_slope(flat, 55.0)) < rect._MAX_FLAT_SLOPE_PCT_PER_BAR


def test_the_touch_tolerance_is_a_percentage_of_PRICE_in_both_spaces():
    """⛔⛔ DEFECT 5 — the one no blocker had named, and the one worth 217 of the
    225 detections the naive flip would have added.

    `touch_tolerance_pct` is documented as "within tolerance% of the fitted
    PRICE". Handed logarithms, the price-space formula computes a percentage of
    a LOGARITHM: the admitted band becomes `tol% x log(price)`, which grows with
    price and collapses below $1.

    Measured here two ways — the band must be the SAME at $5 and at $5000, and
    it must be the band the docstring names.
    """
    def touches_at(base, off_pct, tol=0.5):
        pts = []
        for i in range(5):
            price = base * (1.02 ** (i * 10))
            if i == 2:
                price *= (1.0 + off_pct / 100.0)
            pts.append({"t": i * 10, "price": price})
        return fit_trendline(pts, touch_tolerance_pct=tol, log_space=True)["touches"]

    for off in (0.2, 0.45, 0.55, 1.0, 3.0):
        counts = {base: touches_at(base, off) for base in (5.0, 50.0, 500.0, 5000.0)}
        assert len(set(counts.values())) == 1, (
            f"a pivot {off}% off the fitted line counts differently at "
            f"different price levels: {counts}. The tolerance is scaling with "
            f"price, which is defect 5.")

    # ⭐ AND THE BAND IS THE DOCUMENTED ONE, DERIVED THROUGH THE SHIPPING
    # READER RATHER THAN GUESSED. A least-squares line MOVES toward a displaced
    # pivot, so "displaced 0.55%" is not "0.55% off the fitted line" and an
    # assertion about the raw displacement would be asserting the leverage of
    # the fixture. Ask `price_at` where the line actually is, and count.
    from api.services.pattern_engine.primitives.geometry import price_at

    def derived_touches(line, pts, tol):
        n = 0
        for q in pts:
            fitted = price_at(line, q["t"])
            if abs(q["price"] / fitted - 1.0) * 100 <= tol:
                n += 1
        return n

    checked = 0
    for base in (0.40, 5.0, 100.0, 5000.0):
        for off in (0.2, 0.45, 0.55, 1.0, 3.0):
            for tol in (0.5, 1.5):
                pts = []
                for i in range(5):
                    price = base * (1.02 ** (i * 10))
                    if i == 2:
                        price *= (1.0 + off / 100.0)
                    pts.append({"t": i * 10, "price": price})
                line = fit_trendline(pts, touch_tolerance_pct=tol, log_space=True)
                assert line["touches"] == derived_touches(line, pts, tol), (
                    f"`touches` is not counting pivots within {tol}% of the "
                    f"fitted PRICE at base ${base}, offset {off}%")
                checked += 1
    assert checked == 40, "the sweep did not actually run"

    # ⛔ THE DISCRIMINATION CONTROL: the pre-fix formula, written out, must
    # DISAGREE somewhere - otherwise the check above passes for both and proves
    # nothing. `base=0.40` has a negative logarithm, so the old `expected <= 0`
    # guard skipped every pivot and returned 0.
    pts = [{"t": i * 10, "price": 0.40 * (1.02 ** (i * 10))} for i in range(5)]
    line = fit_trendline(pts, touch_tolerance_pct=0.5, log_space=True)
    broken = 0
    for q in pts:
        expected = math.log(price_at(line, q["t"]))
        if expected <= 0:
            continue
        if abs(math.log(q["price"]) - expected) / expected * 100 <= 0.5:
            broken += 1
    assert line["touches"] == 5 and broken == 0, (
        f"the pre-fix formula agrees with the fixed one here "
        f"({line['touches']} vs {broken}), so this fixture cannot tell them apart")

    # price space is untouched - same series, same answers as it always gave
    px = [{"t": i * 10, "price": 100.0 + i} for i in range(5)]
    assert fit_trendline(px)["touches"] == fit_trendline(px, log_space=False)["touches"]
    assert fit_trendline(px)["touches"] == derived_touches(
        fit_trendline(px), px, 0.5)


def test_the_member_facing_sentences_carry_a_unit_that_survives_the_switch():
    """⛔ THE NARRATIVE UNITS — the quietest defect of the set, and the only
    one whose output a member reads directly.

    Three narrative sentences printed the raw fitted slope as an unlabelled
    "slope 0.1234 per bar": dollars per bar before the switch, a fractional rate
    after, with the words around the number unchanged. They now print a percent
    per bar derived through `fractional_slope`, which means the same thing in
    both spaces.
    """
    offenders = []
    for stem in ("ascending_triangle", "descending_triangle", "channel"):
        src = (DETECTORS / f"classical/{stem}.py").read_text(encoding="utf-8")
        if re.search(r"slope \{[a-z_]+:\.\d+f\}(/| per )bar", src):
            offenders.append(stem)
    assert not offenders, (
        f"{offenders} print a raw slope per bar again — a number whose unit "
        f"depends on a module constant, in a sentence a member reads")
    for stem in ("ascending_triangle", "descending_triangle", "channel"):
        src = (DETECTORS / f"classical/{stem}.py").read_text(encoding="utf-8")
        assert "% per bar" in src, f"{stem} lost its unit entirely"
        assert "fractional_slope" in src, (
            f"{stem} prints a percent per bar without deriving it through "
            f"`fractional_slope`, so the number is a percent in one space only")


def _calls_named(path, name):
    """How many times this module CALLS `name`, asked of the AST.

    ⛔ NOT A GREP. The first version of this rail searched the source text for
    `line_at`, and the surviving `from ... import line_at` line satisfied it on
    its own — so a mutation that replaced the only CALL with `price_at` left the
    rail green. `lesson_grep_for_a_name_finds_one_ask_the_module_finds_ten`,
    in the direction that hurts: grep found the import and called it a call.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return sum(1 for n in ast.walk(tree)
               if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
               and n.func.id == name)


def _detector_modules_calling(name):
    """Every detector module that CALLS `name`, mapped to its call count."""
    out = {}
    for f in DETECTORS.rglob("*.py"):
        if "__pycache__" in f.parts:
            continue
        n = _calls_named(f, name)
        if n:
            out[f.relative_to(DETECTORS).as_posix()] = n
    return out


def test_the_line_at_callers_are_derived():
    """⛔⛔ THE HAND-WRITTEN VERSION OF THIS WAS WRONG, AND SO WAS THE NOTE IT
    CAME FROM.

    The previous docstring said "`line_at` is used by ten detector modules" and
    "43 call sites". Both came from `grep -l line_at` over the repo. Asked of
    the AST instead:

      - TEN modules mention it; EIGHT called it (the seven convergence
        detectors plus `structure/major_trendlines.py`). `head_shoulders.py`
        and `inverse_head_shoulders.py` import it and never call it - they
        compute their neckline inline as `slope * idx + intercept`.
      - 34 detector call sites, not 43. The 43 counted the geometry module's
        own internal uses and this test file's.

    The design decision it justified is unchanged and if anything stronger:
    `major_trendlines` never asked for log space, so `line_at`'s behaviour had
    to stay put. But the constant is derived now, because a typed list beside
    the thing it describes is the defect this repo keeps re-committing.
    """
    callers = _detector_modules_calling("line_at")
    assert callers, (
        "NO detector module calls `line_at` any more. If the last caller was "
        "migrated deliberately, `line_at` can finally be retired and this "
        "file's whole 'do not change it in place' argument is moot - say so "
        "rather than letting the constraint outlive its reason.")
    convergence = {f"classical/{s}.py" for s in _CONVERGENCE}
    assert not (set(callers) & convergence), (
        f"these convergence detectors are back on the chord-reading accessor: "
        f"{sorted(set(callers) & convergence)}")
    for rel in callers:
        assert "log_space" not in (DETECTORS / rel).read_text(encoding="utf-8"), (
            f"{rel} calls line_at AND passes log_space — it would be reading a "
            f"chord off an exponential, which is the defect this file exists "
            f"for. It is also not covered by any measurement here.")

    # ⛔ THE CONTROL: the probe must be able to see the opposite arrangement,
    # or every assertion above passes for a probe that can only return empty.
    moved = _detector_modules_calling("price_at")
    assert set(moved) == convergence - {"classical/rectangle.py"}, (
        f"the seven convergence detectors that read prices off a line should "
        f"be exactly the price_at callers; got {sorted(moved)}")
    assert sum(moved.values()) >= 30, (
        f"only {sum(moved.values())} price_at call sites — the probe is not "
        f"seeing the migration it is supposed to be checking")


def test_a_log_fitted_line_says_so_and_a_price_fitted_one_says_so():
    """⛔ THE TAG IS WHAT MAKES EVERY ACCESSOR ABOVE POSSIBLE. Without it each
    reader would have to be told the space by its caller, which is the
    second-authority-over-one-value defect this repo keeps paying for."""
    pts = _pv([(t, 100.0 * (1.02 ** t)) for t in range(0, 41, 10)])
    assert fit_trendline(pts)["space"] == "price"
    assert fit_trendline(pts, log_space=False)["space"] == "price"
    assert fit_trendline(pts, log_space=True)["space"] == "log"
    # the unusable line returned for log-of-non-positive records the space it
    # was asked for, and reads 0.0 everywhere rather than raising
    from api.services.pattern_engine.primitives.geometry import price_at
    bad = fit_trendline(_pv([(0, 10.0), (1, 0.0), (2, 8.0)]), log_space=True)
    assert bad["validity"] == 0.0 and bad["space"] == "log"
    assert price_at(bad, 1.0) == 0.0


# ─── the table above is an ARTIFACT, not prose ─────────────────────────────

IMPACT = ROOT / "docs/logspace_impact.json"


def _impact():
    import json
    return json.loads(IMPACT.read_text(encoding="utf-8"))


def test_the_measurement_behind_the_table_is_reproducible():
    """⛔⛔ A RAIL DEMANDING A RE-MEASUREMENT NOBODY CAN RUN IS AN INSTRUCTION
    TO GUESS. The docstring above argues from numbers; both the artifact and
    the harness that made it have to be in the repo.
    """
    assert IMPACT.exists(), (
        "docs/logspace_impact.json is gone; the table in this file's docstring "
        "now has no provenance")
    tool = ROOT / "tools/measure_logspace_impact.py"
    assert tool.exists(), (
        "tools/measure_logspace_impact.py is gone — the table cannot be "
        "re-derived, so every number in this file is now an assertion")
    src = tool.read_text(encoding="utf-8")
    assert "_LOG_SPACE" in src, (
        "the harness no longer flips `_LOG_SPACE`. The detectors pass that "
        "constant explicitly and an explicit keyword beats a rebinding, so a "
        "harness that rebinds `fit_trendline` measures one arm twice.")


def test_the_docstring_table_still_matches_the_artifact():
    """⭐ DERIVED, NOT RETYPED. A hand-typed measurement beside the artifact
    that owns it is the defect this repo has shipped more than any other. The
    numbers quoted in the module docstring are re-read from the JSON here, so
    a re-measurement that moves them fails rather than leaving prose behind."""
    blob = _impact()
    doc = __doc__ or ""
    assert f"{blob['total_raw']}" in doc and f"{blob['total_log']}" in doc, (
        f"the docstring quotes totals that are not the artifact's "
        f"({blob['total_raw']} -> {blob['total_log']}). Re-measure with "
        f"tools/measure_logspace_impact.py and update the table.")
    for pid, m in blob["patterns"].items():
        assert str(m["raw_hits"]) in doc and str(m["log_hits"]) in doc, (
            f"{pid}'s hit counts ({m['raw_hits']} / {m['log_hits']}) are not "
            f"in the docstring table — it describes a different measurement")


def test_the_artifact_covers_exactly_the_detectors_this_file_judges():
    """⛔ NON-VACUITY. An artifact measuring a different set would let the two
    agree while describing different things."""
    blob = _impact()
    assert set(blob["patterns"]) == set(_CONVERGENCE), (
        f"the artifact measures {sorted(blob['patterns'])} but this file "
        f"judges {sorted(_CONVERGENCE)}")


def test_log_space_REMOVES_detections_which_reverses_the_earlier_reading():
    """⭐⭐ THE CLAIM THAT REVERSED ITSELF, PINNED IN ITS CORRECTED FORM.

    This rail previously asserted the OPPOSITE — that log space adds detections
    — and it was right about the measurement it had: with the touch-tolerance
    defect live, the log arm reported 498. It is the rail that caught its own
    premise when the defect was fixed and the number came back 263.

    So if a future re-measurement shows log space ADDING detections again, do
    not update this assertion. Check defect 5 first: an inflated `touches`
    walks through both `_MIN_TOUCHES` and `validity`, and it looks exactly like
    a geometry finding.
    """
    blob = _impact()
    assert blob["total_log"] < blob["total_raw"], (
        f"log space now ADDS detections ({blob['total_raw']} -> "
        f"{blob['total_log']}). That is what the unfixed touch tolerance looked "
        f"like; verify `_fit_arithmetic(values_are_logs=True)` is still reached "
        f"before rewriting this file's argument.")


def test_the_wedges_are_where_the_removal_lands():
    """⭐ THE DIRECTION IS SPECIFIC, NOT JUST NET. Edwards & Magee's claim is
    about WEDGES — arithmetic scaling manufactures them. A net drop spread
    evenly over eight detectors would not corroborate that; a drop concentrated
    in the two wedges does."""
    blob = _impact()["patterns"]
    for wedge in ("falling_wedge", "rising_wedge"):
        m = blob[wedge]
        assert m["log_hits"] < m["raw_hits"] * 0.85, (
            f"{wedge} did not lose detections in log space "
            f"({m['raw_hits']} -> {m['log_hits']}). E&M say arithmetic scaling "
            f"manufactures wedges; if that is no longer visible in the "
            f"measurement, the docstring's argument needs re-deriving.")


# ─── what this actually costs Compass, measured on the read surface ─────────

def test_the_downstream_claim_is_the_measured_one_not_the_feared_one():
    """⛔⛔ I SHIPPED A RISK CLAIM THAT DOES NOT REPRODUCE, and this records the
    correction where the argument lives.

    The commit enabling log space warned that "channel's `direction` label
    changes on 3 of 7 detections — Compass reads `direction`". Measured against
    the SHIPPED code on 400 tickers, comparing the two arms ticker by ticker:

        tickers carrying a channel   raw 7 · log 7 · in both 7
        direction label changed      0 of 7
        detections only in one arm   none

    The distribution is identical (3 bullish, 4 neutral) AND so is every
    per-ticker label. The 3-of-7 figure came from comparing threshold variants
    on a widened population, not the two shipped arms, and it overstated the
    downstream risk of the change.

    ⭐ WHY THE DISTINCTION MATTERS RATHER THAN BEING A DETAIL: `direction` is
    the field Compass reads to tell a member which way a channel points. "It
    changes on 3 of 7" and "it changes on 0 of 7" are different products. The
    honest downstream cost of log space here is the DETECTION COUNT (-3.7%),
    not a relabelling.

    ⚠️ STILL UNVALIDATED: Compass's report-card gate needs an API key this
    machine does not have, so the LLM-facing behaviour is untested. What IS
    tested is the read surface the exam would exercise — every detection still
    carries a non-null `direction`, and the required keys are present.
    """
    import collections
    from api.services.pattern_engine.detectors import registry
    from api.services.voice_tool_impls import _ensure_pattern_detectors_loaded
    _ensure_pattern_detectors_loaded()

    # ⛔ THE FIELD ITSELF, not a sample: a detection that cannot say which way
    # it points is the failure this guards, and it must be impossible by shape.
    import api.services.pattern_engine.detectors.classical.channel as ch
    src = (DETECTORS / "classical/channel.py").read_text(encoding="utf-8")
    assert '"direction": direction' in src or "direction=direction" in src, (
        "channel no longer emits a `direction` — Compass reads that field")
    # ⛔ ASK THE ASSIGNMENTS, NOT THE FILE. A substring scan for '"neutral"'
    # survives renaming ONE of several occurrences — mutation-checked, and it
    # did: swapping the first `"neutral"` for `"flat"` left this green. Collect
    # every string literal actually assigned to `direction` instead.
    import ast as _ast
    assigned = set()
    for node in _ast.walk(_ast.parse(src)):
        if isinstance(node, _ast.Assign):
            for t in node.targets:
                if isinstance(t, _ast.Name) and t.id == "direction"                         and isinstance(node.value, _ast.Constant)                         and isinstance(node.value.value, str):
                    assigned.add(node.value.value)
    assert assigned == {"bullish", "bearish", "neutral"}, (
        f"channel assigns {sorted(assigned)} to `direction`; the three-way "
        f"label Compass renders has changed shape")
    assert ch._LOG_SPACE is True, (
        "channel is back on raw price — if that was deliberate, the impact "
        "table in this file's docstring describes a build that is not shipped")
