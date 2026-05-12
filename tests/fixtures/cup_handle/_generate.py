"""One-shot generator for the cup_handle fixture battery.

Run: python tests/fixtures/cup_handle/_generate.py

A cup-and-handle is a bullish continuation pattern: a smooth rounded U-shaped
bottom (the cup) followed by a tight pullback consolidation (the handle).

Generator builds a synthetic OHLCV series:
  preamble (rising trend) -> left_rim peak -> parabolic cup down then up
  -> right_rim peak -> handle pullback + sideways
"""
import json
import math
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _interp_leg(start_price, end_price, n_bars, vol_start, vol_end,
                noise=0.15, rng=None):
    """Build n_bars interpolated bars from start_price to end_price linearly."""
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
    """Build a single 'peak' bar whose high reaches peak_price."""
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
    """Build a single 'trough' bar whose low reaches trough_price."""
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
    """Build a generic OHLC bar centered on mid_price."""
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
    """Attach timestamp `t` to each bar (in-place build new list)."""
    out = []
    t = start_t
    for b in bar_list:
        b2 = dict(b)
        b2["t"] = t
        out.append(b2)
        t += dt
    return out


def _build_parabolic_cup(rim_price, cup_bottom_price, n_bars, vol_start,
                         vol_mid, vol_end, noise=0.20, rng=None, sharpness=1.0,
                         right_rim_price=None):
    """Build the cup section as a smooth parabolic U.

    Goes from rim_price (left side) down to cup_bottom_price at midpoint
    and back up to right_rim_price (defaults to rim_price). The ascending
    side uses the right rim as the asymptote so the bars stop below the
    intended right rim peak.

    sharpness=1.0 -> smooth U (concave up quadratic).
    sharpness>1.0 -> flatter near bottom (more rounded).
    sharpness<1.0 -> sharper V-ish near bottom.
    """
    if rng is None:
        rng = random.Random(0)
    if right_rim_price is None:
        right_rim_price = rim_price

    bars = []
    mid_idx = (n_bars - 1) / 2.0
    half_width = mid_idx if mid_idx > 0 else 1.0

    for i in range(n_bars):
        # Normalised distance from middle in [-1, 1]
        d = (i - mid_idx) / half_width
        u = abs(d) ** sharpness

        # Asymmetric U: left side anchored at rim_price, right side at right_rim_price.
        # rim_at_distance(d) = rim_price (d<0) or right_rim_price (d>0); blend
        # linearly so the shape transitions smoothly.
        if d <= 0:
            anchor = rim_price
        else:
            anchor = right_rim_price
        depth = anchor - cup_bottom_price
        # smooth U: price = anchor - depth * (1 - u^2)
        mid_price = anchor - depth * (1.0 - u * u)

        # Add gentle noise (small relative to depth) to keep U-shape recognizable
        mid_price = mid_price + rng.uniform(-noise, noise)

        # Volume ramps from vol_start at edges to vol_mid at bottom (cup low vol)
        # and back up. We blend down then up.
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


def _build_v_cup(rim_price, cup_bottom_price, n_bars, vol_start, vol_mid,
                 vol_end, noise=0.20, rng=None):
    """Build a SHARP V-shape (negative quadratic / inverted). Used for negative
    fixture: a V-bottom should fail the roundness test.
    """
    if rng is None:
        rng = random.Random(0)

    bars = []
    mid_idx = (n_bars - 1) // 2

    for i in range(n_bars):
        if i <= mid_idx:
            frac = i / max(mid_idx, 1)
            mid_price = rim_price + (cup_bottom_price - rim_price) * frac
        else:
            frac = (i - mid_idx) / max(n_bars - 1 - mid_idx, 1)
            mid_price = cup_bottom_price + (rim_price - cup_bottom_price) * frac
        mid_price += rng.uniform(-noise, noise)

        if i < n_bars / 2:
            f = i / max(n_bars / 2, 1)
            vol = vol_start + (vol_mid - vol_start) * f
        else:
            f = (i - n_bars / 2) / max(n_bars / 2, 1)
            vol = vol_mid + (vol_end - vol_mid) * f
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


