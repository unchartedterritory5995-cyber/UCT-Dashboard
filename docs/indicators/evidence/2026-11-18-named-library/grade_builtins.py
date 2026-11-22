"""Grade each library formula against TradingView's own built-in indicator, bar by bar.
The captures are vendor data: they stay on this machine. Only the grade and the method leave.

    python docs/indicators/evidence/2026-11-18-named-library/grade_builtins.py [out_dir]

It needs the capture files on this machine (RUN below); without them it cannot run, by design.
"""
import io
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..'))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api.services import ast_interpret, call_expansions  # noqa: E402
from api.services import named_indicators as ni  # noqa: E402

RUN = os.path.expandvars(r'%LOCALAPPDATA%\uct-vendor-batch\runs\builtin-2026-11-18\captures')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.expandvars('%TEMP%'), 'named-library-grade')
os.makedirs(OUT, exist_ok=True)
EQUAL = 1e-9
#: capture name -> (library entry, [(plot index, output key or '+' for the sum of both outputs)])
MAP = {
    'mcginley-dynamic': ('mcginley_dynamic', [(0, 'mcginley')]),
    'connors-rsi': ('connors_rsi', [(0, 'crsi')]),
    'chaikin-money-flow': ('chaikin_money_flow', [(0, 'cmf')]),
    'ultimate-oscillator': ('ultimate_oscillator', [(0, 'uo')]),
    'awesome-oscillator': ('awesome_oscillator', [(0, 'ao')]),
    'coppock-curve': ('coppock_curve', [(0, 'coppock')]),
    'true-strength-index': ('true_strength_index', [(0, 'tsi')]),
    'vortex-indicator': ('vortex_indicator', [(0, 'plus'), (1, 'minus')]),
    'choppiness-index': ('choppiness_index', [(0, 'chop')]),
    'bull-bear-power': ('elder_ray', [(0, '+')]),
    'chandelier-exit': ('chandelier_exit', [(0, 'long'), (1, 'short')]),
}
ENTRIES = {e['id']: e for e in ni.entries()}


def load(name, sym):
    d = json.load(io.open(os.path.join(RUN, f'builtin-{name}-{sym}-1d-2026-11-17.json'), encoding='utf-8'))
    assert d['bars']['fields'][:6] == ['time', 'open', 'high', 'low', 'close', 'volume'], d['bars']['fields']
    bars = [dict(zip('tohlcv', r[:6])) for r in d['bars']['rows']]
    fields = d['plotValues']['fields']
    rows = {r[0]: r[1:] for r in d['plotValues']['rows']}
    titles = [p.get('title') for p in d['study']['plots']]
    inputs = {i.get('name'): i.get('value') for i in d['study']['inputs'] if i.get('id') != 'text' and not i.get('isHidden')}
    return d, bars, fields[1:], rows, titles, inputs


def ours(entry, key, bars):
    if key == '+':
        cols = [ast_interpret.interpret(call_expansions.expand_calls(o['tree']), bars) for o in entry['outputs']]
        return [None if a is None or b is None else a + b for a, b in zip(*cols)]
    o = next(o for o in entry['outputs'] if o['key'] == key)
    return ast_interpret.interpret(call_expansions.expand_calls(o['tree']), bars)


def grade(col, bars, rows, plot):
    n = same = 0
    worst = 0.0
    worst_at = None
    tail_n = tail_same = 0
    tail_worst = 0.0
    last = len(bars) - 1
    for i, b in enumerate(bars):
        tv = rows.get(b['t'])
        t = tv[plot] if tv is not None and plot < len(tv) else None
        a = col[i]
        if a is None or t is None or a != a or t != t:
            continue
        n += 1
        rel = abs(a - t) / max(abs(t), 1e-9)
        ok = rel <= EQUAL or abs(a - t) <= 1e-9
        same += ok
        if rel > worst and not ok:
            worst, worst_at = rel, i
        if i > last - 250:
            tail_n += 1
            tail_same += ok
            tail_worst = max(tail_worst, 0.0 if ok else rel)
    return {'compared': n, 'equal': same, 'share': round(same / n, 6) if n else None, 'worst_rel': worst, 'worst_bar': worst_at,
            'last_250': {'compared': tail_n, 'equal': tail_same, 'worst_rel': tail_worst}}


report = {'method': f'library tree at TradingView\'s default inputs, through ast_interpret; a bar is EQUAL within {EQUAL} relative',
          'captures': {}}
for name, (entry_id, plots) in MAP.items():
    entry = ENTRIES[entry_id]
    for sym in ('spy', 'rddt'):
        d, bars, fields, rows, titles, inputs = load(name, sym)
        for plot, key in plots:
            g = grade(ours(entry, key, bars), bars, rows, plot)
            g.update(plot=fields[plot], title=titles[plot] if plot < len(titles) else None, bars=len(bars), inputs=inputs)
            report['captures'][f'{entry_id}.{key}@{sym}'] = g
            verdict = 'EQUAL' if g['compared'] and g['equal'] == g['compared'] else ('EQUAL after warm-up' if g['last_250']['equal'] == g['last_250']['compared'] and g['compared'] else 'DIVERGE')
            g['verdict'] = verdict
            print(f"{entry_id + '.' + key:34s} {sym:4s} bars {len(bars):5d} compared {g['compared']:5d} equal {g['equal']:5d} "
                  f"({(g['share'] or 0):8.3%}) worst {g['worst_rel']:.2e} @{g['worst_bar']}  last250 {g['last_250']['equal']}/{g['last_250']['compared']} "
                  f"worst {g['last_250']['worst_rel']:.2e}  {verdict}")
json.dump(report, io.open(OUT + '/grade_builtins.json', 'w', encoding='utf-8'), indent=1)
