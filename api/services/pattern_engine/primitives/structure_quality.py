"""Structure-quality primitives for continuation pattern boosts.

is_higher_low(bars, pullback_low_idx) - is this swing low higher than the
  prior swing low? Returns dict with is_higher_low/prior_low_price/lift_pct/
  narrative_phrase. A higher low = uptrend structure intact, buyers stepping
  up earlier — the cornerstone of every Minervini/O'Neil/Weinstein continuation
  setup.

nearest_rising_ma_alignment(bars, pullback_low_price) - which rising MA does
  the pullback low align with? Returns dict with aligned_ma/ma_value/
  distance_pct/score_boost/narrative_phrase. Pullbacks to rising 10/21EMA
  (Minervini), 50SMA (O'Neil "second buy point"), or 200SMA (Weinstein Stage 2
  retest) are institutional accumulation zones.
"""
from __future__ import annotations
from typing import Optional


def is_higher_low(bars: list[dict], pullback_low_idx: int) -> dict:
    """Determine if the bar at pullback_low_idx forms a higher low vs the prior swing low.

    A 'higher low' is structurally bullish — uptrend intact, buyers stepping up earlier.

    Args:
      bars: full bars list (oldest first)
      pullback_low_idx: index of the current pullback's low bar

    Returns:
      {
        "is_higher_low": bool,
        "prior_low_price": float or None,
        "prior_low_bar_index": int or None,
        "lift_pct": float,            # current_low / prior_low - 1, * 100
        "narrative_phrase": str       # ready-to-weave-in description
      }
    """
    from api.services.pattern_engine.primitives.pivots import detect_pivots

    if not bars or pullback_low_idx < 0 or pullback_low_idx >= len(bars):
        return _empty_hl()

    current_low = bars[pullback_low_idx]["l"]

    # Find swing lows BEFORE the pullback
    pivots = detect_pivots(bars[:pullback_low_idx], window=3)
    prior_lows = [p for p in pivots if p["type"] == "low"]
    if not prior_lows:
        return {
            "is_higher_low": False,
            "prior_low_price": None,
            "prior_low_bar_index": None,
            "lift_pct": 0.0,
            "narrative_phrase": "No prior swing low identified — first pullback in series.",
        }

    most_recent_prior = prior_lows[-1]
    prior_price = most_recent_prior["price"]
    is_higher = current_low > prior_price
    lift = (
        (current_low - prior_price) / prior_price * 100 if prior_price > 0 else 0.0
    )

    if is_higher:
        if lift >= 5:
            phrase = (
                f"Higher low confirmed — pullback low (${current_low:.2f}) is "
                f"{lift:.1f}% above the prior swing low (${prior_price:.2f}). "
                f"Strong uptrend structure."
            )
        else:
            phrase = (
                f"Higher low confirmed — pullback low (${current_low:.2f}) sits "
                f"{lift:.1f}% above the prior swing low (${prior_price:.2f}). "
                f"Uptrend structure intact."
            )
    else:
        phrase = (
            f"Lower low — pullback bottomed at ${current_low:.2f}, BELOW the "
            f"prior swing low ${prior_price:.2f} ({abs(lift):.1f}% breach). "
            f"Uptrend structure compromised."
        )

    return {
        "is_higher_low": is_higher,
        "prior_low_price": prior_price,
        "prior_low_bar_index": most_recent_prior["bar_index"],
        "lift_pct": round(lift, 2),
        "narrative_phrase": phrase,
    }


def _empty_hl() -> dict:
    return {
        "is_higher_low": False,
        "prior_low_price": None,
        "prior_low_bar_index": None,
        "lift_pct": 0.0,
        "narrative_phrase": "Higher low check unavailable.",
    }


