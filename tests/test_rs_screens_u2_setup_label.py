"""Rails for `api/services/screener/rs_setup.py` (RS screens, unit U2a, part 3):
the Setup label, the "Tight range" tag, the three flags and "near a buy point".

The label reads a dict, so every case below states its inputs in full and the
expected answer is worked out from the rule in the plan (section 3), never
from the function. The base case is a stock at 100 with:

    50-day line 95, 8-day EMA 99 (rising), 21-day EMA 97 (rising), ATR 2,
    1.5 ATR above the 21-day, 2.5 ATR above the 50-day, a 20-session closing
    high 3 sessions ago, today's low 99.5, no pivot, 400 bars, a flat 64 closes.

Its low (99.5) is within half an ATR (1.0) of the rising 8-day (99 + 1 = 100)
and its close (100) is no more than half an ATR under it (99 - 1 = 98): a
pullback to the 8-day.
"""
from __future__ import annotations

import pytest

from api.services.screener import base_catalog, rs_setup, technicals

FLAT64 = [100.0] * 64


def _inp(**changes):
    base = {
        "ema8": 99.0, "ema21": 97.0, "ema8_rising": True, "ema21_rising": True,
        "atr14": 2.0, "atr_ext_ema21": 1.5, "atr_ext_sma50": 2.5, "high20_age": 3,
        "sma50": 95.0, "low": 99.5, "close": 100.0, "bars": 400,
        "pivot": None, "tight_consolidation": 0, "closes": list(FLAT64),
    }
    base.update(changes)
    return base


def _setup(**changes):
    return rs_setup.label(_inp(**changes))["setup"]


def _flag(closes, bars=400):
    return rs_setup.label(_inp(closes=closes, bars=bars))["flag"]


# ───────────────────────────── shape and words ──────────────────────────────

def test_the_result_has_exactly_three_keys():
    got = rs_setup.label(_inp())
    assert got == {"setup": "pullback_8", "tight": 0, "flag": None}


def test_the_member_facing_words_are_exactly_the_plans():
    assert rs_setup.SETUP_LABELS == {
        "below_50": "Below its 50-day line",
        "extended": "Extended",
        "at_pivot": "At pivot",
        "pullback_8": "Pullback to the 8-day",
        "pullback_21": "Pullback to the 21-day",
        "uptrend": "Uptrend, no setup",
        "tight": "Tight range",
        "buyout_pending": "Buyout pending",
        "one_day_move": "One-day move",
        "new_issue": "New issue",
    }
    assert rs_setup.SETUPS == ("below_50", "extended", "at_pivot", "pullback_8",
                               "pullback_21", "uptrend")
    assert rs_setup.FLAGS == ("buyout_pending", "one_day_move", "new_issue")
    assert set(rs_setup.SETUPS) | set(rs_setup.FLAGS) | {"tight"} == set(rs_setup.SETUP_LABELS)


def test_the_thresholds_are_the_published_ones():
    assert rs_setup.EXTENDED_ATR_SMA50 == 4.0
    assert rs_setup.EXTENDED_ATR_EMA21 == 3.0
    assert rs_setup.PIVOT_BELOW == 0.03
    # The 5% above a pivot is IBD's buy zone, read from the base catalog.
    assert rs_setup.IBD_BUY_ZONE is base_catalog.IBD_BUY_ZONE == 0.05
    assert rs_setup.PULLBACK_HIGH_MAX_AGE == 15
    assert rs_setup.PULLBACK_ATR_BAND == 0.5
    assert (rs_setup.BUYOUT_JUMP_PCT, rs_setup.BUYOUT_WINDOW, rs_setup.BUYOUT_MIN_SESSIONS,
            rs_setup.BUYOUT_BAND_PCT) == (15.0, 60, 5, 1.5)   # tightened 2026-11-14 (unit U4)
    assert (rs_setup.ONE_DAY_WINDOW, rs_setup.ONE_DAY_SHARE, rs_setup.ONE_DAY_MIN_PCT) == (63, 0.5, 15.0)
    assert rs_setup.NEW_ISSUE_BARS == 253
    assert rs_setup.CLOSES_NEEDED == 64


