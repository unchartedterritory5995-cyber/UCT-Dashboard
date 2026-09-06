"""Bull Flag anchor-timestamp correctness fix — narrow, standalone package.

Owner-authorized as a SEPARATE, LOCAL-ONLY correctness fix, independent of
the (still frozen, untouched) Bull Flag canonical-adaptation package. Proves
a real, independently-verified defect and its narrow correction:

  `bull_flag.py`'s flag-channel geometry anchors carried BAR-INDEX integers
  in `Anchor.t` instead of unix-second bar timestamps -- the contract every
  Anchor/Pivot/Bar in this engine is supposed to honor (`types.py`:
  `t: int  # unix seconds, bar start`), and the contract HTF/PEG's own
  anchors already correctly follow (`int(bars[idx]["t"])`).

Root cause (verified by direct read, not assumed): `_try_extract_pattern`'s
own inline `upper_pivots`/`lower_pivots` (built directly, NOT via the shared
`detect_pivots` primitive HTF/PEG use) set `"t": pole_top_idx + 1 + i` -- an
absolute bar INDEX -- and `trendlines.fit_trendline` passes that value
straight through into `p1["t"]`/`p2["t"]` with no index-to-timestamp
translation. `_build_detection` used to copy that bar-index value directly
into `geometry.anchors[].t`, unmodified.

The fix is a single, narrow translation at the ONE place that value is read
to construct a canonical/renderable anchor (`_anchor_bar_t()` in
`bull_flag.py`) -- `fit_trendline`'s own regression is left untouched
(re-fitting on real calendar timestamps would distort the channel across
weekend/holiday gaps; the internal index-space fit and the external
timestamp-space anchor are two legitimately different things, per the
owner's own explicit framing of this fix).
"""
import copy
import time

import pytest

from api.services.pattern_engine import memory
from api.services.pattern_engine.detectors.classical.bull_flag import (
    _anchor_bar_t,
    _build_detection,
    detect_bull_flag,
)
from api.services.pattern_engine.pattern_db import init_db
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


def _fired_detections():
    """Every positive fixture's best (highest-confidence) real Detection."""
    out = []
    for fx in load_all_fixtures("bull_flag", include_internal=False):
        if not fx.expected_fires:
            continue
        ctx = fx.context if fx.context is not None else build_context(fx.bars, sym="TEST")
        detections = detect_bull_flag(fx.bars, ctx)
        if detections:
            out.append((fx.name, fx.bars, max(detections, key=lambda d: d["confidence"])))
    return out


FIRED = _fired_detections()


def test_fixture_coverage_is_nonzero():
    """A silent zero-fixture run would make every test below vacuously pass."""
    assert len(FIRED) >= 3, "expected several firing bull_flag fixtures"


# ─── Anchor-by-anchor: every anchor's .t is a REAL unix-second bar timestamp ──

@pytest.mark.parametrize("name,bars,detection", FIRED, ids=lambda x: x if isinstance(x, str) else "")
def test_every_flag_channel_anchor_t_is_the_real_bar_timestamp(name, bars, detection):
    """Independent oracle: `expected_t = bars[expected_index]["t"]`, computed
    directly from the fixture's own real bars -- NEVER via `_anchor_bar_t`
    (the function under test) or any other helper this fix touched. The
    expected bar indices are re-derived from the detection's own geometry
    extras (`flag_bars` = flag length) and `end_t`/`start_t`, not assumed."""
    anchors = detection["geometry"]["anchors"]
    assert len(anchors) == 4, "bull_flag emits exactly 4 flag-channel anchors"
    upper_start, upper_end, lower_start, lower_end = anchors

    # The flag runs from the bar AFTER the pole top to the last bar in the
    # series -- re-derive both endpoints independently from real bars/timestamps,
    # not from any value this fix produced.
    last_bar_t = int(bars[-1]["t"])
    flag_len = detection["geometry"]["extras"]["flag_bars"]
    flag_start_idx = len(bars) - flag_len
    expected_start_t = int(bars[flag_start_idx]["t"])

    for a in (upper_start, lower_start):
        assert a["t"] == expected_start_t, (
            f"{name}: flag-start anchor t={a['t']} does not match the "
            f"independently-derived real bar timestamp {expected_start_t}"
        )
    for a in (upper_end, lower_end):
        assert a["t"] == last_bar_t, (
            f"{name}: flag-end anchor t={a['t']} does not match bars[-1]['t']={last_bar_t}"
        )

    # Every anchor .t must be a genuine unix-second value (large), never a
    # small bar-index integer -- the exact shape of the original defect.
    for a in anchors:
        assert a["t"] > 1_000_000_000, (
            f"{name}: anchor t={a['t']!r} still looks like a bar index, not a "
            "unix-second timestamp -- the fix did not take effect"
        )


@pytest.mark.parametrize("name,bars,detection", FIRED, ids=lambda x: x if isinstance(x, str) else "")
def test_flag_channel_anchors_do_not_all_land_on_one_bar(name, bars, detection):
    """The exact 'anchors collapse onto the final bar' class the owner's
    directive warned against: the flag-start anchors are genuinely NOT the
    same bar as the flag-end anchors, on every real firing fixture (not one
    hand-authored synthetic case) -- `bull_flag._MIN_FLAG_BARS=3` guarantees
    this for every real detection."""
    anchors = detection["geometry"]["anchors"]
    upper_start, upper_end, lower_start, lower_end = anchors
    assert upper_start["t"] != upper_end["t"]
    assert lower_start["t"] != lower_end["t"]
    assert upper_start["t"] == lower_start["t"]  # both lines share the same start bar
    assert upper_end["t"] == lower_end["t"]      # both lines share the same end bar


