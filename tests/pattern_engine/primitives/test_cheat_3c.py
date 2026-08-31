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
           ma_rising=True, prior_gain=2.5, inside_days=0):
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
    for i in range(bc.CHEAT_PLATEAU_BARS - 1 - inside_days):
        bars.append(_bar(len(bars),
                         target * (1 - (plateau if i % 2 else 0.0))))
    # Inside days on light volume: each range strictly inside the last, and
    # volume below the base's mean. Sourced as the low cheat's confirmation.
    # ⚠️ CENTRED ON THE TARGET, not on the previous bar. Centring each inside
    # day on its predecessor walks price DOWN the plateau, which dropped the
    # measured recovery to 2.5% -- below the lower-third band the test exists
    # to exercise. The bars must tighten in place, which is what an inside day
    # actually is.
    span = None
    for j in range(inside_days):
        prev = bars[-1]
        span = (prev["h"] - prev["l"]) * 0.6 if span is None else span * 0.75
        b = _bar(len(bars), target, v=200_000)
        b["h"], b["l"] = target + span / 2, target - span / 2
        bars.append(b)
    if not inside_days:
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


# ── the Low Cheat: the same detector with one band moved ───────────────────

def test_a_plateau_in_the_LOWER_third_is_a_low_cheat_not_a_3C():
    """Minervini's own framing is positional: the low cheat is the lower third,
    the classic cheat the middle third, the handle the upper third. The two
    share one detector and differ only in where the plateau sits.
    """
    bars = _cheat(recovery=0.20, inside_days=3, prior_gain=5.0)
    assert bc.low_cheat_state(bases._context(bars, bars)) is not None
    assert bc.cheat_3c_state(bases._context(bars, bars)) is None


def test_a_low_cheat_WITHOUT_inside_days_is_refused():
    """The confirmation is stated for this entry and not the classic one --
    "Before I buy, I ALSO like to see some inside days on very low volume".
    It is the riskier entry, so it carries the extra requirement.
    """
    bars = _cheat(recovery=0.20, inside_days=0, prior_gain=5.0)
    assert bc.low_cheat_state(bases._context(bars, bars)) is None


def test_a_plateau_in_the_MIDDLE_third_is_a_3C_not_a_low_cheat():
    """The control. Without it the two could both fire everywhere and the
    positional distinction would be decorative.
    """
    bars = _cheat(recovery=0.40)
    assert bc.cheat_3c_state(bases._context(bars, bars)) is not None
    assert bc.low_cheat_state(bases._context(bars, bars)) is None


def test_the_two_bands_meet_without_a_gap_or_an_overlap():
    """⛔ A gap would leave plateaus that are neither, and an overlap would let
    one structure be both. The bands are adjacent by construction.
    """
    assert bc.LOW_CHEAT_MAX_RECOVERY == bc.CHEAT_MIN_RECOVERY


def test_the_low_cheat_requires_inside_days_and_the_3C_does_not():
    """"Before I buy, I ALSO like to see some inside days on very low volume"
    is stated for the low cheat, which is the riskier entry. It is not carried
    over to the classic cheat, where he does not state it.
    """
    lc = bc.by_key("low-cheat")
    assert any("inside days" in (c.quote or "") for c in lc.criteria)
    c3 = bc.by_key("cheat-3c")
    assert not any("inside days" in (c.quote or "") for c in c3.criteria)


def test_the_unpublished_cap_floor_is_a_refusal_that_names_its_consequence():
    """A third party asserts '>$10B'. That number is theirs. Not filtering by
    size means this fires on small caps he would not apply it to, and the
    refusal says so rather than leaving the gap silent.
    """
    lc = bc.by_key("low-cheat")
    cap = [c for c in lc.criteria if "MARKET-CAP FLOOR" in c.condition]
    assert cap and cap[0].value is None and cap[0].missing
    assert "THEIRS, not his" in cap[0].missing


def test_the_low_cheat_leads_the_classic_cheat_it_precedes():
    assert bc.by_key("low-cheat").rank < bc.by_key("cheat-3c").rank
