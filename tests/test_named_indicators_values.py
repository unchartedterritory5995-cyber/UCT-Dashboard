"""⭐ THE NAMED-INDICATOR LIBRARY'S VALUES: every entry against an independent calculation.

Evidence tier (a). `api/data/named_indicators.json` holds the ONE formula the assistant builds
when a member names an indicator. For each entry, every output tree is evaluated by the server's
own evaluator (`ast_interpret.interpret`, the Python twin of the chart's) over deterministic daily
bars and compared, bar by bar, with a calculation written here in plain Python from the entry's
PUBLISHED definition (`evidence.published.says`), using no engine code.

Each is checked TWICE: at its default numbers, and at other numbers written into the tree at the
entry's parameter `sites`. The second pass is what proves the sites are where the parameters
really sit (a site on the wrong node moves the wrong number, and the values disagree).

⛔ An entry with no reference here FAILS (`test_every_output_has_a_reference`): none can be added
to the library unchecked.

RUNNING VALUES. Three entries read their own previous value (KAMA, McGinley Dynamic, Connors
RSI's streak). The engine recomputes those from a fixed number of bars back on every bar; the
reference does the same, independently, AND the distance to the same recursion carried from the
first bar is measured and held, because that distance is what the door tells the member about.
"""
from __future__ import annotations

import json
import math

import pytest

from api.services import ast_interpret, call_expansions
from api.services import named_indicators as ni
from tests.test_house_indicators_values import _walk

NAN = float("nan")
WINDOW = 300          # the running values' restart window, as each formula's text says
STREAK_WINDOW = 100


def ok(v):
    return v is not None and not (isinstance(v, float) and math.isnan(v))


# ── plain-Python building blocks (no engine code) ────────────────────────────

def col(bars, k):
    return [b[k] for b in bars]


def sma(xs, n):
    out = []
    for i in range(len(xs)):
        w = xs[i - n + 1:i + 1] if i >= n - 1 else []
        out.append(sum(w) / n if len(w) == n and all(ok(v) for v in w) else NAN)
    return out


def rolling_sum(xs, n):
    return [v * n if ok(v) else NAN for v in sma(xs, n)]


def ema(xs, n):
    """alpha = 2 / (n + 1), started from the simple average of the first n known values."""
    out, prev, seen = [], None, []
    a = 2.0 / (n + 1)
    for v in xs:
        if not ok(v):
            out.append(NAN if prev is None else prev)
            continue
        if prev is None:
            seen.append(v)
            if len(seen) == n:
                prev = sum(seen) / n
            out.append(NAN if prev is None else prev)
        else:
            prev = prev + a * (v - prev)
            out.append(prev)
    return out


def wma(xs, n):
    out, denom = [], n * (n + 1) / 2
    for i in range(len(xs)):
        if i < n - 1 or not all(ok(v) for v in xs[i - n + 1:i + 1]):
            out.append(NAN)
            continue
        out.append(sum(xs[i - n + 1 + k] * (k + 1) for k in range(n)) / denom)       # the newest weighs n
    return out


def highest(xs, n):
    return [max(xs[i - n + 1:i + 1]) if i >= n - 1 else NAN for i in range(len(xs))]


def lowest(xs, n):
    return [min(xs[i - n + 1:i + 1]) if i >= n - 1 else NAN for i in range(len(xs))]


def true_range(bars):
    out = [NAN]
    for i in range(1, len(bars)):
        h, l, pc = bars[i]["h"], bars[i]["l"], bars[i - 1]["c"]
        out.append(max(h - l, abs(h - pc), abs(l - pc)))
    return out


def wilder(xs, n):
    """Wilder's smoothing: the simple mean of the first n known values, then prev + (x - prev) / n."""
    out, prev, seen = [], None, []
    for v in xs:
        if not ok(v):
            out.append(NAN if prev is None else prev)
            continue
        if prev is None:
            seen.append(v)
            if len(seen) == n:
                prev = sum(seen) / n
        else:
            prev = prev + (v - prev) / n
        out.append(NAN if prev is None else prev)
    return out


def rsi(xs, n):
    gains, losses = [NAN], [NAN]
    for i in range(1, len(xs)):
        if ok(xs[i]) and ok(xs[i - 1]):
            d = xs[i] - xs[i - 1]
            gains.append(max(d, 0.0))
            losses.append(max(-d, 0.0))
        else:
            gains.append(NAN)
            losses.append(NAN)
    ag, al = wilder(gains, n), wilder(losses, n)
    out = []
    for g, l in zip(ag, al):
        if not ok(g) or not ok(l):
            out.append(NAN)
        elif l == 0:
            out.append(100.0)
        else:
            out.append(100.0 - 100.0 / (1.0 + g / l))
    return out


def roc(xs, n):
    return [(xs[i] - xs[i - n]) / xs[i - n] * 100.0 if i >= n and ok(xs[i - n]) else NAN for i in range(len(xs))]


def stdev_population(xs, n):
    out = []
    for i in range(len(xs)):
        if i < n - 1:
            out.append(NAN)
            continue
        w = xs[i - n + 1:i + 1]
        m = sum(w) / n
        out.append(math.sqrt(sum((v - m) ** 2 for v in w) / n))
    return out


def linreg_end(xs, n):
    """The least-squares line through the last n values, read at the newest one."""
    out = []
    for i in range(len(xs)):
        w = xs[i - n + 1:i + 1] if i >= n - 1 else []
        if len(w) != n or not all(ok(v) for v in w):
            out.append(NAN)
            continue
        mx, my = (n - 1) / 2.0, sum(w) / n
        slope = sum((k - mx) * (w[k] - my) for k in range(n)) / sum((k - mx) ** 2 for k in range(n))
        out.append(my + slope * (n - 1 - mx))
    return out


def windowed(bars, seed, step, window):
    """A running value the way the engine holds one: on every bar, start from `seed` `window` bars
    back and apply `step` once per bar up to this one."""
    out = []
    for i in range(len(bars)):
        if i < window:
            out.append(NAN)
            continue
        v = seed(i - window)
        for j in range(i - window + 1, i + 1):
            v = step(j, v) if ok(v) else NAN
        out.append(v)
    return out


def carried(bars, start, seed, step):
    """The same recursion run ONCE from bar `start`, the way a chart that keeps state does."""
    out, v = [], None
    for i in range(len(bars)):
        if i < start:
            out.append(NAN)
        elif i == start:
            v = seed(i)
            out.append(v)
        else:
            v = step(i, v)
            out.append(v)
    return out


# ── one reference per output, from the published definition ──────────────────

