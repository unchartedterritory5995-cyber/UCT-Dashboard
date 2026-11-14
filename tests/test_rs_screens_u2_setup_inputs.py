"""Rails for `technicals.setup_inputs(bars)` (RS screens, unit U2a, part 2):
the moving-average measures the Setup label reads.

Every expected value is derived BY HAND from the scripted bars, in the comment
beside it. The two facts the derivations lean on:

* On a series that moves by exactly 1 a session, an N-session EMA seeded with
  the simple mean of its first N closes sits exactly (N - 1) / 2 behind the
  close on every bar: the seed is the mean of N consecutive values, which is the
  newest minus (N - 1) / 2, and the recursion keeps that distance
  (L = (1 - k)(1 + L) at k = 2 / (N + 1) solves to L = (N - 1) / 2).
  So the 8-session EMA is 3.5 behind, the 21-session EMA 10 behind, and the
  50-session simple mean 24.5 behind.
* With high = close + 1 and low = close - 1 on that series the true range is 2 on
  every bar (high - low = 2; high - prior close = 2; low - prior close = 0), so
  Wilder's ATR is 2 whatever its seed.
"""
from __future__ import annotations

import pytest

from api.services.screener import technicals

KEYS = ("ema8", "ema21", "ema8_rising", "ema21_rising", "atr14", "atr_ext_ema21",
        "atr_ext_sma50", "high20_age", "sma50", "low", "close", "bars")


def _bars(closes, spread=1.0):
    return [{"t": 20250101 + i, "o": float(c), "h": float(c) + spread,
             "l": float(c) - spread, "c": float(c), "v": 1000}
            for i, c in enumerate(closes)]


def _rise(n):
    return [100.0 + i for i in range(n)]


def _fall(n):
    return [200.0 - i for i in range(n)]


def test_the_keys_are_exactly_the_briefs():
    got = technicals.setup_inputs(_bars(_rise(60)))
    assert tuple(got) == KEYS == technicals.SETUP_INPUT_KEYS


def test_a_steady_riser_hand_derived():
    got = technicals.setup_inputs(_bars(_rise(60)))      # last close 159
    assert got["close"] == 159.0
    assert got["low"] == 158.0
    assert got["bars"] == 60
    assert got["ema8"] == pytest.approx(155.5, abs=1e-9)        # 159 - 3.5
    assert got["ema21"] == pytest.approx(149.0, abs=1e-9)       # 159 - 10
    assert got["sma50"] == pytest.approx(134.5, abs=1e-9)       # mean of 110..159
    assert got["atr14"] == pytest.approx(2.0, abs=1e-9)
    assert got["atr_ext_ema21"] == 5.0                          # (159 - 149) / 2
    assert got["atr_ext_sma50"] == 12.25                        # (159 - 134.5) / 2
    assert got["ema8_rising"] is True
    assert got["ema21_rising"] is True
    assert got["high20_age"] == 0                               # today is the highest close


def test_a_steady_faller_hand_derived():
    got = technicals.setup_inputs(_bars(_fall(60)))      # last close 141
    assert got["ema8"] == pytest.approx(144.5, abs=1e-9)        # 141 + 3.5
    assert got["ema21"] == pytest.approx(151.0, abs=1e-9)       # 141 + 10
    assert got["sma50"] == pytest.approx(165.5, abs=1e-9)       # 141 + 24.5
    assert got["atr_ext_ema21"] == -5.0
    assert got["atr_ext_sma50"] == -12.25
    assert got["ema8_rising"] is False
    assert got["ema21_rising"] is False
    assert got["high20_age"] == 19          # the oldest of the last 20 closes is the highest


def test_rising_compares_with_five_sessions_ago_not_yesterday():
    # 59 falling closes (200 .. 142), then one close of 150.
    #   EMA8 yesterday = 142 + 3.5 = 145.5
    #   EMA8 today     = (2/9) x 150 + (7/9) x 145.5 = 1318.5 / 9 = 146.5
    #   EMA8 five sessions ago (close 146) = 149.5
    # Up on the day, still below five sessions ago: not rising.
    closes = _fall(59) + [150.0]
    got = technicals.setup_inputs(_bars(closes))
    assert got["ema8"] == pytest.approx(146.5, abs=1e-9)
    assert got["ema8_rising"] is False
    assert got["ema21_rising"] is False


