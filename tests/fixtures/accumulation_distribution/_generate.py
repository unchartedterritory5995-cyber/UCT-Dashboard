"""One-shot generator for the accumulation_distribution fixture battery.

Run: python tests/fixtures/accumulation_distribution/_generate.py

Williams A/D Line over 30 bars + Wyckoff phase classification.
ad_score > 0.30 -> accumulation
ad_score < -0.30 -> distribution
else -> neutral

ALWAYS emits exactly 1 Detection (when bars >= 30).
"""
import json
import math
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))

T0 = 1700000000
DT = 86400


def _bar(t, o, h, l, c, v):
    return {
        "t": int(t),
        "o": round(float(o), 2),
        "h": round(float(h), 2),
        "l": round(float(l), 2),
        "c": round(float(c), 2),
        "v": round(float(v), 0),
    }


def _build_clean_accumulation_high_score(seed=1, n_bars=35):
    """Strong accumulation: every bar closes near its high on heavy volume."""
    rng = random.Random(seed)
    bars = []
    t = T0
    price = 100.0
    for i in range(n_bars):
        rng_size = 1.2
        o = price - rng.uniform(0.0, 0.4)
        h = o + rng_size + rng.uniform(0, 0.3)
        l = o - rng.uniform(0, 0.2)
        # Close near the high (CLV ~ +0.8)
        c = h - rng.uniform(0.05, 0.25)
        v = 1500.0 * rng.uniform(1.0, 1.5)
        bars.append(_bar(t, o, h, l, c, v))
        price += rng.uniform(0.05, 0.3)
        t += DT
    return bars


def _build_clean_distribution_low_score(seed=2, n_bars=35):
    """Strong distribution: every bar closes near its low on heavy volume."""
    rng = random.Random(seed)
    bars = []
    t = T0
    price = 100.0
    for i in range(n_bars):
        rng_size = 1.2
        o = price + rng.uniform(0.0, 0.4)
        l = o - rng_size - rng.uniform(0, 0.3)
        h = o + rng.uniform(0, 0.2)
        # Close near the low (CLV ~ -0.8)
        c = l + rng.uniform(0.05, 0.25)
        v = 1500.0 * rng.uniform(1.0, 1.5)
        bars.append(_bar(t, o, h, l, c, v))
        price -= rng.uniform(0.05, 0.3)
        t += DT
    return bars


def _build_transitioning_into_acc(seed=3, n_bars=35):
    """First 15 bars: mid-range closes. Last 15 bars: high closes (transition)."""
    rng = random.Random(seed)
    bars = []
    t = T0
    price = 90.0
    for i in range(n_bars):
        rng_size = 1.0
        o = price + rng.uniform(-0.3, 0.3)
        h = o + rng_size + rng.uniform(0, 0.2)
        l = o - rng_size - rng.uniform(0, 0.2)
        if i < 15:
            # Mid-range
            c = (h + l) / 2 + rng.uniform(-0.2, 0.2)
        else:
            # High closes
            c = h - rng.uniform(0.05, 0.2)
            price += 0.15
        v = 1200.0 * rng.uniform(0.9, 1.3)
        bars.append(_bar(t, o, h, l, c, v))
        t += DT
    return bars


def _build_transitioning_into_dist(seed=4, n_bars=35):
    """First 15 bars: mid-range closes. Last 15 bars: low closes."""
    rng = random.Random(seed)
    bars = []
    t = T0
    price = 110.0
    for i in range(n_bars):
        rng_size = 1.0
        o = price + rng.uniform(-0.3, 0.3)
        h = o + rng_size + rng.uniform(0, 0.2)
        l = o - rng_size - rng.uniform(0, 0.2)
        if i < 15:
            c = (h + l) / 2 + rng.uniform(-0.2, 0.2)
        else:
            c = l + rng.uniform(0.05, 0.2)
            price -= 0.15
        v = 1200.0 * rng.uniform(0.9, 1.3)
        bars.append(_bar(t, o, h, l, c, v))
        t += DT
    return bars


