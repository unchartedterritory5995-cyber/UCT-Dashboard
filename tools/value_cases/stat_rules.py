"""Value-case rules for STATISTICS of a window (z-score, percent rank, correlation, beta, drawdown, a share
of days). One plain calculation per honest reading.

  stat_rules(cid, C, V, S) -> {group: [(reading, series), ...]} or None

C, V: the stock's closes and volumes; S: SPY's closes on the same bars (None where SPY has no bar). A series holds
None where the rule has no value. Every GROUP must be matched by one of its readings.
"""
import math


def _ok(v):
    return v is not None and not (isinstance(v, float) and math.isnan(v))


def _window(x, i, n):
    w = x[i - n + 1:i + 1]
    return w if i >= n - 1 and all(_ok(v) for v in w) else None


def _mean(w):
    return sum(w) / len(w)


def _sd(w, sample):
    m = _mean(w)
    return math.sqrt(sum((v - m) ** 2 for v in w) / (len(w) - (1 if sample else 0)))


def _ret(x, pct=True):
    return [None] + [((x[i] / x[i - 1] - 1) * (100 if pct else 1)) if _ok(x[i]) and _ok(x[i - 1]) and x[i - 1] else None for i in range(1, len(x))]


def stat_rules(cid, C, V, S):
    N = len(C)
    if cid == 's01':        # "the z-score of the close: how many standard deviations the close is from its 50 day average"
        out = []
        for name, sample in (('population standard deviation', False), ('sample standard deviation', True)):
            col = []
            for i in range(N):
                w = _window(C, i, 50)
                sd = _sd(w, sample) if w else None
                col.append((C[i] - _mean(w)) / sd if w and sd else None)
            out.append((name, col))
        return {'the z-score of the close over 50 bars': out}
    if cid == 's02':        # "the percent rank of today's volume among the last 100 days"
        readings = []
        for name, lo, hi, strict, denom in (
                ('of the 100 bars before, the percent at or below today', 100, 0, False, 100),
                ('of the 100 bars before, the percent below today', 100, 0, True, 100),
                ('of the last 100 with today, the percent below today', 99, 0, True, 100),
                ('of the last 100 with today, the percent below today, of the other 99', 99, 0, True, 99),
                ('of the last 100 with today, the percent at or below today (today counts)', 99, -1, False, 100)):
            col = []
            for i in range(N):
                if i < lo:
                    col.append(None); continue
                prev = V[i - lo:i - hi] if hi != -1 else V[i - lo:i + 1]
                k = sum(1 for v in prev if (v < V[i] if strict else v <= V[i]))
                col.append(k / denom * 100)
            readings.append((name, col))
        readings += [(name + ', as a fraction', [None if v is None else v / 100 for v in col]) for name, col in list(readings)]
        return {"the percent rank of today's volume in 100 bars": readings}
    if cid in ('s03', 's04'):
        a, b = _ret(C), _ret(S)
        n = 50 if cid == 's03' else 60
        corr, beta = [], []
        for i in range(N):
            wa, wb = _window(a, i, n), _window(b, i, n)
            if not wa or not wb:
                corr.append(None); beta.append(None); continue
            ma, mb = _mean(wa), _mean(wb)
            cov = sum((x - ma) * (y - mb) for x, y in zip(wa, wb))
            va, vb = sum((x - ma) ** 2 for x in wa), sum((y - mb) ** 2 for y in wb)
            corr.append(cov / math.sqrt(va * vb) if va and vb else None)
            beta.append(cov / vb if vb else None)
        if cid == 's03':    # "the 50 day correlation between this stock's daily percent change and SPY's"
            return {'the 50 bar correlation of the daily percent changes': [('Pearson', corr)]}
        return {'beta to SPY over 60 bars, from daily percent changes': [('covariance over SPY variance', beta)]}
    if cid == 's05':        # "the drawdown: the percent the close is below the highest close of the last 252 days"
        hc = [None if i < 251 else max(C[i - 251:i + 1]) for i in range(N)]
        neg = [None if h is None else (C[i] / h - 1) * 100 for i, h in enumerate(hc)]
        return {'the drawdown from the highest close of 252 bars': [('a negative percent', neg), ('a positive percent', [None if v is None else -v for v in neg]),
                                                                    ('a negative fraction', [None if v is None else v / 100 for v in neg]),
                                                                    ('a positive fraction', [None if v is None else -v / 100 for v in neg])]}
    if cid == 's06':        # "the percent of the last 50 days on which the close was above its own 20 day simple moving average"
        m = [None if i < 19 else sum(C[i - 19:i + 1]) / 20 for i in range(N)]
        above = [None if m[i] is None else (1 if C[i] > m[i] else 0) for i in range(N)]
        with_bar = [None if (w := _window(above, i, 50)) is None else sum(w) / 50 * 100 for i in range(N)]
        before = [None] + with_bar[:-1]
        return {'the percent of 50 bars closed above their own 20 bar average': [('the last 50 with this bar', with_bar), ('the 50 before this bar', before),
                                                                               ('the last 50 with this bar, as a fraction', [None if v is None else v / 100 for v in with_bar]),
                                                                               ('the last 50 with this bar, as a count', [None if v is None else v / 2 for v in with_bar])]}
    return None
