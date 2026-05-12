"""One-shot generator for the episodic_pivot fixture battery.

Run: python tests/fixtures/episodic_pivot/_generate.py

An EP is a SINGLE BAR that announces regime change after a multi-week base.
The bar shows simultaneous range expansion (>=2x avg), volume expansion
(>=2x avg), close near the high (>0.70 of bar range), and a close above
the entire base range.

Generator builds:
  prior_drift (gentle uptrend so context isn't Stage 4)
   -> base of `base_bars` length with `base_depth_pct` flatness
   -> EP bar with configurable range, volume, close_strength
   -> optional trailing bars after the EP
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _make_bar(t, mid_price, vol, rng, noise=0.20,
              force_low=None, force_high=None, force_close=None, force_open=None):
    """Build a generic OHLC bar centered on mid_price."""
    o = mid_price + rng.uniform(-noise, noise) if force_open is None else force_open
    c = mid_price + rng.uniform(-noise, noise) if force_close is None else force_close
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


def _build_ep_bars(
    base_price=50.0,
    prior_drift_bars=25,             # bars leading INTO the base (gentle uptrend)
    prior_drift_pct=0.10,            # gentle prior advance
    base_bars=25,
    base_depth_pct=0.10,             # base flatness (high-low)/high
    base_vol=1000.0,
    ep_range_ratio=3.0,              # EP bar range vs 20-bar avg
    ep_volume_ratio=4.0,             # EP bar volume vs 20-bar avg
    ep_close_strength=0.90,          # where in bar's range close lands
    ep_breaks_base=True,             # EP close above base_high?
    ep_offset_from_end=0,            # 0 = EP is most recent bar, N = N bars ago
    trailing_bars_after_ep=0,        # bars after the EP (still recent)
    seed=42,
):
    """Build a synthetic series with an Episodic Pivot structure.

    Returns a list of OHLCV bars. The 20-bar avg range/volume used by the
    detector samples from the base bars (which are tight + low-vol), so the
    EP ratios computed by the detector will closely match the inputs.
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400

    # 1. Prior drift — gentle uptrend so we're in Stage 1/2, not Stage 4
    drift_start = base_price / (1.0 + prior_drift_pct)
    if prior_drift_bars > 0:
        step = (base_price - drift_start) / prior_drift_bars
        for i in range(prior_drift_bars):
            mid = drift_start + step * (i + 1) + rng.uniform(-0.15, 0.15)
            v = base_vol * rng.uniform(0.85, 1.15)
            bars.append(_make_bar(t, mid, v, rng, noise=0.20))
            t += DT

    # 2. The base — tight oscillation around base_price
    half_range = (base_price * base_depth_pct) / 2.0
    base_top = base_price + half_range
    base_bottom = base_price - half_range

    for i in range(base_bars):
        # Oscillate randomly within the base, no trend
        mid = base_price + rng.uniform(-half_range * 0.7, half_range * 0.7)
        # Force at least a few bars to hit the actual top/bottom for tight tracking
        force_high = None
        force_low = None
        if i == base_bars // 4:
            force_high = base_top
        if i == base_bars // 2:
            force_low = base_bottom
        if i == 3 * base_bars // 4:
            force_high = base_top
        v = base_vol * rng.uniform(0.85, 1.15)
        bars.append(_make_bar(t, mid, v, rng, noise=0.10,
                              force_high=force_high, force_low=force_low))
        t += DT

    # 3. The EP bar
    # avg_range over the last 20 bars (base bars are tight, so ~0.2*base_price)
    last_20 = bars[-20:]
    avg_range = sum(b["h"] - b["l"] for b in last_20) / len(last_20)
    avg_volume = sum(b["v"] for b in last_20) / len(last_20)

    ep_range_target = avg_range * ep_range_ratio
    ep_volume_target = avg_volume * ep_volume_ratio

    # Place the EP bar so it breaks above base_top (or doesn't, per param)
    if ep_breaks_base:
        # Low at slightly above base_top, range extends above
        ep_low_target = base_top * 1.001
    else:
        # Low inside base, doesn't break
        ep_low_target = base_price - half_range * 0.3
    ep_high_target = ep_low_target + ep_range_target
    # Close position within the bar
    ep_close_target = ep_low_target + ep_range_target * ep_close_strength
    ep_open_target = ep_low_target + ep_range_target * max(0.05, ep_close_strength - 0.4)

    ep_bar = {
        "t": t,
        "o": round(ep_open_target, 2),
        "h": round(ep_high_target, 2),
        "l": round(ep_low_target, 2),
        "c": round(ep_close_target, 2),
        "v": round(ep_volume_target, 0),
    }
    bars.append(ep_bar)
    t += DT

    # 4. Optional trailing bars after the EP (still keeps EP in last _MAX_EP_AGE bars)
    for _ in range(trailing_bars_after_ep):
        mid = ep_close_target + rng.uniform(-half_range * 0.5, half_range * 0.5)
        v = avg_volume * 1.2 * rng.uniform(0.85, 1.15)
        bars.append(_make_bar(t, mid, v, rng, noise=0.25))
        t += DT

    # 5. Reorder so that, when ep_offset_from_end > 0, ep_bar is N bars from end.
    # (We already placed trailing_bars_after_ep, but a caller could request
    # a stale EP by adding many trailing bars — handle here by adding extra.)
    extra_trail = ep_offset_from_end - trailing_bars_after_ep
    if extra_trail > 0:
        for _ in range(extra_trail):
            mid = ep_close_target + rng.uniform(-half_range * 0.5, half_range * 0.5)
            v = avg_volume * 1.0 * rng.uniform(0.85, 1.15)
            bars.append(_make_bar(t, mid, v, rng, noise=0.25))
            t += DT

    return bars


