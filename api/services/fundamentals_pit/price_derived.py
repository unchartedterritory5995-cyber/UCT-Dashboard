"""Price x point-in-time fundamentals, evaluated per bar.

    Market Cap(t)   = close(t) x SharesOutstanding_known(t)
    Trailing P/E(t) = close(t) / EPS_TTM_known(t)            (None if EPS <= 0)
    Price/Sales(t)  = MarketCap(t) / Revenue_TTM_known(t)
    Price/Book(t)   = MarketCap(t) / Equity_known(t)          (None if equity <= 0)
    FCF Yield(t)    = FCF_TTM_known(t) / MarketCap(t)
    Div Yield(t)    = DPS_TTM_known(t) / close(t)

`_known(t)` is the AS-OF value (asof.py) -- the fundamental in force at the
bar's close, never today's. Both sides are on TODAY's share basis: bars are
split-adjusted, and every per-share fundamental / share count is converted by
the same split ledger (splits.py), so a split moves neither the product nor the
ratio. The numerator moves every bar; the denominator only when a filing lands.
"""
from __future__ import annotations

from .asof import project


def _div(a, b):
    return None if a is None or b is None or b == 0 else a / b


def derive(bar_dates: list[str], closes: list[float], series: dict, tf: str = "D",
           now=None) -> dict[str, list]:
    """`series`: metric id -> sparse Points (series.build_series output)."""
    get = lambda m: project(series.get(m, []), bar_dates, tf, now)
    shares, eps, rev, eq, fcf, dps = (get(m) for m in (
        "shares_outstanding", "eps_diluted_ttm", "revenue_ttm", "equity", "fcf_ttm",
        "dividends_per_share_ttm"))
    mcap = [None if s is None else c * s for c, s in zip(closes, shares)]
    return {
        "market_cap": mcap,
        "pe_ttm": [None if e is None or e <= 0 else c / e for c, e in zip(closes, eps)],
        "ps_ttm": [_div(m, r) if r and r > 0 else None for m, r in zip(mcap, rev)],
        "pb": [_div(m, e) if e and e > 0 else None for m, e in zip(mcap, eq)],
        "fcf_yield": [_div(f, m) for f, m in zip(fcf, mcap)],
        "dividend_yield": [_div(d, c) for d, c in zip(dps, closes)],
    }
