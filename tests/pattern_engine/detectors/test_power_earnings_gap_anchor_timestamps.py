"""Package: PEG canonical geometry correctness (2026-09-06).

Proves and pins the correct semantics for power_earnings_gap.py's
`post_gap_high`/`post_gap_low` geometry anchors (anchors[3]/[4]): each
anchor's timestamp must be the REAL bar where that extreme occurred, not
always the most recent bar in the detection window.

Independent oracle: `_find_extreme_bar` below re-derives which bar carries
an extreme value by scanning the post-gap window itself (mirroring
`_try_extract`'s own first-match tie-break for `post_gap_low_idx`) --
never by importing anything from the detector's own anchor-construction
code, so this test cannot pass for the wrong reason.
"""
import json
import os

from api.services.pattern_engine.detectors.uct.power_earnings_gap import (
    detect_power_earnings_gap,
    _MIN_GAP_PCT,
)
from api.services.pattern_engine.primitives.context import build_context

_FIXTURE_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "fixtures", "power_earnings_gap",
    "_anchor_timestamp_repro.json",
)


def _load_repro_fixture():
    with open(_FIXTURE_PATH, encoding="utf-8") as f:
        data = json.load(f)
    return data["bars"], data["context"]


def _find_gap_idx(bars):
    """Independent re-derivation of the gap bar's index -- the first bar
    whose open gaps up >= _MIN_GAP_PCT over the prior bar's close."""
    for i in range(1, len(bars)):
        prior_close = bars[i - 1]["c"]
        if prior_close <= 0:
            continue
        if (bars[i]["o"] - prior_close) / prior_close >= _MIN_GAP_PCT:
            return i
    raise AssertionError("no gap bar found in fixture -- fixture is broken")


def _find_extreme_bar_idx(bars, gap_idx, key, want_max):
    """First bar (scanning forward from gap_idx+1) carrying the window's
    max/min of `key` ('h' or 'l') -- mirrors _try_extract's own
    first-match tie-break for post_gap_low_idx, independently re-derived
    here rather than imported."""
    window = bars[gap_idx + 1:]
    values = [b[key] for b in window]
    target = max(values) if want_max else min(values)
    for offset, b in enumerate(window):
        if b[key] == target:
            return gap_idx + 1 + offset
    raise AssertionError("unreachable")


def test_post_gap_high_anchor_points_to_the_bar_where_the_high_actually_occurred():
    bars, ctx_dict = _load_repro_fixture()
    ctx = ctx_dict if ctx_dict is not None else build_context(bars, sym="TEST")
    detections = detect_power_earnings_gap(bars, ctx)
    assert detections, "repro fixture must fire -- fixture is broken if it doesn't"
    d = detections[0]

    gap_idx = _find_gap_idx(bars)
    expected_idx = _find_extreme_bar_idx(bars, gap_idx, "h", want_max=True)
    expected_t = int(bars[expected_idx]["t"])

    # Sanity: this fixture is only useful as a regression rail if the real
    # extreme is NOT on the last bar -- otherwise the bug is invisible.
    assert expected_idx != len(bars) - 1, (
        "fixture no longer demonstrates the bug -- the post-gap high moved "
        "back onto the last bar; the fixture needs regenerating"
    )

    anchors = d["geometry"]["anchors"]
    post_gap_high_anchor = anchors[3]
    assert post_gap_high_anchor["price"] == bars[expected_idx]["h"]
    assert post_gap_high_anchor["t"] == expected_t, (
        f"post_gap_high anchor stamped t={post_gap_high_anchor['t']} "
        f"(bar {[b['t'] for b in bars].index(post_gap_high_anchor['t'])}), "
        f"but the real high occurred on bar {expected_idx} (t={expected_t})"
    )


def test_post_gap_low_anchor_points_to_the_bar_where_the_low_actually_occurred():
    bars, ctx_dict = _load_repro_fixture()
    ctx = ctx_dict if ctx_dict is not None else build_context(bars, sym="TEST")
    detections = detect_power_earnings_gap(bars, ctx)
    assert detections
    d = detections[0]

    gap_idx = _find_gap_idx(bars)
    expected_idx = _find_extreme_bar_idx(bars, gap_idx, "l", want_max=False)
    expected_t = int(bars[expected_idx]["t"])

    assert expected_idx != len(bars) - 1, (
        "fixture no longer demonstrates the bug -- the post-gap low moved "
        "back onto the last bar; the fixture needs regenerating"
    )

    anchors = d["geometry"]["anchors"]
    post_gap_low_anchor = anchors[4]
    assert post_gap_low_anchor["price"] == bars[expected_idx]["l"]
    assert post_gap_low_anchor["t"] == expected_t, (
        f"post_gap_low anchor stamped t={post_gap_low_anchor['t']}, "
        f"but the real low occurred on bar {expected_idx} (t={expected_t})"
    )