def _kama_parts(bars, er_length, fast, slow):
    c = col(bars, "c")
    fast_sc, slow_sc = 2.0 / (fast + 1), 2.0 / (slow + 1)

    def step(j, prev):
        if j < er_length:
            return NAN
        change = abs(c[j] - c[j - er_length])
        volatility = sum(abs(c[k] - c[k - 1]) for k in range(j - er_length + 1, j + 1))
        sc = (change / volatility * (fast_sc - slow_sc) + slow_sc) ** 2
        return prev + sc * (c[j] - prev)
    return c, step


def kama(bars, er_length=10, fast=2, slow=30):
    c, step = _kama_parts(bars, er_length, fast, slow)
    return windowed(bars, lambda i: c[i], step, WINDOW)


def _mcginley_step(c, length):
    return lambda j, prev: prev + (c[j] - prev) / (length * (c[j] / prev) ** 4)


def mcginley(bars, length=14):
    c = col(bars, "c")
    return windowed(bars, lambda i: c[i], _mcginley_step(c, length), WINDOW)


def streak(bars):
    c = col(bars, "c")

    def step(j, prev):
        if c[j] > c[j - 1]:
            return prev + 1 if prev > 0 else 1.0
        if c[j] < c[j - 1]:
            return prev - 1 if prev < 0 else -1.0
        return 0.0
    return windowed(bars, lambda i: 0.0, step, STREAK_WINDOW)


def percent_rank(xs, n):
    """The guidebook's: the share of the PREVIOUS n values that are less than today's, 0 to 100."""
    out = []
    for i in range(len(xs)):
        prior = xs[i - n:i] if i >= n else []
        if len(prior) != n or not ok(xs[i]) or not all(ok(v) for v in prior):
            out.append(NAN)
            continue
        out.append(100.0 * sum(1 for v in prior if v < xs[i]) / n)
    return out


def connors_rsi(bars, rsi_length=3, streak_length=2, rank_length=100):
    c = col(bars, "c")
    a, b, r = rsi(c, rsi_length), rsi(streak(bars), streak_length), percent_rank(roc(c, 1), rank_length)
    return [(x + y + z) / 3 if ok(x) and ok(y) and ok(z) else NAN for x, y, z in zip(a, b, r)]


def atr(bars, n):
    return wilder(true_range(bars), n)


def chandelier_long(bars, length=22, atr_length=22, multiplier=3.0):
    hh, a = highest(col(bars, "h"), length), atr(bars, atr_length)
    return [h - multiplier * x if ok(h) and ok(x) else NAN for h, x in zip(hh, a)]


def chandelier_short(bars, length=22, atr_length=22, multiplier=3.0):
    ll, a = lowest(col(bars, "l"), length), atr(bars, atr_length)
    return [l + multiplier * x if ok(l) and ok(x) else NAN for l, x in zip(ll, a)]


def chaikin_money_flow(bars, length=20):
    mfv = [0.0 if b["h"] == b["l"] else ((b["c"] - b["l"]) - (b["h"] - b["c"])) / (b["h"] - b["l"]) * b["v"] for b in bars]
    top, bottom = rolling_sum(mfv, length), rolling_sum(col(bars, "v"), length)
    return [t / v if ok(t) and ok(v) and v else NAN for t, v in zip(top, bottom)]


def ultimate_oscillator(bars, fast=7, middle=14, slow=28):
    bp, tr = [NAN], [NAN]
    for i in range(1, len(bars)):
        low, high, pc = bars[i]["l"], bars[i]["h"], bars[i - 1]["c"]
        bp.append(bars[i]["c"] - min(low, pc))
        tr.append(max(high, pc) - min(low, pc))
    avg = {n: [a / b if ok(a) and ok(b) and b else NAN for a, b in zip(rolling_sum(bp, n), rolling_sum(tr, n))] for n in (fast, middle, slow)}
    return [100.0 * (4 * x + 2 * y + z) / 7 if ok(x) and ok(y) and ok(z) else NAN
            for x, y, z in zip(avg[fast], avg[middle], avg[slow])]


def awesome_oscillator(bars, fast=5, slow=34):
    mid = [(b["h"] + b["l"]) / 2 for b in bars]
    return [a - b if ok(a) and ok(b) else NAN for a, b in zip(sma(mid, fast), sma(mid, slow))]


def coppock_curve(bars, wma_length=10, long_roc=14, short_roc=11):
    c = col(bars, "c")
    both = [a + b if ok(a) and ok(b) else NAN for a, b in zip(roc(c, long_roc), roc(c, short_roc))]
    return wma(both, wma_length)


def true_strength_index(bars, long=25, short=13):
    c = col(bars, "c")
    pc = [NAN] + [c[i] - c[i - 1] for i in range(1, len(c))]
    top = ema(ema(pc, long), short)
    bottom = ema(ema([abs(v) if ok(v) else NAN for v in pc], long), short)
    return [100.0 * a / b if ok(a) and ok(b) and b else NAN for a, b in zip(top, bottom)]


def _vortex(bars, length, plus):
    vm = [NAN]
    for i in range(1, len(bars)):
        vm.append(abs(bars[i]["h"] - bars[i - 1]["l"]) if plus else abs(bars[i]["l"] - bars[i - 1]["h"]))
    return [a / b if ok(a) and ok(b) and b else NAN for a, b in zip(rolling_sum(vm, length), rolling_sum(true_range(bars), length))]


def choppiness_index(bars, length=14):
    tr_sum, hh, ll = rolling_sum(true_range(bars), length), highest(col(bars, "h"), length), lowest(col(bars, "l"), length)
    return [100.0 * math.log10(s / (h - l)) / math.log10(length) if ok(s) and ok(h) and h > l else NAN
            for s, h, l in zip(tr_sum, hh, ll)]


def elder_bull(bars, length=13):
    return [b["h"] - e if ok(e) else NAN for b, e in zip(bars, ema(col(bars, "c"), length))]


def elder_bear(bars, length=13):
    return [b["l"] - e if ok(e) else NAN for b, e in zip(bars, ema(col(bars, "c"), length))]


def squeeze_momentum(bars, bb_length=20, bb_mult=2.0, kc_length=20, kc_mult=1.5):
    c = col(bars, "c")
    hh, ll, avg = highest(col(bars, "h"), kc_length), lowest(col(bars, "l"), kc_length), sma(c, kc_length)
    delta = [c[i] - ((hh[i] + ll[i]) / 2 + avg[i]) / 2 if ok(hh[i]) and ok(avg[i]) else NAN for i in range(len(c))]
    return linreg_end(delta, kc_length)


