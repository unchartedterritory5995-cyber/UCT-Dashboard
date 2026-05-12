"""One-shot generator for the cup_handle_uct fixture battery.

Run: python tests/fixtures/cup_handle_uct/_generate.py

UCT Cup-with-Handle is O'Neil's CAN SLIM cup-handle with strict
institutional-quality filters layered on:
  - >=30% prior advance in the 60 bars before cup start
  - 30-65 bar cup with 12-35% depth (tighter than classical)
  - 5-15 bar handle (tighter than classical)
  - Handle does NOT undercut cup mid-line
  - Handle avg volume / cup avg volume <= 0.70 (hard gate)
  - Context: trend_stage == 2, ma_alignment == 'stacked_bullish'

Generator builds:
  pre_advance_base (low) -> rising trend up to left_rim (pre-advance >=30%)
  -> parabolic cup down/up -> right_rim peak -> tight handle (with low vol)
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


# ---------- Bar helpers (mirroring classical cup_handle generator) ----------


def _interp_leg(start_price, end_price, n_bars, vol_start, vol_end,
                noise=0.15, rng=None):
    bars = []
    if rng is None:
        rng = random.Random(0)
    for i in range(n_bars):
        frac = i / max(n_bars - 1, 1) if n_bars > 1 else 1.0
        mid = start_price + (end_price - start_price) * frac
        o = mid + rng.uniform(-noise, noise)
        c = mid + rng.uniform(-noise, noise)
        h = max(o, c) + abs(rng.uniform(0, noise * 1.5))
        l = min(o, c) - abs(rng.uniform(0, noise * 1.5))
        v = vol_start + (vol_end - vol_start) * frac
        v = v * rng.uniform(0.85, 1.15)
        bars.append({
            "o": round(o, 2),
            "h": round(h, 2),
            "l": round(l, 2),
            "c": round(c, 2),
            "v": round(v, 0),
        })
    return bars


def _make_peak_bar(peak_price, body_price, vol, rng, noise=0.10):
    o = body_price + rng.uniform(-noise, noise)
    c = body_price + rng.uniform(-noise, noise)
    h = peak_price + abs(rng.uniform(0, 0.05))
    l = min(o, c) - abs(rng.uniform(0, 0.15))
    return {
        "o": round(o, 2),
        "h": round(h, 2),
        "l": round(l, 2),
        "c": round(c, 2),
        "v": round(vol * rng.uniform(0.9, 1.1), 0),
    }


def _make_trough_bar(trough_price, body_price, vol, rng, noise=0.10):
    o = body_price + rng.uniform(-noise, noise)
    c = body_price + rng.uniform(-noise, noise)
    h = max(o, c) + abs(rng.uniform(0, 0.15))
    l = trough_price - abs(rng.uniform(0, 0.05))
    return {
        "o": round(o, 2),
        "h": round(h, 2),
        "l": round(l, 2),
        "c": round(c, 2),
        "v": round(vol * rng.uniform(0.9, 1.1), 0),
    }


def _make_bar_from_price(mid_price, vol, rng, noise=0.20):
    o = mid_price + rng.uniform(-noise, noise)
    c = mid_price + rng.uniform(-noise, noise)
    h = max(o, c) + abs(rng.uniform(0, noise * 1.2))
    l = min(o, c) - abs(rng.uniform(0, noise * 1.2))
    return {
        "o": round(o, 2),
        "h": round(h, 2),
        "l": round(l, 2),
        "c": round(c, 2),
        "v": round(vol * rng.uniform(0.85, 1.15), 0),
    }


def _attach_t(bar_list, start_t, dt):
    out = []
    t = start_t
    for b in bar_list:
        b2 = dict(b)
        b2["t"] = t
        out.append(b2)
        t += dt
    return out


def _build_parabolic_cup(rim_price, cup_bottom_price, n_bars, vol_start,
                         vol_mid, vol_end, noise=0.20, rng=None,
                         sharpness=1.4, right_rim_price=None):
    if rng is None:
        rng = random.Random(0)
    if right_rim_price is None:
        right_rim_price = rim_price

    bars = []
    mid_idx = (n_bars - 1) / 2.0
    half_width = mid_idx if mid_idx > 0 else 1.0

    for i in range(n_bars):
        d = (i - mid_idx) / half_width
        u = abs(d) ** sharpness
        anchor = rim_price if d <= 0 else right_rim_price
        depth = anchor - cup_bottom_price
        mid_price = anchor - depth * (1.0 - u * u)
        mid_price = mid_price + rng.uniform(-noise, noise)

        if i < n_bars / 2:
            frac = i / max(n_bars / 2, 1)
            vol = vol_start + (vol_mid - vol_start) * frac
        else:
            frac = (i - n_bars / 2) / max(n_bars / 2, 1)
            vol = vol_mid + (vol_end - vol_mid) * frac
        vol *= rng.uniform(0.85, 1.15)

        o = mid_price + rng.uniform(-noise, noise)
        c = mid_price + rng.uniform(-noise, noise)
        h = max(o, c) + abs(rng.uniform(0, noise * 1.2))
        l = min(o, c) - abs(rng.uniform(0, noise * 1.2))
        bars.append({
            "o": round(o, 2),
            "h": round(h, 2),
            "l": round(l, 2),
            "c": round(c, 2),
            "v": round(vol, 0),
        })
    return bars


# ---------- Top-level builder ----------


def _build_bars(
    pre_advance_low=10.0,         # lowest low in pre-advance phase
    pre_advance_pct=0.45,         # >=30% required for positive
    pre_advance_bars=45,          # bars in the rising-trend phase before left rim
    cup_bars=50,
    cup_depth_pct=0.22,
    rim_diff_pct=0.0,
    handle_bars=10,
    handle_depth_pct=0.06,
    handle_vol_ratio=0.55,        # handle_avg_vol / cup_avg_vol target
    seed=42,
    broken=False,
    flat=False,
    handle_too_deep=False,
    handle_too_long_bars=None,    # if set, force handle to this many bars
    cup_bars_override=None,       # for short/long fixtures
    handle_vol_too_high=False,
    handle_low_below_midline=False,
    noise=0.18,
):
    """Build a synthetic UCT cup-and-handle OHLCV series.

    Phases:
      1. Pre-advance base (3-5 bars near pre_advance_low) — anchor for advance
      2. Rising trend from pre_advance_low to left_rim_price (advance_pct%)
      3. Parabolic U cup (cup_bars total)
      4. Right rim peak
      5. Handle (pullback + recovery, low volume)
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400

    if flat:
        for i in range(80):
            mid = pre_advance_low + rng.uniform(-1.0, 1.0)
            o = mid + rng.uniform(-0.5, 0.5)
            c = mid + rng.uniform(-0.5, 0.5)
            h = max(o, c) + abs(rng.uniform(0, 0.5))
            l = min(o, c) - abs(rng.uniform(0, 0.5))
            v = 1500 * rng.uniform(0.7, 1.3)
            bars.append({
                "t": t, "o": round(o, 2), "h": round(h, 2),
                "l": round(l, 2), "c": round(c, 2), "v": round(v, 0),
            })
            t += DT
        return bars

    if cup_bars_override is not None:
        cup_bars = cup_bars_override

    # Price targets
    left_rim_price = pre_advance_low * (1.0 + pre_advance_pct)
    cup_bottom_price = left_rim_price * (1.0 - cup_depth_pct)
    right_rim_price = left_rim_price * (1.0 + rim_diff_pct)
    # Handle recovery target — stays well below the right rim so drift bars
    # don't spike up and form a new spurious swing-high pivot
    handle_recovery_target = right_rim_price * 0.94

    handle_low_price = right_rim_price * (1.0 - handle_depth_pct)
    if handle_too_deep:
        forced_depth = cup_depth_pct * 0.65
        handle_low_price = right_rim_price * (1.0 - forced_depth)
    if handle_low_below_midline:
        # Force handle low below cup mid-line
        cup_mid = cup_bottom_price + (left_rim_price - cup_bottom_price) * 0.50
        handle_low_price = cup_mid * 0.98

    # Volumes — cup section averages ~0.92 * vol_cup_avg in practice (curve
    # weighting), so we set handle volume relative to that effective average
    # plus a safety margin to land below the 0.70 gate.
    vol_cup_avg = 2000.0
    if handle_vol_too_high:
        vol_handle = vol_cup_avg * 0.90  # well above 0.70 gate
    else:
        # Adjust: effective cup avg ~ 0.92 * vol_cup_avg, so to land at
        # ratio R we set vol_handle = R * 0.92 * vol_cup_avg
        vol_handle = handle_vol_ratio * 0.92 * vol_cup_avg

    # 1. Pre-advance flat anchor (5 bars near low)
    for _ in range(5):
        mid = pre_advance_low + rng.uniform(-0.05, 0.05) * pre_advance_low
        o = mid + rng.uniform(-0.10, 0.10)
        c = mid + rng.uniform(-0.10, 0.10)
        h = max(o, c) + abs(rng.uniform(0, 0.15))
        l = min(o, c) - abs(rng.uniform(0, 0.15))
        v = 1800 * rng.uniform(0.85, 1.15)
        bars.append({
            "t": t, "o": round(o, 2), "h": round(h, 2),
            "l": round(l, 2), "c": round(c, 2), "v": round(v, 0),
        })
        t += DT

    # 2. Rising trend up to left rim — cap the rise so that the peak bar is
    # unambiguously the highest point (clean swing-high for fractal detector).
    rise_start = bars[-1]["c"]
    rise_end = left_rim_price * 0.95
    rise = _interp_leg(rise_start, rise_end, pre_advance_bars,
                       vol_cup_avg * 1.1, vol_cup_avg,
                       noise=noise, rng=rng)
    # Cap rise highs so none approaches the peak bar
    rise_ceiling = left_rim_price * 0.96
    for b in rise:
        if b["h"] > rise_ceiling:
            b["h"] = round(rise_ceiling, 2)
        if b["o"] > rise_ceiling:
            b["o"] = round(rise_ceiling - 0.05, 2)
        if b["c"] > rise_ceiling:
            b["c"] = round(rise_ceiling - 0.05, 2)
        if b["h"] < b["c"]:
            b["h"] = round(b["c"] + 0.05, 2)
    bars.extend(_attach_t(rise, start_t=t, dt=DT))
    t = bars[-1]["t"] + DT

    # 3. Left rim peak — use larger body to make it unambiguously highest
    bars.append(dict(
        _make_peak_bar(left_rim_price, left_rim_price * 0.985,
                       vol_cup_avg, rng, noise=0.05),
        t=t,
    ))
    t += DT

    # 4. Parabolic cup interior — anchored well below the rims so no interior
    # bar accidentally exceeds the rim peaks.
    interior_bars = max(4, cup_bars - 2)
    cup_section = _build_parabolic_cup(
        rim_price=left_rim_price * 0.96,
        cup_bottom_price=cup_bottom_price,
        n_bars=interior_bars,
        vol_start=vol_cup_avg * 1.05,
        vol_mid=vol_cup_avg * 0.85,
        vol_end=vol_cup_avg * 0.95,
        noise=noise,
        rng=rng,
        sharpness=1.4,
        right_rim_price=right_rim_price * 0.96,
    )
    # Clamp cup interior highs below the rims AND lows above a floor (so the
    # actual cup depth doesn't exceed cup_depth_pct after noise).
    rim_min = min(left_rim_price, right_rim_price) * 0.97
    # Allow lows down to cup_bottom_price * 0.99 (1% buffer above target)
    cup_floor = cup_bottom_price * 0.99
    for b in cup_section:
        if b["h"] > rim_min:
            b["h"] = round(rim_min, 2)
        if b["o"] > rim_min:
            b["o"] = round(rim_min - 0.05, 2)
        if b["c"] > rim_min:
            b["c"] = round(rim_min - 0.05, 2)
        if b["l"] < cup_floor:
            b["l"] = round(cup_floor, 2)
        if b["o"] < cup_floor:
            b["o"] = round(cup_floor + 0.02, 2)
        if b["c"] < cup_floor:
            b["c"] = round(cup_floor + 0.02, 2)
        if b["h"] < b["c"]:
            b["h"] = round(b["c"] + 0.05, 2)
        if b["l"] > b["o"]:
            b["l"] = round(b["o"] - 0.05, 2)
    bars.extend(_attach_t(cup_section, start_t=t, dt=DT))
    t = bars[-1]["t"] + DT

    # 5. Right rim peak — clean swing-high
    bars.append(dict(
        _make_peak_bar(right_rim_price, right_rim_price * 0.985,
                       vol_cup_avg * 0.95, rng, noise=0.05),
        t=t,
    ))
    t += DT

    # 6. Handle
    actual_handle_bars = handle_too_long_bars if handle_too_long_bars else handle_bars
    handle_start_price = right_rim_price * 0.985

    if handle_too_long_bars is not None:
        # Build a continuously-falling handle: never recovers
        end_price = handle_low_price * 0.92
        long_leg = _interp_leg(handle_start_price, end_price,
                               actual_handle_bars,
                               vol_handle, vol_handle * 0.95,
                               noise=noise, rng=rng)
        bars.extend(_attach_t(long_leg, start_t=t, dt=DT))
        t = bars[-1]["t"] + DT
    else:
        # Place handle low at position ~30-40% of handle (well below the 70%
        # cap the detector enforces). Use lower noise and clamp drift bars so
        # nothing undercuts the explicit trough.
        pullback_bars = max(2, int(round(actual_handle_bars * 0.4)))
        drift_bars = max(2, actual_handle_bars - pullback_bars)

        handle_noise = min(noise, 0.08)  # tight handle = low noise

        pullback_leg = _interp_leg(handle_start_price,
                                   handle_low_price * 1.005,
                                   pullback_bars,
                                   vol_handle, vol_handle * 0.95,
                                   noise=handle_noise, rng=rng)
        # Force the trough at the last pullback bar
        pullback_leg[-1] = _make_trough_bar(handle_low_price,
                                            handle_low_price * 1.005,
                                            vol_handle, rng, noise=0.05)
        # Clamp pullback highs below right rim
        pb_ceiling = right_rim_price * 0.97
        for b in pullback_leg:
            if b["h"] > pb_ceiling:
                b["h"] = round(pb_ceiling, 2)
            if b["o"] > pb_ceiling:
                b["o"] = round(pb_ceiling - 0.05, 2)
            if b["c"] > pb_ceiling:
                b["c"] = round(pb_ceiling - 0.05, 2)
            if b["h"] < b["c"]:
                b["h"] = round(b["c"] + 0.05, 2)
        bars.extend(_attach_t(pullback_leg, start_t=t, dt=DT))
        t = bars[-1]["t"] + DT

        if broken:
            end_price = right_rim_price * 1.04
            drift = _interp_leg(handle_low_price * 1.04, end_price,
                                drift_bars,
                                vol_handle, vol_cup_avg * 1.5,
                                noise=handle_noise, rng=rng)
        else:
            target = max(handle_recovery_target, handle_low_price * 1.04)
            drift = _interp_leg(handle_low_price * 1.04, target,
                                drift_bars,
                                vol_handle * 0.95, vol_handle,
                                noise=handle_noise, rng=rng)
        # Clamp drift bars so they don't undercut the explicit handle low NOR
        # spike up above the right rim (which would create a spurious pivot).
        floor = handle_low_price * 1.015
        # Keep handle highs comfortably below right rim and left rim
        ceiling = min(right_rim_price * 0.97, left_rim_price * 0.97)
        if not broken:
            for b in drift:
                if b["l"] < floor:
                    b["l"] = round(floor, 2)
                if b["o"] < floor:
                    b["o"] = round(floor + 0.02, 2)
                if b["c"] < floor:
                    b["c"] = round(floor + 0.02, 2)
                if b["h"] > ceiling:
                    b["h"] = round(ceiling, 2)
                if b["o"] > ceiling:
                    b["o"] = round(ceiling - 0.05, 2)
                if b["c"] > ceiling:
                    b["c"] = round(ceiling - 0.05, 2)
                if b["h"] < b["c"]:
                    b["h"] = round(b["c"] + 0.05, 2)
                if b["l"] > b["o"]:
                    b["l"] = round(b["o"] - 0.05, 2)
        else:
            # Broken case: don't clamp ceiling, intentionally lets bars spike above
            for b in drift:
                if b["l"] < floor:
                    b["l"] = round(floor, 2)
                if b["o"] < floor:
                    b["o"] = round(floor + 0.02, 2)
                if b["c"] < floor:
                    b["c"] = round(floor + 0.02, 2)
                if b["h"] < b["c"]:
                    b["h"] = round(b["c"] + 0.05, 2)
        bars.extend(_attach_t(drift, start_t=t, dt=DT))
        t = bars[-1]["t"] + DT

    return bars


