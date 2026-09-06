"""Pennant anchor-timestamp correctness fix — narrow, standalone package.

Owner-authorized as a SEPARATE, LOCAL-ONLY correctness package (the third in
the same defect class, after Bull Flag's and Bear Flag's own fixes),
independent of any Pennant canonical adaptation (none exists yet) and
independent of the frozen Bull Flag / Bear Flag anchor-timestamp and
canonical packages. Proves a real, independently re-verified (not assumed
byte-for-byte-identical to the flag families) defect and its narrow
correction.

Pennant is geometrically DIFFERENT from Bull Flag / Bear Flag: it is a
CONVERGING channel (upper trendline slopes down, lower slopes up, width
ratio < 0.60) rather than a parallel one, fitted in LOG-PRICE space
(`_LOG_SPACE = True`) instead of arithmetic space, and it additionally
computes a projected apex (`intersect_at` + `apex_bars_ahead`, a bars-ahead
COUNT used for gating/narrative — never stored as an `Anchor.t`). None of
that changes the defect's shape, verified by direct read of THIS file:

  `pennant.py`'s flag-channel geometry anchors carried BAR-INDEX integers
  in `Anchor.t` instead of unix-second bar timestamps -- the same contract
  violation Bull Flag and Bear Flag had (`types.py`: `t: int  # unix
  seconds, bar start`).

Root cause (re-verified by direct read of THIS file, not assumed from the
flag families): `_fit_pennant_lines`'s own inline `upper_pivots`/
`lower_pivots` (built directly, NOT via the shared `detect_pivots`
primitive -- which IS used correctly elsewhere in this file, at line 76,
for the pole-top/pole-bottom pivot search) set `"t": start_idx + i` -- an
absolute bar INDEX -- and `trendlines.fit_trendline` passes that value
straight through into `p1["t"]`/`p2["t"]` with no index-to-timestamp
translation, regardless of `log_space` (verified by reading
`_fit_arithmetic`: the log-space branch only exponentiates `price` back,
never touches `t`). `_build_detection` used to copy that bar-index value
directly into `geometry.anchors[].t`, unmodified.

The apex projection (`intersect_at(upper_line, lower_line)` -> a bar-index
scalar possibly beyond the last real bar, used only to derive
`apex_bars_ahead`, a bars-ahead COUNT reported in `geometry.extras`) is a
SEPARATE, already-correct computation: it is never stored as an
`Anchor.t`, so it carries no part of this defect and is deliberately left
untouched. `pivot_ts`, `start_t`, `end_t` were ALSO already correct on
direct read (all built from `bars[idx]["t"]` / a real pivot's own `.t` --
never a bare index) -- the defect is confined to the 4 trendline-pair
anchors in `geometry.anchors`.

The fix mirrors Bull Flag's and Bear Flag's exactly: a single, narrow
translation at the ONE place that value is read to construct a
canonical/renderable anchor (`_anchor_bar_t()` in `pennant.py`) --
`fit_trendline`'s own regression (bar-index x-space, log-price y-space) is
left untouched.
"""
import copy

import pytest

from api.services.pattern_engine import memory
from api.services.pattern_engine.detectors.classical.pennant import (
    _anchor_bar_t,
    _build_detection,
    detect_pennant,
)
from api.services.pattern_engine.pattern_db import init_db
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


def _fired_detections():
    """Every positive fixture's best (highest-confidence) real Detection."""
    out = []
    for fx in load_all_fixtures("pennant", include_internal=False):
        if not fx.expected_fires:
            continue
        ctx = fx.context if fx.context is not None else build_context(fx.bars, sym="TEST")
        detections = detect_pennant(fx.bars, ctx)
        if detections:
            out.append((fx.name, fx.bars, max(detections, key=lambda d: d["confidence"])))
    return out


FIRED = _fired_detections()


def test_fixture_coverage_is_nonzero():
    """A silent zero-fixture run would make every test below vacuously pass."""
    assert len(FIRED) >= 3, "expected several firing pennant fixtures"


def test_fixture_coverage_includes_both_directions():
    """Pennant is a single detector emitting BOTH bullish and bearish
    detections -- the fix must be proven on both, not just one."""
    dirs = {d["direction"] for _, _, d in FIRED}
    assert dirs == {"bullish", "bearish"}, f"expected both directions fired, got {dirs}"


# ─── Anchor-by-anchor: every anchor's .t is a REAL unix-second bar timestamp ──

