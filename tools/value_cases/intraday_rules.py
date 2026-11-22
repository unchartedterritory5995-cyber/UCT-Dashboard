"""The independent calculations of the value cases asked on a 5 MINUTE chart (`market.INTRADAY`).

`intraday_rules(case_id)` answers ``{what the member asked to see: [(reading, column), ...]}``, one value per 5
minute bar, or None for an id with no rule. As in `rules.py`: written from the REQUEST'S WORDS, never from an
answer; plain loops; nothing of the engine is imported.

What "a day" means on this chart, and the honest readings each rule lists:
  * "today's low so far" is the lowest low of today's bars up to and including this one;
  * "yesterday's close" is the last close of the session before today's;
  * a daily measure of "the last N days" (an ATR, an average range) is read two honest ways: of the N days that had
    FINISHED before today (it holds all day), or as it STANDS with today's bars so far as the newest day. A member
    who says "the 14 day ATR" on a 5 minute chart has not said which, so both are listed. Nothing else is: not a
    measure of 5 minute bars, and not a day that has not happened yet.
"""
import math

from .market import INTRADAY, INTRADAY_BARS_A_DAY, INTRADAY_SESSIONS

NAN = float('nan')
ok = lambda v: v is not None and not (isinstance(v, float) and math.isnan(v))  # noqa: E731
B = INTRADAY['bars']
D = INTRADAY['daily']
N = len(B)
#: the index in D of the first day that has 5 minute bars
FIRST = len(D) - INTRADAY_SESSIONS
#: each 5 minute bar's day, as an index in D
DAY = [FIRST + i // INTRADAY_BARS_A_DAY for i in range(N)]
O = [b['o'] for b in B]; H = [b['h'] for b in B]; L = [b['l'] for b in B]; C = [b['c'] for b in B]; V = [b['v'] for b in B]  # noqa: E702
DH = [d['h'] for d in D]; DL = [d['l'] for d in D]; DC = [d['c'] for d in D]  # noqa: E702


def _so_far(x, fn):
    """A value of today's bars up to and including each bar (the day's first bar starts it again)."""
    out, cur = [], None
    for i in range(N):
        cur = x[i] if i % INTRADAY_BARS_A_DAY == 0 else fn(cur, x[i])
        out.append(cur)
    return out


LOW_SO_FAR = _so_far(L, min)
HIGH_SO_FAR = _so_far(H, max)


def _true_range(h, l, prev_close):  # noqa: E741
    return max(h - l, abs(h - prev_close), abs(l - prev_close))


#: each finished day's true range (day 0 has no close before it: its range)
DTR = [DH[k] - DL[k] if k == 0 else _true_range(DH[k], DL[k], DC[k - 1]) for k in range(len(D))]


def _daily_atr(n, kind):
    """The n day ATR at the end of each finished day."""
    out = [NAN] * len(D)
    if kind == 'sma':
        for k in range(n - 1, len(D)):
            out[k] = sum(DTR[k - n + 1:k + 1]) / n
    elif kind == 'rma':                                     # Wilder's smoothing, started with the mean of the first n
        out[n - 1] = sum(DTR[:n]) / n
        for k in range(n, len(D)):
            out[k] = (out[k - 1] * (n - 1) + DTR[k]) / n
    elif kind == 'wilder':                                  # the first true range is day 1's
        out[n] = sum(DTR[1:n + 1]) / n
        for k in range(n + 1, len(D)):
            out[k] = (out[k - 1] * (n - 1) + DTR[k]) / n
    return out


def day_atr_readings(n):
    """[(reading, one value per 5 minute bar)]: the n day ATR, of the days finished before today and as it stands."""
    out = []
    for kind in ('rma', 'wilder', 'sma'):
        atr = _daily_atr(n, kind)
        out.append((f'the {n} days finished before today, ATR by {kind}', [atr[DAY[i] - 1] for i in range(N)]))
        stands = []
        for i in range(N):
            k = DAY[i]
            today = _true_range(HIGH_SO_FAR[i], LOW_SO_FAR[i], DC[k - 1])
            if kind == 'sma':
                stands.append((sum(DTR[k - n + 1:k]) + today) / n)
            else:
                stands.append((atr[k - 1] * (n - 1) + today) / n if ok(atr[k - 1]) else NAN)
        out.append((f"as it stands with today's bars so far, ATR by {kind}", stands))
    return out


def day_range_readings(n):
    """[(reading, one value per 5 minute bar)]: the average of a day's high minus its low over n days."""
    rng = [DH[k] - DL[k] for k in range(len(D))]
    finished = [sum(rng[DAY[i] - n:DAY[i]]) / n for i in range(N)]
    stands = [(sum(rng[DAY[i] - n + 1:DAY[i]]) + (HIGH_SO_FAR[i] - LOW_SO_FAR[i])) / n for i in range(N)]
    return [(f'the {n} days finished before today', finished), ("as it stands with today's range so far as the newest day", stands)]


YESTERDAYS_CLOSE = [DC[DAY[i] - 1] for i in range(N)]


def intraday_rules(cid):
    if cid == 'intraday-01':                                # today's low so far plus the 14 day ATR; today's high so far minus it
        atr = day_atr_readings(14)
        return {"today's low so far plus the 14 day ATR": [(name, [LOW_SO_FAR[i] + a[i] if ok(a[i]) else NAN for i in range(N)]) for name, a in atr],
                "today's high so far minus the 14 day ATR": [(name, [HIGH_SO_FAR[i] - a[i] if ok(a[i]) else NAN for i in range(N)]) for name, a in atr]}
    if cid == 'intraday-02':                                # a line at today's low so far plus 60 percent of the 14 day ATR; a dot on each close above it
        atr = day_atr_readings(14)
        line = [(name, [LOW_SO_FAR[i] + 0.6 * a[i] if ok(a[i]) else NAN for i in range(N)]) for name, a in atr]
        return {"today's low so far plus 60 percent of the 14 day ATR": line,
                'a dot on each bar that closes above that line': [(name, [(1.0 if C[i] > col[i] else 0.0) if ok(col[i]) else NAN for i in range(N)]) for name, col in line]}
    if cid == 'intraday-03':                                # yesterday's close plus, and minus, the average daily range of the last 20 days
        rng = day_range_readings(20)
        return {"yesterday's close plus the average daily range of the last 20 days": [(name, [YESTERDAYS_CLOSE[i] + r[i] for i in range(N)]) for name, r in rng],
                "yesterday's close minus that range": [(name, [YESTERDAYS_CLOSE[i] - r[i] for i in range(N)]) for name, r in rng]}
    return None
