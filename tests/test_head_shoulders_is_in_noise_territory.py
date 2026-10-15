"""`head_shoulders` was in noise territory. The recency window was narrowed.

⛔ THE THRESHOLD IS NOT MINE. `tools/base_coverage.py` sets `NOISE_PCT = 35.0`
and describes it as "the measured NR4 deletion threshold" — the level at which
`Compression Bar (NR4)` was judged to carry no information and was REMOVED.
`head_shoulders` sat above it and `classify()` returned "noise" on the shipped
detector. This file follows `tests/test_double_bottom_is_in_noise_territory.py`
(2026-09-01) exactly: sweep, choose the knob that keeps the pattern's meaning,
pin the measurement and the decision.

⭐ MEASURED 2026-10-15, one knob at a time with the others at their shipped
values, THROUGH `base_coverage.coverage()` — the harness that owns both the
definition and the threshold. The panel is wider than the 2026-09-01
precedent's single reading, because one as-of date turned out to be mostly a
reading of the MARKET: 650 liquid tickers (close >= $5, 20-day dollar volume
>= $5M, >= 200 daily bars, seeded sample) at each of NINE as-of dates —
2024-03-15, 2024-07-15, 2024-11-15, 2025-03-14, 2025-07-15, 2025-11-14,
2026-03-13, 2026-07-14, 2026-09-24 — 5,850 ticker-days, each read the way
production reads it (`_scan_patterns_daily`: last 200 daily bars, then
`build_context`, then the detector). Pooled coverage:

    _MAX_RIGHT_SHOULDER_AGE 30 -> 41.0%   20 -> 34.2%   15 -> 29.8%   12 -> 24.9%   10 -> 21.9%   5 -> 9.7%
    _MAX_SHOULDER_ASYMMETRY 0.15 -> 41.0% 0.10 -> 36.8% 0.05 -> 29.4% 0.03 -> 24.0%
    _MAX_NECKLINE_SLOPE_PCT 0.005 -> 41.0% 0.003 -> 34.9% 0.002 -> 28.7% 0.001 -> 19.2%
    _MIN_PEAK_SPACING        5 -> 41.0%    8 -> 37.1%   12 -> 31.7%   15 -> 27.0%
    _CONFIDENCE_FLOOR       50 -> 41.0%   55 -> 31.5%   60 -> 20.9%   65 -> 11.4%

    per date, shipped 30: 44.3 56.8 43.8 28.5 41.7 40.0 31.4 41.5 40.8
    per date, decided 12: 26.9 35.7 26.0 17.7 25.4 19.4 22.9 23.7 26.6

⚠️ CALIBRATION AGAINST THE PRECEDENT, RECORDED RATHER THAN SMOOTHED OVER. On
this panel the shipped `double_bottom` (window 10) reads 29.0% pooled and its
old window 30 reads ~49%, against the precedent's 26.0% / 45.8% on its own
650 tickers. Same direction, same size of drop, ~3pp higher level — this
panel's liquid-only universe and its nine regimes, not a different detector.
Single dates swing widely (the shipped value of this detector spans
28.5%-56.8% across the nine dates), which is why the decision is taken on the
pooled number and not on any one day.

⛔ NONE OF THESE CONSTANTS IS SOURCED OR EXPLAINED in the detector or the
specs; every comment restated the value. An unsourced threshold is OURS and
belongs swept rather than chosen — which is what the table is.

⭐⭐ THE DECISION, TAKEN 2026-10-15: `_MAX_RIGHT_SHOULDER_AGE = 12` (was 30), moving
pooled coverage 41.0% -> 24.9% and the verdict from "noise" to "ok".
The recency window is the knob that reaches the band without
redefining the pattern — the geometry knobs get there only with shoulders
within 5% of the head, a near-flat neckline, or 15+ bars per side, and the
confidence floor re-weights an uncalibrated score (and costs expert recall:
see below). 15 bars was measured and is not CLEARLY inside (29.8% pooled,
44.6% on 2024-07-15). 12 rather than the double patterns' 10: this is a
longer three-pivot structure (30-100 bar window against 20-80), 12 is already
clearly inside, and 12 is the smaller change. On meaning: a right shoulder 30
bars old is a top that finished six weeks ago without breaking or resolving.

⭐ RECALL AGAINST EXPERT-LABELLED CALLS (aggregate counts only — the source is
a private ledger and nothing from it is in this repo). Calls whose setup text
names this pattern, caught when the detector fires on the call session or the
session before: 19 H&S calls. Window 30 caught 5; 20, 15, 12 and 10
each catch 4. For comparison the geometry routes: asymmetry 0.05 -> 4, neckline
slope 0.002 -> 1, confidence floor 60 -> 1. ⚠️ The detector misses most
expert H&S calls under ANY setting — recall is low before and after, and that
is a separate finding, not something this window caused.

⚠️ IT IS MEMBER-VISIBLE AND THE COST IS STATED: roughly 40% of this
detector's output leaves `pattern_detections`, which Compass reads through
`find_patterns_on_ticker` and `scan_active_patterns` — the part whose
right shoulder had already aged out.

This rail pins the measurement and the decision, fails if a swept knob moves
in EITHER direction, and proves the window is live (a positive fixture padded
past the window stops firing; the same padding under the old window does not).
"""

