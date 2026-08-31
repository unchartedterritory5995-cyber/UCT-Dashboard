"""Edwards & Magee: arithmetic price scaling MANUFACTURES falling wedges.

A constant-percentage decline converges in POINTS by construction — a 5%
drop from 100 is 5 points, from 50 it is 2.5 — so two lines fitted through
its highs and lows in arithmetic space appear to converge even though the
decline is perfectly uniform in percentage terms. E&M prescribe log-space
fitting; Murphy gives no scaling caveat at all. Our `falling_wedge.py`,
`rising_wedge.py` and `trendlines.py` contained zero references to `log`.

Source: docs/superpowers/research/bases/06-edwards-magee-murphy-canon.md
"""
import math

from api.services.pattern_engine.primitives.trendlines import fit_trendline


def _pivot(i, price, kind):
    return {"t": 1_600_000_000 + i * 86400, "price": price,
            "type": kind, "strength": 60, "bar_index": i}


def _constant_pct_decline(n=40, rate=0.03, band=0.02):
    """Uniform -3%/bar. Highs and lows sit a constant PERCENTAGE apart, so
    the channel is parallel in log space and converging in arithmetic space.
    """
    highs, lows = [], []
    for i in range(n):
        mid = 100.0 * ((1 - rate) ** i)
        highs.append(_pivot(i, mid * (1 + band), "high"))
        lows.append(_pivot(i, mid * (1 - band), "low"))
    return highs, lows


def test_arithmetic_fit_makes_a_uniform_decline_look_convergent():
    """Documents the defect. Slopes differ materially in arithmetic space."""
    highs, lows = _constant_pct_decline()
    up = fit_trendline(highs)
    dn = fit_trendline(lows)
    assert up["slope"] < 0 and dn["slope"] < 0
    # The upper line falls FASTER than the lower one -> apparent convergence.
    assert up["slope"] < dn["slope"]
    gap = abs(up["slope"] - dn["slope"]) / abs(dn["slope"])
    assert gap > 0.02, "expected visible arithmetic convergence"


def test_log_space_fit_reports_a_uniform_decline_as_parallel():
    """THE CONTROL. In log space the same series has equal slopes."""
    highs, lows = _constant_pct_decline()
    up = fit_trendline(highs, log_space=True)
    dn = fit_trendline(lows, log_space=True)
    assert math.isclose(up["slope"], dn["slope"], rel_tol=1e-6), (
        f"log-space slopes should match: {up['slope']} vs {dn['slope']}"
    )


def test_log_space_is_opt_in_and_default_is_unchanged():
    highs, _ = _constant_pct_decline()
    assert fit_trendline(highs) == fit_trendline(highs, log_space=False)


def test_log_space_anchors_come_back_in_price_space():
    """Only the slope stays in log units; p1/p2 must be drawable prices."""
    highs, _ = _constant_pct_decline()
    line = fit_trendline(highs, log_space=True)
    assert 50.0 < line["p1"]["price"] < 150.0
    assert 0.0 < line["p2"]["price"] < line["p1"]["price"]


def test_log_space_refuses_non_positive_prices():
    """log(0) is undefined; refuse rather than emit a fabricated slope."""
    pivots = [_pivot(0, 10.0, "high"), _pivot(1, 0.0, "high"),
              _pivot(2, 8.0, "high")]
    line = fit_trendline(pivots, log_space=True)
    assert line["validity"] == 0.0
    assert line["slope"] == 0.0


def test_fewer_than_two_pivots_still_raises_in_both_modes():
    """The empty shape is ONLY for the log-of-non-positive case. Existing
    callers depend on the ValueError and must keep getting it.
    """
    for kw in ({}, {"log_space": True}):
        try:
            fit_trendline([_pivot(0, 10.0, "high")], **kw)
        except ValueError:
            continue
        raise AssertionError(f"expected ValueError with {kw}")
