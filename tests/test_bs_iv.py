"""Rigorous tests for the Black-Scholes implied-vol solver (api/bs_iv.py).

This is a numerical module in the hot serve path, so it is tested hard:
  * round-trip recovery across a moneyness / dte / vol grid, calls + puts
  * every documented failure mode returns None (never raises, never NaN/inf)
  * hand-verified known values + put-call parity
  * determinism and a speed floor (1000 solves well under 0.5s)
"""

import math
import time

import pytest

from api.bs_iv import black_scholes_price, implied_vol, iv_for_row


# ---------------------------------------------------------------------------
# Round-trip: price(sigma) -> implied_vol -> sigma, within 1e-3.
# ---------------------------------------------------------------------------

_SPOT = 100.0
# Strikes span deep-ITM through deep-OTM for both calls and puts.
_STRIKES = [60.0, 80.0, 95.0, 100.0, 105.0, 120.0, 140.0]
_DTES = [7, 30, 90, 180]
_SIGMAS = [0.15, 0.30, 0.50, 0.80, 1.0, 1.5]
_R = 0.045


def _grid():
    for K in _STRIKES:
        for dte in _DTES:
            for is_call in (True, False):
                for sigma in _SIGMAS:
                    yield K, dte, is_call, sigma


@pytest.mark.parametrize("K,dte,is_call,true_sigma", list(_grid()))
def test_round_trip_recovers_sigma(K, dte, is_call, true_sigma):
    t = dte / 365.0
    price = black_scholes_price(_SPOT, K, t, _R, true_sigma, is_call)

    # Only assert recovery when the print carries meaningful time value; a price
    # numerically pinned to the intrinsic floor (deep ITM + tiny time value) is
    # legitimately unsolvable and covered by the edge-case tests instead.
    disc_k = K * math.exp(-_R * t)
    floor = (_SPOT - disc_k) if is_call else (disc_k - _SPOT)
    if price - max(floor, 0.0) < 1e-6 or price <= 0.0:
        pytest.skip("price pinned to intrinsic floor; no recoverable vol")

    iv = implied_vol(price, _SPOT, K, dte, is_call, r=_R)
    assert iv is not None, f"expected a solve for K={K} dte={dte} call={is_call} sigma={true_sigma}"
    assert abs(iv - true_sigma) < 1e-3, f"got {iv}, want {true_sigma}"


def test_round_trip_via_iv_for_row_adapter():
    # The adapter is what the router actually calls; exercise both sides.
    for cp, is_call in (("C", True), ("P", False)):
        price = black_scholes_price(_SPOT, 105.0, 45 / 365.0, _R, 0.42, is_call)
        iv = iv_for_row(price, _SPOT, 105.0, 45, cp)
        assert iv is not None
        assert abs(iv - 0.42) < 1e-3


# ---------------------------------------------------------------------------
# Edge cases: must return None, never raise, never NaN/inf.
# ---------------------------------------------------------------------------

def test_dte_zero_or_negative_returns_none():
    assert implied_vol(5.0, 100.0, 100.0, 0, True) is None
    assert implied_vol(5.0, 100.0, 100.0, -3, True) is None


def test_non_positive_price_returns_none():
    assert implied_vol(0.0, 100.0, 100.0, 30, True) is None
    assert implied_vol(-1.0, 100.0, 100.0, 30, True) is None


def test_price_below_intrinsic_returns_none():
    # Deep-ITM call, strike 90, intrinsic ~= 10; a price of 3 is impossible.
    assert implied_vol(3.0, 100.0, 90.0, 30, True) is None
    # Deep-ITM put, strike 120, intrinsic ~= 20; a price of 5 is impossible.
    assert implied_vol(5.0, 100.0, 120.0, 30, False) is None


def test_price_at_or_above_upper_bound_returns_none():
    # A European call can never be worth more than spot.
    assert implied_vol(100.0, 100.0, 100.0, 30, True) is None
    assert implied_vol(101.0, 100.0, 100.0, 30, True) is None
    # A put can never be worth more than the (discounted) strike.
    assert implied_vol(100.0, 100.0, 100.0, 30, False) is None


def test_zero_or_negative_spot_or_strike_returns_none():
    assert implied_vol(5.0, 0.0, 100.0, 30, True) is None
    assert implied_vol(5.0, 100.0, 0.0, 30, True) is None
    assert implied_vol(5.0, -100.0, 100.0, 30, True) is None
    assert implied_vol(5.0, 100.0, -100.0, 30, True) is None


def test_absurd_price_returns_none():
    assert implied_vol(1e9, 100.0, 100.0, 30, True) is None


def test_non_finite_and_bad_type_inputs_return_none():
    assert implied_vol(float("nan"), 100.0, 100.0, 30, True) is None
    assert implied_vol(float("inf"), 100.0, 100.0, 30, True) is None
    assert implied_vol(5.0, float("nan"), 100.0, 30, True) is None
    assert implied_vol("not-a-number", 100.0, 100.0, 30, True) is None
    assert implied_vol(None, 100.0, 100.0, 30, True) is None


def test_solver_never_returns_nan_or_inf():
    # Sweep a rough grid; any non-None result must be a finite float.
    for K in (50.0, 100.0, 150.0):
        for dte in (1, 15, 120):
            for is_call in (True, False):
                for price in (0.01, 1.0, 5.0, 25.0, 90.0, 200.0):
                    out = implied_vol(price, 100.0, K, dte, is_call)
                    assert out is None or (isinstance(out, float) and math.isfinite(out))


