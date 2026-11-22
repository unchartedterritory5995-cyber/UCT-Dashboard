"""RS screens unit U9, part 4: the Leader score test's specification and arithmetic.

The test was fixed before any result existed (pre-registered 2026-11-14), so every
number of it is pinned here against the brief, and every statistic the verdict stands
on is checked against a case worked by hand.

Why each rail exists:
  * a test whose bar can be moved after a run is not a test: a changed constant must
    go red here, by name;
  * the pass rule is three small functions (interval, years, order); each has a
    boundary that is easy to get wrong by one (a 0.8 that must pass, a third year that
    must count, a block that must not read past the series).
"""
from __future__ import annotations

import random

import pytest

from api.services import relative_strength as rs
from api.services.rs_leader_test import spec, stats
from api.services.screener import rs_post_pass, rs_screens, technicals

# ───────────────────────── the specification, number by number ───────────────

SPEC = {
    "PREREGISTERED": "2026-11-14",
    "HOLDOUT_SESSIONS": 252,            # the newest 252 sessions are a holdout
    "FORMATION_STEP": 5,                # every fifth session is a formation date
    "BENCHMARK": "SPY",
    "UNIVERSE_MIN_PRICE": 10.0,         # close >= $10
    "UNIVERSE_MIN_DOLLAR_VOLUME": 20_000_000.0,   # 30-session average dollar volume >= $20M
    "DOLLAR_VOLUME_SESSIONS": 30,
    "MIN_LISTING_BARS": 253,            # at least 253 bars in the current listing
    "GROUP_CHANGE_SESSIONS": 21,        # the Group part's 1-month change (the screener's)
    "GATE_MIN_RATING": 80,              # rating >= 80
    "GATE_MIN_ADR_PCT": 3.0,            # 21-session average daily range >= 3%
    "ADR_SESSIONS": 21,
    "TREND_AVERAGE_SESSIONS": 200,      # close above a 200-day average ...
    "TREND_RISING_SESSIONS": 20,        # ... that is above its value 20 sessions earlier
    "HIGH_SESSIONS": 252,               # within 25% of the 252-session high
    "GATE_MAX_BELOW_HIGH_PCT": -25.0,
    "RS_LINE_EMA_SESSIONS": 21,         # RS line above its 21-session EMA
    "MIN_QUALIFIERS": 25,               # skip a date with fewer than 25 qualifiers
    "QUANTILES": 5,
    "TOP_N": 50,
    "HORIZONS": (5, 10, 21, 63),
    "PRIMARY_HORIZON": 21,              # ONE primary endpoint, at 21 sessions
    "ROUND_TRIP_COST_PCT": 0.2,         # net of 0.2% round trip
    "BASELINE_MIN_ADR_PCT": 3.0,        # primary baseline: liquid names with range >= 3%
    "BOOTSTRAP_BLOCK_SESSIONS": 63,
    "BOOTSTRAP_DRAWS": 2000,
    "BOOTSTRAP_INTERVAL": 0.90,
    "BOOTSTRAP_SEED": 20261114,
    "BOOTSTRAP_BLOCK_DATES": 13,        # 63 sessions at one date every 5
    "YEARS_COMPARED": 4,                # at least 3 of the 4 most recent years ...
    "YEARS_POSITIVE_MIN": 3,
    "YEAR_MIN_FORMATION_DATES": 20,     # ... with 20+ formation dates
    "SPEARMAN_MIN": 0.8,
    "LEAVE_ONE_OUT_MIN_GAIN_PCT": 0.25,
    "LEAVE_ONE_OUT_YEARS_MIN": 3,
    "EXCURSION_HORIZONS": (10, 21),
    "EXTENDED_ATR_MULTIPLE": 4.0,       # 4+ ATR above the 50-day
    "EXTENDED_AVERAGE_SESSIONS": 50,
    "ATR_SESSIONS": 14,
    "REGIME_AVERAGE_SESSIONS": 200,     # SPY above or below its 200-day average
    "WARMUP_CALENDAR_DAYS": 800,
}


@pytest.mark.parametrize("name", sorted(SPEC))
def test_each_number_of_the_specification(name):
    assert getattr(spec, name) == SPEC[name], (
        f"{name} moved. The test was pre-registered on {spec.PREREGISTERED}: a different "
        "number is a new dated specification with its own record, not an edit.")


