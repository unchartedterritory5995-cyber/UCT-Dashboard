"""golden_cross, death_cross, pullback_to_50sma and pullback_to_200sma must be
REACHABLE from the daily scan.

The daily scan (`api.main._scan_patterns_daily`) hands every detector exactly
`SCAN_BASE_DEPTH` (200) trailing bars unless the detector declared a larger
`min_bars` at registration. Each of these four has its own length gate above
200 (210 / 210 / 210 / 270) and declared nothing, so in production it returned
[] on every symbol, every night, and its battery fixtures (which hand it the
whole fixture) stayed green the whole time.

These tests run each detector the way the scan runs it -- `detect_all(...,
base_depth=SCAN_BASE_DEPTH)` -- and assert that the 200-bar slice the scan used
to hand it can never fire, and that the scan path now reproduces the battery's
verdict on every fixture.
"""
import pytest

from api.services.pattern_engine import detect_all
from api.services.pattern_engine.detectors import registry
from api.services.pattern_engine.detectors.classical import death_cross as DC
from api.services.pattern_engine.detectors.classical import golden_cross as GC
from api.services.pattern_engine.detectors.uct import pullback_to_200sma as P200
from api.services.pattern_engine.detectors.uct import pullback_to_50sma as P50
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


BASE = registry.SCAN_BASE_DEPTH

MODS = {
    "golden_cross": (GC, GC.detect_golden_cross),
    "death_cross": (DC, DC.detect_death_cross),
    "pullback_to_50sma": (P50, P50.detect_pullback_to_50sma),
    "pullback_to_200sma": (P200, P200.detect_pullback_to_200sma),
}

CASES = [
    (pid, f)
    for pid in MODS
    for f in load_all_fixtures(pid, include_internal=False)
]


def _scan_fires(pid, fixture):
    """The detector's verdict as the daily scan reaches it."""
    dets = detect_all(fixture.bars, fixture.context, pattern_ids=[pid], base_depth=BASE)
    return any(d.get("pattern_id") == pid for d in dets)


def _strip(dets, n):
    """Drop per-call identity/wall-clock fields, and re-express every
    positional `*_idx` (an index INTO the slice the detector was handed) as a
    distance from the slice's last bar, so the same bar compares equal
    whichever slice it was found in."""
    def norm(o):
        if isinstance(o, dict):
            return {k: (n - 1 - v if k.endswith("_idx") and isinstance(v, int) else norm(v))
                    for k, v in o.items()
                    if k not in ("id", "created_at", "updated_at", "detected_at", "last_seen_at")}
        if isinstance(o, list):
            return [norm(x) for x in o]
        return o
    return [norm(d) for d in dets]


def test_declared_minimums_are_the_detectors_real_needs():
    assert BASE == 200
    # golden/death: a cross up to 4 bars old needs 199 + 20 + 5 = 224 bars for
    # its 20-bar slope start; the target's 52-week extreme needs 253.
    assert GC.MIN_BARS == DC.MIN_BARS == 253
    assert GC._MA200_PERIOD - 1 + GC._SLOPE_BARS + GC._MAX_CROSS_AGE == 224
    # pullbacks: exactly their own length gates.
    assert P50.MIN_BARS == 210
    assert P200.MIN_BARS == 270
    for pid, (mod, _fn) in MODS.items():
        assert registry.min_bars_for(pid) == mod.MIN_BARS > BASE, pid


def test_scan_fetch_depth_covers_the_deepest_declaration():
    assert registry.scan_depth(BASE) >= P200.MIN_BARS
    bars = [{"t": i} for i in range(400)]
    for pid, (mod, _fn) in MODS.items():
        assert registry.bars_for(pid, bars, BASE) == bars[-mod.MIN_BARS:], pid


@pytest.mark.parametrize("pid,fixture", CASES, ids=lambda x: getattr(x, "name", x))
def test_the_old_200_bar_slice_never_fires(pid, fixture):
    """Before the declaration, this is all the scan handed the detector."""
    _mod, fn = MODS[pid]
    assert fn(fixture.bars[-BASE:], fixture.context) == []


@pytest.mark.parametrize("pid,fixture", CASES, ids=lambda x: getattr(x, "name", x))
def test_scan_path_reproduces_the_battery_verdict(pid, fixture):
    assert _scan_fires(pid, fixture) is bool(fixture.expected_fires), (
        f"{pid}/{fixture.name}: the scan path disagrees with the fixture battery"
    )


def test_each_detector_fires_in_the_scan_path():
    for pid in MODS:
        fired = [f.name for p, f in CASES if p == pid and _scan_fires(pid, f)]
        assert fired, f"{pid} still never fires when reached through the scan"


@pytest.mark.parametrize("pid,fixture",
                         [(p, f) for p, f in CASES if f.expected_fires and len(f.bars) >= MODS[p][0].MIN_BARS],
                         ids=lambda x: getattr(x, "name", x))
def test_declared_minimum_is_sufficient(pid, fixture):
    """MIN_BARS trailing bars give the same detection as the whole history:
    nothing the detector reads lies further back than its declaration."""
    mod, fn = MODS[pid]
    tail = fixture.bars[-mod.MIN_BARS:]
    from_tail = _strip(fn(tail, fixture.context), len(tail))
    from_all = _strip(fn(fixture.bars, fixture.context), len(fixture.bars))
    assert from_tail, "the fixture must fire for this comparison to mean anything"
    assert from_tail == from_all
