"""One-shot generator for the inverse_head_shoulders fixture battery.

Run: python tests/fixtures/inverse_head_shoulders/_generate.py

An inverse head-and-shoulders is a 3-trough basing pattern: left shoulder,
head (lowest), right shoulder. A neckline connects the two peaks between
the troughs. Bullish reversal pattern.

Generator builds a synthetic OHLCV series by interpolating between
control points: preamble -> dip to left_shoulder -> rise to peak1 ->
dip to head -> rise to peak2 -> dip to right_shoulder -> slight rebound.
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _interp_leg(start_price, end_price, n_bars, vol_start, vol_end,
                noise=0.15, rng=None):
    """Build n_bars interpolated bars from start_price to end_price linearly.

    Each bar has small noise applied to o/c, plus high/low envelope.
    Volume linearly interpolated between vol_start and vol_end.
    """
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


def _build_bars(base_price=100.0,
                left_shoulder_pct=0.08,
                head_pct=0.15,
                right_shoulder_pct=0.08,
                neckline_slope_pct=0.0,
                left_span=10,
                right_span=10,
                preamble_bars=10,
                trailing_bars=4,
                volume_pattern="declining",
                seed=42,
                broken=False,
                head_higher_than_shoulders=False,
                flat=False,
                only_two_troughs=False,
                steep_neckline=False,
                asymmetric_amount=None,
                trailing_rebound_pct=0.02):
    """Build a synthetic inverse head-and-shoulders OHLCV series.

    Args:
      base_price: starting price (neckline base level approx)
      left_shoulder_pct: pct BELOW base for left shoulder
      head_pct: pct BELOW base for head
      right_shoulder_pct: pct BELOW base for right shoulder
      neckline_slope_pct: per-half-pattern neckline slope (0=flat)
                         applied as a price delta from peak1 to peak2
      left_span: bars from left shoulder trough to head trough
      right_span: bars from head trough to right shoulder trough
      preamble_bars: bars BEFORE left shoulder fall
      trailing_bars: bars AFTER right shoulder rise
      volume_pattern: "declining" / "strong_declining" / "flat" / "rising"
      broken: if True, push trailing closes above neckline (already broken)
      head_higher_than_shoulders: if True, make head HIGHER than shoulders (invalid)
      flat: no pattern, just noisy flat data
      only_two_troughs: skip the right shoulder fall
      steep_neckline: force a very steep neckline (> 0.01 * head_price)
      asymmetric_amount: if provided, override right_shoulder_pct to differ
                        from left by this absolute fraction of head_pct
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    dt = 86400  # 1 day per bar

    if flat:
        # produce noisy flat data without a clear pattern
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

    # Volume schedule
    if volume_pattern == "declining":
        vol_pre = 2000.0
        vol_left = 2200.0
        vol_head = 1700.0
        vol_right = 1200.0
        vol_trail = 1000.0
    elif volume_pattern == "strong_declining":
        vol_pre = 2500.0
        vol_left = 2800.0
        vol_head = 1900.0
        vol_right = 800.0
        vol_trail = 600.0
    elif volume_pattern == "rising":
        vol_pre = 1000.0
        vol_left = 1200.0
        vol_head = 1500.0
        vol_right = 2000.0
        vol_trail = 2200.0
    else:  # flat
        vol_pre = vol_left = vol_head = vol_right = vol_trail = 1500.0

    # Price levels — inverse: shoulders BELOW base, head LOWEST
    left_price = base_price * (1.0 - left_shoulder_pct)
    head_price = base_price * (1.0 - head_pct)

    if asymmetric_amount is not None:
        right_price = base_price * (1.0 - right_shoulder_pct - asymmetric_amount)
    else:
        right_price = base_price * (1.0 - right_shoulder_pct)

    if head_higher_than_shoulders:
        # invert: head becomes higher than shoulders
        head_price = base_price * (1.0 - min(left_shoulder_pct, right_shoulder_pct) + 0.02)

    # Neckline / peak levels — peaks sit ABOVE base
    peak1_price = base_price
    if steep_neckline:
        # Very steep slope. Threshold is 0.005 * head_price PER BAR.
        # With span ~12, total rise needed > 0.005 * 12 * head_price = 6% of head.
        # We bump peak2 ~12% above peak1 to be well past the threshold.
        peak2_price = base_price + 0.12 * head_price
    else:
        peak2_price = base_price + neckline_slope_pct * head_price

    # 1. Preamble: gentle decline to left shoulder base
    pre_start = base_price * 1.04
    pre_end = peak1_price + 0.5  # land just above peak1
    bars.extend(_attach_t(_interp_leg(pre_start, pre_end, preamble_bars,
                                       vol_pre, vol_pre, noise=0.15, rng=rng),
                          start_t=t, dt=dt))
    t = bars[-1]["t"] + dt if bars else t

    # 2. Fall from peak1 to left shoulder trough (left_span // 2 bars)
    fall_bars = max(2, left_span // 2)
    leg1 = _interp_leg(peak1_price, left_price * 1.02, fall_bars,
                       vol_pre, vol_left, noise=0.15, rng=rng)
    # Last bar is the trough bar
    leg1.append(_make_trough_bar(left_price, left_price * 1.03, vol_left, rng))
    bars.extend(_attach_t(leg1, start_t=t, dt=dt))
    t = bars[-1]["t"] + dt

    # 3. Rise from left shoulder to peak1 region (left_span // 2 bars)
    # Note: we already placed peak1 in preamble end, but logical "peak1"
    # should land BETWEEN left and head. So we ascend to a new high here.
    ascend_bars = max(2, left_span - fall_bars)
    leg2 = _interp_leg(left_price * 1.03, peak1_price * 0.99, ascend_bars,
                       vol_left, vol_head * 0.8, noise=0.15, rng=rng)
    # Last bar is the peak
    leg2.append(_make_peak_bar(peak1_price, peak1_price * 0.98,
                                vol_head * 0.8, rng))
    bars.extend(_attach_t(leg2, start_t=t, dt=dt))
    t = bars[-1]["t"] + dt

    # 4. Fall from peak1 to head trough (left_span // 2 + 1 bars to head)
    head_fall_bars = max(2, left_span // 2)
    leg3 = _interp_leg(peak1_price * 0.98, head_price * 1.02, head_fall_bars,
                       vol_head * 0.8, vol_head, noise=0.15, rng=rng)
    leg3.append(_make_trough_bar(head_price, head_price * 1.03, vol_head, rng))
    bars.extend(_attach_t(leg3, start_t=t, dt=dt))
    t = bars[-1]["t"] + dt

    # 5. Rise from head to peak2
    head_rise_bars = max(2, right_span // 2)
    leg4 = _interp_leg(head_price * 1.03, peak2_price * 0.99, head_rise_bars,
                       vol_head, vol_right * 0.9, noise=0.15, rng=rng)
    leg4.append(_make_peak_bar(peak2_price, peak2_price * 0.98,
                                vol_right * 0.9, rng))
    bars.extend(_attach_t(leg4, start_t=t, dt=dt))
    t = bars[-1]["t"] + dt

    if not only_two_troughs:
        # 6. Fall from peak2 to right shoulder trough
        rs_fall_bars = max(2, right_span - head_rise_bars)
        leg5 = _interp_leg(peak2_price * 0.99, right_price * 1.02, rs_fall_bars,
                           vol_right * 0.9, vol_right, noise=0.15, rng=rng)
        leg5.append(_make_trough_bar(right_price, right_price * 1.03, vol_right, rng))
        bars.extend(_attach_t(leg5, start_t=t, dt=dt))
        t = bars[-1]["t"] + dt

        # 7. Trailing: slight rebound (not yet broken) OR breakout if `broken`
        if broken:
            # Push closes meaningfully above neckline (peak2 + slope projection)
            end_price = peak2_price * (1.0 + 0.04)  # 4% above peak2
            trail = _interp_leg(right_price * 1.03, end_price, trailing_bars,
                                vol_right, vol_trail, noise=0.15, rng=rng)
        else:
            # Trail slightly above right shoulder but BELOW neckline
            target = right_price * (1.0 + trailing_rebound_pct)
            # Make sure target stays below neckline projection
            target = min(target, peak2_price * 0.98)
            trail = _interp_leg(right_price * 1.03, target, trailing_bars,
                                vol_right, vol_trail, noise=0.15, rng=rng)
        bars.extend(_attach_t(trail, start_t=t, dt=dt))
    else:
        # only two troughs: don't fall to right shoulder, drift up
        end_price = peak2_price * 1.02
        trail = _interp_leg(peak2_price * 0.98, end_price, trailing_bars + 5,
                            vol_right * 0.9, vol_trail, noise=0.15, rng=rng)
        bars.extend(_attach_t(trail, start_t=t, dt=dt))

    return bars


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
           dict(base_price=100.0, left_shoulder_pct=0.10, head_pct=0.18,
                right_shoulder_pct=0.10, neckline_slope_pct=0.0,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="declining", seed=1),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "neckline"})

    _write("slight_neckline_slope", "positive",
           dict(base_price=100.0, left_shoulder_pct=0.10, head_pct=0.18,
                right_shoulder_pct=0.10, neckline_slope_pct=0.0015,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="declining", seed=2),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0,
            "geometry_shape": "neckline"})

    _write("longer_pattern", "positive",
           dict(base_price=80.0, left_shoulder_pct=0.12, head_pct=0.22,
                right_shoulder_pct=0.12, neckline_slope_pct=0.0,
                left_span=20, right_span=20, preamble_bars=10, trailing_bars=5,
                volume_pattern="declining", seed=3),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})

    _write("tighter_symmetry", "positive",
           dict(base_price=120.0, left_shoulder_pct=0.10, head_pct=0.18,
                right_shoulder_pct=0.105, neckline_slope_pct=0.0,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="declining", seed=4),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    _write("declining_volume", "positive",
           dict(base_price=150.0, left_shoulder_pct=0.10, head_pct=0.18,
                right_shoulder_pct=0.10, neckline_slope_pct=0.0,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="strong_declining", seed=5),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    # 8 NEGATIVE ------------------------------------------------------------------
    _write("flat_data", "negative",
           # NOTE: seed chosen so noisy random pivots do NOT form a valid
           # inverse H&S geometry. Seed 10 (used in head_shoulders) produces
           # 8 low pivots that happen to cluster tightly enough to satisfy
           # the loose "head < shoulders" check. Seed 12 yields a flat
           # distribution where no triple passes validation.
           dict(flat=True, seed=12),
           {"fires": False})

    _write("head_not_lowest", "negative",
           dict(base_price=100.0, left_shoulder_pct=0.10, head_pct=0.12,
                right_shoulder_pct=0.15,  # right shoulder deeper than head
                neckline_slope_pct=0.0,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="declining", seed=11),
           {"fires": False})

    _write("asymmetric_shoulders", "negative",
           # left and right shoulders ~20%+ apart relative to head
           dict(base_price=100.0, left_shoulder_pct=0.02, head_pct=0.30,
                right_shoulder_pct=0.28,
                neckline_slope_pct=0.0,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="declining", seed=12),
           {"fires": False})

    _write("troughs_too_close", "negative",
           dict(base_price=100.0, left_shoulder_pct=0.10, head_pct=0.18,
                right_shoulder_pct=0.10, neckline_slope_pct=0.0,
                left_span=4, right_span=4,  # only 2 bars on each side of head
                preamble_bars=8, trailing_bars=4,
                volume_pattern="declining", seed=13),
           {"fires": False})

    _write("neckline_too_steep", "negative",
           dict(base_price=100.0, left_shoulder_pct=0.10, head_pct=0.18,
                right_shoulder_pct=0.10, steep_neckline=True,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="declining", seed=14),
           {"fires": False})

    _write("too_few_troughs", "negative",
           dict(base_price=100.0, left_shoulder_pct=0.10, head_pct=0.18,
                right_shoulder_pct=0.10, neckline_slope_pct=0.0,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                only_two_troughs=True,
                volume_pattern="declining", seed=15),
           {"fires": False})

    _write("pattern_too_short", "negative",
           dict(base_price=100.0, left_shoulder_pct=0.10, head_pct=0.18,
                right_shoulder_pct=0.10, neckline_slope_pct=0.0,
                left_span=6, right_span=6, preamble_bars=3, trailing_bars=2,
                volume_pattern="declining", seed=16),
           {"fires": False})

    _write("already_broken", "negative",
           dict(base_price=100.0, left_shoulder_pct=0.10, head_pct=0.18,
                right_shoulder_pct=0.10, neckline_slope_pct=0.0,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=6,
                volume_pattern="declining", broken=True, seed=17),
           {"fires": False})

    # 2 EDGE ---------------------------------------------------------------------
    _write("boundary_symmetry", "edge",
           # ~14% asymmetry — just inside the 15% threshold
           dict(base_price=100.0, left_shoulder_pct=0.10, head_pct=0.20,
                right_shoulder_pct=0.072,  # ~13% relative diff vs head
                neckline_slope_pct=0.0,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="declining", seed=20),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 85.0})

    _write("boundary_min_spacing", "edge",
           # tight 5-bar spacing between head and each shoulder, but enough
           # preamble + trailing to clear the min total bar count (30).
           dict(base_price=100.0, left_shoulder_pct=0.10, head_pct=0.18,
                right_shoulder_pct=0.10, neckline_slope_pct=0.0,
                left_span=5, right_span=5, preamble_bars=12, trailing_bars=8,
                volume_pattern="declining", seed=21),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
