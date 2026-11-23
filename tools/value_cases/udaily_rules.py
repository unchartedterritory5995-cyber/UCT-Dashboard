"""THE ACCEPTANCE CASES OF "A DAILY MEASURE ON A CHART BELOW A DAY", by value on the 5 minute chart.

Ten requests that give a length in DAYS and cannot be built whole on daily bars: four compare each bar of the chart
with the daily measure (a cross, a condition), six read another symbol.
(An eleventh from the same rounds is left out on purpose: "the bars where the close is more than 60 percent of the
14 day ATR above the bar's low" is true on NO 5 minute bar of this chart, so its rule could not tell a right answer
from any formula that is never true. A case that cannot distinguish is not an acceptance case.) Asked on a 5 minute chart
today, the right answer is a question that says so and offers what can be drawn (`wall.offers`). The day a daily
read below a day can be built, each must BUILD, and build RIGHT: these are the calculations it will be held to.
They are written now, before that engine exists and before any answer does, so they cannot learn from either.

`udaily_rules(case_id)` answers ``{what the member asked to see: [(reading, column), ...]}``, one value per 5 minute
bar of `market.INTRADAY`, or None. Plain loops from the words; nothing of the engine is imported.

THE HONEST READINGS. A measure of "the last N days" on a 5 minute chart is read two ways, as in `intraday_rules`:
  * FINISHED: of the N days that had finished before today. It holds all day.
  * AS IT STANDS: with today so far as the newest day (today's close so far is this bar's close; today's high and
    low so far are the session's). It moves inside the day.
"The close", "the bar's low" and every other word about the bar itself are THIS chart's bar. Where the words give a
second length in BARS ("5 bars ago", "its own 100 bar average"), it is bars of this chart.
"""
import math

from .intraday_rules import B, C, D, DAY, DC, DH, DL, HIGH_SO_FAR, LOW_SO_FAR, N, NAN, ok
from .market import INTRADAY_OTHER

SPY = INTRADAY_OTHER['SPY']
SC = [b['c'] for b in SPY['bars']]                       # SPY's close on the same 5 minute stamps
SDC = [d['c'] for d in SPY['daily']]                     # SPY's daily close on the same days
assert [b['t'] for b in SPY['bars']] == [b['t'] for b in B] and [d['t'] for d in SPY['daily']] == [d['t'] for d in D]

FINISHED, STANDS = 'of the days finished before today', "as it stands with today's bars so far"


def flag(cond):
    out = []
    for i in range(N):
        v = cond(i)
        out.append(NAN if v is None else (1.0 if v else 0.0))
    return out


def _daily_sma(x, today, n):
    """The n day simple average of a daily series, both readings, one value per 5 minute bar. `today[i]` is the
    series' value for today so far on bar i."""
    finished = [sum(x[DAY[i] - n:DAY[i]]) / n for i in range(N)]
    stands = [(sum(x[DAY[i] - n + 1:DAY[i]]) + today[i]) / n for i in range(N)]
    return [(FINISHED, finished), (STANDS, stands)]


def _daily_ema(x, today, n):
    """The n day exponential average of a daily series, both readings. Started with the simple average of its first
    n days; 250 days on, how it was started no longer moves it."""
    a = 2 / (n + 1)
    e = [NAN] * len(x)
    e[n - 1] = sum(x[:n]) / n
    for k in range(n, len(x)):
        e[k] = a * x[k] + (1 - a) * e[k - 1]
    finished = [e[DAY[i] - 1] for i in range(N)]
    stands = [a * today[i] + (1 - a) * e[DAY[i] - 1] for i in range(N)]
    return [(FINISHED, finished), (STANDS, stands)]


def _change(x, today, n):
    """The percent change over n days of a daily series, both readings, in percent."""
    finished = [(x[DAY[i] - 1] / x[DAY[i] - 1 - n] - 1) * 100 for i in range(N)]
    stands = [(today[i] / x[DAY[i] - n] - 1) * 100 for i in range(N)]
    return [(FINISHED, finished), (STANDS, stands)]


def _day_changes(x, today, i, n, with_today):
    """The n daily changes (as fractions) a window holds on bar i: the n finished days, or n - 1 and today so far."""
    d = DAY[i]
    if not with_today:
        return [x[k] / x[k - 1] - 1 for k in range(d - n, d)]
    return [x[k] / x[k - 1] - 1 for k in range(d - n + 1, d)] + [today[i] / x[d - 1] - 1]


def _spread(n):
    out = []
    for (name, mine), (_n, theirs) in zip(_change(DC, C, n), _change(SDC, SC, n)):
        pct = [mine[i] - theirs[i] for i in range(N)]
        out += [(f'{name}, in percent', pct), (f'{name}, as a fraction', [v / 100 for v in pct])]
    return out


def _stat(n, kind):
    """The n day correlation, or beta, of this stock's daily percent changes against SPY's, both readings."""
    out = []
    for name, with_today in ((FINISHED, False), (STANDS, True)):
        col = []
        for i in range(N):
            a, b = _day_changes(DC, C, i, n, with_today), _day_changes(SDC, SC, i, n, with_today)
            ma, mb = sum(a) / n, sum(b) / n
            cov = sum((p - ma) * (q - mb) for p, q in zip(a, b))
            va, vb = sum((p - ma) ** 2 for p in a), sum((q - mb) ** 2 for q in b)
            if kind == 'correlation':
                col.append(cov / math.sqrt(va * vb) if va > 0 and vb > 0 else NAN)
            else:
                col.append(cov / vb if vb > 0 else NAN)
        out.append((name, col))
    return out


