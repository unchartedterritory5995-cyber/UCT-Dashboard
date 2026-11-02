import json, sys
import os; S = os.environ['AUDIT_DIR']
a, b = sys.argv[1], sys.argv[2]
def load(x):
    j = json.load(open(f'{S}/harness-{x}/verdicts.json', encoding='utf8'))
    return {r['file']: r for r in j['results']}, j
A, ja = load(a); B, jb = load(b)
print(a, ja['laneEvidence']); print(b, jb['laneEvidence'])
n = 0
for f in sorted(set(A) | set(B)):
    x, y = A.get(f), B.get(f)
    if x == y: continue
    n += 1
    keys = [k for k in sorted(set(x or {}) | set(y or {})) if (x or {}).get(k) != (y or {}).get(k)]
    print('==', f, 'changed keys', keys)
    print('   verdict', (x or {}).get('verdict'), '->', (y or {}).get('verdict'))
    for k in keys:
        if k in ('verdict',): continue
        print('   ', k, 'A:', json.dumps((x or {}).get(k))[:700])
        print('   ', k, 'B:', json.dumps((y or {}).get(k))[:700])
print('changed captures', n, 'of', len(set(A) | set(B)))
