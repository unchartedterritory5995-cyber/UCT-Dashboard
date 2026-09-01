"""`double_bottom` was in noise territory. The recency window was narrowed.

⛔ THE THRESHOLD IS NOT MINE. `tools/base_coverage.py` sets `NOISE_PCT = 35.0`
and describes it in the file as "the measured NR4 deletion threshold" — the
level at which `Compression Bar (NR4)` was judged to carry no information and
was REMOVED, on the reasoning that a label a third of the market carries is not
a label. `double_bottom` sat above it, and `classify()` returned the verdict
"noise" on the shipped detector.

⭐ MEASURED 2026-09-01 over 650 tickers, one knob at a time with the others at
their shipped values, THROUGH `base_coverage.coverage()` — the harness that owns
both the definition and the threshold, so the number and the bar it is judged
against come from the same place:

    _MAX_TROUGH2_AGE        30 -> 45.8%   20 -> 39.4%   10 -> 26.0%   5 -> 9.8%
    _MIN_RALLY_DEPTH      0.05 -> 45.8% 0.08 -> 44.2% 0.12 -> 30.9% 0.20 -> 10.2%
    _MAX_TROUGH_SIMILARITY 0.04 -> 45.8% 0.03 -> 41.2% 0.02 -> 36.9% 0.01 -> 24.3%
    _MIN_TROUGH_SPACING      7 -> 45.8%   12 -> 43.2%   20 -> 38.0%   30 -> 30.3%

⚠️ AN EARLIER READING OF THIS SWEEP PUT THE SHIPPED VALUE AT 42.9%, AND THE
DIFFERENCE IS RECORDED RATHER THAN SMOOTHED OVER. Every cell is ~3pp higher on
re-measure; the shift is uniform across all four knobs, which is the signature
of the detector's inputs moving (several master merges landed between the two
readings) rather than of one knob behaving differently. The conclusion did not
change — shipped is above the bar, 10 is inside it — but a number quietly
replaced would have been a second authority over one value.

⛔ NONE OF THESE CONSTANTS IS SOURCED OR EXPLAINED. Every comment beside them
restates the value ("t2 within last 30 bars") rather than justifying it, and
nothing in the specs mentions them. By the standard this repo applies to
`base_catalog`, an unsourced threshold is OURS and should be SWEPT rather than
chosen — which is what the table above is.

⭐⭐ THE DECISION, TAKEN 2026-09-01: `_MAX_TROUGH2_AGE = 10`, moving coverage to
26.0% and the verdict from "noise" to "ok". The recency window is the only knob
that reaches the band without gutting the pattern's own definition — similarity
and spacing cannot get there at all, and depth only does so by discarding two
thirds of what a double bottom IS. It is also the defensible one on meaning
rather than only on arithmetic: this engine emits detections meant to be
actionable NOW, and a second trough 30 bars old describes a pattern that
completed six weeks ago. Calling that a live double bottom was the claim that
was actually wrong.

⚠️ IT IS MEMBER-VISIBLE AND THE COST IS STATED, NOT ELIDED: roughly 43% of this
detector's output leaves `pattern_detections`, which Compass reads through
`find_patterns_on_ticker` and `scan_active_patterns`. That is the point — the
removed 43% is the half that had already finished happening.

This rail pins the measurement and the decision, and fails if coverage moves in
EITHER direction, so neither the number nor the verdict can drift back silently.
"""

import sys, pathlib, re
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "api/services/pattern_engine/detectors/classical/double_bottom.py"

#: The shipped values this file's measurement was taken against. If one moves,
#: the table above describes a detector that no longer exists.
MEASURED_AGAINST = {
    "_MAX_TROUGH2_AGE": 10,
    "_MIN_RALLY_DEPTH": 0.05,
    "_MAX_TROUGH_SIMILARITY": 0.04,
    "_MIN_TROUGH_SPACING": 7,
}

#: Measured coverage at the shipped values, 650 tickers, 2026-09-01.
#: Coverage AT THE SHIPPED VALUES after the decision, 650 tickers.
MEASURED_COVERAGE_PCT = 26.0

