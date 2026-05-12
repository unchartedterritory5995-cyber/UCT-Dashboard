"""One-shot generator for the power_earnings_gap fixture battery.

Run: python tests/fixtures/power_earnings_gap/_generate.py

A Power Earnings Gap (PEG) is a single bar that gaps up >=4% on >=3x avg
volume, then is followed by 3-10 bars of tight post-gap consolidation that
HOLDS above the gap-up open (no fill).

Generator builds:
  prior_drift (gentle uptrend so context isn't Stage 4)
   -> 20-bar baseline (settles avg volume + range)
   -> the gap bar (open jumps gap_pct above prior close, big volume)
   -> N tight post-gap bars holding above gap_open
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _make_bar(t, mid_price, vol, rng, noise=0.20,
              force_low=None, force_high=None, force_close=None, force_open=None):
    """Build a generic OHLC bar centered on mid_price."""
    o = mid_price + rng.uniform(-noise, noise) if force_open is None else force_open
    c = mid_price + rng.uniform(-noise, noise) if force_close is None else force_close
    h = max(o, c) + abs(rng.uniform(0, noise * 1.2))
    l = min(o, c) - abs(rng.uniform(0, noise * 1.2))
    if force_high is not None:
        h = max(h, force_high)
    if force_low is not None:
        l = min(l, force_low)
    return {
        "t": t,
        "o": round(o, 2),
        "h": round(h, 2),
        "l": round(l, 2),
        "c": round(c, 2),
        "v": round(vol * rng.uniform(0.85, 1.15), 0),
    }


def _build_peg_bars(
    base_price=50.0,
    prior_drift_bars=25,             # bars leading INTO the baseline (gentle uptrend)
    prior_drift_pct=0.08,            # gentle prior advance
    baseline_bars=20,                # bars setting up the 20-bar avg
    baseline_vol=1000.0,
    baseline_noise=0.20,             # daily mid-price noise during baseline
    gap_pct=0.06,                    # gap-up size: (open - prior_close) / prior_close
    gap_volume_ratio=4.0,            # gap bar volume vs 20-bar avg
    gap_close_strength=0.85,         # where in gap bar's range close lands
    post_gap_bars=5,                 # bars after the gap
    post_gap_tightness=0.30,         # avg post-gap range / gap_bar_range
    post_gap_drift_pct=0.0,          # bias: 0 = sideways, negative drifts down toward gap
    post_gap_fills_gap=False,        # if True, force one post-gap low BELOW gap_open
    post_gap_above_high=False,       # if True, force the LAST close above the post-gap high
    extra_trailing_bars=0,           # extra bars (used for "gap_too_old")
    seed=42,
):
    """Build a synthetic series with a Power Earnings Gap structure.

    Returns a list of OHLCV bars where the gap bar sits at index
    (prior_drift_bars + baseline_bars), followed by post_gap_bars + extra
    trailing bars.
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400

    # 1. Prior drift — gentle uptrend so we're in Stage 1/2, not Stage 4
    drift_start = base_price / (1.0 + prior_drift_pct)
    if prior_drift_bars > 0:
        step = (base_price - drift_start) / prior_drift_bars
        for i in range(prior_drift_bars):
            mid = drift_start + step * (i + 1) + rng.uniform(-0.15, 0.15)
            v = baseline_vol * rng.uniform(0.85, 1.15)
            bars.append(_make_bar(t, mid, v, rng, noise=baseline_noise))
            t += DT

    # 2. Baseline bars — establish 20-bar volume + range averages
    for i in range(baseline_bars):
        mid = base_price + rng.uniform(-0.4, 0.4)
        v = baseline_vol * rng.uniform(0.85, 1.15)
        bars.append(_make_bar(t, mid, v, rng, noise=baseline_noise))
        t += DT

    # 3. Compute the prior close and 20-bar avg volume
    prior_bar = bars[-1]
    prior_close = prior_bar["c"]
    # Force prior bar close to be precisely base_price (so gap_pct is exact)
    prior_close = base_price
    bars[-1]["c"] = round(prior_close, 2)
    bars[-1]["h"] = max(bars[-1]["h"], prior_close)
    bars[-1]["l"] = min(bars[-1]["l"], prior_close)

    lookback = bars[-20:]
    avg_volume = sum(b["v"] for b in lookback) / len(lookback)
    # Baseline bar range (approximate)
    avg_range = sum(b["h"] - b["l"] for b in lookback) / len(lookback)

    # 4. The gap bar
    gap_open = prior_close * (1.0 + gap_pct)
    # Gap bar's range should be substantially larger than baseline range so the
    # post-gap tightness ratio is meaningful. Set gap_bar_range ~ 3-5% of price.
    gap_range = max(avg_range * 3.0, gap_open * 0.04)
    gap_low = gap_open  # gap opens at the low (typical post-earnings strength)
    gap_high = gap_low + gap_range
    gap_close = gap_low + gap_range * gap_close_strength
    gap_volume = avg_volume * gap_volume_ratio
    gap_bar = {
        "t": t,
        "o": round(gap_open, 2),
        "h": round(gap_high, 2),
        "l": round(gap_low, 2),
        "c": round(gap_close, 2),
        "v": round(gap_volume, 0),
    }
    bars.append(gap_bar)
    t += DT

    # 5. Post-gap bars — tight consolidation that holds the gap
    # Mid for post-gap should center around gap_close, with optional drift.
    post_gap_range_target = gap_range * post_gap_tightness
    pg_mid = gap_close
    half_pg = post_gap_range_target / 2.0
    for i in range(post_gap_bars):
        # Drift mid slightly per bar based on post_gap_drift_pct
        pg_mid_local = pg_mid + (gap_close * post_gap_drift_pct / max(post_gap_bars, 1) * i)
        # Center each bar around pg_mid_local
        force_open = pg_mid_local + rng.uniform(-half_pg * 0.3, half_pg * 0.3)
        force_close = pg_mid_local + rng.uniform(-half_pg * 0.3, half_pg * 0.3)
        force_high = max(force_open, force_close) + half_pg * 0.5 * rng.uniform(0.6, 1.0)
        force_low = min(force_open, force_close) - half_pg * 0.5 * rng.uniform(0.6, 1.0)
        # Keep low above gap_open by default (gap holds)
        if not post_gap_fills_gap:
            force_low = max(force_low, gap_open * 1.005)
        else:
            # Force ONE bar (the middle) to have low BELOW gap_open
            if i == post_gap_bars // 2:
                force_low = gap_open * 0.97  # 3% gap fill
        # Volume should be modest (post-gap absorption, not the gap bar itself)
        v = avg_volume * rng.uniform(0.8, 1.4)
        bar = {
            "t": t,
            "o": round(force_open, 2),
            "h": round(force_high, 2),
            "l": round(force_low, 2),
            "c": round(force_close, 2),
            "v": round(v, 0),
        }
        bars.append(bar)
        t += DT

    # If post_gap_above_high requested: force the LAST close above max of priors
    if post_gap_above_high and post_gap_bars >= 2:
        post_gap_segment = bars[-post_gap_bars:]
        max_prior_high = max(b["h"] for b in post_gap_segment[:-1])
        last = post_gap_segment[-1]
        forced_close = max_prior_high * 1.02   # 2% above prior high
        last["c"] = round(forced_close, 2)
        last["h"] = round(max(last["h"], forced_close * 1.005), 2)

    # 6. Extra trailing bars (used for gap_too_old fixture)
    for _ in range(extra_trailing_bars):
        mid = bars[-1]["c"] + rng.uniform(-0.2, 0.2)
        v = avg_volume * rng.uniform(0.85, 1.15)
        bars.append(_make_bar(t, mid, v, rng, noise=0.25))
        t += DT

    return bars


