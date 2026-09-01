"""Every convergence detector fits RAW price, and the fix already exists unused.

⛔⛔ THE FINDING. `primitives/trendlines.fit_trendline` takes `log_space` and its
own docstring says, in these words: "⛔ PASS `log_space=True` FOR ANY CONVERGENCE
OR DIVERGENCE JUDGEMENT." All FOURTEEN call sites in the pattern engine omit it.
The parameter was implemented, documented with the exact rule it exists for, and
wired to nothing — `lesson_built_tested_green_and_unreachable`, on an argument.

⭐ WHY IT MATTERS, FROM THE RESEARCH. Edwards & Magee
(`docs/superpowers/research/bases/06-edwards-magee-murphy-canon.md:540`):

    "falling wedges are MANUFACTURED BY ARITHMETIC PRICE SCALING. Because a
     constant *percentage* swing shrinks in *points* as price falls, any
     extended decline plotted arithmetically converges by construction. A
     detector that fits lines to raw prices will emit falling wedges on
     essentially every sustained downtrend, and they will be artefacts, not
     patterns."

The corpus calls it "the single highest-value, most-ignored implementation
instruction in either book".

⭐ MEASURED HERE, NOT ASSUMED. The cases below build the pure artefact the claim
describes — a constant-percentage decline with a constant-percentage swing, whose
boundaries are exactly PARALLEL in log space — and show raw-price fitting calls
it convergent while log space does not.

⛔⛔ AND THE ONE-LINE FIX IS A TRAP. Passing `log_space=True` at the fourteen
call sites is the obvious change, it is what the parameter's own docstring asks
for, and it would ship a worse defect than the one it fixes. Measured
2026-09-01 on 744 tickers, both arms in ONE pass over identical bars (the
detectors bind `fit_trendline` at import, so the second arm is installed by
rebinding the attribute on each detector module — a paired comparison, not two
samples):

    pattern                raw %   log %   raw hits   log hits
    falling_wedge           2.3%    3.8%         17         28
    rising_wedge            3.9%    7.1%         29         53
    symmetrical_triangle    4.4%    6.0%         33         45
    pennant                 4.4%    4.6%         34         35
    ascending_triangle     11.7%   15.5%         87        115
    descending_triangle     6.6%    8.7%         49         65
    channel                 1.2%   19.1%          9        142
    rectangle               2.0%    2.0%         15         15
    TOTAL                                       273        498

⭐ THE DIRECTION IS THE OPPOSITE OF THE ONE I EXPECTED, AND I TESTED THE WRONG
HYPOTHESIS FIRST. I assumed log space would REMOVE spurious detections, and that
channel's 9 -> 142 was the `is_horizontal` unit bug below bypassing the validity
gate. It is not: dividing that threshold by 200 moves the log-arm count only
50 -> 42 on a 300-ticker slice. Most of the increase is REAL — a channel that
holds a constant PERCENTAGE width widens in points, so arithmetic fitting was
calling genuine channels divergent and refusing them. Edwards & Magee's argument
cuts both ways and the missing-pattern half is the larger half here.

⛔ THREE CONSUMERS ASSUME PRICE-SPACE UNITS, AND ALL THREE BREAK SILENTLY.
`fit_trendline(log_space=True)` returns `slope` in LOG UNITS while
exponentiating `p1`/`p2` back into price. That is documented, and every consumer
predates the parameter:

  1. `primitives/geometry.line_at` interpolates LINEARLY between `p1` and `p2`.
     A log-fitted line is exponential in price, so every price read off it is a
     CHORD, not the line that was fitted. The seven detectors that measure width,
     depth or a convergence ratio do it through `line_at` — 43 call sites — so
     each would be scoring a chord while believing it scored the line.
  2. `channel._HORIZONTAL_SLOPE_FRACTION * mid_price` compares a slope to a
     fraction of PRICE. Against a log slope (a fraction per bar, ~0.000-0.02)
     the threshold is ~0.1, so essentially every channel classifies as
     horizontal — which mislabels its direction to members as "neutral" AND
     skips the validity gate, since that gate runs only `if not is_horizontal`.
  3. `rectangle` computes `abs(slope) / price` to get a fractional rate. A log
     slope is ALREADY that rate, so dividing again understates it ~100x and
     every boundary reads flat.

  And two member-facing sentences print `slope {x:.4f} per bar`
  (`ascending_triangle`, `descending_triangle`) — dollars today, a fractional
  rate after the switch, with no change to the words around the number.

⛔ SO NOTHING IS FLIPPED, and the reason is now specific rather than deferential.
The blocker is not "an owner must decide"; it is that the correct change is a
space-tagged `Trendline` plus a `price_at` that respects it, migrating the seven
detectors off `line_at`, two threshold fixes and two narrative fixes. `line_at`
is used by ten detector modules, so changing ITS semantics in place would move
detectors that never asked for log space. These detectors feed
`pattern_detections`, which Compass reads through `find_patterns_on_ticker` /
`scan_active_patterns`, and that product has its own report-card deploy gate
that this session cannot run. The rails below pin each blocker so the next
attempt starts from the evidence instead of rediscovering it — and so that
flipping the flag alone goes RED rather than quietly shipping a chord.
"""
import sys, pathlib, re
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

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