def _build_accumulation_with_bullish_divergence(seed=5, n_bars=35):
    """Price slowly drifts DOWN but each bar closes near its high.

    This produces a bullish A/D divergence (price down, A/D up).
    """
    rng = random.Random(seed)
    bars = []
    t = T0
    price = 120.0
    for i in range(n_bars):
        rng_size = 1.0
        o = price + rng.uniform(-0.2, 0.2)
        h = o + rng_size + rng.uniform(0, 0.2)
        l = o - rng_size - rng.uniform(0, 0.2)
        # Close near high
        c = h - rng.uniform(0.05, 0.2)
        v = 1300.0 * rng.uniform(0.9, 1.2)
        bars.append(_bar(t, o, h, l, c, v))
        # Price slowly drifts down
        price -= 0.25
        t += DT
    return bars


def _build_flat_neutral(seed=10, n_bars=35):
    """Mid-range closes throughout - balanced two-sided flow."""
    rng = random.Random(seed)
    bars = []
    t = T0
    price = 100.0
    for i in range(n_bars):
        rng_size = 1.0
        o = price + rng.uniform(-0.3, 0.3)
        h = o + rng_size + rng.uniform(0, 0.2)
        l = o - rng_size - rng.uniform(0, 0.2)
        # Tight mid-range close
        c = (h + l) / 2 + rng.uniform(-0.15, 0.15)
        v = 1000.0 * rng.uniform(0.9, 1.1)
        bars.append(_bar(t, o, h, l, c, v))
        price += rng.uniform(-0.2, 0.2)
        t += DT
    return bars


def _build_short_series(seed=11, n_bars=25):
    """Less than the 30-bar minimum."""
    rng = random.Random(seed)
    bars = []
    t = T0
    for i in range(n_bars):
        mid = 100.0 + rng.uniform(-2, 2)
        bars.append(_bar(t, mid, mid + 0.5, mid - 0.5, mid, 1000.0))
        t += DT
    return bars


def _build_bear_no_distribution(seed=12, n_bars=35):
    """Price declines, but bars close mid-range (no distribution signature)."""
    rng = random.Random(seed)
    bars = []
    t = T0
    price = 110.0
    for i in range(n_bars):
        o = price + rng.uniform(-0.3, 0.3)
        rng_size = 1.0
        h = o + rng_size + rng.uniform(0, 0.2)
        l = o - rng_size - rng.uniform(0, 0.2)
        c = (h + l) / 2 + rng.uniform(-0.15, 0.15)
        v = 1000.0 * rng.uniform(0.9, 1.1)
        bars.append(_bar(t, o, h, l, c, v))
        price -= 0.2
        t += DT
    return bars


def _build_bull_no_accumulation(seed=13, n_bars=35):
    """Price rises, but bars close mid-range (no accumulation signature)."""
    rng = random.Random(seed)
    bars = []
    t = T0
    price = 100.0
    for i in range(n_bars):
        o = price + rng.uniform(-0.3, 0.3)
        rng_size = 1.0
        h = o + rng_size + rng.uniform(0, 0.2)
        l = o - rng_size - rng.uniform(0, 0.2)
        c = (h + l) / 2 + rng.uniform(-0.15, 0.15)
        v = 1000.0 * rng.uniform(0.9, 1.1)
        bars.append(_bar(t, o, h, l, c, v))
        price += 0.2
        t += DT
    return bars


def _build_alternating_no_clear_phase(seed=14, n_bars=35):
    """Alternating high-close and low-close bars - cancels out."""
    rng = random.Random(seed)
    bars = []
    t = T0
    price = 100.0
    for i in range(n_bars):
        rng_size = 1.0
        o = price + rng.uniform(-0.3, 0.3)
        h = o + rng_size + rng.uniform(0, 0.2)
        l = o - rng_size - rng.uniform(0, 0.2)
        if i % 2 == 0:
            c = h - rng.uniform(0.05, 0.2)
        else:
            c = l + rng.uniform(0.05, 0.2)
        v = 1000.0 * rng.uniform(0.9, 1.1)
        bars.append(_bar(t, o, h, l, c, v))
        t += DT
    return bars


def _build_zero_volume(seed=15, n_bars=35):
    """All zero volume bars - detector cannot fire (sum_volume == 0)."""
    bars = []
    t = T0
    for i in range(n_bars):
        mid = 100.0 + i * 0.1
        bars.append(_bar(t, mid, mid + 0.5, mid - 0.5, mid, 0.0))
        t += DT
    return bars