def squeeze_on(bars, bb_length=20, bb_mult=2.0, kc_length=20, kc_mult=1.5):
    c = col(bars, "c")
    basis, dev = sma(c, bb_length), stdev_population(c, bb_length)
    mid, rng = sma(c, kc_length), sma(true_range(bars), kc_length)
    out = []
    for i in range(len(c)):
        if not all(ok(v) for v in (basis[i], dev[i], mid[i], rng[i])):
            out.append(NAN)
            continue
        out.append(1.0 if (basis[i] - bb_mult * dev[i] > mid[i] - kc_mult * rng[i]
                           and basis[i] + bb_mult * dev[i] < mid[i] + kc_mult * rng[i]) else 0.0)
    return out


def dema(bars, length=9):
    e1 = ema(col(bars, "c"), length)
    e2 = ema(e1, length)
    return [2 * a - b if ok(a) and ok(b) else NAN for a, b in zip(e1, e2)]


def tema(bars, length=9):
    e1 = ema(col(bars, "c"), length)
    e2 = ema(e1, length)
    e3 = ema(e2, length)
    return [3 * a - 3 * b + c if ok(a) and ok(b) and ok(c) else NAN for a, b, c in zip(e1, e2, e3)]


def chande_momentum_oscillator(bars, length=9):
    c = col(bars, "c")
    up = [NAN] + [max(c[i] - c[i - 1], 0.0) for i in range(1, len(c))]
    down = [NAN] + [max(c[i - 1] - c[i], 0.0) for i in range(1, len(c))]
    su, sd = rolling_sum(up, length), rolling_sum(down, length)
    return [100.0 * (a - b) / (a + b) if ok(a) and ok(b) and (a + b) else NAN for a, b in zip(su, sd)]


def _stoch_of(xs, n):
    out = []
    for i in range(len(xs)):
        w = xs[i - n + 1:i + 1] if i >= n - 1 else []
        if len(w) != n or not all(ok(v) for v in w) or max(w) == min(w):
            out.append(NAN)
            continue
        out.append(100.0 * (xs[i] - min(w)) / (max(w) - min(w)))
    return out


def _stoch_bars(bars, n):
    """The textbook %K: where the close sits between the lowest LOW and the highest HIGH of n bars."""
    h, l, c = col(bars, "h"), col(bars, "l"), col(bars, "c")
    out = []
    for i in range(len(bars)):
        if i < n - 1:
            out.append(NAN)
            continue
        hi, lo = max(h[i - n + 1:i + 1]), min(l[i - n + 1:i + 1])
        out.append(100.0 * (c[i] - lo) / (hi - lo) if hi != lo else NAN)
    return out


def stochastic_k(bars, k_length=14, k_smooth=3, d_smooth=3):
    return sma(_stoch_bars(bars, k_length), k_smooth)


def stochastic_d(bars, k_length=14, k_smooth=3, d_smooth=3):
    return sma(stochastic_k(bars, k_length, k_smooth), d_smooth)


def stoch_rsi_k(bars, rsi_length=14, stoch_length=14, k_smooth=3, d_smooth=3):
    return sma(_stoch_of(rsi(col(bars, "c"), rsi_length), stoch_length), k_smooth)


def stoch_rsi_d(bars, rsi_length=14, stoch_length=14, k_smooth=3, d_smooth=3):
    return sma(stoch_rsi_k(bars, rsi_length, stoch_length, k_smooth), d_smooth)


# ── slice 3 (2026-11-18): thirteen classics, each from its published definition ──────────────

def _days_since_extreme(xs, length, pick):
    """Over this bar and the `length` before it: how many bars ago the extreme was set (the most
    recent bar, when two hold it)."""
    out = []
    for i in range(len(xs)):
        if i < length:
            out.append(None)
            continue
        extreme = pick(xs[i - length:i + 1])
        out.append(min(k for k in range(length + 1) if xs[i - k] == extreme))
    return out


def aroon_up(bars, length=25):
    return [NAN if d is None else (length - d) / length * 100.0 for d in _days_since_extreme(col(bars, "h"), length, max)]


def aroon_down(bars, length=25):
    return [NAN if d is None else (length - d) / length * 100.0 for d in _days_since_extreme(col(bars, "l"), length, min)]


def aroon_oscillator(bars, length=25):
    return [u - d if ok(u) and ok(d) else NAN for u, d in zip(aroon_up(bars, length), aroon_down(bars, length))]


def _wilder_sums(xs, n):
    """Wilder's smoothing AS THE PAGE GIVES IT: the first value is the SUM of the first n; then
    prior - prior / n + current. (A running sum, n times the running average.)"""
    out, prev, seen = [], None, []
    for v in xs:
        if not ok(v):
            out.append(NAN if prev is None else prev)
            continue
        if prev is None:
            seen.append(v)
            if len(seen) == n:
                prev = sum(seen)
        else:
            prev = prev - prev / n + v
        out.append(NAN if prev is None else prev)
    return out


def _directional_moves(bars):
    plus, minus = [NAN], [NAN]
    for i in range(1, len(bars)):
        up, down = bars[i]["h"] - bars[i - 1]["h"], bars[i - 1]["l"] - bars[i]["l"]
        plus.append(up if up > down and up > 0 else 0.0)
        minus.append(down if down > up and down > 0 else 0.0)
    return plus, minus


def _di(bars, length, which):
    plus, minus = _directional_moves(bars)
    moves, ranges = _wilder_sums(plus if which == "plus" else minus, length), _wilder_sums(true_range(bars), length)
    return [100.0 * m / r if ok(m) and ok(r) and r else NAN for m, r in zip(moves, ranges)]


def plus_di(bars, length=14):
    return _di(bars, length, "plus")


def minus_di(bars, length=14):
    return _di(bars, length, "minus")


def adx_line(bars, length=14):
    p, m = plus_di(bars, length), minus_di(bars, length)
    dx = [100.0 * abs(a - b) / (a + b) if ok(a) and ok(b) and (a + b) else NAN for a, b in zip(p, m)]
    return wilder(dx, length)            # the simple average of the first N, then (prior x (N - 1) + DX) / N


def _running_total(steps):
    out, total = [], 0.0
    for v in steps:
        total += v
        out.append(total)
    return out


def on_balance_volume(bars):
    c, v = col(bars, "c"), col(bars, "v")
    return _running_total([0.0 if i == 0 or c[i] == c[i - 1] else (v[i] if c[i] > c[i - 1] else -v[i])
                           for i in range(len(bars))])


