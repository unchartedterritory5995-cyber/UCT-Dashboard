"""One-shot generator for the triple_top fixture battery.

Run: python tests/fixtures/triple_top/_generate.py

Triple Top = 3 peaks at similar prices (within 3%) with 2 retrace troughs
(within 5% of each other) between them. Stricter version of double_top.
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _build_bars(peak_price, trough_price, peak_spacing=15,
                peak_jitter=0.0, trough_jitter=0.0,
                preamble_bars=10, post_bars=5,
                only_two_peaks=False, peak_too_close=False,
                trough_mismatch=False, already_broken=False,
                volume_pattern="declining", choppy=False, seed=42):
    """Build OHLCV with 3 peaks at similar heights and 2 troughs between.

    peak_jitter: variation in peak prices (e.g. 0.02 = 2% spread)
    trough_jitter: variation in trough prices
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000

    preamble_vol = 1500.0
    # Preamble: uptrend into first peak
    start = peak_price * 0.85
    for i in range(preamble_bars):
        prog = i / max(preamble_bars - 1, 1)
        target = start + (peak_price - start) * prog
        c = target + rng.uniform(-0.3, 0.3)
        o = target + rng.uniform(-0.3, 0.3)
        h = max(c, o) + abs(rng.uniform(0, 0.4))
        l = min(c, o) - abs(rng.uniform(0, 0.4))
        v = preamble_vol * rng.uniform(0.9, 1.2)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += 86400

    # Determine peak prices with jitter
    p1 = peak_price * (1.0 + rng.uniform(-peak_jitter, peak_jitter))
    p2 = peak_price * (1.0 + rng.uniform(-peak_jitter, peak_jitter))
    p3 = peak_price * (1.0 + rng.uniform(-peak_jitter, peak_jitter))
    if peak_too_close:
        # Force peaks too close together (under min spacing)
        peak_spacing = 4

    t1 = trough_price * (1.0 + rng.uniform(-trough_jitter, trough_jitter))
    t2 = trough_price * (1.0 + rng.uniform(-trough_jitter, trough_jitter))
    if trough_mismatch:
        t2 = trough_price * 0.85  # 15% mismatch

    # Each segment: from current peak DOWN to next trough, then UP to next peak
    half = peak_spacing // 2

    def _segment_to(target_price, length, vol_factor):
        """Add `length` bars moving from current price to target_price.

        If `choppy` is set, ignores target_price entirely and produces a pure
        random walk to destroy any embedded peak/trough structure.
        """
        nonlocal t
        if not bars:
            start_c = peak_price
        else:
            start_c = bars[-1]["c"]
        for i in range(length):
            if choppy:
                if not hasattr(rng, '_cw'):
                    rng._cw = peak_price * 0.95
                rng._cw += rng.uniform(-6.0, 6.0)
                c = rng._cw + rng.uniform(-2.0, 2.0)
                o = rng._cw + rng.uniform(-2.0, 2.0)
                h = max(c, o) + abs(rng.uniform(1.5, 4.0))
                l = min(c, o) - abs(rng.uniform(1.5, 4.0))
            else:
                prog = (i + 1) / max(length, 1)
                target = start_c + (target_price - start_c) * prog
                c = target + rng.uniform(-0.2, 0.2)
                o = target + rng.uniform(-0.2, 0.2)
                h = max(c, o) + abs(rng.uniform(0, 0.3))
                l = min(c, o) - abs(rng.uniform(0, 0.3))
            v = preamble_vol * vol_factor * rng.uniform(0.9, 1.1)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += 86400

    def _peak_bar(peak_p, vol_factor):
        nonlocal t
        c = peak_p - rng.uniform(0.05, 0.4)
        o = c - rng.uniform(-0.2, 0.2)
        h = peak_p + abs(rng.uniform(0, 0.2))
        l = min(c, o) - abs(rng.uniform(0, 0.3))
        v = preamble_vol * vol_factor * rng.uniform(0.9, 1.1)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += 86400

    # P1 (already at peak from preamble)
    _peak_bar(p1, 1.5)

    if volume_pattern == "declining":
        v1, v2, v3 = 1.3, 0.9, 0.55
    elif volume_pattern == "expanding":
        v1, v2, v3 = 0.7, 1.0, 1.5
    else:
        v1, v2, v3 = 1.0, 1.0, 1.0

    # P1 -> trough1 -> P2
    _segment_to(t1, half, vol_factor=v1)
    _segment_to(p2, half, vol_factor=v2)
    if only_two_peaks:
        # Stop after P2 (just a double-top)
        _peak_bar(p2, v2)
    else:
        _peak_bar(p2, v2)
        # P2 -> trough2 -> P3
        _segment_to(t2, half, vol_factor=v2)
        _segment_to(p3, half, vol_factor=v3)
        _peak_bar(p3, v3)

    # Post-pattern bars: stay below P3 so P3 registers as a swing high
    if not already_broken:
        # Drift down toward the trough confluence but stay above it (no break yet)
        post_target = (t1 + t2) / 2 * 1.03
        for i in range(post_bars):
            prog = (i + 1) / max(post_bars, 1)
            target = p3 + (post_target - p3) * prog
            c = target + rng.uniform(-0.15, 0.15)
            o = target + rng.uniform(-0.15, 0.15)
            h = max(c, o) + abs(rng.uniform(0, 0.3))
            l = min(c, o) - abs(rng.uniform(0, 0.3))
            v = preamble_vol * 1.0 * rng.uniform(0.9, 1.1)
            bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                         "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
            t += 86400
    else:
        # Break decisively below the troughs
        trough_avg = (t1 + t2) / 2
        for i in range(6):
            new_c = trough_avg * (1.0 - 0.025 * (i + 1)) + rng.uniform(-0.2, 0.2)
            new_o = new_c + rng.uniform(-0.3, 0.3)
            new_h = max(new_c, new_o) + abs(rng.uniform(0, 0.3))
            new_l = min(new_c, new_o) - abs(rng.uniform(0.3, 0.8))
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
    _write("clean_triple_top", "positive",
           dict(peak_price=100.0, trough_price=92.0, peak_spacing=16,
                peak_jitter=0.005, trough_jitter=0.01, seed=1),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0,
            "geometry_shape": "neckline"})

    _write("textbook_setup", "positive",
           dict(peak_price=120.0, trough_price=108.0, peak_spacing=18,
                peak_jitter=0.005, trough_jitter=0.01, seed=2),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("wider_spacing", "positive",
           dict(peak_price=80.0, trough_price=72.0, peak_spacing=22,
                peak_jitter=0.01, trough_jitter=0.015, seed=3),
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("tight_peaks", "positive",
           dict(peak_price=200.0, trough_price=180.0, peak_spacing=15,
                peak_jitter=0.002, trough_jitter=0.005, seed=4),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    _write("perfect_declining_vol", "positive",
           dict(peak_price=60.0, trough_price=54.0, peak_spacing=14,
                peak_jitter=0.003, trough_jitter=0.005,
                volume_pattern="declining", seed=5),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    # NEGATIVE -------------------------------------------------------------------
    _write("only_two_peaks", "negative",
           dict(peak_price=100.0, trough_price=92.0, peak_spacing=16,
                peak_jitter=0.005, only_two_peaks=True, seed=10),
           {"fires": False})

    _write("peaks_too_close", "negative",
           dict(peak_price=100.0, trough_price=92.0, peak_too_close=True,
                peak_jitter=0.005, seed=11),
           {"fires": False})

    _write("peak_mismatch", "negative",
           dict(peak_price=100.0, trough_price=92.0, peak_spacing=16,
                peak_jitter=0.05, seed=12),  # 5% jitter = too much spread
           {"fires": False})

    _write("trough_mismatch", "negative",
           dict(peak_price=100.0, trough_price=92.0, peak_spacing=16,
                peak_jitter=0.005, trough_mismatch=True, seed=13),
           {"fires": False})

    _write("pattern_too_short", "negative",
           dict(peak_price=100.0, trough_price=92.0, peak_spacing=8,
                preamble_bars=2, post_bars=2, peak_jitter=0.005, seed=14),
           {"fires": False})

    _write("already_broken", "negative",
           dict(peak_price=100.0, trough_price=92.0, peak_spacing=16,
                peak_jitter=0.005, already_broken=True, seed=15),
           {"fires": False})

    _write("choppy_no_structure", "negative",
           dict(peak_price=100.0, trough_price=92.0, peak_spacing=16,
                peak_jitter=0.005, choppy=True, seed=16),
           {"fires": False})

    _write("expanding_volume", "negative",
           dict(peak_price=100.0, trough_price=92.0, peak_spacing=16,
                peak_jitter=0.06, volume_pattern="expanding", seed=17),
           {"fires": False})

    # EDGE -----------------------------------------------------------------------
    _write("min_spacing", "edge",
           dict(peak_price=100.0, trough_price=92.0, peak_spacing=15,
                peak_jitter=0.01, trough_jitter=0.02, seed=20),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    _write("long_pattern", "edge",
           dict(peak_price=100.0, trough_price=92.0, peak_spacing=28,
                peak_jitter=0.01, trough_jitter=0.02, seed=21),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 95.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
