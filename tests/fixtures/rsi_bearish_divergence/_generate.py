"""One-shot generator for rsi_bearish_divergence fixtures."""
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


def _build_divergence(seed=1, leg1_pct=0.20, leg2_pct=0.10,
                       gain2_size_factor=0.5, lead_bars=45,
                       leg1_bars=15, retrace_bars=10, leg2_bars=12):
    """Build a price chart with TWO upward legs.

    Leg 1: large gain (sets prior high + high RSI).
    Retrace: small pullback.
    Leg 2: smaller per-bar gain but reaches a NEW high — RSI drops because
    average-up per bar is smaller in leg 2.
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    # Lead-in: mild flat
    for i in range(lead_bars):
        price += rng.uniform(-0.2, 0.1)
        bars.append(_bar(t, price, 1500, rng, noise=0.30))
        t += DT

    # Leg 1: aggressive rally
    leg1_target_gain = price * leg1_pct
    leg1_step = leg1_target_gain / leg1_bars
    for i in range(leg1_bars):
        price += leg1_step * rng.uniform(0.7, 1.3)
        bars.append(_bar(t, price, 1500, rng, noise=0.30))
        t += DT
    leg1_high_price = price

    # Retrace pullback
    retrace_step = (leg1_target_gain * 0.4) / retrace_bars
    for i in range(retrace_bars):
        price -= retrace_step * rng.uniform(0.7, 1.3)
        bars.append(_bar(t, price, 1300, rng, noise=0.30))
        t += DT

    # Leg 2: smaller per-bar gains
    leg2_step = leg1_step * gain2_size_factor
    bars_needed = leg2_bars + 4
    for i in range(bars_needed):
        price += leg2_step * rng.uniform(0.6, 1.2)
        bars.append(_bar(t, price, 1100, rng, noise=0.30))
        t += DT

    # Ensure final bar's high is ABOVE leg1_high
    if bars[-1]["h"] <= leg1_high_price:
        target_high = leg1_high_price * 1.02
        bars[-1]["h"] = round(target_high, 2)
        bars[-1]["c"] = round(target_high * 0.995, 2)
        bars[-1]["o"] = round(target_high * 0.985, 2)
        bars[-1]["l"] = round(target_high * 0.980, 2)
    return bars


def _build_downtrend(n=100, seed=10):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 100.0
    for i in range(n):
        price -= 0.4 + rng.uniform(-0.2, 0.2)
        bars.append(_bar(t, price, 1500, rng, noise=0.30))
        t += DT
    return bars


def _build_flat_chop(n=100, seed=11):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    for i in range(n):
        price += rng.uniform(-0.2, 0.2)
        bars.append(_bar(t, price, 1500, rng, noise=0.30))
        t += DT
    return bars


def _build_steep_uptrend(n=100, seed=12):
    """Continuous uptrend - no divergence (both legs equally strong)."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    for i in range(n):
        price += 0.6 + rng.uniform(-0.2, 0.3)
        bars.append(_bar(t, price, 1500, rng, noise=0.30))
        t += DT
    return bars


BEARISH_CTX = {"trend_stage": 2, "rs_trend": "down", "ma_alignment": "stacked_bullish",
               "volume_signature": "contracting", "regime": "transition",
               "nearest_resistance": None, "nearest_support": None,
               "days_to_earnings": None, "sector_strength_rank": 5,
               "recent_dcr_avg": 0.55, "dcr_signature": "distribution",
               "can_slim_grade": "C", "can_slim_score": 55}

NEUTRAL = {"trend_stage": 1, "rs_trend": "flat", "ma_alignment": "mixed",
           "volume_signature": "neutral", "regime": "transition",
           "nearest_resistance": None, "nearest_support": None,
           "days_to_earnings": None, "sector_strength_rank": None,
           "recent_dcr_avg": 0.5, "dcr_signature": "neutral",
           "can_slim_grade": "C", "can_slim_score": 50}

BEAR = {"trend_stage": 4, "rs_trend": "down", "ma_alignment": "stacked_bearish",
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
    _write("classic_divergence", "positive",
           _build_divergence(seed=1),
           BEARISH_CTX, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
                          "geometry_shape": "neckline"})
    _write("deep_overbought", "positive",
           _build_divergence(seed=2, leg1_pct=0.30),
           BEARISH_CTX, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("large_rsi_drop", "positive",
           _build_divergence(seed=3, gain2_size_factor=0.30),
           BEARISH_CTX, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("substantial_new_high", "positive",
           _build_divergence(seed=4, leg2_pct=0.15),
           BEARISH_CTX, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("with_volume_contraction", "positive",
           _build_divergence(seed=5),
           BEARISH_CTX, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})

    # ===== 8 NEGATIVE =====
    _write("downtrend_no_advance", "negative", _build_downtrend(seed=10),
           BEAR, {"fires": False})
    _write("flat_chop", "negative", _build_flat_chop(seed=11),
           NEUTRAL, {"fires": False})
    _write("steep_uptrend_no_div", "negative", _build_steep_uptrend(seed=12),
           {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
            "volume_signature": "expanding", "regime": "bull",
            "nearest_resistance": None, "nearest_support": None,
            "days_to_earnings": None, "sector_strength_rank": 1,
            "recent_dcr_avg": 0.7, "dcr_signature": "accumulation",
            "can_slim_grade": "A", "can_slim_score": 85},
           {"fires": False})
    _write("flat_chop_2", "negative", _build_flat_chop(n=90, seed=13),
           NEUTRAL, {"fires": False})
    _write("downtrend_2", "negative", _build_downtrend(seed=14),
           BEAR, {"fires": False})
    _write("too_short", "negative", _build_flat_chop(n=30, seed=15),
           NEUTRAL, {"fires": False})
    _write("flat_chop_3", "negative", _build_flat_chop(n=85, seed=16),
           NEUTRAL, {"fires": False})
    _write("uptrend_no_div_2", "negative", _build_steep_uptrend(seed=17),
           NEUTRAL, {"fires": False})

    # ===== 2 EDGE =====
    _write("borderline_rsi", "edge",
           _build_divergence(seed=21, gain2_size_factor=0.7),
           BEARISH_CTX, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})
    _write("borderline_advance", "edge",
           _build_divergence(seed=22, leg1_pct=0.12, leg2_pct=0.06),
           BEARISH_CTX, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
