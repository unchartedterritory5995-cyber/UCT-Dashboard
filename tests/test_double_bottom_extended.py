"""Double Bottom stops being named once the breakout has RUN.

RECOGNITION + MEMBER VISIBILITY. `double_bottom_state` compared nothing to the
pivot, so a W that broke out and kept going stayed the render's head for up to
DBL_MAX_AGE_BARS sessions -- ABCL was shown as a double bottom "47.9% above
pivot". The fix reuses IBD's general 5% buy zone, the same number and the same
test the ascending base already applies (`IBD_BUY_ZONE`).

⛔ The accept case at the top is the control: the fixture is the W the existing
`tests/pattern_engine/primitives/test_double_bottom.py` accepts, so a refusal
below is the buy-zone gate and nothing else.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from api.services.screener import base_catalog as bc
from api.services.screener import bases


def _bar(i, c, v=1_000_000):
    return {"t": 20240000 + i, "o": c, "c": c, "v": v,
            "h": c * 1.005, "l": c * 0.995}


def _leg(bars, n, to):
    """Append a smooth move from the last close to `to`."""
    start = bars[-1]["c"]
    step = (to - start) / max(1, n)
    for i in range(n):
        bars.append(_bar(len(bars), start + step * (i + 1)))
    return bars


def _w(right_side_to: float, tail: int = 6, top: float = 100.0) -> list:
    """Prior advance, a W with a 6% undercut, then the right side to a level."""
    bars = [_bar(0, top / 1.5)]
    _leg(bars, 45, top)
    low1 = top * 0.78
    _leg(bars, 20, low1)
    _leg(bars, 18, top * 0.93)               # middle peak -> pivot ~93.1
    _leg(bars, 20, low1 * 0.94)
    _leg(bars, tail, right_side_to)
    return bars


def _ctx(bars):
    return bases._context(bars, bars)


def _control_pivot():
    """The pivot the SAME W carries before the right side runs: built with the
    right side stopping below the pivot, so the extended fixtures can be judged
    against the level they really broke."""
    st = bc.double_bottom_state(_ctx(_w(right_side_to=90.0)))
    assert st is not None, "the control W must be accepted"
    return st["pivot"]


def test_the_control_W_below_its_pivot_is_accepted():
    st = bc.double_bottom_state(_ctx(_w(right_side_to=90.0)))
    assert st is not None
    assert _w(right_side_to=90.0)[-1]["c"] < st["pivot"]


def test_inside_the_5pct_buy_zone_is_still_a_double_bottom():
    pivot = _control_pivot()
    bars = _w(right_side_to=pivot * 1.03)
    st = bc.double_bottom_state(_ctx(bars))
    assert st is not None, "3% past the pivot is inside IBD's buy zone"
    assert abs(st["pivot"] - pivot) < 1e-9, "the fixture moved the pivot"


def test_past_the_buy_zone_the_W_is_no_longer_named():
    pivot = _control_pivot()
    bars = _w(right_side_to=pivot * 1.08)
    assert bars[-1]["c"] > pivot * (1 + bc.IBD_BUY_ZONE)
    assert bc.double_bottom_state(_ctx(bars)) is None
    assert bc.by_key("double-bottom").detect(_ctx(bars)) is False


def test_a_run_like_ABCL_never_heads_the_render():
    """47.9% past the pivot: the measured case. The shipped path must not name
    it, and must not hand its pivot to the chart."""
    pivot = _control_pivot()
    bars = _w(right_side_to=pivot * 1.479, tail=10)
    out = bases.classify(bars)
    assert ",double-bottom," not in (out["base_matches"] or "")
    assert not str(out["base_render"] or "").startswith("Double Bottom")


def test_the_buy_zone_is_ONE_number_shared_with_the_ascending_base():
    assert bc.ASC_BUY_ZONE is bc.IBD_BUY_ZONE
    assert bc.IBD_BUY_ZONE == 0.05
    rows = [c for c in bc.by_key("double-bottom").criteria
            if c.value == bc.IBD_BUY_ZONE]
    assert rows and rows[0].quote and rows[0].source_id, (
        "the buy-zone gate must be recorded as a sourced criterion")
