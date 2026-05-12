"""One-shot generator for the vcp fixture battery.

Run: python tests/fixtures/vcp/_generate.py

A VCP is a sequence of progressively tighter pullbacks on declining volume,
forming inside an uptrend. Generator builds a synthetic OHLCV series:
  uptrend_prior -> [high1 -> low1] -> [high2 -> low2] -> ... -> pivot_high
The final contraction's high is the pivot. Each contraction is shallower
than the prior and uses less volume.
"""
import json
import math
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _make_bar(t, mid_price, vol, rng, noise=0.20, force_low=None, force_high=None):
    """Build a generic OHLC bar centered on mid_price."""
    o = mid_price + rng.uniform(-noise, noise)
    c = mid_price + rng.uniform(-noise, noise)
    h = max(o, c) + abs(rng.uniform(0, noise * 1.2))
    l = min(o, c) - abs(rng.uniform(0, noise * 1.2))
    if force_high is not None:
        h = max(h, force_high)
    if force_low is not None:
        l = min(l, force_low)
    return {
        "t": t,
        "o": round(o, 2),
        "h": round(h, 2),
        "l": round(l, 2),
        "c": round(c, 2),
        "v": round(vol * rng.uniform(0.85, 1.15), 0),
    }


def _build_vcp_bars(
    base_price=50.0,
    prior_advance_bars=40,
    prior_advance_pct=0.40,
    contractions=None,           # list of (pct, contraction_bars) — each tightens
    volume_ratios=None,          # list of (contraction_vol_avg, rally_vol_avg) per cycle
    rally_bars_between=6,        # bars from low back up to next high
    base_vol=1000.0,
    final_tail_bars=2,           # bars after the final low (still inside contraction range)
    pivot_breakout=False,        # if True, append a breakout bar above pivot
    sustained_above_pivot_bars=0,  # for already_broken fixture
    seed=42,
):
    """Build a synthetic series with VCP geometry.

    contractions: list of (pct, contraction_bars). E.g. [(0.25, 8), (0.12, 6), (0.06, 5)]
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400

    if contractions is None:
        contractions = [(0.25, 8), (0.12, 6), (0.06, 5)]

    # 1. Prior advance: simple uptrend from (base_price * (1 - prior_advance_pct)) to base_price
    prior_start = base_price / (1.0 + prior_advance_pct)
    if prior_advance_bars > 0:
        step = (base_price - prior_start) / prior_advance_bars
        for i in range(prior_advance_bars):
            mid = prior_start + step * (i + 1) + rng.uniform(-0.20, 0.20)
            v = base_vol * 2.0 * rng.uniform(0.8, 1.2)
            bars.append(_make_bar(t, mid, v, rng, noise=0.30))
            t += DT

    # 2. The VCP sequence. Each contraction: drop from current_high to low, then rally back near (but slightly below or at) the prior high to start the next contraction.
    current_high = base_price

    for i, (pct, contraction_bars) in enumerate(contractions):
        # The "high" anchor: a single bar with a clear peak
        # Want the swing-high to be at current_high level
        high_bar_mid = current_high * 0.997
        high_bar = _make_bar(t, high_bar_mid, base_vol * 1.5, rng,
                             noise=0.10, force_high=current_high)
        bars.append(high_bar)
        t += DT

        # Drop to low over contraction_bars
        target_low = current_high * (1.0 - pct)
        # contraction volume — drops sharply for each successive contraction
        if volume_ratios is not None and i < len(volume_ratios):
            contr_vol = base_vol * volume_ratios[i]
        else:
            # Default: 1.0, 0.6, 0.35, 0.18, ...
            contr_vol = base_vol * (1.0 * (0.55 ** i))

        # Build the down-leg: high -> low monotonically (with noise)
        down_bars = max(2, contraction_bars - 2)
        for j in range(down_bars):
            frac = (j + 1) / down_bars
            mid = current_high - (current_high - target_low) * frac
            v = contr_vol * rng.uniform(0.7, 1.1)
            # Last bar should be at the low
            if j == down_bars - 1:
                bars.append(_make_bar(t, mid, v, rng, noise=0.08, force_low=target_low))
            else:
                bars.append(_make_bar(t, mid, v, rng, noise=0.12))
            t += DT

        # Rally back toward next high (which is the NEXT contraction's start)
        is_last = (i == len(contractions) - 1)
        if is_last:
            # End the series here (after optional tail or pivot break)
            # Add the final pivot high bar so the last contraction's pivot is detectable.
            # Actually — the pivot for THIS contraction is current_high (already in series).
            # The detector reads the high anchor we built above as the pivot for the final
            # contraction. So we just stop here.
            # Optional final_tail_bars: hover inside the contraction range below pivot
            for k in range(final_tail_bars):
                mid = target_low * 1.01 + rng.uniform(-0.10, 0.10)
                v = contr_vol * 0.7 * rng.uniform(0.8, 1.1)
                bars.append(_make_bar(t, mid, v, rng, noise=0.10))
                t += DT
            if pivot_breakout:
                mid = current_high * 1.02
                v = base_vol * 2.5
                bars.append(_make_bar(t, mid, v, rng, noise=0.10,
                                      force_high=current_high * 1.03))
                t += DT
                for k in range(sustained_above_pivot_bars):
                    mid = current_high * 1.03
                    v = base_vol * 2.0
                    bars.append(_make_bar(t, mid, v, rng, noise=0.10))
                    t += DT
            break

        # Rally back up — slightly below or at prior high
        next_high = current_high * rng.uniform(0.995, 1.005)
        rally_bars = max(2, rally_bars_between)
        for j in range(rally_bars):
            frac = (j + 1) / rally_bars
            mid = target_low + (next_high - target_low) * frac
            # Rally volume bumps a bit
            v = contr_vol * 1.3 * rng.uniform(0.8, 1.1)
            bars.append(_make_bar(t, mid, v, rng, noise=0.10))
            t += DT
        current_high = next_high

    return bars


def _build_flat_bars(n_bars=60, price=50.0, base_vol=1000.0, seed=1):
    """Build a flat, noise-only series."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    for i in range(n_bars):
        bars.append(_make_bar(t, price + rng.uniform(-0.5, 0.5), base_vol, rng, noise=0.30))
        t += 86400
    return bars


