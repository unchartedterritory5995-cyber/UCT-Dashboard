"""One-shot generator for the stage_analysis fixture battery.

Run: python tests/fixtures/stage_analysis/_generate.py

The stage_analysis detector ALWAYS emits exactly ONE Detection summarizing
the chart's current stage. The fixture `expected` block:
  {
    "fires": true,                # always
    "expected_stage": int (1-4),
    "min_confidence": float,
    "max_confidence": float,
    "expected_direction": str ("bullish"|"bearish"|"neutral")
  }

15 fixtures total:
  - 5 positive (one per stage + emerging_stage_2) - high confidence
  - 8 borderline (lower confidence, transitional or ambiguous data)
  - 2 edge (boundary 30-bar minimum and 200-bar maximum window)
"""
import json
import math
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))

T0 = 1700000000
DT = 86400


def _bar(t, o, h, l, c, v):
    return {
        "t": int(t),
        "o": round(float(o), 4),
        "h": round(float(h), 4),
        "l": round(float(l), 4),
        "c": round(float(c), 4),
        "v": round(float(v), 0),
    }


def _smooth_path(n_bars: int, start: float, end: float,
                 noise_amp: float = 0.5, seed: int = 0) -> list:
    """Generate a smooth price path from start -> end with light noise.

    Returns a list of float closing prices.
    """
    rng = random.Random(seed)
    out = []
    for i in range(n_bars):
        # Linear interpolation
        if n_bars > 1:
            lin = start + (end - start) * (i / (n_bars - 1))
        else:
            lin = start
        noise = rng.uniform(-noise_amp, noise_amp)
        out.append(max(0.01, lin + noise))
    return out


def _bars_from_closes(closes: list, vol_pattern=None, seed: int = 0) -> list:
    """Convert a list of closes into OHLCV bars with light wicks/volume.

    vol_pattern: optional list (same length as closes) of volume values;
      if None, defaults to uniform 1_000_000.
    """
    rng = random.Random(seed + 1)
    bars = []
    t = T0
    for i, c in enumerate(closes):
        if i == 0:
            o = c * (1.0 + rng.uniform(-0.005, 0.005))
        else:
            o = closes[i - 1]
        h = max(o, c) * (1.0 + abs(rng.uniform(0.001, 0.01)))
        l = min(o, c) * (1.0 - abs(rng.uniform(0.001, 0.01)))
        v = float(vol_pattern[i]) if vol_pattern is not None else 1_000_000.0
        bars.append(_bar(t, o, h, l, c, v))
        t += DT
    return bars


# ===================================================================
# Positive fixtures
# ===================================================================

def _build_clear_stage_1(seed=1):
    """Flat consolidation after a decline.

    120 bars: bars 0-50 decline from 100 -> 50 (Stage 4),
    bars 50-119 chop in 49-52 range (Stage 1 base).
    Volume dries up after bar 50.
    """
    rng = random.Random(seed)
    decline = _smooth_path(50, 100.0, 50.0, noise_amp=1.0, seed=seed)
    base = []
    for i in range(70):
        base.append(50.5 + rng.uniform(-1.5, 1.5))
    closes = decline + base

    # Volume drops dramatically after bar 50
    vol = []
    for i in range(len(closes)):
        if i < 50:
            vol.append(2_500_000.0 + rng.uniform(-500_000, 500_000))
        else:
            vol.append(800_000.0 + rng.uniform(-200_000, 200_000))
    return _bars_from_closes(closes, vol_pattern=vol, seed=seed)


def _build_clear_stage_2(seed=2):
    """Sustained uptrend with rising 50-SMA + stacked-bullish MAs.

    220 bars: bars 0-40 base around 50, bars 40-219 advance from 50 to 110.
    Volume expands during the advance.
    """
    rng = random.Random(seed)
    base = [50.0 + rng.uniform(-0.8, 0.8) for _ in range(40)]
    advance = _smooth_path(180, 50.0, 110.0, noise_amp=0.8, seed=seed)
    closes = base + advance

    vol = []
    for i in range(len(closes)):
        if i < 40:
            vol.append(800_000.0 + rng.uniform(-100_000, 100_000))
        else:
            # Expanding volume as advance unfolds
            base_v = 1_200_000.0 + (i - 40) * 4_000
            vol.append(base_v + rng.uniform(-200_000, 200_000))
    return _bars_from_closes(closes, vol_pattern=vol, seed=seed)