#: ⛔ RECORDED, NOT FORGIVEN. Every entry here is a live defect awaiting an
#: owner decision, and `test_no_entry_has_silently_been_fixed` deletes the
#: excuse the moment one is addressed.
RAW_PRICE_TODAY = set(_CONVERGENCE)


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


# ─── the state of the code, pinned ──────────────────────────────────────────

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


def test_no_entry_has_silently_been_fixed():
    """⭐ THE LIST POINTS BOTH WAYS. A detector that starts passing
    `log_space=True` must be removed from RAW_PRICE_TODAY, or this file
    documents a defect that no longer exists and reads as coverage."""
    live = _raw_price_callers()
    stale = sorted(RAW_PRICE_TODAY - live)
    assert not stale, (
        f"these now pass log_space (or stopped fitting trendlines): {stale}. "
        f"Delete them from RAW_PRICE_TODAY — the finding has been addressed.")


def test_no_new_convergence_detector_omits_log_space():
    live = _raw_price_callers()
    unrecorded = sorted(live - RAW_PRICE_TODAY)
    assert not unrecorded, (
        f"these judge convergence on RAW price and are not recorded: "
        f"{unrecorded}. `fit_trendline`'s own docstring says to pass "
        f"log_space=True for any convergence judgement; a constant-percentage "
        f"decline converges in points by construction.")


# ─── the blockers, each pinned so flipping the flag alone goes RED ──────────

def test_line_at_reads_a_CHORD_off_a_log_fitted_line():
    """⛔ BLOCKER 1, MEASURED. `fit_trendline(log_space=True)` exponentiates
    `p1`/`p2` back into price, and `line_at` draws a straight line between
    them. The fitted curve is exponential, so every interior price is wrong —
    and seven detectors score width, depth and convergence through `line_at`.
    """
    from api.services.pattern_engine.primitives.geometry import line_at
    import math
    # a pure constant-percentage rise: exactly a straight line in log space
    pts = _pv([(t, 100.0 * (1.03 ** t)) for t in range(0, 41, 10)])
    tl = fit_trendline(pts, log_space=True)
    mid_t = 20.0
    truth = 100.0 * (1.03 ** mid_t)
    chord = line_at((tl["p1"], tl["p2"]), mid_t)
    err = abs(chord - truth) / truth
    assert err > 0.02, (
        f"the chord is within {err:.2%} of the fitted curve at the midpoint. "
        f"If `line_at` became log-aware, this blocker is GONE — delete this "
        f"test and re-derive the switch decision.")
    # and the endpoints ARE exact, which is why the error hides
    assert abs(line_at((tl["p1"], tl["p2"]), tl["p1"]["t"]) - tl["p1"]["price"]) < 1e-6