def _build_expanding_bars(seed=1):
    """Build a sequence where contractions are EXPANDING (opposite of VCP)."""
    return _build_vcp_bars(
        contractions=[(0.06, 5), (0.12, 6), (0.20, 8)],  # expanding
        volume_ratios=[0.3, 0.6, 1.0],
        seed=seed,
    )


def _build_no_uptrend_bars(seed=1):
    """Build VCP geometry but inside a downtrend (no prior advance)."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    # Start with a long DOWNTREND
    price = 100.0
    for i in range(40):
        price *= 0.985
        bars.append(_make_bar(t, price, 1500, rng, noise=0.30))
        t += DT
    # Then a tiny tightening sequence at the bottom — but no prior advance
    for high, low_pct in [(price * 1.02, 0.15), (price * 1.01, 0.08), (price * 1.005, 0.04)]:
        # high bar
        bars.append(_make_bar(t, high * 0.99, 1200, rng, noise=0.08, force_high=high))
        t += DT
        # decline
        for j in range(5):
            mid = high - (high - high * (1.0 - low_pct)) * (j + 1) / 5
            bars.append(_make_bar(t, mid, 800, rng, noise=0.10))
            t += DT
        # rally
        for j in range(5):
            mid = high * (1.0 - low_pct) + ((high * 1.01) - high * (1.0 - low_pct)) * (j + 1) / 5
            bars.append(_make_bar(t, mid, 700, rng, noise=0.10))
            t += DT
    return bars


def _build_volume_expanding_bars(seed=1):
    """VCP geometry but with EXPANDING volume through the sequence (bearish)."""
    return _build_vcp_bars(
        contractions=[(0.25, 8), (0.12, 6), (0.06, 5)],
        volume_ratios=[0.4, 0.7, 1.2],  # rising volume
        seed=seed,
    )


def _build_one_contraction_bars(seed=1):
    """Only ONE clear contraction — not a sequence."""
    return _build_vcp_bars(
        contractions=[(0.20, 10)],
        seed=seed,
    )


def _build_choppy_no_pattern_bars(seed=1):
    """Random chop with no consistent contractions or trend."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 50.0
    for i in range(70):
        # Wide random moves
        price += rng.uniform(-2.0, 2.0)
        bars.append(_make_bar(t, price, 1000, rng, noise=0.50))
        t += DT
    return bars


def _write(name, category, bars, context, expected):
    payload = {
        "name": name,
        "category": category,
        "expected": expected,
        "context": context,
        "bars": bars,
    }
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


