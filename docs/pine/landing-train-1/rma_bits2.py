"""TRAIN-1 scratch: the same bit-exact count on the builtin ATR(14) captures (ta.rma(ta.tr(true), 14) from the listing)."""
import json, struct, os, glob
R = os.path.join(os.environ['LOCALAPPDATA'], 'uct-vendor-batch', 'runs')
bits = lambda x: struct.pack('>d', x)
def forms(n):
    a = 1.0 / n
    return {
        'OURS (1-a)*prev + a*src': lambda src, prev: prev * (1 - a) + src * a,
        'F1 a*src + (1-a)*prev': lambda src, prev: a * src + (1 - a) * prev,
        'F2 (src + (n-1)*prev)/n': lambda src, prev: (src + (n - 1) * prev) / n,
        'F3 prev + a*(src - prev)': lambda src, prev: prev + a * (src - prev),
        'F4 (prev*(n-1) + src)/n': lambda src, prev: (prev * (n - 1) + src) / n,
    }
def columns(d):
    pv = d['plotValues']
    if isinstance(pv, dict):
        rows = pv.get('rows') or pv.get('values') or []
        cols = pv.get('columns') or pv.get('plots') or []
        return cols, rows
    return [], pv
for f in sorted(glob.glob(os.path.join(R, '*', 'captures', 'average-true-range-*-1d-*.json'))):
    d = json.load(open(f, encoding='utf-8'))
    if not d['history'].get('startsAtBar0'): print(os.path.basename(f), 'not from bar 0, skipped'); continue
    rows = d['bars']['rows']
    cols, vals = columns(d)
    # the first numeric plot column, aligned to bars by time
    pv = d['plotValues']
    if not vals: print(os.path.basename(f), 'plotValues shape', (list(pv.keys()) if isinstance(pv, dict) else type(pv))); continue
    byt = {r[0]: r for r in vals}
    n = 14
    tr = []
    for i, (t, o, h, l, c, *_r) in enumerate(rows):
        tr.append(h - l if i == 0 else max(h - l, abs(h - rows[i - 1][4]), abs(l - rows[i - 1][4])))
    res = {}
    for name, fn in forms(n).items():
        prev = None; s = 0.0; exact = 0; total = 0; near = 0
        for i, x in enumerate(tr):
            if prev is None:
                s += x
                val = None
                if i == n - 1: prev = val = s / n
            else:
                prev = val = fn(x, prev)
            v = byt.get(rows[i][0])
            vv = v[1] if v and len(v) > 1 else None
            if isinstance(vv, (int, float)) and val is not None:
                total += 1
                if bits(float(vv)) == bits(val): exact += 1
                elif abs(val - vv) <= 1e-12 * abs(vv): near += 1
        res[name] = (exact, near, total)
    print('==', os.path.relpath(f, R))
    for k, v in res.items(): print('   exact %4d  within-1e-12 %4d  of %4d   %s' % (v[0], v[1], v[2], k))
