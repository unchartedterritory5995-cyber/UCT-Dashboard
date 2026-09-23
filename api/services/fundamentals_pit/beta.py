"""Rolling historical beta from daily closes -- a DECLARED methodology.

UCT today only holds vendor SNAPSHOT betas (FMP profile `beta`, yfinance
`info.beta`), with no stated method and no history. Drawing either backward
would be exactly the retroactive fiction this package exists to prevent. This
is a different, fully specified statistic computed from bars UCT already owns:

    benchmark        SPY (split-adjusted daily closes, same store as the stock)
    return           simple daily return r_t = c_t / c_{t-1} - 1, computed on
                     the INTERSECTION of the two symbols' trading days, so a day
                     missing on either side never fabricates a zero return
    window           the trailing 252 aligned returns ending at t (1 year)
    minimum          200 valid returns in the window, else None
    estimator        OLS slope: beta = cov(r_s, r_b) / var(r_b), both with the
                     same (n - 1) denominator
    price basis      split-adjusted, NOT dividend-adjusted -> a PRICE-return
                     beta. Dividends shift daily returns by a few basis points
                     on ex-dates; the effect on a 252-day slope is negligible
                     but the label says "price", never "total return".
    point in time    beta(t) uses closes at or before t only.

Label: "Beta (1Y daily vs SPY)". Vendor betas (Yahoo: 5Y monthly) differ by
construction; this one never claims to be theirs.
"""
from __future__ import annotations

from math import isfinite

WINDOW = 252
MIN_OBS = 200


def aligned_returns(stock: list[tuple], bench: list[tuple]) -> list[tuple]:
    """(date, r_stock, r_bench) on common trading days. Inputs: ascending
    [(date, close)]. A return spans two CONSECUTIVE common days."""
    b = dict(bench)
    common = [(d, c, b[d]) for d, c in stock if d in b and c and b[d]]
    out = []
    for (d0, s0, b0), (d1, s1, b1) in zip(common, common[1:]):
        rs, rb = s1 / s0 - 1.0, b1 / b0 - 1.0
        if isfinite(rs) and isfinite(rb):
            out.append((d1, rs, rb))
    return out


def rolling_beta(stock: list[tuple], bench: list[tuple], window: int = WINDOW,
                 min_obs: int = MIN_OBS) -> list[tuple]:
    """[(date, beta|None)] for every aligned return date. O(n) running sums."""
    rets = aligned_returns(stock, bench)
    out = []
    sx = sy = sxx = sxy = 0.0
    q: list[tuple] = []
    for d, rs, rb in rets:
        q.append((rs, rb))
        sx += rb; sy += rs; sxx += rb * rb; sxy += rb * rs
        if len(q) > window:
            ors, orb = q.pop(0)
            sx -= orb; sy -= ors; sxx -= orb * orb; sxy -= orb * ors
        n = len(q)
        if n < min_obs:
            out.append((d, None))
            continue
        var = sxx - sx * sx / n
        cov = sxy - sx * sy / n
        out.append((d, cov / var if var > 0 else None))
    return out
