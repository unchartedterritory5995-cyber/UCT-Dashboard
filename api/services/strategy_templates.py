"""Strategy template signal generators for the backtester.

Each generator walks OHLCV bars, applies entry/exit rules, and returns a list
of signal dicts.  Signal shape:
    {"t": int, "side": "long", "kind": "entry"|"exit", "price": float, "reason": str}

Bars shape:
    {"t": int (unix seconds), "o": float, "h": float, "l": float, "c": float, "v": float}

All strategies are long-only and enforce one-position-at-a-time state.
Indicator warm-up positions where computed values are None are skipped silently.
"""

from __future__ import annotations

from typing import Any

from api.services.indicator_compute import (
    compute_rsi,
    compute_macd,
    compute_bb,
    compute_sma,
)


# ---------------------------------------------------------------------------
# Strategy registry
# ---------------------------------------------------------------------------

def list_strategies() -> list[dict[str, Any]]:
    """Return descriptors for all 4 strategy templates."""
    return [
        {
            "id": "rsi_mean_reversion",
            "name": "RSI Mean Reversion",
            "description": (
                "Buys when RSI crosses above 30 (oversold reversal) "
                "and sells when RSI crosses above 70 (overbought)."
            ),
            "params": [
                {"name": "period", "default": 14, "min": 2, "max": 50},
            ],
        },
        {
            "id": "macd_crossover",
            "name": "MACD Crossover",
            "description": (
                "Buys when the MACD line crosses above the signal line "
                "and sells when it crosses below."
            ),
            "params": [
                {"name": "fast",   "default": 12, "min": 2,  "max": 30},
                {"name": "slow",   "default": 26, "min": 5,  "max": 60},
                {"name": "signal", "default": 9,  "min": 2,  "max": 20},
            ],
        },
        {
            "id": "bb_breakout",
            "name": "Bollinger Band Breakout",
            "description": (
                "Buys when close breaks above the upper Bollinger Band "
                "and sells when close drops back below the middle band (SMA)."
            ),
            "params": [
                {"name": "period", "default": 20,  "min": 5,   "max": 50},
                {"name": "stddev", "default": 2.0, "min": 1.0, "max": 4.0},
            ],
        },
        {
            "id": "ma_crossover",
            "name": "MA Golden/Death Cross",
            "description": (
                "Buys on a golden cross (fast SMA crosses above slow SMA) "
                "and sells on a death cross (fast crosses below slow SMA)."
            ),
            "params": [
                {"name": "fast", "default": 50,  "min": 5,   "max": 100},
                {"name": "slow", "default": 200, "min": 50,  "max": 400},
            ],
        },
    ]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _signal(t: int, kind: str, price: float, reason: str) -> dict[str, Any]:
    return {"t": t, "side": "long", "kind": kind, "price": price, "reason": reason}


def _crosses_above(prev: float | None, curr: float | None, level: float) -> bool:
    """True when prev <= level and curr > level (both must be non-None)."""
    if prev is None or curr is None:
        return False
    return prev <= level < curr


def _crosses_below(prev: float | None, curr: float | None, level: float) -> bool:
    """True when prev >= level and curr < level (both must be non-None)."""
    if prev is None or curr is None:
        return False
    return prev >= level > curr


def _line_crosses_above(
    prev_a: float | None, prev_b: float | None,
    curr_a: float | None, curr_b: float | None,
) -> bool:
    """True when line A crosses above line B (both non-None at both steps)."""
    if any(v is None for v in (prev_a, prev_b, curr_a, curr_b)):
        return False
    return prev_a <= prev_b and curr_a > curr_b


def _line_crosses_below(
    prev_a: float | None, prev_b: float | None,
    curr_a: float | None, curr_b: float | None,
) -> bool:
    """True when line A crosses below line B (both non-None at both steps)."""
    if any(v is None for v in (prev_a, prev_b, curr_a, curr_b)):
        return False
    return prev_a >= prev_b and curr_a < curr_b


# ---------------------------------------------------------------------------
# RSI Mean Reversion
# ---------------------------------------------------------------------------

def generate_rsi_mean_reversion_signals(
    bars: list[dict],
    period: int = 14,
) -> list[dict[str, Any]]:
    """Buy when RSI(period) crosses above 30. Sell when RSI crosses above 70.
    Long-only. One open position at a time.
    """
    if not bars:
        return []

    closes = [b["c"] for b in bars]
    rsi = compute_rsi(closes, period)

    signals: list[dict] = []
    position_open = False

    for i in range(1, len(bars)):
        prev_rsi = rsi[i - 1]
        curr_rsi = rsi[i]
        price = bars[i]["c"]
        t = bars[i]["t"]

        if not position_open and _crosses_above(prev_rsi, curr_rsi, 30):
            signals.append(_signal(t, "entry", price, "RSI crossed above 30"))
            position_open = True
        elif position_open and _crosses_above(prev_rsi, curr_rsi, 70):
            signals.append(_signal(t, "exit", price, "RSI crossed above 70"))
            position_open = False

    return signals


