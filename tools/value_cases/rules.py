"""The independent calculations of the value cases: one plain calculation per honest reading of a request's words.

`rules(case_id)` answers ``{what the member asked to see: [(reading, column), ...]}`` on the built market of
`market.py`, or None for an id with no rule. A request can be read more than one honest way (which ATR, which
seed of an average, "the last 20" with or without this bar), so a rule lists READINGS; a built indicator is right
when, for every named thing, one of its formulas equals one reading on every bar both have a value.

⛔ These are written from the REQUEST'S WORDS, never from an answer. A rule that is edited to agree with what the
assistant built stops being a check. When a rule is wrong, fix it from the words and say so in the commit.

Plain loops on purpose: nothing here imports the engine, so a change in the engine cannot move both sides at once.
"""
import math

from .market import OTHER, STOCK

NAN = float('nan')
ok = lambda v: v is not None and not (isinstance(v, float) and math.isnan(v))  # noqa: E731
day = lambda b: str(b['t'])[:10]  # noqa: E731
BARS = STOCK
N = len(BARS)
O = [b['o'] for b in BARS]; H = [b['h'] for b in BARS]; L = [b['l'] for b in BARS]; C = [b['c'] for b in BARS]; V = [b['v'] for b in BARS]  # noqa: E702
_by = {k: {day(b): b for b in v} for k, v in OTHER.items()}


def other(sym, f='c'):
    """Another symbol's series on the stock's own days (no value on a day it has no bar)."""
    return [_by[sym][day(b)][f] if day(b) in _by[sym] else NAN for b in BARS]


SC = other('SPY')


def bind(bars):
    """Compute every rule on `bars` from now on (an EDGE chart, `edges.py`; the plain bars to restore). The same
    rules, the same words: only the market they are computed on moves."""
    global BARS, N, O, H, L, C, V, SC
    BARS = bars
    N = len(BARS)
    O = [b['o'] for b in BARS]; H = [b['h'] for b in BARS]; L = [b['l'] for b in BARS]; C = [b['c'] for b in BARS]; V = [b['v'] for b in BARS]  # noqa: E702
    SC = other('SPY')


def sma(x, n):
    out = [NAN] * len(x)
    for i in range(n - 1, len(x)):
        w = x[i - n + 1:i + 1]
        out[i] = sum(w) / n if all(ok(v) for v in w) else NAN
    return out


def ema(x, n, seed='sma'):
    a, out = 2 / (n + 1), [NAN] * len(x)
    start = next((i for i in range(len(x)) if ok(x[i])), None)
    if start is None:
        return out
    if seed == 'first':
        out[start] = x[start]
        for i in range(start + 1, len(x)):
            out[i] = a * x[i] + (1 - a) * out[i - 1] if ok(x[i]) else NAN
        return out
    first = start + n - 1
    if first >= len(x):
        return out
    out[first] = sum(x[start:first + 1]) / n
    for i in range(first + 1, len(x)):
        out[i] = a * x[i] + (1 - a) * out[i - 1]
    return out


def true_range():
    return [H[i] - L[i] if i == 0 else max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1])) for i in range(N)]


def rma(x, n):
    out = [NAN] * len(x)
    if len(x) >= n:
        out[n - 1] = sum(x[:n]) / n
        for i in range(n, len(x)):
            out[i] = (out[i - 1] * (n - 1) + x[i]) / n
    return out


def rma_from_first(x, n):
    """Wilder's smoothing started at the first value itself (no simple-average start)."""
    out = [NAN] * len(x)
    out[0] = x[0]
    for i in range(1, len(x)):
        out[i] = (out[i - 1] * (n - 1) + x[i]) / n
    return out


def atr(n, kind='rma'):
    tr = true_range()
    if kind == 'wilder':
        # Wilder's original, UCT's own `atr`: the first true range is bar 1's, the first value the mean of n of them
        out = [NAN] * N
        if N > n:
            out[n] = sum(tr[1:n + 1]) / n
            for i in range(n + 1, N):
                out[i] = (out[i - 1] * (n - 1) + tr[i]) / n
        return out
    return rma(tr, n) if kind == 'rma' else rma_from_first(tr, n) if kind == 'first' else sma(tr, n)


def roll(x, n, fn):
    out = [NAN] * len(x)
    for i in range(n - 1, len(x)):
        w = x[i - n + 1:i + 1]
        out[i] = fn(w) if all(ok(v) for v in w) else NAN
    return out


def stdev(x, n, sample=False):
    def f(w):
        m = sum(w) / n
        return math.sqrt(sum((v - m) ** 2 for v in w) / (n - 1 if sample else n))
    return roll(x, n, f)


def col(fn):
    return [fn(i) for i in range(N)]


def both(*xs):
    return all(ok(x) for x in xs)


def flag(cond_fn):
    """A yes/no column: 1/0 where the rule can be decided, no value where an input has none."""
    out = []
    for i in range(N):
        v = cond_fn(i)
        out.append(NAN if v is None else (1.0 if v else 0.0))
    return out


#: ROUND 17 requests the door answers WITHOUT a script. Each was written for the script lane, from the request's words
#: and before any answer; the live pass (2026-11-23) showed the formula lane holds them. ONE rule whichever lane
#: answers: the script lane's own rule function, bound to this lane's bars. Never a second copy of it here.
SAME_RULE_AS_THE_SCRIPT_LANE = ('cap-02', 'cap-03', 'cap-07', 'cap-09')


def _script_lane_rule(cid):
    from .script_rules import RULES as script_lane_rules, bind
    bind({'bars': BARS})
    return script_lane_rules[cid]()


