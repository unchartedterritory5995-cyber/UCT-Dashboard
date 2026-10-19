"""Synthetic daily-bar builders for the uct_flag_htf / uct_ma_reclaim tests
(public repo: synthetic series only, no real tickers' bars).

Every builder is deterministic. Bars are dicts {t, o, h, l, c, v} with `t` in
unix seconds, one session per day.
"""
import random

from tests.pattern_engine.detectors._recall_v2_synth import as_tuples, bar, trend  # noqa: F401  (re-export)


def _append(bars, o, h, l, c, v):
    bars.append(bar(len(bars), o, h, l, c, v))


def flag(n_base=230, pole=16, pole_gain=0.60, flag_len=6, depth=0.20, last="forming",
         falling_base=False, vol=1_500_000.0, seed=5):
    """A base (a gentle uptrend, or a long DOWNtrend when `falling_base`), then a
    `pole`-session run of +`pole_gain`, then `flag_len` sessions drifting down
    to retrace `depth` of the pole, closing back up near the flag top. `last`:
      forming  - the last session closes just under the flag's 10-day high
      breakout - the last session closes just through the 10-day high
      none     - no extra session (the flag's own last session is the end)"""
    rnd = random.Random(seed)
    if falling_base:
        bars = trend(n_base, start=150.0, step=-0.42, seed=seed, vol=vol)
    else:
        bars = trend(n_base, start=40.0, step=0.04, seed=seed, vol=vol)
    c0 = bars[-1]["c"]
    step = (c0 * pole_gain) / pole
    c = c0
    for _ in range(pole):
        o = c
        c = c + step * rnd.uniform(0.85, 1.15)
        _append(bars, o, c + 0.2, o - 0.2, c, vol * 1.6)
    top = max(b["h"] for b in bars[-pole:])
    low_target = top - depth * (top - min(b["l"] for b in bars[-pole - 40:]))
    # flag: drift down to the low target, then curl back toward the top
    for j in range(flag_len):
        frac = (j + 1) / flag_len
        mid = top - (top - low_target) * (1.0 - abs(2 * frac - 1.0))
        o = mid + rnd.uniform(-0.15, 0.15)
        cc = mid + rnd.uniform(-0.15, 0.15)
        h = min(top - 0.3, max(o, cc) + 0.4)
        l = min(o, cc) - 0.4
        _append(bars, o, h, l, cc, vol * 0.7)
    hh10 = max(b["h"] for b in bars[-10:])
    if last == "forming":
        c = hh10 - 0.6
        _append(bars, c - 0.4, hh10 - 0.1, c - 0.7, c, vol)
    elif last == "breakout":
        c = hh10 + 1.0
        _append(bars, hh10 - 0.5, c + 0.3, hh10 - 0.8, c, vol * 2.0)
    return bars


def flag_pinned(n_base=230, gap=0.50, pinned=9, vol=2_000_000.0, seed=6):
    """A gentle uptrend, then a +`gap` opening gap (a deal-like jump) and
    `pinned` sessions pinned flat just under the gap session's high: the flag
    rule sees a pole and a tight flag, and the guard's G2 (gap in the last 60,
    last 10 sessions within 3%) must suppress it."""
    bars = trend(n_base, start=40.0, step=0.04, seed=seed, vol=vol)
    p = bars[-1]["c"]
    o = p * (1 + gap)
    _append(bars, o, o * 1.006, o * 0.998, o * 1.002, vol * 8)
    hi = o * 1.006
    rnd = random.Random(seed)
    for _ in range(pinned):
        c = o * (1 + rnd.uniform(-0.002, 0.004))
        _append(bars, c, min(hi - 0.01, c * 1.003), c * 0.997, c * (1 + rnd.uniform(-0.001, 0.001)),
                vol * 0.5)
    return bars


def _sma_last(closes, n):
    return sum(closes[-n:]) / n


def ma_reclaim(n_up=150, under=6, rise=None, last="reclaim", vol=1_500_000.0, seed=7):
    """An uptrend, then a slide that closes under the 50 SMA for `under`
    sessions, then a session that closes back above it. `last`:
      reclaim  - the last session closes 0.3% above its own 50 SMA
      extended - the last session closes far (> 2 ATR) above it
      none     - no reclaim session"""
    rnd = random.Random(seed)
    bars = trend(n_up, start=40.0, step=0.12, seed=seed, vol=vol)
    closes = [b["c"] for b in bars]
    # slide: each close lands ~1.5% under the 50 SMA it helps form
    for _ in range(under):
        s49 = sum(closes[-49:])
        c = s49 / (50.0 / 0.985 - 1.0)       # c = 0.985 * (s49 + c) / 50
        o = c * (1 + rnd.uniform(0.0, 0.006))
        _append(bars, o, max(o, c) * 1.004, min(o, c) * 0.996, c, vol)
        closes.append(c)
    if last == "none":
        return bars
    s49 = sum(closes[-49:])
    mult = 1.003 if last == "reclaim" else 1.12
    c = s49 / (50.0 / mult - 1.0)            # c = mult * (s49 + c) / 50
    o = closes[-1]
    _append(bars, o, c * 1.002, o * 0.995, c, vol * 1.4)
    return bars


def regime_walk(n=520, seed=0):
    """A noisy regime-switching walk long enough for the 200 SMA: runs, slides,
    chop, occasional large opening gaps (some followed by a pinned stretch), so
    both rules and both guard clauses see fires and refusals."""
    rnd = random.Random(seed)
    out, c = [], rnd.uniform(20, 120)
    drift, sd, left, pin = 0.0, 0.015, 0, 0
    for k in range(n):
        if left <= 0:
            drift = rnd.choice([-0.012, -0.005, -0.002, 0.0, 0.002, 0.004, 0.008, 0.025])
            sd = rnd.choice([0.008, 0.014, 0.022])
            left = rnd.randint(8, 45)
        left -= 1
        if pin > 0:
            pin -= 1
            o = c * (1 + rnd.gauss(0, 0.0015))
            cc = o * (1 + rnd.gauss(0, 0.0015))
            h, l = max(o, cc) * 1.001, min(o, cc) * 0.999
        else:
            jump = 0.0
            if k > 5 and rnd.random() < 0.012:
                jump = rnd.choice([-1, 1]) * rnd.uniform(0.10, 0.45)
                if rnd.random() < 0.5:
                    pin = rnd.randint(4, 14)
            o = c * (1 + jump + rnd.gauss(0, 0.004))
            cc = max(1.0, o * (1 + drift + rnd.gauss(0, sd)))
            h = max(o, cc) * (1 + abs(rnd.gauss(0, sd / 2)))
            l = min(o, cc) * (1 - abs(rnd.gauss(0, sd / 2)))
        c = cc
        v = rnd.uniform(0.6, 1.4) * 2_000_000
        out.append(bar(k, round(o, 2), round(h, 2), round(l, 2), round(c, 2), int(v)))
    return out


def as_penny(bars, div=40.0):
    return [{**b, "o": b["o"] / div, "h": b["h"] / div, "l": b["l"] / div, "c": b["c"] / div}
            for b in bars]
