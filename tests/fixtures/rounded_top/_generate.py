"""One-shot generator for the rounded_top fixture battery.

Run: python tests/fixtures/rounded_top/_generate.py

Rounded Top = slow inverted-U distribution pattern WITHOUT a rally handle.
The right side declines cleanly from the dome peak through the rim.
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _build_bars(bars_count, left_rim, dome_peak, right_rim=None,
                volume_pattern="rounded", preamble_bars=8,
                inverted_v=False, has_rally_handle=False, no_curve=False,
                shallow=False, choppy=False, already_broken=False,
                rim_mismatch=False, normal_u=False, seed=42):
    """Synthetic OHLCV with an inverted-U rounded top.

    left_rim is the LOW at left, dome_peak is the HIGH in the middle,
    right_rim is the LOW at right. The pattern bars form an inverted-U.
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000

    if right_rim is None:
        right_rim = left_rim
    if rim_mismatch:
        right_rim = left_rim * 1.15

    preamble_vol = 1500.0
    # Preamble: downtrend INTO the left rim from above
    for i in range(preamble_bars):
        prog = i / max(preamble_bars - 1, 1)
        start = left_rim * 1.15
        target = start + (left_rim - start) * prog
        c = target + rng.uniform(-0.3, 0.3)
        o = target + rng.uniform(-0.3, 0.3)
        h = max(c, o) + abs(rng.uniform(0, 0.4))
        l = min(c, o) - abs(rng.uniform(0, 0.4))
        v = preamble_vol * rng.uniform(0.9, 1.2)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += 86400

    mid = bars_count / 2.0
    for i in range(bars_count):
        x = i
        # Inverted quadratic: y = -A*(x - mid)^2 + dome_peak
        if mid > 0:
            A_left = (dome_peak - left_rim) / (mid ** 2)
            A_right = (dome_peak - right_rim) / ((bars_count - 1 - mid) ** 2)
        else:
            A_left = A_right = 0
        if x <= mid:
            y = -A_left * (x - mid) ** 2 + dome_peak
        else:
            y = -A_right * (x - mid) ** 2 + dome_peak

        if inverted_v:
            # Sharp inverted V
            if x <= mid:
                y = left_rim + (dome_peak - left_rim) * (x / max(mid, 1))
            else:
                y = dome_peak + (right_rim - dome_peak) * ((x - mid) / max(bars_count - 1 - mid, 1))

        if normal_u:
            # Flip to make a normal (concave-up) U - should be rejected
            y = left_rim + dome_peak - y

        if no_curve:
            y = (left_rim + dome_peak + right_rim) / 3.0 + rng.uniform(-2.0, 2.0)

        c = y + rng.uniform(-0.2, 0.2)
        o = y + rng.uniform(-0.2, 0.2)
        h = max(c, o) + abs(rng.uniform(0, 0.3))
        l = min(c, o) - abs(rng.uniform(0, 0.3))

        if choppy:
            if not hasattr(rng, '_cw'):
                rng._cw = (left_rim + dome_peak) / 2.0
            rng._cw += rng.uniform(-4.5, 4.5)
            c = rng._cw + rng.uniform(-1.5, 1.5)
            o = rng._cw + rng.uniform(-1.5, 1.5)
            h = max(c, o) + abs(rng.uniform(1.0, 3.0))
            l = min(c, o) - abs(rng.uniform(1.0, 3.0))

        if volume_pattern == "rounded":
            third = bars_count // 3
            if i < third:
                v_factor = 1.0
            elif i < 2 * third:
                v_factor = 0.55
            else:
                v_factor = 1.4
        else:
            v_factor = 1.0
        v = preamble_vol * v_factor * rng.uniform(0.9, 1.1)

        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += 86400

    if has_rally_handle:
        rally_high = right_rim * 1.08  # 8% rally
        h_bars = 10
        for i in range(h_bars):
            if i < h_bars // 2:
                y = right_rim + (rally_high - right_rim) * (i / max(h_bars // 2 - 1, 1))
            else:
                y = rally_high + (right_rim * 1.03 - rally_high) * \
                    ((i - h_bars // 2) / max(h_bars // 2 - 1, 1))
            c = y + rng.uniform(-0.2, 0.2)
            o = y + rng.uniform(-0.2, 0.2)
            h = max(c, o) + abs(rng.uniform(0, 0.3))
            l = min(c, o) - abs(rng.uniform(0, 0.3))
            v = preamble_vol * 0.7 * rng.uniform(0.8, 1.1)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += 86400
        return bars

    if already_broken:
        for i in range(5):
            new_c = right_rim * (1.0 - 0.025 * (i + 1)) + rng.uniform(-0.2, 0.2)
            new_o = new_c + rng.uniform(-0.3, 0.3)
            new_h = max(new_c, new_o) + abs(rng.uniform(0, 0.3))
            new_l = min(new_c, new_o) - abs(rng.uniform(0.3, 0.8))
            v = preamble_vol * 2.0
            bars.append({"t": t, "o": round(new_o, 2), "h": round(new_h, 2),
                         "l": round(new_l, 2), "c": round(new_c, 2), "v": round(v, 0)})
            t += 86400
        return bars

    # Default tail: a few flat bars just ABOVE the right rim so right_rim
    # registers as a local-minimum swing-low pivot.
    tail_bars = 4
    tail_target = right_rim * 1.015
    for i in range(tail_bars):
        c = tail_target + rng.uniform(-0.15, 0.15)
        o = tail_target + rng.uniform(-0.15, 0.15)
        h = max(c, o) + abs(rng.uniform(0, 0.25))
        l = min(c, o) - abs(rng.uniform(0, 0.25))
        v = preamble_vol * 1.2 * rng.uniform(0.9, 1.1)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
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
    _write("clean_rounded_top", "positive",
           dict(bars_count=60, left_rim=80.0, dome_peak=100.0, right_rim=80.0,
                seed=1),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "cup_curve"})

    _write("longer_dome", "positive",
           dict(bars_count=90, left_rim=64.0, dome_peak=80.0, right_rim=64.0,
                seed=2),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("textbook_depth", "positive",
           dict(bars_count=60, left_rim=96.0, dome_peak=120.0, right_rim=96.0,
                seed=3),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("deep_top", "positive",
           dict(bars_count=70, left_rim=42.0, dome_peak=60.0, right_rim=42.0,
                seed=4),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("perfect_setup", "positive",
           dict(bars_count=55, left_rim=160.0, dome_peak=200.0, right_rim=160.0,
                seed=5),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    # NEGATIVE -------------------------------------------------------------------
    _write("inverted_v_not_rounded", "negative",
           dict(bars_count=60, left_rim=80.0, dome_peak=100.0, right_rim=80.0,
                inverted_v=True, seed=10),
           {"fires": False})

    _write("has_rally_handle", "negative",
           dict(bars_count=55, left_rim=80.0, dome_peak=100.0, right_rim=80.0,
                has_rally_handle=True, seed=11),
           {"fires": False})

    _write("no_curve", "negative",
           dict(bars_count=60, left_rim=85.0, dome_peak=100.0, right_rim=85.0,
                no_curve=True, seed=12),
           {"fires": False})

    _write("shallow_depth", "negative",
           dict(bars_count=60, left_rim=95.0, dome_peak=100.0, right_rim=95.0,
                shallow=True, seed=13),
           {"fires": False})

    _write("pattern_too_short", "negative",
           dict(bars_count=20, left_rim=80.0, dome_peak=100.0, right_rim=80.0,
                seed=14),
           {"fires": False})

    _write("choppy_no_structure", "negative",
           dict(bars_count=60, left_rim=80.0, dome_peak=100.0, right_rim=80.0,
                choppy=True, seed=15),
           {"fires": False})

    _write("rim_mismatch", "negative",
           dict(bars_count=60, left_rim=80.0, dome_peak=100.0, right_rim=80.0,
                rim_mismatch=True, seed=16),
           {"fires": False})

    _write("normal_u_not_dome", "negative",
           dict(bars_count=60, left_rim=80.0, dome_peak=100.0, right_rim=80.0,
                normal_u=True, seed=17),
           {"fires": False})

    # EDGE -----------------------------------------------------------------------
    _write("boundary_min_bars", "edge",
           dict(bars_count=32, left_rim=85.0, dome_peak=100.0, right_rim=85.0,
                seed=20),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    _write("near_max_length", "edge",
           dict(bars_count=115, left_rim=40.0, dome_peak=50.0, right_rim=40.0,
                seed=21),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
