"""The Buyable Gap-Up: and a gate the corpus instructs us NOT to implement."""
from api.services.screener import base_catalog as bc
from api.services.screener import bases


def _bar(i, c, o=None, hi=None, lo=None, v=1_000_000):
    o = c if o is None else o
    return {"t": 20240000 + i, "o": o, "c": c, "v": v,
            "h": hi if hi is not None else max(c, o) * 1.01,
            "l": lo if lo is not None else min(c, o) * 0.99}


def _series(gap_mult=1.2, prior_gain=1.4, lead=120, start=20.0, fill=False,
            gap_ago=3):
    """A doubling advance, then a gap-up sized against the prior 40-day ATR."""
    bars = [_bar(i, start * (1 + prior_gain * (i + 1) / lead))
            for i in range(lead)]
    prev = bars[-1]
    atr = bc._atr(bars, bc.BGU_ATR_BARS, len(bars))
    gap = bc.BGU_ATR_MULT * atr * gap_mult
    op = prev["c"] + gap
    # a real gap: the whole day sits above the prior high
    bars.append(_bar(len(bars), op * 1.01, o=op, lo=max(op * 0.995,
                                                        prev["h"] * 1.001),
                     v=3_000_000))
    for _ in range(gap_ago):
        c = prev["c"] * 0.97 if fill else op * 1.02
        bars.append(_bar(len(bars), c))
    return bars


def _st(bars):
    return bc.buyable_gap_up_state(bars)


# ── the sourced gates ──────────────────────────────────────────────────────

def test_a_large_gap_in_a_doubled_stock_is_a_BGU():
    st = _st(_series(gap_mult=1.4))
    assert st is not None
    assert st["gap_atr"] >= bc.BGU_ATR_MULT
    assert st["prior_advance"] >= bc.BGU_PRIOR_DOUBLE


def test_a_gap_smaller_than_three_quarters_of_the_ATR_is_refused():
    assert _st(_series(gap_mult=0.4)) is None


def test_a_stock_that_has_NOT_doubled_is_refused():
    """⭐ "A stock should normally have doubled before a BGU." Primary source,
    high confidence, and the corpus notes it is frequently omitted by
    implementations.
    """
    assert _st(_series(prior_gain=0.25)) is None


def test_a_gap_that_has_CLOSED_is_refused():
    """"truly powerful buyable gap ups do not close their gap"."""
    assert _st(_series(fill=True)) is None


def test_a_stale_gap_is_no_longer_a_setup():
    assert _st(_series(gap_ago=bc.BGU_MAX_AGE_BARS + 12)) is None


def test_the_ATR_is_anchored_to_the_day_BEFORE_the_gap():
    """⛔ The gap day's own range is enormous by construction, so including it
    would inflate the denominator and make every gap look ordinary.
    """
    bars = _series(gap_mult=1.4)
    st = _st(bars)
    assert st is not None
    gap_i = len(bars) - 1 - st["bars_ago"]
    anchored = bc._atr(bars, bc.BGU_ATR_BARS, gap_i)
    including = bc._atr(bars, bc.BGU_ATR_BARS, gap_i + 1)
    assert abs(st["atr"] - anchored) < 1e-9
    assert including > anchored, (
        "fixture: the gap day must inflate the ATR, or this test cannot tell "
        "the two anchorings apart")


# ── the gate we are told not to build ──────────────────────────────────────

def test_the_ambiguous_volume_gate_is_NOT_implemented():
    """⛔⛔ Two published phrasings that are not the same claim -- "1.5 times
    the 50-day SMA" versus "150% ABOVE the 50-day moving average" -- differing
    by a factor of ~1.67. The research note instructs: do not implement until
    resolved. Choosing either would invent the authors' threshold.
    """
    b = bc.by_key("buyable-gap-up")
    vol = [c for c in b.criteria if "VOLUME GATE" in c.condition]
    assert vol and vol[0].value is None and vol[0].missing
    assert "SUBSET" in vol[0].missing

    # And it really is not applied: a qualifying gap on ORDINARY volume passes.
    bars = _series(gap_mult=1.4)
    bars[-4]["v"] = 900_000
    assert _st(bars) is not None


def test_the_authors_two_criteria_pull_opposite_ways_and_that_is_recorded():
    """⭐ They require the stock to have DOUBLED, and separately refuse a gap
    as "extended" because it came "after a nearly 4-month uptrend" -- a
    refusal they apply even when the mechanical criteria are met. A stock that
    has doubled has almost always been rising for months.
    """
    b = bc.by_key("buyable-gap-up")
    t = [c for c in b.criteria if c.value == "doubled-vs-extended"]
    assert t and "extended" in (t[0].quote or "")


def test_the_intraday_confirmation_gap_is_recorded():
    """The BGU is not confirmed until the close, because confirmation depends
    on volume accumulating through the session. A daily-bar detector reads the
    completed day and cannot express the not-yet-confirmed state.
    """
    b = bc.by_key("buyable-gap-up")
    c = [x for x in b.criteria if "not confirmed until the CLOSE" in x.condition]
    assert c and c[0].value is None and c[0].missing


def test_the_unstated_performance_claim_is_refused():
    b = bc.by_key("buyable-gap-up")
    perf = [c for c in b.criteria if "Measured performance" in c.condition]
    assert perf and perf[0].value is None and perf[0].missing
    assert "NO statistics" in perf[0].missing