# Standard "good" context for positive fixtures
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

# Bad context for negative fixtures requiring it
BAD_CONTEXT_DOWNTREND = {
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

# Neutral context (built by detector)
NO_CONTEXT = None


def main():
    # ===== 5 POSITIVE — must fire with min confidence =====
    _write("clean_3_contractions", "positive",
           _build_vcp_bars(
               contractions=[(0.25, 8), (0.12, 6), (0.06, 5)],
               volume_ratios=[0.9, 0.55, 0.25],
               seed=1),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "trendline_pair"})

    _write("clean_4_contractions", "positive",
           _build_vcp_bars(
               contractions=[(0.28, 9), (0.15, 7), (0.08, 5), (0.04, 4)],
               volume_ratios=[1.0, 0.6, 0.35, 0.18],
               seed=2),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 65.0, "max_confidence": 100.0,
            "geometry_shape": "trendline_pair"})

    _write("extended_vcp", "positive",
           _build_vcp_bars(
               prior_advance_bars=50,
               prior_advance_pct=0.50,
               contractions=[(0.22, 10), (0.12, 8), (0.06, 6)],
               volume_ratios=[1.0, 0.55, 0.22],
               rally_bars_between=8,
               seed=3),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    _write("tight_pivot", "positive",
           _build_vcp_bars(
               contractions=[(0.25, 8), (0.10, 5), (0.03, 4)],
               volume_ratios=[1.0, 0.5, 0.20],
               seed=4),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 65.0, "max_confidence": 100.0})

    _write("high_volume_contraction", "positive",
           _build_vcp_bars(
               contractions=[(0.30, 9), (0.14, 7), (0.06, 5)],
               volume_ratios=[1.2, 0.40, 0.10],  # dramatic dry-up
               seed=5),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 65.0, "max_confidence": 100.0})

    # ===== 8 NEGATIVE — must NOT fire (or <50) =====
    _write("flat_data", "negative",
           _build_flat_bars(n_bars=70, seed=10),
           GOOD_CONTEXT,
           {"fires": False})

    _write("expanding_contractions", "negative",
           _build_expanding_bars(seed=11),
           GOOD_CONTEXT,
           {"fires": False})

    _write("only_one_contraction", "negative",
           _build_one_contraction_bars(seed=12),
           GOOD_CONTEXT,
           {"fires": False})

    _write("no_uptrend", "negative",
           _build_no_uptrend_bars(seed=13),
           BAD_CONTEXT_DOWNTREND,
           {"fires": False})

    _write("volume_expanding", "negative",
           _build_volume_expanding_bars(seed=14),
           GOOD_CONTEXT,
           {"fires": False})

    _write("rs_negative", "negative",
           _build_vcp_bars(
               contractions=[(0.25, 8), (0.12, 6), (0.06, 5)],
               volume_ratios=[1.0, 0.5, 0.2],
               seed=15),
           {
               "trend_stage": 4,
               "rs_trend": "down",
               "ma_alignment": "stacked_bearish",
               "volume_signature": "expanding",
               "regime": "bearish",
               "nearest_resistance": None,
               "nearest_support": None,
               "days_to_earnings": None,
               "sector_strength_rank": None,
           },
           {"fires": False})

    _write("choppy_no_pattern", "negative",
           _build_choppy_no_pattern_bars(seed=16),
           GOOD_CONTEXT,
           {"fires": False})

    _write("already_broken", "negative",
           _build_vcp_bars(
               contractions=[(0.25, 8), (0.12, 6), (0.06, 5)],
               volume_ratios=[1.0, 0.5, 0.2],
               pivot_breakout=True,
               sustained_above_pivot_bars=8,  # well past the breakout, sustained
               seed=17),
           GOOD_CONTEXT,
           {"fires": False})

    # ===== 2 EDGE — boundary of validity =====
    _write("boundary_2_contractions", "edge",
           _build_vcp_bars(
               contractions=[(0.22, 8), (0.09, 6)],  # exactly 2 contractions
               volume_ratios=[1.0, 0.45],
               seed=20),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    _write("boundary_final_pct", "edge",
           _build_vcp_bars(
               contractions=[(0.25, 8), (0.14, 7), (0.09, 6)],  # final at 9%
               volume_ratios=[1.0, 0.5, 0.25],
               seed=21),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