def _build_bars(base_price=100.0,
                cup_bars=50,
                cup_depth_pct=0.25,
                rim_diff_pct=0.0,
                handle_bars=10,
                handle_depth_pct=0.08,
                preamble_bars=10,
                trailing_handle_bars=0,
                volume_pattern="contracting",
                seed=42,
                broken=False,
                flat=False,
                v_shape=False,
                rim_only_left=False,
                handle_too_deep=False,
                handle_too_long=False,
                cup_too_short=False,
                noise=0.20):
    """Build a synthetic cup-and-handle OHLCV series.

    Args:
      base_price: starting price (rim level approx)
      cup_bars: bars across the cup (left rim to right rim, inclusive)
      cup_depth_pct: depth of cup as fraction of left_rim
      rim_diff_pct: signed delta applied to right_rim relative to left_rim
                    (e.g. -0.03 = right 3% lower than left)
      handle_bars: bars in the handle
      handle_depth_pct: handle low depth as fraction of right_rim
      preamble_bars: bars of rising trend before left rim
      trailing_handle_bars: extra bars AFTER the handle window (sideways)
      volume_pattern: "contracting" / "strong_contracting" / "flat" / "expanding"
      broken: trailing closes punch above right rim
      flat: noisy flat data
      v_shape: build V-shape cup instead of U (should fail roundness)
      rim_only_left: pattern stops after cup bottom — no proper right rim
      handle_too_deep: force handle deeper than 50% of cup depth
      handle_too_long: force handle to 30 bars (over 25 max)
      cup_too_short: force cup to ~20 bars (under 30 min)
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    dt = 86400

    if flat:
        for i in range(80):
            mid = base_price + rng.uniform(-1.0, 1.0)
            o = mid + rng.uniform(-0.5, 0.5)
            c = mid + rng.uniform(-0.5, 0.5)
            h = max(o, c) + abs(rng.uniform(0, 0.5))
            l = min(o, c) - abs(rng.uniform(0, 0.5))
            v = 1500 * rng.uniform(0.7, 1.3)
            bars.append({
                "t": t, "o": round(o, 2), "h": round(h, 2),
                "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)
            })
            t += dt
        return bars

    # Volume schedule
    if volume_pattern == "contracting":
        vol_pre = 2000.0
        vol_left_rim = 2200.0
        vol_cup_mid = 1500.0   # cup bottom: low volume (no panic)
        vol_right_rim = 1300.0
        vol_handle = 900.0     # very dry through handle
        vol_trail = 1000.0
    elif volume_pattern == "strong_contracting":
        vol_pre = 2500.0
        vol_left_rim = 2800.0
        vol_cup_mid = 1500.0
        vol_right_rim = 1100.0
        vol_handle = 600.0
        vol_trail = 700.0
    elif volume_pattern == "expanding":
        vol_pre = 1000.0
        vol_left_rim = 1200.0
        vol_cup_mid = 1600.0
        vol_right_rim = 2000.0
        vol_handle = 2400.0
        vol_trail = 2500.0
    else:  # flat-vol
        vol_pre = vol_left_rim = vol_cup_mid = vol_right_rim = vol_handle = vol_trail = 1500.0

    # Allow short-cup override (negative fixture)
    if cup_too_short:
        cup_bars = 18

    # Price levels
    left_rim_price = base_price
    cup_bottom_price = base_price * (1.0 - cup_depth_pct)
    right_rim_price = base_price * (1.0 + rim_diff_pct)

    if handle_too_long:
        # Handle is built so that the pullback keeps going for 35+ bars
        # without recovery — at bar 25 (detector cap) it's still falling.
        handle_bars = 35
    handle_low_price = right_rim_price * (1.0 - handle_depth_pct)
    if handle_too_deep:
        # Force handle depth > 50% of cup depth.
        forced_depth = cup_depth_pct * 0.65
        handle_low_price = right_rim_price * (1.0 - forced_depth)

    # 1. Preamble: gentle rise into left rim
    pre_start = base_price * 0.92
    pre_end = base_price * 0.99  # land just below left rim
    preamble = _interp_leg(pre_start, pre_end, preamble_bars,
                           vol_pre * 0.9, vol_pre,
                           noise=noise, rng=rng)
    bars.extend(_attach_t(preamble, start_t=t, dt=dt))
    t = bars[-1]["t"] + dt if bars else t

    # 2. Left rim peak bar — must be a swing-high
    bars.append(dict(_make_peak_bar(left_rim_price,
                                     left_rim_price * 0.99,
                                     vol_left_rim, rng,
                                     noise=0.10), t=t))
    t += dt

    if rim_only_left:
        # Drift down then sideways — no proper right rim formation
        for i in range(40):
            mid = left_rim_price * (1.0 - 0.05 - 0.001 * i)
            b = _make_bar_from_price(mid, vol_cup_mid, rng, noise=noise)
            b["t"] = t
            bars.append(b)
            t += dt
        return bars

    # 3. Cup section: parabolic U from below left rim, down to bottom,
    #    back up to below right rim.
    # We use cup_bars - 2 interior bars (rims are placed as separate peak bars).
    interior_bars = max(4, cup_bars - 2)
    # Use a sharpness > 1.0 for rounder U (default 1.4); v_shape uses different generator.
    if v_shape:
        cup_section = _build_v_cup(
            rim_price=left_rim_price * 0.985,
            cup_bottom_price=cup_bottom_price,
            n_bars=interior_bars,
            vol_start=vol_left_rim * 0.85,
            vol_mid=vol_cup_mid,
            vol_end=vol_right_rim * 0.85,
            noise=noise,
            rng=rng,
        )
    else:
        cup_section = _build_parabolic_cup(
            rim_price=left_rim_price * 0.985,
            cup_bottom_price=cup_bottom_price,
            n_bars=interior_bars,
            vol_start=vol_left_rim * 0.85,
            vol_mid=vol_cup_mid,
            vol_end=vol_right_rim * 0.85,
            noise=noise,
            rng=rng,
            sharpness=1.4,
            right_rim_price=right_rim_price * 0.985,
        )
    bars.extend(_attach_t(cup_section, start_t=t, dt=dt))
    t = bars[-1]["t"] + dt

    # 4. Right rim peak bar — swing-high near top of cup
    bars.append(dict(_make_peak_bar(right_rim_price,
                                     right_rim_price * 0.99,
                                     vol_right_rim, rng,
                                     noise=0.10), t=t))
    t += dt

    # 5. Handle: smooth pullback with a clear low, then drift sideways
    # Handle starts just below right rim, goes down to handle_low at midpoint,
    # then drifts back up but staying below the right rim.
    handle_start_price = right_rim_price * 0.985
    handle_end_price = right_rim_price * 0.97  # drift back up but below rim

    if handle_too_long:
        # Pathological handle: continuous slow decline across all handle_bars,
        # never bottoms within the detector's 25-bar cap. End price below
        # handle_low so the detector sees a still-falling handle.
        end_price = handle_low_price * 0.92
        long_handle_leg = _interp_leg(handle_start_price, end_price,
                                        handle_bars,
                                        vol_right_rim * 0.7, vol_handle,
                                        noise=noise, rng=rng)
        bars.extend(_attach_t(long_handle_leg, start_t=t, dt=dt))
        t = bars[-1]["t"] + dt
    else:
        # Pullback half
        pullback_bars = max(2, handle_bars // 2)
        pullback_leg = _interp_leg(handle_start_price, handle_low_price * 1.01,
                                    pullback_bars,
                                    vol_right_rim * 0.7, vol_handle,
                                    noise=noise, rng=rng)
        # Last pullback bar = low
        pullback_leg[-1] = _make_trough_bar(handle_low_price,
                                              handle_low_price * 1.01,
                                              vol_handle, rng, noise=0.10)
        bars.extend(_attach_t(pullback_leg, start_t=t, dt=dt))
        t = bars[-1]["t"] + dt

        # Drift back up half
        drift_bars = max(2, handle_bars - pullback_bars)
        if broken:
            # Punch closes above right_rim
            end_price = right_rim_price * 1.04
            drift_leg = _interp_leg(handle_low_price * 1.02, end_price, drift_bars,
                                     vol_handle, vol_trail * 1.5,
                                     noise=noise, rng=rng)
        else:
            # Stay below right_rim
            target = min(handle_end_price, right_rim_price * 0.985)
            target = max(target, handle_low_price * 1.005)
            drift_leg = _interp_leg(handle_low_price * 1.02, target, drift_bars,
                                     vol_handle, vol_handle * 1.1,
                                     noise=noise, rng=rng)
        bars.extend(_attach_t(drift_leg, start_t=t, dt=dt))
        t = bars[-1]["t"] + dt

    # 6. Optional trailing sideways bars (after handle window closes)
    if trailing_handle_bars > 0:
        last_price = bars[-1]["c"]
        for i in range(trailing_handle_bars):
            b = _make_bar_from_price(last_price, vol_handle, rng, noise=noise)
            b["t"] = t
            bars.append(b)
            t += dt

    return bars


def _write(name, category, gen_params, expected):
    bars = _build_bars(**gen_params)
    payload = {
        "name": name,
        "category": category,
        "_generation": gen_params,
        "expected": expected,
        "bars": bars,
    }
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


def main():
    # 5 POSITIVE -----------------------------------------------------------------
    _write("clean_textbook", "positive",
           dict(base_price=100.0, cup_bars=50, cup_depth_pct=0.25,
                rim_diff_pct=0.0, handle_bars=12, handle_depth_pct=0.08,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting", seed=1),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "cup_curve"})

    _write("shallow_cup", "positive",
           dict(base_price=100.0, cup_bars=45, cup_depth_pct=0.15,
                rim_diff_pct=0.0, handle_bars=10, handle_depth_pct=0.05,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting", seed=2),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "cup_curve"})

    _write("long_cup", "positive",
           dict(base_price=80.0, cup_bars=90, cup_depth_pct=0.28,
                rim_diff_pct=-0.01, handle_bars=14, handle_depth_pct=0.07,
                preamble_bars=10, trailing_handle_bars=0,
                volume_pattern="contracting", seed=3),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "cup_curve"})

    _write("tight_handle", "positive",
           dict(base_price=120.0, cup_bars=50, cup_depth_pct=0.22,
                rim_diff_pct=0.0, handle_bars=10, handle_depth_pct=0.04,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="strong_contracting", seed=4),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "cup_curve"})

    _write("very_round", "positive",
           dict(base_price=150.0, cup_bars=60, cup_depth_pct=0.25,
                rim_diff_pct=0.0, handle_bars=12, handle_depth_pct=0.07,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="strong_contracting", seed=5,
                noise=0.08),  # extra-clean / low noise
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "cup_curve"})

    # 8 NEGATIVE -----------------------------------------------------------------
    _write("flat_data", "negative",
           dict(flat=True, seed=10),
           {"fires": False})

    _write("v_shape_cup", "negative",
           # sharp V-shape instead of round U; should fail roundness test
           dict(base_price=100.0, cup_bars=50, cup_depth_pct=0.25,
                rim_diff_pct=0.0, handle_bars=12, handle_depth_pct=0.07,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting", v_shape=True, seed=11),
           {"fires": False})

    _write("cup_too_shallow", "negative",
           # 8% depth, well below 12% floor
           dict(base_price=100.0, cup_bars=50, cup_depth_pct=0.08,
                rim_diff_pct=0.0, handle_bars=10, handle_depth_pct=0.03,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting", seed=12),
           {"fires": False})

    _write("cup_too_deep", "negative",
           # 60% depth, above 50% ceiling
           dict(base_price=100.0, cup_bars=50, cup_depth_pct=0.60,
                rim_diff_pct=0.0, handle_bars=12, handle_depth_pct=0.06,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting", seed=13),
           {"fires": False})

    _write("rims_mismatched", "negative",
           # right rim 8% lower than left — exceeds 5% threshold
           dict(base_price=100.0, cup_bars=50, cup_depth_pct=0.25,
                rim_diff_pct=-0.08, handle_bars=12, handle_depth_pct=0.06,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting", seed=14),
           {"fires": False})

    _write("handle_too_deep", "negative",
           # handle depth > 50% of cup depth
           dict(base_price=100.0, cup_bars=50, cup_depth_pct=0.25,
                rim_diff_pct=0.0, handle_bars=12, handle_depth_pct=0.18,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting",
                handle_too_deep=True, seed=15),
           {"fires": False})

    _write("handle_too_long", "negative",
           # Handle never bottoms in 25 bars — keeps falling. Detector should
           # not fire because the pullback hasn't resolved.
           dict(base_price=100.0, cup_bars=50, cup_depth_pct=0.25,
                rim_diff_pct=0.0, handle_bars=12, handle_depth_pct=0.08,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting",
                handle_too_long=True, seed=16),
           {"fires": False})

    _write("already_broken", "negative",
           # trailing closes punch above right_rim
           dict(base_price=100.0, cup_bars=50, cup_depth_pct=0.25,
                rim_diff_pct=0.0, handle_bars=12, handle_depth_pct=0.08,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting", broken=True, seed=17),
           {"fires": False})

    _write("cup_too_short", "negative",
           # cup < 30 bars
           dict(base_price=100.0, cup_bars=18, cup_depth_pct=0.25,
                rim_diff_pct=0.0, handle_bars=10, handle_depth_pct=0.07,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting",
                cup_too_short=True, seed=18),
           {"fires": False})

    # 2 EDGE ---------------------------------------------------------------------
    _write("boundary_min_depth", "edge",
           # cup depth ~13% (just inside the 12% floor)
           dict(base_price=100.0, cup_bars=50, cup_depth_pct=0.13,
                rim_diff_pct=0.0, handle_bars=10, handle_depth_pct=0.03,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting", seed=20),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0,
            "geometry_shape": "cup_curve"})

    _write("boundary_max_handle", "edge",
           # handle depth ~48% of cup depth (just inside 50% cap)
           # cup_depth=0.25 -> handle_depth ~ 0.115
           dict(base_price=100.0, cup_bars=50, cup_depth_pct=0.25,
                rim_diff_pct=0.0, handle_bars=12, handle_depth_pct=0.115,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting", seed=21),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0,
            "geometry_shape": "cup_curve"})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
