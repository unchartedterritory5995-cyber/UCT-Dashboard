"""One-shot generator for the double_bottom fixture battery.

Run: python tests/fixtures/double_bottom/_generate.py

A double bottom is a 2-trough bullish reversal pattern: two troughs at
roughly the same price with a rally peak between them. The second
trough holds at approximately the same level as the first; a breakout
above the rally peak confirms the reversal.

Generator builds a synthetic OHLCV series by interpolating between
control points: preamble -> fall to trough1 -> rise to peak -> fall to
trough2 -> slight bounce (not yet broken above peak).
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
                trough1_pct=0.15,
                trough2_pct=0.15,
                rally_pct=0.10,    # depth of rally relative to trough1 price
                left_span=10,      # bars from trough1 to peak
                right_span=10,     # bars from peak to trough2
                preamble_bars=10,
                trailing_bars=4,
                volume_pattern="expanding",
                seed=42,
                broken=False,
                flat=False,
                only_one_trough=False,
                chaotic=False,
                trailing_bounce_pct=0.02):
    """Build a synthetic double-bottom OHLCV series.

    Args:
      base_price: starting price (above the structure)
      trough1_pct: pct below base for trough1
      trough2_pct: pct below base for trough2
      rally_pct: fraction of trough1 to rise to for the peak
                 (e.g. 0.10 means peak sits at trough1 * 1.10)
      left_span: bars from trough1 to peak (inclusive of trough/peak bars)
      right_span: bars from peak to trough2
      preamble_bars: bars BEFORE fall to trough1
      trailing_bars: bars AFTER trough2
      volume_pattern: "expanding" / "strong_expanding" / "flat" / "declining"
      broken: if True, push trailing closes above peak (already broken)
      flat: no pattern, just noisy flat data
      only_one_trough: skip the second trough fall (just drifts after peak)
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
        # Highly chaotic data with ascending overall trend and multiple
        # mismatched dips. The most-recent swing lows should NOT form
        # a similar-depth pair (trough_similarity > 4%) at any spacing.
        # We engineer a sawtooth where each trough is meaningfully different
        # from every other trough.
        levels = [base_price * 0.70, base_price * 0.95, base_price * 0.78,
                  base_price * 1.08, base_price * 0.86, base_price * 1.20,
                  base_price * 1.00, base_price * 1.30]
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

    # Volume schedules — for double bottom, expansion on T2 is the
    # signature (confirmation buying).
    if volume_pattern == "expanding":
        vol_pre = 1800.0
        vol_t1 = 1500.0
        vol_peak = 1300.0
        vol_t2 = 2400.0
        vol_trail = 2000.0
    elif volume_pattern == "strong_expanding":
        vol_pre = 2000.0
        vol_t1 = 1200.0
        vol_peak = 1000.0
        vol_t2 = 3000.0
        vol_trail = 2500.0
    elif volume_pattern == "declining":
        vol_pre = 2200.0
        vol_t1 = 2000.0
        vol_peak = 1400.0
        vol_t2 = 1200.0
        vol_trail = 1000.0
    else:
        vol_pre = vol_t1 = vol_peak = vol_t2 = vol_trail = 1500.0

    # Price levels (mirror: troughs below base, peak between)
    trough1_price = base_price * (1.0 - trough1_pct)
    trough2_price = base_price * (1.0 - trough2_pct)
    peak_price = trough1_price * (1.0 + rally_pct)

    # 1. Preamble: gentle decline from above toward the launch level
    pre_start = base_price * 1.06
    pre_end = base_price
    bars.extend(_attach_t(
        _interp_leg(pre_start, pre_end, preamble_bars,
                    vol_pre, vol_pre, noise=0.15, rng=rng),
        start_t=t, dt=dt))
    t = bars[-1]["t"] + dt if bars else t

    # 2. Fall to trough1 (left_span // 2 bars + trough bar)
    fall_bars = max(2, left_span // 2)
    leg1 = _interp_leg(base_price, trough1_price * 1.02, fall_bars,
                       vol_pre, vol_t1, noise=0.15, rng=rng)
    leg1.append(_make_trough_bar(trough1_price, trough1_price * 1.03,
                                  vol_t1, rng))
    bars.extend(_attach_t(leg1, start_t=t, dt=dt))
    t = bars[-1]["t"] + dt

    # 3. Rise from trough1 to peak (left_span - fall_bars bars + peak bar)
    rise_bars = max(2, left_span - fall_bars)
    leg2 = _interp_leg(trough1_price * 1.03, peak_price * 0.99, rise_bars,
                       vol_t1, vol_peak, noise=0.15, rng=rng)
    leg2.append(_make_peak_bar(peak_price, peak_price * 0.98, vol_peak, rng))
    bars.extend(_attach_t(leg2, start_t=t, dt=dt))
    t = bars[-1]["t"] + dt

    if only_one_trough:
        # No second trough — drift sideways/up from peak
        end_price = peak_price * 1.03
        trail = _interp_leg(peak_price * 0.98, end_price,
                            trailing_bars + right_span + 5,
                            vol_peak, vol_trail, noise=0.15, rng=rng)
        bars.extend(_attach_t(trail, start_t=t, dt=dt))
        return bars

    # 4. Fall from peak to trough2
    fall2_bars = max(2, right_span // 2)
    leg3 = _interp_leg(peak_price * 0.98, trough2_price * 1.02, fall2_bars,
                       vol_peak, vol_t2, noise=0.15, rng=rng)
    leg3.append(_make_trough_bar(trough2_price, trough2_price * 1.03,
                                  vol_t2, rng))
    bars.extend(_attach_t(leg3, start_t=t, dt=dt))
    t = bars[-1]["t"] + dt

    # 5. Trailing: slight bounce (not broken) OR breakout
    if broken:
        end_price = peak_price * (1.0 + 0.04)  # ~4% above peak
        trail = _interp_leg(trough2_price * 1.03, end_price, trailing_bars,
                            vol_t2, vol_trail, noise=0.15, rng=rng)
    else:
        target = trough2_price * (1.0 + trailing_bounce_pct)
        # ensure target stays comfortably below peak
        target = min(target, peak_price * 0.95)
        trail = _interp_leg(trough2_price * 1.03, target, trailing_bars,
                            vol_t2, vol_trail, noise=0.15, rng=rng)
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
           # troughs within ~1% (both at -15%), 15% rally
           dict(base_price=100.0, trough1_pct=0.15, trough2_pct=0.15,
                rally_pct=0.15,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="expanding", seed=1),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "neckline"})

    _write("tight_match", "positive",
           # troughs within 0.5% — extra clean
           dict(base_price=120.0, trough1_pct=0.18, trough2_pct=0.1797,
                rally_pct=0.12,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="expanding", seed=2),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "neckline"})

    _write("widely_spaced_troughs", "positive",
           # 20+ bars between troughs
           dict(base_price=80.0, trough1_pct=0.20, trough2_pct=0.20,
                rally_pct=0.15,
                left_span=22, right_span=22, preamble_bars=10, trailing_bars=5,
                volume_pattern="expanding", seed=3),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("shallow_retrace", "positive",
           # 8% rally (near floor)
           dict(base_price=150.0, trough1_pct=0.12, trough2_pct=0.12,
                rally_pct=0.08,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="expanding", seed=4),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})

    _write("expanding_volume", "positive",
           # pronounced volume expansion on second trough
           dict(base_price=200.0, trough1_pct=0.18, trough2_pct=0.18,
                rally_pct=0.13,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="strong_expanding", seed=5),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    # 8 NEGATIVE -----------------------------------------------------------------
    _write("flat_data", "negative",
           dict(flat=True, seed=10),
           {"fires": False})

    _write("troughs_too_different", "negative",
           # trough1 at -15%, trough2 at -8% — ~8% trough similarity (> 4% threshold)
           dict(base_price=100.0, trough1_pct=0.15, trough2_pct=0.08,
                rally_pct=0.10,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="expanding", seed=11),
           {"fires": False})

    _write("troughs_too_close", "negative",
           # only 5 bars between troughs (< 7 min)
           dict(base_price=100.0, trough1_pct=0.15, trough2_pct=0.15,
                rally_pct=0.10,
                left_span=3, right_span=3, preamble_bars=10, trailing_bars=8,
                volume_pattern="expanding", seed=12),
           {"fires": False})

    _write("retrace_too_shallow", "negative",
           # 3% rally (< 5% min)
           dict(base_price=100.0, trough1_pct=0.15, trough2_pct=0.15,
                rally_pct=0.03,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="expanding", seed=13),
           {"fires": False})

    _write("retrace_too_deep", "negative",
           # 30% rally (> 25% max)
           dict(base_price=100.0, trough1_pct=0.20, trough2_pct=0.20,
                rally_pct=0.30,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="expanding", seed=14),
           {"fires": False})

    _write("already_broken", "negative",
           # trailing bars close meaningfully above peak
           dict(base_price=100.0, trough1_pct=0.15, trough2_pct=0.15,
                rally_pct=0.12,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=8,
                volume_pattern="expanding", broken=True, seed=15),
           {"fires": False})

    _write("only_one_trough", "negative",
           # only the first trough forms; no second attempt
           dict(base_price=100.0, trough1_pct=0.15, trough2_pct=0.15,
                rally_pct=0.10,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                only_one_trough=True,
                volume_pattern="expanding", seed=16),
           {"fires": False})

    _write("chaotic_noise", "negative",
           dict(chaotic=True, seed=17),
           {"fires": False})

    _write("pattern_too_short", "negative",
           # whole series under 20 bars
           dict(base_price=100.0, trough1_pct=0.15, trough2_pct=0.15,
                rally_pct=0.10,
                left_span=4, right_span=4, preamble_bars=3, trailing_bars=2,
                volume_pattern="expanding", seed=18),
           {"fires": False})

    # 2 EDGE ---------------------------------------------------------------------
    _write("boundary_similarity", "edge",
           # troughs ~3.8% apart — just inside the 4% threshold
           dict(base_price=100.0, trough1_pct=0.20, trough2_pct=0.1696,
                rally_pct=0.12,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="expanding", seed=20),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 85.0})

    _write("boundary_retrace", "edge",
           # ~24% rally — just inside the 25% max
           dict(base_price=100.0, trough1_pct=0.20, trough2_pct=0.20,
                rally_pct=0.24,
                left_span=12, right_span=12, preamble_bars=8, trailing_bars=4,
                volume_pattern="expanding", seed=21),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