# ───────────────────────── each setup, and its edges ────────────────────────

def test_below_the_50_day_line():
    assert _setup(close=94.99, low=94.0) == "below_50"
    # Exactly on the line is not below it.
    assert _setup(close=95.0, low=94.0, ema8=96.0, ema21=96.0) != "below_50"


def test_extended_by_atr_above_the_50_day_at_exactly_four():
    assert _setup(atr_ext_sma50=4.0) == "extended"
    assert _setup(atr_ext_sma50=3.99) == "pullback_8"
    assert _setup(atr_ext_sma50=7.3) == "extended"


def test_extended_by_atr_above_the_21_day_at_exactly_three():
    assert _setup(atr_ext_ema21=3.0) == "extended"
    assert _setup(atr_ext_ema21=2.99) == "pullback_8"


def test_extended_past_a_pivot_is_more_than_five_percent():
    # Pivot 100: the buy zone tops out at 105.
    assert _setup(pivot=100.0, close=105.01, low=104.0) == "extended"
    assert _setup(pivot=100.0, close=105.0, low=104.0) == "at_pivot"


def test_at_pivot_runs_from_three_percent_below_to_five_above():
    assert _setup(pivot=100.0, close=97.0, low=96.5) == "at_pivot"      # exactly 3% below
    assert _setup(pivot=100.0, close=100.0) == "at_pivot"
    assert _setup(pivot=100.0, close=105.0, low=104.0) == "at_pivot"    # exactly 5% above
    # 96.99 is more than 3% below: not at the pivot. With the base averages it is
    # still above the 50-day (95) and its low is near the 21-day: 97 + 1 = 98.
    assert _setup(pivot=100.0, close=96.99, low=96.5) == "pullback_21"
    # No pivot, no pivot label.
    assert _setup(pivot=None, close=100.0) == "pullback_8"
    assert _setup(pivot=0.0, close=100.0) == "pullback_8"


def test_pullback_to_the_8_day_band_edges():
    # ema8 99, ATR 2: the low must be at or under 100, the close at or over 98.
    assert _setup(low=100.0) == "pullback_8"
    # Low a cent above the band: not the 8-day. The 21-day (97) needs a low at or
    # under 98, so it is not that either.
    assert _setup(low=100.01) == "uptrend"
    assert _setup(close=98.0, low=97.9, ema21=90.0) == "pullback_8"
    # Close a cent under the 8-day band, 21-day far below: no pullback.
    assert _setup(close=97.99, low=97.9, ema21=90.0) == "uptrend"


def test_pullback_needs_a_20_session_high_within_15_sessions():
    assert _setup(high20_age=15) == "pullback_8"
    assert _setup(high20_age=16) == "uptrend"
    assert _setup(high20_age=0) == "pullback_8"


def test_pullback_needs_the_average_to_be_rising():
    # 8-day not rising; the 21-day (97, rising) holds: low 97.9 <= 98, close 98 >= 96.
    assert _setup(ema8_rising=False, close=98.0, low=97.9) == "pullback_21"
    assert _setup(ema8_rising=False, ema21_rising=False, close=98.0, low=97.9) == "uptrend"
    # 8-day not rising and price nowhere near the 21-day: no pullback.
    assert _setup(ema8_rising=False) == "uptrend"


def test_pullback_to_the_21_day_and_the_8_day_wins_when_both_hold():
    # Price under the 8-day band (ema8 104: close must be >= 103), on the 21-day
    # (99.5: low <= 100.5, close >= 98.5).
    assert _setup(ema8=104.0, ema21=99.5) == "pullback_21"
    # Both hold (8-day 99, 21-day 99): the 8-day is named.
    assert _setup(ema21=99.0) == "pullback_8"
    # 21-day band edges: ema21 97 -> low <= 98, close >= 96.
    assert _setup(ema8=110.0, close=96.0, low=95.5) == "pullback_21"
    assert _setup(ema8=110.0, close=99.0, low=98.01) == "uptrend"


def test_uptrend_when_nothing_else_matches():
    assert _setup(low=103.0, close=104.0, ema8=99.0, ema21=97.0) == "uptrend"
    # On the 50-day exactly, away from both averages.
    assert _setup(close=95.0, low=94.5, ema8=110.0, ema21=110.0) == "uptrend"


