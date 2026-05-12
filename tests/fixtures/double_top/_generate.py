"""One-shot generator for the double_top fixture battery.

Run: python tests/fixtures/double_top/_generate.py

A double top is a 2-peak bearish reversal pattern: two peaks at roughly
the same price with a retrace trough between them. The second peak
fails at approximately the same level as the first; a breakdown below
the trough confirms the reversal.

Generator builds a synthetic OHLCV series by interpolating between
control points: preamble -> rise to peak1 -> fall to trough -> rise to
peak2 -> slight pullback (not yet broken).
"""
import json
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


def _make_peak_bar(peak_price, body_price, vol, rng):
    """Build a single 'peak' bar whose high reaches peak_price."""
    o = body_price + rng.uniform(-0.10, 0.10)
    c = body_price + rng.uniform(-0.10, 0.10)
    h = peak_price + abs(rng.uniform(0, 0.05))
    l = min(o, c) - abs(rng.uniform(0, 0.15))
    return {
        "o": round(o, 2),
        "h": round(h, 2),
        "l": round(l, 2),
        "c": round(c, 2),
        "v": round(vol * rng.uniform(0.9, 1.1), 0),
    }


def _make_trough_bar(trough_price, body_price, vol, rng):
    """Build a single 'trough' bar whose low reaches trough_price."""
    o = body_price + rng.uniform(-0.10, 0.10)
    c = body_price + rng.uniform(-0.10, 0.10)
    h = max(o, c) + abs(rng.uniform(0, 0.15))
    l = trough_price - abs(rng.uniform(0, 0.05))
    return {
        "o": round(o, 2),
        "h": round(h, 2),
        "l": round(l, 2),
        "c": round(c, 2),
        "v": round(vol * rng.uniform(0.9, 1.1), 0),
    }


def _attach_t(bar_list, start_t, dt):
    """Attach timestamp `t` to each bar (in-place build a new list)."""
    out = []
    t = start_t
    for b in bar_list:
        b2 = dict(b)
        b2["t"] = t
        out.append(b2)
        t += dt
    return out