def test_gap_candle_anchors_are_unaffected_by_the_post_gap_anchor_fix():
    """anchors[1]/[2] (gap_open/gap_close) are what CandleMark's white-
    outline gap-candle emphasis (Package 8D, semantic_subtype='gap_event')
    actually keys off -- confirms this fix does not touch, and could not
    have broken, that separate, already-correct mapping."""
    bars, ctx_dict = _load_repro_fixture()
    ctx = ctx_dict if ctx_dict is not None else build_context(bars, sym="TEST")
    detections = detect_power_earnings_gap(bars, ctx)
    assert detections
    d = detections[0]

    gap_idx = _find_gap_idx(bars)
    gap_bar_t = int(bars[gap_idx]["t"])

    anchors = d["geometry"]["anchors"]
    assert anchors[1]["t"] == gap_bar_t, "gap_open anchor must stay on the gap bar"
    assert anchors[2]["t"] == gap_bar_t, "gap_close anchor must stay on the gap bar"
    assert anchors[1]["price"] == bars[gap_idx]["o"]
    assert anchors[2]["price"] == bars[gap_idx]["c"]


def test_post_gap_anchors_still_correct_when_the_extreme_coincidentally_is_the_last_bar():
    """Regression guard for the OTHER case (the existing committed fixture
    battery's shape, where the real extreme happens to sit on the last
    bar): the fix must not break that coincidental case either."""
    from tests.pattern_engine.detectors.fixture_loader import load_fixture

    fixture = load_fixture("power_earnings_gap", "clean_textbook.json")
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_power_earnings_gap(fixture.bars, ctx)
    assert detections
    d = detections[0]

    gap_idx = _find_gap_idx(fixture.bars)
    expected_high_idx = _find_extreme_bar_idx(fixture.bars, gap_idx, "h", want_max=True)
    expected_low_idx = _find_extreme_bar_idx(fixture.bars, gap_idx, "l", want_max=False)

    anchors = d["geometry"]["anchors"]
    assert anchors[3]["t"] == int(fixture.bars[expected_high_idx]["t"])
    assert anchors[4]["t"] == int(fixture.bars[expected_low_idx]["t"])


def test_fixed_anchors_survive_a_real_sqlite_round_trip():
    """The fix lives entirely in the detector's own anchor construction --
    confirm it actually reaches a served Detection through the real
    persistence path (geometry_json = json.dumps/json.loads, no lossy
    transform), not just in the in-memory object the detector returns."""
    from api.services.pattern_engine import memory
    from api.services.pattern_engine.pattern_db import init_db

    init_db()
    bars, ctx_dict = _load_repro_fixture()
    ctx = ctx_dict if ctx_dict is not None else build_context(bars, sym="TEST")
    detections = detect_power_earnings_gap(bars, ctx)
    assert detections
    d = dict(detections[0])
    d["id"] = "test-peg-anchor-roundtrip-1"
    d["sym"] = "TEST"
    d["tf"] = "D"

    memory.store_detection(d)
    stored = memory.get_detection_by_id("test-peg-anchor-roundtrip-1")
    assert stored is not None

    gap_idx = _find_gap_idx(bars)
    expected_high_idx = _find_extreme_bar_idx(bars, gap_idx, "h", want_max=True)
    expected_low_idx = _find_extreme_bar_idx(bars, gap_idx, "l", want_max=False)

    stored_anchors = stored["geometry"]["anchors"]
    assert stored_anchors[3]["t"] == int(bars[expected_high_idx]["t"])
    assert stored_anchors[4]["t"] == int(bars[expected_low_idx]["t"])
    # And the in-memory and round-tripped anchors are byte-identical --
    # confirms geometry_json's json.dumps/json.loads is a true no-op here.
    assert stored_anchors == d["geometry"]["anchors"]
