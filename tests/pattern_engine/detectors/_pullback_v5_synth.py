"""Synthetic daily-bar builders for the uct_pullback_ma_v5 tests (public repo:
synthetic series only, no real tickers' bars).

Every builder is deterministic. Bars are dicts {t, o, h, l, c, v} with `t` in
unix seconds, one session per day. The rule needs the 200 SMA 20 sessions back,
so every builder returns at least 260 sessions.
"""
import random

from tests.pattern_engine.detectors._recall_v2_synth import as_tuples, bar  # noqa: F401  (re-export)


def uptrend(n=250, start=50.0, step=0.30, vol=1_000_000.0, seed=11):
    """A steady uptrend: close climbs `step` a session with a small wiggle, a
    0.3 wick either side, so ATR ~0.65 and the 21 EMA trails price by ~3."""
    rnd = random.Random(seed)
    out, c = [], start
    for k in range(n):
        o = c
        c = c + step + rnd.uniform(-0.06, 0.06)
        out.append(bar(k, o, max(o, c) + 0.3, min(o, c) - 0.3, c, vol))
    return out


def _drift_down(bars, k0, days, step):
    """Append `days` red sessions falling `step` each (a 3-day pullback)."""
    c = bars[-1]["c"]
    for j in range(days):
        o = c
        c = c - step
        bars.append(bar(k0 + j, o, o + 0.1, c - 0.15, c, 900_000))
    return bars


def pullback_to_ma(series_fn, ma="e21", depth_atr=0.4, close_above_atr=0.3,
                   n=250, days=3, step=1.0, seed=11, vol=1_200_000.0):
    """An uptrend, a `days`-session pullback, then a final session whose low
    tags the chosen MA (`depth_atr` ATR under it) and closes `close_above_atr`
    ATR above it. `series_fn(bars)` must return the shared series dict, so the
    MA value on the final bar is computed from the bars as they will be."""
    bars = uptrend(n=n, seed=seed)
    _drift_down(bars, n, days, step)
    k = len(bars)
    # Two-pass: place a provisional bar, read the MA/ATR the rule will see, then fix it.
    prev_c = bars[-1]["c"]
    bars.append(bar(k, prev_c, prev_c + 0.2, prev_c - 0.2, prev_c, vol))
    for _ in range(4):
        S = series_fn(bars)
        M, a = S[ma][-1], S["atr"][-1]
        lo = M - depth_atr * a
        c = M + close_above_atr * a
        o = max(prev_c, c) + 0.05
        bars[-1] = bar(k, o, max(o, c) + 0.1, lo, c, vol)
    return bars


def as_penny(bars, div=40.0):
    return [{**b, "o": b["o"] / div, "h": b["h"] / div, "l": b["l"] / div, "c": b["c"] / div}
            for b in bars]


def random_walk(n=520, seed=0):
    """A noisy up-drifting random walk long enough for the 200 SMA, for the
    parity sweep (it must exercise both the fire and no-fire branches)."""
    rnd = random.Random(seed)
    out, c = [], rnd.uniform(20, 120)
    drift = rnd.uniform(0.0005, 0.003)
    for k in range(n):
        o = c * (1 + rnd.gauss(0, 0.004))
        c = max(1.0, o * (1 + drift + rnd.gauss(0, 0.018)))
        h = max(o, c) * (1 + abs(rnd.gauss(0, 0.008)))
        l = min(o, c) * (1 - abs(rnd.gauss(0, 0.008)))
        if rnd.random() < 0.06:     # dips that tag an MA
            l = l * (1 - rnd.uniform(0.01, 0.04))
        v = rnd.uniform(0.6, 1.4) * 2_000_000
        out.append(bar(k, round(o, 2), round(h, 2), round(l, 2), round(c, 2), int(v)))
    return out


def fire_e21(series_fn, **kw):
    """The canonical fire: a 3-session pullback whose last bar tags a rising 21 EMA."""
    return pullback_to_ma(series_fn, ma="e21", depth_atr=0.4, close_above_atr=0.3, **kw)


def eight_ema_only(series_fn):
    """A shallow 2-session dip that tags ONLY the 8 EMA (v4 fired on this; v5 must not)."""
    return pullback_to_ma(series_fn, ma="e8", depth_atr=0.1, close_above_atr=0.2, days=2, step=0.5)


def falling_e21(series_fn):
    """A 12-session decline (the 21 EMA now lower than 10 sessions ago), then a
    bar that tags the 21 EMA and closes above it. Every other guard passes."""
    return pullback_to_ma(series_fn, ma="e21", depth_atr=0.3, close_above_atr=0.3, days=12, step=0.4)
