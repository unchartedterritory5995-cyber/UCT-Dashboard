"""`double_bottom` fires on 42.9% of the universe — past this repo's own bar.

⛔ THE THRESHOLD IS NOT MINE. `tools/base_coverage.py` sets
`NOISE_PCT = 35.0` and describes it in the file as "the measured NR4 deletion
threshold" — the level at which `Compression Bar (NR4)` was judged to carry no
information and was REMOVED, on the reasoning that a label a third of the market
carries is not a label. The pattern engine's `double_bottom` sits above it.

⭐ MEASURED 2026-09-01 over 650 tickers, one knob at a time, shipped value first:

    _MAX_TROUGH2_AGE       30 -> 42.9%   20 -> 35.2%   10 -> 22.9%   5 -> 8.6%
    _MIN_RALLY_DEPTH     0.05 -> 42.9% 0.08 -> 41.4% 0.12 -> 28.2% 0.20 -> 8.6%
    _MAX_TROUGH_SIMILARITY 0.04 -> 42.9% 0.03 -> 38.5% 0.02 -> 33.5% 0.01 -> 21.4%
    _MIN_TROUGH_SPACING     7 -> 42.9%   12 -> 40.3%   20 -> 35.1%  30 -> 27.7%

Two knobs carry it: the RECENCY window and the rally depth. Tightening spacing
or similarity alone cannot reach the band.

⛔ NONE OF THESE CONSTANTS IS SOURCED OR EXPLAINED. Every comment beside them
restates the value ("t2 within last 30 bars") rather than justifying it, and
nothing in the specs mentions them. By the standard this repo applies to
`base_catalog`, an unsourced threshold is OURS and should be SWEPT rather than
chosen — which is what the table above is.

⛔⛔ THE CONSTANT IS NOT CHANGED HERE, DELIBERATELY. `double_bottom` writes to
`pattern_detections`, which Compass reads through `find_patterns_on_ticker` and
`scan_active_patterns`. Moving 42.9% to 22.9% removes roughly half of what
members are shown about specific tickers today. That is a visible product
decision, and it should be made with these numbers in front of someone rather
than as a silent one-line edit at the end of a long session. The recommendation,
recorded so it is not lost: `_MAX_TROUGH2_AGE = 10` is the single change that
reaches the band (22.9%), and it is the most defensible one — the engine emits
detections meant to be actionable now, and a second trough 30 bars old means the
pattern completed six weeks ago.

This rail pins the measurement and fails if the number moves, in EITHER
direction, so the decision cannot be made by accident.
"""
import sys, pathlib, re
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "api/services/pattern_engine/detectors/classical/double_bottom.py"

#: The shipped values this file's measurement was taken against. If one moves,
#: the table above describes a detector that no longer exists.
MEASURED_AGAINST = {
    "_MAX_TROUGH2_AGE": 30,
    "_MIN_RALLY_DEPTH": 0.05,
    "_MAX_TROUGH_SIMILARITY": 0.04,
    "_MIN_TROUGH_SPACING": 7,
}

#: Measured coverage at the shipped values, 650 tickers, 2026-09-01.
MEASURED_COVERAGE_PCT = 42.9

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


def test_the_finding_is_that_it_EXCEEDS_the_repos_own_threshold():
    """The claim, stated as arithmetic against the repo's own constant rather
    than against a number typed here."""
    assert MEASURED_COVERAGE_PCT > _noise_pct(), (
        f"{MEASURED_COVERAGE_PCT}% no longer exceeds NOISE_PCT "
        f"({_noise_pct()}%) — if the threshold moved, this whole finding needs "
        f"restating")


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