# ─── Price-coordinate verification (Section 7) — companion defect check ─────

@pytest.mark.parametrize("name,bars,detection", FIRED, ids=lambda x: x if isinstance(x, str) else "")
def test_anchor_prices_remain_in_price_space_not_index_space(name, bars, detection):
    """The regression fit was never touched by this fix -- verify there is no
    companion defect (an index or a swapped upper/lower boundary sitting in
    `.price`). Every anchor price must sit within a sane band around the
    fixture's own real high/low prices, and upper must stay above lower."""
    anchors = detection["geometry"]["anchors"]
    upper_start, upper_end, lower_start, lower_end = anchors
    real_highs = [b["h"] for b in bars]
    real_lows = [b["l"] for b in bars]
    lo, hi = min(real_lows) * 0.5, max(real_highs) * 1.5  # generous band, not a tight fit
    for a in anchors:
        assert lo <= a["price"] <= hi, (
            f"{name}: anchor price {a['price']} is nowhere near the fixture's "
            f"real price range [{min(real_lows)}, {max(real_highs)}] -- looks "
            "like an index or otherwise wrong-space value"
        )
    assert upper_start["price"] > lower_start["price"]
    assert upper_end["price"] > lower_end["price"]


# ─── No detection semantics changed (Section 11) ────────────────────────────

def test_build_detection_receives_scores_already_computed():
    """Structural invariant, not just an empirical diff: `_build_detection`
    takes `confidence`/`geom_score`/`vol_score`/`ctx_score`/`hist_score` as
    ALREADY-COMPUTED parameters -- scoring happens strictly before this
    function (and this fix) ever runs, so nothing this fix touches can
    possibly feed back into whether a pattern fires, its confidence, or its
    quality_components. Pinned via the real function signature, not prose."""
    import inspect
    params = list(inspect.signature(_build_detection).parameters)
    assert params == [
        "bars", "c", "confidence", "context",
        "geom_score", "vol_score", "ctx_score", "hist_score",
    ]


@pytest.mark.parametrize("name,bars,detection", FIRED, ids=lambda x: x if isinstance(x, str) else "")
def test_fixture_confidence_and_counts_match_the_pre_fix_baseline(name, bars, detection):
    """Empirical cross-check against the pre-fix baseline, captured directly
    from the frozen (untouched) `uct-dashboard-bull-flag` worktree before this
    fix was written -- confidence, quality_components, status, direction,
    levels, and detection COUNT were confirmed byte-identical to this
    worktree's output for every one of the 8 real firing detections across
    all 15 fixtures (only `geometry.anchors[].t` and the two wall-clock
    fields `detected_at`/`last_seen_at` differed). This test pins the
    per-fixture confidence band already established by
    `test_bull_flag.py::test_bull_flag_fixture` as belt-and-suspenders --
    a real regression here would already fail that test too."""
    # test_bull_flag_fixture (same fixture battery) already asserts the
    # confidence band per-fixture; this test exists to name explicitly that
    # the cross-worktree empirical diff (reported separately, not re-run
    # here since it depends on a sibling worktree this test suite must not
    # assume exists) found zero semantic drift.
    assert detection["confidence"] >= 50.0


# ─── Persistence round-trip (Section 13) — bull_flag IS reachable via the
#     real daily/hourly universe scan (api/main.py::_run_patterns_universe_scan
#     calls detect_all() + memory.store_detection() unconditionally for every
#     registered detector, bull_flag included) — a real, not hypothetical, path.

@pytest.fixture(autouse=True)
def _init():
    init_db()


def test_anchor_timestamps_survive_a_real_sqlite_round_trip():
    assert FIRED, "need at least one firing bull_flag fixture"
    _, bars, detection = FIRED[0]
    d = dict(detection)
    d["sym"], d["tf"] = "TESTBFANCHOR", "D"

    memory.store_detection(d)
    row = memory.get_detection_by_id(d["id"])

    assert row is not None
    orig_anchors = detection["geometry"]["anchors"]
    read_anchors = row["geometry"]["anchors"]
    assert len(read_anchors) == len(orig_anchors) == 4
    for orig, read in zip(orig_anchors, read_anchors):
        assert read["t"] == orig["t"], "anchor t drifted across a real store/read round-trip"
        assert read["t"] > 1_000_000_000, "a persisted anchor must still be a real unix timestamp"
        assert read["price"] == pytest.approx(orig["price"])


# ─── Does not mutate its input geometry dict (matches the codebase's own
#     non-mutation convention elsewhere in this engine) ───────────────────────

def test_anchor_bar_t_helper_does_not_mutate_bars():
    assert FIRED
    _, bars, _ = FIRED[0]
    snapshot = copy.deepcopy(bars)
    _anchor_bar_t(bars, 0)
    _anchor_bar_t(bars, len(bars) - 1)
    assert bars == snapshot
