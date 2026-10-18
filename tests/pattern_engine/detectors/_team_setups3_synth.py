"""Synthetic daily-bar builders for the uct_trendline_break tests (public repo:
synthetic series only, no real tickers' bars).

Every builder is deterministic. Bars are dicts {t, o, h, l, c, v} with `t` in
unix seconds, one session per day.
"""
import math
import random

from tests.pattern_engine.detectors._recall_v2_synth import as_tuples, bar, trend  # noqa: F401  (re-export)
from tests.pattern_engine.detectors._team_setups2_synth import as_penny, regime_walk  # noqa: F401  (re-export)


def _append(bars, o, h, l, c, v):
    bars.append(bar(len(bars), o, h, l, c, v))


def downtrend_base(n_up=150, legs=4, leg_len=10, drop=0.035, vol=1_500_000.0, seed=11):
    """An uptrend, then `legs` swings of `leg_len` sessions each whose peaks
    step DOWN by `drop` (a falling line of lower highs), each swing closing
    well under its own peak. The last session is the final swing's low area."""
    rnd = random.Random(seed)
    bars = trend(n_up, start=40.0, step=0.10, seed=seed, vol=vol)
    top = bars[-1]["c"] * 1.02
    for leg in range(legs):
        peak = top * (1.0 - drop * leg)
        trough = peak * 0.93
        half = leg_len // 2
        for j in range(leg_len):
            if j < half:          # decline from the peak to the trough
                frac = (j + 1) / half
                mid = peak - (peak - trough) * frac
            else:                 # recover part way, staying under the next lower peak
                frac = (j + 1 - half) / (leg_len - half)
                mid = trough + (peak * (1.0 - drop) * 0.985 - trough) * frac * 0.85
            if j == 0:
                o, c = peak * 0.995, peak * 0.985
                h, l = peak, min(o, c) * 0.995
            else:
                o = mid * (1 + rnd.uniform(-0.004, 0.004))
                c = mid * (1 + rnd.uniform(-0.004, 0.004))
                h = max(o, c) * 1.004
                l = min(o, c) * 0.996
            _append(bars, o, h, l, c, vol * rnd.uniform(0.8, 1.1))
    return bars


def trendline_break(last="break", vol=1_500_000.0, seed=11, **kw):
    """`downtrend_base`, then one more session. `last`:
      break     - a green session that closes just through the falling line and
                  above the prior high (the confirmed rule fires)
      red       - the same close through the line, but a RED session
      no_ph     - green and through the line, but not above the prior high
      extended  - green, above the prior high, far (> 1.5 ATR) past the line
      none      - no extra session"""
    bars = downtrend_base(vol=vol, seed=seed, **kw)
    if last == "none":
        return bars
    p = bars[-1]
    line = _line_value_estimate(bars)
    if last == "break":
        c = max(line * 1.006, p["h"] * 1.004)
        o = p["c"] * 1.002
        _append(bars, o, c * 1.004, min(o, p["l"]) * 0.998, c, vol * 1.8)
    elif last == "red":
        c = max(line * 1.006, p["h"] * 1.004)
        o = c * 1.01
        _append(bars, o, o * 1.002, c * 0.995, c, vol * 1.8)
    elif last == "no_ph":
        # open low, close through the line but not above the prior high: make
        # the prior session's high tall first by stretching it upward
        bars[-1] = {**p, "h": max(p["h"], line * 1.05)}
        c = line * 1.004
        o = c * 0.985
        _append(bars, o, c * 1.002, o * 0.997, c, vol * 1.5)
    elif last == "extended":
        c = line * 1.20
        o = p["c"] * 1.002
        _append(bars, o, c * 1.003, o * 0.998, c, vol * 2.5)
    return bars


def _line_value_estimate(bars):
    """The falling line's value one session past the end, estimated from the
    two most recent leg peaks (only to aim the synthetic close; the tests read
    the detector's own line, never this estimate)."""
    hs = [b["h"] for b in bars]
    n = len(bars)
    peaks = [k for k in range(n - 45, n - 1) if hs[k] >= max(hs[max(0, k - 3):k + 4])]
    a, b2 = peaks[-2], peaks[-1]
    slope = (hs[b2] - hs[a]) / (b2 - a)
    return hs[b2] + slope * (n - b2)


def follow_through(seed=11, **kw):
    """A break session, then a pullback under the line, then a second green
    close through it inside ten sessions: the second cross is NOT a first
    close above the line."""
    bars = trendline_break(last="break", seed=seed, **kw)
    rnd = random.Random(seed)
    for _ in range(3):
        p = bars[-1]
        c = p["c"] * 0.975
        _append(bars, p["c"], p["c"] * 1.002, c * 0.996, c, 1_200_000.0 * rnd.uniform(0.9, 1.1))
    p = bars[-1]
    c = max(bars[-4]["c"] * 1.01, p["h"] * 1.004)
    _append(bars, p["c"] * 1.002, c * 1.003, p["l"], c, 2_000_000.0)
    return bars


def isclose(a, b):
    return math.isclose(a, b, rel_tol=1e-12, abs_tol=1e-12)


def launch_pad(n_up=230, base=60, last="pad", falling_base=False, vol=1_500_000.0, seed=21):
    """A trend (up, or a long DOWNtrend when `falling_base`), then a `base`
    session flat, tight range so the 8 / 21 / 50 averages converge, then one
    more session. `last`:
      pad       - closes a hair above the top of the converged averages
      extended  - closes far (> 1 ATR) above them
      below     - closes under the averages
      none      - no extra session"""
    rnd = random.Random(seed)
    if falling_base:
        bars = trend(n_up, start=150.0, step=-0.30, seed=seed, vol=vol)
    else:
        bars = trend(n_up, start=40.0, step=0.06, seed=seed, vol=vol)
    lvl = bars[-1]["c"]
    for _ in range(base):
        o = lvl * (1 + rnd.uniform(-0.004, 0.004))
        c = lvl * (1 + rnd.uniform(-0.004, 0.004))
        _append(bars, o, max(o, c) * 1.004, min(o, c) * 0.996, c, vol * 0.8)
    if last == "none":
        return bars
    closes = [b["c"] for b in bars]
    top = max(_ema(closes, 8), _ema(closes, 21), sum(closes[-50:]) / 50)
    rng = sum(b["h"] - b["l"] for b in bars[-14:]) / 14
    c = {"pad": top + 0.6 * rng, "extended": top + 4.0 * rng, "below": top - 2.0 * rng}[last]
    o = bars[-1]["c"]
    _append(bars, o, max(o, c) * 1.002, min(o, c) * 0.998, c, vol * 1.3)
    return bars


def _ema(xs, n):
    a, e = 2.0 / (n + 1), None
    for x in xs:
        e = x if e is None else e + a * (x - e)
    return e