@pytest.mark.parametrize("name,bars,detection", FIRED, ids=lambda x: x if isinstance(x, str) else "")
def test_every_trendline_pair_anchor_t_is_the_real_bar_timestamp(name, bars, detection):
    """Independent oracle: `expected_t = bars[expected_index]["t"]`, computed
    directly from the fixture's own real bars and the fixture's own
    `pennant_bars` extras count -- NEVER via `_anchor_bar_t` (the function
    under test) or any other helper this fix touched."""
    anchors = detection["geometry"]["anchors"]
    assert len(anchors) == 4, "pennant emits exactly 4 trendline-pair anchors"
    upper_start, upper_end, lower_start, lower_end = anchors

    last_bar_t = int(bars[-1]["t"])
    pennant_len = detection["geometry"]["extras"]["pennant_bars"]
    start_idx = len(bars) - pennant_len
    expected_start_t = int(bars[start_idx]["t"])

    for a in (upper_start, lower_start):
        assert a["t"] == expected_start_t, (
            f"{name}: pennant-start anchor t={a['t']} does not match the "
            f"independently-derived real bar timestamp {expected_start_t}"
        )
    for a in (upper_end, lower_end):
        assert a["t"] == last_bar_t, (
            f"{name}: pennant-end anchor t={a['t']} does not match bars[-1]['t']={last_bar_t}"
        )

    for a in anchors:
        assert a["t"] > 1_000_000_000, (
            f"{name}: anchor t={a['t']!r} still looks like a bar index, not a "
            "unix-second timestamp -- the fix did not take effect"
        )


@pytest.mark.parametrize("name,bars,detection", FIRED, ids=lambda x: x if isinstance(x, str) else "")
def test_trendline_pair_anchors_do_not_all_land_on_one_bar(name, bars, detection):
    """The pennant-start anchors are genuinely NOT the same bar as the
    pennant-end anchors, on every real firing fixture --
    `pennant._MIN_PENNANT_BARS=3` guarantees this for every real detection."""
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
    `.price`). Pennant's upper line is always ABOVE the lower line at both
    ends -- unlike a parallel flag channel, the two are converging, but they
    have not crossed yet at the last real bar (that crossing is the apex,
    which is required to lie 1-30 bars AHEAD of the data)."""
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


@pytest.mark.parametrize("name,bars,detection", FIRED, ids=lambda x: x if isinstance(x, str) else "")
def test_apex_bars_ahead_stays_a_bar_count_not_a_timestamp(name, bars, detection):
    """Pennant-specific guard: `apex_bars_ahead` (the projected-apex distance)
    is a derived bars-ahead COUNT reported in `geometry.extras`, computed from
    `intersect_at()` on the same bar-index x-space the trendlines were fitted
    in -- it is NOT an `Anchor.t` and this fix must never touch it or make it
    look like one. `_MIN_APEX_AHEAD=1` / `_MAX_APEX_AHEAD=30` bound it to a
    small positive number on every real detection."""
    apex_bars_ahead = detection["geometry"]["extras"]["apex_bars_ahead"]
    assert 1 <= apex_bars_ahead <= 30, (
        f"{name}: apex_bars_ahead={apex_bars_ahead!r} outside the detector's "
        "own gating bounds -- or this fix accidentally touched it"
    )


# ─── No detection semantics changed ─────────────────────────────────────────

def test_build_detection_receives_scores_already_computed():
    """Structural invariant: `_build_detection` takes
    `confidence`/`direction`/`geom_score`/`vol_score`/`ctx_score`/
    `hist_score` as ALREADY-COMPUTED parameters -- scoring happens strictly
    before this function (and this fix) ever runs. (Pennant's own signature
    differs from Bull Flag's / Bear Flag's by carrying a `direction` param,
    since one detector emits both bullish and bearish detections.)"""
    import inspect
    params = list(inspect.signature(_build_detection).parameters)
    assert params == [
        "bars", "c", "confidence", "context", "direction",
        "geom_score", "vol_score", "ctx_score", "hist_score",
    ]


# ─── Persistence round-trip — pennant IS reachable via the real daily/hourly
#     universe scan the same way bull_flag/bear_flag are (all three registered
#     detectors, all swept by detect_all() + memory.store_detection()) ──────

@pytest.fixture(autouse=True)
def _init():
    init_db()


def test_anchor_timestamps_survive_a_real_sqlite_round_trip():
    assert FIRED, "need at least one firing pennant fixture"
    _, bars, detection = FIRED[0]
    d = dict(detection)
    d["sym"], d["tf"] = "TESTPENNANTANCHOR", "D"

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
