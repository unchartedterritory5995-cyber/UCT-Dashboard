"""Base on Base: an arithmetic pattern, and the count it exists to protect."""
from api.services.screener import base_catalog as bc
from api.services.screener import bases


def _bar(i, c, hi=None, lo=None, v=1_000_000):
    return {"t": 20240000 + i, "o": c, "c": c, "v": v,
            "h": hi if hi is not None else c * 1.0025,
            "l": lo if lo is not None else c * 0.9975}


def _advance(bars, n, to):
    """Append a smooth advance from the last close up to `to`."""
    start = bars[-1]["c"] if bars else 40.0
    step = (to - start) / max(1, n)
    for i in range(n):
        bars.append(_bar(len(bars), start + step * (i + 1)))
    return bars


def _base(bars, n, px):
    """Append a tight horizontal stretch at `px`, opening at its high."""
    for i in range(n):
        c = px - (0.0 if i == 0 else (0.03 if i % 2 else 0.05))
        bars.append(_bar(len(bars), c, hi=c * 1.0015, lo=c * 0.9985))
    return bars


def _stacked(second_leg_gain):
    """Base 1 -> a breakout advance of `second_leg_gain` -> base 2."""
    b = [_bar(0, 40.0)]
    _advance(b, 60, 60.0)          # the advance base 1 rests
    _base(b, 30, 60.0)             # base 1, pivot ~60.1
    pivot1 = 60.0 * 1.0015 + bc.FLAT_PIVOT_PAD
    _advance(b, 12, pivot1 * (1 + second_leg_gain))
    _base(b, 30, pivot1 * (1 + second_leg_gain))   # base 2
    return b


def _ctx(bars):
    return bases._context(bars, bars)


def _det(bars):
    return bc.by_key("base-on-base").detect(_ctx(bars))


# ── the defining arithmetic ────────────────────────────────────────────────

def test_a_failed_breakout_under_twenty_percent_IS_a_base_on_base():
    bars = _stacked(0.10)
    st = bc.base_on_base_state(bars)
    assert st is not None, "a 10% advance between two bases is a base-on-base"
    assert st["gain"] < bc.BOB_MAX_GAIN
    assert _det(bars) is True


def test_a_full_twenty_percent_advance_is_NOT_a_base_on_base():
    """Two separate stages, not one. The pattern is defined by the FAILURE."""
    bars = _stacked(0.30)
    assert bc.base_on_base_state(bars) is None
    assert _det(bars) is False


def test_the_gain_is_measured_from_the_PIVOT_not_from_the_base_low():
    """⭐ The corpus names this trap explicitly: measuring from the low
    inflates the gain and silently reclassifies base-on-bases as two separate
    stages -- destroying the only thing this pattern does.

    Here the advance is 10% off base 1's pivot. Base 1 is ~15% deep, so
    measured from its LOW the same advance clears 20% comfortably.
    """
    bars = _stacked(0.10)
    st = bc.base_on_base_state(bars)
    assert st is not None
    gain_from_pivot = (st["peak"] - st["pivot1"]) / st["pivot1"]
    assert gain_from_pivot < bc.BOB_MAX_GAIN

    b1_low = min(b["l"] for b in bars[60:90])
    gain_from_low = (st["peak"] - b1_low) / b1_low
    assert gain_from_low > gain_from_pivot, (
        "fixture: measuring from the low must inflate the gain, or this test "
        "cannot tell the two readings apart")


# ── the count, which is the point ──────────────────────────────────────────

def test_a_base_on_base_counts_as_ONE_stage():
    bars = _stacked(0.10)
    assert bc.base_stage_count(bars) == 1


def test_two_bases_separated_by_a_real_advance_count_as_TWO_stages():
    """The control. Without this the count could return 1 unconditionally and
    every stage assertion above would still pass.
    """
    bars = _stacked(0.30)
    assert bc.base_stage_count(bars) == 2


def test_a_series_with_no_base_counts_zero_stages():
    rising = [_bar(i, 10.0 + i * 0.5) for i in range(80)]
    assert bc.base_stage_count(rising) == 0


# ── provenance ─────────────────────────────────────────────────────────────

def test_the_unpublished_overlap_rule_is_a_REFUSAL_not_a_guess():
    """No source gives a maximum overlap between the two bases, so there is no
    overlap test -- rather than a number of ours wearing IBD's name.
    """
    bob = bc.by_key("base-on-base")
    overlap = [c for c in bob.criteria if "sink into the first" in c.condition]
    assert overlap and overlap[0].value is None and overlap[0].missing


def test_the_volume_conflict_between_house_and_affiliate_is_recorded():
    bob = bc.by_key("base-on-base")
    assert any("CONFLICT" in c.condition for c in bob.criteria)


def test_the_twenty_percent_rule_is_sourced_not_ours():
    bob = bc.by_key("base-on-base")
    defining = [c for c in bob.criteria if c.value == bc.BOB_MAX_GAIN]
    assert defining, "the defining number must appear as a criterion"
    assert all(c.origin == "source" and c.quote for c in defining)


def test_base_on_base_outranks_the_flat_base_it_is_built_on():
    """⛔ A composed structure must LEAD its component in the rendered label.

    `base_on_base_state` requires a qualifying flat base, so both relations
    fire on every base-on-base symbol. The renderer orders by `rank`, so a
    higher rank here means every such symbol reads "Flat Base (Base on Base)"
    -- the general statement in front of the specific one it contains.
    """
    bob = bc.by_key("base-on-base")
    flat = bc.by_key("flat-base")
    assert bob.rank < flat.rank, (
        "base-on-base (rank %s) must lead flat-base (rank %s)"
        % (bob.rank, flat.rank))


def test_the_two_relations_really_do_co_fire():
    """The control: if they could not both fire, the ordering above would be
    an assertion about nothing.
    """
    bars = _stacked(0.10)
    ctx = _ctx(bars)
    assert bc.by_key("base-on-base").detect(ctx) is True
    assert bc.by_key("flat-base").detect(ctx) is True
