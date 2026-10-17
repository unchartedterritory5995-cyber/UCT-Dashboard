"""Synthetic daily-bar builders for the recall-v2 detector tests (public repo:
synthetic series only, no real tickers' bars).

Every builder is deterministic. Bars are dicts {t, o, h, l, c, v} with `t` in
unix seconds, one session per day.
"""
import random

T0 = 1_700_000_000
DAY = 86_400


def bar(k, o, h, l, c, v):
    return {"t": T0 + k * DAY, "o": float(o), "h": float(h), "l": float(l), "c": float(c), "v": float(v)}


def trend(n=120, start=50.0, step=0.25, vol=1_000_000.0, wiggle=0.4, seed=1):
    """A steady trend (step > 0 up, < 0 down) with a small deterministic wiggle."""
    rnd = random.Random(seed)
    out, c = [], start
    for k in range(n):
        o = c
        c = max(1.0, c + step + rnd.uniform(-wiggle, wiggle) * 0.25)
        h = max(o, c) + 0.3
        l = min(o, c) - 0.3
        out.append(bar(k, o, h, l, c, vol))
    return out


def undercut_reclaim(n=120, seed=1):
    """An uptrend whose last session trades under the prior session's low and
    closes back above it in the upper half of its range."""
    bars = trend(n - 1, seed=seed)
    p = bars[-1]
    lo = p["l"] - 0.5
    c = p["l"] + 0.4
    h = c + 0.1
    bars.append(bar(n - 1, p["c"] - 0.2, h, lo, c, 1_500_000))
    return bars


def undercut_close_below(n=120, seed=1):
    """Same uptrend, but the undercut session CLOSES below the prior low (in the
    upper half of its own small range), and stays above every other level."""
    bars = trend(n - 1, seed=seed)
    p = bars[-1]
    lo = p["l"] - 0.6
    c = p["l"] - 0.1
    h = p["l"] - 0.05
    bars.append(bar(n - 1, h, h, lo, c, 1_500_000))
    return bars


def undercut_in_downtrend(n=120, seed=1):
    """The same undercut-and-reclaim session at the end of a DOWNtrend."""
    bars = trend(n - 1, start=120.0, step=-0.25, seed=seed)
    p = bars[-1]
    lo = p["l"] - 0.5
    c = p["l"] + 0.4
    bars.append(bar(n - 1, p["c"] - 0.2, c + 0.1, lo, c, 1_500_000))
    return bars


def ep_gap(n=120, gap=0.08, days_after=2, vol_x=4.0, close_frac=0.85, seed=3):
    """A quiet, near-flat series, then a gap-up session on heavy volume and an
    expanded range, then `days_after` ordinary sessions above the gap."""
    rnd = random.Random(seed)
    base_n = n - 1 - days_after
    out, c = [], 40.0
    for k in range(base_n):
        o = c
        c = c + rnd.uniform(-0.15, 0.15)
        out.append(bar(k, o, max(o, c) + 0.25, min(o, c) - 0.25, c, 1_000_000))
    pc = out[-1]["c"]
    o = pc * (1 + gap)
    lo = o - 0.2
    rng = 3.0
    h = lo + rng
    cl = lo + close_frac * rng
    out.append(bar(base_n, o, h, lo, cl, 1_000_000 * vol_x))
    c = cl
    for j in range(days_after):
        o = c
        c = c + 0.1
        out.append(bar(base_n + 1 + j, o, c + 0.2, o - 0.2, c, 1_200_000))
    return out


def random_walk(n=320, seed=0, gaps=True):
    """A noisy random walk with occasional injected gap/volume events, for the
    parity sweep (it must exercise both rules' fire and no-fire branches)."""
    rnd = random.Random(seed)
    out, c = [], rnd.uniform(15, 150)
    drift = rnd.uniform(-0.002, 0.004)
    for k in range(n):
        o = c * (1 + rnd.gauss(0, 0.004))
        v = rnd.uniform(0.6, 1.4) * 2_000_000
        if gaps and rnd.random() < 0.03:
            o = c * (1 + rnd.uniform(0.02, 0.15))
            v *= rnd.uniform(1.5, 6.0)
        c = max(1.0, o * (1 + drift + rnd.gauss(0, 0.02)))
        h = max(o, c) * (1 + abs(rnd.gauss(0, 0.01)))
        l = min(o, c) * (1 - abs(rnd.gauss(0, 0.01)))
        if gaps and rnd.random() < 0.05:   # wick undercuts
            l = l * (1 - rnd.uniform(0.01, 0.05))
        out.append(bar(k, round(o, 2), round(h, 2), round(l, 2), round(c, 2), int(v)))
    return out


def as_tuples(bars):
    """Dict bars -> the lab's tuple bars (ts, o, h, l, c, v)."""
    return [(b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]) for b in bars]