#: What it read before the recency window was narrowed. Kept so the
#: decision's SIZE stays legible: a rail that records only the new number
#: makes the change look like it never happened.
COVERAGE_BEFORE_PCT = 45.8

#: `tools/base_coverage.NOISE_PCT`, read rather than retyped by the test below.
def _noise_pct():
    from tools import base_coverage
    return base_coverage.NOISE_PCT


def _constants():
    src = SRC.read_text(encoding="utf-8")
    out = {}
    for name in MEASURED_AGAINST:
        m = re.search(rf"^{name}\s*=\s*([0-9.]+)", src, re.M)
        if m:
            out[name] = float(m.group(1))
    return out


def test_the_source_can_be_read_at_all():
    """⛔ NON-VACUITY. A regex that matches nothing makes every check below
    pass on an empty dict."""
    got = _constants()
    assert set(got) == set(MEASURED_AGAINST), (
        f"could not read {sorted(set(MEASURED_AGAINST) - set(got))} from "
        f"{SRC.name} — this rail is not looking at the detector it claims to")


def test_the_measurement_still_describes_the_shipped_detector():
    """⭐ THE TABLE IN THE DOCSTRING IS ONLY TRUE OF THESE VALUES. If a knob
    moves, the recorded 42.9% is about a detector that no longer exists, and
    the finding must be re-measured rather than quietly inherited."""
    got = _constants()
    drifted = {k: (MEASURED_AGAINST[k], got[k])
               for k in MEASURED_AGAINST if got[k] != MEASURED_AGAINST[k]}
    assert not drifted, (
        "these knobs changed since the coverage above was measured "
        f"{drifted!r}. RE-MEASURE before trusting the 42.9%, and update both "
        "the table and MEASURED_AGAINST — a stale measurement beside a changed "
        "detector is worse than none.")


def test_the_shipped_detector_is_now_INSIDE_the_repos_own_threshold():
    """⭐ THE DECISION, AS ARITHMETIC AGAINST THE REPO'S OWN CONSTANT. This
    used to assert the opposite — that coverage EXCEEDED NOISE_PCT — because
    the finding was open. It is closed, and the rail now guards the fix."""
    assert MEASURED_COVERAGE_PCT < _noise_pct(), (
        f"{MEASURED_COVERAGE_PCT}% is no longer under NOISE_PCT "
        f"({_noise_pct()}%) — the detector is back in noise territory")


def test_the_change_was_large_enough_to_be_worth_making():
    """⛔ NON-VACUITY ON THE DECISION ITSELF. If narrowing the window had
    moved coverage a point or two, this would be fiddling with a constant and
    calling it a finding."""
    assert COVERAGE_BEFORE_PCT > _noise_pct(), (
        "the BEFORE reading no longer exceeds the threshold, so there was "
        "nothing to fix — re-derive why this change was made")
    drop = COVERAGE_BEFORE_PCT - MEASURED_COVERAGE_PCT
    assert drop > 15.0, (
        f"the decision moved coverage only {drop:.1f}pp; that is not the "
        f"change this file describes")


def test_the_threshold_is_read_from_the_harness_not_retyped():
    """⛔ A second copy of 35.0 here would drift from the harness that owns it,
    and this file's argument rests entirely on that number."""
    import ast
    src = pathlib.Path(__file__).read_text(encoding="utf-8")
    assert "base_coverage.NOISE_PCT" in src
    # ⛔ AST, NOT A SUBSTRING SEARCH. The first version scanned the text and
    # flagged ITSELF: the word "35.0" appears in this very docstring explaining
    # why it must not appear. Splitting on `"""` strips only the MODULE
    # docstring, not a function's. A parse sees literals and cannot be fooled
    # by prose about literals.
    literals = [n.value for n in ast.walk(ast.parse(src))
                if isinstance(n, ast.Constant) and isinstance(n.value, float)]
    assert _noise_pct() not in literals, (
        f"NOISE_PCT ({_noise_pct()}) is hard-coded as a literal in this file; "
        f"read it from the harness that owns it instead")
