"""Black-Scholes implied-volatility solver for the live options-flow tape.

Every live flow print currently renders IV=0 because the raw Massive feed does
not carry a per-print implied volatility. This module reconstructs IV from data
we already have on each row: the option fill/mid price, the underlying spot, the
strike, days-to-expiry and call/put — the same fields Unusual Whales shows an IV
next to.

Design constraints (this runs in the hot serve path of live_massive_router):
  * stdlib only — NO numpy / scipy. The normal CDF uses ``math.erf``.
  * a single solve must be well under 1ms. Bisection over ``erf`` is cheap.
  * NEVER raise, NEVER return NaN/inf. Bad / unsolvable inputs return ``None``.
  * no caching here — the caller owns a micro-cache for repeat contracts.

Model: European Black-Scholes with continuous compounding and dividend yield
q = 0 (v1). Risk-free r defaults to 0.045.

Public API:
    black_scholes_price(S, K, t_years, r, sigma, is_call) -> float
    implied_vol(price, S, K, dte_days, is_call, r=0.045) -> float | None
    iv_for_row(fill_price, spot, strike, dte_days, cp) -> float | None
"""

from __future__ import annotations

import math

__all__ = ["black_scholes_price", "implied_vol", "iv_for_row"]

# --- solver constants -------------------------------------------------------
_SQRT2 = math.sqrt(2.0)

# Sigma search bracket. 0.01% vol to 500% vol comfortably spans anything a real
# option print can imply; anything outside is treated as unsolvable -> None.
_SIGMA_LO = 1e-4
_SIGMA_HI = 5.0

# Bisection controls. We converge on the *sigma interval width* (not the price
# residual) so that low-vega contracts — deep OTM / near-expiry, where many
# sigmas map to almost the same price — still recover the correct vol instead of
# stopping early at a wrong root. log2(5.0 / 1e-7) ~= 26 iterations to converge.
_MAX_ITERS = 100
_SIGMA_TOL = 1e-7

# Days-per-year used to convert dte -> year fraction (matches spec: dte/365).
_DAYS_PER_YEAR = 365.0

# Trading-year default risk-free rate.
_DEFAULT_R = 0.045


def _norm_cdf(x: float) -> float:
    """Standard-normal CDF via the error function (stdlib, no scipy)."""
    return 0.5 * (1.0 + math.erf(x / _SQRT2))


def black_scholes_price(
    S: float,
    K: float,
    t_years: float,
    r: float,
    sigma: float,
    is_call: bool,
) -> float:
    """European Black-Scholes price (continuous compounding, dividend yield 0).

    Returns the theoretical option value. Degenerate inputs (non-positive spot,
    strike, time or vol) collapse to the intrinsic value rather than raising, so
    the function is always safe to call — the solver never feeds it those, but a
    stray caller will not crash.
    """
    S = float(S)
    K = float(K)
    t = float(t_years)
    r = float(r)
    sigma = float(sigma)

    # Degenerate / at-expiry: no log(S/K) or division-by-zero. Return intrinsic.
    # When t <= 0 the intrinsic is undiscounted; otherwise discount the strike.
    if S <= 0.0 or K <= 0.0 or t <= 0.0 or sigma <= 0.0:
        disc_k = K * math.exp(-r * t) if (t > 0.0 and K > 0.0) else K
        intrinsic = (S - disc_k) if is_call else (disc_k - S)
        return intrinsic if intrinsic > 0.0 else 0.0

    sqrt_t = math.sqrt(t)
    vol_sqrt_t = sigma * sqrt_t
    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * t) / vol_sqrt_t
    d2 = d1 - vol_sqrt_t
    disc_k = K * math.exp(-r * t)

    if is_call:
        return S * _norm_cdf(d1) - disc_k * _norm_cdf(d2)
    return disc_k * _norm_cdf(-d2) - S * _norm_cdf(-d1)


