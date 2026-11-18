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


REFERENCES = {
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
}

#: Other numbers for the second pass: each inside the parameter's own range, none a default.
OTHER = {
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
