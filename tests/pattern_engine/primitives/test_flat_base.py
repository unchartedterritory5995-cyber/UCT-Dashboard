"""The IBD flat base: what is sourced, what is ours, and the gap between."""
from api.services.screener import base_catalog as bc
from api.services.screener import bases


def _bar(i, c, hi=None, lo=None, v=1_000_000):
    return {"t": 20240000 + i, "o": c, "c": c, "v": v,
            "h": hi if hi is not None else c * 1.005,
            "l": lo if lo is not None else c * 0.995}


def _advance(n=60, start=40.0, end=60.0):
    """A clean prior advance, so the base has something to rest."""
    step = (end - start) / max(1, n - 1)
    return [_bar(i, start + i * step) for i in range(n)]


def _flat(n=30, px=60.0, half_range=0.0025, start_i=60):
    """A tight sideways stretch."""
    out = []
    for i in range(n):
        c = px + (0.02 if i % 2 else -0.02)
        out.append(_bar(start_i + i, c, hi=c * (1 + half_range),
                        lo=c * (1 - half_range)))
    return out


def _ctx(bars):
    return bases._context(bars, bars)


def _det(bars):
    return bc.by_key("flat-base").detect(_ctx(bars))


# ── the sourced rules ──────────────────────────────────────────────────────

def test_a_series_shorter_than_five_weeks_has_no_base():
    assert bc.flat_base_state(_flat(n=bc.FLAT_MIN_BARS - 1, start_i=0)) is None


def test_a_PURE_ADVANCE_is_not_a_flat_base():
    """The defect this gate exists for, pinned.

    A smooth 50% advance sits entirely inside the published 15% depth ceiling,
    so the sourced rules alone accepted it. IBD's flat base is price that
    "moved horizontally"; a trend is the one thing it is not.
    """
    adv = _advance(n=60, start=40.0, end=60.0)
    st = bc.flat_base_state(adv)
    assert st is None or st["drift"] <= bc.FLAT_MAX_DRIFT
    assert _det(adv) is False


def test_the_base_does_not_swallow_the_advance_it_rests():
    """The window is chosen on horizontality, so it stops at the trend's edge.

    Choosing the longest window inside the depth ceiling and only then testing
    drift measured a window that was part advance, and refused the base for a
    property of price that was never part of it.
    """
    bars = _advance(n=60) + _flat(n=30)
    st = bc.flat_base_state(bars)
    assert st is not None
    assert st["bars"] <= 40, (
        "the base ran %d bars into a 30-bar consolidation -- it is eating the "
        "advance" % st["bars"])


def test_the_pivot_is_the_base_high_plus_ten_cents():
    bars = _advance() + _flat()
    st = bc.flat_base_state(bars)
    assert st is not None
    assert abs(st["pivot"] - (st["high"] + bc.FLAT_PIVOT_PAD)) < 1e-9


def test_depth_is_measured_INTRADAY_not_close_to_close():
    """⭐ The one place the house names its price series, so it is the one
    place a shortcut is silently wrong.

    Closes here are dead flat; the intraday extremes span far more than 15%.
    Measured on closes this reads as a perfect base. Measured as published, it
    is not a flat base at all.
    """
    bars = _advance()
    for i in range(40):
        bars.append(_bar(60 + i, 60.0, hi=66.0, lo=54.0))   # 18% high-to-low
    closes = [b["c"] for b in bars[-40:]]
    assert max(closes) == min(closes), "fixture: closes are flat"
    st = bc.flat_base_state(bars)
    assert st is None or st["bars"] < 40, (
        "a 40-bar window spanning 18% intraday was accepted -- depth is being "
        "read off closes")


def test_the_longest_qualifying_window_is_returned():
    """Depth only grows with the window, so the first violation is final."""
    bars = _advance() + _flat(n=40)
    st = bc.flat_base_state(bars)
    assert st is not None and st["bars"] >= 40


# ── the gates that are OURS ────────────────────────────────────────────────

def test_a_LOOSE_base_is_refused_even_though_the_published_rules_pass():
    """Wide daily ranges, but the 5-week length and 15% depth both hold."""
    bars = _advance()
    for i in range(30):
        c = 60.0 + (0.05 if i % 2 else -0.05)
        bars.append(_bar(60 + i, c, hi=c * 1.03, lo=c * 0.97))   # ~6% daily
    st = bc.flat_base_state(bars)
    assert st is not None, "fixture: the published rules must pass"
    assert st["depth"] <= bc.FLAT_MAX_DEPTH
    assert st["tightness"] > bc.FLAT_MAX_TIGHTNESS
    assert _det(bars) is False


