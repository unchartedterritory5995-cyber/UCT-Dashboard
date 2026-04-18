"""Python calculations mirror — must agree with JS side on §14.7 data."""

import pytest

from api.services.journal_two.calculations import (
    EPSILON,
    safe_divide,
    trade_pnl_dollar,
    trade_pnl_percent,
    trade_r_multiple,
    hold_days,
    trade_result,
    compute_trade_derived,
)


# ── §14.7 YSS partial close ─────────────────────────────────────────────
# Sold 100 shares at $34.50 on 04/10/26 from YSS Position (entry 04/09/26,
# entry $29.57, original_stop $27.90).
#
# Expected:
#   pnl_dollar  $493.00
#   pnl_percent +16.6723%
#   r_multiple  2.9521 → display +3.0R
#   hold_days   1
#   result (BE $20) → Win
# ────────────────────────────────────────────────────────────────────────


def test_yss_partial_close_pnl_dollar():
    assert trade_pnl_dollar("Long", 29.57, 34.50, 100) == pytest.approx(493.0, abs=1e-9)


def test_yss_partial_close_pnl_percent():
    got = trade_pnl_percent("Long", 29.57, 34.50)
    assert got is not None
    assert got * 100 == pytest.approx(16.6723, abs=1e-3)


def test_yss_partial_close_r_multiple():
    got = trade_r_multiple("Long", 29.57, 34.50, 27.90)
    assert got is not None
    assert got == pytest.approx(2.9521, abs=1e-3)


def test_yss_partial_close_hold_days():
    assert hold_days("2026-04-09T00:00:00Z", "2026-04-10T00:00:00Z") == 1


def test_yss_partial_close_result_win():
    result = trade_result(
        pnl_dollar=493.0,
        entry_price=29.57,
        shares=100,
        breakeven_range={"enabled": True, "unit": "$", "value": 20},
    )
    assert result == "Win"


def test_compute_trade_derived_full_yss():
    got = compute_trade_derived(
        side="Long",
        shares=100,
        entry_price=29.57,
        entry_date="2026-04-09T00:00:00Z",
        exit_price=34.50,
        exit_date="2026-04-10T00:00:00Z",
        original_stop=27.90,
        breakeven_range={"enabled": True, "unit": "$", "value": 20},
    )
    assert got["pnl_dollar"] == pytest.approx(493.0, abs=1e-9)
    assert got["pnl_percent"] * 100 == pytest.approx(16.6723, abs=1e-3)
    assert got["r_multiple"] == pytest.approx(2.9521, abs=1e-3)
    assert got["hold_days"] == 1
    assert got["result"] == "Win"


# ── Short-side mirrored YSS ──────────────────────────────────────────────


def test_short_side_pnl():
    # Short at $29.57, covered at $23.61, 100 shares → +$596
    assert trade_pnl_dollar("Short", 29.57, 23.61, 100) == pytest.approx(596.0, abs=1e-9)


def test_short_side_r_multiple():
    # Short entry 29.57, stop 31.24 (risk 1.67), exit 23.61 (reward 5.96)
    # R = 5.96 / 1.67 = 3.5689
    got = trade_r_multiple("Short", 29.57, 23.61, 31.24)
    assert got is not None
    assert got == pytest.approx(5.96 / 1.67, abs=1e-3)


# ── Edge cases ───────────────────────────────────────────────────────────


def test_safe_divide_by_zero_returns_none():
    assert safe_divide(10, 0) is None


def test_safe_divide_near_epsilon_returns_none():
    assert safe_divide(10, EPSILON / 2) is None


def test_r_multiple_when_entry_equals_stop_returns_none():
    # entry 100 = originalStop 100 → risk zero → R undefined
    assert trade_r_multiple("Long", 100, 110, 100) is None


def test_hold_days_same_day():
    assert hold_days("2026-04-09T09:30:00Z", "2026-04-09T15:30:00Z") == 0


def test_hold_days_utc_dst_boundary():
    # US DST 2026-03-08 — must NOT drift
    assert hold_days("2026-03-07T00:00:00Z", "2026-03-09T00:00:00Z") == 2


# ── Result classification ────────────────────────────────────────────────


def test_result_disabled_zero_is_be():
    r = trade_result(
        pnl_dollar=0.0,
        entry_price=100,
        shares=10,
        breakeven_range={"enabled": False, "unit": "$", "value": 0},
    )
    assert r == "BE"


def test_result_enabled_dollar_within_range_is_be():
    r = trade_result(
        pnl_dollar=15.0,
        entry_price=100,
        shares=10,
        breakeven_range={"enabled": True, "unit": "$", "value": 20},
    )
    assert r == "BE"


def test_result_enabled_dollar_exactly_at_boundary_is_be_inclusive():
    r = trade_result(
        pnl_dollar=20.0,
        entry_price=100,
        shares=10,
        breakeven_range={"enabled": True, "unit": "$", "value": 20},
    )
    assert r == "BE"


def test_result_enabled_dollar_above_threshold_is_win():
    r = trade_result(
        pnl_dollar=20.01,
        entry_price=100,
        shares=10,
        breakeven_range={"enabled": True, "unit": "$", "value": 20},
    )
    assert r == "Win"


def test_result_enabled_percent():
    # 0.1% of (100 * 10) = $1 threshold
    r = trade_result(
        pnl_dollar=0.5,
        entry_price=100,
        shares=10,
        breakeven_range={"enabled": True, "unit": "%", "value": 0.1},
    )
    assert r == "BE"
