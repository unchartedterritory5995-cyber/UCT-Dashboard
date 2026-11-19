"""Grade the running-value witness: our engine's WINDOWED running value (recomputed from W bars
back on every bar) against TradingView's value CARRIED from the listing, for W = 100, 300, 960.
The capture is vendor data: it stays on this machine. Only the grade leaves."""
import io
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..'))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api.services import ast_interpret  # noqa: E402

P = os.path.expandvars(r'%LOCALAPPDATA%\uct-vendor-batch\runs\rvw-2026-11-18\captures\running-value-witness-spy-1d-2026-11-17.json')
d = json.load(io.open(P, encoding='utf-8'))
keys = [k for k in d if k not in ('study', 'symbol', 'page', 'tool', 'census', 'source', 'history', 'window', 'newestBar')]
print('top keys:', keys)
bars_raw = d['bars']['rows']
rows_raw = d['plotValues']['rows']
assert d['bars']['fields'][:6] == ['time', 'open', 'high', 'low', 'close', 'volume'], d['bars']['fields']
assert d['plotValues']['fields'] == ['time', 'plot_0', 'plot_1', 'plot_2'], d['plotValues']['fields']


def bar(b):
    if isinstance(b, dict):
        g = lambda *n: next(b[k] for k in n if k in b)  # noqa: E731
        return {'t': g('time', 't'), 'o': g('open', 'o'), 'h': g('high', 'h'), 'l': g('low', 'l'), 'c': g('close', 'c'), 'v': g('volume', 'v')}
    return dict(zip('tohlcv', b))


bars = [bar(b) for b in bars_raw]
tv = {}
for r in rows_raw:
    if isinstance(r, dict):
        t = r.get('time', r.get('t'))
        vals = r.get('values') or [r.get('plot_0'), r.get('plot_1'), r.get('plot_2')]
    else:
        t, vals = r[0], r[1:4]
    tv[t] = vals
assert all(b['t'] in tv for b in bars), 'a bar without a plot row'

S = lambda n: {'type': 'series', 'name': n}  # noqa: E731
N = lambda v: {'type': 'num', 'value': v}  # noqa: E731
op = lambda n, *a: {'type': 'op', 'name': n, 'args': list(a)}  # noqa: E731
call = lambda n, *a: {'type': 'call', 'name': n, 'args': list(a)}  # noqa: E731
back = lambda x, n: {'type': 'offset', 'value': n, 'args': [x]}  # noqa: E731
SELF = S('self')


def trees(w):
    return {
        'McGinley 14 (decaying)': (0, call('accum', S('close'), op('+', SELF, op('/', op('-', S('close'), SELF),
                                   op('*', N(8.4), call('pow', op('/', S('close'), SELF), N(4))))), N(w))),
        'Up streak (path-dependent)': (1, call('accum', N(0), op('?:', op('>', S('close'), back(S('close'), 1)), op('+', SELF, N(1)), N(0)), N(w))),
        'Ratchet (path-dependent)': (2, call('accum', op('*', S('close'), N(0.9)), call('max', SELF, op('*', S('close'), N(0.9))), N(w))),
    }


out = {'bars': len(bars), 'first': bars[0]['t'], 'last': bars[-1]['t'], 'windows': {}}
for w in (100, 300, 900):
    res = {}
    for name, (col, tree) in trees(w).items():
        ours = ast_interpret.interpret(tree, bars)
        n = same = 0
        worst = 0.0
        worst_at = None
        known_from = next((i for i, v in enumerate(ours) if v is not None), None)
        for i, b in enumerate(bars):
            a, t = ours[i], tv[b['t']][col]
            if a is None or t is None:
                continue
            n += 1
            rel = abs(a - t) / max(abs(t), 1e-12) if t else abs(a - t)
            if rel <= 1e-9:
                same += 1
            if rel > worst:
                worst, worst_at = rel, i
        res[name] = {'compared': n, 'equal_1e-9': same, 'share_equal': round(same / n, 6) if n else None,
                     'worst_rel': worst, 'worst_bar': worst_at, 'first_known_bar': known_from}
        print(f'W={w:4d} {name:28s} compared {n:5d}  equal {same:5d} ({same / n:7.2%})  worst rel {worst:.3e} at bar {worst_at}  first shown at bar {known_from}')
    out['windows'][w] = res
# the streak's own facts on this series: how long do streaks get?
longest = max(tv[b['t']][1] for b in bars)
out['longest_streak_tv'] = longest
print('longest up streak TradingView counted:', longest)
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.expandvars('%TEMP%'), 'named-library-grade')
os.makedirs(OUT, exist_ok=True)
json.dump(out, io.open(os.path.join(OUT, 'grade_running_witness.json'), 'w', encoding='utf-8'), indent=1)
