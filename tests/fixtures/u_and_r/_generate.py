"""One-shot generator for the u_and_r fixture battery.

Run: python tests/fixtures/u_and_r/_generate.py

An Undercut & Rally is:
  - 50-SMA / prior swing-low / consolidation-low support level identified
  - 1-2 bars within last 8 bars close below support (red close) — undercut
  - within 1-3 bars after, a bar closes BACK ABOVE support — rally
  - prior 8+ bar consolidation (depth <10%) provides the structural pivot
  - rally volume > undercut volume preferred (expanding accumulation)
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _build_u_and_r(
    pre_advance_bars=15,
    pre_advance_pct=0.30,
    consol_bars=15,
    consol_price=30.0,
    consol_depth=0.04,
    undercut_bars=1,
    undercut_depth=0.015,
    rally_lag=1,             # number of bars between end of undercut and rally bar
    rally_above_pct=0.012,   # how far rally bar closes above support
    rally_vol_mult=1.8,      # rally bar volume vs undercut volume
    base_vol=1500.0,
    final_padding_bars=0,    # extra bars after rally
    final_padding_above_consol=False,  # if True, bars hold above prior_consol_high (already_broken)
    consol_low_bias_down=False,        # if True, consol low IS the support being undercut
    use_sma_support=False,             # If True, build long pre-history so 50-SMA value sits at consol level
    counter_trend=False,               # downtrend leading in (Stage 4 setup)
    skip_rally=False,                  # negative case: no rally bar at all
    rally_below_support=False,         # negative case: rally bar closes still below support
    too_deep=False,                    # too-deep undercut
    no_consolidation=False,            # random walk before undercut
    seed=42,
):
    """Build a synthetic OHLCV series. Phases:
      0. (optional long pre-history for 50-SMA to anchor)
      1. Pre-advance rise (uptrend before consolidation)
      2. Consolidation (bounded range — provides prior_consolidation_high pivot)
      3. Undercut bars (1-2 bars below support)
      4. Rally bar (closes back above support — unless skip_rally or rally_below_support)
      5. Optional final padding
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400

    # Determine how much pre-history we need so that 50-SMA can be the support
    pre_history_bars = 0
    if use_sma_support:
        pre_history_bars = 60

    # ----- 0. Long flat pre-history (only when use_sma_support) -----
    if pre_history_bars > 0:
        # We want SMA50 at the undercut to be roughly equal to consol_price.
        # Hold price steady at consol_price * 0.92 (~8% below) so by the time
        # we add the advance + consolidation, SMA gradually catches up to ~consol_price.
        # Simplest: flatline at consol_price for many bars.
        for _ in range(pre_history_bars):
            c = consol_price + rng.uniform(-0.30, 0.30)
            o = consol_price + rng.uniform(-0.20, 0.20)
            h = max(c, o) + abs(rng.uniform(0, 0.30))
            l = min(c, o) - abs(rng.uniform(0, 0.30))
            v = base_vol * rng.uniform(0.85, 1.15)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += DT

    # ----- 1. Pre-advance rise (or counter-trend decline) -----
    if pre_advance_bars > 0:
        if counter_trend:
            # Stage 4 — declining trajectory into the level
            start_p = consol_price * (1.0 + pre_advance_pct)
            end_p = consol_price
        else:
            start_p = consol_price * (1.0 - pre_advance_pct)
            end_p = consol_price
        step = (end_p - start_p) / max(1, pre_advance_bars)
        for i in range(pre_advance_bars):
            mid = start_p + step * (i + 1)
            c = mid + rng.uniform(-0.15, 0.15)
            o = (start_p + step * i) + rng.uniform(-0.12, 0.12)
            h = max(c, o) + abs(rng.uniform(0, 0.25))
            l = min(c, o) - abs(rng.uniform(0, 0.25))
            v = base_vol * 1.1 * rng.uniform(0.85, 1.20)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += DT

    # ----- 2. Consolidation -----
    consol_mid = consol_price
    if no_consolidation:
        # Random walk — no bounded action
        for i in range(consol_bars):
            consol_mid *= (1.0 + rng.uniform(-0.03, 0.03))
            c = consol_mid + rng.uniform(-0.50, 0.50)
            o = consol_mid + rng.uniform(-0.50, 0.50)
            h = max(c, o) + abs(rng.uniform(0, 0.70))
            l = min(c, o) - abs(rng.uniform(0, 0.70))
            v = base_vol * rng.uniform(0.7, 1.3)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += DT
    else:
        half_depth = (consol_depth * consol_mid) / 2.0
        consol_high_target = consol_mid + half_depth
        consol_low_target = consol_mid - half_depth
        for i in range(consol_bars):
            # Oscillate inside the range
            c = rng.uniform(consol_low_target + 0.05, consol_high_target - 0.05)
            o = rng.uniform(consol_low_target + 0.05, consol_high_target - 0.05)
            h = max(c, o, consol_high_target - rng.uniform(0, 0.10))
            l = min(c, o, consol_low_target + rng.uniform(0, 0.10))
            v = base_vol * rng.uniform(0.85, 1.15)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += DT

    # The 'support' being undercut: pick the consol low
    support_price = min(b["l"] for b in bars[-consol_bars:]) if consol_bars > 0 else consol_price

    # ----- 3. Undercut bars -----
    # close < support, close < open, low < support by undercut_depth
    if too_deep:
        actual_depth = 0.06  # 6% — way too deep
    else:
        actual_depth = undercut_depth

    target_undercut_low = support_price * (1.0 - actual_depth)
    target_undercut_close = support_price * (1.0 - actual_depth * 0.5)  # close between support and low

    undercut_vol = base_vol * 1.4  # elevated on the break
    for i in range(undercut_bars):
        # Step down progressively over multiple undercut bars
        depth_progress = (i + 1) / undercut_bars
        c_target = support_price - (support_price - target_undercut_close) * depth_progress
        l_target = support_price - (support_price - target_undercut_low) * depth_progress
        o = c_target + abs(rng.uniform(0.10, 0.30))  # red bar: open above close
        c = c_target + rng.uniform(-0.05, 0.02)
        # Ensure red: close < open
        if c >= o:
            o = c + 0.20
        h = max(o, c) + abs(rng.uniform(0, 0.15))
        l = min(c, l_target) - abs(rng.uniform(0, 0.05))
        v = undercut_vol * rng.uniform(0.90, 1.10)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += DT

    # ----- 4. Rally bar -----
    # rally_lag = 1 means rally is the immediately-next bar
    # rally_lag = 2 means 1 bar in between (still below support), then rally
    intermediate_bars = max(0, rally_lag - 1)
    for j in range(intermediate_bars):
        # Hold below support but not deeper
        mid = support_price * 0.99
        c = mid + rng.uniform(-0.10, 0.05)
        o = mid + rng.uniform(-0.10, 0.10)
        h = max(c, o) + abs(rng.uniform(0, 0.15))
        l = min(c, o) - abs(rng.uniform(0, 0.10))
        v = base_vol * rng.uniform(0.85, 1.10)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += DT

    if not skip_rally:
        if rally_below_support:
            # Failed bounce attempt — close stays well below support.
            c_target = support_price * 0.985
            o = c_target - abs(rng.uniform(0.05, 0.15))
            c = c_target + rng.uniform(-0.05, 0.03)
            # Don't force green — let it be a small green/doji below support
            h = max(o, c) + abs(rng.uniform(0.05, 0.20))
            l = min(o, c) - abs(rng.uniform(0, 0.20))
        else:
            c_target = support_price * (1.0 + rally_above_pct)
            o = c_target - abs(rng.uniform(0.20, 0.50))  # green bar
            c = c_target + rng.uniform(-0.02, 0.10)
            if c <= o:
                c = o + 0.20
            h = max(o, c) + abs(rng.uniform(0.05, 0.25))
            l = min(o, c) - abs(rng.uniform(0, 0.15))
        # rally volume
        rally_v = undercut_vol * rally_vol_mult * rng.uniform(0.90, 1.10)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(rally_v, 0)})
        t += DT

    # ----- 5. Final padding -----
    if final_padding_bars > 0:
        consol_high = max(b["h"] for b in bars[-(consol_bars + undercut_bars + 5):-(undercut_bars + 1)]) if consol_bars > 0 else support_price * 1.04
        for i in range(final_padding_bars):
            if final_padding_above_consol:
                mid = consol_high * (1.03 + 0.01 * i)
            elif rally_below_support:
                # Keep padding bars BELOW support to maintain failure
                mid = support_price * 0.985
            else:
                mid = support_price * 1.005
            c = mid + rng.uniform(-0.10, 0.10)
            o = mid + rng.uniform(-0.10, 0.10)
            h = max(c, o) + abs(rng.uniform(0, 0.20))
            l = min(c, o) - abs(rng.uniform(0, 0.15))
            v = base_vol * rng.uniform(0.85, 1.15)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += DT

    return bars