def test_first_match_wins_in_the_stated_order():
    # Below the 50-day beats everything, even a reading that says extended.
    assert _setup(close=94.0, low=93.0, atr_ext_sma50=9.0, atr_ext_ema21=9.0,
                  pivot=94.0) == "below_50"
    # Extended beats at-pivot.
    assert _setup(pivot=100.0, close=101.0, atr_ext_sma50=4.2) == "extended"
    assert _setup(pivot=100.0, close=101.0, atr_ext_ema21=3.5) == "extended"
    # At-pivot beats a pullback (the base case is a pullback to the 8-day).
    assert _setup(pivot=100.0) == "at_pivot"


def test_missing_inputs_give_no_label_rather_than_a_guess():
    assert _setup(sma50=None) is None
    assert _setup(atr14=None) is None
    assert _setup(atr14=0.0) is None
    assert _setup(close=None) is None
    assert _setup(sma50=float("nan")) is None
    # The brief's rule holds even where the first rule alone could answer.
    assert _setup(close=90.0, atr14=None) is None
    # An extension that cannot be read cannot rule "Extended" out.
    assert _setup(atr_ext_sma50=None) is None
    assert _setup(atr_ext_ema21=None) is None
    # ... but "below the 50-day" needs neither.
    assert _setup(close=94.0, atr_ext_sma50=None, atr_ext_ema21=None) == "below_50"
    # A pullback that cannot be judged is not called "Uptrend, no setup".
    for key in ("ema8", "ema21", "ema8_rising", "ema21_rising", "high20_age", "low"):
        assert _setup(**{key: None}) is None, key
    # ... and an at-pivot reading does not need them.
    assert _setup(pivot=100.0, ema8=None, low=None) == "at_pivot"
    assert rs_setup.label({}) == {"setup": None, "tight": None, "flag": None}
    assert rs_setup.label(None) == {"setup": None, "tight": None, "flag": None}


# ─────────────────────────────── tight range ────────────────────────────────

def test_tight_is_a_second_tag_beside_any_setup():
    assert rs_setup.label(_inp(tight_consolidation=1)) == {
        "setup": "pullback_8", "tight": 1, "flag": None}
    assert rs_setup.label(_inp(tight_consolidation=0))["tight"] == 0
    assert rs_setup.label(_inp(tight_consolidation=None))["tight"] is None
    assert rs_setup.label(_inp(tight_consolidation=1, atr_ext_sma50=5.0)) == {
        "setup": "extended", "tight": 1, "flag": None}
    assert rs_setup.label(_inp(tight_consolidation=1, sma50=None)) == {
        "setup": None, "tight": 1, "flag": None}


# ─────────────────────────────────── flags ──────────────────────────────────

# 100 for 58 sessions, a 30% jump, then five closes within 0.77% of it.
BUYOUT = [100.0] * 58 + [130.0, 130.5, 131.0, 130.2, 130.4, 130.6]
# The owner's case (2026-11-14): an earnings gap, then three tight sessions. Under the
# first rule (3 sessions, a 2% band) this read "Buyout pending".
EARNINGS_GAP = [100.0] * 60 + [130.0, 130.5, 131.0, 130.2]
# 100 for 40 sessions, a 20% jump to 120, then a choppy 118/126 for 22 sessions,
# closing 126. Net gain 26; the jump supplied 20 of it (more than half, 13).
ONE_DAY = [100.0] * 40 + [120.0] + [118.0, 126.0] * 11 + [126.0]


def test_the_scripted_series_are_64_closes():
    assert len(BUYOUT) == len(EARNINGS_GAP) == len(ONE_DAY) == len(FLAT64) == 64


def test_buyout_pending_after_five_flat_sessions():
    assert _flag(BUYOUT) == "buyout_pending"
    # Four sessions after the jump is one short. (It reads as a one-day move
    # meanwhile: the jump is 30 of a 30.4 net gain.)
    assert _flag([100.0] * 59 + [130.0, 130.5, 131.0, 130.2, 130.4]) == "one_day_move"
    # Enough closes to judge a buyout need not be 64: the jump and five closes after it.
    assert _flag([100.0] + [130.0] * 6) == "buyout_pending"
    assert _flag([100.0] + [130.0] * 5) is None