# ---------------------------------------------------------------------------
# iv_for_row adapter guards.
# ---------------------------------------------------------------------------

def test_iv_for_row_guards_missing_and_zero_inputs():
    assert iv_for_row(None, 100.0, 100.0, 30, "C") is None
    assert iv_for_row(5.0, None, 100.0, 30, "C") is None
    assert iv_for_row(5.0, 100.0, None, 30, "C") is None
    assert iv_for_row(5.0, 100.0, 100.0, None, "C") is None
    assert iv_for_row(0.0, 100.0, 100.0, 30, "C") is None
    assert iv_for_row(5.0, 0.0, 100.0, 30, "C") is None
    assert iv_for_row(5.0, 100.0, 0.0, 30, "C") is None
    assert iv_for_row(5.0, 100.0, 100.0, 0, "C") is None


def test_iv_for_row_cp_parsing():
    price_c = black_scholes_price(100.0, 100.0, 30 / 365.0, 0.045, 0.30, True)
    price_p = black_scholes_price(100.0, 100.0, 30 / 365.0, 0.045, 0.30, False)
    # Accept short and long forms, any case.
    for cp in ("C", "c", "Call", "CALL"):
        assert abs(iv_for_row(price_c, 100.0, 100.0, 30, cp) - 0.30) < 1e-3
    for cp in ("P", "p", "Put", "PUT"):
        assert abs(iv_for_row(price_p, 100.0, 100.0, 30, cp) - 0.30) < 1e-3
    # Unknown cp -> None.
    assert iv_for_row(price_c, 100.0, 100.0, 30, "X") is None
    assert iv_for_row(price_c, 100.0, 100.0, 30, "") is None


def test_iv_for_row_accepts_string_numerics():
    # Router rows may carry strings; the adapter coerces them.
    price = black_scholes_price(100.0, 105.0, 60 / 365.0, 0.045, 0.55, True)
    iv = iv_for_row(str(price), "100", "105", "60", "C")
    assert iv is not None and abs(iv - 0.55) < 1e-3


# ---------------------------------------------------------------------------
# Hand-verified known values + put-call parity.
# ---------------------------------------------------------------------------

def test_known_atm_30d_call_price():
    # ATM 30d, S=K=100, r=0.045, sigma=0.30. Independently reproduced value.
    price = black_scholes_price(100.0, 100.0, 30 / 365.0, 0.045, 0.30, True)
    assert abs(price - 3.6116) < 1e-3


def test_known_atm_30d_put_price():
    price = black_scholes_price(100.0, 100.0, 30 / 365.0, 0.045, 0.30, False)
    assert abs(price - 3.2424) < 1e-3


def test_put_call_parity():
    # C - P == S - K*exp(-r*t) for European options with q=0.
    S, K, r, sigma = 100.0, 110.0, 0.045, 0.42
    t = 90 / 365.0
    c = black_scholes_price(S, K, t, r, sigma, True)
    p = black_scholes_price(S, K, t, r, sigma, False)
    assert abs((c - p) - (S - K * math.exp(-r * t))) < 1e-9


def test_price_monotonic_increasing_in_sigma():
    prev = -1.0
    for sigma in (0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.0):
        price = black_scholes_price(100.0, 100.0, 60 / 365.0, 0.045, sigma, True)
        assert price > prev
        prev = price


def test_black_scholes_degenerate_returns_intrinsic_not_error():
    # At/after expiry or zero vol must not raise; returns intrinsic.
    assert black_scholes_price(120.0, 100.0, 0.0, 0.045, 0.3, True) == pytest.approx(20.0)
    assert black_scholes_price(80.0, 100.0, 0.0, 0.045, 0.3, True) == 0.0
    assert black_scholes_price(100.0, 120.0, 0.25, 0.045, 0.0, False) > 0.0
    # Non-positive spot/strike must not raise.
    assert black_scholes_price(0.0, 100.0, 0.25, 0.045, 0.3, True) == 0.0
    assert black_scholes_price(-5.0, 100.0, 0.25, 0.045, 0.3, True) == 0.0


# ---------------------------------------------------------------------------
# Determinism + speed.
# ---------------------------------------------------------------------------

def test_determinism():
    args = (4.25, 100.0, 102.0, 21, True)
    first = implied_vol(*args)
    for _ in range(50):
        assert implied_vol(*args) == first


def test_rounded_to_four_decimals():
    iv = implied_vol(4.25, 100.0, 102.0, 21, True)
    assert iv is not None
    assert iv == round(iv, 4)


def test_speed_1000_solves_under_half_second():
    # Vary inputs so nothing is trivially cached by the interpreter.
    prices = [black_scholes_price(100.0, 100.0, 30 / 365.0, 0.045, s, True)
              for s in (0.2, 0.35, 0.5, 0.65, 0.8)]
    start = time.perf_counter()
    n = 0
    for _ in range(200):
        for pr in prices:
            assert implied_vol(pr, 100.0, 100.0, 30, True) is not None
            n += 1
    elapsed = time.perf_counter() - start
    assert n == 1000
    assert elapsed < 0.5, f"1000 solves took {elapsed:.3f}s (budget 0.5s)"