def accumulation_distribution_line(bars):
    return _running_total([0.0 if b["h"] == b["l"] else ((b["c"] - b["l"]) - (b["h"] - b["c"])) / (b["h"] - b["l"]) * b["v"]
                           for b in bars])


def price_volume_trend(bars):
    c, v = col(bars, "c"), col(bars, "v")
    return _running_total([0.0 if i == 0 else (c[i] - c[i - 1]) / c[i - 1] * v[i] for i in range(len(bars))])


def ppo_line(bars, fast=12, slow=26, signal=9):
    c = col(bars, "c")
    return [(f - s) / s * 100.0 if ok(f) and ok(s) else NAN for f, s in zip(ema(c, fast), ema(c, slow))]


def ppo_signal(bars, fast=12, slow=26, signal=9):
    return ema(ppo_line(bars, fast, slow), signal)


def ppo_histogram(bars, fast=12, slow=26, signal=9):
    return [a - b if ok(a) and ok(b) else NAN for a, b in zip(ppo_line(bars, fast, slow), ppo_signal(bars, fast, slow, signal))]


def kst_line(bars, roc1=10, roc2=15, roc3=20, roc4=30, sma1=10, sma2=10, sma3=10, sma4=15, signal=9):
    c = col(bars, "c")
    parts = [sma(roc(c, r), a) for r, a in ((roc1, sma1), (roc2, sma2), (roc3, sma3), (roc4, sma4))]
    return [w + 2 * x + 3 * y + 4 * z if all(ok(q) for q in (w, x, y, z)) else NAN for w, x, y, z in zip(*parts)]


def kst_signal(bars, signal=9, **lengths):
    return sma(kst_line(bars, **lengths), signal)


def mass_index(bars, length=25):
    spread = [b["h"] - b["l"] for b in bars]
    single = ema(spread, 9)
    double = ema(single, 9)
    return rolling_sum([a / b if ok(a) and ok(b) and b else NAN for a, b in zip(single, double)], length)


def force_index(bars, length=13):
    c, v = col(bars, "c"), col(bars, "v")
    return ema([NAN] + [(c[i] - c[i - 1]) * v[i] for i in range(1, len(bars))], length)


def ease_of_movement(bars, length=14, divisor=10000):
    one = [NAN]
    for i in range(1, len(bars)):
        b, a = bars[i], bars[i - 1]
        if b["h"] == b["l"] or b["v"] == 0:               # no range or no volume: counted as 0 (the entry's note)
            one.append(0.0)
            continue
        distance = (b["h"] + b["l"]) / 2 - (a["h"] + a["l"]) / 2
        one.append(distance / ((b["v"] / float(divisor)) / (b["h"] - b["l"])))
    return sma(one, length)


def negative_volume_index(bars, signal=255):
    """Fosback's, as published: from 1000; on a lower-volume bar, prior NVI + prior NVI x the price
    change; otherwise unchanged. Written as that step, bar by bar (the entry writes the same
    product as an exponential of a running total of logs)."""
    c, v = col(bars, "c"), col(bars, "v")
    out, nvi = [], 1000.0
    for i in range(len(bars)):
        if i > 0 and v[i] < v[i - 1]:
            nvi = nvi + nvi * (c[i] - c[i - 1]) / c[i - 1]
        out.append(nvi)
    return out


def trix_line(bars, length=18):
    """TradingView's own: 10,000 x the one-bar change of a triple EMA of the log of the close."""
    logs = [math.log(x) for x in col(bars, "c")]
    e3 = ema(ema(ema(logs, length), length), length)
    return [NAN] + [10000.0 * (e3[i] - e3[i - 1]) if ok(e3[i]) and ok(e3[i - 1]) else NAN for i in range(1, len(bars))]


def nvi_signal(bars, signal=255):
    return ema(negative_volume_index(bars), signal)


def positive_volume_index(bars, signal=255):
    """Fosback's, as published: on a HIGHER-volume bar, prior PVI + prior PVI x the price change;
    otherwise unchanged (an equal-volume bar too). From 1000, as its twin. Written as that step,
    bar by bar (the entry writes the same product as an exponential of a running total of logs)."""
    c, v = col(bars, "c"), col(bars, "v")
    out, pvi = [], 1000.0
    for i in range(len(bars)):
        if i > 0 and v[i] > v[i - 1]:
            pvi = pvi + pvi * (c[i] - c[i - 1]) / c[i - 1]
        out.append(pvi)
    return out


def pvi_signal(bars, signal=255):
    return ema(positive_volume_index(bars), signal)


def _fisher_inputs(bars, length):
    """Where the bar's midpoint sits in its `length`-bar range of midpoints, 0 to 1 (no value until
    the range is full, or while it is flat)."""
    mid = [(h + l) / 2 for h, l in zip(col(bars, "h"), col(bars, "l"))]
    hi, lo = highest(mid, length), lowest(mid, length)
    return [(m - b) / (a - b) if ok(a) and ok(b) and a != b else NAN for m, a, b in zip(mid, hi, lo)]


def _fisher_step(x, value, fish):
    """One bar of the published recursion: the smoothed position, SNAPPED to +/-0.999 past +/-0.99,
    then half the log of (1 + v) / (1 - v), smoothed. A bar with no position has no value, and the
    bar after it starts from 0 (the built-in reads a missing previous value as 0)."""
    value = 0.0 if not ok(value) else value
    fish = 0.0 if not ok(fish) else fish
    if not ok(x):
        return NAN, NAN
    v = 0.66 * (x - 0.5) + 0.67 * value
    v = 0.999 if v > 0.99 else -0.999 if v < -0.99 else v
    return v, 0.5 * math.log((1 + v) / (1 - v)) + 0.5 * fish


def fisher_transform(bars, length=9, window=WINDOW):
    """As the engine holds two linked running values: on every bar, both start from 0 `window` bars
    back and are stepped together up to this one."""
    x = _fisher_inputs(bars, length)
    out = []
    for i in range(len(bars)):
        if i < window:
            out.append(NAN)
            continue
        value = fish = 0.0
        for j in range(i - window + 1, i + 1):
            value, fish = _fisher_step(x[j], value, fish)
        out.append(fish)
    return out


def fisher_carried(bars, length=9):
    """The same recursion run ONCE from the first bar, the way TradingView's chart keeps it."""
    x = _fisher_inputs(bars, length)
    out, value, fish = [], 0.0, 0.0
    for i in range(len(bars)):
        value, fish = _fisher_step(x[i], value, fish)
        out.append(fish)
    return out


