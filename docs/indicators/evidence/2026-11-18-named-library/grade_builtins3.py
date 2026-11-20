"""Grade library slice 3 against TradingView's built-ins (run builtin3-2026-11-18), and settle the
two indicators that wait on a capture (TRIX's scale, the Detrended Price Oscillator's displacement).
Captures are vendor data: they stay on this machine; only the verdict words go into the library."""
import glob
import io
import itertools
import json
import math
import os
import sys

sys.path.insert(0, os.environ.get('UCT_REPO', '.'))
from api.services import ast_interpret, call_expansions  # noqa: E402
from api.services import named_indicators as ni  # noqa: E402

RUN = os.path.expandvars(r'%LOCALAPPDATA%\uct-vendor-batch\runs\builtin3-2026-11-18\captures')
OUT = os.environ.get('UCT_GRADE_OUT', '.')          # where the verdict file is written (off the repository)
ENTRIES = {e['id']: e for e in ni.entries()}
MAP = {
    'aroon': 'aroon', 'dmi': 'directional_movement_index', 'on-balance-volume': 'on_balance_volume',
    'accumulation-distribution': 'accumulation_distribution_line', 'price-volume-trend': 'price_volume_trend',
    'price-oscillator': 'percentage_price_oscillator', 'know-sure-thing': 'know_sure_thing', 'mass-index': 'mass_index',
    'elders-force-index': 'force_index', 'ease-of-movement': 'ease_of_movement',
    'negative-volume-index': 'negative_volume_index', 'ulcer-index': 'ulcer_index', 'trix': 'trix',
}
#: settings the capture was taken at, where they are not the entry's defaults
AT = {'trix': {'length': 15}}