def _build_zero_range_bars(seed=16, n_bars=35):
    """All bars have h == l (zero range) - per-bar money_flow is 0."""
    bars = []
    t = T0
    for i in range(n_bars):
        mid = 100.0 + i * 0.1
        bars.append(_bar(t, mid, mid, mid, mid, 1000.0))
        t += DT
    return bars


def _build_extremely_low_ad(seed=17, n_bars=35):
    """Mild positive flow but well below the 0.30 accumulation threshold."""
    rng = random.Random(seed)
    bars = []
    t = T0
    price = 100.0
    for i in range(n_bars):
        rng_size = 1.0
        o = price + rng.uniform(-0.3, 0.3)
        h = o + rng_size + rng.uniform(0, 0.2)
        l = o - rng_size - rng.uniform(0, 0.2)
        # Close just above mid (CLV ~+0.1)
        c = (h + l) / 2 + rng.uniform(0.05, 0.15)
        v = 1000.0 * rng.uniform(0.9, 1.1)
        bars.append(_bar(t, o, h, l, c, v))
        price += rng.uniform(-0.1, 0.1)
        t += DT
    return bars


def _build_boundary_ad_at_threshold(seed=20, n_bars=35):
    """A/D score sits right around the 0.30 accumulation threshold."""
    rng = random.Random(seed)
    bars = []
    t = T0
    price = 100.0
    for i in range(n_bars):
        rng_size = 1.0
        o = price + rng.uniform(-0.3, 0.3)
        h = o + rng_size + rng.uniform(0, 0.2)
        l = o - rng_size - rng.uniform(0, 0.2)
        # Mix: ~60% high closes, 40% mid - aim for ad_score near +0.30
        if i % 3 < 2:
            c = h - rng.uniform(0.1, 0.3)
        else:
            c = (h + l) / 2 + rng.uniform(-0.1, 0.1)
        v = 1000.0 * rng.uniform(0.9, 1.1)
        bars.append(_bar(t, o, h, l, c, v))
        price += rng.uniform(-0.05, 0.10)
        t += DT
    return bars


def _build_boundary_ad_at_negative_threshold(seed=21, n_bars=35):
    """A/D score sits right around the -0.30 distribution threshold."""
    rng = random.Random(seed)
    bars = []
    t = T0
    price = 110.0
    for i in range(n_bars):
        rng_size = 1.0
        o = price + rng.uniform(-0.3, 0.3)
        h = o + rng_size + rng.uniform(0, 0.2)
        l = o - rng_size - rng.uniform(0, 0.2)
        # Mix: ~60% low closes, 40% mid - aim for ad_score near -0.30
        if i % 3 < 2:
            c = l + rng.uniform(0.1, 0.3)
        else:
            c = (h + l) / 2 + rng.uniform(-0.1, 0.1)
        v = 1000.0 * rng.uniform(0.9, 1.1)
        bars.append(_bar(t, o, h, l, c, v))
        price -= rng.uniform(-0.05, 0.10)
        t += DT
    return bars


GOOD_CONTEXT = {
    "trend_stage": 2,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "neutral",
    "regime": "bullish",
    "nearest_resistance": None,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}


def _write(name, category, bars, context, expected):
    payload = {
        "name": name,
        "category": category,
        "expected": expected,
        "context": context,
        "bars": bars,
    }
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