def test_the_specification_holds_nothing_unpinned():
    """A constant added to `spec` without a pin here could be tuned unseen."""
    named = {k for k, v in vars(spec).items()
             if k.isupper() and isinstance(v, (int, float, str, tuple))}
    assert named - set(SPEC) == {"CAVEAT", "GATE_OMISSIONS"}
    assert set(spec.as_dict()) == named
    assert spec.as_dict()["HORIZONS"] == [5, 10, 21, 63]


def test_the_caveat_is_the_briefs_sentence_word_for_word():
    assert spec.CAVEAT == ("Universe as held: stocks that later delisted are missing, "
                           "which flatters every number here.")
    assert len(spec.GATE_OMISSIONS) == 2


def test_the_gate_tested_is_the_gate_a_member_would_see_today():
    """The numbers are written in `spec` so a later change to the screen cannot move a
    test fixed on 2026-11-14. Today they are the screen's own. If this goes red the
    screen changed: the test did not, and that difference needs a decision and a new
    dated specification, never an edit to make this pass."""
    assert spec.GATE_MIN_RATING == rs_screens.LEADERS_MIN_RATING
    assert spec.GATE_MIN_ADR_PCT == rs_screens.LEADERS_MIN_ADR_PCT
    assert spec.GATE_MAX_BELOW_HIGH_PCT == rs_screens.LEADERS_MAX_BELOW_HIGH
    assert spec.UNIVERSE_MIN_PRICE == rs_post_pass.LIQUID_FLOOR["price_min"]
    assert spec.UNIVERSE_MIN_DOLLAR_VOLUME == rs_post_pass.LIQUID_FLOOR["dollar_vol_30d_min"]
    assert spec.RS_LINE_EMA_SESSIONS == rs.DEFAULT_MA_LENGTH
    assert spec.HIGH_SESSIONS == rs.DEFAULT_LOOKBACK
    assert spec.TREND_RISING_SESSIONS == technicals.RISING_SPAN
    assert spec.ADR_SESSIONS == technicals._WINDOW_BARS["adr_pct"]


# ───────────────────────── quintiles and lists ───────────────────────────────

def test_quintiles_split_evenly_and_the_top_is_five():
    scores = {f"T{i:02d}": float(i) for i in range(25)}
    q = stats.quintiles(scores)
    assert [sum(1 for v in q.values() if v == k) for k in range(1, 6)] == [5, 5, 5, 5, 5]
    assert {t for t, v in q.items() if v == 5} == {"T20", "T21", "T22", "T23", "T24"}
    assert {t for t, v in q.items() if v == 1} == {"T00", "T01", "T02", "T03", "T04"}
    # 27 stocks: floor(rank x 5 / 27) + 1 gives 6, 5, 6, 5, 5
    q27 = stats.quintiles({f"T{i:02d}": float(i) for i in range(27)})
    assert [sum(1 for v in q27.values() if v == k) for k in range(1, 6)] == [6, 5, 6, 5, 5]
    assert stats.quantile_of(0, 27) == 1 and stats.quantile_of(26, 27) == 5


def test_ties_are_ordered_by_ticker_so_the_split_is_stable():
    a = stats.quintiles({"B": 1.0, "A": 1.0, "C": 1.0, "E": 1.0, "D": 1.0})
    assert a == {"A": 1, "B": 2, "C": 3, "D": 4, "E": 5}
    assert a == stats.quintiles({"E": 1.0, "D": 1.0, "C": 1.0, "B": 1.0, "A": 1.0})


def test_top_is_the_highest_first_and_capped():
    scores = {"A": 3.0, "B": 9.0, "C": 9.0, "D": 1.0}
    assert stats.top(scores, 3) == ["B", "C", "A"]
    assert stats.top(scores) == ["B", "C", "A", "D"], "fewer than 50 names: all of them"
    assert len(stats.top({f"T{i}": float(i) for i in range(80)})) == 50


# ───────────────────────── order: Spearman ───────────────────────────────────