def _window(x, i, n):
    w = x[i - n + 1:i + 1] if i >= n - 1 else None
    return w if w and all(ok(v) for v in w) else None


def udaily_rules(cid):
    if cid == 'udaily-01':                                  # this stock's 20 day percent change minus SPY's
        return {"the 20 day percent change minus SPY's": _spread(20)}
    if cid == 'udaily-02':                                  # the bars where the close crossed above its 50 day simple average
        v = []
        for name, m in _daily_sma(DC, C, 50):
            for was, cmp_ in (('was at or below', lambda a, b: a <= b), ('was below', lambda a, b: a < b)):
                v.append((f'{name}; the bar before {was}', flag(lambda i, m=m, cmp_=cmp_: None if i == 0 else (C[i] > m[i] and cmp_(C[i - 1], m[i - 1])))))
        return {'the close crossed above its 50 day average': v}
    if cid == 'udaily-03':                                  # the 10 above the 20 above the 50 day average, all three higher than 5 bars ago
        v = []
        for (name, a), (_1, b), (_2, c_) in zip(_daily_sma(DC, C, 10), _daily_sma(DC, C, 20), _daily_sma(DC, C, 50)):
            v.append((f'{name}; higher than 5 bars of this chart ago',
                      flag(lambda i, a=a, b=b, c_=c_: None if i < 5 else (a[i] > b[i] > c_[i] and a[i] > a[i - 5] and b[i] > b[i - 5] and c_[i] > c_[i - 5]))))
        return {'the three averages stacked and rising': v}
    if cid == 'udaily-04':                                  # the 14 day average range as a percent of the close; bars 2 deviations above its own 100 bar average
        rng = [DH[k] - DL[k] for k in range(len(D))]
        xs = []
        for name, avg in _daily_sma(rng, [HIGH_SO_FAR[i] - LOW_SO_FAR[i] for i in range(N)], 14):
            xs.append((f"{name}, over this bar's close", [avg[i] / C[i] * 100 for i in range(N)]))
            xs.append((f"{name}, over yesterday's close", [avg[i] / DC[DAY[i] - 1] * 100 for i in range(N)]))
        v = []
        for name, x in xs:
            for sd_name, ddof in (('population', 0), ('sample', 1)):
                def above(i, x=x, ddof=ddof):
                    w = _window(x, i, 100)
                    if w is None:
                        return None
                    m = sum(w) / 100
                    return x[i] > m + 2 * math.sqrt(sum((p - m) ** 2 for p in w) / (100 - ddof))
                v.append((f'{name}; {sd_name} deviation of 100 bars of this chart', flag(above)))
        return {'the 14 day average range as a percent of the close': xs, 'more than 2 deviations above its own 100 bar average': v}
    if cid == 'udaily-05':                                  # the close above the 10 day EMA and the 10 day above the 21 day EMA
        return {'the close above the 10 day average and the 10 above the 21':
                [(name, flag(lambda i, a=a, b=b: C[i] > a[i] and a[i] > b[i])) for (name, a), (_n, b) in zip(_daily_ema(DC, C, 10), _daily_ema(DC, C, 21))]}
    if cid == 'udaily-06':                                  # the close over SPY's close, with a 21 day EMA of that ratio
        ratio = [C[i] / SC[i] for i in range(N)]
        return {"the close over SPY's close": [('on each bar of this chart', ratio)],
                'the 21 day exponential average of the ratio': _daily_ema([DC[k] / SDC[k] for k in range(len(D))], ratio, 21)}
    if cid == 'udaily-07':                                  # how many of the last 20 days this stock's change for the day beat SPY's
        v = []
        for name, with_today in ((FINISHED, False), (STANDS, True)):
            n = [float(sum(1 for p, q in zip(_day_changes(DC, C, i, 20, with_today), _day_changes(SDC, SC, i, 20, with_today)) if p > q)) for i in range(N)]
            v += [(f'{name}, a count', n), (f'{name}, a percent of 20', [x / 20 * 100 for x in n])]
        return {'days of the last 20 the stock out-gained SPY': v}
    if cid == 'udaily-08':                                  # this stock's 63 day percent change minus SPY's
        return {"the 63 day percent change minus SPY's": _spread(63)}
    if cid == 'udaily-09':                                  # the 50 day correlation of daily percent changes with SPY's
        return {"the 50 day correlation with SPY's daily changes": _stat(50, 'correlation')}
    if cid == 'udaily-10':                                  # the beta to SPY over the last 60 days, from daily percent changes
        return {'the 60 day beta to SPY': _stat(60, 'beta')}
    if cid == 'udaily-12':                                  # the highest high of the last 20 days, not counting today
        # the words leave ONE honest reading: today is not counted, so it is the 20 days finished before today
        return {'the highest high of the 20 days before today': [(FINISHED, [max(DH[DAY[i] - 20:DAY[i]]) for i in range(N)])]}
    return None


#: every id here, in order: the ten acceptance cases (the 5 minute twins of daily-chart cases)
IDS = tuple(f'udaily-{k:02d}' for k in range(1, 11))
#: ⭐⭐ U-DAILY (e96) -- the case that holds the WORDING of a daily read (coordinator ruling 2026-11-22): built right by
#: value, and the reply names the value plainly as the last finished day (its `says`)
WORDING_IDS = ('udaily-12',)