def exact(cid):
    """The named things of a rule whose NOTHING is part of what was asked ("only while the close is above", "plot
    nothing when there is none"). `grade.grade` then wants no value on every bar the rule holds none, and a value on
    every bar it holds one. Empty for a rule whose empty bars are only bars it does not compare (a warm-up)."""
    if cid in SAME_RULE_AS_THE_SCRIPT_LANE:
        variants = _script_lane_rule(cid)
        return {variants[0][0]} if all(len(v) > 3 and v[3] == 'exact' for v in variants) else set()
    return set()


# ── the rules, from each request's own words ──
def rules(cid):
    if cid in SAME_RULE_AS_THE_SCRIPT_LANE:
        variants = _script_lane_rule(cid)                # readings of ONE named thing: any one of them right is right
        return {variants[0][0]: [(v[0], [NAN if x is None else x for x in v[1]]) for v in variants]}
    # ── round 2: semantic traps ──
    up = lambda k: k > 0 and C[k] > C[k - 1]      # noqa: E731
    dn = lambda k: k > 0 and C[k] < C[k - 1]      # noqa: E731
    chg = [NAN if i == 0 else (C[i] / C[i - 1] - 1) * 100 for i in range(N)]

    def window(n, prior, pred, val, agg, empty=NAN):
        """agg over val(k) for the bars k of an n-bar window that pass pred; `empty` when none do."""
        out = []
        for i in range(N):
            lo, hi = (i - n, i - 1) if prior else (i - n + 1, i)
            if lo < 1:
                out.append(NAN); continue
            vals = [val(k) for k in range(lo, hi + 1) if pred(k)]
            out.append(agg(vals) if vals else empty)
        return out

    def both_windows(n, pred, val, agg, empties=(NAN,)):
        return [(f"{'the n bars before this one' if pr else 'the last n bars with this one'}, none -> {e}", window(n, pr, pred, val, agg, e))
                for pr in (False, True) for e in empties]

    def bars_since(event):
        out, last = [], None
        for i in range(N):
            e = event(i)
            if e:
                last = i
            out.append(NAN if last is None else float(i - last))
        return out
    mean = lambda v: sum(v) / len(v)              # noqa: E731
    if cid == 'd01':
        return {'average up-day volume': both_windows(20, up, lambda k: V[k], mean, (NAN, 0.0))}
    if cid == 'd02':
        return {'down-day volume': both_windows(10, dn, lambda k: V[k], sum, (0.0,))}
    if cid == 'd03':
        return {'count': both_windows(10, up, lambda k: 1.0, sum, (0.0,))}
    if cid == 'd04':
        av = sma(V, 50)
        return {'highest close': both_windows(30, lambda k: ok(av[k]) and V[k] > av[k], lambda k: C[k], max, (NAN, 0.0))}
    if cid == 'd05':
        return {'bars since': [('at the high of the last 50 with this bar', bars_since(lambda i: i >= 49 and C[i] >= max(C[i - 49:i + 1]))),
                               ('above the high of the 50 before', bars_since(lambda i: i >= 50 and C[i] > max(C[i - 50:i])))]}
    if cid == 'd06':
        v = []
        for n_prior, denom in ((100, 100), (99, 100), (99, 99)):
            for name, cmp_ in (('below', lambda a, b: a < b), ('at or below', lambda a, b: a <= b)):
                v.append((f'{n_prior} bars before, {name}, over {denom}',
                          [NAN if i < n_prior else sum(1 for k in range(i - n_prior, i) if cmp_(C[k], C[i])) / denom * 100 for i in range(N)]))
        return {'percent below': v}
    if cid == 'd07':
        return {'gap': [('percent', [NAN if i == 0 else (O[i] / C[i - 1] - 1) * 100 for i in range(N)])]}
    if cid == 'd08':
        return {'count': both_windows(60, lambda k: k > 0 and (O[k] / C[k - 1] - 1) * 100 >= 2, lambda k: 1.0, sum, (0.0,))}
    if cid == 'd09':
        out, n = [], 0
        for i in range(N):
            n = n + 1 if up(i) else 0
            out.append(NAN if i == 0 else float(n))
        return {'streak': [('resets on a close not higher', out)]}
    if cid == 'd10':
        hh, ll = roll(H, 14, max), roll(L, 14, min)
        return {'position': [('raw', [(C[i] - ll[i]) / (hh[i] - ll[i]) * 100 if both(hh[i], ll[i]) and hh[i] != ll[i] else NAN for i in range(N)])]}
    if cid == 'd11':
        return {'inside': [('inside bar', flag(lambda i: None if i == 0 else (H[i] < H[i - 1] and L[i] > L[i - 1])))]}
    if cid == 'd12':
        rng = [H[i] - L[i] for i in range(N)]
        return {'narrowest': [('at the lowest of the last 7 with this bar', flag(lambda i: None if i < 6 else rng[i] <= min(rng[i - 6:i + 1]))),
                              ('below the lowest of the 6 before', flag(lambda i: None if i < 6 else rng[i] < min(rng[i - 6:i]))),
                              ('below the lowest of the 7 before', flag(lambda i: None if i < 7 else rng[i] < min(rng[i - 7:i])))]}
    if cid == 'd13':
        return {'count': both_windows(25, lambda k: k > 0 and chg[k] <= -0.2 and V[k] > V[k - 1], lambda k: 1.0, sum, (0.0,))}
    if cid == 'd14':
        def pp(none_is):
            def f(i):
                if i < 11:
                    return None
                dv = [V[k] for k in range(i - 10, i) if dn(k)]
                return up(i) and (none_is if not dv else V[i] > max(dv))
            return flag(f)
        return {'pivot': [(f"no down day counts as {'yes' if n else 'no'}", pp(n)) for n in (True, False)]}
    if cid == 'd15':
        av = sma(V, 50)
        return {'relative volume': [('ratio', [V[i] / av[i] if ok(av[i]) else NAN for i in range(N)]),
                                    ('percent', [V[i] / av[i] * 100 if ok(av[i]) else NAN for i in range(N)])]}
    if cid == 'd16':
        return {'closing range': [('percent', [(C[i] - L[i]) / (H[i] - L[i]) * 100 if H[i] != L[i] else NAN for i in range(N)])]}
    if cid == 'd17':
        return {'new high': [('at the highest of the last 252 with this bar', flag(lambda i: None if i < 251 else C[i] >= max(C[i - 251:i + 1]))),
                             ('above the highest of the 252 before', flag(lambda i: None if i < 252 else C[i] > max(C[i - 252:i]))),
                             ('above the highest of the 251 before', flag(lambda i: None if i < 251 else C[i] > max(C[i - 251:i])))]}
    if cid == 'd18':
        return {'atr%': [(f'ATR by {k}', [a[i] / C[i] * 100 if ok(a[i]) else NAN for i in range(N)]) for k in ('wilder', 'rma', 'sma') for a in [atr(14, k)]]}
    if cid == 'd19':
        hh, ll = roll(H, 10, max), roll(L, 10, min)
        return {'range%': [('percent of close', [(hh[i] - ll[i]) / C[i] * 100 if both(hh[i], ll[i]) else NAN for i in range(N)])]}
    if cid == 'd20':
        m = sma(C, 50)
        return {'slope%': [('percent', [NAN if i < 10 or not both(m[i], m[i - 10]) else (m[i] / m[i - 10] - 1) * 100 for i in range(N)])]}
    if cid == 'd21':
        v = []
        for seed in ('sma', 'first'):
            e = ema(C, 21, seed)
            cross = lambda k, e=e: k > 0 and both(e[k], e[k - 1]) and ((C[k] > e[k]) != (C[k - 1] > e[k - 1]))   # noqa: E731
            v += [(f'seed {seed}, {name}', col_) for name, col_ in both_windows(30, cross, lambda k: 1.0, sum, (0.0,))]
        return {'crosses': v}
    if cid == 'd22':
        out, ups = [], []
        for i in range(N):
            if up(i):
                ups.append(V[i])
            out.append(mean(ups[-10:]) if len(ups) >= 10 else NAN)
        return {'average of the last 10 up days': [('with this bar', out)]}
    if cid == 'd23':
        return {'biggest gain': both_windows(60, lambda k: k > 0, lambda k: chg[k], max)}
    if cid == 'd24':
        return {'bars since': [('4% up close', bars_since(lambda i: i > 0 and chg[i] >= 4))]}
    if cid == 'd25':
        return {'lowest down-day low': both_windows(15, dn, lambda k: L[k], min)}
    if cid == 'e01':
        return {'lowest down-day low': both_windows(4, dn, lambda k: L[k], min)}
    if cid == 'd26':
        return {'spread': [('percent', [NAN if i < 20 or not both(SC[i], SC[i - 20]) else (C[i] / C[i - 20] - 1) * 100 - (SC[i] / SC[i - 20] - 1) * 100 for i in range(N)])]}
    # ── round 3 ──
    if cid == 'f01':
        m = sma(C, 50)
        return {'cross above': [(name, flag(lambda i, cmp_=cmp_: None if i == 0 or not both(m[i], m[i - 1]) else (C[i] > m[i] and cmp_(C[i - 1], m[i - 1]))))
                                for name, cmp_ in (('was at or below', lambda a, b: a <= b), ('was below', lambda a, b: a < b))]}
    if cid == 'f02':
        v = []
        for cname, cond in (('at the high of the last 20 with this bar', lambda i: i >= 19 and C[i] >= max(C[i - 19:i + 1])),
                            ('above the high of the 20 before', lambda i: i >= 20 and C[i] > max(C[i - 20:i]))):
            for n in (30, 29):
                v.append((f'{cname}; none on the {n} bars before',
                          flag(lambda i, cond=cond, n=n: None if i < 20 + n else (cond(i) and not any(cond(k) for k in range(i - n, i))))))
        return {'first in 30': v}
    if cid == 'f03':
        m = sma(C, 50)
        v = []
        for name, cmp_ in (('was at or below', lambda a, b: a <= b), ('was below', lambda a, b: a < b)):
            out, cur = [], NAN
            for i in range(N):
                if i > 0 and both(m[i], m[i - 1]) and C[i] > m[i] and cmp_(C[i - 1], m[i - 1]):
                    cur = C[i]
                elif ok(cur):
                    cur = max(cur, C[i])
                out.append(cur)
            v.append((name, out))
        return {'highest close since': v}
    if cid == 'f04':
        return {'change': [('percent', [NAN if i < 63 else (C[i] / C[i - 63] - 1) * 100 for i in range(N)])]}
    if cid == 'f05':
        return {'average range%': [('over the low', sma([(H[k] - L[k]) / L[k] * 100 for k in range(N)], 10))]}
    if cid == 'f06':
        v = []
        for seed in ('sma', 'first'):
            e = ema(C, 21, seed)
            v += [(f'seed {seed}, {n}', c_) for n, c_ in both_windows(50, lambda k, e=e: ok(e[k]) and C[k] > e[k], lambda k: 1.0, sum, (0.0,))]
        return {'count': v}
    if cid == 'f08':
        return {'deviation': [('population', stdev(chg, 20)), ('sample', stdev(chg, 20, True))]}
    if cid == 'f09':
        return {'percent of high': [(f'{name}, {wname}', [NAN if i < 252 else C[i] / max(src[i - lo:i + hi]) * 100 for i in range(N)])
                                    for name, src in (('closes', C), ('highs', H)) for wname, lo, hi in (('with this bar', 251, 1), ('the 252 before', 252, 0))]}
    if cid == 'f10':
        a = sma([H[k] - L[k] for k in range(N)], 14)
        b = sma([NAN if k == 0 else abs(C[k] - C[k - 1]) for k in range(N)], 14)
        return {'ratio': [('range over change', [a[i] / b[i] if both(a[i], b[i]) and b[i] else NAN for i in range(N)])]}
    if cid == 'f11':
        pv, vv = roll([C[k] * V[k] for k in range(N)], 20, sum), roll(V, 20, sum)
        return {'vwap20': [('sum pv / sum v', [pv[i] / vv[i] if both(pv[i], vv[i]) and vv[i] else NAN for i in range(N)])]}
    if cid == 'f12':
        out, t = [], 0.0
        for i in range(N):
            if up(i):
                t += V[i]
            elif dn(i):
                t -= V[i]
            out.append(t)
        return {'running total': [('from the first bar', out)]}
    if cid == 'f13':
        return {'gap and go': [('gap over the prior high, close over the open', flag(lambda i: None if i == 0 else (O[i] > H[i - 1] and C[i] > O[i])))]}
    if cid == 'f14':
        m = sma(C, 50)
        return {'spread%': [(f'seed {seed}', [(e[i] / m[i] - 1) * 100 if both(e[i], m[i]) else NAN for i in range(N)]) for seed in ('sma', 'first') for e in [ema(C, 21, seed)]]}
    if cid == 'f15':
        top = lambda i: H[i] != L[i] and (C[i] - L[i]) / (H[i] - L[i]) >= 0.75     # noqa: E731
        return {'volume high, strong close': [
            ('at the highest of the last 50 with this bar', flag(lambda i: None if i < 49 else (V[i] >= max(V[i - 49:i + 1]) and top(i)))),
            ('above the highest of the 50 before', flag(lambda i: None if i < 50 else (V[i] > max(V[i - 50:i]) and top(i)))),
            ('above the highest of the 49 before', flag(lambda i: None if i < 49 else (V[i] > max(V[i - 49:i]) and top(i))))]}
    if cid == 'f16':
        return {'lowest close before today': [('the 20 before', [NAN if i < 20 else min(C[i - 20:i]) for i in range(N)])],
                'highest close before today': [('the 20 before', [NAN if i < 20 else max(C[i - 20:i]) for i in range(N)])]}
    if cid == 'f17':
        return {'net up days': both_windows(20, lambda k: k > 0, lambda k: (1.0 if up(k) else -1.0 if dn(k) else 0.0), sum, (0.0,))}
    if cid == 'f19':
        a, b, c_ = sma(C, 10), sma(C, 20), sma(C, 50)
        return {'stacked and rising': [('all three', flag(lambda i: None if i < 5 or not both(a[i], b[i], c_[i], a[i - 5], b[i - 5], c_[i - 5]) else
                                                          (a[i] > b[i] > c_[i] and a[i] > a[i - 5] and b[i] > b[i - 5] and c_[i] > c_[i - 5])))]}
    if cid == 'f20':
        path = roll([NAN if k == 0 else abs(C[k] - C[k - 1]) for k in range(N)], 20, sum)
        return {'efficiency': [('signed', [NAN if i < 20 or not ok(path[i]) or not path[i] else (C[i] - C[i - 20]) / path[i] for i in range(N)]),
                               ('unsigned', [NAN if i < 20 or not ok(path[i]) or not path[i] else abs(C[i] - C[i - 20]) / path[i] for i in range(N)])]}
    if cid == 'f21':
        return {'median': [('21 closes', roll(C, 21, lambda w: sorted(w)[10]))]}
    if cid == 'f22':
        def since(pick):
            out = []
            for i in range(N):
                if i < 59:
                    out.append(NAN); continue
                w = L[i - 59:i + 1]
                lo = min(w)
                ks = [59 - j for j, x in enumerate(w) if x == lo]
                out.append(float(pick(ks)))
            return out
        return {'bars since the low': [('the most recent bar at the low', since(min)), ('the earliest bar at the low', since(max))]}
    if cid == 'f23':
        return {'undercut and up': [('below the lowest of the 10 before, close above the prior close', flag(lambda i: None if i < 10 else (L[i] < min(L[i - 10:i]) and C[i] > C[i - 1])))]}
    if cid == 'f24':
        return {'rank': [('with this bar', [NAN if i < 19 else 1.0 + sum(1 for k in range(i - 19, i + 1) if V[k] > V[i]) for i in range(N)]),
                         ('against the 20 before', [NAN if i < 20 else 1.0 + sum(1 for k in range(i - 20, i) if V[k] > V[i]) for i in range(N)]),
                         ('against the 19 before', [NAN if i < 19 else 1.0 + sum(1 for k in range(i - 19, i) if V[k] > V[i]) for i in range(N)])]}
    # ── round 4 ──
    if cid and cid[0] == 'g':
        R = [H[k] - L[k] for k in range(N)]
        ATRS = [(kind, atr(14, kind)) for kind in ('rma', 'wilder', 'first', 'sma')]
        SEEDS = ('sma', 'first')

        def rsi_of(src, n):
            g = [NAN] + [max(src[i] - src[i - 1], 0.0) for i in range(1, N)]
            l_ = [NAN] + [max(src[i - 1] - src[i], 0.0) for i in range(1, N)]
            out, ag, al = [NAN] * N, NAN, NAN
            for i in range(n, N):
                if i == n:
                    ag, al = sum(g[1:n + 1]) / n, sum(l_[1:n + 1]) / n
                else:
                    ag, al = (ag * (n - 1) + g[i]) / n, (al * (n - 1) + l_[i]) / n
                out[i] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
            return out
        dist_day = lambda k: k > 0 and C[k] <= C[k - 1] * (1 - 0.002) and V[k] > V[k - 1]   # noqa: E731
        if cid == 'g01':
            return {'narrowest of 7': [('at the smallest of the last 7 with this bar', flag(lambda i: None if i < 6 else R[i] <= min(R[i - 6:i + 1]))),
                                       ('below the smallest of the 6 before', flag(lambda i: None if i < 6 else R[i] < min(R[i - 6:i])))]}
        if cid == 'g02':
            # ⭐ 2026-11-25 (coordinator's ruling): the words are strict ("the high is BELOW the prior bar's high and the
            # low is ABOVE the prior bar's low"), so only the strict reading is honest; "at or inside" is gone
            return {'inside bar': [('strictly inside', flag(lambda i: None if i == 0 else (H[i] < H[i - 1] and L[i] > L[i - 1])))]}
        if cid == 'g03':
            return {'outside bar': [('strictly outside', flag(lambda i: None if i == 0 else (H[i] > H[i - 1] and L[i] < L[i - 1])))]}
        if cid == 'g04':
            xs = [('average range over the close', [a / C[i] * 100 if ok(a) else NAN for i, a in enumerate(sma(R, 14))]),
                  ('average of each bar range over its close', sma([R[k] / C[k] * 100 for k in range(N)], 14))]
            v = [(f'{xname}, {name}', flag(lambda i, x=x, m=m, sd=sd: None if not both(x[i], m[i], sd[i]) else x[i] > m[i] + 2 * sd[i]))
                 for xname, x in xs for m in [sma(x, 100)] for name, sd in (('population', stdev(x, 100)), ('sample', stdev(x, 100, True)))]
            return {'range%': xs, 'two deviations above': v}
        if cid == 'g05':
            r14, r3 = rsi_of(C, 14), rsi_of(C, 3)
            s3 = sma(r3, 3)
            return {'blend': [('wilder rsi', [r14[i] - r14[i - 9] + s3[i] if i >= 9 and both(r14[i], r14[i - 9], s3[i]) else NAN for i in range(N)])]}
        if cid == 'g06':
            return {'atr multiples': [(f'ema seed {seed}, atr {kind}', [(C[i] - e[i]) / a[i] if both(e[i], a[i]) and a[i] else NAN for i in range(N)])
                                      for seed in SEEDS for e in [ema(C, 21, seed)] for kind, a in ATRS]}
        if cid == 'g07':
            m = sma(C, 50)
            return {'atr% multiple': [(f'atr {kind}', [((C[i] / m[i] - 1) * 100) / (a[i] / C[i] * 100) if both(m[i], a[i]) and a[i] else NAN for i in range(N)])
                                      for kind, a in ATRS]}
        if cid == 'g08':
            return {'4% on volume': [('up 4% and over 9M', flag(lambda i: None if i == 0 else (C[i] >= C[i - 1] * 1.04 and V[i] > 9000000)))]}
        if cid == 'g09':
            return {'slope%': [(f'seed {seed}', [(e[i] / e[i - 5] - 1) * 100 if i >= 5 and both(e[i], e[i - 5]) else NAN for i in range(N)])
                               for seed in SEEDS for e in [ema(C, 21, seed)]]}
        if cid == 'g10':
            hh, ll = roll(H, 9, max), roll(L, 9, min)
            wr = [(hh[i] - C[i]) / (hh[i] - ll[i]) * -100 if both(hh[i], ll[i]) and hh[i] != ll[i] else NAN for i in range(N)]
            return {'percent r': [('nine bars', wr)], 'its average': [(f'seed {seed}', ema(wr, 9, seed)) for seed in SEEDS]}
        if cid == 'g11':
            return {'extended from the low': [(f'atr {kind}', flag(lambda i, a=a: None if not ok(a[i]) else (C[i] - L[i]) > 0.6 * a[i])) for kind, a in ATRS]}
        if cid == 'g12':
            return {'down on volume': [('at least 0.2% down, more volume', flag(lambda i: None if i == 0 else dist_day(i)))]}
        if cid == 'g13':
            return {'count': both_windows(25, dist_day, lambda k: 1.0, sum, (0.0,))}
        if cid == 'g14':
            v = []
            for seed in SEEDS:
                a, b = ema(C, 10, seed), ema(C, 21, seed)
                v.append((f'seed {seed}', flag(lambda i, a=a, b=b: None if not both(a[i], b[i]) else (C[i] > a[i] and a[i] > b[i]))))
            return {'stacked': v}
        if cid == 'g15':
            return {'hidden strength': [('close down, above the open, low under two bars ago', flag(lambda i: None if i < 2 else (C[i] < C[i - 1] and C[i] > O[i] and L[i] < L[i - 2])))]}
        if cid == 'g16':
            return {'excess return': [('percent points', [NAN if i == 0 or not both(SC[i], SC[i - 1]) else (C[i] / C[i - 1] - 1) * 100 - (SC[i] / SC[i - 1] - 1) * 100 for i in range(N)])]}
        if cid == 'g17':
            return {'distance%': [(f'seed {seed}', [(C[i] / e[i] - 1) * 100 if ok(e[i]) else NAN for i in range(N)]) for seed in SEEDS for e in [ema(C, 55, seed)]]}
        if cid == 'g18':
            return {'range expansion': [('4% of the prior close and wider than the prior bar', flag(lambda i: None if i == 0 else (R[i] >= 0.04 * C[i - 1] and R[i] > R[i - 1])))]}
    # ── round 5: market state ──
    if cid and cid[0] == 'h':
        SEEDS = ('sma', 'first')
        dist_day = lambda k: k > 0 and C[k] <= C[k - 1] * (1 - 0.002) and V[k] > V[k - 1]   # noqa: E731
        HC60 = [('with this bar', [NAN if i < 59 else max(C[i - 59:i + 1]) for i in range(N)]),
                ('the 60 before', [NAN if i < 60 else max(C[i - 60:i]) for i in range(N)])]

        def streak_of(cond):
            out, n = [], 0
            for i in range(N):
                c = cond(i)
                if c is None:
                    out.append(NAN); n = 0; continue
                n = n + 1 if c else 0
                out.append(float(n))
            return out
        if cid == 'h01':
            v = []
            for seed in SEEDS:
                e = ema(C, 21, seed)
                st = streak_of(lambda i, e=e: None if not ok(e[i]) else C[i] > e[i])
                v.append((f'seed {seed}, counted from the first bar', st))
                v += [(f'seed {seed}, a count that restarts {w} bars back', [min(x, float(w)) if ok(x) else NAN for x in st]) for w in (100, 300, 960)]
            return {'bars in a row above': v}
        if cid == 'h02':
            m = sma(C, 50)
            since, last = [], None
            for i in range(N):
                if ok(m[i]) and C[i] < m[i]:
                    last = i
                since.append(NAN if last is None or not ok(m[i]) else float(i - last))
            return {'bars since below': [('counted from the first bar', since)] + [(f'stops at {w}', [min(x, float(w)) if ok(x) else NAN for x in since]) for w in (100, 300, 500)]}
        if cid == 'h03':
            v = []
            for wname, lo, hi in (('the last 25 with this bar', 24, 0), ('the 25 before', 25, 1)):
                for cname, gone in (('risen to 5% or more', lambda a, b: a >= 1.05 * b), ('risen more than 5%', lambda a, b: a > 1.05 * b)):
                    out = []
                    for i in range(N):
                        if i < lo + 1:
                            out.append(NAN); continue
                        n = 0
                        for k in range(i - lo, i - hi + 1):
                            if dist_day(k) and not any(gone(C[j], C[k]) for j in range(k + 1, i + 1)):
                                n += 1
                        out.append(float(n))
                    v.append((f'{wname}, dropped once the close has {cname}', out))
            return {'live distribution days': v}
        if cid == 'h04':
            return {'first up close in a correction': [
                (f'the prior close 5% under the high of {name}', flag(lambda i, hc=hc, at=at: None if i < 2 or not ok(hc[i - at]) else
                                                                    (C[i] > C[i - 1] and not C[i - 1] > C[i - 2] and C[i - 1] <= 0.95 * hc[i - at])))
                for name, hc, at in (('the 60 to the prior bar', HC60[0][1], 1), ('the 60 to this bar', HC60[0][1], 0), ('the 60 before the prior bar', HC60[1][1], 1))]}
        if cid == 'h05':
            v = []
            for hname, hc in HC60:
                for rname, same_bar in (('a new attempt may start on the bar the old one ends', True), ('not on the bar the old one ends', False)):
                    out, live, start = [], False, None
                    for i in range(N):
                        if not ok(hc[i]) or i == 0:
                            out.append(NAN); continue
                        ended = False
                        if live and L[i] < L[start]:
                            live, ended = False, True
                        if not live and (same_bar or not ended) and C[i] > C[i - 1] and C[i] <= 0.95 * hc[i]:
                            live, start = True, i
                        out.append(1.0 if (live and i - start + 1 >= 4 and C[i] >= 1.0125 * C[i - 1] and V[i] > V[i - 1]) else 0.0)
                    v.append((f'high of {hname}; {rname}', out))
            return {'follow-through': v}
        if cid == 'h07':
            # "the top half of its range" is the close against the bar's midpoint. Compared as 2 * close against
            # high + low, with a hair of tolerance: a close EXACTLY at the midpoint (60.34 between 59.94 and 60.74)
            # is a tie, and dividing first lets rounding put it on either side.
            top = lambda k: H[k] != L[k] and 2 * C[k] - (H[k] + L[k]) > 1e-9        # noqa: E731
            top_eq = lambda k: H[k] != L[k] and 2 * C[k] - (H[k] + L[k]) >= -1e-9   # noqa: E731
            return {'count': both_windows(10, top, lambda k: 1.0, sum, (0.0,)) + [(n + ' (at or above the middle)', c_) for n, c_ in both_windows(10, top_eq, lambda k: 1.0, sum, (0.0,))]}
        if cid == 'h08':
            out, sgn = [], 0
            for i in range(N):
                if i == 0:
                    out.append(NAN); continue
                if C[i] > C[i - 1]:
                    sgn = sgn + 1 if sgn > 0 else 1
                elif C[i] < C[i - 1]:
                    sgn = sgn - 1 if sgn < 0 else -1
                else:
                    sgn = 0
                out.append(float(sgn))
            return {'signed streak': [('counted from the first bar', out)] + [(f'restarts {w} bars back', [max(-float(w), min(float(w), x)) if ok(x) else NAN for x in out]) for w in (100, 300)]}
        if cid == 'h09':
            hc = [NAN if i < 251 else max(C[i - 251:i + 1]) for i in range(N)]
            def since(pick):
                o = []
                for i in range(N):
                    if i < 251:
                        o.append(NAN); continue
                    w = C[i - 251:i + 1]
                    hi = max(w)
                    o.append(float(pick([251 - j for j, x in enumerate(w) if x == hi])))
                return o
            return {'percent below the high': [('as a positive percent', [(1 - C[i] / hc[i]) * 100 if ok(hc[i]) else NAN for i in range(N)]),
                                               ('as a negative percent', [(C[i] / hc[i] - 1) * 100 if ok(hc[i]) else NAN for i in range(N)])],
                    'bars since the high': [('the most recent bar at the high', since(min)), ('the earliest bar at the high', since(max))]}
        if cid == 'h10':
            v = []
            for cname, cond, need in (('at the high of the last 20 with this bar', lambda i: i >= 19 and C[i] >= max(C[i - 19:i + 1]), 19),
                                      ('above the high of the 20 before', lambda i: i >= 20 and C[i] > max(C[i - 20:i]), 20)):
                v.append((f'{cname}; none on the 10 bars before', flag(lambda i, cond=cond, need=need: None if i < need + 10 else (cond(i) and not any(cond(k) for k in range(i - 10, i))))))
            return {'new high after a gap': v}
        if cid == 'h11':
            m, v = sma(C, 50), []
            for seed in SEEDS:
                e = ema(C, 21, seed)
                v.append((f'seed {seed}', [NAN if not both(m[i], e[i]) else (1.0 if (C[i] > m[i] and e[i] > m[i]) else -1.0 if (C[i] < m[i] and e[i] < m[i]) else 0.0) for i in range(N)]))
            return {'regime': v}
    # ── round 7: another timeframe, another symbol ──
    if cid and cid[0] == 'j':
        import datetime as _dt
        keys = []
        for b in BARS:
            d = _dt.date.fromisoformat(day(b))
            keys.append(d - _dt.timedelta(days=d.weekday()))
        order, wk = [], []
        for k in keys:
            if not order or order[-1] != k:
                order.append(k)
            wk.append(len(order) - 1)
        nw = len(order)
        members = [[i for i in range(N) if wk[i] == w] for w in range(nw)]
        w_hi = [max(H[i] for i in m) for m in members]
        w_lo = [min(L[i] for i in m) for m in members]
        w_cl = [C[m[-1]] for m in members]
        last = [i == N - 1 or wk[i + 1] != wk[i] for i in range(N)]

        def readings(done, forming):
            """done(w): the value at COMPLETED week w (NAN if not enough weeks). forming(i): the value with the forming week as it stands at bar i."""
            at = lambda w: done(w) if w >= 0 else NAN   # noqa: E731
            # ⚰️ Two more readings stood here until 2026-11-22 and no recorded answer ever needed them: "the whole
            # of this week from its first bar", which knows Friday's close on Monday, and "TWO completed weeks
            # back". Neither is a reading of any of these requests' words; a rule that lists them passes a
            # formula that looks ahead or is a week stale.
            out = [
                ('the last COMPLETED week, held all week', [at(wk[i] - 1) for i in range(N)]),
                ('the finished week on its last bar, the one before until then (TradingView history)', [at(wk[i] if last[i] else wk[i] - 1) for i in range(N)]),
            ]
            if forming is not None:
                out.append(('the FORMING week as it stands on each bar', [forming(i) for i in range(N)]))
            return out
        run_hi = lambda i: max(H[k] for k in members[wk[i]] if k <= i)   # noqa: E731
        run_lo = lambda i: min(L[k] for k in members[wk[i]] if k <= i)   # noqa: E731
        if cid == 'j01':
            return {"last week's high": readings(lambda w: w_hi[w], None), "last week's low": readings(lambda w: w_lo[w], None)}
        if cid == 'j02':
            done = lambda w: sum(w_cl[w - 9:w + 1]) / 10 if w >= 9 else NAN   # noqa: E731
            forming = lambda i: (sum(w_cl[wk[i] - 9:wk[i]]) + C[i]) / 10 if wk[i] >= 9 else NAN   # noqa: E731
            return {'10 week average of the weekly close': readings(done, forming)}
        if cid == 'j03':
            done = lambda w: max(w_hi[w - 3:w + 1]) if w >= 3 else NAN   # noqa: E731
            forming = lambda i: max(max(w_hi[wk[i] - 3:wk[i]]), run_hi(i)) if wk[i] >= 3 else NAN   # noqa: E731
            return {'highest weekly high of 4 weeks': readings(done, forming)}
        if cid == 'j04':
            return {"SPY's close": [('on the same days', SC)]}
        if cid == 'j05':
            return {'close over SPY close': [('on the same days', [C[i] / SC[i] if ok(SC[i]) and SC[i] else NAN for i in range(N)])]}
    # ── round 8: market state + another symbol ──
    if cid and cid[0] == 'k':
        def above50(sym):
            c = other(sym)
            m = sma(c, 50)
            return [NAN if not ok(m[i]) else (1.0 if c[i] > m[i] else 0.0) for i in range(N)]
        if cid == 'k01':
            return {f'{sym} above its own 50 bar average': [('on the same days', above50(sym))] for sym in ('SPY', 'QQQ', 'IWM')}
        if cid == 'k02':
            c, v = other('SPY'), other('SPY', 'v')
            dist = lambda k: k > 0 and ok(c[k]) and ok(c[k - 1]) and c[k] <= c[k - 1] * (1 - 0.002) and v[k] > v[k - 1]   # noqa: E731
            return {"SPY's distribution days": [('the last 25 with this bar', [NAN if i < 25 else float(sum(1 for k in range(i - 24, i + 1) if dist(k))) for i in range(N)]),
                                                ('the 25 before this bar', [NAN if i < 26 else float(sum(1 for k in range(i - 25, i) if dist(k))) for i in range(N)])]}
        if cid == 'k03':
            ratio = [C[i] / SC[i] if ok(SC[i]) and SC[i] else NAN for i in range(N)]
            return {'close over SPY close': [('on the same days', ratio)],
                    '21 bar exponential average of the ratio': [(seed, ema(ratio, 21, seed)) for seed in ('sma', 'first')]}
        if cid == 'k04':
            a, b = above50('SPY'), above50('QQQ')
            return {'both above their own 50 bar average': [('1 or 0', [NAN if not (ok(a[i]) and ok(b[i])) else (1.0 if a[i] and b[i] else 0.0) for i in range(N)])]}
        if cid == 'k05':
            s = SC
            beat = lambda k: k > 0 and ok(s[k]) and ok(s[k - 1]) and (C[k] / C[k - 1] - 1) > (s[k] / s[k - 1] - 1)   # noqa: E731
            n = [NAN if i < 20 else float(sum(1 for k in range(i - 19, i + 1) if beat(k))) for i in range(N)]
            return {'days of the last 20 the stock out-gained SPY': [('a count, with this bar', n), ('a percent of 20', [x / 20 * 100 if ok(x) else NAN for x in n])]}
        if cid == 'k06':
            pct = [NAN if i < 63 or not ok(SC[i]) or not ok(SC[i - 63]) else (C[i] / C[i - 63] - 1) * 100 - (SC[i] / SC[i - 63] - 1) * 100 for i in range(N)]
            return {"63 bar percent change minus SPY's": [('in percent', pct), ('as a fraction', [x / 100 if ok(x) else NAN for x in pct])]}
    if cid == 'm01':                                        # "Count QQQ's up closes over the last 10 bars"
        q = other('QQQ')
        up = lambda k: k > 0 and ok(q[k]) and ok(q[k - 1]) and q[k] > q[k - 1]   # noqa: E731
        return {"QQQ's up closes in 10 bars": [('with this bar', [NAN if i < 10 else float(sum(1 for k in range(i - 9, i + 1) if up(k))) for i in range(N)]),
                                               ('the 10 before', [NAN if i < 11 else float(sum(1 for k in range(i - 10, i) if up(k))) for i in range(N)])]}
    if cid in ('m04', 'm05', 'm06'):                        # verb-first requests typed in Title Case
        if cid == 'm04':
            g = [NAN] + [max(C[i] - C[i - 1], 0.0) for i in range(1, N)]
            l_ = [NAN] + [max(C[i - 1] - C[i], 0.0) for i in range(1, N)]
            r, ag, al = [NAN] * N, NAN, NAN
            for i in range(14, N):
                if i == 14:
                    ag, al = sum(g[1:15]) / 14, sum(l_[1:15]) / 14
                else:
                    ag, al = (ag * 13 + g[i]) / 14, (al * 13 + l_[i]) / 14
                r[i] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
            return {'RSI 14 crosses above 70': [('above 70 now, at or below before', [NAN if not (ok(r[i]) and i > 0 and ok(r[i - 1])) else (1.0 if r[i] > 70 and r[i - 1] <= 70 else 0.0) for i in range(N)])]}
        if cid == 'm05':
            m = sma(C, 200)
            return {'close above its 200 bar simple average': [('on this bar', [NAN if not ok(m[i]) else (1.0 if C[i] > m[i] else 0.0) for i in range(N)])]}
        if cid == 'm06':
            return {'an inside bar': [('high below the prior high and low above the prior low', [NAN if i == 0 else (1.0 if H[i] < H[i - 1] and L[i] > L[i - 1] else 0.0) for i in range(N)])]}
    if cid in ('p01', 'p02', 'p03', 'p04', 'p05', 'p06'):  # rules in their own module
        from .event_rules import memory_rules
        got = memory_rules(cid, [day(b) for b in BARS], H, L, C, V)
        return {group: [(name, [NAN if v is None else v for v in col]) for name, col in readings] for group, readings in got.items()}
    if cid in ('s01', 's02', 's03', 's04', 's05', 's06'):  # rules in their own module
        from .stat_rules import stat_rules
        got = stat_rules(cid, C, V, [None if not ok(x) else x for x in SC])
        return {group: [(name, [NAN if v is None else v for v in col]) for name, col in readings] for group, readings in got.items()}
    if cid == 'wall-18':                                    # the number of shares I own and my average cost: the member's OWN figures
        # nothing here can be computed from bars: the rule is about the two settings (see `grade._grade_fill_in`)
        return {'__fill_in__': [('the shares the member owns', 150.0), ('the average cost', 48.25)]}
    if cid and cid.startswith('udaily-'):                  # a daily measure below a day: the acceptance rules of the 5 minute chart
        from .udaily_rules import udaily_rules
        return udaily_rules(cid)
    if cid and cid.startswith('intraday-'):                 # a request on a 5 minute chart: the intraday chart's own rules
        from .intraday_rules import intraday_rules
        return intraday_rules(cid)
    if cid and cid.startswith('date-start-'):               # a running value that starts on a date the member wrote out
        def since(start, first, step):
            """No value before the date; `first` on the first bar on or after it; `step` on every bar after."""
            out, v = [], None
            for i in range(N):
                if day(BARS[i]) < start:
                    out.append(NAN)
                    continue
                x = first(i) if v is None else step(v, i)
                if not ok(x):
                    out.append(NAN)
                    continue
                v = float(x)
                out.append(v)
            return out
        if cid == 'date-start-01':                          # a stop 2 ATR(14) under the close from 2 June 2026 that only rises
            v = []
            for kind in ('rma', 'wilder', 'first', 'sma'):
                a = atr(14, kind)
                level = lambda i, a=a: C[i] - 2 * a[i] if ok(a[i]) else NAN  # noqa: E731
                v.append((f'ATR by {kind}', since('2026-06-02', level, lambda was, i, level=level: max(was, level(i)) if ok(level(i)) else NAN)))
            return {'the stop from 2 June 2026 that only rises': v}
        if cid == 'date-start-02':                          # the highest high since 3 March 2026
            return {'the highest high since 3 March 2026': [('from the date', since('2026-03-03', lambda i: H[i], lambda was, i: max(was, H[i])))]}
        if cid == 'date-start-03':                          # the up closes since 1 September 2026
            up = lambda i: 1.0 if i > 0 and C[i] > C[i - 1] else 0.0  # noqa: E731
            return {'the up closes since 1 September 2026': [
                ('the first day counted when it is one', since('2026-09-01', up, lambda was, i: was + up(i))),
                ('counted from the day after', since('2026-09-01', lambda i: 0.0, lambda was, i: was + up(i)))]}
    if cid == 'm07':                                        # CONTROL: "Detect Inside Bars", the term alone -> the firm's formula (a touch counts, on a bar that traded)
        return {'an inside bar, the firm\'s meaning': [('a touch counts, on a bar that traded', [NAN if i == 0 else (1.0 if H[i] > L[i] and V[i] > 0 and H[i] <= H[i - 1] and L[i] >= L[i - 1] else 0.0) for i in range(N)])]}
    return None