def test_an_earnings_gap_with_three_tight_sessions_is_not_a_buyout():
    """Tightened 2026-11-14 (unit U4, the owner's concern): a stock that gapped on
    earnings and then traded tightly for three days read "Buyout pending". The jump
    must now be at least five sessions old, and every close since inside 1.5%."""
    assert _flag(EARNINGS_GAP) == "one_day_move"
    assert rs_setup.near_buy_point(rs_setup.label(_inp(closes=EARNINGS_GAP))) is False
    # The same gap, held flat for five sessions, is the pinned price of a deal.
    assert _flag([100.0] * 58 + [130.0, 130.5, 131.0, 130.2, 130.4, 130.6]) == "buyout_pending"
    # A gap that drifts 1.8% in the week after (inside the old 2% band) is still moving.
    assert _flag([100.0] * 58 + [130.0, 130.8, 131.6, 132.34, 131.9, 132.0]) == "one_day_move"


def test_buyout_jump_is_at_least_fifteen_percent():
    assert _flag([100.0] * 58 + [115.0] * 6) == "buyout_pending"
    assert _flag([100.0] * 58 + [114.9] * 6) is None


def test_buyout_band_is_one_and_a_half_percent_and_includes_the_jump_close():
    # (203 - 200) / 200 = exactly 1.5%.
    assert _flag([100.0] * 58 + [200.0, 203.0, 200.0, 201.0, 202.0, 201.5]) == "buyout_pending"
    assert _flag([100.0] * 58 + [200.0, 203.1, 200.0, 201.0, 202.0, 201.5]) == "one_day_move"
    # The five closes after the jump are tight among themselves (156 to 156.5)
    # but 4% above the jump's own close: price is still moving, not pinned.
    assert _flag([100.0] * 58 + [150.0, 156.0, 156.5, 156.0, 156.2, 156.1]) == "one_day_move"


def test_buyout_jump_must_be_inside_the_last_sixty_sessions():
    # Jump on the 60th session counting today (59 sessions ago): inside.
    assert _flag([100.0] * 4 + [115.0] * 60) == "buyout_pending"
    # One session older: outside. The same series is still a one-day move (the
    # jump is the whole 15 net gain, inside 63 sessions).
    assert _flag([100.0] * 3 + [115.0] * 61) == "one_day_move"


def test_a_band_broken_later_is_not_a_buyout():
    # Jump to 130, ten flat sessions, then 140: the range since the jump is 7.7%.
    assert _flag([100.0] * 50 + [130.0] * 10 + [140.0] * 4) == "one_day_move"


def test_one_day_move_is_more_than_half_of_a_positive_three_month_gain():
    assert _flag(ONE_DAY) == "one_day_move"
    # Net gain exactly 40 (close 140): the 20 jump is exactly half, not more.
    assert _flag(ONE_DAY[:-1] + [140.0]) is None
    assert _flag(ONE_DAY[:-1] + [139.9]) == "one_day_move"


def test_one_day_move_needs_a_fifteen_percent_session():
    # A 14.9% session supplying 14.9 of an 18 net gain: big share, too small a day.
    assert _flag([100.0] * 40 + [114.9] + [113.0, 118.0] * 11 + [118.0]) is None
    assert _flag([100.0] * 40 + [115.0] + [113.0, 118.0] * 11 + [118.0]) == "one_day_move"


def test_one_day_move_needs_a_positive_net_change():
    # Same jump, but the window opens at 200: the three-month change is negative.
    closes = [200.0] + ONE_DAY[1:]
    assert len(closes) == 64
    assert _flag(closes) is None


def test_one_day_move_reads_exactly_63_sessions():
    # The jump is the first of the 63 changes: counted.
    inside = [100.0, 120.0] + [118.0, 126.0] * 31
    assert len(inside) == 64
    assert _flag(inside) == "one_day_move"
    # One more close on the end pushes the jump out of the last 64 closes: the
    # window now opens at 120 and holds no 15% session.
    assert _flag(inside + [126.0]) is None
    # Fewer than 64 closes cannot state a 63-session change.
    assert _flag(ONE_DAY[1:]) is None