def _build_clear_stage_3(seed=3):
    """Toppy action after a Stage 2 advance.

    220 bars: bars 0-30 base, bars 30-160 advance 50 -> 100,
    bars 160-219 distribution chop in 95-105 range.
    50-SMA flattens from rising.
    """
    rng = random.Random(seed)
    base = [50.0 + rng.uniform(-0.5, 0.5) for _ in range(30)]
    advance = _smooth_path(130, 50.0, 100.0, noise_amp=0.8, seed=seed)
    # Topping range - up/down chop centered around 100
    topping = []
    for i in range(60):
        topping.append(100.0 + math.sin(i * 0.4) * 3.5 + rng.uniform(-1.2, 1.2))
    closes = base + advance + topping

    vol = []
    for i in range(len(closes)):
        if i < 30:
            vol.append(900_000.0 + rng.uniform(-100_000, 100_000))
        elif i < 160:
            vol.append(1_400_000.0 + rng.uniform(-200_000, 200_000))
        else:
            # Distribution: rising volume on down days (approx)
            vol.append(1_700_000.0 + rng.uniform(-300_000, 400_000))
    return _bars_from_closes(closes, vol_pattern=vol, seed=seed)


def _build_clear_stage_4(seed=4):
    """Sustained downtrend, falling 50-SMA, stacked-bearish MAs.

    220 bars: bars 0-40 distribution near 100, bars 40-219 decline 100 -> 55.
    Volume expands during the decline.
    """
    rng = random.Random(seed)
    top = [100.0 + rng.uniform(-1.2, 1.2) for _ in range(40)]
    decline = _smooth_path(180, 100.0, 55.0, noise_amp=1.0, seed=seed)
    closes = top + decline

    vol = []
    for i in range(len(closes)):
        if i < 40:
            vol.append(1_200_000.0 + rng.uniform(-200_000, 200_000))
        else:
            vol.append(1_800_000.0 + rng.uniform(-300_000, 300_000))
    return _bars_from_closes(closes, vol_pattern=vol, seed=seed)


def _build_emerging_stage_2(seed=5):
    """Just broke out of Stage 1 - MA stack still confirming.

    220 bars: bars 0-50 decline 80 -> 60, bars 50-180 base in 58-62 range,
    bars 180-219 fresh advance 60 -> 75 (the breakout).
    """
    rng = random.Random(seed)
    decline = _smooth_path(50, 80.0, 60.0, noise_amp=0.8, seed=seed)
    base = [60.0 + rng.uniform(-1.5, 1.5) for _ in range(130)]
    advance = _smooth_path(40, 60.0, 75.0, noise_amp=0.6, seed=seed)
    closes = decline + base + advance

    vol = []
    for i in range(len(closes)):
        if i < 50:
            vol.append(1_500_000.0 + rng.uniform(-200_000, 200_000))
        elif i < 180:
            vol.append(700_000.0 + rng.uniform(-100_000, 100_000))
        else:
            vol.append(1_500_000.0 + rng.uniform(-200_000, 200_000))
    return _bars_from_closes(closes, vol_pattern=vol, seed=seed)


# ===================================================================
# Borderline fixtures (still emit ONE detection - same stage as data)
# ===================================================================

