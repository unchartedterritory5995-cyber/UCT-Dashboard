import json, sys
import os; S = os.environ['AUDIT_DIR']
a_name, b_name = sys.argv[1], sys.argv[2]
A = json.load(open(f'{S}/out-{a_name}.json',encoding='utf8'))
B = json.load(open(f'{S}/out-{b_name}.json',encoding='utf8'))

def drawn(state):
    if not state: return 0
    n = 0
    for k in ('lines', 'labels', 'boxes', 'fills'):
        n += len(state.get(k) or [])
    for t in state.get('tables') or []:
        n += 1
    return n

def first_diff(x, y, path=''):
    if type(x) != type(y): return path, x, y
    if isinstance(x, dict):
        for k in sorted(set(x) | set(y)):
            if x.get(k) != y.get(k): return first_diff(x.get(k), y.get(k), f'{path}.{k}')
        return None
    if isinstance(x, list):
        if len(x) != len(y): return path + f'[len {len(x)}->{len(y)}]', None, None
        for i, (p, q) in enumerate(zip(x, y)):
            if p != q: return first_diff(p, q, f'{path}[{i}]')
        return None
    return path, x, y

stats = {'same': 0, 'a': [], 'b': [], 'c': [], 'meta': []}
print(f'scripts {len(A)} vs {len(B)}')
for k in sorted(set(A) | set(B)):
    if A.get(k,{}).get('probes') != B.get(k,{}).get('probes'): stats['meta'].append((k,'PROBES',A.get(k,{}).get('probes'),B.get(k,{}).get('probes')))
    x, y = A.get(k, {}), B.get(k, {})
    mx = {kk: x.get(kk) for kk in ('ok', 'guard', 'docObjects', 'docRuntime', 'translationRuntime', 'threw')}
    my = {kk: y.get(kk) for kk in ('ok', 'guard', 'docObjects', 'docRuntime', 'translationRuntime', 'threw')}
    if mx != my: stats['meta'].append((k, mx, my))
    cx, cy = x.get('cfg', {}), y.get('cfg', {})
    changed = False
    for cfg in sorted(set(cx) | set(cy)):
        sx = (cx.get(cfg) or {}); sy = (cy.get(cfg) or {})
        if sx == sy: continue
        changed = True
        dx, dy = drawn(sx.get('state')), drawn(sy.get('state'))
        cls = 'a' if dx == 0 and dy > 0 else 'b' if dx > 0 and dy == 0 else 'c'
        fd = first_diff(sx, sy)
        stats[cls].append((k, cfg, dx, dy, {kk: sx.get(kk) for kk in ('rtServed', 'rtReason', 'failed', 'threw', 'reader')},
                           {kk: sy.get(kk) for kk in ('rtServed', 'rtReason', 'failed', 'threw', 'reader')}, str(fd)[:600]))
    if not changed and mx == my: stats['same'] += 1
print('identical scripts', stats['same'])
for c in ('meta', 'a', 'b', 'c'):
    print(f'== {c} {len(stats[c])}')
    for row in stats[c]: print('  ', row)