import sys, pathlib, re
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "api/services/pattern_engine/detectors/classical/head_shoulders.py"

#: The shipped values this file's measurement was taken against. If one moves,
#: the table above describes a detector that no longer exists.
MEASURED_AGAINST = {
    "_MAX_RIGHT_SHOULDER_AGE": 12,
    "_MAX_SHOULDER_ASYMMETRY": 0.15,
    "_MAX_NECKLINE_SLOPE_PCT": 0.005,
    "_MIN_PEAK_SPACING": 5,
    "_CONFIDENCE_FLOOR": 50.0,
}

#: The knob the decision moved, and what it was before.
DECIDED_KNOB = "_MAX_RIGHT_SHOULDER_AGE"
OLD_VALUE = 30

#: Pooled coverage AT THE SHIPPED VALUES after the decision, 5,850 ticker-days.
MEASURED_COVERAGE_PCT = 24.9

#: What it read before the window was narrowed, same panel. Kept so the
#: decision's SIZE stays legible.
COVERAGE_BEFORE_PCT = 41.0


def _noise_pct():
    """`tools/base_coverage.NOISE_PCT`, read rather than retyped."""
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
    """⭐ THE TABLE IN THE DOCSTRING IS ONLY TRUE OF THESE VALUES."""
    got = _constants()
    drifted = {k: (MEASURED_AGAINST[k], got[k])
               for k in MEASURED_AGAINST if got[k] != MEASURED_AGAINST[k]}
    assert not drifted, (
        "these knobs changed since the coverage above was measured "
        f"{drifted!r}. RE-MEASURE before trusting {MEASURED_COVERAGE_PCT}%, "
        "and update both the table and MEASURED_AGAINST.")


def test_the_module_reads_the_same_value_the_rail_pins():
    """⛔ The regex reads TEXT; a later reassignment or an import-time
    override would make the text and the running detector disagree."""
    import importlib
    mod = importlib.import_module(
        "api.services.pattern_engine.detectors.classical.head_shoulders")
    assert getattr(mod, DECIDED_KNOB) == MEASURED_AGAINST[DECIDED_KNOB]


def test_the_shipped_detector_is_now_INSIDE_the_repos_own_threshold():
    """⭐ THE DECISION, AS ARITHMETIC AGAINST THE REPO'S OWN CONSTANT."""
    assert MEASURED_COVERAGE_PCT < _noise_pct(), (
        f"{MEASURED_COVERAGE_PCT}% is no longer under NOISE_PCT "
        f"({_noise_pct()}%) — the detector is back in noise territory")