def _build_borderline_stage_1_short_window(seed=10):
    """Only 30 bars - just at the minimum window."""
    rng = random.Random(seed)
    closes = [50.0 + rng.uniform(-0.8, 0.8) for _ in range(30)]
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_borderline_stage_2_just_crossed_200(seed=11):
    """Price just crossed above the 200-SMA - emerging Stage 2."""
    rng = random.Random(seed)
    decline = _smooth_path(80, 90.0, 65.0, noise_amp=0.8, seed=seed)
    base = [65.0 + rng.uniform(-0.8, 0.8) for _ in range(80)]
    advance = _smooth_path(50, 65.0, 80.0, noise_amp=0.6, seed=seed)
    closes = decline + base + advance
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_borderline_stage_3_topping_uncertain(seed=12):
    """Could be Stage 2 or Stage 3 - advance just slowing down.

    Bars 0-30 base, 30-180 advance from 50 -> 90, bars 180-219 horizontal at 88-92.
    """
    rng = random.Random(seed)
    base = [50.0 + rng.uniform(-0.5, 0.5) for _ in range(30)]
    advance = _smooth_path(150, 50.0, 90.0, noise_amp=0.8, seed=seed)
    plateau = [90.0 + rng.uniform(-1.5, 1.5) for _ in range(40)]
    closes = base + advance + plateau
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_borderline_stage_3_to_4_transition(seed=13):
    """Just rolled over - distribution -> markdown beginning.

    Bars 0-30 base, 30-160 advance 50 -> 95, 160-200 topping near 95,
    200-219 fresh decline to 80.
    """
    rng = random.Random(seed)
    base = [50.0 + rng.uniform(-0.5, 0.5) for _ in range(30)]
    advance = _smooth_path(130, 50.0, 95.0, noise_amp=0.8, seed=seed)
    top = [95.0 + math.sin(i * 0.4) * 2.0 + rng.uniform(-1.0, 1.0)
           for i in range(40)]
    decline = _smooth_path(20, 95.0, 80.0, noise_amp=0.6, seed=seed)
    closes = base + advance + top + decline
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_borderline_stage_4_to_1_transition(seed=14):
    """Just bottomed - markdown -> basing beginning.

    Bars 0-40 top near 90, 40-180 decline 90 -> 50, 180-219 base near 50.
    """
    rng = random.Random(seed)
    top = [90.0 + rng.uniform(-1.2, 1.2) for _ in range(40)]
    decline = _smooth_path(140, 90.0, 50.0, noise_amp=0.8, seed=seed)
    base = [50.0 + rng.uniform(-1.0, 1.0) for _ in range(40)]
    closes = top + decline + base
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_mixed_signals_stage_3(seed=15):
    """Mixed bullish/bearish signals - hard to call.

    Bars 0-30 base, 30-150 advance 60 -> 100, 150-219 large oscillations
    around 95-100 (no clean direction).
    """
    rng = random.Random(seed)
    base = [60.0 + rng.uniform(-0.5, 0.5) for _ in range(30)]
    advance = _smooth_path(120, 60.0, 100.0, noise_amp=0.8, seed=seed)
    chop = []
    for i in range(70):
        chop.append(97.0 + math.sin(i * 0.25) * 4.0 + rng.uniform(-1.5, 1.5))
    closes = base + advance + chop
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_choppy_no_clear_trend(seed=16):
    """Random walk - no clear directional trend at all.

    Defaults to Stage 1 in the simplified primitive (slope_sign = 0 and
    price near sma_long, which is treated as Stage 1 by the fallback else branch).
    """
    rng = random.Random(seed)
    closes = []
    mid = 75.0
    for _ in range(220):
        step = rng.uniform(-1.5, 1.5)
        mid += step
        mid = max(40.0, min(110.0, mid))  # keep bounded
        closes.append(mid)
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_very_short_series_15_bars(seed=17):
    """Only 15 bars - below the 30-bar full-confidence threshold."""
    rng = random.Random(seed)
    closes = [60.0 + rng.uniform(-1.0, 1.0) for _ in range(15)]
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


# ===================================================================
# Edge fixtures
# ===================================================================

def _build_boundary_30_bar_series(seed=20):
    """Exactly 30 bars - the minimum for full-confidence path.

    The simplified primitive will use sma_long = SMA(50) when len >= 200,
    SMA(50) when len >= 50, otherwise default to Stage 1. With 30 bars,
    the primitive returns Stage 1 directly (the < 50 fallback).
    """
    rng = random.Random(seed)
    # Gentle uptrend in 30 bars
    closes = _smooth_path(30, 50.0, 55.0, noise_amp=0.5, seed=seed)
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_boundary_200_bar_perfect_stage_2(seed=21):
    """200 bars exactly - a perfect Stage 2 advance.

    Tests the upper window boundary with maximum-quality signal.
    """
    rng = random.Random(seed)
    advance = _smooth_path(200, 40.0, 100.0, noise_amp=0.5, seed=seed)
    vol = []
    for i in range(200):
        vol.append(1_500_000.0 + (i * 6_000) + rng.uniform(-200_000, 200_000))
    return _bars_from_closes(advance, vol_pattern=vol, seed=seed)


# ===================================================================
# Contexts
# ===================================================================

def _ctx(stage, ma_alignment, rs_trend, regime, volume_signature="neutral"):
    return {
        "trend_stage": stage,
        "rs_trend": rs_trend,
        "ma_alignment": ma_alignment,
        "volume_signature": volume_signature,
        "regime": regime,
        "nearest_resistance": None,
        "nearest_support": None,
        "days_to_earnings": None,
        "sector_strength_rank": None,
    }


# ===================================================================
# Writer
# ===================================================================

def _write(name, category, bars, context, expected):
    payload = {
        "name": name,
        "category": category,
        "expected": expected,
        "context": context,
        "bars": bars,
    }
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


