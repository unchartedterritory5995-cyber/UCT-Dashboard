"""A provisional row must be derived by the SAME code as a stored one.

`get_history` adds rolling ratios, hi/lo ratios, day-change percentages and the
composite breadth score on top of the collector's raw metrics. If the live row
computed those itself, the number in the score column during the session would
be a different score wearing the same name — the exact failure the live design
is built to avoid. `derive_live_row` reuses `_ratio` and
`_compute_breadth_score` directly; these tests hold it to that.
"""
from __future__ import annotations

import pytest

from api.services import breadth_monitor as bm


def _stored(date, **kw):
    base = {
        "date": date, "up_4pct_today": 100, "down_4pct_today": 50,
        "universe_count": 1000, "new_52w_highs": 80, "new_52w_lows": 10,
        "qqq_close": 500.0, "spy_close": 600.0, "adv_decline_cum": 5000,
        "avg_10d_cpc": 0.82, "pct_above_50sma": 60.0, "ratio_5day": 2.0,
        "magna_up": 300, "magna_down": 200, "cboe_putcall": 0.80,
        "aaii_spread": 5.0, "vix": 18.0, "stage2_count": 250, "adv_decline": 200,
        "hi_ratio": 8.0,
    }
    base.update(kw)
    return base


HISTORY = [_stored(f"2026-08-{d:02d}") for d in (4, 3, 2, 1)]     # newest first


def test_the_score_comes_from_the_stored_rows_own_function():
    live = {"up_4pct_today": 200, "down_4pct_today": 40, "universe_count": 1000,
            "new_52w_highs": 120, "new_52w_lows": 5, "stage2_count": 300,
            "adv_decline": 400, "magna_up": 400, "magna_down": 150,
            "cboe_putcall": 0.80, "aaii_spread": 5.0, "vix": 18.0}
    row = bm.derive_live_row(dict(live), HISTORY)
    assert row["breadth_score"] == bm._compute_breadth_score(row)
    assert 0 <= row["breadth_score"] <= 100


def test_rolling_ratios_use_the_live_day_plus_stored_history():
    live = {"up_4pct_today": 200, "down_4pct_today": 40, "universe_count": 1000}
    row = bm.derive_live_row(dict(live), HISTORY)
    window = list(reversed(HISTORY))[-4:] + [row]
    assert row["ratio_5day"] == bm._ratio(window, "up_4pct_today", "down_4pct_today")
    assert row["ratio_5day"] != HISTORY[0]["ratio_5day"]      # it actually moved


def test_hi_lo_ratios_and_day_change_track_the_live_values():
    live = {"universe_count": 2000, "new_52w_highs": 300, "new_52w_lows": 20,
            "qqq_close": 505.0, "spy_close": 594.0, "adv_decline": 100}
    row = bm.derive_live_row(dict(live), HISTORY)
    assert row["hi_ratio"] == 15.0 and row["lo_ratio"] == 1.0
    assert row["qqq_day_pct"] == 1.0                          # 500 -> 505
    assert row["spy_day_pct"] == -1.0                         # 600 -> 594
    assert row["adv_decline_cum"] == 5100


def test_a_follow_through_day_is_never_called_intraday():
    """An FTD is a claim about a finished session's close and volume."""
    live = {"universe_count": 1000, "qqq_close": 520.0, "up_vol_ratio": 2.5,
            "up_4pct_today": 400, "down_4pct_today": 10, "adv_decline": 900}
    assert bm.derive_live_row(dict(live), HISTORY)["is_ftd"] is False


def test_the_put_call_average_is_carried_not_recomputed():
    """`cboe_putcall` is an EOD print. Feeding the carried value in as today's
    would put yesterday's number in the window twice."""
    row = bm.derive_live_row({"universe_count": 1000, "cboe_putcall": 0.80},
                             HISTORY)
    assert row["avg_10d_cpc"] == HISTORY[0]["avg_10d_cpc"]


def test_no_history_still_produces_a_row():
    row = bm.derive_live_row({"universe_count": 1000, "new_52w_highs": 50}, [])
    assert row["hi_ratio"] == 5.0
    assert row["adv_decline_cum"] is None
    assert row["qqq_day_pct"] is None
    # A two-field row carries 10 of 100 points of scoring weight. Since
    # 2026-08-07 the score renormalizes over PRESENT inputs and withholds below
    # 60, rather than extrapolating a 0-100 headline from a tenth of the
    # evidence. A real live row carries ~70 before any carried field.
    assert row["breadth_score"] is None


# ── breadth_score renormalization (2026-08-07) ────────────────────────────────

def _full_row():
    return {"pct_above_50sma": 64.0, "ratio_5day": 1.4, "magna_up": 900, "magna_down": 300,
            "hi_ratio": 3.0, "cboe_putcall": 0.80, "aaii_spread": -5.0, "vix": 15.0,
            "stage2_count": 400, "universe_count": 2700, "adv_decline": 500}


def test_missing_input_is_not_scored_as_maximally_bearish():
    """`_lerp(None)` returns 0, so an ABSENT component used to score identically
    to the worst possible reading. On real rows that cost 10-15 points of a
    0-100 headline, and cboe_putcall is legitimately absent whenever CBOE has
    not published by the 4:15 collector run."""
    from api.services.breadth_monitor import _compute_breadth_score as score
    full = score(_full_row())
    no_cboe = dict(_full_row()); no_cboe["cboe_putcall"] = None
    got = score(no_cboe)
    # The old behaviour subtracted the component's whole 10-point weight.
    assert got is not None
    assert abs(got - full) < 6, f"a data gap moved the score {abs(got-full):.1f} points"


def test_score_is_unchanged_when_every_input_is_present():
    """Renormalizing must be a NO-OP on complete rows, or it rewrites history."""
    from api.services.breadth_monitor import _compute_breadth_score as score
    row = _full_row()
    assert score(row) == pytest.approx(score(dict(row)))
    assert 0 <= score(row) <= 100


def test_score_withholds_rather_than_printing_zero_on_no_data():
    from api.services.breadth_monitor import _compute_breadth_score as score
    assert score({}) is None
    thin = {"vix": 15.0, "adv_decline": 100}      # 15 of 100 weight
    assert score(thin) is None, "must not extrapolate a headline from a few inputs"


def test_a_genuinely_bearish_input_still_scores_low():
    """The renormalization must not paper over real weakness — only absence."""
    from api.services.breadth_monitor import _compute_breadth_score as score
    bad = _full_row(); bad["pct_above_50sma"] = 10.0     # present, and awful
    assert score(bad) < score(_full_row())