def fisher_trigger(bars, length=9):
    return [NAN] + fisher_transform(bars, length)[:-1]


def detrended_price_oscillator(bars, length=21):
    """TradingView's default (not centred) form, written with its own integer division: the close
    minus the `length`-bar simple average as it stood `length // 2 + 1` bars ago."""
    c = col(bars, "c")
    back = length // 2 + 1
    avg = [sum(c[i - length + 1:i + 1]) / length if i >= length - 1 else NAN for i in range(len(c))]
    return [c[i] - avg[i - back] if i - back >= 0 and ok(avg[i - back]) else NAN for i in range(len(c))]


def _laguerre_stages(src, gamma):
    """Ehlers' four Laguerre stages, carried ONCE from the first bar the way a chart keeps them
    (the engine restarts them a number of bars back instead). A missing previous value is the
    price, as the published page reads it."""
    out, prev = [], None
    for x in src:
        if not ok(x):
            out.append((NAN, NAN, NAN, NAN))
            continue
        p0, p1, p2, p3 = prev if prev is not None else (x, x, x, x)
        l0 = (1 - gamma) * x + gamma * p0
        l1 = -gamma * l0 + p0 + gamma * p1
        l2 = -gamma * l1 + p1 + gamma * p2
        l3 = -gamma * l2 + p2 + gamma * p3
        prev = (l0, l1, l2, l3)
        out.append(prev)
    return out


def laguerre_filter(bars, gamma=0.8):
    mid = [(h + l) / 2 for h, l in zip(col(bars, "h"), col(bars, "l"))]
    return [(a + 2 * b + 2 * c + d) / 6 if ok(a) else NAN for a, b, c, d in _laguerre_stages(mid, gamma)]


def laguerre_rsi(bars, gamma=0.5):
    """As PUBLISHED: each neighbouring pair's gap goes to cu when the earlier stage is at or above
    the later one and to cd otherwise, both starting from 0 on every bar; cu / (cu + cd). (The
    library's function writes the same number another way, from the first and last stage. This is
    the check that the two are the same.)"""
    out = []
    for stages in _laguerre_stages(col(bars, "c"), gamma):
        if not ok(stages[0]):
            out.append(NAN)
            continue
        cu = cd = 0.0
        for a, b in zip(stages, stages[1:]):
            if a >= b:
                cu += a - b
            else:
                cd += b - a
        out.append(cu / (cu + cd) if cu + cd != 0 else NAN)
    return out


def ulcer_index(bars, length=14):
    c = col(bars, "c")
    top = highest(c, length)
    squared = [((x - h) / h * 100.0) ** 2 if ok(h) else NAN for x, h in zip(c, top)]
    return [math.sqrt(t / length) if ok(t) else NAN for t in rolling_sum(squared, length)]


def pocket_pivot(bars):
    """Written from the six tests as the entry's evidence states them, with plain loops: not the
    Screener's detector (that comparison is tests/test_library_pocket_pivot.py) and not the engine."""
    c, h, l, v = col(bars, "c"), col(bars, "h"), col(bars, "l"), col(bars, "v")
    out = []
    for i in range(len(c)):
        if i < 199:
            out.append(NAN)
            continue
        down = [v[j] for j in range(i - 10, i) if c[j] < c[j - 1]]

        def average(n):
            return sum(c[i - n + 1:i + 1]) / n

        fires = (c[i] > c[i - 1]
                 and h[i] > l[i] and (c[i] - l[i]) / (h[i] - l[i]) >= 0.5
                 and bool(down) and v[i] > max(down)
                 and c[i] >= average(50) and c[i] >= average(200)
                 and l[i] <= average(10)
                 and c[i] > c[i - 105])
        out.append(1.0 if fires else 0.0)
    return out


def _midpoint(bars, n):
    """(highest high + lowest low) / 2 over n bars, by a plain loop over the window."""
    h, l = col(bars, "h"), col(bars, "l")
    return [(max(h[i - n + 1:i + 1]) + min(l[i - n + 1:i + 1])) / 2 if i >= n - 1 else NAN for i in range(len(h))]


def _ahead(values, bars_ahead):
    """Each value drawn `bars_ahead` bars later: the bar's value is the one worked out that long ago."""
    return [values[i - bars_ahead] if i >= bars_ahead else NAN for i in range(len(values))]


def ichimoku_conversion(bars, conversion=9, **_periods_it_does_not_read):
    return _midpoint(bars, conversion)


def ichimoku_base(bars, base=26, **_periods_it_does_not_read):
    return _midpoint(bars, base)


def ichimoku_span_a(bars, conversion=9, base=26, ahead=25, **_periods_it_does_not_read):
    a, b = _midpoint(bars, conversion), _midpoint(bars, base)
    return _ahead([(x + y) / 2 if ok(x) and ok(y) else NAN for x, y in zip(a, b)], ahead)


def ichimoku_span_b(bars, span_b=52, ahead=25, **_periods_it_does_not_read):
    return _ahead(_midpoint(bars, span_b), ahead)


REFERENCES = {
    "pocket_pivot": {"pocket_pivot": pocket_pivot},
    "ichimoku_cloud": {"conversion": ichimoku_conversion, "base": ichimoku_base, "span_a": ichimoku_span_a, "span_b": ichimoku_span_b},
    "double_exponential_moving_average": {"dema": dema},
    "triple_exponential_moving_average": {"tema": tema},
    "chande_momentum_oscillator": {"cmo": chande_momentum_oscillator},
    "stochastic_rsi": {"k": stoch_rsi_k, "d": stoch_rsi_d},
    "stochastic_oscillator": {"k": stochastic_k, "d": stochastic_d},
    "kaufman_adaptive_moving_average": {"kama": kama},
    "mcginley_dynamic": {"mcginley": mcginley},
    "connors_rsi": {"crsi": connors_rsi},
    "chandelier_exit": {"long": chandelier_long, "short": chandelier_short},
    "chaikin_money_flow": {"cmf": chaikin_money_flow},
    "ultimate_oscillator": {"uo": ultimate_oscillator},
    "awesome_oscillator": {"ao": awesome_oscillator},
    "coppock_curve": {"coppock": coppock_curve},
    "true_strength_index": {"tsi": true_strength_index},
    "vortex_indicator": {"plus": lambda bars, length=14: _vortex(bars, length, True),
                         "minus": lambda bars, length=14: _vortex(bars, length, False)},
    "choppiness_index": {"chop": choppiness_index},
    "elder_ray": {"bull": elder_bull, "bear": elder_bear},
    "squeeze_momentum": {"momentum": squeeze_momentum, "squeeze_on": squeeze_on},
    "aroon": {"up": aroon_up, "down": aroon_down, "oscillator": aroon_oscillator},
    "directional_movement_index": {"plus": plus_di, "minus": minus_di, "adx": adx_line},
    "on_balance_volume": {"obv": on_balance_volume},
    "accumulation_distribution_line": {"adl": accumulation_distribution_line},
    "price_volume_trend": {"pvt": price_volume_trend},
    "percentage_price_oscillator": {"ppo": ppo_line, "signal": ppo_signal, "histogram": ppo_histogram},
    "know_sure_thing": {"kst": kst_line, "signal": kst_signal},
    "mass_index": {"mass": mass_index},
    "force_index": {"force": force_index},
    "ease_of_movement": {"emv": ease_of_movement},
    "negative_volume_index": {"nvi": negative_volume_index, "signal": nvi_signal},
    "positive_volume_index": {"pvi": positive_volume_index, "signal": pvi_signal},
    "fisher_transform": {"fisher": fisher_transform, "trigger": fisher_trigger},
    "detrended_price_oscillator": {"dpo": detrended_price_oscillator},
    "laguerre_filter": {"filter": laguerre_filter},
    "laguerre_rsi": {"lrsi": laguerre_rsi},
    "ulcer_index": {"ulcer": ulcer_index},
    "trix": {"trix": trix_line},
}

