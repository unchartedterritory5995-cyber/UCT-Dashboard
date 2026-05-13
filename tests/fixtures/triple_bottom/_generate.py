"""One-shot generator for the triple_bottom fixture battery.

Run: python tests/fixtures/triple_bottom/_generate.py

Triple Bottom = 3 troughs at similar prices (within 3%) with 2 rally
peaks (within 5% of each other) between them. Stricter version of
double_bottom. Mirror of triple_top with inverted geometry.
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _build_bars(trough_price, peak_price, trough_spacing=15,
                trough_jitter=0.0, peak_jitter=0.0,
                preamble_bars=10, post_bars=5,
                only_two_troughs=False, troughs_too_close=False,
                peak_mismatch=False, already_broken=False,
                volume_pattern="expanding", choppy=False, seed=42):
    """Build OHLCV with 3 troughs at similar lows and 2 peaks between.

    trough_jitter: variation in trough prices (e.g. 0.02 = 2% spread)
    peak_jitter: variation in peak prices

    volume_pattern: 'expanding' (good - accumulation),
                    'contracting' (bad - signals distribution disguised
                    as bottom), or 'flat'.
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000

    preamble_vol = 1500.0
    # Preamble: downtrend ABOVE first trough (don't quite reach it -
    # need to leave room for T1 trough_bar to dominate the swing-low test).
    preamble_floor = trough_price * 1.04
    start = trough_price * 1.15
    for i in range(preamble_bars):
        prog = i / max(preamble_bars - 1, 1)
        target = start + (preamble_floor - start) * prog
        c = target + rng.uniform(-0.3, 0.3)
        o = target + rng.uniform(-0.3, 0.3)
        h = max(c, o) + abs(rng.uniform(0, 0.4))
        l = min(c, o) - abs(rng.uniform(0, 0.4))
        v = preamble_vol * rng.uniform(0.9, 1.2)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += 86400

    # Trough prices with jitter
    t1 = trough_price * (1.0 + rng.uniform(-trough_jitter, trough_jitter))
    t2 = trough_price * (1.0 + rng.uniform(-trough_jitter, trough_jitter))
    t3 = trough_price * (1.0 + rng.uniform(-trough_jitter, trough_jitter))
    if troughs_too_close:
        trough_spacing = 4

    p1 = peak_price * (1.0 + rng.uniform(-peak_jitter, peak_jitter))
    p2 = peak_price * (1.0 + rng.uniform(-peak_jitter, peak_jitter))
    if peak_mismatch:
        p2 = peak_price * 1.15  # 15% mismatch

    half = trough_spacing // 2

    def _segment_to(target_price, length, vol_factor, target_is_trough=False):
        nonlocal t
        if not bars:
            start_c = trough_price
        else:
            start_c = bars[-1]["c"]
        # If we're descending to a trough, stop the segment 2-3% above the
        # actual trough price so the upcoming _trough_bar's low can dominate.
        if target_is_trough:
            effective_target = target_price * 1.025
        else:
            effective_target = target_price
        for i in range(length):
            if choppy:
                if not hasattr(rng, '_cw'):
                    rng._cw = trough_price * 1.05
                rng._cw += rng.uniform(-6.0, 6.0)
                c = rng._cw + rng.uniform(-2.0, 2.0)
                o = rng._cw + rng.uniform(-2.0, 2.0)
                h = max(c, o) + abs(rng.uniform(1.5, 4.0))
                l = min(c, o) - abs(rng.uniform(1.5, 4.0))
            else:
                prog = (i + 1) / max(length, 1)
                target = start_c + (effective_target - start_c) * prog
                c = target + rng.uniform(-0.2, 0.2)
                o = target + rng.uniform(-0.2, 0.2)
                h = max(c, o) + abs(rng.uniform(0, 0.3))
                l = min(c, o) - abs(rng.uniform(0, 0.3))
            v = preamble_vol * vol_factor * rng.uniform(0.9, 1.1)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += 86400

    def _trough_bar(trough_p, vol_factor):
        nonlocal t
        c = trough_p + rng.uniform(0.05, 0.4)
        o = c + rng.uniform(-0.2, 0.2)
        # Strict low: 1-2 ticks below the official trough price so the
        # swing-low pivot detector unambiguously selects this bar.
        l = trough_p - rng.uniform(0.6, 1.2)
        h = max(c, o) + abs(rng.uniform(0, 0.3))
        v = preamble_vol * vol_factor * rng.uniform(0.9, 1.1)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += 86400

    # T1
    _trough_bar(t1, 0.7)

    if volume_pattern == "expanding":
        v1, v2, v3 = 0.7, 1.0, 1.5
    elif volume_pattern == "contracting":
        v1, v2, v3 = 1.3, 0.9, 0.55
    else:
        v1, v2, v3 = 1.0, 1.0, 1.0

    # T1 -> peak1 -> T2
    _segment_to(p1, half, vol_factor=v1)
    _segment_to(t2, half, vol_factor=v2, target_is_trough=True)
    if only_two_troughs:
        _trough_bar(t2, v2)
    else:
        _trough_bar(t2, v2)
        # T2 -> peak2 -> T3
        _segment_to(p2, half, vol_factor=v2)
        _segment_to(t3, half, vol_factor=v3, target_is_trough=True)
        _trough_bar(t3, v3)

    # Post-pattern bars
    if not already_broken:
        # Drift up but stay below the peak confluence (no break yet)
        post_target = (p1 + p2) / 2 * 0.97
        for i in range(post_bars):
            prog = (i + 1) / max(post_bars, 1)
            target = t3 + (post_target - t3) * prog
            c = target + rng.uniform(-0.15, 0.15)
            o = target + rng.uniform(-0.15, 0.15)
            h = max(c, o) + abs(rng.uniform(0, 0.3))
            l = min(c, o) - abs(rng.uniform(0, 0.3))
            v = preamble_vol * 1.0 * rng.uniform(0.9, 1.1)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += 86400
    else:
        # Break decisively above the peaks
        peak_avg = (p1 + p2) / 2
        for i in range(6):
            new_c = peak_avg * (1.0 + 0.025 * (i + 1)) + rng.uniform(-0.2, 0.2)
            new_o = new_c + rng.uniform(-0.3, 0.3)
            new_l = min(new_c, new_o) - abs(rng.uniform(0, 0.3))
            new_h = max(new_c, new_o) + abs(rng.uniform(0.3, 0.8))
            v = preamble_vol * 2.0
            bars.append({"t": t, "o": round(new_o, 2), "h": round(new_h, 2),
                         "l": round(new_l, 2), "c": round(new_c, 2), "v": round(v, 0)})
            t += 86400

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
    # POSITIVE -------------------------------------------------------------------
    _write("clean_triple_bottom", "positive",
           dict(trough_price=80.0, peak_price=88.0, trough_spacing=16,
                trough_jitter=0.005, peak_jitter=0.01, seed=1),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "neckline"})

    _write("textbook_setup", "positive",
           dict(trough_price=60.0, peak_price=66.0, trough_spacing=18,
                trough_jitter=0.005, peak_jitter=0.01, seed=2),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("wider_spacing", "positive",
           dict(trough_price=120.0, peak_price=132.0, trough_spacing=22,
                trough_jitter=0.01, peak_jitter=0.015, seed=3),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("tight_troughs", "positive",
           dict(trough_price=50.0, peak_price=55.0, trough_spacing=15,
                trough_jitter=0.002, peak_jitter=0.005, seed=4),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    _write("perfect_expanding_vol", "positive",
           dict(trough_price=200.0, peak_price=220.0, trough_spacing=14,
                trough_jitter=0.003, peak_jitter=0.005,
                volume_pattern="expanding", seed=5),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    # NEGATIVE -------------------------------------------------------------------
    _write("only_two_troughs", "negative",
           dict(trough_price=80.0, peak_price=88.0, trough_spacing=16,
                trough_jitter=0.005, only_two_troughs=True, seed=10),
           {"fires": False})

    _write("troughs_too_close", "negative",
           dict(trough_price=80.0, peak_price=88.0, troughs_too_close=True,
                trough_jitter=0.005, seed=11),
           {"fires": False})

    _write("trough_mismatch", "negative",
           dict(trough_price=80.0, peak_price=88.0, trough_spacing=16,
                trough_jitter=0.05, seed=12),  # 5% jitter = too much spread
           {"fires": False})

    _write("peak_mismatch", "negative",
           dict(trough_price=80.0, peak_price=88.0, trough_spacing=16,
                trough_jitter=0.005, peak_mismatch=True, seed=13),
           {"fires": False})

    _write("pattern_too_short", "negative",
           dict(trough_price=80.0, peak_price=88.0, trough_spacing=8,
                preamble_bars=2, post_bars=2, trough_jitter=0.005, seed=14),
           {"fires": False})

    _write("already_broken", "negative",
           dict(trough_price=80.0, peak_price=88.0, trough_spacing=16,
                trough_jitter=0.005, already_broken=True, seed=15),
           {"fires": False})

    _write("choppy_no_structure", "negative",
           dict(trough_price=80.0, peak_price=88.0, trough_spacing=16,
                trough_jitter=0.005, choppy=True, seed=16),
           {"fires": False})

    _write("contracting_volume", "negative",
           dict(trough_price=80.0, peak_price=88.0, trough_spacing=16,
                trough_jitter=0.06, volume_pattern="contracting", seed=17),
           {"fires": False})

    # EDGE -----------------------------------------------------------------------
    _write("min_spacing", "edge",
           dict(trough_price=80.0, peak_price=88.0, trough_spacing=15,
                trough_jitter=0.01, peak_jitter=0.02, seed=20),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    _write("long_pattern", "edge",
           dict(trough_price=80.0, peak_price=88.0, trough_spacing=28,
                trough_jitter=0.01, peak_jitter=0.02, seed=21),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
