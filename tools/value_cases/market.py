"""The built market every value case is checked on: a stock and three other symbols, daily, no vendor data.

A fixed walk (the same numbers on every machine and every run). Prices are kept to the cent and volumes to the
hundred on purpose: real bars TIE (a close equal to the close before, two equal highs), and a rule that reads
"above" where the member said "at or above" is only caught on a market that has ties.

The market ends on a fixed day, because recorded answers hold dates (a "this year" the door resolved on the day
it was asked). It is longer than the longest warmup a running value may take (960 bars).
"""
import datetime as _dt

LAST_DAY = _dt.date(2026, 11, 20)
BAR_COUNT = 1700


def _days(n, last):
    out, d = [], last
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= _dt.timedelta(days=1)
    out.reverse()
    return out


def _walk(days, seed, start, drift, swing, gap_every, volume):
    state = {'s': seed}

    def rnd():
        state['s'] = (state['s'] * 1664525 + 1013904223) % 4294967296
        return state['s'] / 4294967296
    bars, px = [], float(start)
    for d in days:
        gap = (0.035 if rnd() < 0.5 else -0.035) if rnd() < 1.0 / gap_every else 0.0     # about one bar in `gap_every` opens away
        o = round(px * (1 + gap + (rnd() - 0.5) * 0.008), 2)
        move = (rnd() - 0.5 + drift) * swing
        # about one bar in thirty does not move at all (an unchanged close), and one in nine is a narrow day
        quiet = rnd()
        c = o if quiet < 0.035 else round(o * (1 + (move * 0.25 if quiet < 0.15 else move)), 2)
        if bars and rnd() < 0.04:
            c = bars[-1]['c']                                                            # a close equal to the close before
        h = round(max(o, c) * (1 + rnd() * 0.009), 2)
        l = round(min(o, c) * (1 - rnd() * 0.009), 2)                                    # noqa: E741
        if bars and rnd() < 0.05 and bars[-1]['h'] >= max(o, c):
            h = bars[-1]['h']                                                            # exactly the high of the bar before
        if bars and rnd() < 0.05 and bars[-1]['l'] <= min(o, c):
            l = bars[-1]['l']                                                            # exactly the low of the bar before  # noqa: E741
        surge = 2.6 if rnd() < 0.06 else 1.0                                             # a volume day now and then
        v = float(int(volume * (0.45 + rnd() * 1.1) * surge / 100) * 100)
        if rnd() < 0.03 and bars:
            v = bars[-1]['v']                                                            # the same volume as the bar before
        bars.append({'t': d.isoformat(), 'o': o, 'h': max(h, o, c), 'l': min(l, o, c), 'c': c, 'v': v})
        px = c
    return bars


_DAYS = _days(BAR_COUNT, LAST_DAY)
#: the chart's own symbol
STOCK = _walk(_DAYS, 20261121, 42.0, 0.012, 0.046, 31, 3.1e7)
#: other symbols a request may read, on the same days
OTHER = {
    'SPY': _walk(_DAYS, 101, 395.0, 0.010, 0.019, 90, 7.4e7),
    'QQQ': _walk(_DAYS, 202, 318.0, 0.011, 0.024, 80, 4.6e7),
    'IWM': _walk(_DAYS, 303, 188.0, 0.006, 0.026, 70, 2.9e7),
}
