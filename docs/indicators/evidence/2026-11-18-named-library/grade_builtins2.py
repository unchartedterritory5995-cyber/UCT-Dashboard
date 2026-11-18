"""Grade slice 2's entries against TradingView's built-ins (run builtin2-2026-11-18), and read what
the Detrended Price Oscillator's bars-back is. Captures are vendor data: they stay on this machine."""
import io, json, os, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..'))
sys.path.insert(0, ROOT)
from api.services import ast_interpret, call_expansions
from api.services import named_indicators as ni
RUN = os.path.expandvars(r'%LOCALAPPDATA%\uct-vendor-batch\runs\builtin2-2026-11-18\captures')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.expandvars('%TEMP%'), 'named-library-grade')
os.makedirs(OUT, exist_ok=True)
MAP = {
    'dema': ('double_exponential_moving_average', [(0, 'dema')]),
    'tema': ('triple_exponential_moving_average', [(0, 'tema')]),
    'chande-momentum-oscillator': ('chande_momentum_oscillator', [(0, 'cmo')]),
    'stochastic-rsi': ('stochastic_rsi', [(0, 'k'), (1, 'd')]),
}
ENTRIES = {e['id']: e for e in ni.entries()}
def load(name, sym):
    d = json.load(io.open(os.path.join(RUN, f'builtin-{name}-{sym}-1d-2026-11-17.json'), encoding='utf-8'))
    bars = [dict(zip('tohlcv', r[:6])) for r in d['bars']['rows']]
    rows = {r[0]: r[1:] for r in d['plotValues']['rows']}
    return bars, rows
def unequal(col, bars, rows, plot):
    bad, n = [], 0
    for i, b in enumerate(bars):
        tv = rows.get(b['t']); t = tv[plot] if tv is not None and plot < len(tv) else None
        a = col[i]
        if a is None or t is None: continue
        n += 1
        if abs(a - t) > max(1e-9, 1e-9 * abs(t)): bad.append((i, abs(a - t) / max(abs(t), 1e-9)))
    return n, bad
report = {}
for name, (eid, plots) in MAP.items():
    e = ENTRIES[eid]
    for sym in ('spy', 'rddt'):
        bars, rows = load(name, sym)
        for plot, key in plots:
            o = next(o for o in e['outputs'] if o['key'] == key)
            col = ast_interpret.interpret(call_expansions.expand_calls(o['tree']), bars)
            n, bad = unequal(col, bars, rows, plot)
            idx = [i for i, _ in bad]
            worst = max((r for _, r in bad), default=0.0)
            report[f'{eid}.{key}@{sym}'] = {'compared': n, 'unequal': len(bad), 'last_unequal_bar': max(idx) if idx else None, 'worst_rel': worst, 'bars': len(bars)}
            print(f"{eid + '.' + key:44s} {sym:4s} compared {n:5d} unequal {len(bad):5d} last unequal bar {max(idx) if idx else None} of {len(bars) - 1}  worst {worst:.2e}  contiguous-from-start {idx == list(range(idx[0], idx[0] + len(idx))) if idx else None}")
print()
# DPO: which bars-back? uncentred = close - sma(close, 21)[k]; centred = close[k] - sma(close, 21), drawn k bars to the left
for label, name in (('uncentred', 'detrended-price-oscillator'), ('centred', 'detrended-price-oscillator-centered')):
    for sym in ('spy',):
        bars, rows = load(name, sym)
        c = [b['c'] for b in bars]
        sma = [sum(c[i - 20:i + 1]) / 21 if i >= 20 else None for i in range(len(c))]
        for k in (10, 11, 12):
            if label == 'uncentred':
                cand = [c[i] - sma[i - k] if i - k >= 20 else None for i in range(len(c))]
            else:   # the value computed on bar j = i + k is drawn on bar i
                cand = [c[i] - sma[i + k] if i + k < len(c) and sma[i + k] is not None else None for i in range(len(c))]
            n, bad = unequal(cand, bars, rows, 0)
            print(f'DPO {label:9s} {sym} bars-back {k}: compared {n} unequal {len(bad)}')
            report[f'dpo.{label}.k{k}@{sym}'] = {'compared': n, 'unequal': len(bad)}
json.dump(report, io.open(OUT + '/grade_builtins2.json', 'w', encoding='utf-8'), indent=1)
