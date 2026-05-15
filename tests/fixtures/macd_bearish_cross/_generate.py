"""One-shot generator for macd_bearish_cross fixtures."""
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


def _build_top_with_drop(seed=1, rally_bars=40, drop_bars=3,
                         rally_pct=0.20, drop_pct=0.10,
                         breakout_vol_ratio=1.5):
    """Build chart: lead-in → rally → sharp DROP at end. Produces MACD bear cross fresh."""
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
    # Rally
    end_price = price * (1.0 + rally_pct)
    up_per_bar = (end_price - price) / rally_bars
    for _ in range(rally_bars):
        price += up_per_bar + rng.uniform(-0.15, 0.15)
        bars.append(_bar(t, price, 1500, rng, noise=0.3))
        t += DT
    # Sharp drop (final 3 bars produce the fresh cross)
    drop_end = price * (1.0 - drop_pct)
    down_per_bar = (drop_end - price) / drop_bars
    for i in range(drop_bars):
        price += down_per_bar + rng.uniform(-0.1, 0.1)
        v = 1500 * breakout_vol_ratio if i == drop_bars - 1 else 1500
        bars.append(_bar(t, price, v, rng, noise=0.3))
        t += DT
    return bars


def _build_smooth_uptrend(seed=10, bars_n=80):
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


def _build_stale_bear_cross(seed=40):
    bars = _build_top_with_drop(seed=seed)
    rng = random.Random(seed + 1)
    t = bars[-1]["t"] + 86400
    price = bars[-1]["c"]
    for _ in range(8):
        price -= 0.3 + rng.uniform(-0.15, 0.15)
        bars.append(_bar(t, price, 1500, rng, noise=0.3))
        t += 86400
    return bars


BEAR = {"trend_stage": 4, "rs_trend": "down", "ma_alignment": "stacked_bearish",
        "volume_signature": "expanding", "regime": "bear",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 10,
        "recent_dcr_avg": 0.35, "dcr_signature": "distribution",
        "can_slim_grade": "D", "can_slim_score": 30}

TOPPING = {"trend_stage": 3, "rs_trend": "down", "ma_alignment": "mixed",
           "volume_signature": "expanding", "regime": "transition",
           "nearest_resistance": None, "nearest_support": None,
           "days_to_earnings": None, "sector_strength_rank": 8,
           "recent_dcr_avg": 0.40, "dcr_signature": "distribution",
           "can_slim_grade": "C", "can_slim_score": 50}

BULL = {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
        "volume_signature": "expanding", "regime": "bull",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 3,
        "recent_dcr_avg": 0.65, "dcr_signature": "accumulation",
        "can_slim_grade": "B", "can_slim_score": 72}

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
    _write("top_with_drop_bear_cross", "positive",
           _build_top_with_drop(seed=1),
           BEAR, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
                  "geometry_shape": "candle_mark"})
    _write("deep_overbought_cross", "positive",
           _build_top_with_drop(seed=2, rally_pct=0.30, drop_pct=0.12),
           TOPPING, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("clean_bear_cross_high_vol", "positive",
           _build_top_with_drop(seed=3, breakout_vol_ratio=2.5),
           BEAR, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("stage3_topping_cross", "positive",
           _build_top_with_drop(seed=4, rally_pct=0.15, drop_pct=0.08),
           TOPPING, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("strong_drop_cross", "positive",
           _build_top_with_drop(seed=5, rally_pct=0.25, drop_pct=0.13,
                                 breakout_vol_ratio=2.0),
           BEAR, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

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
    _write("stale_cross_8_bars_old", "negative",
           _build_stale_bear_cross(seed=13),
           BEAR, {"fires": False})
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
           _build_chop(seed=50, bars_n=85),
           NEUTRAL, {"fires": False})

    # ===== 2 EDGE =====
    _write("borderline_cross_recent", "edge",
           _build_top_with_drop(seed=21, rally_pct=0.12, drop_pct=0.06),
           TOPPING, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})
    _write("weak_volume_cross", "edge",
           _build_top_with_drop(seed=22, breakout_vol_ratio=1.05),
           TOPPING, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