# ---------------------------------------------------------------------------
# MACD Crossover
# ---------------------------------------------------------------------------

def generate_macd_crossover_signals(
    bars: list[dict],
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> list[dict[str, Any]]:
    """Buy when MACD line crosses above signal line. Sell when crosses below.
    Long-only. One open position at a time.
    """
    if not bars:
        return []

    closes = [b["c"] for b in bars]
    macd_line, sig_line, _ = compute_macd(closes, fast=fast, slow=slow, signal=signal)

    signals: list[dict] = []
    position_open = False

    for i in range(1, len(bars)):
        prev_m = macd_line[i - 1]
        curr_m = macd_line[i]
        prev_s = sig_line[i - 1]
        curr_s = sig_line[i]
        price = bars[i]["c"]
        t = bars[i]["t"]

        if not position_open and _line_crosses_above(prev_m, prev_s, curr_m, curr_s):
            signals.append(_signal(t, "entry", price, "MACD crossed above signal"))
            position_open = True
        elif position_open and _line_crosses_below(prev_m, prev_s, curr_m, curr_s):
            signals.append(_signal(t, "exit", price, "MACD crossed below signal"))
            position_open = False

    return signals


# ---------------------------------------------------------------------------
# Bollinger Band Breakout
# ---------------------------------------------------------------------------

def generate_bb_breakout_signals(
    bars: list[dict],
    period: int = 20,
    stddev: float = 2.0,
) -> list[dict[str, Any]]:
    """Buy when close crosses above upper band. Sell when close drops below middle band.
    Long-only. One open position at a time.
    """
    if not bars:
        return []

    closes = [b["c"] for b in bars]
    upper, middle, _ = compute_bb(closes, period=period, stddev=stddev)

    signals: list[dict] = []
    position_open = False

    for i in range(1, len(bars)):
        prev_c = closes[i - 1]
        curr_c = closes[i]
        prev_u = upper[i - 1]
        curr_u = upper[i]
        prev_m = middle[i - 1]
        curr_m = middle[i]
        price = bars[i]["c"]
        t = bars[i]["t"]

        if not position_open and _line_crosses_above(prev_c, prev_u, curr_c, curr_u):
            signals.append(_signal(t, "entry", price, "Close broke above upper Bollinger Band"))
            position_open = True
        elif position_open and prev_m is not None and curr_m is not None:
            # Exit when close drops below the middle band (SMA)
            if prev_c >= prev_m and curr_c < curr_m:
                signals.append(_signal(t, "exit", price, "Close dropped below middle band"))
                position_open = False

    return signals


# ---------------------------------------------------------------------------
# MA Golden / Death Cross
# ---------------------------------------------------------------------------

def generate_ma_crossover_signals(
    bars: list[dict],
    fast: int = 50,
    slow: int = 200,
) -> list[dict[str, Any]]:
    """Buy on golden cross (SMA fast crosses above SMA slow). Sell on death cross.
    Long-only. One open position at a time.
    """
    if not bars:
        return []

    closes = [b["c"] for b in bars]
    fast_sma = compute_sma(closes, fast)
    slow_sma = compute_sma(closes, slow)

    signals: list[dict] = []
    position_open = False
    both_valid_prev = False  # tracks whether the prior bar had both SMAs valid

    for i in range(1, len(bars)):
        prev_f = fast_sma[i - 1]
        curr_f = fast_sma[i]
        prev_s = slow_sma[i - 1]
        curr_s = slow_sma[i]
        price = bars[i]["c"]
        t = bars[i]["t"]

        curr_both_valid = curr_f is not None and curr_s is not None

        if curr_both_valid:
            if not both_valid_prev:
                # First bar where both SMAs are defined — treat as initial crossover state
                if curr_f > curr_s and not position_open:
                    signals.append(_signal(t, "entry", price, "Golden cross: fast SMA crossed above slow SMA"))
                    position_open = True
                elif curr_f < curr_s and position_open:
                    signals.append(_signal(t, "exit", price, "Death cross: fast SMA crossed below slow SMA"))
                    position_open = False
            else:
                # Normal crossover detection
                if not position_open and _line_crosses_above(prev_f, prev_s, curr_f, curr_s):
                    signals.append(_signal(t, "entry", price, "Golden cross: fast SMA crossed above slow SMA"))
                    position_open = True
                elif position_open and _line_crosses_below(prev_f, prev_s, curr_f, curr_s):
                    signals.append(_signal(t, "exit", price, "Death cross: fast SMA crossed below slow SMA"))
                    position_open = False

        both_valid_prev = curr_both_valid

    return signals