@pytest.mark.parametrize("means, rho", [
    ([1, 2, 3, 4, 5], 1.0),
    ([5, 4, 3, 2, 1], -1.0),
    ([1, 2, 3, 5, 4], 0.9),             # one adjacent swap: 1 - 6 x 2 / 120
    ([2, 1, 3, 5, 4], 0.8),             # two adjacent swaps: 1 - 6 x 4 / 120
    ([3, 2, 1, 4, 5], 0.6),             # the bottom three reversed: 1 - 6 x 8 / 120
])
def test_spearman_by_hand(means, rho):
    assert stats.spearman([1, 2, 3, 4, 5], means) == pytest.approx(rho)


def test_spearman_edges():
    assert stats.spearman([1, 2, 3], [7, 7, 7]) is None, "a flat side has no order"
    assert stats.spearman([1, 2], [1]) is None and stats.spearman([1], [1]) is None
    # ties share the mean rank: ranks 1.5, 1.5, 3 against 1, 2, 3
    assert stats.spearman([10, 10, 20], [1, 2, 3]) == pytest.approx(0.8660254, abs=1e-6)
    assert (stats.spearman([1, 2, 3, 4, 5], [2, 1, 3, 5, 4]) >= spec.SPEARMAN_MIN), \
        "exactly 0.8 meets the bar"


# ───────────────────────── the bootstrap ─────────────────────────────────────

