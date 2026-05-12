"""One-shot generator for the inverse_cup_handle fixture battery.

Run: python tests/fixtures/inverse_cup_handle/_generate.py

Inverse cup-and-handle is a bearish reversal pattern: a smooth inverted-U
dome (distribution top) followed by a small failing rally (the handle).

Generator builds a synthetic OHLCV series:
  preamble (falling trend) -> left_trough -> parabolic dome up then down
  -> right_trough -> handle rally + sideways
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


def _build_parabolic_dome(trough_price, dome_peak_price, n_bars, vol_start,
                          vol_mid, vol_end, noise=0.20, rng=None,
                          sharpness=1.0, right_trough_price=None):
    """Build the dome section as a smooth inverted parabolic U (concave down).

    Goes from trough_price (left side) UP to dome_peak_price at midpoint
    and back DOWN to right_trough_price (defaults to trough_price). The
    descending side uses the right trough as the anchor so the bars stop
    above the intended right trough low.

    sharpness=1.0 -> smooth ∩ (concave down quadratic).
    sharpness>1.0 -> flatter near apex (more rounded top).
    sharpness<1.0 -> sharper inverted-V near apex.
    """
    if rng is None:
        rng = random.Random(0)
    if right_trough_price is None:
        right_trough_price = trough_price

    bars = []
    mid_idx = (n_bars - 1) / 2.0
    half_width = mid_idx if mid_idx > 0 else 1.0

    for i in range(n_bars):
        # Normalised distance from middle in [-1, 1]
        d = (i - mid_idx) / half_width
        u = abs(d) ** sharpness

        # Asymmetric ∩: left side anchored at trough_price, right side at right_trough_price.
        if d <= 0:
            anchor = trough_price
        else:
            anchor = right_trough_price
        depth = dome_peak_price - anchor
        # smooth dome: price = anchor + depth * (1 - u^2)
        mid_price = anchor + depth * (1.0 - u * u)

        # Add gentle noise (small relative to depth) to keep dome shape recognizable
        mid_price = mid_price + rng.uniform(-noise, noise)

        # Volume: distribution patterns often have heavier volume at the top
        # (climax) and contracting toward the right. Use vol_mid at apex.
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


def _build_inverted_v_dome(trough_price, dome_peak_price, n_bars, vol_start,
                           vol_mid, vol_end, noise=0.20, rng=None):
    """Build a SHARP inverted-V (linear up then down). Used for negative
    fixture: a spike top should fail the top-width test.
    """
    if rng is None:
        rng = random.Random(0)

    bars = []
    mid_idx = (n_bars - 1) // 2

    for i in range(n_bars):
        if i <= mid_idx:
            frac = i / max(mid_idx, 1)
            mid_price = trough_price + (dome_peak_price - trough_price) * frac
        else:
            frac = (i - mid_idx) / max(n_bars - 1 - mid_idx, 1)
            mid_price = dome_peak_price + (trough_price - dome_peak_price) * frac
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
                dome_bars=50,
                dome_depth_pct=0.25,
                trough_diff_pct=0.0,
                handle_bars=10,
                handle_depth_pct=0.08,
                preamble_bars=10,
                trailing_handle_bars=0,
                volume_pattern="contracting",
                seed=42,
                broken=False,
                flat=False,
                inverted_v_shape=False,
                handle_too_high=False,
                handle_too_long=False,
                dome_too_short=False,
                noise=0.20):
    """Build a synthetic inverse cup-and-handle OHLCV series.

    Args:
      base_price: starting price (trough level approx)
      dome_bars: bars across the dome (left trough to right trough, inclusive)
      dome_depth_pct: rise of dome peak above troughs as fraction of left_trough
      trough_diff_pct: signed delta applied to right_trough relative to left_trough
      handle_bars: bars in the handle
      handle_depth_pct: handle rally height as fraction of right_trough
      preamble_bars: bars of declining trend before left trough
      trailing_handle_bars: extra bars AFTER the handle window (sideways)
      volume_pattern: "contracting" / "strong_contracting" / "flat" / "expanding"
      broken: trailing closes punch below right trough
      flat: noisy flat data
      inverted_v_shape: build inverted-V dome instead of ∩ (should fail top-width)
      handle_too_high: force handle rally to exceed dome_peak
      handle_too_long: force handle to 30 bars (over 25 max)
      dome_too_short: force dome to ~20 bars (under 30 min)
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
        vol_left_trough = 2200.0
        vol_dome_mid = 1500.0
        vol_right_trough = 1300.0
        vol_handle = 900.0
        vol_trail = 1000.0
    elif volume_pattern == "strong_contracting":
        vol_pre = 2500.0
        vol_left_trough = 2800.0
        vol_dome_mid = 1500.0
        vol_right_trough = 1100.0
        vol_handle = 600.0
        vol_trail = 700.0
    elif volume_pattern == "expanding":
        vol_pre = 1000.0
        vol_left_trough = 1200.0
        vol_dome_mid = 1600.0
        vol_right_trough = 2000.0
        vol_handle = 2400.0
        vol_trail = 2500.0
    else:  # flat-vol
        vol_pre = vol_left_trough = vol_dome_mid = vol_right_trough = vol_handle = vol_trail = 1500.0

    # Allow short-dome override (negative fixture)
    if dome_too_short:
        dome_bars = 18

    # Price levels (mirror geometry)
    left_trough_price = base_price
    dome_peak_price = base_price * (1.0 + dome_depth_pct)
    right_trough_price = base_price * (1.0 + trough_diff_pct)

    if handle_too_long:
        handle_bars = 35

    # Handle high is upward rally from right trough
    handle_high_price = right_trough_price * (1.0 + handle_depth_pct)
    if handle_too_high:
        # Force handle to exceed dome peak — invalidates pattern
        handle_high_price = dome_peak_price * 1.02

    # 1. Preamble: gentle decline INTO the left trough (mirrors cup_handle's
    # rise into the left rim). Bars before the left trough must be above it
    # so the trough bar registers as a swing-low.
    pre_start = base_price * 1.08
    pre_end = base_price * 1.01  # land just above left trough level
    preamble = _interp_leg(pre_start, pre_end, preamble_bars,
                           vol_pre * 0.9, vol_pre,
                           noise=noise, rng=rng)
    bars.extend(_attach_t(preamble, start_t=t, dt=dt))
    t = bars[-1]["t"] + dt if bars else t

    # 2. Left trough bar — must be a swing-low
    bars.append(dict(_make_trough_bar(left_trough_price,
                                       left_trough_price * 1.01,
                                       vol_left_trough, rng,
                                       noise=0.10), t=t))
    t += dt

    # 3. Dome section: parabolic ∩ from above left trough, up to peak,
    #    back down to above right trough.
    interior_bars = max(4, dome_bars - 2)
    if inverted_v_shape:
        dome_section = _build_inverted_v_dome(
            trough_price=left_trough_price * 1.015,
            dome_peak_price=dome_peak_price,
            n_bars=interior_bars,
            vol_start=vol_left_trough * 0.85,
            vol_mid=vol_dome_mid,
            vol_end=vol_right_trough * 0.85,
            noise=noise,
            rng=rng,
        )
    else:
        dome_section = _build_parabolic_dome(
            trough_price=left_trough_price * 1.015,
            dome_peak_price=dome_peak_price,
            n_bars=interior_bars,
            vol_start=vol_left_trough * 0.85,
            vol_mid=vol_dome_mid,
            vol_end=vol_right_trough * 0.85,
            noise=noise,
            rng=rng,
            sharpness=1.4,
            right_trough_price=right_trough_price * 1.015,
        )
    bars.extend(_attach_t(dome_section, start_t=t, dt=dt))
    t = bars[-1]["t"] + dt

    # 4. Right trough bar — swing-low near bottom of dome
    bars.append(dict(_make_trough_bar(right_trough_price,
                                       right_trough_price * 1.01,
                                       vol_right_trough, rng,
                                       noise=0.10), t=t))
    t += dt

    # 5. Handle: smooth rally with a clear high, then drift sideways
    handle_start_price = right_trough_price * 1.015
    handle_end_price = right_trough_price * 1.03  # drift back down but above trough

    if handle_too_long:
        # Pathological handle: continuous slow rise across all handle_bars,
        # never tops within the detector's 25-bar cap.
        end_price = handle_high_price * 1.08
        long_handle_leg = _interp_leg(handle_start_price, end_price,
                                      handle_bars,
                                      vol_right_trough * 0.7, vol_handle,
                                      noise=noise, rng=rng)
        bars.extend(_attach_t(long_handle_leg, start_t=t, dt=dt))
        t = bars[-1]["t"] + dt
    else:
        # Rally half (up to handle high)
        rally_bars = max(2, handle_bars // 2)
        rally_leg = _interp_leg(handle_start_price, handle_high_price * 0.99,
                                rally_bars,
                                vol_right_trough * 0.7, vol_handle,
                                noise=noise, rng=rng)
        # Last rally bar = high
        rally_leg[-1] = _make_peak_bar(handle_high_price,
                                       handle_high_price * 0.99,
                                       vol_handle, rng, noise=0.10)
        bars.extend(_attach_t(rally_leg, start_t=t, dt=dt))
        t = bars[-1]["t"] + dt

        # Drift back down half
        drift_bars = max(2, handle_bars - rally_bars)
        if broken:
            # Punch closes below right_trough
            end_price = right_trough_price * 0.96
            drift_leg = _interp_leg(handle_high_price * 0.98, end_price, drift_bars,
                                    vol_handle, vol_trail * 1.5,
                                    noise=noise, rng=rng)
        else:
            # Stay above right_trough
            target = max(handle_end_price, right_trough_price * 1.015)
            target = min(target, handle_high_price * 0.995)
            drift_leg = _interp_leg(handle_high_price * 0.98, target, drift_bars,
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
           dict(base_price=100.0, dome_bars=50, dome_depth_pct=0.25,
                trough_diff_pct=0.0, handle_bars=12, handle_depth_pct=0.08,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting", seed=1),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "cup_curve"})

    _write("shallow_dome", "positive",
           dict(base_price=100.0, dome_bars=45, dome_depth_pct=0.15,
                trough_diff_pct=0.0, handle_bars=10, handle_depth_pct=0.05,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting", seed=2),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "cup_curve"})

    _write("long_dome", "positive",
           dict(base_price=80.0, dome_bars=90, dome_depth_pct=0.28,
                trough_diff_pct=0.01, handle_bars=14, handle_depth_pct=0.07,
                preamble_bars=10, trailing_handle_bars=0,
                volume_pattern="contracting", seed=3),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "cup_curve"})

    _write("tight_handle", "positive",
           dict(base_price=120.0, dome_bars=50, dome_depth_pct=0.22,
                trough_diff_pct=0.0, handle_bars=10, handle_depth_pct=0.04,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="strong_contracting", seed=4),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "cup_curve"})

    _write("very_round_dome", "positive",
           dict(base_price=150.0, dome_bars=60, dome_depth_pct=0.25,
                trough_diff_pct=0.0, handle_bars=12, handle_depth_pct=0.07,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="strong_contracting", seed=5,
                noise=0.08),  # extra-clean / low noise
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "cup_curve"})

    # 8 NEGATIVE -----------------------------------------------------------------
    _write("flat_data", "negative",
           dict(flat=True, seed=10),
           {"fires": False})

    _write("inverted_v_dome", "negative",
           # sharp inverted-V instead of round ∩; should fail top-width test
           dict(base_price=100.0, dome_bars=50, dome_depth_pct=0.25,
                trough_diff_pct=0.0, handle_bars=12, handle_depth_pct=0.07,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting", inverted_v_shape=True, seed=11),
           {"fires": False})

    _write("dome_too_shallow", "negative",
           # 8% depth, well below 12% floor
           dict(base_price=100.0, dome_bars=50, dome_depth_pct=0.08,
                trough_diff_pct=0.0, handle_bars=10, handle_depth_pct=0.03,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting", seed=12),
           {"fires": False})

    _write("dome_too_deep", "negative",
           # 60% depth, above 50% ceiling
           dict(base_price=100.0, dome_bars=50, dome_depth_pct=0.60,
                trough_diff_pct=0.0, handle_bars=12, handle_depth_pct=0.06,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting", seed=13),
           {"fires": False})

    _write("troughs_mismatched", "negative",
           # right trough 8% higher than left — exceeds 5% threshold
           dict(base_price=100.0, dome_bars=50, dome_depth_pct=0.25,
                trough_diff_pct=0.08, handle_bars=12, handle_depth_pct=0.06,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting", seed=14),
           {"fires": False})

    _write("handle_too_high", "negative",
           # handle rallies above dome peak — invalidates pattern
           dict(base_price=100.0, dome_bars=50, dome_depth_pct=0.25,
                trough_diff_pct=0.0, handle_bars=12, handle_depth_pct=0.30,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting",
                handle_too_high=True, seed=15),
           {"fires": False})

    _write("handle_too_long", "negative",
           # Handle never tops in 25 bars — keeps rising. Detector should
           # not fire because the rally hasn't faded.
           dict(base_price=100.0, dome_bars=50, dome_depth_pct=0.25,
                trough_diff_pct=0.0, handle_bars=12, handle_depth_pct=0.08,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting",
                handle_too_long=True, seed=16),
           {"fires": False})

    _write("already_broken", "negative",
           # trailing closes punch below right_trough
           dict(base_price=100.0, dome_bars=50, dome_depth_pct=0.25,
                trough_diff_pct=0.0, handle_bars=12, handle_depth_pct=0.08,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting", broken=True, seed=17),
           {"fires": False})

    # 2 EDGE ---------------------------------------------------------------------
    _write("boundary_min_depth", "edge",
           # dome depth ~13% (just inside the 12% floor)
           dict(base_price=100.0, dome_bars=50, dome_depth_pct=0.13,
                trough_diff_pct=0.0, handle_bars=10, handle_depth_pct=0.03,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting", seed=20),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0,
            "geometry_shape": "cup_curve"})

    _write("boundary_max_handle", "edge",
           # handle depth ~48% of dome depth (just inside 50% cap)
           # dome_depth=0.25 -> handle_depth ~ 0.115
           dict(base_price=100.0, dome_bars=50, dome_depth_pct=0.25,
                trough_diff_pct=0.0, handle_bars=12, handle_depth_pct=0.115,
                preamble_bars=8, trailing_handle_bars=0,
                volume_pattern="contracting", seed=21),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0,
            "geometry_shape": "cup_curve"})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