def _build_random_walk_bars(n_bars=80, base_price=50.0, seed=1):
    """Random walk - no base, no EP signature."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = base_price
    for i in range(n_bars):
        price += rng.uniform(-1.5, 1.5)
        bars.append(_make_bar(t, price, 1000, rng, noise=0.40))
        t += DT
    return bars


def _build_downtrend_bars(n_bars=80, seed=1):
    """Pure downtrend — Stage 4 environment, hostile context."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 100.0
    for i in range(n_bars):
        price *= 0.985
        bars.append(_make_bar(t, price, 1500, rng, noise=0.30))
        t += DT
    # Inject a big up-bar near the end to look like an EP — but Stage 4 context
    # should reject it
    last = bars[-1]
    ep_low = last["c"]
    ep_high = ep_low * 1.10
    ep_close = ep_low + (ep_high - ep_low) * 0.92
    ep_open = ep_low + (ep_high - ep_low) * 0.30
    bars.append({
        "t": t,
        "o": round(ep_open, 2),
        "h": round(ep_high, 2),
        "l": round(ep_low, 2),
        "c": round(ep_close, 2),
        "v": 6000,
    })
    return bars


def _write(name, category, bars, context, expected, generation_info=None):
    payload = {
        "name": name,
        "category": category,
        "expected": expected,
        "context": context,
        "bars": bars,
    }
    if generation_info is not None:
        payload["_generation"] = generation_info
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


GOOD_CONTEXT = {
    "trend_stage": 2,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "expanding",
    "regime": "bullish",
    "nearest_resistance": None,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}

NEUTRAL_CONTEXT = {
    "trend_stage": 1,
    "rs_trend": "flat",
    "ma_alignment": "mixed",
    "volume_signature": "neutral",
    "regime": "neutral",
    "nearest_resistance": None,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}

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


