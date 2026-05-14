"""One-shot generator for parabolic_short fixtures.

Builds a parabolic 100%+ run + a climactic bar with gap-up + 3x ATR range
+ 3x volume + DCR <= 0.3 + close < open.
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _bar(t, mid, vol, rng, noise=0.20):
    o = mid + rng.uniform(-noise, noise)
    c = mid + rng.uniform(-noise, noise)
    h = max(o, c) + abs(rng.uniform(0, noise * 1.2))
    l = min(o, c) - abs(rng.uniform(0, noise * 1.2))
    return {"t": t, "o": round(o, 2), "h": round(h, 2),
            "l": round(l, 2), "c": round(c, 2),
            "v": round(vol * rng.uniform(0.85, 1.15), 0)}


def _build_parabolic_climax(
    prior_bars=60,
    run_pct=1.5,  # 150% run
    range_ratio=4.0,  # climax range vs ATR
    vol_ratio=4.0,
    dcr=0.10,  # very weak close
    gap_up_pct=0.05,
    seed=1,
):
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400

    # Run-up phase - last 30 bars MUST contain the run_pct advance per detector spec.
    # Build a flat zone first, then accelerate the last 30 bars.
    flat_bars = max(0, prior_bars - 30)
    start_price = 20.0
    for i in range(flat_bars):
        price = start_price * (1.0 + 0.05 * (i / max(1, flat_bars)))
        bars.append(_bar(t, price, 1500, rng, noise=0.30))
        t += DT
    # Last 30 bars: parabolic compounding to deliver run_pct
    flat_end_price = start_price * 1.05
    # Compounding rate per bar: (1+run_pct/1.05)^(1/30) - 1
    target_final = flat_end_price * (1.0 + run_pct)
    rate = (target_final / flat_end_price) ** (1.0 / 30.0)
    for i in range(30):
        price = flat_end_price * (rate ** (i + 1))
        bars.append(_bar(t, price, 1500, rng, noise=0.40))
        t += DT

    # Compute ATR(20) over last 20 prior bars (h-l avg)
    last20 = bars[-20:]
    atr20 = sum(b["h"] - b["l"] for b in last20) / len(last20)
    avg20_vol = sum(b["v"] for b in last20) / len(last20)
    prev_close = bars[-1]["c"]

    # Climax bar: gap-up, big range, weak close, high volume.
    # Total bar range = atr20 * range_ratio. Position open and close so that
    # close is in bottom dcr fraction of the range AND close < open.
    climax_open = prev_close * (1.0 + gap_up_pct)
    climax_range = atr20 * range_ratio
    # Place the climax bar so the open is high in the range (gap-up exhaustion)
    # and the low is far below.
    climax_high = climax_open + climax_range * 0.05  # slight wick above open
    climax_low = climax_high - climax_range
    climax_close = climax_low + climax_range * dcr
    # Ensure close < open (failed gap)
    if climax_close >= climax_open:
        climax_close = climax_open - climax_range * 0.1

    bars.append({"t": t, "o": round(climax_open, 2), "h": round(climax_high, 2),
                 "l": round(climax_low, 2), "c": round(climax_close, 2),
                 "v": round(avg20_vol * vol_ratio, 0)})
    return bars


def _build_no_parabolic(n_bars=60, seed=10):
    """Sideways chop - no parabolic run."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    for i in range(n_bars):
        price += rng.uniform(-0.5, 0.5)
        bars.append(_bar(t, price, 1000, rng, noise=0.20))
        t += DT
    # Inject a "looks like climax" bar
    last = bars[-1]["c"]
    bars.append({"t": t, "o": round(last * 1.05, 2), "h": round(last * 1.10, 2),
                 "l": round(last * 0.95, 2), "c": round(last * 0.97, 2),
                 "v": 5000})
    return bars