#: Other numbers for the second pass: each inside the parameter's own range, none a default.
OTHER = {
    "pocket_pivot": {},                                   # its numbers are the detector's: none is a setting
    "ichimoku_cloud": {"conversion": 7, "base": 22, "span_b": 44, "ahead": 26},     # 26: the published shift
    "double_exponential_moving_average": {"length": 21},
    "triple_exponential_moving_average": {"length": 14},
    "chande_momentum_oscillator": {"length": 20},
    "stochastic_rsi": {"rsi_length": 10, "stoch_length": 20, "k_smooth": 5, "d_smooth": 4},
    "stochastic_oscillator": {"k_length": 21, "k_smooth": 1, "d_smooth": 5},       # K smoothing 1: the FAST one
    "kaufman_adaptive_moving_average": {"er_length": 14, "fast": 3, "slow": 20},
    "mcginley_dynamic": {"length": 9},
    "connors_rsi": {"rsi_length": 4, "streak_length": 3, "rank_length": 60},
    "chandelier_exit": {"length": 15, "atr_length": 10, "multiplier": 2.5},
    "chaikin_money_flow": {"length": 21},
    "ultimate_oscillator": {"fast": 5, "middle": 10, "slow": 20},
    "awesome_oscillator": {"fast": 4, "slow": 21},
    "coppock_curve": {"wma_length": 8, "long_roc": 20, "short_roc": 9},
    "true_strength_index": {"long": 20, "short": 9},
    "vortex_indicator": {"length": 21},
    "choppiness_index": {"length": 20},
    "elder_ray": {"length": 21},
    "squeeze_momentum": {"bb_length": 18, "bb_mult": 1.8, "kc_length": 24, "kc_mult": 1.2},
    "aroon": {"length": 14},
    "directional_movement_index": {"length": 20},
    "on_balance_volume": {},
    "accumulation_distribution_line": {},
    "price_volume_trend": {},
    "percentage_price_oscillator": {"fast": 10, "slow": 30, "signal": 7},
    "know_sure_thing": {"roc1": 9, "roc2": 12, "roc3": 18, "roc4": 24, "sma1": 6, "sma2": 7, "sma3": 8, "sma4": 9, "signal": 7},
    "mass_index": {"length": 20},
    "force_index": {"length": 2},
    "ease_of_movement": {"length": 9, "divisor": 100000000},
    "negative_volume_index": {"signal": 100},
    "positive_volume_index": {"signal": 100},
    "fisher_transform": {"length": 20},
    "detrended_price_oscillator": {"length": 20},
    "laguerre_filter": {"gamma": 0.6},
    "laguerre_rsi": {"gamma": 0.7},
    "ulcer_index": {"length": 20},
    "trix": {"length": 15},
}

ENTRIES = {e["id"]: e for e in ni.entries()}
SETTLED = 150         # compare the last bars, where a smoothing's starting convention no longer shows


def _bars(seed):
    return _walk(seed, n=620)


def _engine(tree, bars):
    """What the chart computes: the tree as the assistant writes it, its offered calls (`roc`,
    `linreg`) expanded the way the door expands them, through the server's evaluator."""
    return ast_interpret.interpret(call_expansions.expand_calls(tree), bars)


def _compare(got, want, where, rel=1e-9):
    assert len(got) == len(want)
    tail = range(len(got) - SETTLED, len(got))
    compared = 0
    for i in tail:
        g, w = got[i], want[i]
        assert ok(w), f"{where}: the reference has no value at bar {i}"
        assert ok(g), f"{where}: the engine has no value at bar {i} and the reference has {w}"
        g = 1.0 if g is True else 0.0 if g is False else float(g)
        assert math.isclose(g, w, rel_tol=rel, abs_tol=1e-9), f"{where}: bar {i}: engine {g!r} != reference {w!r}"
        compared += 1
    assert compared == SETTLED


# ── the rails ────────────────────────────────────────────────────────────────

def test_every_output_has_a_reference():
    assert set(REFERENCES) == set(ENTRIES), "an entry without a value check, or a check without an entry"
    for entry_id, e in ENTRIES.items():
        assert set(REFERENCES[entry_id]) == {o["key"] for o in e["outputs"]}, entry_id
        assert e["evidence"]["value_check"] == f"tests/test_named_indicators_values.py::{entry_id}", entry_id
        assert set(OTHER[entry_id]) == {p["key"] for p in e["params"]}, entry_id
        for p in e["params"]:
            other = OTHER[entry_id][p["key"]]
            assert p["min"] <= other <= p["max"] and other != p["default"], (entry_id, p["key"])


@pytest.mark.parametrize("entry_id", sorted(REFERENCES))
@pytest.mark.parametrize("seed", [11, 29])
def test_an_entry_equals_its_independent_calculation_at_its_default_numbers(entry_id, seed):
    e, bars = ENTRIES[entry_id], _bars(seed)
    for o in e["outputs"]:
        got = _engine(o["tree"], bars)
        _compare(got, REFERENCES[entry_id][o["key"]](bars), f"{entry_id}.{o['key']} (seed {seed})")