def _build_random_walk(n_bars=120, base_price=50.0, seed=1):
    """Pure random walk — no clear pattern."""
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
    "ma_alignment": "mixed",
    "volume_signature": "neutral",
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
        bars = _build_u_and_r(**gen_params_or_bars)
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
           dict(pre_advance_bars=15, pre_advance_pct=0.25,
                consol_bars=15, consol_price=30.0, consol_depth=0.05,
                undercut_bars=1, undercut_depth=0.015,
                rally_lag=1, rally_above_pct=0.012,
                rally_vol_mult=1.8, seed=1,
                use_sma_support=True),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "horizontal_line"},
           context=GOOD_CONTEXT)

    _write("2_bar_undercut", "positive",
           dict(pre_advance_bars=15, pre_advance_pct=0.25,
                consol_bars=15, consol_price=40.0, consol_depth=0.05,
                undercut_bars=2, undercut_depth=0.020,
                rally_lag=1, rally_above_pct=0.014,
                rally_vol_mult=2.0, seed=2,
                use_sma_support=True),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0},
           context=GOOD_CONTEXT)

    _write("deep_undercut", "positive",
           dict(pre_advance_bars=15, pre_advance_pct=0.25,
                consol_bars=15, consol_price=50.0, consol_depth=0.05,
                undercut_bars=1, undercut_depth=0.030,
                rally_lag=1, rally_above_pct=0.018,
                rally_vol_mult=2.2, seed=3,
                use_sma_support=True),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0},
           context=GOOD_CONTEXT)

    _write("sma_support", "positive",
           dict(pre_advance_bars=15, pre_advance_pct=0.30,
                consol_bars=15, consol_price=25.0, consol_depth=0.06,
                undercut_bars=1, undercut_depth=0.012,
                rally_lag=2, rally_above_pct=0.010,
                rally_vol_mult=1.7, seed=4,
                use_sma_support=True),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0},
           context=GOOD_CONTEXT)

    _write("high_volume_rally", "positive",
           dict(pre_advance_bars=15, pre_advance_pct=0.25,
                consol_bars=15, consol_price=35.0, consol_depth=0.05,
                undercut_bars=1, undercut_depth=0.016,
                rally_lag=1, rally_above_pct=0.015,
                rally_vol_mult=3.0, seed=5,
                use_sma_support=True),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0},
           context=GOOD_CONTEXT)

    # ===== 8 NEGATIVE — must NOT fire =====
    _write("no_undercut", "negative",
           # Build series where price never goes below support
           dict(pre_advance_bars=15, pre_advance_pct=0.25,
                consol_bars=20, consol_price=30.0, consol_depth=0.04,
                undercut_bars=1, undercut_depth=0.0,  # 0% — no undercut
                rally_lag=1, rally_above_pct=0.005,
                rally_vol_mult=1.5, seed=10,
                use_sma_support=True),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("no_rally", "negative",
           dict(pre_advance_bars=15, pre_advance_pct=0.25,
                consol_bars=15, consol_price=30.0, consol_depth=0.05,
                undercut_bars=2, undercut_depth=0.020,
                rally_lag=1, rally_above_pct=0.010,
                rally_vol_mult=1.5,
                skip_rally=True, seed=11,
                use_sma_support=True),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("undercut_too_deep", "negative",
           dict(pre_advance_bars=15, pre_advance_pct=0.25,
                consol_bars=15, consol_price=30.0, consol_depth=0.05,
                undercut_bars=1, undercut_depth=0.050,
                rally_lag=1, rally_above_pct=0.010,
                rally_vol_mult=1.5,
                too_deep=True, seed=12,
                use_sma_support=True),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("no_prior_consolidation", "negative",
           dict(pre_advance_bars=20, pre_advance_pct=0.25,
                consol_bars=20, consol_price=30.0, consol_depth=0.05,
                undercut_bars=1, undercut_depth=0.015,
                rally_lag=1, rally_above_pct=0.010,
                rally_vol_mult=1.5,
                no_consolidation=True, seed=13,
                use_sma_support=True),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("rally_below_support", "negative",
           dict(pre_advance_bars=15, pre_advance_pct=0.25,
                consol_bars=15, consol_price=30.0, consol_depth=0.05,
                undercut_bars=1, undercut_depth=0.020,
                rally_lag=1, rally_above_pct=0.010,
                rally_vol_mult=1.5,
                rally_below_support=True,
                final_padding_bars=3, seed=14,
                use_sma_support=True),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("low_rally_volume", "negative",
           dict(pre_advance_bars=15, pre_advance_pct=0.25,
                consol_bars=15, consol_price=30.0, consol_depth=0.05,
                undercut_bars=1, undercut_depth=0.015,
                rally_lag=1, rally_above_pct=0.005,  # weak snap-back
                rally_vol_mult=0.25,  # very low rally volume
                seed=15,
                use_sma_support=True),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("downtrend_no_uptrend", "negative",
           dict(pre_advance_bars=15, pre_advance_pct=0.30,
                consol_bars=15, consol_price=30.0, consol_depth=0.05,
                undercut_bars=1, undercut_depth=0.018,
                rally_lag=1, rally_above_pct=0.010,
                rally_vol_mult=1.6,
                counter_trend=True, seed=16,
                use_sma_support=True),
           {"fires": False},
           context=DOWNTREND_CONTEXT)

    _write("already_broken_to_upside", "negative",
           dict(pre_advance_bars=15, pre_advance_pct=0.25,
                consol_bars=15, consol_price=30.0, consol_depth=0.05,
                undercut_bars=1, undercut_depth=0.015,
                rally_lag=1, rally_above_pct=0.020,
                rally_vol_mult=1.8,
                final_padding_bars=6, final_padding_above_consol=True,
                seed=17,
                use_sma_support=True),
           {"fires": False},
           context=GOOD_CONTEXT)

    # ===== 2 EDGE — boundaries of validity =====
    _write("boundary_min_undercut", "edge",
           dict(pre_advance_bars=15, pre_advance_pct=0.25,
                consol_bars=15, consol_price=30.0, consol_depth=0.05,
                undercut_bars=1, undercut_depth=0.0065,
                rally_lag=1, rally_above_pct=0.010,
                rally_vol_mult=1.7, seed=20,
                use_sma_support=True),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0},
           context=GOOD_CONTEXT)

    _write("boundary_max_undercut", "edge",
           dict(pre_advance_bars=15, pre_advance_pct=0.25,
                consol_bars=15, consol_price=30.0, consol_depth=0.05,
                undercut_bars=1, undercut_depth=0.038,
                rally_lag=1, rally_above_pct=0.015,
                rally_vol_mult=2.0, seed=21,
                use_sma_support=True),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0},
           context=GOOD_CONTEXT)

    print("\nDone — 15 fixtures written.")


if __name__ == "__main__":
    main()
