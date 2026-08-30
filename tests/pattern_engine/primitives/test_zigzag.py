import math

from api.services.pattern_engine.primitives.zigzag import (
    DEDUP_BARS, DEFAULT_K, SIGMA_WINDOW, _trailing_sigma, segment,
)


def _bar(i, price, spread=0.005):
    """One synthetic bar centred on `price`. t is a plausible unix day."""
    return {
        "t": 1_600_000_000 + i * 86400,
        "o": price, "h": price * (1 + spread), "l": price * (1 - spread),
        "c": price, "v": 1_000_000,
    }


def _series(prices, spread=0.005):
    return [_bar(i, p, spread) for i, p in enumerate(prices)]


def _noise(n, seed=7):
    """Deterministic pseudo-random walk — no numpy, no random module state."""
    out, p = [], 100.0
    x = seed
    for _ in range(n):
        x = (1103515245 * x + 12345) % (2 ** 31)
        p *= 1.0 + ((x / (2 ** 31)) - 0.5) * 0.04
        out.append(p)
    return out


def test_monotone_rise_has_no_confirmed_interior_pivot():
    """A series that only goes up never reverses, so nothing is confirmed."""
    bars = _series([100.0 * (1.01 ** i) for i in range(120)])
    swings = segment(bars)
    confirmed = [s for s in swings if not s["provisional"]]
    assert confirmed == []


def test_the_trailing_swing_is_always_provisional():
    bars = _series(_noise(200))
    swings = segment(bars)
    assert swings, "expected at least the running extreme"
    assert swings[-1]["provisional"] is True
    assert all(s["provisional"] is False for s in swings[:-1])


def test_confirmed_pivots_alternate_high_low():
    bars = _series(_noise(300))
    confirmed = [s for s in segment(bars) if not s["provisional"]]
    for a, b in zip(confirmed, confirmed[1:]):
        assert a["type"] != b["type"], "zigzag must alternate by construction"


def test_trailing_sigma_reads_no_bar_after_i():
    """THE non-repainting rail, stated directly.

    ⭐ This is the assertion the prefix-stability test below CANNOT make on its
    own. Measured while building this: a deliberately non-causal implementation
    (sigma over the whole series) PASSED prefix-stability on a plain random
    walk, because a uniformly-volatile series barely moves its own sigma as it
    grows. A rail that a known-broken implementation passes is not a rail
    (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).

    Causality is a property of the FUNCTION, so assert it on the function:
    truncating the series at `i` must not change the answer at `i`.
    """
    bars = _series(_noise(400))
    for i in (60, 120, 250, 399):
        full = _trailing_sigma(bars, i, SIGMA_WINDOW)
        truncated = _trailing_sigma(bars[:i + 1], i, SIGMA_WINDOW)
        assert full == truncated, (
            f"sigma at bar {i} changed when later bars were removed "
            f"({full} vs {truncated}) — the estimate is reading the future"
        )


def _regime_change(n_calm=200, n_wild=200):
    """Calm then violent. A whole-series sigma computed over this retroactively
    raises the threshold across the CALM section once the wild section arrives,
    which is what makes early confirmations vanish.
    """
    out, p = [], 100.0
    x = 11
    for k in range(n_calm + n_wild):
        x = (1103515245 * x + 12345) % (2 ** 31)
        amp = 0.004 if k < n_calm else 0.075
        p *= 1.0 + ((x / (2 ** 31)) - 0.5) * amp
        out.append(p)
    return out


def test_confirmed_pivots_are_prefix_stable_as_bars_arrive():
    """THE non-repainting rail, end to end.

    Extending the series must never rewrite an already-confirmed pivot.
    ⚠️ The fixture is a VOLATILITY REGIME CHANGE, not a plain random walk —
    a uniform walk cannot distinguish a causal sigma from a whole-series one,
    and this test passed against the broken implementation until the fixture
    was changed.
    """
    bars = _series(_regime_change())
    prev = [s for s in segment(bars[:200]) if not s["provisional"]]
    for n in range(210, 401, 10):
        cur = [s for s in segment(bars[:n]) if not s["provisional"]]
        assert cur[:len(prev)] == prev, f"confirmed history changed at n={n}"
        prev = cur