def nearest_rising_ma_alignment(bars: list[dict], pullback_low_price: float) -> dict:
    """Determine which (if any) rising MA the pullback low aligns with.

    Checks 10EMA, 21EMA (Minervini's primary support), 50SMA (O'Neil's
    "second buy point"), 200SMA (Weinstein Stage 2 retest). "Aligns" =
    within 1.5% of the MA value AND the MA is rising.

    Returns:
      {
        "aligned_ma": "10ema" | "21ema" | "50sma" | "200sma" | None,
        "ma_value": float or None,
        "distance_pct": float,        # signed: + if above MA, - if below
        "score_boost": int,           # 10/15/18/22 by importance
        "narrative_phrase": str
      }
    """
    if not bars:
        return _empty_ma()

    closes = [b["c"] for b in bars]

    ma_specs = [
        ("10ema", _ema(closes, 10), _slope_sign(closes, 10), 10),
        ("21ema", _ema(closes, 21), _slope_sign(closes, 21), 15),   # Minervini
        ("50sma", _sma(closes, 50), _slope_sign(closes, 50), 18),   # O'Neil
        ("200sma", _sma(closes, 200), _slope_sign(closes, 200), 22),  # Weinstein Stage 2
    ]

    best = None
    for name, ma_value, slope, base_boost in ma_specs:
        if ma_value is None:
            continue
        if slope <= 0:
            continue  # MA must be rising
        if ma_value <= 0:
            continue
        dist_pct = (pullback_low_price - ma_value) / ma_value * 100
        if abs(dist_pct) <= 1.5:
            if best is None or abs(dist_pct) < abs(best["distance_pct"]):
                best = {
                    "aligned_ma": name,
                    "ma_value": ma_value,
                    "distance_pct": round(dist_pct, 2),
                    "score_boost": base_boost,
                    "narrative_phrase": _ma_phrase(name, ma_value, dist_pct, base_boost),
                }

    if best:
        return best
    return _empty_ma()


def _empty_ma() -> dict:
    return {
        "aligned_ma": None,
        "ma_value": None,
        "distance_pct": 0.0,
        "score_boost": 0,
        "narrative_phrase": "Pullback low does not align with a rising key MA.",
    }


def _ma_phrase(name: str, value: float, dist_pct: float, boost: int) -> str:
    ma_label = {
        "10ema": "rising 10-EMA",
        "21ema": "rising 21-EMA (Minervini's primary support)",
        "50sma": "rising 50-SMA (O'Neil's institutional 'second buy point')",
        "200sma": "rising 200-SMA (Weinstein Stage 2 major-trend retest)",
    }[name]
    if abs(dist_pct) <= 0.5:
        return (
            f"Pullback low landed within {abs(dist_pct):.2f}% of {ma_label} "
            f"(${value:.2f}). Textbook MA-pullback entry."
        )
    if dist_pct > 0:
        return (
            f"Pullback low sits {dist_pct:.2f}% above {ma_label} (${value:.2f}). "
            f"Strong MA-pullback alignment."
        )
    return (
        f"Pullback low sits {abs(dist_pct):.2f}% below {ma_label} (${value:.2f}). "
        f"Within tolerance — undercut + reclaim adds bullish weight."
    )


def _sma(closes: list[float], period: int) -> Optional[float]:
    if len(closes) < period:
        return None
    return sum(closes[-period:]) / period


def _ema(closes: list[float], period: int) -> Optional[float]:
    if len(closes) < period:
        return None
    k = 2 / (period + 1)
    ema = sum(closes[:period]) / period
    for c in closes[period:]:
        ema = c * k + ema * (1 - k)
    return ema


def _slope_sign(closes: list[float], period: int) -> int:
    """Is the MA over `period` bars rising, flat, or falling? +1/0/-1.

    Compares the SMA computed `period` bars ago vs now (using a 20-bar
    look-back gap for stability — short enough to be responsive, long
    enough not to flap on a single bar).
    """
    if len(closes) < period * 2:
        return 0
    older = sum(closes[-(period + 20):-20]) / period
    current = sum(closes[-period:]) / period
    if current > older * 1.005:
        return 1
    if current < older * 0.995:
        return -1
    return 0
