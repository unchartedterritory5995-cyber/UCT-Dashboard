"""One-shot generator for bollinger_squeeze fixtures."""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _bar(t, mid, vol, rng, noise=0.20, range_noise=None):
    """Construct a bar.

    noise controls open/close variation around mid (drives close-to-close stddev).
    range_noise controls high/low extension beyond open/close (drives ATR).
    If range_noise is None, defaults to noise * 1.2 (legacy behavior).
    """
    if range_noise is None:
        range_noise = noise * 1.2
    o = mid + rng.uniform(-noise, noise)
    c = mid + rng.uniform(-noise, noise)
    h = max(o, c) + abs(rng.uniform(0, range_noise))
    l = min(o, c) - abs(rng.uniform(0, range_noise))
    return {"t": t, "o": round(o, 2), "h": round(h, 2),
            "l": round(l, 2), "c": round(c, 2),
            "v": round(vol * rng.uniform(0.85, 1.15), 0)}


def _build_squeeze(
    lead_bars=40,
    squeeze_bars=10,
    lead_vol=1500,
    squeeze_vol=600,
    lead_noise=1.2,
    squeeze_close_noise=0.08,
    squeeze_range_noise=0.70,
    seed=1,
):
    """Build a chart with high-volatility leadup, then a tight, low-volume squeeze.

    BB compresses (close-to-close stddev collapses) but KC stays wider (ATR is
    still robust because bar HIGHS/LOWS extend beyond the tight closes).
    This is the realistic intra-bar signature of pre-breakout consolidations:
    tight closes but volatile intrabar action.
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    # Lead-in: wide swings to build a wide BB baseline. After lead-in BB will be
    # wide. Close mean-drift is moderate; range noise tracks close noise (legacy).
    for i in range(lead_bars):
        price += rng.uniform(-0.5, 0.5)
        bars.append(_bar(t, price, lead_vol, rng, noise=lead_noise))
        t += DT
    # Squeeze: tight CLOSES, but wide intra-bar RANGES — preserves ATR so
    # KC stays wide while BB collapses inside KC.
    squeeze_price = price
    for i in range(squeeze_bars):
        squeeze_price += rng.uniform(-0.04, 0.04)
        bars.append(_bar(t, squeeze_price, squeeze_vol, rng,
                         noise=squeeze_close_noise,
                         range_noise=squeeze_range_noise))
        t += DT
    return bars


def _build_no_squeeze(n=60, seed=10):
    """Wide-range chart — BB does NOT compress inside KC."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    for i in range(n):
        price += rng.uniform(-1.0, 1.0)
        bars.append(_bar(t, price, 1500, rng, noise=1.5))
        t += DT
    return bars


def _build_short_squeeze(seed=20):
    """Squeeze but only 4 bars — below the 6-bar minimum.

    Strongly TRENDING lead-in so closes never cluster (BB stays wide because
    the moving SMA shifts each bar). After 40 bars of trend, drop 4 tight
    squeeze bars; the BB hasn't had time to compress inside KC.
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 30.0
    # Strong trending lead-in: closes spread over 30+ points across 40 bars
    for i in range(40):
        price += 0.8 + rng.uniform(-0.2, 0.2)
        bars.append(_bar(t, price, 1500, rng, noise=0.4))
        t += DT
    # 4 tight squeeze bars (insufficient duration)
    squeeze_price = price
    for i in range(4):
        squeeze_price += rng.uniform(-0.03, 0.03)
        bars.append(_bar(t, squeeze_price, 600, rng, noise=0.08, range_noise=0.6))
        t += DT
    return bars


def _build_squeeze_high_vol(seed=30):
    """Squeeze geometry but volume NOT contracting (above 70% threshold)."""
    return _build_squeeze(lead_bars=40, squeeze_bars=10, lead_vol=1500,
                          squeeze_vol=1350, seed=seed)


# Context presets — direction-neutral
TRENDING_BULL = {
    "trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
    "volume_signature": "contracting", "regime": "bull",
    "nearest_resistance": None, "nearest_support": None,
    "days_to_earnings": None, "sector_strength_rank": 3,
    "recent_dcr_avg": 0.6, "dcr_signature": "accumulation",
    "can_slim_grade": "B", "can_slim_score": 70}

TRENDING_BEAR = {
    "trend_stage": 4, "rs_trend": "down", "ma_alignment": "stacked_bearish",
    "volume_signature": "contracting", "regime": "bear",
    "nearest_resistance": None, "nearest_support": None,
    "days_to_earnings": None, "sector_strength_rank": 10,
    "recent_dcr_avg": 0.4, "dcr_signature": "distribution",
    "can_slim_grade": "D", "can_slim_score": 35}

CHOPPY = {"trend_stage": 1, "rs_trend": "flat", "ma_alignment": "mixed",
          "volume_signature": "contracting", "regime": "choppy",
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
    _write("clean_squeeze", "positive", _build_squeeze(seed=1),
           TRENDING_BULL, {"fires": True, "min_confidence": 50.0,
                           "max_confidence": 100.0,
                           "geometry_shape": "rectangle"})
    _write("long_squeeze", "positive",
           _build_squeeze(seed=2, squeeze_bars=12, squeeze_vol=500),
           TRENDING_BULL, {"fires": True, "min_confidence": 55.0,
                           "max_confidence": 100.0})
    _write("deep_compression", "positive",
           _build_squeeze(seed=3, squeeze_bars=12, squeeze_close_noise=0.04),
           TRENDING_BEAR, {"fires": True, "min_confidence": 55.0,
                           "max_confidence": 100.0})
    _write("low_volume_squeeze", "positive",
           _build_squeeze(seed=4, squeeze_vol=350),
           TRENDING_BULL, {"fires": True, "min_confidence": 55.0,
                           "max_confidence": 100.0})
    _write("with_trend_bias", "positive", _build_squeeze(seed=5),
           TRENDING_BEAR, {"fires": True, "min_confidence": 50.0,
                           "max_confidence": 100.0})

    # ===== 8 NEGATIVE =====
    _write("no_squeeze_wide_range", "negative", _build_no_squeeze(seed=10),
           CHOPPY, {"fires": False})
    _write("short_squeeze_4_bars", "negative", _build_short_squeeze(seed=20),
           CHOPPY, {"fires": False})
    _write("squeeze_high_vol", "negative", _build_squeeze_high_vol(seed=30),
           CHOPPY, {"fires": False})
    _write("trending_no_compression", "negative",
           _build_no_squeeze(n=60, seed=31), TRENDING_BULL,
           {"fires": False})
    _write("declining_chop", "negative",
           _build_no_squeeze(n=80, seed=32), TRENDING_BEAR,
           {"fires": False})
    _write("noisy_consolidation", "negative",
           _build_no_squeeze(n=70, seed=33), CHOPPY, {"fires": False})
    _write("too_short_bars", "negative",
           _build_no_squeeze(n=25, seed=34), CHOPPY, {"fires": False})
    _write("squeeze_but_no_vol_drop", "negative",
           _build_squeeze(seed=35, squeeze_vol=1500), CHOPPY,
           {"fires": False})

    # ===== 2 EDGE =====
    _write("borderline_squeeze_bars", "edge", _build_squeeze(seed=21, squeeze_bars=6),
           CHOPPY, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})
    _write("borderline_vol_ratio", "edge",
           _build_squeeze(seed=22, squeeze_vol=800),  # ratio just under 0.70
           CHOPPY, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