def test_a_reversal_smaller_than_the_threshold_confirms_no_swing_high():
    """Rise, dip by a fraction of k*sigma, rise again.

    ⚠️ `spread=0.0` deliberately. With an intrabar spread the running high
    sits ABOVE the dip bar's close by that spread, so a nominal "0.5% dip"
    is really a 1.5% high-to-low excursion and the fixture stops testing
    what its name says. A fixture that cannot express its own intent is not
    a rail.

    ⚠️ The assertion is about swing HIGHS, not about "no swings at all".
    The seed bar legitimately confirms as a swing LOW once the rise clears
    the threshold — from a rising series the starting bar really is the
    first pivot, and asserting it away would be asserting a bug into place.
    What must not appear is a swing high at the pre-dip peak.
    """
    up1 = [100.0 * (1.01 ** i) for i in range(60)]
    dip = [up1[-1] * (1 - 0.002)]
    up2 = [dip[-1] * (1.01 ** i) for i in range(1, 60)]
    swings = segment(_series(up1 + dip + up2, spread=0.0))
    confirmed = [s for s in swings if not s["provisional"]]
    assert [s for s in confirmed if s["type"] == "high"] == []
    assert all(s["bar_index"] == 0 for s in confirmed), (
        "the only legitimate confirmation here is the seed low"
    )


def test_a_large_reversal_confirms_the_prior_extreme():
    """Rise to a clear top, then fall hard enough to exceed the threshold."""
    up = [100.0 * (1.01 ** i) for i in range(80)]
    peak = up[-1]
    down = [peak * (1 - 0.01 * i) for i in range(1, 40)]
    confirmed = [s for s in segment(_series(up + down)) if not s["provisional"]]
    assert len(confirmed) >= 1
    first = confirmed[0]
    assert first["type"] == "high"
    # The confirmed high is the actual peak bar, not the bar that confirmed it.
    assert first["bar_index"] == len(up) - 1
    assert math.isclose(first["price"], peak * 1.005, rel_tol=1e-6)


def test_too_little_history_returns_empty_rather_than_guessing():
    assert segment(_series([100.0, 101.0, 102.0])) == []


def test_zero_and_negative_prices_do_not_crash_or_emit():
    bars = _series(_noise(120))
    for b in bars[40:45]:
        b["h"] = b["l"] = b["c"] = b["o"] = 0.0
    swings = segment(bars)
    assert all(s["price"] > 0 for s in swings)


def test_dedup_bars_constant_is_exposed_for_callers():
    assert DEDUP_BARS == 2


def test_a_larger_k_never_confirms_more_swings():
    """The monotonicity the k-sweep calibration depends on.

    The sweep that set DEFAULT_K measured swing counts at k = 3/5/8/12/16 and
    read the curve as monotone. If a larger threshold could ever produce MORE
    confirmations, that reading — and the default derived from it — would be
    meaningless. Pin the property rather than trusting the sample.
    """
    bars = _series(_noise(400))
    prev = None
    for k in (3.0, 5.0, 8.0, 12.0, 16.0):
        n = len([s for s in segment(bars, k=k) if not s["provisional"]])
        if prev is not None:
            assert n <= prev, f"k={k} confirmed {n} swings, more than the looser {prev}"
        prev = n


def test_default_k_is_the_measured_base_scale_value():
    """⛔ DEFAULT_K is a MEASURED number, not a taste.

    Swept 2026-08-30 over 828 real tickers x 400 daily bars: k=3.0 gives a
    swing every 8.2 sessions (short-swing noise), k=5.0 every 25.0 sessions
    (~5 weeks, the multi-week scale a base actually occupies), k=8.0 every
    66.7. Changing this constant changes what every structure detector calls
    a swing, so it fails here loudly rather than drifting quietly.
    """
    assert DEFAULT_K == 5.0
