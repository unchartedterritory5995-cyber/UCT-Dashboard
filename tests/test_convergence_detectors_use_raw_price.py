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

⛔ NOTHING IS FLIPPED. These detectors feed `pattern_detections`, which Compass
reads through `find_patterns_on_ticker` / `scan_active_patterns`, and that
product has its own report-card deploy gate. Changing what fourteen detectors
report is an owner decision, not a passer-by's. This rail PINS the current state
with its measurement so the decision is made deliberately and cannot be
rediscovered as a surprise — the same treatment as the two-engine boundary in
`test_no_second_authority_across_axes.py`.
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
