"""Grade a TradingView capture of WITNESS_SOURCE against the engine's native session readers.

    python docs/pine/evidence/2026-11-17-session-vocabulary/grade_capture.py <capture.json>

Prints counts only (equal, unknown on both sides, unknown on one side, differ, the worst
difference); `first_bad` rows print vendor values, so do not paste them into the repo.

Every bar, four columns: session high, session low, session open, 30-minute opening range high.
A bar with no plot row on TradingView is NaN in every column there; it must be unknown here too.
"""
import io
import json
import os
import sys
from collections import Counter
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..')))
from api.services import indicator_compute as ic  # noqa: E402

p = sys.argv[1]   # the capture's local path; the capture is vendor data and is never committed
d = json.load(io.open(p, encoding='utf-8'))
print('symbol', d['symbol']['pro_name'], 'session', d['symbol']['session'], 'tz', d['symbol']['timezone'], 'tf', d['timeframe'])
print('history', d['history'])
bf, unit = d['bars']['fields'], d['bars']['timeUnit']
print('bar fields', bf, unit, d['bars']['count'])
rows = d['bars']['rows']
ix = {f: i for i, f in enumerate(bf)}
assert unit in ('unix-s', 'unix-ms'), unit
mult = 1 if unit == 'unix-s' else 0.001
# the engine's own bar shape: t (unix seconds), o, h, l, c, v
bars = [{'t': int(r[ix['time']] * mult), 'time': int(r[ix['time']] * mult), 'o': r[ix['open']], 'h': r[ix['high']],
         'l': r[ix['low']], 'c': r[ix['close']], 'v': r[ix['volume']]} for r in rows]
pf = d['plotValues']['fields']
print('plot fields', pf, len(d['plotValues']['rows']))
pix = {f: i for i, f in enumerate(pf)}
tv = {}
for r in d['plotValues']['rows']:
    t = int(r[pix['time']] * mult)
    tv[t] = r
titles = [pl.get('title') or pl.get('id') for pl in d['study']['plots']]
print('plots', titles)
cols = [f for f in pf if f != 'time']
ours = {
    cols[0]: ic.compute_session_regular_raw(bars, '5', 'high'),
    cols[1]: ic.compute_session_regular_raw(bars, '5', 'low'),
    cols[2]: ic.compute_session_regular_raw(bars, '5', 'open'),
    cols[3]: ic.compute_session_regular_raw(bars, '5', 'high', 30),
}
NY = ZoneInfo('America/New_York')
forming = bars[-1]['time'] if d.get('newestBarIsForming') else None
tally = {c: Counter() for c in cols}
worst = {c: (0.0, None) for c in cols}
first_bad = {c: [] for c in cols}
for i, b in enumerate(bars):
    t = b['time']
    row = tv.get(t)
    for c in cols:
        theirs = None if row is None else row[pix[c]]
        mine = ours[c][i]
        mine = None if (mine is None or mine != mine) else mine
        if theirs is None and mine is None:
            tally[c]['both unknown'] += 1
        elif theirs is None or mine is None:
            tally[c]['one unknown'] += 1
            if len(first_bad[c]) < 4:
                first_bad[c].append((datetime.fromtimestamp(t, timezone.utc).astimezone(NY).strftime('%Y-%m-%d %H:%M'), theirs, mine))
        else:
            diff = abs(theirs - mine)
            if diff <= 1e-6:
                tally[c]['equal'] += 1
            else:
                tally[c]['differ' + (' (forming bar)' if t == forming else '')] += 1
                if diff > worst[c][0]:
                    worst[c] = (diff, t)
                if len(first_bad[c]) < 4:
                    first_bad[c].append((datetime.fromtimestamp(t, timezone.utc).astimezone(NY).strftime('%Y-%m-%d %H:%M'), theirs, mine))
days = sorted({datetime.fromtimestamp(b['time'], timezone.utc).astimezone(NY).date() for b in bars})
print('bars', len(bars), 'sessions', len(days), days[0], '->', days[-1])
for c, title in zip(cols, titles):
    print(f'{title:26s} {dict(tally[c])}  worst {worst[c][0]:.6f}')
    for fb in first_bad[c]:
        print('      ', fb)
