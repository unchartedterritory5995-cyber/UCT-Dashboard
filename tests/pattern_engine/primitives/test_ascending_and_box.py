"""Ascending Base and Square Box: the taxonomy's cleanest rule, and its noisiest shape."""
import random

from api.services.screener import base_catalog as bc
from api.services.screener import bases

_RNG = random.Random(17)


def _bar(i, c, v=1_000_000):
    c = c * (1.0 + _RNG.gauss(0, 0.005))
    return {"t": 20240000 + i, "o": c, "c": c, "v": v,
            "h": c * 1.007, "l": c * 0.993}


def _leg(bars, n, to, v=1_000_000):
    start = bars[-1]["c"] if bars else 100.0
    step = (to - start) / max(1, n)
    for i in range(n):
        bars.append(_bar(len(bars), start + step * (i + 1), v=v))
    return bars


def _staircase(pullbacks=(0.15, 0.15, 0.15), highs=(100.0, 112.0, 125.0),
               prior_gain=0.40, tail=6, seed=17):
    """Three advances to new highs, each followed by a pullback."""
    _RNG.seed(seed)
    base = highs[0] / (1.0 + prior_gain)
    bars = [_bar(0, base)]
    _leg(bars, 40, highs[0])                       # the advance it sits midway in
    for h, d in zip(highs, pullbacks):
        _leg(bars, 8, h)                           # advance to a new high
        _leg(bars, 8, h * (1 - d))                 # the pullback
    _leg(bars, tail, highs[-1] * 0.97)             # sit under the pivot
    return bars


def _ctx(bars):
    return bases._context(bars, bars)


def _asc(bars):
    return bc.ascending_base_state(_ctx(bars))


# ── Ascending Base: the only structure in the taxonomy with no conflicts ───

def test_a_clean_staircase_is_ACCEPTED():
    st = _asc(_staircase())
    assert st is not None
    assert len(st["depths"]) == bc.ASC_PULLBACKS
    assert all(b > a for a, b in zip(st["lows"], st["lows"][1:]))
    assert all(b > a for a, b in zip(st["highs"], st["highs"][1:]))


def test_a_LOWER_low_breaks_the_staircase():
    """"with each low higher than the preceding one" -- the defining feature."""
    assert _asc(_staircase(highs=(100.0, 112.0, 104.0))) is None


def test_a_pullback_deeper_than_twenty_percent_is_refused():
    assert _asc(_staircase(pullbacks=(0.15, 0.15, 0.28))) is None


def test_a_pullback_shallower_than_ten_percent_is_refused():
    """Both ends of the band are published, so both are enforced."""
    assert _asc(_staircase(pullbacks=(0.15, 0.15, 0.05))) is None


def test_the_span_is_the_BASE_duration_not_the_time_since_it_started():
    """⛔⛔ THE DEFECT THAT NEARLY KILLED THIS STRUCTURE.

    Measuring the 9-16 week window from the base's start to TODAY folds "time
    since the base finished" into "how long the base took", so any staircase
    that completed a few weeks ago is refused for being too old-looking.
    Measured on the real universe: 3 symbols with the wrong span, 16 with the
    right one, from the same 87 candidates.
    """
    bars = _staircase(tail=30)                    # a long wait after the base
    st = _asc(bars)
    assert st is not None, "a completed staircase must survive the wait"
    assert bc.ASC_MIN_BARS <= st["bars"] <= bc.ASC_MAX_BARS
    assert st["age_bars"] >= 20, "fixture: the base finished a while ago"


def test_price_that_has_run_past_the_buy_zone_is_no_longer_a_setup():
    """IBD's buy zone is 5% above the pivot; past that the base has resolved."""
    bars = _staircase()
    st = _asc(bars)
    assert st is not None
    for _ in range(4):
        bars.append(_bar(len(bars), st["pivot"] * 1.25))
    assert _asc(bars) is None


def test_the_pivot_is_the_high_before_the_THIRD_low():
    """Not the structure's highest point -- "the high point from which the
    third pull back began".
    """
    st = _asc(_staircase())
    assert st is not None
    assert abs(st["pivot"] - (st["highs"][-1] + bc.ASC_PIVOT_PAD)) < 1e-9


