"""One-shot generator for td_sequential_buy fixtures.

Builds a 9-bar TD Setup count where each close is below close[-4],
followed by no follow-through. The detector triggers on the last bar
of the 9-count.
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


def _build_td9_buy(
    pre_bars=40,            # base context bars
    decline_pct=0.05,       # how much the 9-count falls
    perfection=True,        # whether bar 9 perfects
    climax_vol_mult=1.8,    # bar 9 volume multiplier
    seed=1,
):
    """Build a TD9 buy setup: 9 consecutive bars where close < close[-4].

    To guarantee close[i] < close[i-4] for all 9 bars in the setup window,
    we drive prices monotonically downward over the 9-bar count + need
    pre-bars established so close[-4] references hold.
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400

    # 40 pre-bars at a base price of 100 with mild drift up to seed close[-4]
    base = 100.0
    for i in range(pre_bars):
        bars.append(_bar(t, base + rng.uniform(-0.2, 0.2), 1500, rng, noise=0.30))
        t += DT

    # Step price down so each new close < close[-4]. Use a constant step.
    # We need close[i] - close[i-4] < 0. Simplest: declining linear.
    start_price = base
    end_price = base * (1.0 - decline_pct)
    n_setup = 9
    for i in range(n_setup):
        # close progressively lower
        progress = (i + 1) / n_setup
        target_close = start_price + (end_price - start_price) * progress
        # Force close to be specifically below close[-4] of the pre-bar series
        ref_close = bars[len(bars) - 4]["c"] if len(bars) >= 4 else target_close
        forced_close = min(target_close, ref_close - 0.30)
        vol = 1500
        if i == n_setup - 1:
            vol = int(1500 * climax_vol_mult)
            # bar 9 — set its low to be below bar 8 low and bar 6 low (perfection)
            bar8_low = bars[-1]["l"]
            bar6_low = bars[-3]["l"]
            if perfection:
                # ensure low <= min(bar8_low, bar6_low)
                target_low = min(bar8_low, bar6_low) - 0.20
                b = _bar(t, forced_close - 0.10, vol, rng, noise=0.15,
                         force_close=forced_close,
                         force_open=forced_close + 0.30,
                         force_low=target_low)
            else:
                # bar 9 low NOT lowest — keep low above bar 8 or bar 6
                target_low = max(bar8_low, bar6_low) + 0.10
                b = _bar(t, forced_close, vol, rng, noise=0.15,
                         force_close=forced_close,
                         force_open=forced_close + 0.20,
                         force_low=target_low)
        else:
            b = _bar(t, forced_close, vol, rng, noise=0.15,
                     force_close=forced_close,
                     force_open=forced_close + 0.20)
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


def _build_uptrend(n=60, seed=11):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    rate = 2.0 ** (1.0 / n)
    for i in range(n):
        price *= rate
        bars.append(_bar(t, price, 1500, rng, noise=0.30))
        t += DT
    return bars


GOOD = {"trend_stage": 4, "rs_trend": "flat", "ma_alignment": "mixed",
        "volume_signature": "expanding", "regime": "bear",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 10,
        "recent_dcr_avg": 0.4, "dcr_signature": "neutral",
        "can_slim_grade": "C", "can_slim_score": 55}

GREAT = {"trend_stage": 4, "rs_trend": "up", "ma_alignment": "mixed",
         "volume_signature": "expanding", "regime": "bear",
         "nearest_resistance": None, "nearest_support": None,
         "days_to_earnings": None, "sector_strength_rank": 5,
         "recent_dcr_avg": 0.7, "dcr_signature": "accumulation",
         "can_slim_grade": "B", "can_slim_score": 70}

NEUTRAL = {"trend_stage": 1, "rs_trend": "flat", "ma_alignment": "mixed",
           "volume_signature": "neutral", "regime": "transition",
           "nearest_resistance": None, "nearest_support": None,
           "days_to_earnings": None, "sector_strength_rank": None,
           "recent_dcr_avg": 0.5, "dcr_signature": "neutral",
           "can_slim_grade": "C", "can_slim_score": 50}

BULL = {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
        "volume_signature": "contracting", "regime": "bull",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": 2,
        "recent_dcr_avg": 0.7, "dcr_signature": "accumulation",
        "can_slim_grade": "A", "can_slim_score": 85}


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
           _build_td9_buy(seed=1, perfection=True),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
                  "geometry_shape": "candle_mark"})
    _write("deep_decline", "positive",
           _build_td9_buy(seed=2, decline_pct=0.10, perfection=True),
           GOOD, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("high_volume_climax", "positive",
           _build_td9_buy(seed=3, climax_vol_mult=2.5, perfection=True),
           GREAT, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("perfection_with_dcr", "positive",
           _build_td9_buy(seed=4, perfection=True),
           GREAT, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("standard_setup", "positive",
           _build_td9_buy(seed=5, perfection=True, decline_pct=0.06),
           NEUTRAL, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})

    # ===== 8 NEGATIVE =====
    _write("chop_no_setup", "negative", _build_chop(n=60, seed=10),
           NEUTRAL, {"fires": False})
    _write("uptrend_no_buy", "negative", _build_uptrend(n=60, seed=11),
           BULL, {"fires": False})
    _write("chop_alt", "negative", _build_chop(n=80, seed=12),
           NEUTRAL, {"fires": False})
    _write("uptrend_alt", "negative", _build_uptrend(n=80, seed=13),
           BULL, {"fires": False})
    _write("too_short", "negative",
           _build_chop(n=20, seed=14),
           NEUTRAL, {"fires": False})
    _write("flat_no_decline", "negative", _build_chop(n=60, seed=15),
           NEUTRAL, {"fires": False})
    _write("longer_chop", "negative", _build_chop(n=100, seed=16),
           NEUTRAL, {"fires": False})
    _write("longer_uptrend", "negative", _build_uptrend(n=100, seed=17),
           BULL, {"fires": False})

    # ===== 2 EDGE =====
    _write("no_perfection", "edge",
           _build_td9_buy(seed=21, perfection=False),
           GOOD, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})
    _write("shallow_decline", "edge",
           _build_td9_buy(seed=22, decline_pct=0.03, perfection=True),
           NEUTRAL, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
