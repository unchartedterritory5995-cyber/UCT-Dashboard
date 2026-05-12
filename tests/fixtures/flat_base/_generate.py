"""One-shot generator for the flat_base fixture battery.

Run: python tests/fixtures/flat_base/_generate.py

A Flat Base is:
  - >=25% prior advance in the 60 bars before the base
  - 15-35 bars of tight horizontal consolidation (<=12% depth)
  - Sideways drift (|slope| small relative to base_mid)
  - Volume drying: latter half avg < 75% of first half
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _build_bars(base_price=20.0, pre_advance_bars=20,
                advance_pct=0.35, advance_bars=30,
                base_bars=20, base_depth=0.08,
                base_slope_pct_per_bar=0.0,
                vol_first_half=2000.0, vol_second_half_ratio=0.55,
                ascending_base=False, choppy=False,
                sustained_above_bars=0, seed=42):
    """Build a synthetic OHLCV series with a flat-base structure.

    Phases:
      1. Pre-advance base (sideways consolidation at base_price) — provides the
         clear low from which the advance is measured.
      2. Prior advance — rising trend to a higher peak (advance_pct above the
         pre-advance low).
      3. Base consolidation — tight horizontal action of base_depth (% of mid)
         over base_bars bars.
      4. Optional sustained-above-pivot bars (for 'already_broken' fixtures).
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400

    # 1. Pre-advance consolidation — flat around base_price
    price = base_price
    for _ in range(pre_advance_bars):
        c = price + rng.uniform(-0.10, 0.10)
        h = c + abs(rng.uniform(0, 0.12))
        l = c - abs(rng.uniform(0, 0.12))
        o = price + rng.uniform(-0.08, 0.08)
        v = 1500.0 * rng.uniform(0.85, 1.15)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += DT

    pre_advance_low = min(b["l"] for b in bars) if bars else base_price

    # 2. Prior advance — linear rise to base_price * (1 + advance_pct)
    if advance_bars > 0 and advance_pct > 0:
        advance_start_price = bars[-1]["c"]
        advance_end_price = pre_advance_low * (1.0 + advance_pct)
        step = (advance_end_price - advance_start_price) / advance_bars
        for i in range(advance_bars):
            c = advance_start_price + step * (i + 1) + rng.uniform(-0.15, 0.15)
            o = advance_start_price + step * i + rng.uniform(-0.10, 0.10)
            h = max(c, o) + abs(rng.uniform(0, 0.20))
            l = min(c, o) - abs(rng.uniform(0, 0.20))
            v = 2200.0 * rng.uniform(0.85, 1.20)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += DT

    # 3. Base consolidation
    advance_top = bars[-1]["c"]
    # base_mid: choose so that depth fraction = (base_high - base_low)/mid
    # We construct base oscillating around advance_top.
    base_mid = advance_top
    half_depth = (base_depth * base_mid) / 2.0
    base_high_target = base_mid + half_depth
    base_low_target = base_mid - half_depth

    for i in range(base_bars):
        slope_offset = base_slope_pct_per_bar * base_mid * (i - (base_bars - 1) / 2.0)
        high_i = base_high_target + slope_offset
        low_i = base_low_target + slope_offset
        if ascending_base:
            high_i += 0.20 * i
            low_i += 0.20 * i

        # Oscillate close inside [low_i, high_i]
        if high_i - low_i > 0.10:
            c = rng.uniform(low_i + 0.05, high_i - 0.05)
            o = rng.uniform(low_i + 0.05, high_i - 0.05)
        else:
            c = (high_i + low_i) / 2.0
            o = (high_i + low_i) / 2.0
        if choppy:
            c += rng.uniform(-2.5, 2.5)
            o += rng.uniform(-2.5, 2.5)
        h = max(c, o, high_i) + abs(rng.uniform(0, 0.05))
        l = min(c, o, low_i) - abs(rng.uniform(0, 0.05))

        # Volume: first half = vol_first_half, second half = vol_first_half * ratio
        if i < base_bars // 2:
            v = vol_first_half * rng.uniform(0.85, 1.15)
        else:
            v = vol_first_half * vol_second_half_ratio * rng.uniform(0.85, 1.15)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += DT

    # 4. Optional sustained-above-pivot bars
    if sustained_above_bars > 0:
        last_base_high = max(b["h"] for b in bars[-base_bars:])
        for i in range(sustained_above_bars):
            mid = last_base_high * (1.03 + 0.005 * i)
            c = mid + rng.uniform(-0.10, 0.10)
            o = mid - 0.15 + rng.uniform(-0.05, 0.05)
            h = max(c, o) + abs(rng.uniform(0, 0.15))
            l = min(c, o) - abs(rng.uniform(0, 0.15))
            v = vol_first_half * 1.4 * rng.uniform(0.85, 1.15)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += DT

    return bars


