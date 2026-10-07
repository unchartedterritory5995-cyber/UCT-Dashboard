"""Realized (historical) volatility -- ONE definition for every panel that prints it.

VOL/IVH (`options_analytics.vol.hv`) used the SAMPLE standard deviation of daily log returns
(divisor n-1) and ERX (`earnings_reaction_panel.realized_vol`) the POPULATION one (divisor n):
the same 20-session vol differed by sqrt(20/19), about 2.6 %, between two panels a member can
open side by side (accuracy audit 2026-10-06, design note 1). Both now call `annualized_hv`,
the sample standard deviation -- the conventional estimator for historical volatility.
"""
from __future__ import annotations

import math
from typing import Optional, Sequence

TRADING_DAYS = 252

METHOD = ("the sample standard deviation (divisor n-1) of daily log returns, close to close, "
          "x sqrt(252)")


def annualized_hv(closes: Sequence[float], trading_days: int = TRADING_DAYS) -> Optional[float]:
    """Annualized close-to-close volatility of `closes` (oldest first), as a FRACTION
    (0.42 = 42 %). Sample standard deviation of the log returns. None with fewer than two
    returns or a non-positive close (a log return does not exist there)."""
    vals = [float(c) for c in closes]
    if len(vals) < 3 or any(not math.isfinite(c) or c <= 0 for c in vals):
        return None
    rets = [math.log(b / a) for a, b in zip(vals, vals[1:])]
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    return math.sqrt(var) * math.sqrt(trading_days)