def _build_bars(base_price=100.0,
                peak1_pct=0.15,
                peak2_pct=0.15,
                retrace_pct=0.10,  # depth of retrace relative to peak1 price
                left_span=10,      # bars from peak1 to trough
                right_span=10,     # bars from trough to peak2
                preamble_bars=10,
                trailing_bars=4,
                volume_pattern="declining",
                seed=42,
                broken=False,
                flat=False,
                only_one_peak=False,
                chaotic=False,
                trailing_pullback_pct=0.02):
    """Build a synthetic double-top OHLCV series.

    Args:
      base_price: starting price (below the structure)
      peak1_pct: pct above base for peak1
      peak2_pct: pct above base for peak2
      retrace_pct: fraction of peak1 to drop to for the trough
                   (e.g. 0.10 means trough sits at peak1 * 0.90)
      left_span: bars from peak1 to trough (inclusive of peak/trough bars)
      right_span: bars from trough to peak2
      preamble_bars: bars BEFORE rise to peak1
      trailing_bars: bars AFTER peak2
      volume_pattern: "declining" / "strong_declining" / "flat" / "rising"
      broken: if True, push trailing closes below trough (already broken)
      flat: no pattern, just noisy flat data
      only_one_peak: skip the second peak rise (just drifts after trough)
      chaotic: produce highly chaotic data with no consistent structure
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    dt = 86400

    if flat:
        for i in range(50):
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

    if chaotic:
        # Highly chaotic data with descending overall trend and multiple
        # mismatched spikes. The most-recent swing highs should NOT form
        # a similar-height pair (peak_similarity > 4%) at any spacing.
        # We engineer a sawtooth where each peak is meaningfully different
        # from every other peak.
        levels = [base_price * 1.30, base_price * 1.05, base_price * 1.22,
                  base_price * 0.92, base_price * 1.14, base_price * 0.80,
                  base_price * 1.00, base_price * 0.70]
        # Interpolate between levels in short ~7-bar legs, with strong noise.
        prev = base_price
        for level in levels:
            n_leg = 7
            for i in range(n_leg):
                frac = i / max(n_leg - 1, 1)
                mid = prev + (level - prev) * frac
                mid = mid + rng.uniform(-2.0, 2.0)
                o = mid + rng.uniform(-1.5, 1.5)
                c = mid + rng.uniform(-1.5, 1.5)
                h = max(o, c) + abs(rng.uniform(0, 2.5))
                l = min(o, c) - abs(rng.uniform(0, 2.5))
                v = 1500 * rng.uniform(0.4, 1.8)
                bars.append({
                    "t": t, "o": round(o, 2), "h": round(h, 2),
                    "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)
                })
                t += dt
            prev = level
        return bars

    # Volume schedules
    if volume_pattern == "declining":
        vol_pre = 1800.0
        vol_p1 = 2400.0
        vol_trough = 1400.0
        vol_p2 = 1500.0
        vol_trail = 1200.0
    elif volume_pattern == "strong_declining":
        vol_pre = 2000.0
        vol_p1 = 3000.0
        vol_trough = 1300.0
        vol_p2 = 900.0
        vol_trail = 700.0
    elif volume_pattern == "rising":
        vol_pre = 1000.0
        vol_p1 = 1200.0
        vol_trough = 1400.0
        vol_p2 = 2000.0
        vol_trail = 2200.0
    else:
        vol_pre = vol_p1 = vol_trough = vol_p2 = vol_trail = 1500.0

    # Price levels
    peak1_price = base_price * (1.0 + peak1_pct)
    peak2_price = base_price * (1.0 + peak2_pct)
    trough_price = peak1_price * (1.0 - retrace_pct)

    # 1. Preamble: gentle rise from below toward the launch level
    pre_start = base_price * 0.94
    pre_end = base_price
    bars.extend(_attach_t(
        _interp_leg(pre_start, pre_end, preamble_bars,
                    vol_pre, vol_pre, noise=0.15, rng=rng),
        start_t=t, dt=dt))
    t = bars[-1]["t"] + dt if bars else t

    # 2. Rise to peak1 (left_span // 2 bars + peak bar)
    rise_bars = max(2, left_span // 2)
    leg1 = _interp_leg(base_price, peak1_price * 0.98, rise_bars,
                       vol_pre, vol_p1, noise=0.15, rng=rng)
    leg1.append(_make_peak_bar(peak1_price, peak1_price * 0.97, vol_p1, rng))
    bars.extend(_attach_t(leg1, start_t=t, dt=dt))
    t = bars[-1]["t"] + dt

    # 3. Fall from peak1 to trough (left_span - rise_bars bars + trough bar)
    fall_bars = max(2, left_span - rise_bars)
    leg2 = _interp_leg(peak1_price * 0.97, trough_price * 1.01, fall_bars,
                       vol_p1, vol_trough, noise=0.15, rng=rng)
    leg2.append(_make_trough_bar(trough_price, trough_price * 1.02,
                                  vol_trough, rng))
    bars.extend(_attach_t(leg2, start_t=t, dt=dt))
    t = bars[-1]["t"] + dt

    if only_one_peak:
        # No second peak — drift sideways/down from trough
        end_price = trough_price * 0.97
        trail = _interp_leg(trough_price * 1.02, end_price,
                            trailing_bars + right_span + 5,
                            vol_trough, vol_trail, noise=0.15, rng=rng)
        bars.extend(_attach_t(trail, start_t=t, dt=dt))
        return bars

    # 4. Rise from trough to peak2
    rise2_bars = max(2, right_span // 2)
    leg3 = _interp_leg(trough_price * 1.02, peak2_price * 0.98, rise2_bars,
                       vol_trough, vol_p2, noise=0.15, rng=rng)
    leg3.append(_make_peak_bar(peak2_price, peak2_price * 0.97, vol_p2, rng))
    bars.extend(_attach_t(leg3, start_t=t, dt=dt))
    t = bars[-1]["t"] + dt

    # 5. Trailing: slight pullback (not broken) OR breakdown
    if broken:
        end_price = trough_price * (1.0 - 0.04)  # ~4% below trough
        trail = _interp_leg(peak2_price * 0.97, end_price, trailing_bars,
                            vol_p2, vol_trail, noise=0.15, rng=rng)
    else:
        target = peak2_price * (1.0 - trailing_pullback_pct)
        # ensure target stays comfortably above trough
        target = max(target, trough_price * 1.05)
        trail = _interp_leg(peak2_price * 0.97, target, trailing_bars,
                            vol_p2, vol_trail, noise=0.15, rng=rng)
    bars.extend(_attach_t(trail, start_t=t, dt=dt))

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
           # peaks within ~1% (both at +15%), 15% retrace
           dict(base_price=100.0, peak1_pct=0.15, peak2_pct=0.15,
                retrace_pct=0.15,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="declining", seed=1),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "neckline"})

    _write("tight_match", "positive",
           # peaks within 0.5% — extra clean
           dict(base_price=120.0, peak1_pct=0.18, peak2_pct=0.1797,
                retrace_pct=0.12,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="declining", seed=2),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "neckline"})

    _write("widely_spaced_peaks", "positive",
           # 20+ bars between peaks
           dict(base_price=80.0, peak1_pct=0.20, peak2_pct=0.20,
                retrace_pct=0.15,
                left_span=22, right_span=22, preamble_bars=10, trailing_bars=5,
                volume_pattern="declining", seed=3),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("shallow_retrace", "positive",
           # 8% retrace (near floor)
           dict(base_price=150.0, peak1_pct=0.12, peak2_pct=0.12,
                retrace_pct=0.08,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="declining", seed=4),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})

    _write("declining_volume", "positive",
           # pronounced volume drop on second peak
           dict(base_price=200.0, peak1_pct=0.18, peak2_pct=0.18,
                retrace_pct=0.13,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="strong_declining", seed=5),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    # 8 NEGATIVE -----------------------------------------------------------------
    _write("flat_data", "negative",
           dict(flat=True, seed=10),
           {"fires": False})

    _write("peaks_too_different", "negative",
           # peak1 at +15%, peak2 at +8% — ~6% peak similarity (> 4% threshold)
           dict(base_price=100.0, peak1_pct=0.15, peak2_pct=0.08,
                retrace_pct=0.10,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="declining", seed=11),
           {"fires": False})

    _write("peaks_too_close", "negative",
           # only 5 bars between peaks (< 7 min)
           dict(base_price=100.0, peak1_pct=0.15, peak2_pct=0.15,
                retrace_pct=0.10,
                left_span=3, right_span=3, preamble_bars=10, trailing_bars=8,
                volume_pattern="declining", seed=12),
           {"fires": False})

    _write("retrace_too_shallow", "negative",
           # 3% retrace (< 5% min)
           dict(base_price=100.0, peak1_pct=0.15, peak2_pct=0.15,
                retrace_pct=0.03,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="declining", seed=13),
           {"fires": False})

    _write("retrace_too_deep", "negative",
           # 30% retrace (> 25% max)
           dict(base_price=100.0, peak1_pct=0.20, peak2_pct=0.20,
                retrace_pct=0.30,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="declining", seed=14),
           {"fires": False})

    _write("already_broken", "negative",
           # trailing bars close meaningfully below trough
           dict(base_price=100.0, peak1_pct=0.15, peak2_pct=0.15,
                retrace_pct=0.12,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=8,
                volume_pattern="declining", broken=True, seed=15),
           {"fires": False})

    _write("only_one_peak", "negative",
           # only the first peak forms; no second attempt
           dict(base_price=100.0, peak1_pct=0.15, peak2_pct=0.15,
                retrace_pct=0.10,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                only_one_peak=True,
                volume_pattern="declining", seed=16),
           {"fires": False})

    _write("chaotic_noise", "negative",
           dict(chaotic=True, seed=17),
           {"fires": False})

    _write("pattern_too_short", "negative",
           # whole series under 20 bars
           dict(base_price=100.0, peak1_pct=0.15, peak2_pct=0.15,
                retrace_pct=0.10,
                left_span=4, right_span=4, preamble_bars=3, trailing_bars=2,
                volume_pattern="declining", seed=18),
           {"fires": False})

    # 2 EDGE ---------------------------------------------------------------------
    _write("boundary_similarity", "edge",
           # peaks ~3.8% apart — just inside the 4% threshold
           dict(base_price=100.0, peak1_pct=0.20, peak2_pct=0.1545,
                retrace_pct=0.12,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="declining", seed=20),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 85.0})

    _write("boundary_retrace", "edge",
           # ~24% retrace — just inside the 25% max
           dict(base_price=100.0, peak1_pct=0.20, peak2_pct=0.20,
                retrace_pct=0.24,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="declining", seed=21),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
