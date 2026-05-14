"""One-shot generator for donchian_breakout fixtures."""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _bar(t, mid, vol, rng, noise=0.30,
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


def _build_long_break(period, breakout_pct=1.5, breakout_vol_ratio=1.5, seed=1, lead_bars=80):
    """Build a range with a clean upward breakout of the period-bar high."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    # Sideways with mild noise — ranges over period-bar window
    for i in range(lead_bars):
        price += rng.uniform(-0.2, 0.2)
        bars.append(_bar(t, price, 1500, rng, noise=0.30))
        t += DT

    # Pinpoint period-bar high (over the last `period` bars before breakout)
    last_window = bars[-period:]
    p_high = max(b["h"] for b in last_window)

    # Breakout bar: close far above p_high on heavy volume
    breakout_price = p_high * (1.0 + breakout_pct / 100.0)
    bo_vol = 1500 * breakout_vol_ratio
    bo_bar = _bar(t, breakout_price, bo_vol, rng, noise=0.20,
                  force_close=breakout_price,
                  force_open=p_high * 1.001,
                  force_high=breakout_price * 1.005)
    bars.append(bo_bar)
    return bars


def _build_short_break(period, breakout_pct=1.5, breakout_vol_ratio=1.5, seed=2, lead_bars=80):
    """Build a range with a clean downward breakout of the period-bar low."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    for i in range(lead_bars):
        price += rng.uniform(-0.2, 0.2)
        bars.append(_bar(t, price, 1500, rng, noise=0.30))
        t += DT

    last_window = bars[-period:]
    p_low = min(b["l"] for b in last_window)

    breakdown_price = p_low * (1.0 - breakout_pct / 100.0)
    bd_vol = 1500 * breakout_vol_ratio
    bd_bar = _bar(t, breakdown_price, bd_vol, rng, noise=0.20,
                  force_close=breakdown_price,
                  force_open=p_low * 0.999,
                  force_low=breakdown_price * 0.995)
    bars.append(bd_bar)
    return bars


def _build_range_no_break(n=85, seed=10):
    """Sideways chop — no breakout in either direction."""
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


BULL = {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
        "volume_signature": "expanding", "regime": "bull",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 3,
        "recent_dcr_avg": 0.65, "dcr_signature": "accumulation",
        "can_slim_grade": "B", "can_slim_score": 72}

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
    _write("system1_long_break", "positive",
           _build_long_break(period=20, seed=1),
           BULL, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
                  "geometry_shape": "horizontal_line"})
    _write("system2_long_break", "positive",
           _build_long_break(period=55, seed=2, lead_bars=90),
           BULL, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("system1_short_break", "positive",
           _build_short_break(period=20, seed=3),
           BEAR, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("system2_short_break", "positive",
           _build_short_break(period=55, seed=4, lead_bars=90),
           BEAR, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("strong_long_break_high_vol", "positive",
           _build_long_break(period=55, breakout_pct=3.5, breakout_vol_ratio=2.5,
                             seed=5, lead_bars=90),
           BULL, {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    # ===== 8 NEGATIVE =====
    _write("range_no_break", "negative", _build_range_no_break(n=90, seed=10),
           NEUTRAL, {"fires": False})
    _write("low_volume_break", "negative",
           _build_long_break(period=20, breakout_vol_ratio=0.5, seed=11),
           BULL, {"fires": False})
    _write("just_below_high", "negative",
           _build_long_break(period=20, breakout_pct=-0.5, seed=12),  # close BELOW high
           BULL, {"fires": False})
    _write("just_above_low", "negative",
           _build_short_break(period=20, breakout_pct=-0.5, seed=13),  # close ABOVE low
           BEAR, {"fires": False})
    _write("range_no_break_2", "negative", _build_range_no_break(n=100, seed=14),
           BULL, {"fires": False})
    _write("range_no_break_3", "negative", _build_range_no_break(n=80, seed=15),
           BEAR, {"fires": False})
    _write("too_short", "negative", _build_range_no_break(n=40, seed=16),
           NEUTRAL, {"fires": False})
    _write("low_vol_long_break", "negative",
           _build_long_break(period=20, breakout_vol_ratio=0.6, seed=17),
           NEUTRAL, {"fires": False})

    # ===== 2 EDGE =====
    _write("marginal_break_vol_ok", "edge",
           _build_long_break(period=20, breakout_pct=0.3, breakout_vol_ratio=1.1, seed=21),
           BULL, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})
    _write("borderline_vol", "edge",
           _build_long_break(period=20, breakout_pct=1.0, breakout_vol_ratio=1.05, seed=22),
           BULL, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