def implied_vol(
    price: float,
    S: float,
    K: float,
    dte_days: float,
    is_call: bool,
    r: float = _DEFAULT_R,
) -> float | None:
    """Solve Black-Scholes for sigma given an observed option price.

    Robust hybrid: an arbitrage-bound pre-check followed by bracketed bisection
    on [1e-4, 5.0]. We deliberately avoid raw Newton, which diverges near expiry
    and deep OTM where vega collapses; bisection cannot diverge on a monotone
    function (BS price is strictly increasing in sigma for t > 0).

    Returns sigma rounded to 4 decimals, or ``None`` when the price is not
    solvable: dte <= 0, price <= 0, price below intrinsic, price at/above the
    no-arbitrage upper bound (>= S for a call), bad/non-finite inputs, or the
    price cannot be bracketed. Never raises, never returns NaN/inf.
    """
    # --- input hygiene ------------------------------------------------------
    try:
        price = float(price)
        S = float(S)
        K = float(K)
        r = float(r)
        dte_days = float(dte_days)
    except (TypeError, ValueError):
        return None

    if not (
        math.isfinite(price)
        and math.isfinite(S)
        and math.isfinite(K)
        and math.isfinite(r)
        and math.isfinite(dte_days)
    ):
        return None

    if dte_days <= 0.0 or price <= 0.0 or S <= 0.0 or K <= 0.0:
        return None

    t = dte_days / _DAYS_PER_YEAR

    # --- no-arbitrage bounds ------------------------------------------------
    # As sigma -> 0+ the BS price approaches the discounted intrinsic (its floor)
    # and as sigma -> inf it approaches the upper bound (S for a call, the
    # discounted strike for a put). A price outside (floor, ceiling) has no root.
    disc_k = K * math.exp(-r * t)
    if is_call:
        floor = S - disc_k
        ceiling = S
    else:
        floor = disc_k - S
        ceiling = disc_k
    if floor < 0.0:
        floor = 0.0

    # Strictly inside the achievable band, else unsolvable.
    if price <= floor or price >= ceiling:
        return None

    # --- bracketed bisection ------------------------------------------------
    lo = _SIGMA_LO
    hi = _SIGMA_HI
    f_lo = black_scholes_price(S, K, t, r, lo, is_call) - price
    f_hi = black_scholes_price(S, K, t, r, hi, is_call) - price

    # Exact hits at a bracket end (rare, but cheap to honor).
    if f_lo == 0.0:
        return round(lo, 4)
    if f_hi == 0.0:
        return round(hi, 4)

    # If the two ends share a sign the root is not inside the bracket. Given the
    # arbitrage pre-check above this should not happen, but guard anyway so we
    # never return a bogus midpoint.
    if f_lo * f_hi > 0.0:
        return None

    mid = 0.5 * (lo + hi)
    for _ in range(_MAX_ITERS):
        mid = 0.5 * (lo + hi)
        f_mid = black_scholes_price(S, K, t, r, mid, is_call) - price
        if f_mid == 0.0 or (hi - lo) < _SIGMA_TOL:
            break
        # Keep the sub-interval that still straddles the root.
        if (f_lo < 0.0) == (f_mid < 0.0):
            lo = mid
            f_lo = f_mid
        else:
            hi = mid
            f_hi = f_mid

    if not math.isfinite(mid):
        return None
    return round(mid, 4)


def iv_for_row(
    fill_price: float,
    spot: float,
    strike: float,
    dte_days: float,
    cp: str,
) -> float | None:
    """Thin serve-time adapter — the entry point the flow router calls per row.

    ``cp`` is 'C'/'P' (also accepts 'CALL'/'PUT', any case). Missing, zero,
    negative or unparseable inputs collapse to ``None`` so a bad row simply
    shows no IV rather than breaking the response.
    """
    if fill_price is None or spot is None or strike is None or dte_days is None:
        return None

    try:
        fp = float(fill_price)
        sp = float(spot)
        st = float(strike)
        dte = float(dte_days)
    except (TypeError, ValueError):
        return None

    if fp <= 0.0 or sp <= 0.0 or st <= 0.0 or dte <= 0.0:
        return None

    c = str(cp).strip().upper() if cp is not None else ""
    if c.startswith("C"):
        is_call = True
    elif c.startswith("P"):
        is_call = False
    else:
        return None

    return implied_vol(fp, sp, st, dte, is_call)