def ok(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and not math.isnan(v)


def load(name, sym):
    (path,) = glob.glob(os.path.join(RUN, f'builtin-{name}-{sym}-1d-*.json'))
    d = json.load(io.open(path, encoding='utf-8'))
    bars = [dict(zip('tohlcv', r[:6])) for r in d['bars']['rows']]
    rows = {r[0]: r[1:] for r in d['plotValues']['rows']}
    width = max((len(v) for v in rows.values()), default=0)
    inputs = {i.get('name'): i.get('value') for i in (d.get('study') or {}).get('inputs', [])
              if i.get('name') not in ('ILScript', 'pineId', 'pineVersion', 'pineFeatures', '__profile')}
    return bars, rows, width, inputs


def compare(col, bars, rows, plot, scale=1.0, tol=1e-9):
    """(compared, unequal bar indexes, worst relative difference, constant offset or None)."""
    bad, n, worst, diffs = [], 0, 0.0, []
    for i, b in enumerate(bars):
        tv = rows.get(b['t'])
        t = tv[plot] if tv is not None and plot < len(tv) else None
        a = col[i]
        if not ok(a) or not ok(t):
            continue
        a = a * scale
        n += 1
        diffs.append(a - t)
        rel = abs(a - t) / max(abs(t), 1e-9)
        if abs(a - t) > max(tol, tol * abs(t)):
            bad.append(i)
            worst = max(worst, rel)
    offset = None
    if diffs and bad:
        tail = diffs[len(diffs) // 2:]
        if max(tail) - min(tail) <= 1e-6 * max(1.0, abs(tail[0])):
            offset = tail[0]
    return n, bad, worst, offset


def verdict(n, bad, total):
    if n == 0:
        return 'NOTHING TO COMPARE'
    if not bad:
        return 'EQUAL'
    if max(bad) < total * 0.5 and bad == list(range(min(bad), min(bad) + len(bad))):
        return f'EQUAL AFTER WARM-UP (first {max(bad) + 1} bars differ)'
    if max(bad) < total * 0.5:
        return f'EQUAL AFTER BAR {max(bad)} ({len(bad)} early bars differ)'
    return f'DIFFERS ({len(bad)} of {n}, to bar {max(bad)})'


report = {}
print('== the entries: every output against every plotted column, the best column shown')
for name, eid in MAP.items():
    e = ENTRIES[eid]
    for sym in ('spy', 'rddt'):
        bars, rows, width, inputs = load(name, sym)
        if sym == 'spy':
            print(f'-- {e["name"]}  ({width} columns; settings {inputs})'[:230])
        for o in e['outputs']:
            col = ast_interpret.interpret(call_expansions.expand_calls(ni.tree_at(o, AT.get(eid, {}))), bars)
            best = None
            for plot in range(width):
                for scale in ((1.0, 1e-4) if eid == 'ease_of_movement' else (1.0,)):
                    n, bad, worst, offset = compare(col, bars, rows, plot, scale)
                    key = (len(bad) if n else 10 ** 9, plot)
                    if best is None or key < best[0]:
                        best = (key, plot, scale, n, bad, worst, offset)
            _k, plot, scale, n, bad, worst, offset = best
            v = verdict(n, bad, len(bars))
            extra = (f'  x{scale:g}' if scale != 1.0 else '') + (f'  constant offset {offset:.6g}' if offset is not None else '')
            print(f'   {eid + "." + o["key"]:46s} {sym:4s} column {plot}  compared {n:5d}  {v}  worst {worst:.2e}{extra}')
            report[f'{eid}.{o["key"]}@{sym}'] = {'column': plot, 'scale': scale, 'compared': n, 'unequal': len(bad),
                                                 'last_unequal_bar': max(bad) if bad else None, 'bars': len(bars),
                                                 'worst_rel': worst, 'constant_offset': offset, 'verdict': v}


def ema(xs, n):
    out, prev, seen = [], None, []
    a = 2.0 / (n + 1)
    for v in xs:
        if not ok(v):
            out.append(None if prev is None else prev)
            continue
        if prev is None:
            seen.append(v)
            if len(seen) == n:
                prev = sum(seen) / n
            out.append(prev)
        else:
            prev = prev + a * (v - prev)
            out.append(prev)
    return out


print()
print('== TRIX, length 15: which scale?')
for sym in ('spy', 'rddt'):
    bars, rows, width, inputs = load('trix', sym)
    c = [b['c'] for b in bars]
    e3 = ema(ema(ema(c, 15), 15), 15)
    l3 = ema(ema(ema([math.log(x) for x in c], 15), 15), 15)
    forms = {
        'percent change of the triple EMA (x100)': [100.0 * (e3[i] - e3[i - 1]) / e3[i - 1] if i and ok(e3[i]) and ok(e3[i - 1]) else None for i in range(len(c))],
        'change of the triple EMA of log(close), x10000': [10000.0 * (l3[i] - l3[i - 1]) if i and ok(l3[i]) and ok(l3[i - 1]) else None for i in range(len(c))],
        'fractional change of the triple EMA (x1)': [(e3[i] - e3[i - 1]) / e3[i - 1] if i and ok(e3[i]) and ok(e3[i - 1]) else None for i in range(len(c))],
        'percent change x10000': [10000.0 * (e3[i] - e3[i - 1]) / e3[i - 1] if i and ok(e3[i]) and ok(e3[i - 1]) else None for i in range(len(c))],
    }
    for label, col in forms.items():
        n, bad, worst, _ = compare(col, bars, rows, 0)
        print(f'   {sym:4s} {label:52s} compared {n:5d}  {verdict(n, bad, len(bars))}  worst {worst:.2e}')
        report[f'trix.{label}@{sym}'] = {'compared': n, 'unequal': len(bad), 'verdict': verdict(n, bad, len(bars))}

print()
print('== Detrended Price Oscillator, length 20: which displacement, centred and not?')
for label, name in (('not centred', 'detrended-price-oscillator-20'), ('centred', 'detrended-price-oscillator-20-centered')):
    for sym in ('spy', 'rddt'):
        bars, rows, width, inputs = load(name, sym)
        c = [b['c'] for b in bars]
        sma = [sum(c[i - 19:i + 1]) / 20 if i >= 19 else None for i in range(len(c))]
        for k in (9, 10, 11, 12):
            if label == 'not centred':
                cand = [c[i] - sma[i - k] if i - k >= 19 else None for i in range(len(c))]
            else:
                cand = [c[i] - sma[i + k] if i + k < len(c) and sma[i + k] is not None else None for i in range(len(c))]
            n, bad, worst, _ = compare(cand, bars, rows, 0)
            print(f'   {label:11s} {sym:4s} bars back {k:2d}: compared {n:5d}  {verdict(n, bad, len(bars))}')
            report[f'dpo.{label}.k{k}@{sym}'] = {'compared': n, 'unequal': len(bad), 'verdict': verdict(n, bad, len(bars))}

json.dump(report, io.open(OUT + '/grade_builtins3.json', 'w', encoding='utf-8'), indent=1)
print()
print('written', OUT + '/grade_builtins3.json')