def test_channels_horizontal_threshold_is_price_scaled():
    """⛔ BLOCKER 2. The threshold multiplies a fraction by PRICE, so against a
    log slope it is ~100x too large — every channel reads horizontal, which
    mislabels direction AND skips the validity gate (`if not is_horizontal`)."""
    import api.services.pattern_engine.detectors.classical.channel as ch
    src = (DETECTORS / "classical/channel.py").read_text(encoding="utf-8")
    assert "_HORIZONTAL_SLOPE_FRACTION * mid_price" in src, (
        "channel's horizontal test no longer multiplies by price — if it was "
        "made scale-correct, this blocker is gone; re-derive the decision.")
    # a log slope of 1%/bar is a STEEP channel and must not read as horizontal
    steep_log_slope = 0.01
    assert steep_log_slope < ch._HORIZONTAL_SLOPE_FRACTION * 100.0, (
        "a 1%/bar log slope no longer falls under the horizontal threshold at "
        "a $100 mid price — the unit mismatch has changed shape")


def test_rectangle_divides_slope_by_price_a_second_time():
    """⛔ BLOCKER 3. `abs(slope)/price` converts a price slope to a fractional
    rate. A log slope is already that rate; dividing again buries it."""
    src = (DETECTORS / "classical/rectangle.py").read_text(encoding="utf-8")
    hits = re.findall(r"abs\((?:upper|lower)_fit\[.slope.\]\)\s*/\s*max\(", src)
    assert len(hits) == 2, (
        f"expected rectangle's two slope-to-fraction normalisations, found "
        f"{len(hits)} — if they were made space-aware this blocker is gone")


def test_the_member_facing_sentences_print_slope_units_that_would_change():
    """⚠️ BLOCKER 4, and the quietest. These sentences reach members. The
    number's UNITS change under log space; the words around it do not."""
    offenders = []
    for stem in ("ascending_triangle", "descending_triangle"):
        src = (DETECTORS / f"classical/{stem}.py").read_text(encoding="utf-8")
        if re.search(r"slope \{[a-z_]+:\.\d+f\} per bar", src):
            offenders.append(stem)
    assert offenders, (
        "neither triangle prints a raw slope per bar any more — if the prose "
        "was made unit-aware, this blocker is gone; re-derive the decision.")


def test_the_switch_is_still_a_single_keyword_so_the_trap_stays_live():
    """⭐ WHY ALL OF THE ABOVE MATTERS. The change that breaks the four
    blockers is ONE keyword at fourteen call sites — cheap to make, and
    nothing in the engine would fail. That is precisely the shape of edit that
    ships silently, so these rails exist to make it loud."""
    src = (ROOT / "api/services/pattern_engine/primitives/trendlines.py").read_text(
        encoding="utf-8")
    assert "log_space: bool = False" in src, (
        "the default changed. Every convergence detector just switched space "
        "without a single call site being edited — verify blockers 1-4 first.")


# ─── the table above is an ARTIFACT, not prose ─────────────────────────────

IMPACT = ROOT / "docs/logspace_impact.json"


def _impact():
    import json
    return json.loads(IMPACT.read_text(encoding="utf-8"))


def test_the_measurement_behind_the_table_is_reproducible():
    """⛔⛔ A RAIL DEMANDING A RE-MEASUREMENT NOBODY CAN RUN IS AN INSTRUCTION
    TO GUESS. Every blocker below says "re-derive the switch decision" — that
    needs both the artifact and the harness that made it, in the repo.
    """
    assert IMPACT.exists(), (
        "docs/logspace_impact.json is gone; the table in this file's docstring "
        "now has no provenance")
    tool = ROOT / "tools/measure_logspace_impact.py"
    assert tool.exists(), (
        "tools/measure_logspace_impact.py is gone — the table cannot be "
        "re-derived, so every 're-derive the decision' instruction here is "
        "an instruction to guess")


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


def test_log_space_still_ADDS_detections_which_is_the_surprising_half():
    """⭐ THE CLAIM THAT REVERSED MY HYPOTHESIS, pinned. If a re-measurement
    ever shows log space REMOVING detections, the docstring's central argument
    is wrong and must be rewritten, not quietly inherited."""
    blob = _impact()
    assert blob["total_log"] > blob["total_raw"], (
        f"log space now removes detections ({blob['total_raw']} -> "
        f"{blob['total_log']}). This file argues the opposite at length.")