def main():
    # ====================== 5 POSITIVE ======================
    _write("clear_stage_1", "positive",
           _build_clear_stage_1(seed=1),
           _ctx(1, "mixed", "flat", "neutral", "contracting"),
           {
               "fires": True,
               "expected_stage": 1,
               "min_confidence": 70.0,
               "max_confidence": 100.0,
               "expected_direction": "neutral",
           })

    _write("clear_stage_2", "positive",
           _build_clear_stage_2(seed=2),
           _ctx(2, "stacked_bullish", "up", "bullish", "expanding"),
           {
               "fires": True,
               "expected_stage": 2,
               "min_confidence": 85.0,
               "max_confidence": 100.0,
               "expected_direction": "bullish",
           })

    _write("clear_stage_3", "positive",
           _build_clear_stage_3(seed=3),
           _ctx(3, "mixed", "flat", "neutral", "neutral"),
           {
               "fires": True,
               "expected_stage": 3,
               "min_confidence": 60.0,
               "max_confidence": 100.0,
               "expected_direction": "neutral",
           })

    _write("clear_stage_4", "positive",
           _build_clear_stage_4(seed=4),
           _ctx(4, "stacked_bearish", "down", "bearish", "expanding"),
           {
               "fires": True,
               "expected_stage": 4,
               "min_confidence": 85.0,
               "max_confidence": 100.0,
               "expected_direction": "bearish",
           })

    _write("emerging_stage_2", "positive",
           _build_emerging_stage_2(seed=5),
           _ctx(2, "mixed", "up", "bullish", "expanding"),
           {
               "fires": True,
               "expected_stage": 2,
               "min_confidence": 65.0,
               "max_confidence": 100.0,
               "expected_direction": "bullish",
           })

    # ====================== 8 BORDERLINE ======================
    _write("borderline_stage_1_short_window", "negative",
           _build_borderline_stage_1_short_window(seed=10),
           _ctx(1, "mixed", "flat", "neutral"),
           {
               "fires": True,
               "expected_stage": 1,
               "min_confidence": 50.0,
               "max_confidence": 100.0,
               "expected_direction": "neutral",
           })

    _write("borderline_stage_2_just_crossed", "negative",
           _build_borderline_stage_2_just_crossed_200(seed=11),
           _ctx(2, "mixed", "up", "neutral"),
           {
               "fires": True,
               "expected_stage": 2,
               "min_confidence": 60.0,
               "max_confidence": 100.0,
               "expected_direction": "bullish",
           })

    _write("borderline_stage_3_topping_uncertain", "negative",
           _build_borderline_stage_3_topping_uncertain(seed=12),
           _ctx(2, "mixed", "flat", "neutral"),
           {
               "fires": True,
               # Could be 2 or 3 - let the detector classify it
               "expected_stage": None,
               "expected_stage_in": [2, 3],
               "min_confidence": 50.0,
               "max_confidence": 100.0,
               "expected_direction_in": ["bullish", "neutral"],
           })

    _write("borderline_stage_3_to_4_transition", "negative",
           _build_borderline_stage_3_to_4_transition(seed=13),
           _ctx(3, "mixed", "down", "neutral"),
           {
               "fires": True,
               "expected_stage": None,
               "expected_stage_in": [3, 4],
               "min_confidence": 50.0,
               "max_confidence": 100.0,
               "expected_direction_in": ["neutral", "bearish"],
           })

    _write("borderline_stage_4_to_1_transition", "negative",
           _build_borderline_stage_4_to_1_transition(seed=14),
           _ctx(4, "mixed", "flat", "neutral"),
           {
               "fires": True,
               "expected_stage": None,
               "expected_stage_in": [1, 4],
               "min_confidence": 50.0,
               "max_confidence": 100.0,
               "expected_direction_in": ["neutral", "bearish"],
           })

    _write("mixed_signals_stage_3", "negative",
           _build_mixed_signals_stage_3(seed=15),
           _ctx(2, "mixed", "flat", "neutral"),
           {
               "fires": True,
               "expected_stage": None,
               "expected_stage_in": [1, 2, 3],
               "min_confidence": 50.0,
               "max_confidence": 100.0,
               "expected_direction_in": ["bullish", "neutral"],
           })

    _write("choppy_no_clear_trend", "negative",
           _build_choppy_no_clear_trend(seed=16),
           _ctx(1, "mixed", "flat", "neutral"),
           {
               "fires": True,
               "expected_stage": None,
               "expected_stage_in": [1, 2, 3, 4],
               "min_confidence": 50.0,
               "max_confidence": 100.0,
               "expected_direction_in": ["bullish", "bearish", "neutral"],
           })

    _write("very_short_series_15_bars", "negative",
           _build_very_short_series_15_bars(seed=17),
           _ctx(1, "mixed", "flat", "neutral"),
           {
               "fires": True,
               "expected_stage": 1,
               "min_confidence": 50.0,
               "max_confidence": 50.0,
               "expected_direction": "neutral",
           })

    # ====================== 2 EDGE ======================
    _write("boundary_30_bar_series", "edge",
           _build_boundary_30_bar_series(seed=20),
           _ctx(1, "mixed", "flat", "neutral"),
           {
               "fires": True,
               "expected_stage": 1,
               "min_confidence": 50.0,
               "max_confidence": 100.0,
               "expected_direction": "neutral",
           })

    _write("boundary_200_bar_perfect_stage_2", "edge",
           _build_boundary_200_bar_perfect_stage_2(seed=21),
           _ctx(2, "stacked_bullish", "up", "bullish", "expanding"),
           {
               "fires": True,
               "expected_stage": 2,
               "min_confidence": 85.0,
               "max_confidence": 100.0,
               "expected_direction": "bullish",
           })

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