@pytest.mark.parametrize("entry_id", sorted(REFERENCES))
def test_an_entry_equals_its_independent_calculation_at_OTHER_numbers_written_at_its_sites(entry_id):
    """What proves `sites`: other numbers go into the TREE at the recorded sites and into the
    REFERENCE as arguments. A site on the wrong node, or a missing one, and they disagree."""
    e, bars, other = ENTRIES[entry_id], _bars(11), OTHER[entry_id]
    for o in e["outputs"]:
        used = {k: v for k, v in other.items() if k in o["sites"]}
        tree = ni.tree_at(o, used)
        if not o["sites"]:
            # an output with NO parameter (a running total has none) has no site to prove: it was
            # checked at its only numbers above, and here it is held to having none in its text
            assert "{" not in o["formula"] and tree == o["tree"], f"{entry_id}.{o['key']}"
            continue
        assert tree != o["tree"]
        got = _engine(tree, bars)
        want = REFERENCES[entry_id][o["key"]](bars, **used)
        _compare(got, want, f"{entry_id}.{o['key']} at {used}")
        # CONTROL: the reference at these numbers is NOT the reference at the defaults
        default = REFERENCES[entry_id][o["key"]](bars)
        # (over every bar: a yes/no output can agree with its default self for a long stretch)
        assert any(ok(a) and ok(b) and not math.isclose(a, b, rel_tol=1e-6, abs_tol=1e-9)
                   for a, b in zip(want, default)), f"{entry_id}.{o['key']}: the other numbers change nothing"


def test_CONTROL_the_comparison_can_fail():
    bars = _bars(11)
    e = ENTRIES["awesome_oscillator"]
    got = _engine(e["outputs"][0]["tree"], bars)
    with pytest.raises(AssertionError):
        _compare(got, awesome_oscillator(bars, fast=6), "control")
    with pytest.raises(AssertionError):
        _compare([None] * len(bars), awesome_oscillator(bars), "control")


# ── running values: how far from the same recursion carried from the first bar ──

def _worst(a, b):
    return max(abs(x - y) / abs(y) for x, y in zip(a[-SETTLED:], b[-SETTLED:]))


def test_the_mcginley_dynamic_restarted_300_bars_back_is_within_a_millionth_of_the_carried_one():
    """Its gain is 1 / (N x (price / MD) to the 4th): slower while price is above the line, so at
    length 14 the 300-bar restart is not bit-equal to the value carried from the first bar. It is
    within a few millionths, far below one price tick, and the door's note says a carried chart
    can differ. (A faster McGinley, 0.6 x 14, was graded against TradingView on 8,509 real bars:
    equal on every bar at 300 and not at 100. That capture is vendor data and stays out of the
    repository.)"""
    for seed in (11, 29):
        bars = _bars(seed)
        c = col(bars, "c")
        full = carried(bars, 0, lambda i: c[i], _mcginley_step(c, 14))
        worst = _worst(mcginley(bars), full)
        assert worst < 1e-5, worst
        short = windowed(bars, lambda i: c[i], _mcginley_step(c, 14), 40)
        assert _worst(short, full) > 100 * worst                # CONTROL: a short window does show


def test_the_fisher_transform_restarted_300_bars_back_equals_the_carried_one():
    """It SNAPS the value it feeds back (past 0.99 it becomes 0.999): a choice on its own value, so by
    its shape nothing proves that where it started stops mattering, and Create Indicator refuses the
    shape written by hand. It is in the library on evidence instead. Here: on synthetic bars the
    300-bar restart equals the recursion carried from the first bar, to the last digit, at two
    lengths. (Against TradingView's built-in on 8,509 real bars it is equal on every bar it has a
    value for, at lengths 9 and 20. That capture is vendor data and stays out of the repository.)"""
    for seed in (11, 29):
        bars = _bars(seed)
        for length in (9, 20):
            full = fisher_carried(bars, length)
            assert _worst(fisher_transform(bars, length), full) < 1e-12
            # CONTROL: a restart far too short to forget its start does show
            assert _worst(fisher_transform(bars, length, window=6), full) > 1e-3


def test_the_stochastic_entry_is_the_fast_slow_and_full_one_and_reads_highs_lows_and_closes():
    """One entry is all three: K smoothing 1 is the fast Stochastic (the textbook %K itself), 3 the
    slow one. And the bar's fields are in the ENGINE'S order: with the close first (TradingView's
    order, which an assistant writes from habit) it is another number on nearly every bar."""
    e, bars = ENTRIES["stochastic_oscillator"], _bars(11)
    k = e["outputs"][0]
    fast = _engine(ni.tree_at(k, {"k_length": 14, "k_smooth": 1}), bars)
    _compare(fast, _stoch_bars(bars, 14), "fast %K is the textbook %K")
    slow = _engine(ni.tree_at(k, {"k_length": 14, "k_smooth": 3}), bars)
    _compare(slow, sma(_stoch_bars(bars, 14), 3), "slow %K is its 3-bar average")
    assert ni.defaults(e) == {"k_length": 14, "k_smooth": 3, "d_smooth": 3}           # the slow one, as members write it
    # CONTROL: the same call with the close first
    wrong = json.loads(json.dumps(ni.tree_at(k, {"k_length": 14, "k_smooth": 1})))
    call = wrong["args"][0]
    assert [a["name"] for a in call["args"][:3]] == ["high", "low", "close"]
    call["args"][:3] = [call["args"][2], call["args"][0], call["args"][1]]
    with pytest.raises(AssertionError):
        _compare(_engine(wrong, bars), _stoch_bars(bars, 14), "control")


def test_the_detrended_price_oscillator_derives_its_bars_back_from_its_length_at_odd_and_even_lengths():
    """21 and 20 both read the average 11 bars back (integer division), 14 and 15 both 8. The engine's
    function and this file's own arithmetic must agree at each, and a count one off must not."""
    bars = _bars(11)
    for length in (21, 20, 14, 15, 2, 1):
        call = {"type": "call", "name": "dpo", "args": [{"type": "series", "name": "close"}, {"type": "num", "value": length}]}
        tree = call_expansions.expand_calls(call)
        assert tree["args"][1]["value"] == length // 2 + 1
        _compare(ast_interpret.interpret(tree, bars), detrended_price_oscillator(bars, length), f"dpo {length}")
        off = json.loads(json.dumps(tree))
        off["args"][1]["value"] += 1
        with pytest.raises(AssertionError):
            _compare(ast_interpret.interpret(off, bars), detrended_price_oscillator(bars, length), "control")