def test_a_tight_base_with_NO_prior_advance_is_refused():
    """A stock that never advanced is not resting one."""
    flat_forever = [_bar(i, 60.0, hi=60.15, lo=59.85) for i in range(90)]
    st = bc.flat_base_state(flat_forever)
    assert st is not None, "fixture: it is a tight, shallow, long-enough range"
    assert (st["prior_advance"] or 0) < bc.FLAT_PRIOR_ADVANCE
    assert bc.by_key("flat-base").detect(_ctx(flat_forever)) is False


def test_a_tight_base_resting_a_real_advance_is_ACCEPTED():
    """Non-vacuity: the gates must not refuse everything."""
    bars = _advance() + _flat()
    assert _det(bars) is True


# ── provenance ─────────────────────────────────────────────────────────────

def test_the_unquantified_tightness_rule_is_recorded_as_a_REFUSAL():
    """The house demands tight trading and publishes no number. That is a
    sourced refusal, and it must not quietly become our threshold wearing
    IBD's name.
    """
    fb = bc.by_key("flat-base")
    sourced = [c for c in fb.criteria
               if "tightness" in c.condition.lower() and c.origin == "source"]
    assert sourced, "the published tightness requirement must be recorded"
    assert all(c.value is None and c.missing for c in sourced)


def test_both_added_gates_are_attributed_to_US_not_to_the_house():
    fb = bc.by_key("flat-base")
    ours = {c.value for c in fb.criteria if c.origin == "uct"}
    assert bc.FLAT_MAX_TIGHTNESS in ours
    assert bc.FLAT_PRIOR_ADVANCE in ours
    for c in fb.criteria:
        if c.origin == "uct":
            assert c.source_id is None, (
                "a criterion of ours must not carry a source id")


def test_the_published_depth_conflict_is_recorded_not_averaged():
    """15% and 10-15% are both published by the same house. Averaging them
    would invent a number nobody wrote down.
    """
    fb = bc.by_key("flat-base")
    assert any("CONFLICT" in c.condition for c in fb.criteria)
    assert bc.FLAT_MAX_DEPTH == 0.15


def test_the_head_max_deque_matches_a_naive_rolling_max():
    """The optimisation that made the ledger scan finish, checked against the
    obvious implementation it replaced.

    A rolling-max bug would not crash; it would quietly move where bases start
    and change every downstream number. Random series, including flat runs and
    repeated highs, which is where a monotonic deque's <= vs < is decided.
    """
    import random
    rng = random.Random(20260830)
    for trial in range(60):
        n = rng.randint(1, 60)
        bars = []
        for i in range(n):
            h = rng.choice([1.0, 1.0, 2.0, 3.0, rng.uniform(0.5, 4.0)])
            bars.append(_bar(i, h, hi=h, lo=h * 0.9))
        fast = bc._head_max_array(bars)
        slow = [max((b["h"] for b in bars[i:i + bc.FLAT_HEAD_BARS]), default=0.0)
                for i in range(n)]
        assert fast == slow, "trial %d n=%d" % (trial, n)


def test_passing_a_cached_head_max_changes_nothing():
    """The cache is a speed change, not a behaviour change."""
    bars = _advance() + _flat()
    a = bc.flat_base_state(bars)
    b = bc.flat_base_state(bars, head_max=bc._head_max_array(bars))
    assert a == b


def test_an_end_bounded_base_CANNOT_see_past_its_end():
    """⛔⛔ CAUSALITY, ASSERTED DIRECTLY.

    `base_on_base_state` computes `head_max` over the FULL series once and
    passes it into `flat_base_state(bars, end=e1)` for a dozen truncated
    views. That is a cache over data the truncated view is not entitled to
    see: `head_max[i]` reads up to `FLAT_HEAD_BARS` bars forward, so if the
    head window could ever reach past `end`, a base's start would be chosen
    using bars that had not happened yet.

    It cannot today, because the head sits at `end - k` with k >= FLAT_MIN_BARS
    (25) and the window is only FLAT_HEAD_BARS (5) wide. But that is an
    accident of two constants, and a look-ahead here would not crash -- it
    would quietly produce a better-looking structure and a spectacular lift.
    So the guarantee is asserted against the honest computation rather than
    argued from the constants.
    """
    bars = _advance(n=80, start=30.0, end=60.0) + _flat(n=40) + \
        _advance(n=30, start=60.0, end=95.0)
    full_head = bc._head_max_array(bars)
    for end in range(60, len(bars) + 1, 7):
        cached = bc.flat_base_state(bars, end=end, head_max=full_head)
        honest = bc.flat_base_state(bars[:end])
        assert cached == honest, (
            "end=%d: the cached view disagrees with one computed from the "
            "truncated series alone -- future bars are leaking in" % end)

    assert bc.FLAT_HEAD_BARS < bc.FLAT_MIN_BARS, (
        "the head window must fit strictly inside the shortest base, or the "
        "cached head_max leaks bars from beyond `end`")
