"""One-shot generator for the remount fixture battery.

Run: python tests/fixtures/remount/_generate.py

A remount is:
  - Stock previously broke a key level (20EMA, 50SMA, or a prior pivot)
  - Traded BELOW the level for 5-30 consecutive bars (the breakdown)
  - A bar within the last 5 closes ABOVE the level on volume >1.2x avg
  - Next bars (up to 3) hold above the level (no close < level)

The generator builds 4 phases:
  1. Pre-history (build EMA/SMA levels)
  2. Prior advance (creates the "prior high" that becomes the target ref)
  3. Breakdown (5-30 bars closing below the key level)
  4. Remount + follow-through (reclaim bar on high volume + holding bars)
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _build_remount(
    pre_history_bars=80,          # build up EMA20 / SMA50 history
    pre_history_price=30.0,
    advance_bars=25,              # the prior advance — must outlast EMA20 to push it up
    advance_pct=0.40,             # how much price advanced in the advance phase
    advance_plateau_bars=8,       # bars at the top of advance — lets EMA catch up
    breakdown_bars=12,            # number of bars below key level
    breakdown_depth_pct=0.10,     # how far below the key level price goes (MUST be deep enough to clearly below EMA)
    remount_above_pct=0.025,      # how much remount bar closes above level
    remount_vol_mult=2.0,         # remount bar volume vs avg
    follow_through_bars=3,        # number of bars after remount that hold above
    follow_through_drift=0.008,   # post-remount drift (small positive = healthy)
    base_vol=1500.0,
    skip_remount=False,           # no remount bar at all
    remount_below=False,          # remount bar fails to close above
    no_breakdown=False,           # never breaks the level
    short_breakdown=False,        # only 3 bars below (too short)
    long_breakdown=False,         # 35 bars below (too long)
    low_volume_remount=False,     # remount bar volume <1.0x avg
    counter_trend=False,          # full downtrend pre-history (Stage 4 context)
    already_extended=False,       # post-remount bars extend >5% above level
    no_follow_through=False,      # post-remount bars all close BELOW level
    seed=42,
):
    """Build a synthetic OHLCV series with a remount setup.

    The KEY trick: after the advance phase we let price plateau for a number
    of bars so the EMA20 fully catches up to the advance-peak level. Then the
    breakdown drops price CLEANLY below that EMA level by at least
    breakdown_depth_pct. The remount bar reclaims the EMA on high volume.
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400

    # ----- 1. Pre-history -----
    if counter_trend:
        start_p = pre_history_price * 1.4
        end_p = pre_history_price
        for i in range(pre_history_bars):
            mid = start_p + (end_p - start_p) * (i + 1) / max(1, pre_history_bars)
            c = mid + rng.uniform(-0.20, 0.20)
            o = mid + rng.uniform(-0.15, 0.15)
            h = max(c, o) + abs(rng.uniform(0, 0.20))
            l = min(c, o) - abs(rng.uniform(0, 0.20))
            v = base_vol * rng.uniform(0.80, 1.10)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += DT
    else:
        for i in range(pre_history_bars):
            c = pre_history_price + rng.uniform(-0.25, 0.25)
            o = pre_history_price + rng.uniform(-0.20, 0.20)
            h = max(c, o) + abs(rng.uniform(0, 0.25))
            l = min(c, o) - abs(rng.uniform(0, 0.25))
            v = base_vol * rng.uniform(0.85, 1.15)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += DT

    # ----- 2. Advance phase -----
    advance_start = pre_history_price
    advance_peak = pre_history_price * (1.0 + advance_pct)
    for i in range(advance_bars):
        mid = advance_start + (advance_peak - advance_start) * (i + 1) / max(1, advance_bars)
        c = mid + rng.uniform(-0.20, 0.20)
        o = (advance_start + (advance_peak - advance_start) * i / max(1, advance_bars)) + rng.uniform(-0.15, 0.15)
        h = max(c, o) + abs(rng.uniform(0, 0.30))
        l = min(c, o) - abs(rng.uniform(0, 0.30))
        v = base_vol * 1.15 * rng.uniform(0.85, 1.20)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += DT

    # Snapshot the prior high
    prior_high = max(b["h"] for b in bars[-advance_bars:])

    # ----- 2b. Plateau phase — let EMA20 catch up -----
    # Hold price near advance_peak so the EMA reaches that level.
    for i in range(advance_plateau_bars):
        c = advance_peak + rng.uniform(-0.30, 0.20)
        o = advance_peak + rng.uniform(-0.25, 0.20)
        h = max(c, o) + abs(rng.uniform(0, 0.30))
        l = min(c, o) - abs(rng.uniform(0, 0.30))
        v = base_vol * rng.uniform(0.85, 1.15)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += DT

    # The "level" for the breakdown: a price near advance_peak. The detector
    # will identify EMA20 (or SMA50 / a swing-high pivot) at the breakdown bar,
    # all of which will be at or near this level.
    level_price = advance_peak

    # ----- 3. Breakdown phase -----
    if no_breakdown:
        bd_bars_count = 0
        # Hold price above the level — no breakdown
        for i in range(15):
            c = level_price * 1.01 + rng.uniform(-0.20, 0.40)
            o = level_price * 1.01 + rng.uniform(-0.15, 0.30)
            h = max(c, o) + abs(rng.uniform(0, 0.25))
            l = min(c, o) - abs(rng.uniform(0, 0.20))
            v = base_vol * rng.uniform(0.85, 1.15)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += DT
    else:
        if short_breakdown:
            bd_bars_count = 3
        elif long_breakdown:
            bd_bars_count = 35
        else:
            bd_bars_count = breakdown_bars

        breakdown_floor = level_price * (1.0 - breakdown_depth_pct)

        for i in range(bd_bars_count):
            progress = (i + 1) / max(1, bd_bars_count)
            if progress < 0.4:
                # Drop progressively over first 40% of breakdown
                target = level_price + (breakdown_floor - level_price) * (progress / 0.4)
            else:
                # Meander near the floor
                target = breakdown_floor + rng.uniform(-0.20, 0.20)
            c = target + rng.uniform(-0.10, 0.10)
            o = target + rng.uniform(-0.10, 0.10)
            h = max(c, o) + abs(rng.uniform(0, 0.20))
            l = min(c, o) - abs(rng.uniform(0, 0.25))
            v = base_vol * 1.10 * rng.uniform(0.85, 1.15)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += DT

    # ----- 4. Remount bar -----
    if not skip_remount and not no_breakdown:
        # The remount bar must close clearly ABOVE the current EMA20.
        # Since price has been below `level_price` for many bars, the EMA20 has
        # decayed from `level_price` toward `breakdown_floor`. We target a
        # close that's CLEARLY above wherever the EMA20 might be — use
        # level_price (the original advance peak) as the safe high target.
        # That guarantees we close above the now-decayed EMA.
        if remount_below:
            # Failed reclaim — stay below where the EMA would now be
            recent_floor = bars[-1]["c"]
            c_target = recent_floor * 0.99
        else:
            # Aggressive reclaim
            c_target = level_price * (1.0 + remount_above_pct)

        prev_c = bars[-1]["c"]
        # Big green bar
        o = prev_c + rng.uniform(-0.10, 0.10)
        c = c_target + rng.uniform(-0.05, 0.05)
        if c <= o:
            c = o + 0.50
        h = c + abs(rng.uniform(0.05, 0.30))
        l = min(o, c) - abs(rng.uniform(0, 0.20))

        prev_avg_vol = sum(b["v"] for b in bars[-20:]) / 20.0
        if low_volume_remount:
            v = prev_avg_vol * 0.85
        else:
            v = prev_avg_vol * remount_vol_mult * rng.uniform(0.90, 1.10)

        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += DT

        remount_close = c

        # ----- 5. Follow-through bars -----
        if no_follow_through:
            # All post-remount bars close BELOW the previous EMA level
            for i in range(follow_through_bars):
                c_pf = level_price * 0.92  # well below level
                o_pf = bars[-1]["c"] - 0.10
                h_pf = max(o_pf, c_pf) + abs(rng.uniform(0, 0.20))
                l_pf = min(o_pf, c_pf) - abs(rng.uniform(0, 0.25))
                v_pf = base_vol * rng.uniform(0.85, 1.10)
                bars.append({"t": t, "o": round(o_pf, 2), "h": round(h_pf, 2),
                             "l": round(l_pf, 2), "c": round(c_pf, 2),
                             "v": round(v_pf, 0)})
                t += DT
        elif already_extended:
            # Post-remount bars extend rapidly far above the level
            for i in range(5):
                drift = 0.04 + 0.03 * i
                mid = level_price * (1.0 + drift)
                c_pf = mid + rng.uniform(-0.10, 0.10)
                o_pf = mid + rng.uniform(-0.10, 0.10)
                h_pf = max(o_pf, c_pf) + abs(rng.uniform(0, 0.25))
                l_pf = min(o_pf, c_pf) - abs(rng.uniform(0, 0.15))
                v_pf = base_vol * rng.uniform(0.95, 1.20)
                bars.append({"t": t, "o": round(o_pf, 2), "h": round(h_pf, 2),
                             "l": round(l_pf, 2), "c": round(c_pf, 2),
                             "v": round(v_pf, 0)})
                t += DT
        else:
            # Healthy: bars drift slightly up, all close above the level
            for i in range(follow_through_bars):
                mid = level_price * (1.0 + remount_above_pct + follow_through_drift * (i + 1))
                c_pf = mid + rng.uniform(-0.08, 0.10)
                o_pf = mid + rng.uniform(-0.08, 0.08)
                h_pf = max(o_pf, c_pf) + abs(rng.uniform(0, 0.20))
                l_pf = min(o_pf, c_pf) - abs(rng.uniform(0, 0.15))
                v_pf = base_vol * rng.uniform(0.85, 1.10)
                bars.append({"t": t, "o": round(o_pf, 2), "h": round(h_pf, 2),
                             "l": round(l_pf, 2), "c": round(c_pf, 2),
                             "v": round(v_pf, 0)})
                t += DT
    elif skip_remount:
        # Tack on a few more bars below the level (breakdown continues)
        for i in range(3):
            recent_avg = sum(b["c"] for b in bars[-5:]) / 5.0
            c_pf = recent_avg + rng.uniform(-0.10, 0.10)
            o_pf = c_pf + rng.uniform(-0.10, 0.10)
            h_pf = max(o_pf, c_pf) + abs(rng.uniform(0, 0.20))
            l_pf = min(o_pf, c_pf) - abs(rng.uniform(0, 0.25))
            v_pf = base_vol * rng.uniform(0.85, 1.10)
            bars.append({"t": t, "o": round(o_pf, 2), "h": round(h_pf, 2),
                         "l": round(l_pf, 2), "c": round(c_pf, 2),
                         "v": round(v_pf, 0)})
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


