"""One-shot generator for the range_detection fixture battery.

Run: python tests/fixtures/range_detection/_generate.py

range_detection emits 0 or 1 Detection. Expected block:
  {
    "fires": bool,
    "min_count": int (0 or 1),
    "max_count": int (0 or 1),
    "min_confidence": float (when fires),
    "max_confidence": float (when fires),
    "expected_duration_min": int (optional),
    "expected_depth_max_pct": float (optional),
  }

15 fixtures:
  - 5 positive: clean_textbook_range, tight_range, wide_acceptable_range,
                recent_emerging_range, perfect_touches
  - 8 negative: no_range_trending, too_short, too_wide, only_1_touch_each,
                broken_range, declining_window, single_spike,
                insufficient_data
  - 2 edge: boundary_10_bars, boundary_10pct_depth
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


def _bars_from_closes(closes, vol_pattern=None, seed=0,
                     range_high=None, range_low=None):
    """Convert closes to bars. If range_high/range_low supplied, the
    high/low extrema are pinned within wicks at the band boundaries
    on most bars so the range detector validates touches cleanly."""
    rng = random.Random(seed + 1)
    bars = []
    t = T0
    for i, c in enumerate(closes):
        if i == 0:
            o = c * (1.0 + rng.uniform(-0.003, 0.003))
        else:
            o = closes[i - 1]
        # Tight wicks
        h = max(o, c) * (1.0 + abs(rng.uniform(0.001, 0.006)))
        l = min(o, c) * (1.0 - abs(rng.uniform(0.001, 0.006)))
        # Clamp to global range bounds if provided
        if range_high is not None and h > range_high:
            h = range_high
        if range_low is not None and l < range_low:
            l = range_low
        v = float(vol_pattern[i]) if vol_pattern is not None else 1_000_000.0
        bars.append(_bar(t, o, h, l, c, v))
        t += DT
    return bars


# ===================================================================
# Positive fixtures
# ===================================================================

def _build_clean_textbook_range(seed=1):
    """20 bars, ~6% depth, between 100 and 106 with clear touches."""
    rng = random.Random(seed)
    # 30 bars of pre-history (prior decline into the base)
    pre = [120 - 0.7 * i + rng.uniform(-0.3, 0.3) for i in range(30)]
    # 20 bars of ranging between 100 and 106
    rng_bars = []
    for i in range(20):
        # Oscillate: high touches first, low touches later, alternating
        if i in (0, 5, 10, 15):
            c = 100.5 + rng.uniform(-0.2, 0.2)  # near low
        elif i in (3, 8, 13, 18):
            c = 105.5 + rng.uniform(-0.2, 0.2)  # near high
        else:
            c = 103.0 + rng.uniform(-1.5, 1.5)
        rng_bars.append(c)
    closes = pre + rng_bars
    # Force the last 20 bars to be the range
    vol = [1_400_000.0] * 30 + [700_000.0] * 20
    return _bars_from_closes(closes, vol_pattern=vol, seed=seed,
                             range_high=106.0, range_low=100.0)


def _build_tight_range(seed=2):
    """15 bars, ~3% depth, between 50 and 51.5."""
    rng = random.Random(seed)
    pre = [60 - 0.6 * i + rng.uniform(-0.2, 0.2) for i in range(25)]
    rng_bars = []
    for i in range(15):
        if i in (0, 4, 8, 12):
            c = 50.2 + rng.uniform(-0.1, 0.1)
        elif i in (2, 6, 10, 14):
            c = 51.3 + rng.uniform(-0.1, 0.1)
        else:
            c = 50.75 + rng.uniform(-0.5, 0.5)
        rng_bars.append(c)
    closes = pre + rng_bars
    vol = [1_200_000.0] * 25 + [600_000.0] * 15
    return _bars_from_closes(closes, vol_pattern=vol, seed=seed,
                             range_high=51.5, range_low=50.0)


def _build_wide_acceptable_range(seed=3):
    """40 bars, ~9% depth, between 80 and 87."""
    rng = random.Random(seed)
    pre = [70 + 0.1 * i + rng.uniform(-0.3, 0.3) for i in range(20)]
    rng_bars = []
    for i in range(40):
        bucket = i % 4
        if bucket == 0:
            c = 80.5 + rng.uniform(-0.3, 0.3)
        elif bucket == 1:
            c = 83.0 + rng.uniform(-1.0, 1.0)
        elif bucket == 2:
            c = 86.5 + rng.uniform(-0.3, 0.3)
        else:
            c = 83.5 + rng.uniform(-1.0, 1.0)
        rng_bars.append(c)
    closes = pre + rng_bars
    vol = [1_500_000.0] * 20 + [900_000.0] * 40
    return _bars_from_closes(closes, vol_pattern=vol, seed=seed,
                             range_high=87.0, range_low=80.0)


def _build_recent_emerging_range(seed=4):
    """Just-formed 12-bar range at the very end. ~5% depth."""
    rng = random.Random(seed)
    pre = [70 + 1.2 * i + rng.uniform(-0.4, 0.4) for i in range(28)]
    last_pre_close = pre[-1]
    rng_bars = []
    base = last_pre_close
    for i in range(12):
        if i in (0, 4, 8):
            c = base + 0.2
        elif i in (2, 6, 10):
            c = base + 4.8
        else:
            c = base + 2.5 + rng.uniform(-1.0, 1.0)
        rng_bars.append(c)
    closes = pre + rng_bars
    vol = [1_400_000.0] * 28 + [800_000.0] * 12
    return _bars_from_closes(closes, vol_pattern=vol, seed=seed,
                             range_high=base + 5.0, range_low=base)


def _build_perfect_touches(seed=5):
    """20-bar range, 5 touches per side at $100 and $105."""
    rng = random.Random(seed)
    pre = [115 - 0.5 * i + rng.uniform(-0.2, 0.2) for i in range(25)]
    rng_bars = []
    # Alternating touches
    pattern = [100.2, 102.5, 104.8, 102.5, 100.2, 102.5, 104.8, 102.5,
               100.2, 102.5, 104.8, 102.5, 100.2, 102.5, 104.8, 102.5,
               100.2, 102.5, 104.8, 102.5]
    for c in pattern:
        rng_bars.append(c + rng.uniform(-0.1, 0.1))
    closes = pre + rng_bars
    vol = [1_400_000.0] * 25 + [700_000.0] * 20
    return _bars_from_closes(closes, vol_pattern=vol, seed=seed,
                             range_high=105.0, range_low=100.0)


# ===================================================================
# Negative fixtures
# ===================================================================

def _build_no_range_trending(seed=10):
    """Clean steep uptrend - no bounded window exists."""
    rng = random.Random(seed)
    # Steep uptrend - 50 -> 200 over 60 bars. Every 10-bar window spans
    # >10% depth so no range can validate.
    closes = [50 + 2.5 * i + rng.uniform(-0.4, 0.4) for i in range(60)]
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_too_short(seed=11):
    """Range only 8 bars wide. Preceded by a steep climb so older bars
    cannot pad the range into 10+ bars within the depth tolerance."""
    rng = random.Random(seed)
    # 40 bars of steep climb 50 -> 150
    pre = [50 + 2.5 * i + rng.uniform(-0.3, 0.3) for i in range(40)]
    rng_bars = []
    for i in range(8):
        if i % 2 == 0:
            c = 149.5 + rng.uniform(-0.2, 0.2)
        else:
            c = 152.5 + rng.uniform(-0.2, 0.2)
        rng_bars.append(c)
    closes = pre + rng_bars
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_too_wide(seed=12):
    """Range exists with 12% depth - exceeds 10% max."""
    rng = random.Random(seed)
    pre = [60 + 0.2 * i + rng.uniform(-0.2, 0.2) for i in range(20)]
    rng_bars = []
    for i in range(20):
        bucket = i % 4
        if bucket == 0:
            c = 70.0 + rng.uniform(-0.3, 0.3)
        elif bucket == 1:
            c = 75.0 + rng.uniform(-1.0, 1.0)
        elif bucket == 2:
            c = 80.0 + rng.uniform(-0.3, 0.3)
        else:
            c = 74.0 + rng.uniform(-1.5, 1.5)
        rng_bars.append(c)
    closes = pre + rng_bars
    return _bars_from_closes(closes, vol_pattern=None, seed=seed,
                             range_high=80.5, range_low=69.5)


def _build_only_1_touch_each(seed=13):
    """Only 1 high touch and 1 low touch with wide spacing - fails touch
    validation. Surrounded by tight clustering at midpoint so the broader
    range that would qualify on touches has too-wide depth."""
    rng = random.Random(seed)
    # Steep prior trend (so trailing bars can't be padded into a range)
    pre = [40 + 2.0 * i + rng.uniform(-0.3, 0.3) for i in range(35)]
    # 20 bars: ALL at narrow midpoint band, EXCEPT bar 5 (high spike) and
    # bar 15 (low spike). The narrow band itself is < depth tolerance
    # (so it CAN form a range) BUT the touches on the extremes are
    # singular - high_touches=1, low_touches=1.
    # The narrow midpoint band alone won't form a range > 10 bars because
    # the spikes break the depth check on any 10+ bar window containing them.
    rng_bars = []
    for i in range(20):
        if i == 5:
            c = 120.0  # only high spike
        elif i == 15:
            c = 100.0  # only low spike
        else:
            c = 110.5 + rng.uniform(-0.15, 0.15)
        rng_bars.append(c)
    closes = pre + rng_bars
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_broken_range(seed=14):
    """Range existed but just broke out - current bar is well outside."""
    rng = random.Random(seed)
    pre = [70 + 0.5 * i + rng.uniform(-0.3, 0.3) for i in range(20)]
    rng_bars = []
    for i in range(15):
        if i in (0, 4, 8, 12):
            c = 80.3
        elif i in (2, 6, 10, 14):
            c = 84.7
        else:
            c = 82.5 + rng.uniform(-1.0, 1.0)
        rng_bars.append(c)
    # Last 5 bars break out hard
    breakout = [86.0, 90.0, 95.0, 99.5, 103.0]
    closes = pre + rng_bars + breakout
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_declining_window(seed=15):
    """Window has steep declining slope; no bounded 10+ bar pocket."""
    rng = random.Random(seed)
    # Steep decline 80 -> 30 over 50 bars. Even the most recent 10 bars span
    # >10% depth so no range can form.
    closes = [80 - 1.0 * i + rng.uniform(-0.3, 0.3) for i in range(50)]
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_single_spike(seed=16):
    """Range bounds violated by a single tall bar."""
    rng = random.Random(seed)
    pre = [70 + 0.4 * i + rng.uniform(-0.3, 0.3) for i in range(30)]
    rng_bars = []
    for i in range(20):
        if i in (0, 4, 8, 12, 16):
            c = 82.5
        elif i in (2, 6, 14, 18):
            c = 85.5
        elif i == 10:
            c = 99.0  # spike that destroys the bound
        else:
            c = 84.0 + rng.uniform(-0.5, 0.5)
        rng_bars.append(c)
    closes = pre + rng_bars
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


def _build_insufficient_data(seed=17):
    """Only 8 bars - below minimum duration."""
    rng = random.Random(seed)
    closes = [50.0 + rng.uniform(-0.5, 0.5) for _ in range(8)]
    return _bars_from_closes(closes, vol_pattern=None, seed=seed)


# ===================================================================
# Edge fixtures
# ===================================================================

def _build_boundary_10_bars(seed=20):
    """EXACTLY 10 bars of range - minimum duration."""
    rng = random.Random(seed)
    pre = [70 + 0.5 * i + rng.uniform(-0.3, 0.3) for i in range(25)]
    rng_bars = []
    for i in range(10):
        if i in (0, 4, 8):
            c = 83.0
        elif i in (2, 6):
            c = 86.0
        else:
            c = 84.5 + rng.uniform(-0.5, 0.5)
        rng_bars.append(c)
    closes = pre + rng_bars
    return _bars_from_closes(closes, vol_pattern=None, seed=seed,
                             range_high=86.0, range_low=83.0)


def _build_boundary_10pct_depth(seed=21):
    """20 bars range with depth right at ~9.5% (just below 10%)."""
    rng = random.Random(seed)
    pre = [60 + 0.3 * i + rng.uniform(-0.3, 0.3) for i in range(25)]
    # Range from 100 to 109.5 = 9.06% of midpoint 104.75
    rng_bars = []
    for i in range(20):
        bucket = i % 4
        if bucket == 0:
            c = 100.3
        elif bucket == 1:
            c = 104.5 + rng.uniform(-1.0, 1.0)
        elif bucket == 2:
            c = 109.0
        else:
            c = 104.5 + rng.uniform(-1.0, 1.0)
        rng_bars.append(c)
    closes = pre + rng_bars
    return _bars_from_closes(closes, vol_pattern=None, seed=seed,
                             range_high=109.5, range_low=100.0)


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
    _write("clean_textbook_range", "positive",
           _build_clean_textbook_range(seed=1),
           _ctx(stage=1, rs="flat"),
           {
               "fires": True,
               "min_count": 1,
               "max_count": 1,
               "min_confidence": 50.0,
               "max_confidence": 90.0,
               "expected_duration_min": 15,
               "expected_depth_max_pct": 7.0,
           })

    _write("tight_range", "positive",
           _build_tight_range(seed=2),
           _ctx(stage=1, rs="flat"),
           {
               "fires": True,
               "min_count": 1,
               "max_count": 1,
               "min_confidence": 50.0,
               "max_confidence": 90.0,
               "expected_duration_min": 10,
               "expected_depth_max_pct": 5.0,
           })

    _write("wide_acceptable_range", "positive",
           _build_wide_acceptable_range(seed=3),
           _ctx(stage=2, rs="up"),
           {
               "fires": True,
               "min_count": 1,
               "max_count": 1,
               "min_confidence": 50.0,
               "max_confidence": 90.0,
               "expected_duration_min": 20,
               "expected_depth_max_pct": 10.0,
           })

    _write("recent_emerging_range", "positive",
           _build_recent_emerging_range(seed=4),
           _ctx(stage=2, rs="up"),
           {
               "fires": True,
               "min_count": 1,
               "max_count": 1,
               "min_confidence": 50.0,
               "max_confidence": 90.0,
               "expected_duration_min": 10,
               "expected_depth_max_pct": 8.0,
           })

    _write("perfect_touches", "positive",
           _build_perfect_touches(seed=5),
           _ctx(stage=1, rs="flat"),
           {
               "fires": True,
               "min_count": 1,
               "max_count": 1,
               "min_confidence": 50.0,
               "max_confidence": 90.0,
               "expected_duration_min": 15,
               "expected_depth_max_pct": 6.0,
           })

    # ====================== 8 NEGATIVE ======================
    _write("no_range_trending", "negative",
           _build_no_range_trending(seed=10),
           _ctx(stage=2, rs="up"),
           {"fires": False, "min_count": 0, "max_count": 0})

    _write("too_short", "negative",
           _build_too_short(seed=11),
           _ctx(stage=2, rs="up"),
           {"fires": False, "min_count": 0, "max_count": 0})

    _write("too_wide", "negative",
           _build_too_wide(seed=12),
           _ctx(stage=2, rs="flat"),
           {"fires": False, "min_count": 0, "max_count": 0})

    _write("only_1_touch_each", "negative",
           _build_only_1_touch_each(seed=13),
           _ctx(stage=2, rs="flat"),
           {"fires": False, "min_count": 0, "max_count": 0})

    _write("broken_range", "negative",
           _build_broken_range(seed=14),
           _ctx(stage=2, rs="up"),
           {"fires": False, "min_count": 0, "max_count": 0})

    _write("declining_window", "negative",
           _build_declining_window(seed=15),
           _ctx(stage=4, rs="down"),
           {"fires": False, "min_count": 0, "max_count": 0})

    _write("single_spike", "negative",
           _build_single_spike(seed=16),
           _ctx(stage=2, rs="flat"),
           {"fires": False, "min_count": 0, "max_count": 0})

    _write("insufficient_data", "negative",
           _build_insufficient_data(seed=17),
           _ctx(stage=1, rs="flat"),
           {"fires": False, "min_count": 0, "max_count": 0})

    # ====================== 2 EDGE ======================
    _write("boundary_10_bars", "edge",
           _build_boundary_10_bars(seed=20),
           _ctx(stage=2, rs="flat"),
           {
               "fires": True,
               "min_count": 1,
               "max_count": 1,
               "min_confidence": 50.0,
               "max_confidence": 90.0,
               "expected_duration_min": 10,
               "expected_depth_max_pct": 5.0,
           })

    _write("boundary_10pct_depth", "edge",
           _build_boundary_10pct_depth(seed=21),
           _ctx(stage=2, rs="flat"),
           {
               "fires": True,
               "min_count": 1,
               "max_count": 1,
               "min_confidence": 50.0,
               "max_confidence": 90.0,
               "expected_duration_min": 15,
               "expected_depth_max_pct": 10.0,
           })

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
