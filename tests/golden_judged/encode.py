"""Encode one judged chart as a symbol-free fixture case (the inverse of member_path.decode_bars).

Used when a NEW passed blind round is exported (docs/patterns/JUDGED_GATE.md). The caller supplies the chart's
daily bars (ts as YYYYMMDD, oldest first, the last one the judged as-of bar) and the judged geometry; this module
removes everything that identifies the chart:

  * no symbol is written at all;
  * dates become calendar-day offsets from the window's first bar (weekday and holiday spacing kept, the year is
    not), and judged dates in the geometry become the same offsets;
  * every price is multiplied by a random per-case `scale` (recorded, so the replay can divide it back out and the
    drawing code's absolute floors see the judged prices).

The scaled series is stored at one decimal place finer than the source's own precision (`dp`, its most decimal
places, at most 4 here), which is exactly enough for the replay to divide the scale back out and round to `dp`
places to recover the SOURCE PRICES EXACTLY: several drawings pick among near-tied candidates, so a fixture that
perturbed prices by even a tick would replay a different chart. Volume (not a price) is kept in hundreds of shares,
well inside any volume ratio or dollar-volume floor the drawings read.
"""
from __future__ import annotations

import datetime as _dt
import math
import random

_RNG = random.SystemRandom()
VOLUME_UNIT = 100


def _date(t) -> _dt.date:
    t = int(t)
    return _dt.date(t // 10000, t // 100 % 100, t % 100)


def random_scale() -> float:
    """A per-case price factor, log-uniform in [0.4, 2.5], from the OS's random source (never seeded)."""
    return round(math.exp(_RNG.uniform(math.log(0.4), math.log(2.5))), 6)


def price_places(bars) -> int:
    """The most decimal places any price in `bars` carries (0..6)."""
    def places(x):
        for d in range(7):
            if abs(round(x, d) - x) < 1e-9:
                return d
        raise ValueError("a price with more than 6 decimal places: %r" % x)
    return max(places(float(v)) for b in bars for v in b[1:5])


def encode_bars(bars, scale: float) -> dict:
    """`bars`: [(ts, o, h, l, c, v), ...] oldest first. Returns the fixture's `bars` block."""
    k = float(scale)
    assert 0.4 <= k <= 2.5, k   # the exactness argument below needs k >= 0.4
    d0 = _date(bars[0][0])
    days = [(_date(x[0]) - d0).days for x in bars]
    dp = price_places(bars)
    # stored resolution 10**-(dp+1) on the scaled price: after dividing by k >= 0.4 the error is < 0.5 x 10**-dp,
    # so rounding to dp places recovers the source price exactly
    q = 10 ** (dp + 1)
    cs = [int(round(float(x[4]) * k * q)) for x in bars]
    os_ = [int(round(float(x[1]) * k * q)) for x in bars]
    hs = [int(round(float(x[2]) * k * q)) for x in bars]
    ls = [int(round(float(x[3]) * k * q)) for x in bars]
    steps = [days[i] - days[i - 1] for i in range(1, len(days))]
    return {
        "scale": k, "q": q, "dp": dp, "wd0": d0.weekday(), "vu": VOLUME_UNIT,
        "d": "".join(str(s) if 1 <= s <= 9 else "(%d)" % s for s in steps),
        "c": [cs[0]] + [cs[i] - cs[i - 1] for i in range(1, len(cs))],
        "o": [os_[i] - cs[i] for i in range(len(bars))],
        # the wicks: high over the body top, low under the body bottom
        "h": [hs[i] - max(os_[i], cs[i]) for i in range(len(bars))],
        "l": [min(os_[i], cs[i]) - ls[i] for i in range(len(bars))],
        "v": [int(round(float(x[5] or 0) / VOLUME_UNIT)) for x in bars],
    }


def day_offset(bars, t) -> int:
    """A judged date as the fixture's day offset (from the window's first bar)."""
    return (_date(t) - _date(bars[0][0])).days


def scaled(price, scale: float) -> float:
    return round(float(price) * float(scale), 6)
