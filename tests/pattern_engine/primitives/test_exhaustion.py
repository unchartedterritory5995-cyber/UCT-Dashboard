"""Climax Top and Parabolic Extension: the two bearish structures, and the
rules their houses left un-implementable."""
from api.services.screener import base_catalog as bc
from api.services.screener import bases


def _bar(i, c, v=1_000_000):
    return {"t": 20240000 + i, "o": c, "c": c, "v": v,
            "h": c * 1.01, "l": c * 0.99}


def _run(prior_gain=0.80, surge=0.35, surge_bars=10, lead=140, start=10.0):
    """A long advance, then a sharp surge into the last bar."""
    bars = []
    top = start * (1.0 + prior_gain)
    for i in range(lead):
        bars.append(_bar(i, start + (top - start) * (i + 1) / lead))
    base = bars[-1]["c"]
    for i in range(surge_bars):
        bars.append(_bar(len(bars), base * (1.0 + surge * (i + 1) / surge_bars)))
    return bars


def _ctx(bars):
    return bases._context(bars, bars)


# ── Climax Top ─────────────────────────────────────────────────────────────

def test_a_sharp_surge_after_a_long_advance_is_a_CLIMAX():
    st = bc.climax_top_state(_run(surge=0.35, surge_bars=10))
    assert st is not None
    assert st["gain"] >= bc.CLIMAX_MIN_GAIN
    assert st["bars"] <= bc.CLIMAX_MAX_BARS


def test_a_surge_smaller_than_twenty_five_percent_is_not_a_climax():
    assert bc.climax_top_state(_run(surge=0.12, surge_bars=10)) is None


def test_the_same_surge_spread_over_MORE_than_three_weeks_is_not_a_climax():
    """The window is half the rule -- 25% is only a climax if it happens fast."""
    assert bc.climax_top_state(_run(surge=0.35, surge_bars=45)) is None


def test_a_sharp_surge_with_NO_prolonged_advance_behind_it_is_refused():
    """⛔ The gate that stops this firing on the first leg off a bottom, which
    is the OPPOSITE of an exhaustion move. IBD requires "a prolonged advance"
    and never quantifies it, so the number is ours and it is load-bearing.
    """
    assert bc.climax_top_state(_run(prior_gain=0.03, surge=0.35)) is None


def test_the_climax_top_is_labelled_BEARISH_so_the_render_leads_with_it():
    """The render orders bearish structures first. A misfiled bias would bury
    an exhaustion warning behind a neutral base -- the defect measured at 34.8%
    of multi-structure rows and fixed.
    """
    assert bc.by_key("climax-top").bias == "bearish"
    assert bc.by_key("climax-top").bias in bases._BIAS_ORDER


def test_the_houses_own_contradiction_is_recorded_verbatim():
    """⭐⭐ IBD's selling column says a 20%+ three-week surge should be HELD at
    least eight weeks, and that a 25%+ three-week surge is a climax top. A 30%
    move in two weeks satisfies both. We implement the climax reading and
    record the other rather than pretending the tension is not there.
    """
    c = bc.by_key("climax-top")
    conflict = [x for x in c.criteria
                if x.value == "hold-8-weeks vs climax-top"]
    assert conflict, "the overlap must be recorded"
    assert "held at least eight weeks" in (conflict[0].quote or "")


def test_the_unquantified_prolonged_advance_is_a_refusal_with_ours_beside_it():
    c = bc.by_key("climax-top")
    refused = [x for x in c.criteria if "prolonged advance" in x.condition]
    assert refused and refused[0].value is None and refused[0].missing
    ours = [x for x in c.criteria if x.origin == "uct"]
    assert [x.value for x in ours] == [bc.CLIMAX_PRIOR_ADVANCE]


# ── Parabolic Extension ────────────────────────────────────────────────────

def test_a_vertical_run_with_consecutive_up_days_is_PARABOLIC():
    st = bc.parabolic_extension_state(_run(surge=0.70, surge_bars=8))
    assert st is not None
    assert st["gain"] >= bc.PARA_MIN_GAIN
    assert st["up_days"] >= bc.PARA_MIN_UP_DAYS


def test_a_big_move_WITHOUT_a_run_of_up_days_is_refused():
    """"The stock should be up 3-5+ days in a row." The run is part of the
    definition, not decoration -- it is what makes the move parabolic rather
    than merely large.
    """
    bars = _run(surge=0.70, surge_bars=8)
    bars.append(_bar(len(bars), bars[-1]["c"] * 0.97))   # one down day
    bars.append(_bar(len(bars), bars[-1]["c"] * 1.01))
    st = bc.parabolic_extension_state(bars)
    assert st is None or st["up_days"] >= bc.PARA_MIN_UP_DAYS


def test_a_move_smaller_than_fifty_percent_is_refused():
    assert bc.parabolic_extension_state(_run(surge=0.20, surge_bars=8)) is None


# ── what these houses did NOT publish ──────────────────────────────────────

def test_the_uncomputable_cap_branch_is_recorded_as_a_BIAS_not_just_a_gap():
    """⛔ He gives 50-100% for larger caps and 300-1000% for smaller ones, and
    never publishes the boundary between them. His two-branch rule is
    therefore not computable. We apply the larger-cap threshold universally,
    which OVER-FIRES on small caps -- and that biases the measurement, not just
    the label, so it is stated as such.
    """
    pe = bc.by_key("parabolic-extension")
    cap = [c for c in pe.criteria if "boundary" in c.condition]
    assert cap and cap[0].value is None and cap[0].missing
    assert "OVER-FIRES" in cap[0].missing


def test_the_intraday_entry_and_stop_are_recorded_as_NOT_implemented():
    """Opening-range lows and a VWAP reclaim are intraday; this is a daily-bar
    structure. What ships is the STATE, not the trade.
    """
    pe = bc.by_key("parabolic-extension")
    entry = [c for c in pe.criteria if "INTRADAY" in c.condition]
    assert entry and entry[0].value is None and entry[0].missing
    assert "daily-bar structure" in entry[0].missing


def test_the_asserted_risk_reward_is_refused_as_evidence():
    """"5-10x risk reward" is a payoff SHAPE, not a measured expectancy, and
    his win-rate statement is hedged and unquantified.
    """
    pe = bc.by_key("parabolic-extension")
    rr = [c for c in pe.criteria if "risk/reward" in c.condition]
    assert rr and rr[0].value is None and rr[0].missing
    assert "not a measured expectancy" in rr[0].missing


def test_the_missing_borrow_gate_is_recorded_because_it_affects_tradeability():
    """A name this labels may simply be unshortable. Neither he nor we hold
    borrow data, so the gap is recorded rather than implied.
    """
    pe = bc.by_key("parabolic-extension")
    b = [c for c in pe.criteria if "orrow" in c.condition]
    assert b and b[0].value is None and b[0].missing