def _build_random_walk_bars(n_bars=80, base_price=50.0, seed=1):
    """Random walk — no gap, no PEG signature."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = base_price
    for i in range(n_bars):
        price += rng.uniform(-0.6, 0.6)
        bars.append(_make_bar(t, price, 1000, rng, noise=0.40))
        t += DT
    return bars


def _build_downtrend_with_gap(n_bars=60, seed=1):
    """Pure downtrend with a tempting gap-up — Stage 4 environment, hostile context."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    price = 100.0
    # Heavy downtrend
    for i in range(n_bars):
        price *= 0.985
        bars.append(_make_bar(t, price, 1500, rng, noise=0.30))
        t += DT
    # Inject a gap-up bar near the end
    prior_close = bars[-1]["c"]
    gap_open = prior_close * 1.06
    gap_high = gap_open * 1.04
    gap_low = gap_open
    gap_close = gap_low + (gap_high - gap_low) * 0.90
    avg_v = sum(b["v"] for b in bars[-20:]) / 20
    bars.append({
        "t": t,
        "o": round(gap_open, 2),
        "h": round(gap_high, 2),
        "l": round(gap_low, 2),
        "c": round(gap_close, 2),
        "v": round(avg_v * 5.0, 0),
    })
    t += DT
    # Trailing tight bars holding the gap
    for _ in range(5):
        mid = gap_close + rng.uniform(-0.5, 0.5)
        bars.append(_make_bar(t, mid, avg_v * 1.0, rng, noise=0.30,
                              force_low=gap_open * 1.005))
        t += DT
    return bars


