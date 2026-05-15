"""One-shot generator for macd_bullish_cross fixtures."""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _bar(t, mid, vol, rng, noise=0.30):
    o = mid + rng.uniform(-noise, noise)
    c = mid + rng.uniform(-noise, noise)
    h = max(o, c) + abs(rng.uniform(0, noise * 1.2))
    l = min(o, c) - abs(rng.uniform(0, noise * 1.2))
    return {"t": t, "o": round(o, 2), "h": round(h, 2),
            "l": round(l, 2), "c": round(c, 2),
            "v": round(vol * rng.uniform(0.85, 1.15), 0)}


def _build_v_pattern_with_recovery(seed=1, decline_bars=40, flat_bars=0,
                                    spike_bars=3, decline_pct=0.20,
                                    spike_pct=0.10, breakout_vol_ratio=1.5):
    """Build chart: lead-in → decline → flat bottom → SPIKE up.

    The flat-then-spike structure produces a MACD cross at the last 1-3 bars
    because during the flat period MACD slowly catches up to signal, and the
    spike forces a fresh cross at the end.
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 100.0
    # Lead-in
    for _ in range(20):
        price += rng.uniform(-0.3, 0.3)
        bars.append(_bar(t, price, 1500, rng, noise=0.4))
        t += DT
    # Decline
    end_price = price * (1.0 - decline_pct)
    drop_per_bar = (end_price - price) / decline_bars
    for _ in range(decline_bars):
        price += drop_per_bar + rng.uniform(-0.15, 0.15)
        bars.append(_bar(t, price, 1500, rng, noise=0.3))
        t += DT
    # Flat bottom
    for _ in range(flat_bars):
        price += rng.uniform(-0.15, 0.15)
        bars.append(_bar(t, price, 1200, rng, noise=0.25))
        t += DT
    # Spike up (final 3 bars produce the fresh cross)
    spike_end = price * (1.0 + spike_pct)
    up_per_bar = (spike_end - price) / spike_bars
    for i in range(spike_bars):
        price += up_per_bar + rng.uniform(-0.1, 0.1)
        v = 1500 * breakout_vol_ratio if i == spike_bars - 1 else 1500
        bars.append(_bar(t, price, v, rng, noise=0.3))
        t += DT
    return bars


def _build_smooth_uptrend(seed=10, bars_n=80):
    """Continuous uptrend — no cross."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    for _ in range(bars_n):
        price += 0.4 + rng.uniform(-0.15, 0.15)
        bars.append(_bar(t, price, 1500, rng, noise=0.3))
        t += DT
    return bars


def _build_smooth_downtrend(seed=20, bars_n=80):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 100.0
    for _ in range(bars_n):
        price -= 0.4 + rng.uniform(-0.15, 0.15)
        bars.append(_bar(t, price, 1500, rng, noise=0.3))
        t += DT
    return bars


def _build_chop(seed=30, bars_n=80):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    for _ in range(bars_n):
        price += rng.uniform(-0.5, 0.5)
        bars.append(_bar(t, price, 1500, rng, noise=0.4))
        t += DT
    return bars


def _build_stale_cross(seed=40):
    """Cross happened 10 bars ago — beyond the 3-bar freshness window."""
    bars = _build_v_pattern_with_recovery(seed=seed)
    # Add 7 more bars after the cross (continuing trend)
    rng = random.Random(seed + 1)
    t = bars[-1]["t"] + 86400
    price = bars[-1]["c"]
    for _ in range(8):
        price += 0.3 + rng.uniform(-0.15, 0.15)
        bars.append(_bar(t, price, 1500, rng, noise=0.3))
        t += 86400
    return bars


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
        "recent_dcr_avg": 0.35, "dcr_signature": "distribution",
        "can_slim_grade": "D", "can_slim_score": 30}

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
    _write("v_recovery_bull_cross", "positive",
           _build_v_pattern_with_recovery(seed=1),
           BULL, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
                  "geometry_shape": "candle_mark"})
    _write("deep_oversold_cross", "positive",
           _build_v_pattern_with_recovery(seed=2, decline_pct=0.30, spike_pct=0.12),
           BASING, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("clean_bull_cross_high_vol", "positive",
           _build_v_pattern_with_recovery(seed=3, breakout_vol_ratio=2.5),
           BULL, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("stage1_basing_cross", "positive",
           _build_v_pattern_with_recovery(seed=4, decline_pct=0.15, spike_pct=0.08),
           BASING, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("strong_recovery_cross", "positive",
           _build_v_pattern_with_recovery(seed=5, decline_pct=0.25, spike_pct=0.13,
                                          breakout_vol_ratio=2.0),
           BULL, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    # ===== 8 NEGATIVE =====
    _write("smooth_uptrend_no_cross", "negative",
           _build_smooth_uptrend(seed=10),
           BULL, {"fires": False})
    _write("smooth_downtrend_no_cross", "negative",
           _build_smooth_downtrend(seed=11),
           BEAR, {"fires": False})
    _write("chop_no_clean_cross", "negative",
           _build_chop(seed=12),
           NEUTRAL, {"fires": False})
    _write("stale_cross_10_bars_old", "negative",
           _build_stale_cross(seed=13),
           BULL, {"fires": False})
    _write("uptrend_continuation", "negative",
           _build_smooth_uptrend(seed=14, bars_n=90),
           BULL, {"fires": False})
    _write("downtrend_continuation", "negative",
           _build_smooth_downtrend(seed=15, bars_n=90),
           BEAR, {"fires": False})
    _write("too_short", "negative",
           _build_chop(seed=16, bars_n=40),
           NEUTRAL, {"fires": False})
    _write("flat_chop", "negative",
           _build_chop(seed=17, bars_n=85),
           NEUTRAL, {"fires": False})

    # ===== 2 EDGE =====
    _write("borderline_cross_recent", "edge",
           _build_v_pattern_with_recovery(seed=21, decline_pct=0.12, spike_pct=0.06),
           BASING, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})
    _write("weak_volume_cross", "edge",
           _build_v_pattern_with_recovery(seed=22, breakout_vol_ratio=1.05),
           BASING, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