def main():
    # ===== 5 POSITIVE =====
    # All positives emit exactly 1 Detection (the detector always emits 1
    # when bars >= 30 and sum_volume > 0). The expected_phase is checked
    # in the test.
    _write("clean_accumulation_high_score", "positive",
           _build_clean_accumulation_high_score(seed=1),
           GOOD_CONTEXT,
           {"fires": True, "min_count": 1, "max_count": 1,
            "min_confidence": 50.0, "max_confidence": 100.0,
            "expected_phase": "accumulation"})

    _write("clean_distribution_low_score", "positive",
           _build_clean_distribution_low_score(seed=2),
           GOOD_CONTEXT,
           {"fires": True, "min_count": 1, "max_count": 1,
            "min_confidence": 50.0, "max_confidence": 100.0,
            "expected_phase": "distribution"})

    _write("transitioning_into_acc", "positive",
           _build_transitioning_into_acc(seed=3),
           GOOD_CONTEXT,
           {"fires": True, "min_count": 1, "max_count": 1,
            "min_confidence": 50.0, "max_confidence": 100.0,
            "expected_phase": "accumulation"})

    _write("transitioning_into_dist", "positive",
           _build_transitioning_into_dist(seed=4),
           GOOD_CONTEXT,
           {"fires": True, "min_count": 1, "max_count": 1,
            "min_confidence": 50.0, "max_confidence": 100.0,
            "expected_phase": "distribution"})

    _write("accumulation_with_bullish_divergence", "positive",
           _build_accumulation_with_bullish_divergence(seed=5),
           GOOD_CONTEXT,
           {"fires": True, "min_count": 1, "max_count": 1,
            "min_confidence": 50.0, "max_confidence": 100.0,
            "expected_phase": "accumulation",
            "expected_divergence": "bullish"})

    # ===== 8 NEGATIVE =====
    # Note: for accumulation_distribution, "negative" means "does not classify
    # as accumulation or distribution" - the detector still fires but with
    # phase == "neutral", OR it fires with insufficient bars (0 detections).
    _write("flat_neutral", "negative",
           _build_flat_neutral(seed=10),
           GOOD_CONTEXT,
           {"fires": True, "min_count": 1, "max_count": 1,
            "min_confidence": 50.0, "max_confidence": 100.0,
            "expected_phase": "neutral"})

    _write("short_series", "negative",
           _build_short_series(seed=11),
           GOOD_CONTEXT,
           {"fires": False, "min_count": 0, "max_count": 0,
            "min_confidence": 0.0, "max_confidence": 100.0})

    _write("bear_no_distribution", "negative",
           _build_bear_no_distribution(seed=12),
           GOOD_CONTEXT,
           {"fires": True, "min_count": 1, "max_count": 1,
            "min_confidence": 50.0, "max_confidence": 100.0,
            "expected_phase": "neutral"})

    _write("bull_no_accumulation", "negative",
           _build_bull_no_accumulation(seed=13),
           GOOD_CONTEXT,
           {"fires": True, "min_count": 1, "max_count": 1,
            "min_confidence": 50.0, "max_confidence": 100.0,
            "expected_phase": "neutral"})

    _write("alternating_no_clear_phase", "negative",
           _build_alternating_no_clear_phase(seed=14),
           GOOD_CONTEXT,
           {"fires": True, "min_count": 1, "max_count": 1,
            "min_confidence": 50.0, "max_confidence": 100.0,
            "expected_phase": "neutral"})

    _write("zero_volume", "negative",
           _build_zero_volume(seed=15),
           GOOD_CONTEXT,
           {"fires": False, "min_count": 0, "max_count": 0,
            "min_confidence": 0.0, "max_confidence": 100.0})

    _write("zero_range_bars", "negative",
           _build_zero_range_bars(seed=16),
           GOOD_CONTEXT,
           {"fires": False, "min_count": 0, "max_count": 0,
            "min_confidence": 0.0, "max_confidence": 100.0})

    _write("extremely_low_ad", "negative",
           _build_extremely_low_ad(seed=17),
           GOOD_CONTEXT,
           {"fires": True, "min_count": 1, "max_count": 1,
            "min_confidence": 50.0, "max_confidence": 100.0,
            "expected_phase": "neutral"})

    # ===== 2 EDGE =====
    _write("boundary_ad_at_threshold", "edge",
           _build_boundary_ad_at_threshold(seed=20),
           GOOD_CONTEXT,
           {"fires": True, "min_count": 1, "max_count": 1,
            "min_confidence": 50.0, "max_confidence": 100.0})

    _write("boundary_ad_at_negative_threshold", "edge",
           _build_boundary_ad_at_negative_threshold(seed=21),
           GOOD_CONTEXT,
           {"fires": True, "min_count": 1, "max_count": 1,
            "min_confidence": 50.0, "max_confidence": 100.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
