"""TRAIN-1 scratch (offline, read-only on the licence-held store): things BUILT ON ta.rma, each builtin's own
published arithmetic (read off the captured source), with the rma step in two forms, counted BIT-EXACT
against TradingView's plotted doubles. RSI(14), DMI(14, 14): +DI, -DI, ADX."""
import json, struct, os, glob, math
R = os.path.join(os.environ['LOCALAPPDATA'], 'uct-vendor-batch', 'runs')
bits = lambda x: struct.pack('>d', x)
NAN = float('nan')
fin = lambda x: isinstance(x, (int, float)) and math.isfinite(x)
FORMS = {
    'OURS prev*(1-1/n) + v*(1/n)': lambda prev, v, n: prev * (1 - 1.0 / n) + v * (1.0 / n),
    'TV   (prev*(n-1) + v)/n': lambda prev, v, n: (prev * (n - 1) + v) / n,
}
def rma(series, n, f):
    out = []; prev = NAN; cnt = 0; tot = 0.0
    for v in series:
        if not fin(v): out.append(NAN); continue          # hold: na at the bar, state unchanged
        if prev != prev:
            tot += v; cnt += 1
            if cnt == n: prev = tot / n; out.append(prev)
            else: out.append(NAN)
        else:
            prev = f(prev, v, n); out.append(prev)
    return out
def find(cid):
    for f in sorted(glob.glob(os.path.join(R, 's*', 'captures', cid + '.json'))): return f
def load(cid):
    d = json.load(open(find(cid), encoding='utf-8'))
    assert d['history'].get('startsAtBar0') is True, cid
    rows = d['bars']['rows']
    pv = d['plotValues']; fields = pv['fields']
    byt = {r[0]: r for r in pv['rows']}
    col = lambda name: [(byt.get(r[0]) or [None] * len(fields))[fields.index(name)] for r in rows]
    return rows, col
def count(ours, vendor):
    exact = near = total = 0
    for a, b in zip(ours, vendor):
        if not fin(b): continue
        total += 1
        if fin(a) and bits(float(a)) == bits(float(b)): exact += 1
        elif fin(a) and abs(a - b) <= 1e-11 * max(1.0, abs(b)): near += 1
    return exact, near, total
def fixnan(xs):
    out = []; last = NAN
    for x in xs:
        if fin(x): last = x
        out.append(last)
    return out
res = []
# RSI(14) over close
rows, col = load('relative-strength-index-rddt-1d-2026-11-14')
c = [r[4] for r in rows]
ch = [NAN] + [c[i] - c[i - 1] for i in range(1, len(c))]
for name, f in FORMS.items():
    up = rma([max(x, 0) if fin(x) else NAN for x in ch], 14, f)
    dn = rma([-min(x, 0) if fin(x) else NAN for x in ch], 14, f)
    rsi = [(100.0 if d == 0 else 0.0 if u == 0 else 100 - (100 / (1 + u / d))) if fin(u) and fin(d) else NAN for u, d in zip(up, dn)]
    res.append(('builtin RSI(14) RDDT, plot RSI', name) + count(rsi, col('plot_0')))
# DMI(14, 14)
rows, col = load('directional-movement-index-rddt-1d-2026-11-14')
h = [r[2] for r in rows]; l = [r[3] for r in rows]; c = [r[4] for r in rows]
upm = [NAN] + [h[i] - h[i - 1] for i in range(1, len(h))]
dnm = [NAN] + [-(l[i] - l[i - 1]) for i in range(1, len(l))]
plusDM = [NAN if not fin(u) else (u if (u > d and u > 0) else 0.0) for u, d in zip(upm, dnm)]
minusDM = [NAN if not fin(d) else (d if (d > u and d > 0) else 0.0) for u, d in zip(upm, dnm)]
tr = [NAN] + [max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1])) for i in range(1, len(c))]
for name, f in FORMS.items():
    trur = rma(tr, 14, f)
    plus = fixnan([100 * a / b if fin(a) and fin(b) else NAN for a, b in zip(rma(plusDM, 14, f), trur)])
    minus = fixnan([100 * a / b if fin(a) and fin(b) else NAN for a, b in zip(rma(minusDM, 14, f), trur)])
    dx = [abs(p - m) / (1 if (p + m) == 0 else (p + m)) if fin(p) and fin(m) else NAN for p, m in zip(plus, minus)]
    adx = [100 * x if fin(x) else NAN for x in rma(dx, 14, f)]
    res.append(('builtin DMI(14) RDDT, +DI', name) + count(plus, col('plot_1')))
    res.append(('builtin DMI(14) RDDT, -DI', name) + count(minus, col('plot_2')))
    res.append(('builtin DMI(14) RDDT, ADX', name) + count(adx, col('plot_0')))
for what, form, exact, near, total in sorted(res):
    print('%-32s %-30s exact %4d  near %4d  of %4d' % (what, form, exact, near, total))