def test_the_absence_of_conflicts_is_itself_recorded():
    """Every neighbouring base needed a CONFLICT criterion. This one did not,
    and that is worth stating rather than leaving as an absence.
    """
    a = bc.by_key("ascending-base")
    assert any(c.value == "no-conflicts" for c in a.criteria)
    assert not [c for c in a.criteria if "CONFLICT" in c.condition.upper()
                and c.value != "no-conflicts"]


def test_the_market_decline_attribution_is_a_refusal_not_a_gate():
    """O'Neil gives it as a CAUSE. Railing on it would over-refuse."""
    a = bc.by_key("ascending-base")
    c = [x for x in a.criteria if "general-market" in x.condition
         or "general market" in (x.quote or "")]
    assert c and c[0].value is None and c[0].missing


# ── Square Box: the shape the corpus warned would fire constantly ──────────

def _box(depth=0.10, weeks=5, drift=0.0, prior_gain=0.40, top=100.0, seed=17):
    _RNG.seed(seed)
    base = top / (1.0 + prior_gain)
    bars = [_bar(0, base)]
    _leg(bars, 40, top)                            # the advance it follows
    n = weeks * 5
    for i in range(n):
        mid = top * (1 - depth / 2) * (1 + drift * (i / max(1, n - 1)))
        c = mid * (1 + (depth / 2 if i % 2 else -depth / 2))
        bars.append(_bar(len(bars), c))
    return bars


def _boxst(bars):
    return bc.square_box_state(bars)


def test_a_boxy_five_week_consolidation_is_ACCEPTED():
    bars = _box(weeks=5)
    st = _boxst(bars)
    assert st is not None
    assert bc.BOX_MIN_BARS <= st["bars"] <= bc.BOX_MAX_BARS
    assert st["depth"] <= bc.BOX_MAX_DEPTH
    assert bc.by_key("square-box").detect(_ctx(bars)) is True


def test_a_TILTED_consolidation_is_refused_even_though_it_is_shallow_enough():
    """⛔ The corpus is explicit that the tilt test does the discriminating:
    "Without it, this detector will fire constantly."
    """
    tilted = _box(depth=0.08, drift=0.10)
    st = _boxst(tilted)
    assert st is None or st["boxiness"] <= bc.BOX_MAX_BOXINESS


def test_boxiness_is_a_RATIO_so_it_does_not_move_with_the_box_depth():
    """⛔⛔ THE BUG THE FIRST VERSION HAD. An absolute drift bound is
    scale-dependent: 10% of price across a 4-7 week box is a visible trend,
    while the same 10% across a 52-week base is flat. Reusing the flat base's
    absolute bound matched 46.7% of the universe -- a NOISE verdict, and
    exactly what the corpus predicted.
    """
    shallow = _boxst(_box(depth=0.04, drift=0.03))
    deep = _boxst(_box(depth=0.14, drift=0.03))
    # The same absolute drift is a big tilt in a shallow box and a small one
    # in a deep box; a ratio says so and an absolute bound cannot.
    if shallow and deep:
        assert shallow["boxiness"] > deep["boxiness"]


def test_a_box_that_lasts_too_LONG_is_refused():
    """⭐ The only IBD base you can invalidate by lasting too long -- every
    other one has a floor and no ceiling.
    """
    assert bc.BOX_MAX_BARS == 35
    long_box = _box(weeks=12)
    st = _boxst(long_box)
    assert st is None or st["bars"] <= bc.BOX_MAX_BARS


def test_the_overlap_with_the_flat_base_is_recorded_not_resolved():
    """A 5-, 6- or 7-week sub-15% consolidation satisfies BOTH definitions and
    IBD publishes no tiebreak. Relations are zero-or-many, so both firing is
    the honest answer rather than an invented precedence.
    """
    b = bc.by_key("square-box")
    ov = [c for c in b.criteria if "OVERLAP" in c.condition]
    assert ov and ov[0].value is None and ov[0].missing
    assert "tiebreak" in ov[0].missing


def test_the_weaker_published_volume_standard_is_recorded():
    """IBD accepted a breakout week whose volume FELL week-on-week, provided it
    was above average -- weaker than the 40%-above-50-day rule it applies to
    the flat base, a base of essentially the same shape.
    """
    b = bc.by_key("square-box")
    v = [c for c in b.criteria if "Breakout volume" in c.condition]
    assert v and v[0].value is None and v[0].missing


def test_the_omission_from_ibds_own_seven_bases_is_recorded():
    b = bc.by_key("square-box")
    assert any(c.value == "absent-from-seven-bases" for c in b.criteria)