def test_the_change_was_large_enough_to_be_worth_making():
    """⛔ NON-VACUITY ON THE DECISION ITSELF."""
    assert COVERAGE_BEFORE_PCT > _noise_pct(), (
        "the BEFORE reading no longer exceeds the threshold, so there was "
        "nothing to fix — re-derive why this change was made")
    drop = COVERAGE_BEFORE_PCT - MEASURED_COVERAGE_PCT
    assert drop > 15.0, (
        f"the decision moved coverage only {drop:.1f}pp; that is not the "
        f"change this file describes")


def _padded_fires(pad, window):
    """Run the detector on its own clean_textbook fixture with `pad` copies of
    the last bar appended (price parked, pattern unbroken), under `window`."""
    import importlib
    from api.services.pattern_engine.primitives.context import build_context
    from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures
    mod = importlib.import_module(
        "api.services.pattern_engine.detectors.classical.head_shoulders")
    fx = [f for f in load_all_fixtures("head_shoulders", include_internal=False)
          if f.name == "clean_textbook"]
    assert fx, "clean_textbook fixture is missing — this probe has no subject"
    bars = list(fx[0].bars)
    step = bars[-1]["t"] - bars[-2]["t"]
    last = bars[-1]
    bars = bars + [dict(last, t=last["t"] + (i + 1) * step) for i in range(pad)]
    saved = getattr(mod, DECIDED_KNOB)
    setattr(mod, DECIDED_KNOB, window)
    try:
        return bool(mod.detect_head_shoulders(bars, build_context(bars, sym="TEST")))
    finally:
        setattr(mod, DECIDED_KNOB, saved)


def _anchor_age():
    """Bars between the fixture's right shoulder and its last bar, unpadded."""
    from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures
    import importlib
    from api.services.pattern_engine.primitives.context import build_context
    mod = importlib.import_module(
        "api.services.pattern_engine.detectors.classical.head_shoulders")
    fx = [f for f in load_all_fixtures("head_shoulders", include_internal=False)
          if f.name == "clean_textbook"][0]
    d = mod.detect_head_shoulders(fx.bars, build_context(fx.bars, sym="TEST"))
    assert d, "clean_textbook no longer fires — the probe below is vacuous"
    anchor_t = d[0]["pivot_ts"][2]
    ts = [b["t"] for b in fx.bars]
    return len(ts) - 1 - ts.index(anchor_t)


def test_the_window_is_live_on_the_detector_not_just_in_the_text():
    """⭐ BEHAVIOUR, NOT A STRING. Padded to exactly the window the pattern
    still fires; one bar past it, it does not; and the SAME one-past padding
    under the old window still fires — so it is the window that stopped it,
    not the padding."""
    new = MEASURED_AGAINST[DECIDED_KNOB]
    age = _anchor_age()
    assert age < new, f"fixture right shoulder already {age} bars old"
    at_edge = new - age
    assert _padded_fires(at_edge, new), "should still fire AT the window edge"
    assert not _padded_fires(at_edge + 1, new), (
        "fires one bar past the window — the recency gate is not live")
    assert _padded_fires(at_edge + 1, OLD_VALUE), (
        "the old window ALSO refuses this padding, so the probe cannot tell "
        "the two windows apart")


def test_the_threshold_is_read_from_the_harness_not_retyped():
    """⛔ A second copy of the threshold here would drift from the harness."""
    import ast
    src = pathlib.Path(__file__).read_text(encoding="utf-8")
    assert "base_coverage.NOISE_PCT" in src
    literals = [n.value for n in ast.walk(ast.parse(src))
                if isinstance(n, ast.Constant) and isinstance(n.value, float)]
    assert _noise_pct() not in literals, (
        f"NOISE_PCT ({_noise_pct()}) is hard-coded as a literal in this file; "
        f"read it from the harness that owns it instead")