# Contexts -------------------------------------------------------------------

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


def _write(name, category, gen_params, expected, context=None):
    bars = _build_bars(**gen_params)
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
    _write("clean_textbook", "positive",
           dict(pre_advance_low=10.0, pre_advance_pct=0.45,
                pre_advance_bars=40,
                cup_bars=50, cup_depth_pct=0.22, rim_diff_pct=0.0,
                handle_bars=10, handle_depth_pct=0.06,
                handle_vol_ratio=0.60, seed=1),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "cup_curve"},
           context=GOOD_CONTEXT)

    _write("tight_handle", "positive",
           dict(pre_advance_low=12.0, pre_advance_pct=0.35,
                pre_advance_bars=35,
                cup_bars=40, cup_depth_pct=0.20, rim_diff_pct=0.0,
                handle_bars=6, handle_depth_pct=0.04,
                handle_vol_ratio=0.50, seed=2),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "cup_curve"},
           context=GOOD_CONTEXT)

    _write("deep_cup_acceptable", "positive",
           dict(pre_advance_low=8.0, pre_advance_pct=0.60,
                pre_advance_bars=40,
                cup_bars=55, cup_depth_pct=0.32, rim_diff_pct=-0.01,
                handle_bars=12, handle_depth_pct=0.10,
                handle_vol_ratio=0.55, seed=3),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "cup_curve"},
           context=GOOD_CONTEXT)

    _write("shorter_cup", "positive",
           dict(pre_advance_low=15.0, pre_advance_pct=0.30,
                pre_advance_bars=30,
                cup_bars=32, cup_depth_pct=0.18, rim_diff_pct=0.0,
                handle_bars=8, handle_depth_pct=0.05,
                handle_vol_ratio=0.55, seed=4),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "cup_curve"},
           context=GOOD_CONTEXT)

    _write("dramatic_handle_contraction", "positive",
           dict(pre_advance_low=10.0, pre_advance_pct=0.45,
                pre_advance_bars=40,
                cup_bars=45, cup_depth_pct=0.25, rim_diff_pct=0.0,
                handle_bars=7, handle_depth_pct=0.06,
                handle_vol_ratio=0.35, seed=5),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "cup_curve"},
           context=GOOD_CONTEXT)

    # ===== 8 NEGATIVE — must NOT fire =====
    _write("no_pre_advance", "negative",
           dict(pre_advance_low=10.0, pre_advance_pct=0.15,  # only 15%, below 30% gate
                pre_advance_bars=35,
                cup_bars=45, cup_depth_pct=0.22, rim_diff_pct=0.0,
                handle_bars=10, handle_depth_pct=0.06,
                handle_vol_ratio=0.55, seed=10),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("cup_too_deep", "negative",
           dict(pre_advance_low=10.0, pre_advance_pct=0.45,
                pre_advance_bars=40,
                cup_bars=50, cup_depth_pct=0.45,  # exceeds 35% cap
                rim_diff_pct=0.0,
                handle_bars=10, handle_depth_pct=0.08,
                handle_vol_ratio=0.55, seed=11),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("cup_too_short", "negative",
           dict(pre_advance_low=10.0, pre_advance_pct=0.45,
                pre_advance_bars=40,
                cup_bars_override=20,  # below 30 bar floor
                cup_bars=50, cup_depth_pct=0.22, rim_diff_pct=0.0,
                handle_bars=10, handle_depth_pct=0.06,
                handle_vol_ratio=0.55, seed=12),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("cup_too_long", "negative",
           dict(pre_advance_low=10.0, pre_advance_pct=0.45,
                pre_advance_bars=40,
                cup_bars=80,  # exceeds 65 cap
                cup_depth_pct=0.22, rim_diff_pct=0.0,
                handle_bars=10, handle_depth_pct=0.06,
                handle_vol_ratio=0.55, seed=13),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("handle_too_deep", "negative",
           dict(pre_advance_low=10.0, pre_advance_pct=0.45,
                pre_advance_bars=40,
                cup_bars=50, cup_depth_pct=0.22, rim_diff_pct=0.0,
                handle_bars=10, handle_depth_pct=0.16,
                handle_vol_ratio=0.55,
                handle_too_deep=True, seed=14),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("handle_too_long", "negative",
           dict(pre_advance_low=10.0, pre_advance_pct=0.45,
                pre_advance_bars=40,
                cup_bars=50, cup_depth_pct=0.22, rim_diff_pct=0.0,
                handle_bars=10, handle_depth_pct=0.06,
                handle_vol_ratio=0.55,
                handle_too_long_bars=20, seed=15),  # exceeds 15 cap
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("handle_volume_too_high", "negative",
           dict(pre_advance_low=10.0, pre_advance_pct=0.45,
                pre_advance_bars=40,
                cup_bars=50, cup_depth_pct=0.22, rim_diff_pct=0.0,
                handle_bars=10, handle_depth_pct=0.06,
                handle_vol_ratio=0.90,  # well above 0.70 gate
                handle_vol_too_high=True, seed=16),
           {"fires": False},
           context=GOOD_CONTEXT)

    _write("downtrend_context", "negative",
           dict(pre_advance_low=10.0, pre_advance_pct=0.45,
                pre_advance_bars=40,
                cup_bars=50, cup_depth_pct=0.22, rim_diff_pct=0.0,
                handle_bars=10, handle_depth_pct=0.06,
                handle_vol_ratio=0.55, seed=17),
           {"fires": False},
           context=DOWNTREND_CONTEXT)

    # ===== 2 EDGE — boundary of validity =====
    _write("boundary_advance", "edge",
           dict(pre_advance_low=10.0, pre_advance_pct=0.305,  # just over 30%
                pre_advance_bars=35,
                cup_bars=45, cup_depth_pct=0.20, rim_diff_pct=0.0,
                handle_bars=10, handle_depth_pct=0.06,
                handle_vol_ratio=0.60, seed=20),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "cup_curve"},
           context=GOOD_CONTEXT)

    _write("boundary_cup_depth", "edge",
           dict(pre_advance_low=10.0, pre_advance_pct=0.45,
                pre_advance_bars=40,
                cup_bars=50, cup_depth_pct=0.33,  # just inside 35% cap
                rim_diff_pct=0.0,
                handle_bars=10, handle_depth_pct=0.10,
                handle_vol_ratio=0.55, seed=21),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "cup_curve"},
           context=GOOD_CONTEXT)

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
