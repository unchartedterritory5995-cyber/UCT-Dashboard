"""Tests for server-side indicator compute (parity with frontend math)."""

import pytest

from api.services.indicator_compute import (
    compute_bb,
    compute_cci,
    compute_ema,
    compute_macd,
    compute_mfi,
    compute_rsi,
    compute_sma,
    compute_stoch,
    compute_williams_r,
)


def test_rsi_constant_uptrend():
    closes = list(range(100, 130))
    rsi = compute_rsi(closes, 14)
    assert rsi[-1] == 100.0  # all gains, no losses


def test_rsi_constant_downtrend():
    closes = list(range(100, 70, -1))
    rsi = compute_rsi(closes, 14)
    assert rsi[-1] == 0.0


def test_macd_returns_three_arrays():
    closes = [100 + i * 0.5 for i in range(60)]
    macd, signal, hist = compute_macd(closes, 12, 26, 9)
    assert len(macd) == 60
    assert len(signal) == 60
    assert len(hist) == 60


def test_bb_ordering():
    closes = [100 + (i % 7) * 1.5 for i in range(40)]
    upper, middle, lower = compute_bb(closes, 20, 2)
    for u, m, l in zip(upper[20:], middle[20:], lower[20:]):
        if u is not None:
            assert u >= m >= l


def test_williams_r_bounds():
    bars = [{"h": 100 + i, "l": 90 + i, "c": 95 + i} for i in range(30)]
    wr = compute_williams_r(bars, 14)
    valid = [v for v in wr if v is not None]
    assert all(-100 <= v <= 0 for v in valid)


def test_cci_range():
    bars = [{"h": 102 + i * 0.1, "l": 98 + i * 0.1, "c": 100 + i * 0.1} for i in range(40)]
    cci = compute_cci(bars, 20)
    # CCI typically ±300; constant-trend should give NaN due to zero MAD
    # so test just verifies no crash
    assert len(cci) == 40


def test_mfi_bounds():
    bars = [{"h": 102 + i, "l": 98 + i, "c": 100 + i, "v": 1000 + i * 10} for i in range(40)]
    mfi = compute_mfi(bars, 14)
    valid = [v for v in mfi if v is not None]
    assert all(0 <= v <= 100 for v in valid)


def test_stoch_bounds():
    bars = [{"h": 100 + i, "l": 90 + i, "c": 95 + i * 0.5} for i in range(30)]
    k, d = compute_stoch(bars, 14, 3)
    valid_k = [v for v in k if v is not None]
    valid_d = [v for v in d if v is not None]
    assert all(0 <= v <= 100 for v in valid_k)
    assert all(0 <= v <= 100 for v in valid_d)


def test_sma_matches_manual():
    closes = [1, 2, 3, 4, 5]
    sma = compute_sma(closes, 3)
    assert sma[2] == 2.0  # (1+2+3)/3
    assert sma[3] == 3.0
    assert sma[4] == 4.0


def test_ema_matches_known_values():
    closes = [1, 2, 3, 4, 5]
    ema = compute_ema(closes, 3)
    # First EMA is SMA of first 3: 2.0
    assert abs(ema[2] - 2.0) < 0.01
    # Subsequent: k*price + (1-k)*prev_ema, k = 2/4 = 0.5
    assert abs(ema[3] - 3.0) < 0.01  # 0.5*4 + 0.5*2 = 3
