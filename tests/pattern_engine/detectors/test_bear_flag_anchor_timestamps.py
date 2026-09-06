"""Bear Flag anchor-timestamp correctness fix — narrow, standalone package.

Owner-authorized as a SEPARATE, LOCAL-ONLY correctness package (the second in
the same defect class as Bull Flag's own fix), independent of any Bear Flag
canonical adaptation (none exists yet) and independent of the frozen Bull
Flag anchor-timestamp fix and canonical packages. Proves a real,
independently re-verified (not assumed byte-for-byte-identical) defect and
its narrow correction:

  `bear_flag.py`'s flag-channel geometry anchors carried BAR-INDEX integers
  in `Anchor.t` instead of unix-second bar timestamps -- the same contract
  violation Bull Flag had (`types.py`: `t: int  # unix seconds, bar start`).

Root cause (re-verified by direct read of THIS file, not assumed from Bull
Flag's): `_try_extract_pattern`'s own inline `upper_pivots`/`lower_pivots`
(built directly, NOT via the shared `detect_pivots` primitive) set
`"t": pole_bottom_idx + 1 + i` -- an absolute bar INDEX -- and
`trendlines.fit_trendline` passes that value straight through into
`p1["t"]`/`p2["t"]` with no index-to-timestamp translation.
`_build_detection` used to copy that bar-index value directly into
`geometry.anchors[].t`, unmodified.

The fix mirrors Bull Flag's exactly: a single, narrow translation at the ONE
place that value is read to construct a canonical/renderable anchor
(`_anchor_bar_t()` in `bear_flag.py`) -- `fit_trendline`'s own regression is
left untouched.
"""
import copy

import pytest

from api.services.pattern_engine import memory
from api.services.pattern_engine.detectors.classical.bear_flag import (
    _anchor_bar_t,
    _build_detection,
    detect_bear_flag,
)
from api.services.pattern_engine.pattern_db import init_db
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


def _fired_detections():
    """Every positive fixture's best (highest-confidence) real Detection."""
    out = []
    for fx in load_all_fixtures("bear_flag", include_internal=False):
        if not fx.expected_fires:
            continue
        ctx = fx.context if fx.context is not None else build_context(fx.bars, sym="TEST")
        detections = detect_bear_flag(fx.bars, ctx)
        if detections:
            out.append((fx.name, fx.bars, max(detections, key=lambda d: d["confidence"])))
    return out


FIRED = _fired_detections()


def test_fixture_coverage_is_nonzero():
    """A silent zero-fixture run would make every test below vacuously pass."""
    assert len(FIRED) >= 3, "expected several firing bear_flag fixtures"


# ─── Anchor-by-anchor: every anchor's .t is a REAL unix-second bar timestamp ──

@pytest.mark.parametrize("name,bars,detection", FIRED, ids=lambda x: x if isinstance(x, str) else "")
def test_every_flag_channel_anchor_t_is_the_real_bar_timestamp(name, bars, detection):
    """Independent oracle: `expected_t = bars[expected_index]["t"]`, computed
    directly from the fixture's own real bars -- NEVER via `_anchor_bar_t`
    (the function under test) or any other helper this fix touched."""
    anchors = detection["geometry"]["anchors"]
    assert len(anchors) == 4, "bear_flag emits exactly 4 flag-channel anchors"
    upper_start, upper_end, lower_start, lower_end = anchors

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

    for a in anchors:
        assert a["t"] > 1_000_000_000, (
            f"{name}: anchor t={a['t']!r} still looks like a bar index, not a "
            "unix-second timestamp -- the fix did not take effect"
        )


@pytest.mark.parametrize("name,bars,detection", FIRED, ids=lambda x: x if isinstance(x, str) else "")
def test_flag_channel_anchors_do_not_all_land_on_one_bar(name, bars, detection):
    """The flag-start anchors are genuinely NOT the same bar as the flag-end
    anchors, on every real firing fixture -- `bear_flag._MIN_FLAG_BARS=3`
    guarantees this for every real detection."""
    anchors = detection["geometry"]["anchors"]
    upper_start, upper_end, lower_start, lower_end = anchors
    assert upper_start["t"] != upper_end["t"]
    assert lower_start["t"] != lower_end["t"]
    assert upper_start["t"] == lower_start["t"]
    assert upper_end["t"] == lower_end["t"]


# ─── Price-coordinate verification — companion defect check ────────────────

@pytest.mark.parametrize("name,bars,detection", FIRED, ids=lambda x: x if isinstance(x, str) else "")
def test_anchor_prices_remain_in_price_space_not_index_space(name, bars, detection):
    """The regression fit was never touched by this fix -- verify there is no
    companion defect (an index or a swapped upper/lower boundary sitting in
    `.price`)."""
    anchors = detection["geometry"]["anchors"]
    upper_start, upper_end, lower_start, lower_end = anchors
    real_highs = [b["h"] for b in bars]
    real_lows = [b["l"] for b in bars]
    lo, hi = min(real_lows) * 0.5, max(real_highs) * 1.5
    for a in anchors:
        assert lo <= a["price"] <= hi, (
            f"{name}: anchor price {a['price']} is nowhere near the fixture's "
            f"real price range [{min(real_lows)}, {max(real_highs)}] -- looks "
            "like an index or otherwise wrong-space value"
        )
    assert upper_start["price"] > lower_start["price"]
    assert upper_end["price"] > lower_end["price"]


# ─── No detection semantics changed ─────────────────────────────────────────

def test_build_detection_receives_scores_already_computed():
    """Structural invariant: `_build_detection` takes
    `confidence`/`geom_score`/`vol_score`/`ctx_score`/`hist_score` as
    ALREADY-COMPUTED parameters -- scoring happens strictly before this
    function (and this fix) ever runs."""
    import inspect
    params = list(inspect.signature(_build_detection).parameters)
    assert params == [
        "bars", "c", "confidence", "context",
        "geom_score", "vol_score", "ctx_score", "hist_score",
    ]


# ─── Persistence round-trip — bear_flag IS reachable via the real daily/
#     hourly universe scan the same way bull_flag is (both registered
#     detectors, both swept by detect_all() + memory.store_detection()) ────

@pytest.fixture(autouse=True)
def _init():
    init_db()


def test_anchor_timestamps_survive_a_real_sqlite_round_trip():
    assert FIRED, "need at least one firing bear_flag fixture"
    _, bars, detection = FIRED[0]
    d = dict(detection)
    d["sym"], d["tf"] = "TESTBEARFLAGANCHOR", "D"

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


def test_anchor_bar_t_helper_does_not_mutate_bars():
    assert FIRED
    _, bars, _ = FIRED[0]
    snapshot = copy.deepcopy(bars)
    _anchor_bar_t(bars, 0)
    _anchor_bar_t(bars, len(bars) - 1)
    assert bars == snapshot
