"""One-shot generator for avwap_reclaim fixtures.

The detector requires:
  - >= 80 bars total
  - Anchor (swing_low / gap_up / 52w_high) within last 5-60 bars
  - At least 5 prior bars closed BELOW AVWAP (anchored at the anchor)
  - Current bar closes ABOVE AVWAP
  - Volume on current bar >= 1.5x 20-bar avg
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _bar(t, mid, vol, rng, noise=0.30, force_close=None, force_open=None,
         force_high=None, force_low=None):
    o = mid + rng.uniform(-noise, noise) if force_open is None else force_open
    c = mid + rng.uniform(-noise, noise) if force_close is None else force_close
    h = max(o, c) + abs(rng.uniform(0, noise * 1.2))
    l = min(o, c) - abs(rng.uniform(0, noise * 1.2))
    if force_high is not None:
        h = max(h, force_high)
    if force_low is not None:
        l = min(l, force_low)
    return {"t": t, "o": round(o, 2), "h": round(h, 2),
            "l": round(l, 2), "c": round(c, 2),
            "v": round(vol * rng.uniform(0.85, 1.15), 0)}


def _build_swing_low_then_reclaim(seed=1, lead_bars=65, swing_low_drop=0.10,
                                    underwater_bars=10, reclaim_vol_ratio=2.0):
    """Lead-in → swing low → recovery below AVWAP → reclaim above AVWAP.

    Structure:
      - First 40 bars: bullish lead-in
      - Sharp drop to swing low (5 bars)
      - Recovery above swing low but BELOW the AVWAP from swing low
        (underwater_bars bars)
      - Final bar: reclaim AVWAP on heavy volume
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 100.0
    # Lead-in
    for _ in range(lead_bars):
        price += 0.2 + rng.uniform(-0.3, 0.3)
        bars.append(_bar(t, price, 2000, rng, noise=0.5))
        t += DT
    # Sharp drop to swing low
    drop_bars = 5
    drop_end = price * (1.0 - swing_low_drop)
    drop_per_bar = (drop_end - price) / drop_bars
    for _ in range(drop_bars):
        price += drop_per_bar + rng.uniform(-0.15, 0.15)
        bars.append(_bar(t, price, 2200, rng, noise=0.4))
        t += DT
    # Bounce slightly so swing-low pivot is identifiable
    price += 0.3
    bars.append(_bar(t, price, 2000, rng, noise=0.3))
    t += DT
    price += 0.2
    bars.append(_bar(t, price, 1900, rng, noise=0.3))
    t += DT
    # Underwater drift: closes BELOW the AVWAP because AVWAP is pulled high
    # by the pre-drop lead-in but price is still well below pre-drop levels.
    # The drift must trend gently DOWN to stay under the slowly-declining AVWAP.
    underwater_high = price
    for i in range(underwater_bars):
        # Stronger downward drift to keep CLOSE clearly below the AVWAP.
        # AVWAP from swing-low is weighted heavily by lead-in/pre-drop bars,
        # so we need price meaningfully below the swing-low region.
        price -= 0.30 + rng.uniform(-0.15, 0.10)
        bars.append(_bar(t, price, 1800, rng, noise=0.25))
        t += DT
    # Final bar: reclaim — jump back up well above underwater_high
    reclaim_price = underwater_high + 4.0
    bars.append(_bar(t, reclaim_price, 2000 * reclaim_vol_ratio, rng,
                      noise=0.4, force_close=reclaim_price,
                      force_high=reclaim_price + 0.3))
    return bars


def _build_uptrend_no_reclaim(seed=10):
    """Continuous uptrend — price always above any reasonable AVWAP."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 100.0
    for _ in range(90):
        price += 0.4 + rng.uniform(-0.15, 0.15)
        bars.append(_bar(t, price, 2000, rng, noise=0.3))
        t += DT
    return bars


def _build_downtrend_no_reclaim(seed=20):
    """Continuous downtrend — final bar still below AVWAP."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 150.0
    for _ in range(90):
        price -= 0.4 + rng.uniform(-0.15, 0.15)
        bars.append(_bar(t, price, 2000, rng, noise=0.3))
        t += DT
    return bars


