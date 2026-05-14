"""One-shot generator for inside_bar_breakout fixtures."""
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


def _build_inside_bar(state="forming", seed=1, lead_bars=20):
    """Build leadup, then [grandparent → wide mother → inside → optional breakout].

    state: 'forming' = inside bar is last, no breakout
           'bullish' = breakout above mother high is last
           'bearish' = breakdown below mother low is last
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    for i in range(lead_bars):
        price += rng.uniform(-0.3, 0.3)
        bars.append(_bar(t, price, 1500, rng, noise=0.30))
        t += DT

    # Grandparent: narrow range
    gp = {"t": t, "o": round(price, 2), "h": round(price + 0.4, 2),
          "l": round(price - 0.4, 2), "c": round(price + 0.1, 2),
          "v": 1500}
    bars.append(gp); t += DT

    # Mother bar: WIDER range than grandparent (higher high AND lower low)
    mother_high = price + 1.2
    mother_low = price - 1.2
    mother = {"t": t, "o": round(price + 0.5, 2),
              "h": round(mother_high, 2),
              "l": round(mother_low, 2),
              "c": round(price + 0.3, 2),
              "v": 2200}
    bars.append(mother); t += DT
    mother_range = mother_high - mother_low

    # Inside bar: inside mother range, small body
    in_mid = (mother_high + mother_low) / 2
    in_range = mother_range * 0.35  # 35% of mother range
    in_high = in_mid + in_range / 2
    in_low = in_mid - in_range / 2
    in_body = in_range * 0.15  # 15% body
    in_open = in_mid - in_body / 2
    in_close = in_mid + in_body / 2  # bullish small body
    inside = {"t": t, "o": round(in_open, 2),
              "h": round(in_high, 2), "l": round(in_low, 2),
              "c": round(in_close, 2),
              "v": 900}  # contracted volume
    bars.append(inside); t += DT

    if state == "forming":
        return bars

    # Breakout bar
    if state == "bullish":
        bo_close = mother_high + mother_range * 0.4
        bo = {"t": t, "o": round(mother_high * 1.002, 2),
              "h": round(bo_close * 1.005, 2),
              "l": round(mother_high * 0.998, 2),
              "c": round(bo_close, 2),
              "v": 2500}
        bars.append(bo)
    elif state == "bearish":
        bd_close = mother_low - mother_range * 0.4
        bd = {"t": t, "o": round(mother_low * 0.998, 2),
              "h": round(mother_low * 1.002, 2),
              "l": round(bd_close * 0.995, 2),
              "c": round(bd_close, 2),
              "v": 2500}
        bars.append(bd)
    return bars


def _build_no_inside_bar(n=40, seed=10):
    """Chop with no clear inside-bar setup."""
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
        "recent_dcr_avg": 0.3, "dcr_signature": "distribution",
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
    _write("forming_inside_bar", "positive",
           _build_inside_bar(state="forming", seed=1),
           BULL, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
                  "geometry_shape": "candle_mark"})
    _write("bullish_breakout", "positive",
           _build_inside_bar(state="bullish", seed=2),
           BULL, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("bearish_breakdown", "positive",
           _build_inside_bar(state="bearish", seed=3),
           BEAR, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("forming_bear_context", "positive",
           _build_inside_bar(state="forming", seed=4),
           BEAR, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("bullish_breakout_neutral", "positive",
           _build_inside_bar(state="bullish", seed=5),
           NEUTRAL, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})

    # ===== 8 NEGATIVE =====
    _write("no_inside_bar_chop", "negative", _build_no_inside_bar(seed=10),
           NEUTRAL, {"fires": False})
    _write("no_inside_bar_2", "negative", _build_no_inside_bar(seed=11),
           BULL, {"fires": False})
    _write("no_inside_bar_3", "negative", _build_no_inside_bar(seed=12),
           BEAR, {"fires": False})
    _write("no_inside_bar_4", "negative", _build_no_inside_bar(seed=13),
           NEUTRAL, {"fires": False})
    _write("too_short", "negative", _build_no_inside_bar(seed=14, n=3),
           NEUTRAL, {"fires": False})
    _write("no_inside_bar_5", "negative", _build_no_inside_bar(seed=15),
           NEUTRAL, {"fires": False})
    _write("no_inside_bar_6", "negative", _build_no_inside_bar(seed=16),
           BULL, {"fires": False})
    _write("no_inside_bar_7", "negative", _build_no_inside_bar(seed=17),
           BEAR, {"fires": False})

    # ===== 2 EDGE =====
    _write("borderline_compression", "edge",
           _build_inside_bar(state="forming", seed=21),
           NEUTRAL, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})
    _write("borderline_body_ratio", "edge",
           _build_inside_bar(state="forming", seed=22),
           NEUTRAL, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