def _build_uptrend_short(n_bars=60, seed=11):
    """Mild uptrend, not parabolic."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    for i in range(n_bars):
        price *= 1.005
        bars.append(_bar(t, price, 1000, rng, noise=0.20))
        t += DT
    return bars


GOOD_CTX = {"trend_stage": 3, "rs_trend": "flat", "ma_alignment": "stacked_bullish",
            "volume_signature": "expanding", "regime": "bull",
            "nearest_resistance": None, "nearest_support": None,
            "days_to_earnings": None, "sector_strength_rank": None,
            "recent_dcr_avg": 0.55, "dcr_signature": "distribution",
            "can_slim_grade": "B", "can_slim_score": 65}

NEUTRAL = {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
           "volume_signature": "neutral", "regime": "bull",
           "nearest_resistance": None, "nearest_support": None,
           "days_to_earnings": None, "sector_strength_rank": None,
           "recent_dcr_avg": 0.55, "dcr_signature": "neutral",
           "can_slim_grade": "C", "can_slim_score": 55}


def _write(name, category, bars, context, expected):
    payload = {"name": name, "category": category, "expected": expected,
               "context": context, "bars": bars}
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


def main():
    # ===== 5 POSITIVE =====
    _write("clean_parabolic", "positive", _build_parabolic_climax(seed=1),
           GOOD_CTX, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
                      "geometry_shape": "candle_mark"})
    _write("extreme_blowoff", "positive",
           _build_parabolic_climax(run_pct=2.5, range_ratio=5.0, vol_ratio=5.0,
                                   dcr=0.05, gap_up_pct=0.12, seed=2),
           GOOD_CTX, {"fires": True, "min_confidence": 65.0, "max_confidence": 100.0})
    _write("modest_parabolic", "positive",
           _build_parabolic_climax(run_pct=1.05, range_ratio=3.2, vol_ratio=3.2,
                                   dcr=0.20, gap_up_pct=0.04, seed=3),
           GOOD_CTX, {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})
    _write("strong_dcr", "positive",
           _build_parabolic_climax(run_pct=1.2, range_ratio=4.0, vol_ratio=4.0,
                                   dcr=0.05, seed=4),
           GOOD_CTX, {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})
    _write("huge_volume", "positive",
           _build_parabolic_climax(run_pct=1.3, vol_ratio=6.0, seed=5),
           GOOD_CTX, {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    # ===== 8 NEGATIVE =====
    _write("no_prior_run", "negative", _build_no_parabolic(seed=10),
           NEUTRAL, {"fires": False})
    _write("uptrend_not_parabolic", "negative", _build_uptrend_short(seed=11),
           NEUTRAL, {"fires": False})
    _write("small_run", "negative",
           _build_parabolic_climax(run_pct=0.5, seed=12),
           NEUTRAL, {"fires": False})
    _write("range_too_small", "negative",
           _build_parabolic_climax(range_ratio=2.0, seed=13),
           GOOD_CTX, {"fires": False})
    _write("vol_too_small", "negative",
           _build_parabolic_climax(vol_ratio=2.0, seed=14),
           GOOD_CTX, {"fires": False})
    _write("dcr_too_strong", "negative",
           _build_parabolic_climax(dcr=0.6, seed=15),
           GOOD_CTX, {"fires": False})
    _write("no_gap_up", "negative",
           _build_parabolic_climax(gap_up_pct=0.01, seed=16),
           GOOD_CTX, {"fires": False})
    _write("climax_held_gap", "negative",
           _build_parabolic_climax(dcr=0.9, seed=17),
           GOOD_CTX, {"fires": False})

    # ===== 2 EDGE =====
    _write("boundary_run", "edge",
           _build_parabolic_climax(run_pct=1.1, range_ratio=3.2, vol_ratio=3.2,
                                   dcr=0.25, gap_up_pct=0.035, seed=21),
           GOOD_CTX, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})
    _write("boundary_vol", "edge",
           _build_parabolic_climax(run_pct=1.2, range_ratio=3.3, vol_ratio=3.2,
                                   dcr=0.28, gap_up_pct=0.04, seed=22),
           GOOD_CTX, {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
