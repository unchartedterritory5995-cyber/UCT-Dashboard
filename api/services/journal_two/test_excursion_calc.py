"""Excursion calc — pure MFE/MAE + exit-efficiency math (Journal A+ Phase 2, Task 1).

Bars are OHLC dicts already fetched by a later task; this module is pure math
(no I/O). Excursion PRICE→R conversion reuses `trade_r_multiple` from
`calculations.py` (same denominator as the trade's own R).
"""

import pytest

from api.services.journal_two.excursion_calc import compute_excursion


# ── Long winner — the canonical worked example ───────────────────────────
# entry 100, stop 95, exit 110; a bar reaches high 115.
#   mfe_price 115, mfe_r = (115-100)/(100-95) = 3.0
#   exit_efficiency = (110-100)/(115-100) = 0.6667
#   missed_r = 3.0 - (110-100)/(100-95) = 3.0 - 2.0 = 1.0
def test_long_winner():
    bars = [
        {"t": 1000, "h": 105.0, "l": 98.0, "o": 100.0, "c": 104.0},
        {"t": 2000, "h": 115.0, "l": 104.0},  # favorable extreme (max high)
        {"t": 3000, "h": 112.0, "l": 96.0},   # adverse extreme (min low)
    ]
    out = compute_excursion(
        "Long", 100.0, 95.0, 1000, 3000, bars, exit_price=110.0
    )
    assert out is not None
    assert out["mfe_price"] == 115.0
    assert out["mfe_ts"] == 2000
    assert out["mae_price"] == 96.0
    assert out["mae_ts"] == 3000
    assert out["mfe_r"] == pytest.approx(3.0)
    assert out["mae_r"] == pytest.approx((96.0 - 100.0) / (100.0 - 95.0))  # -0.8
    assert out["exit_efficiency"] == pytest.approx(0.6667, abs=1e-3)
    assert out["missed_r"] == pytest.approx(1.0)


# ── Short winner — favorable = price DOWN ────────────────────────────────
# entry 50, stop 52.5, exit 45; a bar reaches low 42.
#   mfe_price = min low = 42, mfe_r = (50-42)/(52.5-50) = 3.2
#   mae_price = max high = 53
#   exit_efficiency = (50-45)/(50-42) = 5/8 = 0.625
#   missed_r = 3.2 - (50-45)/(52.5-50) = 3.2 - 2.0 = 1.2
def test_short_winner_favorable_is_down():
    bars = [
        {"t": 1000, "h": 51.0, "l": 48.0},
        {"t": 2000, "h": 49.0, "l": 42.0},   # favorable extreme (min low)
        {"t": 3000, "h": 53.0, "l": 46.0},   # adverse extreme (max high)
    ]
    out = compute_excursion(
        "Short", 50.0, 52.5, 1000, 3000, bars, exit_price=45.0
    )
    assert out is not None
    assert out["mfe_price"] == 42.0
    assert out["mfe_ts"] == 2000
    assert out["mae_price"] == 53.0
    assert out["mae_ts"] == 3000
    assert out["mfe_r"] == pytest.approx(3.2)
    assert out["mae_r"] == pytest.approx((50.0 - 53.0) / (52.5 - 50.0))  # -1.2
    assert out["exit_efficiency"] == pytest.approx(0.625)
    assert out["missed_r"] == pytest.approx(1.2)


# ── No favorable excursion → efficiency UNDEFINED (None, never 0) ────────
# Long: every bar high tops out at entry, so available <= EPSILON.
def test_no_favorable_efficiency_is_none():
    bars = [
        {"t": 1000, "h": 100.0, "l": 96.0},  # high == entry → available 0
        {"t": 2000, "h": 99.0, "l": 94.0},
    ]
    out = compute_excursion(
        "Long", 100.0, 95.0, 1000, 2000, bars, exit_price=97.0
    )
    assert out is not None
    assert out["mfe_price"] == 100.0
    assert out["exit_efficiency"] is None  # NOT 0.0 — undefined


# ── Empty window → None ──────────────────────────────────────────────────
def test_empty_window_returns_none():
    bars = [
        {"t": 500, "h": 110.0, "l": 100.0},   # before window
        {"t": 5000, "h": 120.0, "l": 90.0},   # after window
    ]
    out = compute_excursion(
        "Long", 100.0, 95.0, 1000, 3000, bars, exit_price=110.0
    )
    assert out is None


def test_no_bars_at_all_returns_none():
    out = compute_excursion("Long", 100.0, 95.0, 1000, 3000, [], exit_price=110.0)
    assert out is None


# ── stop == entry → R is None, but efficiency (price-based) still computes ─
def test_stop_equals_entry_r_none_efficiency_computes():
    bars = [
        {"t": 1000, "h": 115.0, "l": 99.0},
        {"t": 2000, "h": 108.0, "l": 101.0},
    ]
    out = compute_excursion(
        "Long", 100.0, 100.0, 1000, 2000, bars, exit_price=110.0
    )
    assert out is not None
    assert out["mfe_r"] is None      # denominator entry-stop == 0
    assert out["mae_r"] is None
    assert out["missed_r"] is None   # needs mfe_r (None) → None
    # efficiency uses PRICE, so it is defined even when R is undefined:
    # (110-100)/(115-100) = 0.6667
    assert out["exit_efficiency"] == pytest.approx(0.6667, abs=1e-3)


# ── "Gave it all back": exit == entry with positive available → 0.0 ──────
def test_gave_it_all_back_clamps_to_zero():
    bars = [
        {"t": 1000, "h": 115.0, "l": 99.0},  # positive available
        {"t": 2000, "h": 112.0, "l": 98.0},
    ]
    out = compute_excursion(
        "Long", 100.0, 95.0, 1000, 2000, bars, exit_price=100.0  # exit == entry
    )
    assert out is not None
    assert out["exit_efficiency"] == 0.0  # meaningful zero, NOT None


# ── Window is inclusive of BOTH ends; first bar wins ties for *_ts ───────
def test_window_inclusive_and_first_extreme_wins_ties():
    bars = [
        {"t": 1000, "h": 115.0, "l": 99.0},  # entry_ts boundary, high 115
        {"t": 2000, "h": 115.0, "l": 98.0},  # tie at 115 — must NOT move mfe_ts
        {"t": 3000, "h": 110.0, "l": 97.0},  # exit_ts boundary
    ]
    out = compute_excursion(
        "Long", 100.0, 95.0, 1000, 3000, bars, exit_price=110.0
    )
    assert out is not None
    assert out["mfe_price"] == 115.0
    assert out["mfe_ts"] == 1000  # first occurrence, boundary bar included


# ── Bars outside the window never contribute to the extremes ─────────────
def test_out_of_window_bars_excluded_from_extremes():
    bars = [
        {"t": 500, "h": 200.0, "l": 50.0},    # BEFORE — excluded
        {"t": 1000, "h": 115.0, "l": 99.0},
        {"t": 3000, "h": 110.0, "l": 97.0},
        {"t": 4000, "h": 300.0, "l": 10.0},   # AFTER — excluded
    ]
    out = compute_excursion(
        "Long", 100.0, 95.0, 1000, 3000, bars, exit_price=110.0
    )
    assert out is not None
    assert out["mfe_price"] == 115.0            # not 200 / 300
    assert out["mae_price"] == 97.0             # not 50 / 10
    assert out["mae_ts"] == 3000
