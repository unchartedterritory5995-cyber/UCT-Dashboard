"""One-shot generator for pullback_to_50sma (O'Neil 2nd Buy Point) fixtures."""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _bar(t, mid, vol, rng, noise=0.20,
         force_high=None, force_low=None, force_close=None, force_open=None):
    o = mid + rng.uniform(-noise, noise) if force_open is None else force_open
    c = mid + rng.uniform(-noise, noise) if force_close is None else force_close
    h = max(o, c) + abs(rng.uniform(0, noise * 1.2))
    l = min(o, c) - abs(rng.uniform(0, noise * 1.2))
    if force_high is not None: h = max(h, force_high)
    if force_low is not None: l = min(l, force_low)
    return {"t": t, "o": round(o, 2), "h": round(h, 2),
            "l": round(l, 2), "c": round(c, 2),
            "v": round(vol * rng.uniform(0.85, 1.15), 0)}


def _build_pullback_50sma(
    trend_bars=220,
    trend_pct=1.20,
    test_vol_ratio=0.7,
    reclaim_vol_ratio=1.5,
    seed=1,
):
    """Build trend + test of 50-SMA + reclaim with expanding volume.

    The 50-SMA needs at least 70 bars of history before the test bar to
    have meaningful slope (50 SMA period + 20 bars back for slope).
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 30.0
    rate = (1.0 + trend_pct) ** (1.0 / trend_bars)
    for i in range(trend_bars):
        price *= rate
        bars.append(_bar(t, price, 1500, rng, noise=0.20))
        t += DT

    closes = [b["c"] for b in bars]
    sma50 = sum(closes[-50:]) / 50

    # Test bar: low touches sma50, close BELOW SMA so reclaim happens later
    target_low = sma50 * 0.995  # slightly below SMA, within 2% tolerance
    target_open = sma50 * 1.010
    target_close = sma50 * 0.998  # close BELOW SMA (sets up reclaim next bar)
    test_vol = 1500 * test_vol_ratio
    test_bar = _bar(t, sma50 * 1.005, test_vol, rng, noise=0.15,
                     force_low=target_low,
                     force_open=target_open,
                     force_close=target_close)
    bars.append(test_bar)
    t += DT

    # Reclaim bar — close ABOVE SMA on expanding volume.
    # Low must be ABOVE the SMA tolerance so detector picks test bar, not this bar.
    reclaim_close = sma50 * 1.040
    reclaim_vol = 1500 * reclaim_vol_ratio
    reclaim_low = sma50 * 1.025  # well above SMA tolerance (1.02x)
    reclaim_bar = _bar(t, sma50 * 1.030, reclaim_vol, rng, noise=0.10,
                       force_close=reclaim_close,
                       force_low=reclaim_low,
                       force_open=sma50 * 1.028)
    bars.append(reclaim_bar)
    return bars


def _build_chop(n=180, seed=10):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    for i in range(n):
        price += rng.uniform(-0.3, 0.3)
        bars.append(_bar(t, price, 1500, rng, noise=0.30))
        t += DT
    return bars


def _build_downtrend(n=180, seed=11):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 100.0
    rate = 0.40 ** (1.0 / n)
    for i in range(n):
        price *= rate
        bars.append(_bar(t, price, 1500, rng, noise=0.30))
        t += DT
    return bars


# Stage 2 + stacked_bullish hard gates required
GOOD = {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
        "volume_signature": "expanding", "regime": "bull",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 3,
        "recent_dcr_avg": 0.65, "dcr_signature": "accumulation",
        "can_slim_grade": "B", "can_slim_score": 72}

GREAT = {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
         "volume_signature": "expanding", "regime": "bull",
         "nearest_resistance": None, "nearest_support": None,
         "days_to_earnings": None, "sector_strength_rank": 1,
         "recent_dcr_avg": 0.72, "dcr_signature": "accumulation",
         "can_slim_grade": "A", "can_slim_score": 88}

NEUTRAL = {"trend_stage": 1, "rs_trend": "flat", "ma_alignment": "mixed",
           "volume_signature": "neutral", "regime": "transition",
           "nearest_resistance": None, "nearest_support": None,
           "days_to_earnings": None, "sector_strength_rank": None,
           "recent_dcr_avg": 0.5, "dcr_signature": "neutral",
           "can_slim_grade": "C", "can_slim_score": 50}

BEARISH = {"trend_stage": 4, "rs_trend": "down", "ma_alignment": "stacked_bearish",
           "volume_signature": "expanding", "regime": "bear",
           "nearest_resistance": None, "nearest_support": None,
           "days_to_earnings": None, "sector_strength_rank": 10,
           "recent_dcr_avg": 0.3, "dcr_signature": "distribution",
           "can_slim_grade": "D", "can_slim_score": 35}


def _write(name, category, bars, context, expected):
    payload = {"name": name, "category": category, "expected": expected,
               "context": context, "bars": bars}
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


def main():
    # ===== 5 POSITIVE =====
    _write("clean_textbook", "positive", _build_pullback_50sma(seed=1),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
                  "geometry_shape": "horizontal_line"})
    _write("strong_advance", "positive",
           _build_pullback_50sma(seed=2, trend_pct=0.80),
           GREAT, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("low_test_vol", "positive",
           _build_pullback_50sma(seed=3, test_vol_ratio=0.5),
           GOOD, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("expanding_reclaim", "positive",
           _build_pullback_50sma(seed=4, reclaim_vol_ratio=2.2),
           GREAT, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("with_can_slim_a", "positive",
           _build_pullback_50sma(seed=5),
           GREAT, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    # ===== 8 NEGATIVE =====
    _write("chop_no_trend", "negative", _build_chop(n=220, seed=10),
           NEUTRAL, {"fires": False})
    _write("downtrend_hostile", "negative", _build_downtrend(n=220, seed=11),
           BEARISH, {"fires": False})
    _write("wrong_stage", "negative", _build_pullback_50sma(seed=12),
           NEUTRAL, {"fires": False})
    _write("wrong_alignment", "negative", _build_pullback_50sma(seed=13),
           {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "mixed",
            "volume_signature": "expanding", "regime": "bull",
            "nearest_resistance": None, "nearest_support": None,
            "days_to_earnings": None, "sector_strength_rank": 3,
            "recent_dcr_avg": 0.65, "dcr_signature": "accumulation",
            "can_slim_grade": "B", "can_slim_score": 72},
           {"fires": False})
    _write("test_vol_too_high", "negative",
           _build_pullback_50sma(seed=14, test_vol_ratio=2.0),  # > 1.3 threshold
           GOOD, {"fires": False})
    _write("reclaim_vol_too_low", "negative",
           _build_pullback_50sma(seed=15, reclaim_vol_ratio=0.5),  # < 0.9 threshold
           GOOD, {"fires": False})
    _write("shallow_advance", "negative",
           _build_pullback_50sma(seed=16, trend_pct=0.10),  # < 30% prior advance
           GOOD, {"fires": False})
    _write("too_short", "negative", _build_chop(n=80, seed=17),
           NEUTRAL, {"fires": False})

    # ===== 2 EDGE =====
    _write("borderline_test_vol", "edge",
           _build_pullback_50sma(seed=21, test_vol_ratio=1.1),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})
    _write("borderline_reclaim_vol", "edge",
           _build_pullback_50sma(seed=22, reclaim_vol_ratio=0.95),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