def test_the_laguerre_pair_restarted_equals_the_stages_carried_from_the_first_bar():
    """The references above carry the four stages from the first bar; the library's functions restart
    them a number of bars back that is sized from gamma. The rails above hold the two equal at each
    entry's default and at another gamma. Here, the gammas at the top of each restart tier (where the
    filter remembers longest for its window), and a CONTROL: with the restart cut to 12 bars the
    same comparison fails, so it is the window's length that makes them equal."""
    bars = _walk(11, n=1400)
    mid = {"type": "op", "name": "/", "args": [{"type": "op", "name": "+", "args": [
        {"type": "series", "name": "high"}, {"type": "series", "name": "low"}]}, {"type": "num", "value": 2}]}
    close = {"type": "series", "name": "close"}

    def cut(node, bars_back):
        if isinstance(node, dict):
            if node.get("type") == "call" and node.get("name") == "accum4":
                node["args"][1] = {"type": "num", "value": bars_back}
            for a in node.get("args") or []:
                cut(a, bars_back)
        return node

    for gamma in (0.5, 0.7, 0.8, 0.9, 0.95):
        for name, source, reference in (("laguerre", mid, laguerre_filter), ("laguerreRsi", close, laguerre_rsi)):
            call = {"type": "call", "name": name, "args": [source, {"type": "num", "value": gamma}]}
            tree = call_expansions.expand_calls(call)
            want = reference(bars, gamma=gamma)
            _compare(ast_interpret.interpret(tree, bars), want, f"{name} at gamma {gamma}", rel=1e-7)
            short = ast_interpret.interpret(cut(json.loads(json.dumps(tree)), 12), bars)
            with pytest.raises(AssertionError):
                _compare(short, want, "control", rel=1e-7)


def test_the_laguerre_rsi_reference_is_the_published_sums_and_they_start_from_zero_each_bar():
    """The page does not say the up and down sums restart on every bar; the entry takes them so, and
    this is where that is held, on two bars worked by hand at gamma 0.5 from a flat 10.

    Close 12: the stages are 11, 9.5, 10.25, 9.875. The gaps are +1.5, -0.75, +0.375, so cu is 1.875
    and cd is 0.75. Close 8 next: the stages are 9.5, 11, 9.125, 10.625; the gaps are -1.5, +1.875,
    -1.5, so cu is 1.875 and cd is 3. Carried from the bar before instead, the sums would be 3.75 and
    3.75, and the answer one half."""
    bar = lambda c: {"o": c, "h": c, "l": c, "c": c, "v": 1}
    flat = [bar(10.0)] * 4
    assert not ok(laguerre_rsi(flat)[-1])                       # all four stages equal: no value, as published
    got = laguerre_rsi(flat + [bar(12.0), bar(8.0)])
    assert _laguerre_stages([10.0, 12.0, 8.0], 0.5)[1:] == [(11.0, 9.5, 10.25, 9.875), (9.5, 11.0, 9.125, 10.625)]
    assert got[-2] == pytest.approx(1.875 / 2.625)
    assert got[-1] == pytest.approx(1.875 / 4.875) and got[-1] != pytest.approx(0.5)
    assert all(0.0 <= v <= 1.0 for v in laguerre_rsi(_bars(29)) if ok(v))


def test_the_fisher_references_snap_is_a_snap_and_not_a_clamp():
    """The detail vendors differ on, held where the reference is written: just past 0.99 the value
    fed back is 0.999, not the value itself and not 0.99."""
    v, _ = _fisher_step(1.0, 0.99, 0.0)                    # 0.66 x 0.5 + 0.67 x 0.99 = 0.9933
    assert v == 0.999
    v, _ = _fisher_step(0.0, -0.99, 0.0)
    assert v == -0.999
    v, _ = _fisher_step(1.0, 0.98, 0.0)                    # 0.9866: inside, kept as it is
    assert v == pytest.approx(0.9866)
    assert all(not ok(a) for a in _fisher_step(NAN, 0.5, 0.5))


def test_kama_restarted_300_bars_back_is_close_to_the_carried_one_and_not_equal():
    """KAMA's gain is the efficiency ratio squared: in a directionless stretch it falls to
    (2/31) squared and the value hardly forgets its start. So the door's STRONGER sentence is the
    true one for it, and this number is why: small, and not zero."""
    worst = 0.0
    for seed in (11, 29):
        bars = _bars(seed)
        c, step = _kama_parts(bars, 10, 2, 30)
        full = carried(bars, 10, lambda i: c[i], step)
        worst = max(worst, _worst(kama(bars), full))
    assert 0 < worst < 5e-3, worst


def test_the_streak_inside_connors_rsi_is_exact_while_the_real_streak_is_shorter_than_its_window():
    bars = _bars(11)
    c = col(bars, "c")

    def step(j, prev):
        if c[j] > c[j - 1]:
            return prev + 1 if prev > 0 else 1.0
        if c[j] < c[j - 1]:
            return prev - 1 if prev < 0 else -1.0
        return 0.0
    full = carried(bars, 0, lambda i: 0.0, step)
    assert max(abs(v) for v in full) < STREAK_WINDOW             # the precondition, on these bars
    assert streak(bars)[-SETTLED:] == full[-SETTLED:]


def test_the_ichimoku_spans_are_drawn_25_bars_after_the_bar_they_are_worked_out_on():
    """The defect this entry exists for: the spans AT the bar they are computed on are the right
    numbers on the wrong bars. The entry's span on bar i is the unshifted value of bar i - 25, and
    is NOT the unshifted value of bar i."""
    e, bars = ENTRIES["ichimoku_cloud"], _bars(11)
    out = {o["key"]: o for o in e["outputs"]}
    span_a, span_b = _engine(out["span_a"]["tree"], bars), _engine(out["span_b"]["tree"], bars)
    conv, base = _engine(out["conversion"]["tree"], bars), _engine(out["base"]["tree"], bars)
    unshifted_b = _midpoint(bars, 52)
    differs = 0
    for i in range(len(bars) - SETTLED, len(bars)):
        assert math.isclose(span_a[i], (conv[i - 25] + base[i - 25]) / 2, rel_tol=1e-12), i
        assert math.isclose(span_b[i], unshifted_b[i - 25], rel_tol=1e-12), i
        differs += not math.isclose(span_b[i], unshifted_b[i], rel_tol=1e-9)
    assert differs > SETTLED // 2, "the shifted span equals the unshifted one: the walk cannot tell them apart"
    # the lagging span is left out, and the entry says so
    assert set(out) == {"conversion", "base", "span_a", "span_b"}
    note = e["evidence"]["published"].get("note") or ""
    assert "LAGGING SPAN IS LEFT OUT" in note and "25" in note