def _build_chaotic_post_gap(seed=1):
    """PEG with wild, untidy post-gap action (not tight)."""
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    DT = 86400
    base_price = 50.0
    # Prior drift + baseline
    for i in range(45):
        mid = base_price - 4 + (i * 4.0 / 45) + rng.uniform(-0.3, 0.3)
        v = 1000 * rng.uniform(0.85, 1.15)
        bars.append(_make_bar(t, mid, v, rng, noise=0.20))
        t += DT
    bars[-1]["c"] = round(base_price, 2)
    bars[-1]["h"] = max(bars[-1]["h"], base_price)
    bars[-1]["l"] = min(bars[-1]["l"], base_price)
    avg_v = sum(b["v"] for b in bars[-20:]) / 20
    # Gap bar
    gap_open = base_price * 1.06
    gap_high = gap_open * 1.04
    gap_close = gap_open + (gap_high - gap_open) * 0.85
    bars.append({
        "t": t, "o": round(gap_open, 2), "h": round(gap_high, 2),
        "l": round(gap_open, 2), "c": round(gap_close, 2),
        "v": round(avg_v * 5, 0),
    })
    t += DT
    # CHAOTIC post-gap: each bar a wide swing
    for i in range(5):
        mid = gap_close + rng.uniform(-2, 2)
        # FORCE wide range (>0.7 * gap_range)
        rng_size = (gap_high - gap_open) * 1.2  # wider than gap bar
        bar = {
            "t": t,
            "o": round(mid - rng_size * 0.4, 2),
            "h": round(mid + rng_size * 0.5, 2),
            "l": round(max(gap_open * 1.005, mid - rng_size * 0.5), 2),
            "c": round(mid + rng_size * 0.3, 2),
            "v": round(avg_v * rng.uniform(0.8, 1.5), 0),
        }
        bars.append(bar)
        t += DT
    return bars


def _write(name, category, bars, context, expected, generation_info=None):
    payload = {
        "name": name,
        "category": category,
        "expected": expected,
        "context": context,
        "bars": bars,
    }
    if generation_info is not None:
        payload["_generation"] = generation_info
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


GOOD_CONTEXT = {
    "trend_stage": 2,
    "rs_trend": "up",
    "ma_alignment": "stacked_bullish",
    "volume_signature": "expanding",
    "regime": "bullish",
    "nearest_resistance": None,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}

NEUTRAL_CONTEXT = {
    "trend_stage": 1,
    "rs_trend": "flat",
    "ma_alignment": "mixed",
    "volume_signature": "neutral",
    "regime": "neutral",
    "nearest_resistance": None,
    "nearest_support": None,
    "days_to_earnings": None,
    "sector_strength_rank": None,
}

