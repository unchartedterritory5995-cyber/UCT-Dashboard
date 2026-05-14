"""One-shot generator for pullback_to_21ema (Minervini SEPA) fixtures."""
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


def _build_pullback_21ema(
    trend_bars=100,
    trend_pct=0.50,
    pullback_vol_ratio=0.55,
    seed=1,
):
    """Build trend + pullback bar that touches 21-EMA with body + reclaim."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    rate = (1.0 + trend_pct) ** (1.0 / trend_bars)
    for i in range(trend_bars):
        price *= rate
        bars.append(_bar(t, price, 1500, rng, noise=0.20))
        t += DT

    closes = [b["c"] for b in bars]
    k = 2.0 / 22.0
    ema = sum(closes[:21]) / 21
    for c in closes[21:]:
        ema = c * k + ema * (1 - k)

    # Pullback bar — body must touch/dip below 21-EMA but close back above
    target_low = ema * 0.998  # slightly below EMA
    target_open = ema * 1.005
    target_close = ema * 1.015  # close above EMA
    pullback_vol = 1500 * pullback_vol_ratio
    pullback_bar = _bar(t, ema, pullback_vol, rng, noise=0.10,
                         force_low=target_low,
                         force_open=target_open,
                         force_close=target_close)
    bars.append(pullback_bar)
    return bars


def _build_chop(n=80, seed=10):
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


def _build_downtrend(n=100, seed=11):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 100.0
    rate = 0.50 ** (1.0 / n)
    for i in range(n):
        price *= rate
        bars.append(_bar(t, price, 1500, rng, noise=0.30))
        t += DT
    return bars


# Hard gates: Stage 2 + stacked_bullish + RS up REQUIRED
GOOD = {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
        "volume_signature": "contracting", "regime": "bull",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 3,
        "recent_dcr_avg": 0.65, "dcr_signature": "accumulation",
        "can_slim_grade": "B", "can_slim_score": 72}

GREAT = {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
         "volume_signature": "contracting", "regime": "bull",
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
    _write("clean_textbook", "positive", _build_pullback_21ema(seed=1),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
                  "geometry_shape": "horizontal_line"})
    _write("sepa_grade_a", "positive",
           _build_pullback_21ema(seed=2, pullback_vol_ratio=0.45),
           GREAT, {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})
    _write("strong_trend", "positive",
           _build_pullback_21ema(seed=3, trend_pct=0.80),
           GREAT, {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})
    _write("tight_lvc", "positive",
           _build_pullback_21ema(seed=4, pullback_vol_ratio=0.40),
           GOOD, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("with_can_slim_a", "positive",
           _build_pullback_21ema(seed=5),
           GREAT, {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    # ===== 8 NEGATIVE =====
    _write("chop_no_trend", "negative", _build_chop(n=100, seed=10),
           NEUTRAL, {"fires": False})
    _write("downtrend_hostile", "negative", _build_downtrend(n=100, seed=11),
           BEARISH, {"fires": False})
    _write("wrong_stage", "negative", _build_pullback_21ema(seed=12),
           NEUTRAL, {"fires": False})
    _write("wrong_alignment", "negative", _build_pullback_21ema(seed=13),
           {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "mixed",
            "volume_signature": "contracting", "regime": "bull",
            "nearest_resistance": None, "nearest_support": None,
            "days_to_earnings": None, "sector_strength_rank": 3,
            "recent_dcr_avg": 0.65, "dcr_signature": "accumulation",
            "can_slim_grade": "B", "can_slim_score": 72},
           {"fires": False})
    _write("wrong_rs", "negative", _build_pullback_21ema(seed=14),
           {"trend_stage": 2, "rs_trend": "down", "ma_alignment": "stacked_bullish",
            "volume_signature": "contracting", "regime": "bull",
            "nearest_resistance": None, "nearest_support": None,
            "days_to_earnings": None, "sector_strength_rank": 3,
            "recent_dcr_avg": 0.65, "dcr_signature": "accumulation",
            "can_slim_grade": "B", "can_slim_score": 72},
           {"fires": False})
    _write("vol_not_contracting", "negative",
           _build_pullback_21ema(seed=15, pullback_vol_ratio=1.5),  # >= 1.1
           GOOD, {"fires": False})
    _write("chop_alt", "negative", _build_chop(n=120, seed=16),
           NEUTRAL, {"fires": False})
    _write("too_short", "negative", _build_chop(n=30, seed=17),
           NEUTRAL, {"fires": False})

    # ===== 2 EDGE =====
    _write("borderline_volume", "edge",
           _build_pullback_21ema(seed=21, pullback_vol_ratio=0.95),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})
    _write("moderate_slope", "edge",
           _build_pullback_21ema(seed=22, trend_pct=0.20),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
