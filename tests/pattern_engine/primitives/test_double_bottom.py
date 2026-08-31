"""The Double Bottom: the feature two authorities require opposite things of."""
from api.services.screener import base_catalog as bc
from api.services.screener import bases


def _bar(i, c, v=1_000_000):
    return {"t": 20240000 + i, "o": c, "c": c, "v": v,
            "h": c * 1.005, "l": c * 0.995}


def _leg(bars, n, to):
    """Append a smooth move from the last close to `to`."""
    start = bars[-1]["c"] if bars else 100.0
    step = (to - start) / max(1, n)
    for i in range(n):
        bars.append(_bar(len(bars), start + step * (i + 1)))
    return bars


def _w(undercut=0.06, prior_gain=0.50, tail=6, top=100.0):
    """A prior advance, then a W whose second low undercuts the first."""
    base = top / (1.0 + prior_gain)
    bars = [_bar(0, base)]
    _leg(bars, 45, top)                       # the advance the base rests
    low1 = top * 0.78
    _leg(bars, 20, low1)                      # first down leg
    _leg(bars, 18, top * 0.93)                # middle peak
    _leg(bars, 20, low1 * (1 - undercut))     # second leg, undercuts
    _leg(bars, tail, top * 0.90)              # right side recovering
    return bars


def _ctx(bars):
    return bases._context(bars, bars)


def _det(bars):
    return bc.by_key("double-bottom").detect(_ctx(bars))


# ── the defining feature ───────────────────────────────────────────────────

def test_a_W_whose_second_low_undercuts_the_first_is_ACCEPTED():
    st = bc.double_bottom_state(_ctx(_w(undercut=0.06)))
    assert st is not None
    assert st["low2"] < st["low1"]
    assert 0 < st["undercut"] <= bc.DBL_MAX_UNDERCUT


def test_a_W_with_NO_undercut_is_refused_although_it_is_the_CLASSICAL_pattern():
    """⭐⭐ The disagreement, made executable.

    Bulkowski and Edwards & Magee want the two lows at roughly the same price
    and treat an undercut as a flaw. IBD REQUIRES the undercut -- the shakeout
    is the pattern's purpose. A detector cannot satisfy both, so ours
    implements IBD's and this test pins which one shipped.
    """
    equal_lows = _w(undercut=0.0)
    assert bc.double_bottom_state(_ctx(equal_lows)) is None
    assert _det(equal_lows) is False


def test_an_undercut_far_beyond_the_tolerated_band_is_refused():
    assert bc.double_bottom_state(_ctx(_w(undercut=0.30))) is None


def test_the_pivot_is_the_middle_peak_plus_a_dime():
    st = bc.double_bottom_state(_ctx(_w()))
    assert st is not None
    assert abs(st["pivot"] - (st["middle_peak"] + bc.DBL_PIVOT_PAD)) < 1e-9


# ── the gates ──────────────────────────────────────────────────────────────

def test_a_W_with_no_prior_advance_is_refused():
    """A W is a base in an advance. The same shape with nothing in front of it
    is a stock that fell twice.
    """
    assert bc.double_bottom_state(_ctx(_w(prior_gain=0.02))) is None


def test_a_STALE_second_low_is_refused():
    """The lesson `darvas-box` and `green-line-breakout` each had to learn: a
    walk with no recency bound reports wherever it happened to end.
    """
    stale = _w(tail=bc.DBL_MAX_AGE_BARS + 30)
    assert bc.double_bottom_state(_ctx(stale)) is None


# ── provenance ─────────────────────────────────────────────────────────────

def test_the_contradiction_between_authorities_is_RECORDED():
    db = bc.by_key("double-bottom")
    conflict = [c for c in db.criteria
                if "CONTRADICTION" in c.condition or "classical" in str(c.value)]
    assert conflict, "the two houses' opposite requirements must be recorded"


def test_the_depth_conflict_takes_the_looser_of_two_published_numbers():
    """30% and 40% are both published and cannot both be the rule. Taking the
    looser means the gate refuses only what BOTH sources would refuse.
    """
    db = bc.by_key("double-bottom")
    assert bc.DBL_MAX_DEPTH == 0.40
    assert any("CONFLICT" in c.condition for c in db.criteria)


def test_the_dollar_denominated_early_entry_is_a_REFUSAL():
    """'Plus three points' is absolute dollars tied to a price level, given at
    two sample points. Two points do not define a function, so converting it
    to a percentage would invent the rule.
    """
    db = bc.by_key("double-bottom")
    early = [c for c in db.criteria if "shakeout plus three" in c.condition]
    assert early and early[0].value is None and early[0].missing
    assert "percentage" in early[0].missing


def test_our_only_added_number_is_the_recency_bound():
    db = bc.by_key("double-bottom")
    ours = [c for c in db.criteria if c.origin == "uct"]
    assert [c.value for c in ours] == [bc.DBL_MAX_AGE_BARS]
    assert all(c.source_id is None for c in ours)


def test_the_classical_rule_is_recorded_with_ITS_OWN_verbatim():
    """⭐ The contradiction is only recorded if the OTHER house's words are
    here too. A criterion citing a source with no quote is neither sourced,
    refused, nor ours -- the provenance rails caught exactly that on the first
    draft of this entry.
    """
    db = bc.by_key("double-bottom")
    classical = [c for c in db.criteria
                 if c.value == "classical-forbids-what-IBD-requires"]
    assert classical, "the contradiction must be a criterion"
    c = classical[0]
    assert c.quote and "variation between bottoms is small" in c.quote
    assert c.source_id and c.origin == "source"
    # And ours must still require the opposite.
    ibd = [x for x in db.criteria if x.value == "undercut-required"]
    assert ibd and "beneath" in ibd[0].quote
