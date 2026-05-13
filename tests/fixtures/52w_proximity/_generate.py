"""One-shot generator for the 52w_proximity fixture battery.

Run: python tests/fixtures/52w_proximity/_generate.py

The 52w_proximity detector ALWAYS emits exactly ONE Detection summarizing
the chart's proximity to the 52-week high/low. The fixture `expected`
block:
  {
    "fires": true,                       # always
    "expected_classification": "near_high"|"near_low"|"mid_range",
    "expected_direction": "bullish"|"bearish"|"neutral",
    "min_confidence": float,
    "max_confidence": float,
  }

15 fixtures total. Because the detector ALWAYS emits, 'negative' here
means a fixture that classifies as 'mid_range' (informative but
non-directional) rather than 'fires=False'.

  - 5 positive (high-edge bullish/bearish proximity):
      near_high_within_2pct, near_low_within_2pct,
      at_exact_52w_high, at_exact_52w_low,
      recently_made_new_high
  - 8 'negative' (mid_range classifications + transitional cases):
      mid_range_50pct_off_high, shorter_series_partial_data,
      uptrend_near_top_but_pulled_back,
      downtrend_near_bottom_but_bounced,
      stage_3_topping_in_mid_range,
      stage_4_decline_in_mid_range,
      basing_in_mid_range,
      sideways_drift_in_mid_range
  - 2 edge: boundary_5pct_from_high, boundary_5pct_from_low
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


def _bars_from_closes(closes, vol_pattern=None, seed=0):
    rng = random.Random(seed + 1)
    bars = []
    t = T0
    for i, c in enumerate(closes):
        if i == 0:
            o = c * (1.0 + rng.uniform(-0.003, 0.003))
        else:
            o = closes[i - 1]
        h = max(o, c) * (1.0 + abs(rng.uniform(0.001, 0.008)))
        l = min(o, c) * (1.0 - abs(rng.uniform(0.001, 0.008)))
        v = float(vol_pattern[i]) if vol_pattern is not None else 1_000_000.0
        bars.append(_bar(t, o, h, l, c, v))
        t += DT
    return bars


def _smooth_path(n_bars, start, end, noise_amp=0.5, seed=0):
    rng = random.Random(seed)
    out = []
    for i in range(n_bars):
        if n_bars > 1:
            lin = start + (end - start) * (i / (n_bars - 1))
        else:
            lin = start
        out.append(max(0.01, lin + rng.uniform(-noise_amp, noise_amp)))
    return out


# ===================================================================
# Positive fixtures (high-edge directional classifications)
# ===================================================================

def _build_near_high_within_2pct(seed=1):
    """260 bars. Sustained uptrend; current close ~2% off the 52w high."""
    rng = random.Random(seed)
    # Long advance from 50 to 100 over 250 bars
    advance = _smooth_path(250, 50.0, 100.0, noise_amp=0.6, seed=seed)
    # Final 10 bars pull back ~2% from the high
    closes = advance + _smooth_path(10, 100.0, 98.2, noise_amp=0.3, seed=seed)
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_near_low_within_2pct(seed=2):
    """260 bars. Sustained downtrend; current close ~2% above the 52w low."""
    rng = random.Random(seed)
    decline = _smooth_path(250, 100.0, 50.0, noise_amp=0.6, seed=seed)
    closes = decline + _smooth_path(10, 50.0, 51.0, noise_amp=0.3, seed=seed)
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_at_exact_52w_high(seed=3):
    """260 bars. Current close IS the 52w high (0% distance)."""
    advance = _smooth_path(259, 50.0, 99.5, noise_amp=0.6, seed=seed)
    closes = advance + [100.0]  # final bar exactly at 100
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_at_exact_52w_low(seed=4):
    """260 bars. Current close IS the 52w low (0% distance above)."""
    decline = _smooth_path(259, 100.0, 50.5, noise_amp=0.6, seed=seed)
    closes = decline + [50.0]
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_recently_made_new_high(seed=5):
    """260 bars. 52w high set in the last 3 bars, current bar slightly below."""
    advance = _smooth_path(255, 50.0, 95.0, noise_amp=0.6, seed=seed)
    # Push high to 100 at bar -3, then small consolidation
    tail = [100.0, 99.5, 98.5, 98.0, 98.2]
    closes = advance + tail
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


# ===================================================================
# 'Negative' / mid-range classifications
# ===================================================================

def _build_mid_range_50pct_off_high(seed=10):
    """260 bars. Climbed to 100 then declined to ~50% of the range."""
    rng = random.Random(seed)
    advance = _smooth_path(150, 50.0, 100.0, noise_amp=0.6, seed=seed)
    decline = _smooth_path(110, 100.0, 75.0, noise_amp=0.6, seed=seed)
    closes = advance + decline
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_shorter_series_partial_data(seed=11):
    """Only 100 bars - partial window. Mid-range positioning."""
    closes = _smooth_path(100, 50.0, 70.0, noise_amp=0.5, seed=seed)
    # Pull back from 70 to 60 in last 30 bars
    closes = closes[:70] + _smooth_path(30, 70.0, 60.0, noise_amp=0.5, seed=seed)
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_uptrend_near_top_but_pulled_back(seed=12):
    """Uptrend stalled; current close 8% off high - still mid-range."""
    advance = _smooth_path(240, 50.0, 100.0, noise_amp=0.6, seed=seed)
    pullback = _smooth_path(20, 100.0, 92.0, noise_amp=0.5, seed=seed)
    closes = advance + pullback
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_downtrend_near_bottom_but_bounced(seed=13):
    """Downtrend stalled; current close 8% above low - still mid-range."""
    decline = _smooth_path(240, 100.0, 50.0, noise_amp=0.6, seed=seed)
    bounce = _smooth_path(20, 50.0, 54.0, noise_amp=0.5, seed=seed)
    closes = decline + bounce
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_stage_3_topping_in_mid_range(seed=14):
    """Stage 3 distribution. Climbed to 100 then dropped to mid 70s."""
    rng = random.Random(seed)
    advance = _smooth_path(150, 50.0, 100.0, noise_amp=0.6, seed=seed)
    # 110 bars rolling over from 100 to ~75 (mid of 50-100 range)
    rolling_over = _smooth_path(110, 100.0, 75.0, noise_amp=1.5, seed=seed + 100)
    closes = advance + rolling_over
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_stage_4_decline_in_mid_range(seed=15):
    """Stage 4 markdown - declined from 100 to ~70 then bounced to 80.
    Total 252 bars so high stays inside the 52w window."""
    rng = random.Random(seed)
    top = [100.0 + (i % 5) * 0.2 for i in range(40)]
    decline = _smooth_path(120, 100.0, 65.0, noise_amp=0.5, seed=seed)
    bounce = _smooth_path(92, 65.0, 80.0, noise_amp=1.0, seed=seed + 50)
    closes = top + decline + bounce
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_basing_in_mid_range(seed=16):
    """Stage 1 base in the actual middle - decline to a basing zone that's
    midway between the high and a subsequent lower low.

    Structure: 100 (high) -> 50 (low at bar 120) -> back up to 75 (current).
    Current close at 75 = 25% off high, 50% above low - true mid range.
    """
    rng = random.Random(seed)
    decline = _smooth_path(120, 100.0, 50.0, noise_amp=0.6, seed=seed)
    recover = _smooth_path(140, 50.0, 75.0, noise_amp=1.5, seed=seed + 200)
    closes = decline + recover
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_sideways_drift_in_mid_range(seed=17):
    """Sideways drift - tight range with current close at the exact middle."""
    rng = random.Random(seed)
    closes = []
    for i in range(260):
        # Drift covering ~84 to 66 (=27% peak-trough), current bar at 75 (mid)
        closes.append(75.0 + math.cos(i * 0.05) * 9.0 + rng.uniform(-1.0, 1.0))
    # Force last bar to be at midpoint
    closes[-1] = 75.0
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


# ===================================================================
# Edge fixtures (right at the 5% threshold)
# ===================================================================

def _build_boundary_5pct_from_high(seed=20):
    """Current close exactly ~5% off the 52w high."""
    advance = _smooth_path(250, 50.0, 100.0, noise_amp=0.6, seed=seed)
    # Pull back to 95 (exactly 5% off 100)
    closes = advance + _smooth_path(10, 100.0, 95.0, noise_amp=0.2, seed=seed)
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_boundary_5pct_from_low(seed=21):
    """Current close exactly ~5% above the 52w low."""
    decline = _smooth_path(250, 100.0, 50.0, noise_amp=0.6, seed=seed)
    # Bounce to 52.5 (exactly 5% above 50)
    closes = decline + _smooth_path(10, 50.0, 52.5, noise_amp=0.2, seed=seed)
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


# ===================================================================
# Context + writer
# ===================================================================

def _ctx(stage=2, rs="flat", ma_align="mixed", regime="neutral",
         vol_sig="neutral"):
    return {
        "trend_stage": stage,
        "rs_trend": rs,
        "ma_alignment": ma_align,
        "volume_signature": vol_sig,
        "regime": regime,
        "nearest_resistance": None,
        "nearest_support": None,
        "days_to_earnings": None,
        "sector_strength_rank": None,
    }


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
    _write("near_high_within_2pct", "positive",
           _build_near_high_within_2pct(seed=1),
           _ctx(stage=2, rs="up", ma_align="stacked_bullish",
                regime="bullish"),
           {
               "fires": True,
               "expected_classification": "near_high",
               "expected_direction": "bullish",
               "min_confidence": 75.0,
               "max_confidence": 100.0,
           })

    _write("near_low_within_2pct", "positive",
           _build_near_low_within_2pct(seed=2),
           _ctx(stage=4, rs="down", ma_align="stacked_bearish",
                regime="bearish"),
           {
               "fires": True,
               "expected_classification": "near_low",
               "expected_direction": "bearish",
               "min_confidence": 75.0,
               "max_confidence": 100.0,
           })

    _write("at_exact_52w_high", "positive",
           _build_at_exact_52w_high(seed=3),
           _ctx(stage=2, rs="up", ma_align="stacked_bullish",
                regime="bullish"),
           {
               "fires": True,
               "expected_classification": "near_high",
               "expected_direction": "bullish",
               "min_confidence": 90.0,
               "max_confidence": 100.0,
           })

    _write("at_exact_52w_low", "positive",
           _build_at_exact_52w_low(seed=4),
           _ctx(stage=4, rs="down", ma_align="stacked_bearish",
                regime="bearish"),
           {
               "fires": True,
               "expected_classification": "near_low",
               "expected_direction": "bearish",
               "min_confidence": 90.0,
               "max_confidence": 100.0,
           })

    _write("recently_made_new_high", "positive",
           _build_recently_made_new_high(seed=5),
           _ctx(stage=2, rs="up", ma_align="stacked_bullish",
                regime="bullish"),
           {
               "fires": True,
               "expected_classification": "near_high",
               "expected_direction": "bullish",
               "min_confidence": 75.0,
               "max_confidence": 100.0,
           })

    # ====================== 8 NEGATIVE (mid-range / partial / context) ======================
    _write("mid_range_50pct_off_high", "negative",
           _build_mid_range_50pct_off_high(seed=10),
           _ctx(stage=3, rs="flat"),
           {
               "fires": True,
               "expected_classification": "mid_range",
               "expected_direction": "neutral",
               "min_confidence": 50.0,
               "max_confidence": 70.0,
           })

    _write("shorter_series_partial_data", "negative",
           _build_shorter_series_partial_data(seed=11),
           _ctx(stage=2, rs="flat"),
           {
               "fires": True,
               "expected_classification": "mid_range",
               "expected_direction": "neutral",
               "min_confidence": 50.0,
               "max_confidence": 70.0,
           })

    _write("uptrend_near_top_but_pulled_back", "negative",
           _build_uptrend_near_top_but_pulled_back(seed=12),
           _ctx(stage=2, rs="up"),
           {
               "fires": True,
               "expected_classification": "mid_range",
               "expected_direction": "neutral",
               "min_confidence": 50.0,
               "max_confidence": 70.0,
           })

    _write("downtrend_near_bottom_but_bounced", "negative",
           _build_downtrend_near_bottom_but_bounced(seed=13),
           _ctx(stage=4, rs="down"),
           {
               "fires": True,
               "expected_classification": "mid_range",
               "expected_direction": "neutral",
               "min_confidence": 50.0,
               "max_confidence": 70.0,
           })

    _write("stage_3_topping_in_mid_range", "negative",
           _build_stage_3_topping_in_mid_range(seed=14),
           _ctx(stage=3, rs="flat"),
           {
               "fires": True,
               "expected_classification": "mid_range",
               "expected_direction": "neutral",
               "min_confidence": 50.0,
               "max_confidence": 70.0,
           })

    _write("stage_4_decline_in_mid_range", "negative",
           _build_stage_4_decline_in_mid_range(seed=15),
           _ctx(stage=4, rs="down"),
           {
               "fires": True,
               "expected_classification": "mid_range",
               "expected_direction": "neutral",
               "min_confidence": 50.0,
               "max_confidence": 70.0,
           })

    _write("basing_in_mid_range", "negative",
           _build_basing_in_mid_range(seed=16),
           _ctx(stage=1, rs="flat"),
           {
               "fires": True,
               "expected_classification": "mid_range",
               "expected_direction": "neutral",
               "min_confidence": 50.0,
               "max_confidence": 70.0,
           })

    _write("sideways_drift_in_mid_range", "negative",
           _build_sideways_drift_in_mid_range(seed=17),
           _ctx(stage=1, rs="flat"),
           {
               "fires": True,
               "expected_classification": "mid_range",
               "expected_direction": "neutral",
               "min_confidence": 50.0,
               "max_confidence": 70.0,
           })

    # ====================== 2 EDGE ======================
    _write("boundary_5pct_from_high", "edge",
           _build_boundary_5pct_from_high(seed=20),
           _ctx(stage=2, rs="up"),
           {
               "fires": True,
               # Could be near_high (exactly at 5%) or mid_range (just over 5%) -
               # let detector classify; require directional alignment
               "expected_classification_in": ["near_high", "mid_range"],
               "expected_direction_in": ["bullish", "neutral"],
               "min_confidence": 50.0,
               "max_confidence": 100.0,
           })

    _write("boundary_5pct_from_low", "edge",
           _build_boundary_5pct_from_low(seed=21),
           _ctx(stage=4, rs="down"),
           {
               "fires": True,
               "expected_classification_in": ["near_low", "mid_range"],
               "expected_direction_in": ["bearish", "neutral"],
               "min_confidence": 50.0,
               "max_confidence": 100.0,
           })

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