def _by_hand(values, block, draws, seed):
    """The documented algorithm, written out again from the docstring."""
    rng, n = random.Random(seed), len(values)
    need = -(-n // block)
    means = []
    for _ in range(draws):
        picked = []
        for _b in range(need):
            s = rng.randrange(n - block + 1)
            picked += values[s:s + block]
        means.append(sum(picked[:n]) / n)
    return sorted(means)


def test_the_bootstrap_is_the_documented_moving_block_one():
    values = [1.0, 2.0, 3.0, 4.0, 5.0]             # 5 values, blocks of 2: three blocks, cut to 5
    got = stats.block_bootstrap(values, block=2, draws=20, interval=0.9, seed=7)
    means = _by_hand(values, 2, 20, 7)
    # 20 draws at 90%: one mean is cut from each end
    assert (got["low"], got["high"]) == (pytest.approx(means[1]), pytest.approx(means[18]))
    assert got["values"] == 5 and got["draws"] == 20 and got["block_dates"] == 2 and got["seed"] == 7
    assert means[0] <= got["low"] <= got["high"] <= means[-1]


def test_the_bootstrap_is_seeded_and_reproducible():
    rng = random.Random(3)
    values = [rng.gauss(0.5, 2.0) for _ in range(120)]
    a, b = stats.block_bootstrap(values), stats.block_bootstrap(values)
    assert a == b and a["seed"] == spec.BOOTSTRAP_SEED and a["draws"] == 2000
    assert a["block_dates"] == 13 and a["interval"] == 0.90
    other = stats.block_bootstrap(values, seed=spec.BOOTSTRAP_SEED + 1)
    assert (other["low"], other["high"]) != (a["low"], a["high"])
    # with 2,000 draws the 101st and the 1,900th sorted means are the interval
    means = _by_hand(values, 13, 2000, spec.BOOTSTRAP_SEED)
    assert (a["low"], a["high"]) == (pytest.approx(means[100]), pytest.approx(means[1899]))


def test_the_interval_reads_a_clear_effect_and_a_null_one():
    rng = random.Random(5)
    clear = [2.0 + rng.gauss(0, 1.0) for _ in range(200)]
    null = [rng.gauss(0, 1.0) for _ in range(200)]
    assert stats.block_bootstrap(clear)["low"] > 0
    got = stats.block_bootstrap(null)
    assert got["low"] < 0 < got["high"]
    flat = stats.block_bootstrap([1.5] * 40)
    assert flat["low"] == flat["high"] == pytest.approx(1.5)


def test_fewer_values_than_one_block_forms_no_interval():
    assert stats.block_bootstrap([1.0] * 12) is None
    assert stats.block_bootstrap([1.0] * 13) is not None
    assert stats.block_bootstrap([]) is None


def test_independent_blocks_counts_non_overlapping_21_session_windows():
    """Formation dates every 5 sessions from 0 to 100: 0, then the first at least 21
    later is 25, then 50, 75, 100."""
    assert stats.independent_blocks(range(0, 101, 5)) == 5
    assert stats.independent_blocks([0, 20, 21, 41, 42]) == 3        # 0, 21, 42
    assert stats.independent_blocks([40, 0, 21]) == 2, "order does not matter"
    assert stats.independent_blocks([]) == 0 and stats.independent_blocks([7]) == 1


# ───────────────────────── the year rule ─────────────────────────────────────

def _years(**means):
    """``{year: 20 values with that mean}``; a tuple value is ``(mean, count)``."""
    out = {}
    for y, m in means.items():
        m, n = m if isinstance(m, tuple) else (m, 20)
        out[int(y[1:])] = [m] * n
    return out


def test_three_of_the_four_most_recent_years_must_be_positive():
    rule = stats.year_rule(_years(y2021=1.0, y2022=0.5, y2023=-0.2, y2024=0.1))
    assert rule["met"] and rule["positive"] == 3 and rule["eligible_years"] == 4
    assert list(rule["years"]) == ["2021", "2022", "2023", "2024"]
    assert rule["years"]["2023"] == {"mean": pytest.approx(-0.2), "dates": 20}
    two = stats.year_rule(_years(y2021=1.0, y2022=0.5, y2023=-0.2, y2024=-0.1))
    assert not two["met"] and two["positive"] == 2
    assert stats.year_rule(_years(y2021=1.0, y2022=1.0, y2023=1.0, y2024=0.0))["positive"] == 3, \
        "a mean of exactly zero is not positive"


def test_only_years_with_twenty_dates_count_and_only_the_latest_four():
    """2020 has 19 dates and is not a year for this rule. Of the five that are, the
    oldest (2021, strongly positive) is not among the four most recent."""
    per_year = _years(y2020=(5.0, 19), y2021=5.0, y2022=-1.0, y2023=-1.0, y2024=1.0, y2025=1.0)
    assert stats.years_compared(per_year) == [2022, 2023, 2024, 2025]
    rule = stats.year_rule(per_year)
    assert rule["positive"] == 2 and not rule["met"]


def test_fewer_than_four_eligible_years_cannot_pass():
    rule = stats.year_rule(_years(y2022=1.0, y2023=1.0, y2024=1.0, y2025=(1.0, 19)))
    assert rule["positive"] == 3 and rule["eligible_years"] == 3 and not rule["met"]
    assert "found 3" in rule["reason"]
    assert stats.year_rule({})["met"] is False


def test_by_year_groups_dated_values_and_drops_blanks():
    got = stats.by_year([(20240105, 1.0), (20241230, 2.0), (20250102, 3.0), (20250103, None)])
    assert got == {2024: [1.0, 2.0], 2025: [3.0]}


# ───────────────────────── leave one out: a report, never a change ───────────

def test_removal_helps_needs_a_quarter_point_in_three_of_four_years():
    full = _years(y2021=1.0, y2022=1.0, y2023=1.0, y2024=1.0)
    helped = stats.leave_one_out_rule(full, _years(y2021=1.25, y2022=1.5, y2023=1.25, y2024=0.0))
    assert helped["removal_helps"] and helped["years_improved"] == 3
    assert helped["gain_by_year"] == {"2021": 0.25, "2022": 0.5, "2023": 0.25, "2024": -1.0}
    assert helped["decision"] == "KEEP", "the harness reports; it never changes a weight"
    short = stats.leave_one_out_rule(full, _years(y2021=1.24, y2022=1.5, y2023=1.5, y2024=1.0))
    assert not short["removal_helps"] and short["years_improved"] == 2
    same = stats.leave_one_out_rule(full, full)
    assert not same["removal_helps"] and same["years_improved"] == 0 and same["decision"] == "KEEP"


def test_removal_cannot_help_without_four_years():
    full = _years(y2022=1.0, y2023=1.0, y2024=1.0)
    got = stats.leave_one_out_rule(full, _years(y2022=9.0, y2023=9.0, y2024=9.0))
    assert got["years_improved"] == 3 and got["years_compared"] == 3 and not got["removal_helps"]


# ───────────────────────── small helpers ─────────────────────────────────────

def test_means_medians_and_shares_skip_blanks_and_are_blank_when_empty():
    assert stats.mean([1.0, None, 3.0]) == 2.0 and stats.mean([None]) is None and stats.mean([]) is None
    assert stats.med([5.0, None, 1.0, 3.0]) == 3.0 and stats.med([]) is None
    assert stats.share([True, False, None, True]) == pytest.approx(2 / 3) and stats.share([None]) is None