def test_a_flat_average_is_not_rising():
    got = technicals.setup_inputs(_bars([50.0] * 60))
    for k in ("ema8", "ema21", "sma50"):
        assert got[k] == pytest.approx(50.0, abs=1e-9)
    assert got["ema8_rising"] is False       # equal to five sessions ago is not above it
    assert got["ema21_rising"] is False
    assert got["high20_age"] == 0            # a tie reads as the newest session


def test_high20_age_counts_sessions_since_the_highest_close_of_the_last_20():
    # Riser, last three closes cut to 150: the last 20 closes are 140..156 then
    # 150, 150, 150. The highest (156) is three sessions back.
    closes = _rise(57) + [150.0] * 3
    assert technicals.setup_inputs(_bars(closes))["high20_age"] == 3
    # Riser to index 44 (close 144), then fifteen closes of 140: the last 20 are
    # 140..144 then 140 x 15. The highest is 15 sessions back.
    closes = _rise(45) + [140.0] * 15
    assert technicals.setup_inputs(_bars(closes))["high20_age"] == 15
    # A higher close 21 sessions back is outside the window and is not read:
    # the last 20 closes are all 140, and a tie reads as the newest session.
    closes = [100.0] * 39 + [500.0] + [140.0] * 20
    assert technicals.setup_inputs(_bars(closes))["high20_age"] == 0
    closes = [100.0] * 40 + [500.0] + [140.0] * 19
    assert technicals.setup_inputs(_bars(closes))["high20_age"] == 19


def test_a_tape_with_no_range_has_no_atr_and_no_extension():
    got = technicals.setup_inputs(_bars([50.0] * 60, spread=0.0))
    assert got["atr14"] is None
    assert got["atr_ext_ema21"] is None
    assert got["atr_ext_sma50"] is None
    assert got["sma50"] == 50.0


# ───────────────────────── short series, per measure ────────────────────────

def test_empty_and_unusable_bars():
    blank = technicals.setup_inputs([])
    assert blank == {**{k: None for k in KEYS}, "bars": 0}
    assert technicals.setup_inputs(None) == blank
    # A bar with no close is dropped before anything reads it, and not counted.
    bars = _bars(_rise(60))
    bars.insert(30, {"t": 1, "o": 1.0, "h": 1.0, "l": 1.0, "c": None, "v": 1})
    got = technicals.setup_inputs(bars)
    assert got["bars"] == 60 and got["ema21"] == pytest.approx(149.0, abs=1e-9)


@pytest.mark.parametrize("key, first", [
    ("ema8", 8),              # the mean of the first 8 closes seeds it
    ("ema8_rising", 13),      # 8, and a value five sessions earlier
    ("atr14", 15),            # 14 true ranges, each needing a prior close
    ("high20_age", 20),
    ("ema21", 21),
    ("atr_ext_ema21", 21),
    ("ema21_rising", 26),
    ("sma50", 50),
    ("atr_ext_sma50", 50),
])
def test_each_measure_appears_on_its_first_possible_bar(key, first):
    assert technicals.setup_inputs(_bars(_rise(first - 1)))[key] is None
    assert technicals.setup_inputs(_bars(_rise(first)))[key] is not None


def test_one_bar_has_a_close_a_low_and_a_count_only():
    got = technicals.setup_inputs(_bars([10.0]))
    assert (got["close"], got["low"], got["bars"]) == (10.0, 9.0, 1)
    assert all(got[k] is None for k in KEYS if k not in ("close", "low", "bars"))


def test_first_values_on_a_short_riser():
    got = technicals.setup_inputs(_bars(_rise(13)))      # last close 112
    assert got["ema8"] == pytest.approx(108.5, abs=1e-9)        # 112 - 3.5
    assert got["ema8_rising"] is True
    assert got["ema21"] is None and got["atr14"] is None


# ───────────────── nothing compute_technicals returns has moved ─────────────

def test_compute_technicals_output_is_untouched_and_the_shared_value_agrees():
    for closes in (_rise(60), _fall(60), _rise(300), [50.0] * 60):
        bars = _bars(closes)
        tech = technicals.compute_technicals(bars)
        got = technicals.setup_inputs(bars)
        assert got["atr_ext_sma50"] == tech["atr_ext_sma50"]
        assert got["close"] == tech["price"]
        for k in ("ema8", "ema21", "ema8_rising", "ema21_rising", "atr14",
                  "atr_ext_ema21", "high20_age", "sma50", "low", "close", "bars"):
            assert k not in tech, k


def test_setup_inputs_does_not_change_its_argument():
    bars = _bars(_rise(60))
    snapshot = [dict(b) for b in bars]
    technicals.setup_inputs(bars)
    assert bars == snapshot
