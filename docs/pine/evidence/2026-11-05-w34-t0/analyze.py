import json, collections, sys
O = 'C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/runs/w34-t0/'
b = json.load(open(O + 'before-map.json', encoding='utf-8')); a = json.load(open(O + 'after-map.json', encoding='utf-8'))
B = {s['key']: s for s in b['scripts']}; A = {s['key']: s for s in a['scripts']}
def sole(m, lab):
    return sorted(k for k, s in m.items() if not s['clean'] and s['walls'] == [lab])
print('headline transfer before/after', b['headline'].get('transfer') if 'transfer' in b['headline'] else None)
for lab in ('[drawing-objects]', '[imperative]'):
    s0 = sole(B, lab); s1 = sole(A, lab)
    print('\n==', lab, 'sole BEFORE', len(s0), 'AFTER', len(s1))
    c = collections.Counter(); sp = collections.Counter()
    for k in s0:
        w = A[k]['walls']
        c[w[0] if len(w) == 1 else '(multi) ' + ' + '.join(w)[:90]] += 1
        sp[(A[k].get('objectProgram') or {}).get('split')] += 1
    print(' where the', len(s0), 'went (new wall; sole where single):')
    for k, v in c.most_common(): print('  %3d  %s' % (v, k))
    print(' object-program split among them:', dict(sp))
print('\n== new sole counts of the new walls over ALL scripts')
for lab in ('[drawing-never-attempted]', '[drawing-no-output-other]', '[paint-withheld]', '[drawing-objects]'):
    print(' ', lab, 'sole', len(sole(A, lab)), 'touches', sum(1 for s in A.values() if lab in s['walls'] and not s['clean']))
ds = collections.Counter()
for s in A.values():
    for w in s['walls']:
        if w.startswith('object op dropped'): ds[w] += 1
print('\n== dropped-op walls (touches)'); [print('  %3d %s' % (v, k)) for k, v in ds.most_common(40)]
soled = collections.Counter(s['walls'][0] for s in A.values() if not s['clean'] and len(s['walls']) == 1 and s['walls'][0].startswith('object op dropped'))
print('== dropped-op walls (sole)'); [print('  %3d %s' % (v, k)) for k, v in soled.most_common(40)]
# the three-way split over every refused step-0 no-output / objects-only script (prod)
sp = collections.Counter((s['firstGuards'] and tuple(g for g in s['firstGuards'] if g in ('pine:no-output','pine:objects-only')) or None, (s.get('objectProgram') or {}).get('split')) for s in A.values() if not s['clean'])
print('\n== firstGuards x split'); [print('  ', k, v) for k, v in sp.most_common() if k[0]]
print('\ntop blockers after:'); [print('  ', x['blocker'], x['capability'], x['soleBlockerOf'], x['scriptsBlocked']) for x in a['blockers'][:15]] if 'blockers' in a else print([k for k in a])
print('\nrt attachedDirtyWalls:', json.dumps(a['runtimeOn']['walls'].get('attachedDirtyWalls'), indent=0)[:1500])
