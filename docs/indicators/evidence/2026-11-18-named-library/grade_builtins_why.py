"""Where the three not-everywhere-equal entries differ from TradingView, and why."""
import io
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..'))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api.services import ast_interpret, call_expansions  # noqa: E402
from api.services import named_indicators as ni  # noqa: E402
import grade_builtins as g  # noqa: E402  (runs the grade once; harmless)

E = g.ENTRIES
out = {}


def unequal(col, bars, rows, plot):
    bad = []
    for i, b in enumerate(bars):
        tv = rows.get(b['t'])
        t = tv[plot] if tv is not None else None
        a = col[i]
        if a is None or t is None:
            continue
        if abs(a - t) > max(1e-9, 1e-9 * abs(t)):
            bad.append((i, a, t))
    return bad


print('\n=== Connors RSI: where it differs')
for sym in ('spy', 'rddt'):
    d, bars, fields, rows, titles, inputs = g.load('connors-rsi', sym)
    bad = unequal(g.ours(E['connors_rsi'], 'crsi', bars), bars, rows, 0)
    idx = [i for i, _a, _t in bad]
    print(sym, 'unequal bars:', len(bad), 'first', idx[:6], 'last', idx[-6:], 'after bar 140:', [i for i in idx if i > 140][:10])
    out[f'connors@{sym}'] = {'unequal': len(bad), 'last_unequal_bar': max(idx) if idx else None}

print('\n=== McGinley: is TradingView the same formula CARRIED from the first bar?')
for sym in ('spy', 'rddt'):
    d, bars, fields, rows, titles, inputs = g.load('mcginley-dynamic', sym)
    c = [b['c'] for b in bars]
    first_tv = next(i for i, b in enumerate(bars) if rows.get(b['t']) is not None and rows[b['t']][0] is not None)
    print(sym, 'TradingView first value at bar', first_tv, '=', rows[bars[first_tv]['t']][0], '; close there', c[first_tv],
          '; mean of first 14 closes', sum(c[:14]) / 14)
    # carry the recursion from TradingView's own first value
    md = rows[bars[first_tv]['t']][0]
    n = same = 0
    worst = 0.0
    for i in range(first_tv + 1, len(bars)):
        md = md + (c[i] - md) / (14 * (c[i] / md) ** 4)
        t = rows[bars[i]['t']][0]
        n += 1
        rel = abs(md - t) / abs(t)
        same += rel <= 1e-9
        worst = max(worst, rel)
    print(sym, 'carried from its first value: compared', n, 'equal', same, 'worst', f'{worst:.2e}')
    ours_col = g.ours(E['mcginley_dynamic'], 'mcginley', bars)
    bad = unequal(ours_col, bars, rows, 0)
    worst_w = max((abs(a - t) / abs(t) for _i, a, t in bad), default=0.0)
    print(sym, 'our 300-bar restart: unequal', len(bad), 'worst', f'{worst_w:.2e}', 'last unequal bar', max((i for i, _a, _t in bad), default=None), 'of', len(bars) - 1)
    out[f'mcginley@{sym}'] = {'carried_equal': same, 'carried_compared': n, 'carried_worst': worst, 'restart_unequal': len(bad), 'restart_worst': worst_w}

print('\n=== Chandelier: the unequal bars are the early ones (the ATR seed)')
for sym in ('spy', 'rddt'):
    d, bars, fields, rows, titles, inputs = g.load('chandelier-exit', sym)
    for plot, key in ((0, 'long'), (1, 'short')):
        bad = unequal(g.ours(E['chandelier_exit'], key, bars), bars, rows, plot)
        idx = [i for i, _a, _t in bad]
        print(sym, key, 'unequal', len(bad), 'last unequal bar', max(idx) if idx else None, 'of', len(bars) - 1,
              '; contiguous from the start:', idx == list(range(idx[0], idx[0] + len(idx))) if idx else None)
        out[f'chandelier.{key}@{sym}'] = {'unequal': len(bad), 'last_unequal_bar': max(idx) if idx else None}
json.dump(out, io.open(g.OUT + '/grade_builtins_why.json', 'w', encoding='utf-8'), indent=1)
