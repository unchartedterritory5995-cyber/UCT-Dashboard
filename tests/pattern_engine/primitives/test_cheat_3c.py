"""The 3-C Cheat: an EARLY pivot, and the band that keeps it early."""
from api.services.screener import base_catalog as bc
from api.services.screener import bases


def _bar(i, c, v=1_000_000):
    return {"t": 20240000 + i, "o": c, "c": c, "v": v,
            "h": c * 1.006, "l": c * 0.994}


def _leg(bars, n, to, v=1_000_000):
    start = bars[-1]["c"] if bars else 100.0
    step = (to - start) / max(1, n)
    for i in range(n):
        bars.append(_bar(len(bars), start + step * (i + 1), v=v))
    return bars


def _cheat(recovery=0.40, depth=0.25, plateau=0.06, lead=260, top=100.0,
           ma_rising=True, prior_gain=2.5):
    """A long rising lead, a cup down to `depth`, a partial right-side rally
    to `recovery` of the decline, then a tight plateau.

    ⚠️ THE LEAD HAS TO BE STEEP. Minervini requires price above a RISING
    200-day average, and a stock that rose only 60% over the lead sits BELOW
    its 200-day after a 25% correction -- the average is dragged up by the
    recent highs. A gentle fixture therefore fails the trend gate for a reason
    that has nothing to do with the cheat. Real names clear it (1.11% of the
    universe) precisely because their advances are steeper than that.
    """
    base = top / (1.0 + prior_gain)
    bars = []
    if ma_rising:
        for i in range(lead):
            bars.append(_bar(i, base + (top - base) * (i + 1) / lead))
    else:
        for i in range(lead):                      # falling 200-day
            bars.append(_bar(i, top + (base - top) * (i + 1) / lead))
        top = bars[-1]["c"]
    low = top * (1 - depth)
    _leg(bars, 25, low)                            # the decline
    target = low + (top - low) * recovery
    _leg(bars, 20, target)                         # partial right-side rally
    # ⚠️ THE PLATEAU MUST END AT THE TARGET, not on its low bar. An earlier
    # version alternated down every other bar, so the LAST close was the
    # plateau's floor -- which both dragged the measured recovery below the
    # published band and pushed price under the 200-day average. The fixture
    # was failing two gates for a reason that had nothing to do with either.
    for i in range(bc.CHEAT_PLATEAU_BARS - 1):
        bars.append(_bar(len(bars),
                         target * (1 - (plateau if i % 2 else 0.0))))
    bars.append(_bar(len(bars), target))
    return bars


def _st(bars):
    return bc.cheat_3c_state(bases._context(bars, bars))


# ── the band that defines "cheat" ──────────────────────────────────────────

def test_a_pause_after_recouping_a_third_to_a_half_is_a_CHEAT():
    st = _st(_cheat(recovery=0.40))
    assert st is not None
    assert bc.CHEAT_MIN_RECOVERY <= st["recovery"] <= bc.CHEAT_MAX_RECOVERY


def test_price_back_NEAR_THE_HIGHS_is_not_a_cheat():
    """⛔⛔ THE DISTINCTION THE WHOLE STRUCTURE RESTS ON.

    A cheat is a pause after recouping only about a third to a half of the
    decline. Price that has recovered most of the base is forming a HANDLE, or
    is already extended -- a different and later entry. Without the upper bound
    this structure would silently become "cup with handle, detected early".
    """
    assert _st(_cheat(recovery=0.85)) is None


def test_a_pause_too_early_in_the_recovery_is_not_a_cheat():
    """The lower bound matters too: a pause after recovering almost nothing is
    still the left side of the base.
    """
    assert _st(_cheat(recovery=0.08)) is None


def test_a_LOOSE_plateau_is_refused():
    """"contained within 5 percent to 10 percent from high point to low point"."""
    assert _st(_cheat(plateau=0.22)) is None


# ── the sourced gates ──────────────────────────────────────────────────────

def test_a_base_corrected_more_than_sixty_percent_is_refused():
    assert _st(_cheat(depth=0.65)) is None


def test_a_base_too_shallow_for_the_published_band_is_refused():
    assert _st(_cheat(depth=0.05)) is None


def test_a_FALLING_two_hundred_day_average_disqualifies():
    """"trading above its upwardly trending 200-day moving average" -- the word
    doing the work is 'upwardly'. Above a falling average is not the setup.
    """
    assert _st(_cheat(ma_rising=False)) is None


def test_no_prior_advance_means_there_is_nothing_to_continue():
    assert _st(_cheat(prior_gain=0.02)) is None


# ── provenance ─────────────────────────────────────────────────────────────

def test_this_is_the_only_place_minervini_publishes_a_minimum_duration():
    """⭐ And it is why the VCP entry records ITS missing minimum as a refusal
    rather than borrowing this number -- the two are different patterns and he
    states this one only here.
    """
    c = bc.by_key("cheat-3c")
    dur = [x for x in c.criteria if "ONLY explicit minimum" in x.condition]
    assert dur and dur[0].value == (bc.CHEAT_MIN_BARS, bc.CHEAT_MAX_BARS)

    vcp = bc.by_key("vcp")
    borrowed = [x for x in vcp.criteria
                if "Minimum base duration" in x.condition]
    assert borrowed and borrowed[0].value is None, (
        "the VCP must still refuse a minimum duration rather than adopt the "
        "3-C's")


def test_the_volume_dry_up_has_no_invented_threshold():
    """The house states the direction and gives no ratio. The 5-10% plateau
    bound already carries the price-tightness half.
    """
    c = bc.by_key("cheat-3c")
    v = [x for x in c.criteria if "Volume dry-up" in x.condition]
    assert v and v[0].value is None and v[0].missing


def test_the_cheat_leads_the_cup_it_forms_inside():
    """It is an EARLIER entry in the same structure, so when both fire the
    render must lead with the earlier one.
    """
    assert bc.by_key("cheat-3c").rank < bc.by_key("cup-with-handle").rank


def test_our_only_number_is_the_plateau_length():
    c = bc.by_key("cheat-3c")
    ours = [x for x in c.criteria if x.origin == "uct"]
    assert [x.value for x in ours] == [bc.CHEAT_PLATEAU_BARS]
    assert all(x.source_id is None for x in ours)
