"""Value-case rules for requests that need MEMORY OF AN EVENT (bars since, the value at the last event, a
streak, a running value that restarts with the calendar). One plain calculation per reading, written from the
request's words, held apart from the engine.

  memory_rules(cid, T, H, L, C, V) -> {group: [(reading, series), ...]} or None

`T` is each bar's date as 'YYYY-MM-DD'. A series holds None where the rule has no value (those bars are not
compared). Every GROUP must be matched by one of its readings.
"""


def _sma(x, n):
    out = [None] * len(x)
    for i in range(n - 1, len(x)):
        out[i] = sum(x[i - n + 1:i + 1]) / n
    return out


def memory_rules(cid, T, H, L, C, V):
    N = len(C)
    if cid == 'p01':        # "the number of bars since the close last crossed above its 50 day simple moving average"
        m = _sma(C, 50)
        out, since = [], None
        for i in range(N):
            crossed = i > 0 and m[i] is not None and m[i - 1] is not None and C[i] > m[i] and C[i - 1] <= m[i - 1]
            since = 0 if crossed else (None if since is None else since + 1)
            out.append(None if since is None else float(since))
        return {'bars since the close crossed above its 50 bar average': [('0 on the bar of the cross', out)]}
    if cid == 'p02':        # "the close of the most recent bar on which volume was more than twice its 50 day average volume"
        with_bar = _sma(V, 50)
        before = [None if i < 50 else sum(V[i - 50:i]) / 50 for i in range(N)]
        readings = []
        for name, avg in (('the average counts this bar', with_bar), ('the average of the 50 bars before', before)):
            out, held = [], None
            for i in range(N):
                if avg[i] is not None and V[i] > 2 * avg[i]:
                    held = C[i]
                out.append(held)
            readings.append((name, out))
        return {'the close of the last bar with volume over twice its 50 bar average': readings}
    if cid == 'p03':        # "up closes in a row as a positive number, down closes in a row as a negative number"
        out, s = [None], 0
        for i in range(1, N):
            if C[i] > C[i - 1]:
                s = s + 1 if s > 0 else 1
            elif C[i] < C[i - 1]:
                s = s - 1 if s < 0 else -1
            else:
                s = 0
            out.append(float(s))
        return {'the streak of closes': [('an unchanged close is 0', out)]}
    if cid == 'p04':        # "the highest high so far this calendar year, and the percent the close is below it"
        hh, top = [], None
        for i in range(N):
            top = H[i] if (i == 0 or T[i][:4] != T[i - 1][:4]) else max(top, H[i])
            hh.append(top)
        return {'the highest high so far this year': [('restarts on the first bar of each year', hh)],
                'the percent the close is below it': [('a positive percent below', [(hh[i] - C[i]) / hh[i] * 100 for i in range(N)]),
                                                      ('a negative percent', [(C[i] / hh[i] - 1) * 100 for i in range(N)]),
                                                      ('a positive fraction', [(hh[i] - C[i]) / hh[i] for i in range(N)]),
                                                      ('a negative fraction', [C[i] / hh[i] - 1 for i in range(N)])]}
    if cid == 'p05':        # "the volume weighted average price since the start of each calendar month, using the typical price"
        out, pv, vv = [], 0.0, 0.0
        for i in range(N):
            if i == 0 or T[i][:7] != T[i - 1][:7]:
                pv, vv = 0.0, 0.0
            pv += (H[i] + L[i] + C[i]) / 3 * V[i]
            vv += V[i]
            out.append(pv / vv if vv else None)
        return {'the volume weighted average price since the month began': [('typical price, restarting on the first bar of each month', out)]}
    if cid == 'p06':        # "the year to date percent change: the close against the last close of the prior calendar year"
        out, base = [], None
        for i in range(N):
            if i > 0 and T[i][:4] != T[i - 1][:4]:
                base = C[i - 1]
            out.append(None if base is None else (C[i] / base - 1) * 100)
        return {'the year to date percent change': [('a percent', out), ('a fraction', [None if v is None else v / 100 for v in out])]}
    return None


def unchanged_closes(C):
    """How many bars close exactly where the bar before did (the bars on which a streak rule could be read two ways)."""
    return sum(1 for i in range(1, len(C)) if C[i] == C[i - 1])
