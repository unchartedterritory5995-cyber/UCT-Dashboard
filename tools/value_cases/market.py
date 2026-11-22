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


# ── the same idea on a 5 minute chart ──
#: A second built chart: 5 minute bars of regular sessions (09:30 to 16:00 New York, 78 bars a day), with the DAILY
#: bars of the same symbol beside it. A request for "today's low so far", "yesterday's close" or "the 14 day ATR on
#: my 5 minute chart" can only be held by value on a chart that has days in it.
#:   * every intraday bar's `t` is unix SECONDS (the platform's intraday spelling); a daily bar's is its ISO day;
#:   * the daily bars are longer than the intraday window (a 20 day average needs days before the first 5 minute
#:     bar), and over the window each daily bar IS its session: the first open, the highest high, the lowest low,
#:     the last close, the summed volume. A test holds that, so a rule may read either side.
INTRADAY_TF = '5'
INTRADAY_SESSIONS = 40
INTRADAY_BARS_A_DAY = 78
INTRADAY_DAILY_COUNT = 300


def _session_stamps(day):
    from zoneinfo import ZoneInfo
    opened = _dt.datetime(day.year, day.month, day.day, 9, 30, tzinfo=ZoneInfo('America/New_York'))
    return [int((opened + _dt.timedelta(minutes=5 * k)).timestamp()) for k in range(INTRADAY_BARS_A_DAY)]


def _intraday_walk(days, seed, start, swing, volume):
    """5 minute bars for each day, to the cent (so they tie), each session opening near the close before."""
    state = {'s': seed}

    def rnd():
        state['s'] = (state['s'] * 1664525 + 1013904223) % 4294967296
        return state['s'] / 4294967296
    bars, px = [], float(start)
    for d in days:
        px = round(px * (1 + (rnd() - 0.5) * 0.02), 2)                                   # the overnight gap
        tilt = (rnd() - 0.5) * 0.0016                                                    # a day that trends, up or down
        for k, t in enumerate(_session_stamps(d)):
            o = px
            quiet = rnd()
            c = o if quiet < 0.08 else round(o * (1 + (rnd() - 0.5 + 0) * swing + tilt), 2)
            h = round(max(o, c) * (1 + rnd() * 0.0012), 2)
            l = round(min(o, c) * (1 - rnd() * 0.0012), 2)                               # noqa: E741
            edge = 2.4 if k < 6 or k >= INTRADAY_BARS_A_DAY - 6 else 1.0                 # the open and the close are busy
            v = float(int(volume * (0.5 + rnd()) * edge / 100) * 100)
            bars.append({'t': t, 'o': o, 'h': max(h, o, c), 'l': min(l, o, c), 'c': c, 'v': v})
            px = c
    return bars


def _sessions_as_days(bars, days):
    """One daily bar per session: its first open, highest high, lowest low, last close and summed volume."""
    out = []
    for i, d in enumerate(days):
        s = bars[i * INTRADAY_BARS_A_DAY:(i + 1) * INTRADAY_BARS_A_DAY]
        out.append({'t': d.isoformat(), 'o': s[0]['o'], 'h': max(b['h'] for b in s), 'l': min(b['l'] for b in s), 'c': s[-1]['c'],
                    'v': float(sum(b['v'] for b in s))})
    return out


def _intraday_chart(seed, start, swing, volume, daily_seed, daily_swing, daily_volume):
    days = _days(INTRADAY_DAILY_COUNT, LAST_DAY)
    window = days[-INTRADAY_SESSIONS:]
    # the days BEFORE the window are a daily walk that ends where the first session will open near
    before = _walk(days[:-INTRADAY_SESSIONS], daily_seed, start, 0.004, daily_swing, 40, daily_volume)
    bars = _intraday_walk(window, seed, before[-1]['c'], swing, volume)
    return {'tf': INTRADAY_TF, 'bars': bars, 'daily': before + _sessions_as_days(bars, window), 'days': [d.isoformat() for d in window]}


#: the chart's own symbol on 5 minute bars, with its daily bars
INTRADAY = _intraday_chart(20261122, 58.0, 0.0042, 4.2e5, 20261123, 0.03, 3.0e7)
#: other symbols on the same 5 minute stamps (and their daily bars)
INTRADAY_OTHER = {
    'SPY': _intraday_chart(111, 590.0, 0.0018, 9.0e5, 112, 0.012, 7.0e7),
    'QQQ': _intraday_chart(211, 505.0, 0.0022, 6.0e5, 212, 0.015, 4.5e7),
    'IWM': _intraday_chart(311, 232.0, 0.0024, 4.0e5, 312, 0.016, 2.8e7),
}
