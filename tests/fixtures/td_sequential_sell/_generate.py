"""One-shot generator for td_sequential_sell fixtures.

Builds a 9-bar TD Sell Setup count where each close is above close[-4].
"""
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


def _build_td9_sell(
    pre_bars=40,
    advance_pct=0.05,
    perfection=True,
    climax_vol_mult=1.8,
    seed=1,
):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400

    base = 100.0
    for i in range(pre_bars):
        bars.append(_bar(t, base + rng.uniform(-0.2, 0.2), 1500, rng, noise=0.30))
        t += DT

    start_price = base
    end_price = base * (1.0 + advance_pct)
    n_setup = 9
    for i in range(n_setup):
        progress = (i + 1) / n_setup
        target_close = start_price + (end_price - start_price) * progress
        ref_close = bars[len(bars) - 4]["c"] if len(bars) >= 4 else target_close
        forced_close = max(target_close, ref_close + 0.30)
        vol = 1500
        if i == n_setup - 1:
            vol = int(1500 * climax_vol_mult)
            bar8_high = bars[-1]["h"]
            bar6_high = bars[-3]["h"]
            if perfection:
                target_high = max(bar8_high, bar6_high) + 0.20
                b = _bar(t, forced_close + 0.10, vol, rng, noise=0.15,
                         force_close=forced_close,
                         force_open=forced_close - 0.30,
                         force_high=target_high)
            else:
                target_high = min(bar8_high, bar6_high) - 0.10
                b = _bar(t, forced_close, vol, rng, noise=0.15,
                         force_close=forced_close,
                         force_open=forced_close - 0.20,
                         force_high=target_high)
        else:
            b = _bar(t, forced_close, vol, rng, noise=0.15,
                     force_close=forced_close,
                     force_open=forced_close - 0.20)
        bars.append(b)
        t += DT

    return bars


def _build_chop(n=60, seed=10):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 100.0
    for i in range(n):
        price += rng.uniform(-0.3, 0.3)
        bars.append(_bar(t, price, 1500, rng, noise=0.30))
        t += DT
    return bars


def _build_downtrend(n=60, seed=11):
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


# Sell-9 ideal context: Stage 2/3 with stretched conditions
GOOD = {"trend_stage": 2, "rs_trend": "flat", "ma_alignment": "stacked_bullish",
        "volume_signature": "expanding", "regime": "bull",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 5,
        "recent_dcr_avg": 0.3, "dcr_signature": "distribution",
        "can_slim_grade": "C", "can_slim_score": 55}

GREAT = {"trend_stage": 3, "rs_trend": "down", "ma_alignment": "mixed",
         "volume_signature": "expanding", "regime": "transition",
         "nearest_resistance": None, "nearest_support": None,
         "days_to_earnings": None, "sector_strength_rank": 8,
         "recent_dcr_avg": 0.25, "dcr_signature": "distribution",
         "can_slim_grade": "C", "can_slim_score": 50}

NEUTRAL = {"trend_stage": 1, "rs_trend": "flat", "ma_alignment": "mixed",
           "volume_signature": "neutral", "regime": "transition",
           "nearest_resistance": None, "nearest_support": None,
           "days_to_earnings": None, "sector_strength_rank": None,
           "recent_dcr_avg": 0.5, "dcr_signature": "neutral",
           "can_slim_grade": "C", "can_slim_score": 50}

BEAR = {"trend_stage": 4, "rs_trend": "down", "ma_alignment": "stacked_bearish",
        "volume_signature": "expanding", "regime": "bear",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 12,
        "recent_dcr_avg": 0.25, "dcr_signature": "distribution",
        "can_slim_grade": "D", "can_slim_score": 30}


def _write(name, category, bars, context, expected):
    payload = {"name": name, "category": category, "expected": expected,
               "context": context, "bars": bars}
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


def main():
    # ===== 5 POSITIVE =====
    _write("clean_perfection", "positive",
           _build_td9_sell(seed=1, perfection=True),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
                  "geometry_shape": "candle_mark"})
    _write("deep_advance", "positive",
           _build_td9_sell(seed=2, advance_pct=0.10, perfection=True),
           GOOD, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("high_volume_climax", "positive",
           _build_td9_sell(seed=3, climax_vol_mult=2.5, perfection=True),
           GREAT, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("perfection_with_dcr", "positive",
           _build_td9_sell(seed=4, perfection=True),
           GREAT, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("standard_setup", "positive",
           _build_td9_sell(seed=5, perfection=True, advance_pct=0.06),
           NEUTRAL, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})

    # ===== 8 NEGATIVE =====
    _write("chop_no_setup", "negative", _build_chop(n=60, seed=10),
           NEUTRAL, {"fires": False})
    _write("downtrend_no_sell", "negative", _build_downtrend(n=60, seed=11),
           BEAR, {"fires": False})
    _write("chop_alt", "negative", _build_chop(n=80, seed=12),
           NEUTRAL, {"fires": False})
    _write("downtrend_alt", "negative", _build_downtrend(n=80, seed=13),
           BEAR, {"fires": False})
    _write("too_short", "negative",
           _build_chop(n=20, seed=14),
           NEUTRAL, {"fires": False})
    _write("flat_no_advance", "negative", _build_chop(n=60, seed=15),
           NEUTRAL, {"fires": False})
    _write("longer_chop", "negative", _build_chop(n=100, seed=16),
           NEUTRAL, {"fires": False})
    _write("longer_downtrend", "negative", _build_downtrend(n=100, seed=17),
           BEAR, {"fires": False})

    # ===== 2 EDGE =====
    _write("no_perfection", "edge",
           _build_td9_sell(seed=21, perfection=False),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})
    _write("shallow_advance", "edge",
           _build_td9_sell(seed=22, advance_pct=0.03, perfection=True),
           NEUTRAL, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
