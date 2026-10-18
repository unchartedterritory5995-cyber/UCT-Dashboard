"""Synthetic daily-bar builders for the uct_inside_day / uct_flat_top_breakout
tests (public repo: synthetic series only, no real tickers' bars).

Every builder is deterministic. Bars are dicts {t, o, h, l, c, v} with `t` in
unix seconds, one session per day.
"""
import random

from tests.pattern_engine.detectors._recall_v2_synth import as_tuples, bar, trend  # noqa: F401  (re-export)


def inside_day(n=120, seed=1, rng_atr=0.4, vol=1_000_000.0):
    """A steady uptrend (close > e8 > e21 > s50) whose last session sits inside
    the prior session's range with a small range (`rng_atr` x the prior ATR)."""
    bars = trend(n - 1, seed=seed)
    p = bars[-1]
    a = 0.85                                   # ~the trend's ATR (|step| + 0.6 of wick)
    mid = (p["h"] + p["l"]) / 2.0
    half = min(rng_atr * a, p["h"] - p["l"]) / 2.0
    h, l = mid + half, mid - half
    c = h - 0.25 * (h - l)
    bars.append(bar(n - 1, l + 0.25 * (h - l), h, l, c, vol))
    return bars


def outside_last(n=120, seed=1):
    """The same uptrend, but the last session takes out the prior high: not inside."""
    bars = trend(n - 1, seed=seed)
    p = bars[-1]
    bars.append(bar(n - 1, p["c"], p["h"] + 0.2, p["l"] + 0.1, p["h"] + 0.1, 1_000_000))
    return bars


def inside_downtrend(n=120, seed=1):
    """A downtrend whose last session is a small inside day: the trend gate must refuse it."""
    bars = trend(n - 1, start=120.0, step=-0.25, seed=seed)
    p = bars[-1]
    mid = (p["h"] + p["l"]) / 2.0
    bars.append(bar(n - 1, mid, mid + 0.15, mid - 0.15, mid + 0.05, 1_000_000))
    return bars


def flat_top(n_trend=210, base=45, touches=(5, 22), last="at_line", seed=3, vol=1_500_000.0):
    """An uptrend (so s50 > s200 and close > s50), then a `base`-session base
    under a flat ceiling H (the uptrend's last high). The ceiling is touched at
    the base offsets in `touches` (each >= 3 sessions apart, the first well
    before the last session); every other base high stays >= 1.0 ATR under H.
    The last session closes either just under H (`at_line`, 0.4 ATR under) or
    just through it (`breakout`, 0.5 ATR over), or far under it (`deep`)."""
    rnd = random.Random(seed)
    bars = trend(n_trend, start=40.0, step=0.30, seed=seed)
    H = max(b["h"] for b in bars[-40:]) + 0.6
    # the last trend session tags the ceiling
    p = bars[-1]
    bars[-1] = bar(n_trend - 1, p["o"], H, p["l"], H - 0.2, p["v"])
    k0 = len(bars)
    for j in range(base):
        o = H - 2.0 + rnd.uniform(-0.3, 0.3)
        c = H - 2.0 + rnd.uniform(-0.3, 0.3)
        h = max(o, c) + 0.3
        l = min(o, c) - 0.3
        if j in touches:
            h = H
        bars.append(bar(k0 + j, o, h, l, c, vol))
    k = len(bars)
    a = 0.8
    if last == "at_line":
        c = H - 0.4 * a
        o, h, l = c - 0.5, c + 0.1, c - 0.6
    elif last == "breakout":
        c = H + 0.5 * a
        o, h, l = H - 0.6, c + 0.1, H - 0.7
    else:                                       # deep: far under the line
        c = H - 3.0
        o, h, l = c + 0.2, c + 0.4, c - 0.3
    bars.append(bar(k, o, h, l, c, vol * 1.5))
    return bars


def random_walk(n=520, seed=0):
    """A noisy up-drifting random walk long enough for the 200 SMA, with
    occasional compressed sessions and capped highs so both rules see fires."""
    rnd = random.Random(seed)
    out, c = [], rnd.uniform(20, 120)
    drift = rnd.uniform(0.0008, 0.003)
    for k in range(n):
        o = c * (1 + rnd.gauss(0, 0.004))
        c = max(1.0, o * (1 + drift + rnd.gauss(0, 0.016)))
        h = max(o, c) * (1 + abs(rnd.gauss(0, 0.007)))
        l = min(o, c) * (1 - abs(rnd.gauss(0, 0.007)))
        if out and rnd.random() < 0.12:         # an inside session
            p = out[-1]
            span = p["h"] - p["l"]
            l = p["l"] + span * rnd.uniform(0.1, 0.4)
            h = p["h"] - span * rnd.uniform(0.1, 0.4)
            o = l + (h - l) * rnd.uniform(0.2, 0.8)
            c = l + (h - l) * rnd.uniform(0.2, 0.8)
        v = rnd.uniform(0.6, 1.4) * 2_000_000
        out.append(bar(k, round(o, 2), round(h, 2), round(l, 2), round(c, 2), int(v)))
    return out


def as_penny(bars, div=40.0):
    return [{**b, "o": b["o"] / div, "h": b["h"] / div, "l": b["l"] / div, "c": b["c"] / div}
            for b in bars]
