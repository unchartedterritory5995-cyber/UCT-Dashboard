"""Liquidity / price-floor primitive.

Phase 6 Group 2 (2026-09-03): Phase 5's Tier-1 validation audit reproduced
false-positive detections across six families -- bull_flag, bullish_engulfing,
bearish_engulfing, high_tight_flag, flat_base (System A) plus
flat_base_state/ascending_base_state (System D), and power_earnings_gap --
each firing confidently on penny-stock, corporate-action-style, or
near-dead-volume synthetic series. None of the six gated on price or
liquidity at all (confirmed by grep: no 'min_price'/'penny'/'liquidity'/
'adv_dollars' anywhere in any of the six files before this fix).
high_tight_flag.py's own module docstring even claimed a liquidity gate
("avg daily volume >= 200K") that the code never implemented.

This is the ONE shared primitive all six wire into, so the floor is
defined and evidenced in exactly one place rather than six slightly
different ones.

Calibration (measured, not assumed):
  - min_price=$2.00 matches this codebase's own existing
    CATALYST_PRICE_FLOOR convention (api/services/catalyst/cost_guard.py).
    Every Phase-5 reproduced false positive priced at or under $1.00 (bull_flag
    $1.00; bullish/bearish_engulfing sub-$1; flat_base $0.35; System D
    ascending_base $0.10-0.125; power_earnings_gap $0.45). Every legitimate
    positive fixture across the six target families' fixture batteries
    (tests/fixtures/{bull_flag,bullish_engulfing,bearish_engulfing,
    high_tight_flag,flat_base,power_earnings_gap}/) prices no lower than
    $14.99 -- measured directly against every positive fixture's last 20
    bars, not assumed.
  - min_avg_dollar_volume=$10,000 over a 20-bar lookback is a secondary
    liquidity backstop (catches a near-dead-volume series even if its
    price sits above the floor -- the high_tight_flag repro's "flag_volume_ratio
    as low as 0.013" case). Calibrated below the worst legitimate fixture's
    20-bar average ($28,691.42, flat_base/dramatic_advance.json) and its
    worst single bar ($17,227.62, same fixture) -- both measured, not
    assumed -- while sitting comfortably above the bull_flag repro
    (~$375/day) and the flat_base repro (~$750/day). Note the
    power_earnings_gap repro's dollar volume (~$67,500-$216,000/day on
    150K-480K shares at $0.45) is NOT below this floor -- its price alone
    (well under $2.00) is what the price floor is for; dollar volume is a
    backstop, not the only gate.

This is a hard gate, not a scoring input: a failing candidate must be
refused outright (return None / skip), never merely scored down. Phase 5's
D4 finding (the confidence-floor blending quality signals into what should
be a pure identity gate) is exactly the failure mode this avoids repeating.
"""
from __future__ import annotations

from typing import List, NamedTuple, Optional

from api.services.pattern_engine.types import Bar


DEFAULT_MIN_PRICE = 2.0
DEFAULT_MIN_AVG_DOLLAR_VOLUME = 10_000.0
DEFAULT_LOOKBACK = 20


class LiquidityCheck(NamedTuple):
    passes: bool
    price: float
    avg_dollar_volume: float
    reason: Optional[str]


def liquidity_floor(
    bars: List[Bar],
    min_price: float = DEFAULT_MIN_PRICE,
    min_avg_dollar_volume: float = DEFAULT_MIN_AVG_DOLLAR_VOLUME,
    lookback: int = DEFAULT_LOOKBACK,
) -> LiquidityCheck:
    """Hard gate against penny-stock / corporate-action-style / near-dead-
    volume series. Call this once per detection attempt, BEFORE emitting a
    candidate; a failing check means the candidate must be rejected
    outright, not scored down.
    """
    if not bars:
        return LiquidityCheck(False, 0.0, 0.0, "no bars")
    window = bars[-lookback:] if len(bars) >= lookback else bars
    price = float(bars[-1]["c"])
    avg_dollar_volume = sum(float(b["c"]) * float(b["v"]) for b in window) / len(window)
    if price < min_price:
        return LiquidityCheck(
            False, price, avg_dollar_volume,
            f"price ${price:.2f} below ${min_price:.2f} floor",
        )
    if avg_dollar_volume < min_avg_dollar_volume:
        return LiquidityCheck(
            False, price, avg_dollar_volume,
            f"{lookback}-bar avg dollar volume ${avg_dollar_volume:,.0f} "
            f"below ${min_avg_dollar_volume:,.0f} floor",
        )
    return LiquidityCheck(True, price, avg_dollar_volume, None)