def test_new_issue_is_fewer_than_253_bars():
    assert _flag(FLAT64, bars=252) == "new_issue"
    assert _flag(FLAT64, bars=253) is None
    assert _flag(FLAT64, bars=None) is None
    assert _flag(None, bars=10) == "new_issue"
    assert _flag([], bars=400) is None


def test_flags_are_first_match_in_the_stated_order():
    # A buyout series is also a one-day move by the numbers, and here a new
    # issue too: buyout is named.
    assert _flag(BUYOUT, bars=100) == "buyout_pending"
    assert _flag(ONE_DAY, bars=100) == "one_day_move"


def test_a_bad_close_blanks_only_the_flag_that_reads_it():
    # A missing close 59 sessions back: the 63-session measure cannot be read.
    holed = list(ONE_DAY)
    holed[5] = None
    assert _flag(holed) is None
    assert _flag(holed, bars=100) == "new_issue"
    # The buyout rule reads from the jump forward, so an older hole does not blind it.
    holed = list(BUYOUT)
    holed[5] = None
    assert _flag(holed) == "buyout_pending"
    # A hole after the jump does.
    holed = list(BUYOUT)
    holed[61] = None
    assert _flag(holed) is None


# ───────────────────────────── near a buy point ─────────────────────────────

@pytest.mark.parametrize("setup, tight, flag, expected", [
    ("at_pivot", 0, None, True),
    ("pullback_8", 0, None, True),
    ("pullback_21", None, None, True),
    ("uptrend", 1, None, True),             # tight range without extended
    ("uptrend", 0, None, False),
    ("uptrend", None, None, False),
    ("extended", 1, None, False),
    ("extended", 0, None, False),
    ("below_50", 1, None, False),
    ("at_pivot", 0, "buyout_pending", False),
    ("pullback_8", 1, "one_day_move", False),
    ("at_pivot", 0, "new_issue", True),     # a new issue can still be at a pivot
    (None, 1, None, False),                 # no label: not vouched for
    (None, 0, None, False),
])
def test_near_a_buy_point(setup, tight, flag, expected):
    assert rs_setup.near_buy_point({"setup": setup, "tight": tight, "flag": flag}) is expected


def test_near_a_buy_point_on_a_label_result_and_on_nothing():
    assert rs_setup.near_buy_point(rs_setup.label(_inp())) is True
    assert rs_setup.near_buy_point(rs_setup.label(_inp(closes=BUYOUT))) is False
    assert rs_setup.near_buy_point(None) is False
    assert rs_setup.near_buy_point({}) is False


# ───────────────────────────── purity, and the join ─────────────────────────

def test_label_does_not_change_its_input():
    inp = _inp(closes=list(ONE_DAY), pivot=100.0)
    before = {k: (list(v) if isinstance(v, list) else v) for k, v in inp.items()}
    rs_setup.label(inp)
    assert inp == before


def test_label_reads_setup_inputs_output_directly():
    def bars(closes):
        return [{"t": 20250101 + i, "o": c, "h": c + 1.0, "l": c - 1.0, "c": c, "v": 1}
                for i, c in enumerate(closes)]

    # A 300-session riser (+1 a day): 12.25 ATR above its 50-day line (see the
    # setup-inputs test): extended. 64 closes rising 1 a day: no flag.
    rise = bars([100.0 + i for i in range(300)])
    got = rs_setup.label({**technicals.setup_inputs(rise), "pivot": None,
                          "tight_consolidation": 1,
                          "closes": [b["c"] for b in rise[-64:]]})
    assert got == {"setup": "extended", "tight": 1, "flag": None}
    # A 60-session faller: below its 50-day line, and a new issue.
    fall = bars([200.0 - i for i in range(60)])
    got = rs_setup.label({**technicals.setup_inputs(fall), "pivot": None,
                          "tight_consolidation": None,
                          "closes": [b["c"] for b in fall[-64:]]})
    assert got == {"setup": "below_50", "tight": None, "flag": "new_issue"}
