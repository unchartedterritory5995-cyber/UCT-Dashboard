"""Synthetic daily bars for the rare-pattern preview tests (tests/test_rare_draw.py, tests/test_rare_preview.py).

Each builder returns {t,o,h,l,c,v} dicts, oldest first, from a close path: the open is the previous close, the
high / low sit a fixed `wick` over / under the body, `t` is a weekday YYYYMMDD. Every judged fault has its own
builder (or a keyword on the clean one) so each negative changes ONE thing about a pattern that fires.
"""
from __future__ import annotations

import datetime
import math


def weekdays(n, start=datetime.date(2023, 1, 2)):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(int(d.strftime("%Y%m%d")))
        d += datetime.timedelta(days=1)
    return out


def bars_from(closes, wick=0.3, vols=None, wicks=None):
    ts = weekdays(len(closes))
    out, prev = [], closes[0]
    for k, c in enumerate(closes):
        w = wicks[k] if wicks is not None else wick
        o = prev
        out.append({"t": ts[k], "o": round(o, 4), "h": round(max(o, c) + w, 4), "l": round(min(o, c) - w, 4),
                    "c": round(c, 4), "v": float(vols[k] if vols is not None else 1_000_000)})
        prev = c
    return out


def _ramp(a, b, n):
    return [a + (b - a) * (k + 1) / n for k in range(n)]


# ------------------------------------------------------------------------------------------ cup without handle
def cup_closes(*, prior_low=55.0, lip=100.0, depth=0.20, cup_bars=60, advance_bars=100, old_high=None,
               w_middle=0.0, v_shape=False, crash_at=None, right_end=0.996):
    """A flat stretch, an advance from `prior_low` to the lip, then a rounded cup back to `right_end` x lip at
    the last bar. `old_high` puts an earlier high (then a decline to the prior low) before the advance;
    `w_middle` adds a mid-cup rally of that share of the depth (a W); `v_shape` makes the cup a straight V;
    `crash_at` (a share of the cup) holds the left side at the lip until then and drops to the low in ONE bar."""
    closes = [prior_low] * 100
    if old_high is not None:
        closes += _ramp(prior_low, old_high, 30) + [old_high] * 10 + _ramp(old_high, prior_low, 40)
    else:
        closes += [prior_low] * 80
    closes += _ramp(prior_low, lip, advance_bars)
    low = lip * (1 - depth)
    end = lip * right_end
    for k in range(1, cup_bars + 1):
        x = k / cup_bars
        if crash_at is not None and x < 0.5:
            # a crash-led cup: the left side holds near the lip, then ONE bar drops to the low
            y = lip * 0.99 if x < crash_at else low
        elif v_shape:
            y = lip - (lip - low) * 2 * x if x < 0.5 else low + (end - low) * (2 * x - 1)
        else:
            top = lip if x < 0.5 else end
            y = low + (top - low) * (1 - math.sin(math.pi * x))
        if w_middle:
            y += (lip - low) * w_middle * math.exp(-((x - 0.5) / 0.08) ** 2)
        closes.append(y)
    return closes


def cup_bars(**kw):
    return bars_from(cup_closes(**kw))


# ------------------------------------------------------------------------------------------ high tight flag
def htf_closes(*, base=10.0, peak=20.0, pole_bars=20, flag_bars=20, flag_depth=0.12, staircase=False,
               stall=False, sag=False):
    closes = [base] * 300
    if staircase:
        half = pole_bars // 2
        mid = base + (peak - base) * 0.6
        closes += _ramp(base, mid, half) + _ramp(mid, mid * 0.7, 6) + _ramp(mid * 0.7, peak, pole_bars - half)
    elif stall:
        half = pole_bars // 2
        mid = base + (peak - base) * 0.5
        closes += _ramp(base, mid, half) + [mid * 0.99] * 14 + _ramp(mid, peak, pole_bars - half)
    else:
        closes += _ramp(base, peak, pole_bars)
    lo = peak * (1 - flag_depth)
    if sag:
        closes += _ramp(peak, peak * 0.81, flag_bars)
    else:
        down = flag_bars // 2
        closes += _ramp(peak, lo + 0.3, down) + _ramp(lo + 0.3, peak * 0.975, flag_bars - down)
    return closes


def htf_bars(*, loose=False, spike_peak=False, **kw):
    closes = htf_closes(**kw)
    n = len(closes)
    flag_bars = kw.get("flag_bars", 20)
    vols = [2_000_000] * (n - flag_bars) + [800_000] * flag_bars
    wicks = [0.2] * n
    if loose:
        for k in range(n - flag_bars, n):
            wicks[k] = 0.9
    b = bars_from(closes, vols=vols, wicks=wicks)
    if spike_peak:
        k = n - flag_bars - 1
        b[k]["h"] = round(b[k]["h"] + 6.0, 4)
    return b