def _build_choppy_walk(n_bars=80, base_price=50.0, seed=1):
    """Random walk — no clear advance, no clean base."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = base_price
    for i in range(n_bars):
        price *= (1.0 + rng.uniform(-0.025, 0.025))
        c = price + rng.uniform(-0.40, 0.40)
        h = c + abs(rng.uniform(0, 0.60))
        l = c - abs(rng.uniform(0, 0.60))
        o = c + rng.uniform(-0.30, 0.30)
        v = 1500.0 * rng.uniform(0.7, 1.3)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += DT
    return bars


GOOD_CONTEXT = {
    "trend_stage": 2,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "contracting",
    "regime": "bullish",
    "nearest_resistance": None,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}

DOWNTREND_CONTEXT = {
    "trend_stage": 4,
    "rs_trend": "down",
    "ma_alignment": "stacked_bearish",
    "volume_signature": "expanding",
    "regime": "bearish",
    "nearest_resistance": None,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}


def _write(name, category, gen_params_or_bars, expected, context=None,
           prebuilt=False):
    if prebuilt:
        bars = gen_params_or_bars
        generation_info = {"prebuilt": True}
    else:
        bars = _build_bars(**gen_params_or_bars)
        generation_info = gen_params_or_bars
    payload = {
        "name": name,
        "category": category,
        "_generation": generation_info,
        "expected": expected,
        "bars": bars,
    }
    if context is not None:
        payload["context"] = context
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


def main():
    # ===== 5 POSITIVE — must fire with confidence >=50 =====
    _write("clean_textbook", "positive",
           dict(base_price=20.0, pre_advance_bars=20,
                advance_pct=0.35, advance_bars=30,
                base_bars=20, base_depth=0.08,
                base_slope_pct_per_bar=0.0,
                vol_first_half=2000.0, vol_second_half_ratio=0.55,
                seed=1),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "rectangle"},
           context=GOOD_CONTEXT)

    _write("long_base", "positive",
           dict(base_price=15.0, pre_advance_bars=15,
                advance_pct=0.40, advance_bars=28,
                base_bars=32, base_depth=0.06,
                base_slope_pct_per_bar=0.0,
                vol_first_half=2200.0, vol_second_half_ratio=0.60,
                seed=2),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0},
           context=GOOD_CONTEXT)

    _write("dramatic_advance", "positive",
           dict(base_price=10.0, pre_advance_bars=20,
                advance_pct=0.60, advance_bars=32,
                base_bars=22, base_depth=0.09,
                base_slope_pct_per_bar=0.0,
                vol_first_half=2500.0, vol_second_half_ratio=0.50,
                seed=3),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0},
           context=GOOD_CONTEXT)

    _write("tight_base", "positive",
           dict(base_price=25.0, pre_advance_bars=18,
                advance_pct=0.30, advance_bars=28,
                base_bars=15, base_depth=0.04,
                base_slope_pct_per_bar=0.0,
                vol_first_half=2000.0, vol_second_half_ratio=0.55,
                seed=4),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0},
           context=GOOD_CONTEXT)

    _write("perfect_volume_contraction", "positive",
           dict(base_price=18.0, pre_advance_bars=20,
                advance_pct=0.45, advance_bars=30,
                base_bars=20, base_depth=0.07,
                base_slope_pct_per_bar=0.0,
                vol_first_half=3000.0, vol_second_half_ratio=0.35,
                seed=5),
           {"fires": True, "min_confidence": 65.0, "max_confidence": 100.0},
           context=GOOD_CONTEXT)

    # ===== 8 NEGATIVE — must NOT fire =====
    _write("no_prior_advance", "negative",
           dict(base_price=20.0, pre_advance_bars=30,
                advance_pct=0.10, advance_bars=20,
                base_bars=20, base_depth=0.08,
                base_slope_pct_per_bar=0.0,
                vol_first_half=2000.0, vol_second_half_ratio=0.55,
                seed=10),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("base_too_deep", "negative",
           dict(base_price=20.0, pre_advance_bars=20,
                advance_pct=0.35, advance_bars=30,
                base_bars=20, base_depth=0.18,
                base_slope_pct_per_bar=0.0,
                vol_first_half=2000.0, vol_second_half_ratio=0.55,
                seed=11),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("base_too_short", "negative",
           dict(base_price=20.0, pre_advance_bars=20,
                advance_pct=0.45, advance_bars=15,
                base_bars=10, base_depth=0.07,
                base_slope_pct_per_bar=0.0,
                vol_first_half=2000.0, vol_second_half_ratio=0.55,
                seed=12),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("base_sloped_down", "negative",
           dict(base_price=20.0, pre_advance_bars=20,
                advance_pct=0.35, advance_bars=30,
                base_bars=20, base_depth=0.08,
                base_slope_pct_per_bar=-0.008,
                vol_first_half=2000.0, vol_second_half_ratio=0.55,
                seed=13),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("volume_expanding", "negative",
           dict(base_price=20.0, pre_advance_bars=20,
                advance_pct=0.35, advance_bars=30,
                base_bars=20, base_depth=0.08,
                base_slope_pct_per_bar=0.0,
                vol_first_half=2000.0, vol_second_half_ratio=1.30,
                seed=14),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("already_broken", "negative",
           dict(base_price=20.0, pre_advance_bars=20,
                advance_pct=0.35, advance_bars=30,
                base_bars=20, base_depth=0.08,
                base_slope_pct_per_bar=0.0,
                vol_first_half=2000.0, vol_second_half_ratio=0.55,
                sustained_above_bars=6, seed=15),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("downtrend_context", "negative",
           dict(base_price=20.0, pre_advance_bars=20,
                advance_pct=0.35, advance_bars=30,
                base_bars=20, base_depth=0.08,
                base_slope_pct_per_bar=0.0,
                vol_first_half=2000.0, vol_second_half_ratio=0.55,
                seed=16),
           {"fires": False},
           context=DOWNTREND_CONTEXT)

    _write("choppy_no_pattern", "negative",
           _build_choppy_walk(n_bars=90, base_price=50.0, seed=17),
           {"fires": False},
           context=GOOD_CONTEXT,
           prebuilt=True)

    # ===== 2 EDGE — boundary of validity =====
    _write("boundary_min_advance", "edge",
           dict(base_price=20.0, pre_advance_bars=20,
                advance_pct=0.255, advance_bars=28,
                base_bars=20, base_depth=0.08,
                base_slope_pct_per_bar=0.0,
                vol_first_half=2000.0, vol_second_half_ratio=0.60,
                seed=20),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0},
           context=GOOD_CONTEXT)

    _write("boundary_max_depth", "edge",
           dict(base_price=20.0, pre_advance_bars=20,
                advance_pct=0.35, advance_bars=30,
                base_bars=20, base_depth=0.108,
                base_slope_pct_per_bar=0.0,
                vol_first_half=2000.0, vol_second_half_ratio=0.60,
                seed=21),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0},
           context=GOOD_CONTEXT)

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