def _build_chop_no_reclaim(seed=30):
    """Sideways chop — no meaningful AVWAP reclaim."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 100.0
    for _ in range(90):
        price += rng.uniform(-0.3, 0.3)
        bars.append(_bar(t, price, 2000, rng, noise=0.4))
        t += DT
    return bars


def _build_reclaim_low_volume(seed=40):
    """Reclaim happens but volume insufficient."""
    return _build_swing_low_then_reclaim(seed=seed, reclaim_vol_ratio=0.8)


def _build_short_underwater(seed=50):
    """Only 2 bars below AVWAP — under the 5-bar minimum."""
    return _build_swing_low_then_reclaim(seed=seed, underwater_bars=2)


BULL = {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
        "volume_signature": "expanding", "regime": "bull",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 3,
        "recent_dcr_avg": 0.65, "dcr_signature": "accumulation",
        "can_slim_grade": "B", "can_slim_score": 72}

BASING = {"trend_stage": 1, "rs_trend": "flat", "ma_alignment": "mixed",
          "volume_signature": "contracting", "regime": "transition",
          "nearest_resistance": None, "nearest_support": None,
          "days_to_earnings": None, "sector_strength_rank": 5,
          "recent_dcr_avg": 0.55, "dcr_signature": "accumulation",
          "can_slim_grade": "C", "can_slim_score": 55}

BEAR = {"trend_stage": 4, "rs_trend": "down", "ma_alignment": "stacked_bearish",
        "volume_signature": "expanding", "regime": "bear",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 10,
        "recent_dcr_avg": 0.30, "dcr_signature": "distribution",
        "can_slim_grade": "D", "can_slim_score": 35}

NEUTRAL = {"trend_stage": 1, "rs_trend": "flat", "ma_alignment": "mixed",
           "volume_signature": "neutral", "regime": "transition",
           "nearest_resistance": None, "nearest_support": None,
           "days_to_earnings": None, "sector_strength_rank": None,
           "recent_dcr_avg": 0.5, "dcr_signature": "neutral",
           "can_slim_grade": "C", "can_slim_score": 50}


def _write(name, category, bars, context, expected):
    payload = {"name": name, "category": category, "expected": expected,
               "context": context, "bars": bars}
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


def main():
    # ===== 5 POSITIVE =====
    _write("clean_swing_low_reclaim", "positive",
           _build_swing_low_then_reclaim(seed=1),
           BULL, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
                  "geometry_shape": "horizontal_line"})
    _write("deep_underwater_reclaim", "positive",
           _build_swing_low_then_reclaim(seed=2, underwater_bars=18),
           BASING, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("high_vol_reclaim", "positive",
           _build_swing_low_then_reclaim(seed=3, reclaim_vol_ratio=3.5),
           BULL, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("bigger_swing_low_reclaim", "positive",
           _build_swing_low_then_reclaim(seed=4, swing_low_drop=0.15,
                                          underwater_bars=15),
           BULL, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("moderate_reclaim", "positive",
           _build_swing_low_then_reclaim(seed=5, underwater_bars=8,
                                          reclaim_vol_ratio=1.8),
           BASING, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})

    # ===== 8 NEGATIVE =====
    _write("uptrend_no_reclaim", "negative",
           _build_uptrend_no_reclaim(seed=10),
           BULL, {"fires": False})
    _write("downtrend_no_reclaim", "negative",
           _build_downtrend_no_reclaim(seed=20),
           BEAR, {"fires": False})
    _write("chop_no_reclaim", "negative",
           _build_chop_no_reclaim(seed=30),
           NEUTRAL, {"fires": False})
    _write("reclaim_low_volume", "negative",
           _build_reclaim_low_volume(seed=40),
           BULL, {"fires": False})
    _write("short_underwater", "negative",
           _build_short_underwater(seed=50),
           BULL, {"fires": False})
    _write("downtrend_2", "negative",
           _build_downtrend_no_reclaim(seed=21),
           BEAR, {"fires": False})
    _write("chop_2", "negative",
           _build_chop_no_reclaim(seed=31),
           NEUTRAL, {"fires": False})
    _write("too_short", "negative",
           _build_uptrend_no_reclaim(seed=11)[:70],
           NEUTRAL, {"fires": False})

    # ===== 2 EDGE =====
    _write("borderline_volume_reclaim", "edge",
           _build_swing_low_then_reclaim(seed=21, reclaim_vol_ratio=1.55),
           BASING, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})
    _write("borderline_underwater_bars", "edge",
           _build_swing_low_then_reclaim(seed=22, underwater_bars=7,
                                          lead_bars=70),
           BASING, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