def main():
    # ===== 5 POSITIVE — must fire with min confidence =====
    _write("clean_textbook", "positive",
           _build_ep_bars(
               base_bars=25, base_depth_pct=0.10,
               ep_range_ratio=3.0, ep_volume_ratio=4.0,
               ep_close_strength=0.90, seed=1),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 65.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("dramatic_ep", "positive",
           _build_ep_bars(
               base_bars=25, base_depth_pct=0.08,
               ep_range_ratio=3.5, ep_volume_ratio=6.0,
               ep_close_strength=0.95, seed=2),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 75.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("small_base_strong_ep", "positive",
           _build_ep_bars(
               base_bars=15, base_depth_pct=0.08,
               ep_range_ratio=2.5, ep_volume_ratio=3.0,
               ep_close_strength=0.85, seed=3),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("long_base_modest_ep", "positive",
           _build_ep_bars(
               base_bars=50, base_depth_pct=0.12,
               ep_range_ratio=2.0, ep_volume_ratio=2.2,
               ep_close_strength=0.85, seed=4),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})

    _write("context_perfect", "positive",
           _build_ep_bars(
               base_bars=30, base_depth_pct=0.10,
               ep_range_ratio=3.2, ep_volume_ratio=4.5,
               ep_close_strength=0.92, seed=5),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 75.0, "max_confidence": 100.0})

    # ===== 8 NEGATIVE — must NOT fire (or <50) =====
    _write("no_base", "negative",
           _build_random_walk_bars(n_bars=80, seed=10),
           GOOD_CONTEXT,
           {"fires": False})

    _write("base_too_deep", "negative",
           _build_ep_bars(
               base_bars=25, base_depth_pct=0.40,   # 40% depth - way too deep
               ep_range_ratio=3.0, ep_volume_ratio=4.0,
               ep_close_strength=0.90, seed=11),
           GOOD_CONTEXT,
           {"fires": False})

    _write("ep_range_too_small", "negative",
           _build_ep_bars(
               base_bars=25, base_depth_pct=0.10,
               ep_range_ratio=1.5,                # below 2x gate
               ep_volume_ratio=4.0, ep_close_strength=0.90, seed=12),
           GOOD_CONTEXT,
           {"fires": False})

    _write("ep_volume_too_low", "negative",
           _build_ep_bars(
               base_bars=25, base_depth_pct=0.10,
               ep_range_ratio=3.0, ep_volume_ratio=1.6,  # below 2x gate
               ep_close_strength=0.90, seed=13),
           GOOD_CONTEXT,
           {"fires": False})

    _write("close_too_weak", "negative",
           _build_ep_bars(
               base_bars=25, base_depth_pct=0.10,
               ep_range_ratio=3.0, ep_volume_ratio=4.0,
               ep_close_strength=0.40,            # close in middle - below 0.70
               seed=14),
           GOOD_CONTEXT,
           {"fires": False})

    _write("close_below_base", "negative",
           _build_ep_bars(
               base_bars=25, base_depth_pct=0.10,
               ep_range_ratio=3.0, ep_volume_ratio=4.0,
               ep_close_strength=0.85, ep_breaks_base=False,  # stays inside base
               seed=15),
           GOOD_CONTEXT,
           {"fires": False})

    _write("ep_not_recent", "negative",
           _build_ep_bars(
               base_bars=25, base_depth_pct=0.10,
               ep_range_ratio=3.0, ep_volume_ratio=4.0,
               ep_close_strength=0.90,
               trailing_bars_after_ep=12,           # EP is now 12 bars from end - too stale
               seed=16),
           GOOD_CONTEXT,
           {"fires": False})

    _write("downtrend_stage_4", "negative",
           _build_downtrend_bars(n_bars=60, seed=17),
           BAD_CONTEXT_DOWNTREND,
           {"fires": False})

    # ===== 2 EDGE — boundary of validity =====
    _write("boundary_range", "edge",
           _build_ep_bars(
               base_bars=25, base_depth_pct=0.10,
               ep_range_ratio=2.0,                # exactly 2.0x — minimum
               ep_volume_ratio=2.5,
               ep_close_strength=0.80, seed=20),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    _write("boundary_volume", "edge",
           _build_ep_bars(
               base_bars=25, base_depth_pct=0.10,
               ep_range_ratio=2.5, ep_volume_ratio=2.0,  # exactly 2.0x — minimum
               ep_close_strength=0.85, seed=21),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