def _write(name, category, gen_params, expected, context=None):
    bars = _build_remount(**gen_params)
    payload = {
        "name": name,
        "category": category,
        "_generation": gen_params,
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
    _write("clean_20ema_reclaim", "positive",
           dict(pre_history_bars=60, pre_history_price=30.0,
                advance_bars=20, advance_pct=0.30,
                breakdown_bars=12, breakdown_depth_pct=0.06,
                remount_above_pct=0.018, remount_vol_mult=2.0,
                follow_through_bars=3, seed=1),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "horizontal_line"},
           context=GOOD_CONTEXT)

    _write("50sma_reclaim_strong", "positive",
           dict(pre_history_bars=80, pre_history_price=40.0,
                advance_bars=25, advance_pct=0.35,
                breakdown_bars=20, breakdown_depth_pct=0.08,
                remount_above_pct=0.020, remount_vol_mult=2.5,
                follow_through_bars=3, seed=2),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0},
           context=GOOD_CONTEXT)

    _write("swing_high_reclaim", "positive",
           dict(pre_history_bars=60, pre_history_price=25.0,
                advance_bars=15, advance_pct=0.40,
                breakdown_bars=15, breakdown_depth_pct=0.07,
                remount_above_pct=0.015, remount_vol_mult=1.8,
                follow_through_bars=3, seed=3),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0},
           context=GOOD_CONTEXT)

    _write("short_breakdown_quick_remount", "positive",
           dict(pre_history_bars=60, pre_history_price=35.0,
                advance_bars=20, advance_pct=0.28,
                breakdown_bars=6, breakdown_depth_pct=0.05,
                remount_above_pct=0.020, remount_vol_mult=2.2,
                follow_through_bars=3, seed=4),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0},
           context=GOOD_CONTEXT)

    _write("extended_breakdown_dramatic", "positive",
           dict(pre_history_bars=60, pre_history_price=45.0,
                advance_bars=25, advance_pct=0.32,
                breakdown_bars=28, breakdown_depth_pct=0.09,
                remount_above_pct=0.022, remount_vol_mult=2.4,
                follow_through_bars=3, seed=5),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0},
           context=GOOD_CONTEXT)

    # ===== 8 NEGATIVE — must NOT fire =====
    _write("no_breakdown", "negative",
           dict(pre_history_bars=60, pre_history_price=30.0,
                advance_bars=20, advance_pct=0.25,
                no_breakdown=True, seed=10),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("breakdown_too_short", "negative",
           dict(pre_history_bars=60, pre_history_price=30.0,
                advance_bars=20, advance_pct=0.25,
                short_breakdown=True, breakdown_depth_pct=0.05,
                remount_above_pct=0.015, remount_vol_mult=1.8,
                seed=11),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("breakdown_too_long", "negative",
           # Excessively long breakdown (35 bars) with NO remount — structural
           # damage too severe to remount cleanly. Price never reclaims the
           # level at the end of the series.
           dict(pre_history_bars=80, pre_history_price=30.0,
                advance_bars=25, advance_pct=0.40,
                advance_plateau_bars=10,
                long_breakdown=True, breakdown_depth_pct=0.18,
                skip_remount=True, seed=12),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("no_remount", "negative",
           dict(pre_history_bars=60, pre_history_price=30.0,
                advance_bars=20, advance_pct=0.25,
                breakdown_bars=15, breakdown_depth_pct=0.07,
                skip_remount=True, seed=13),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("remount_no_follow_through", "negative",
           dict(pre_history_bars=60, pre_history_price=30.0,
                advance_bars=20, advance_pct=0.25,
                breakdown_bars=12, breakdown_depth_pct=0.06,
                remount_above_pct=0.012, remount_vol_mult=1.8,
                follow_through_bars=3, no_follow_through=True, seed=14),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("low_volume_remount", "negative",
           dict(pre_history_bars=60, pre_history_price=30.0,
                advance_bars=20, advance_pct=0.25,
                breakdown_bars=12, breakdown_depth_pct=0.06,
                remount_above_pct=0.012,
                low_volume_remount=True,
                follow_through_bars=3, seed=15),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("downtrend_context", "negative",
           dict(pre_history_bars=60, pre_history_price=30.0,
                advance_bars=15, advance_pct=0.10,
                breakdown_bars=15, breakdown_depth_pct=0.08,
                remount_above_pct=0.015, remount_vol_mult=1.8,
                counter_trend=True,
                follow_through_bars=3, seed=16),
           {"fires": False},
           context=DOWNTREND_CONTEXT)

    _write("already_broken_to_upside", "negative",
           dict(pre_history_bars=60, pre_history_price=30.0,
                advance_bars=20, advance_pct=0.25,
                breakdown_bars=12, breakdown_depth_pct=0.06,
                remount_above_pct=0.015, remount_vol_mult=2.0,
                already_extended=True, seed=17),
           {"fires": False},
           context=GOOD_CONTEXT)

    # ===== 2 EDGE =====
    _write("boundary_min_breakdown", "edge",
           # 5-bar breakdown — minimum length. Use longer plateau so EMA20
           # is well-anchored at the top, and a deep breakdown to ensure
           # all 5 bars close clearly below EMA.
           dict(pre_history_bars=80, pre_history_price=30.0,
                advance_bars=25, advance_pct=0.40,
                advance_plateau_bars=15,
                breakdown_bars=5, breakdown_depth_pct=0.10,
                remount_above_pct=0.022, remount_vol_mult=2.2,
                follow_through_bars=3, seed=20),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0},
           context=GOOD_CONTEXT)

    _write("boundary_max_breakdown", "edge",
           dict(pre_history_bars=60, pre_history_price=30.0,
                advance_bars=20, advance_pct=0.30,
                breakdown_bars=30, breakdown_depth_pct=0.09,
                remount_above_pct=0.020, remount_vol_mult=2.2,
                follow_through_bars=3, seed=21),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0},
           context=GOOD_CONTEXT)

    print("\nDone — 15 fixtures written.")


if __name__ == "__main__":
    main()