BAD_CONTEXT_DOWNTREND = {
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


def main():
    # ===== 5 POSITIVE — must fire with min confidence =====
    _write("clean_textbook", "positive",
           _build_peg_bars(
               gap_pct=0.06, gap_volume_ratio=4.0,
               post_gap_bars=5, post_gap_tightness=0.30,
               seed=1),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("dramatic_gap", "positive",
           _build_peg_bars(
               gap_pct=0.12, gap_volume_ratio=6.0,
               post_gap_bars=4, post_gap_tightness=0.25,
               seed=2),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 75.0, "max_confidence": 100.0,
            "geometry_shape": "candle_mark"})

    _write("small_gap_strong_volume", "positive",
           _build_peg_bars(
               gap_pct=0.045, gap_volume_ratio=5.0,
               post_gap_bars=6, post_gap_tightness=0.28,
               seed=3),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 55.0, "max_confidence": 100.0})

    _write("extended_post_gap", "positive",
           _build_peg_bars(
               gap_pct=0.05, gap_volume_ratio=3.2,
               post_gap_bars=9, post_gap_tightness=0.20,
               seed=4),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 100.0})

    _write("perfect_context", "positive",
           _build_peg_bars(
               gap_pct=0.08, gap_volume_ratio=5.0,
               post_gap_bars=5, post_gap_tightness=0.25,
               seed=5),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 75.0, "max_confidence": 100.0})

    # ===== 8 NEGATIVE — must NOT fire (or <50) =====
    _write("no_gap", "negative",
           _build_peg_bars(
               gap_pct=0.025,            # below 4% gate
               gap_volume_ratio=5.0,
               post_gap_bars=5, post_gap_tightness=0.30,
               seed=10),
           GOOD_CONTEXT,
           {"fires": False})

    _write("gap_filled", "negative",
           _build_peg_bars(
               gap_pct=0.06, gap_volume_ratio=4.0,
               post_gap_bars=5, post_gap_tightness=0.30,
               post_gap_fills_gap=True,    # gap filled mid-window
               seed=11),
           GOOD_CONTEXT,
           {"fires": False})

    _write("low_volume_gap", "negative",
           _build_peg_bars(
               gap_pct=0.06,
               gap_volume_ratio=1.8,    # below 3x gate
               post_gap_bars=5, post_gap_tightness=0.30,
               seed=12),
           GOOD_CONTEXT,
           {"fires": False})

    _write("wide_post_gap_action", "negative",
           _build_chaotic_post_gap(seed=13),
           GOOD_CONTEXT,
           {"fires": False})

    _write("gap_too_old", "negative",
           _build_peg_bars(
               gap_pct=0.06, gap_volume_ratio=4.0,
               post_gap_bars=5, post_gap_tightness=0.30,
               extra_trailing_bars=25,     # pushes gap >30 bars from end
               seed=14),
           GOOD_CONTEXT,
           {"fires": False})

    _write("already_broken_above", "negative",
           _build_peg_bars(
               gap_pct=0.06, gap_volume_ratio=4.0,
               post_gap_bars=5, post_gap_tightness=0.30,
               post_gap_above_high=True,   # already broke out
               seed=15),
           GOOD_CONTEXT,
           {"fires": False})

    _write("downtrend_context", "negative",
           _build_downtrend_with_gap(n_bars=60, seed=16),
           BAD_CONTEXT_DOWNTREND,
           {"fires": False})

    _write("chaotic_post_gap", "negative",
           _build_chaotic_post_gap(seed=17),
           NEUTRAL_CONTEXT,
           {"fires": False})

    # ===== 2 EDGE — boundary of validity =====
    _write("boundary_gap_pct", "edge",
           _build_peg_bars(
               gap_pct=0.0405,            # just over the 4.0% floor
               gap_volume_ratio=4.0,
               post_gap_bars=5, post_gap_tightness=0.30,
               seed=20),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    _write("boundary_volume", "edge",
           _build_peg_bars(
               gap_pct=0.06,
               gap_volume_ratio=3.05,     # just over the 3.0x floor
               post_gap_bars=5, post_gap_tightness=0.30,
               seed=21),
           GOOD_CONTEXT,
           {"fires": True, "min_confidence": 50.0, "max_confidence": 90.0})

    print("\nDone - 15 fixtures written.")


if __name__ == "__main__":
    main()
