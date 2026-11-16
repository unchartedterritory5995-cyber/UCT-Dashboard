"""TRAIN-1 scratch (offline, read-only on the licence-held store): which summation order of the rma
recurrence reproduces TradingView's doubles BIT FOR BIT on the W3N-D1c captures (rma(close, 3) stepped
only on up bars, the per-call-site history the probe was written to show)."""
import json, struct, os, itertools
R = os.path.join(os.environ['LOCALAPPDATA'], 'uct-vendor-batch', 'runs', 's10-2026-11-15')
bits = lambda x: struct.pack('>d', x)
def forms(n):
    a = 1.0 / n
    return {
        'F1 a*src + (1-a)*prev': lambda src, prev: a * src + (1 - a) * prev,
        'F2 (src + (n-1)*prev)/n': lambda src, prev: (src + (n - 1) * prev) / n,
        'F3 prev + a*(src - prev)': lambda src, prev: prev + a * (src - prev),
        'F4 (prev*(n-1) + src)/n': lambda src, prev: (prev * (n - 1) + src) / n,
        'F5 (1-a)*prev + a*src': lambda src, prev: (1 - a) * prev + a * src,
        'F6 prev - a*prev + a*src': lambda src, prev: prev - a * prev + a * src,
    }
def seeds(n):
    return {
        'S1 left-to-right sum / n': lambda w: sum_lr(w) / n,
        'S2 newest-first sum / n': lambda w: sum_lr(w[::-1]) / n,
        'S3 sum of (x/n)': lambda w: sum_lr([x / n for x in w]),
        'S4 mean*alpha form': lambda w: sum_lr(w) * (1.0 / n),
    }
def sum_lr(w):
    s = 0.0
    for x in w: s += x
    return s
def run(cap_id, n=3):
    cap = json.load(open(os.path.join(R, 'captures', cap_id + '.json'), encoding='utf-8'))
    xm = json.load(open(os.path.join(R, 'xmap', cap_id + '.json'), encoding='utf-8'))
    rows = cap['bars']['rows']
    labels = sorted(cap['objects']['records']['labels'], key=lambda l: l['id'])
    vendor = {xm['barIndex'][str(l['x'])] if isinstance(xm['barIndex'], dict) else xm['barIndex'][l['x']]: l['y'] for l in labels}
    ups = [(i, r[4]) for i, r in enumerate(rows) if r[4] > r[1]]
    out = {}
    for (fn, f), (sn, s) in itertools.product(forms(n).items(), seeds(n).items()):
        prev = None; exact = 0; near = 0; total = 0
        win = []
        for i, c in ups:
            if prev is None:
                win.append(c)
                if len(win) < n: val = None
                else: val = s(win); prev = val
            else:
                val = f(c, prev); prev = val
            if i in vendor and vendor[i] is not None:
                total += 1
                if val is not None and bits(val) == bits(vendor[i]): exact += 1
                elif val is not None and abs(val - vendor[i]) <= 4e-13 * abs(vendor[i]): near += 1
        out[(fn, sn)] = (exact, near, total)
    return out, len(labels), len(ups)
for cap_id in ('vw-w3n-draw-block-history-c-spy-1d-2026-11-15', 'vw-w3n-draw-block-history-c-rddt-1d-2026-11-15'):
    try: out, nl, nu = run(cap_id)
    except Exception as e: print(cap_id, 'ERR', repr(e)[:200]); continue
    print('==', cap_id, 'labels', nl, 'up bars', nu)
    for k, v in sorted(out.items(), key=lambda kv: -kv[1][0])[:10]: print('   exact %4d  within-ulps %4d  of %4d   %s | %s' % (v[0], v[1], v[2], k[0], k[1]))
