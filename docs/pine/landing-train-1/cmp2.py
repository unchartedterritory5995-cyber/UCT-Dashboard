"""TRAIN-1 scratch: diff a before/after measurement, keyed by the capture's FULL path (cmp.py keyed by
basename, and 28 held basenames repeat across run folders). usage: cmp2.py BEFORE_TAG AFTER_TAG [OUT.json]
Gate: nothing becomes DIVERGE that was not (0 MATCH->DIVERGE, 0 new DIVERGE). Exit 1 on a gate failure."""
import json, os, sys, collections
O = os.path.dirname(os.path.abspath(__file__))
B, A = sys.argv[1], sys.argv[2]
OUT = sys.argv[3] if len(sys.argv) > 3 else None
fail = 0
report = {'harness': {}, 'census': {}}


def load(tag, name):
    p = os.path.join(O, tag, name)
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else None


def short(f):
    f = f.replace(chr(92), '/')
    for cut in ('/runs/', '/fixtures/'):
        if cut in f:
            return f.split(cut, 1)[1]
    return f


for s in ('fix', 'held'):
    for lane in ('0', '1'):
        b, a = load(B, f'{s}-{lane}/verdicts.json'), load(A, f'{s}-{lane}/verdicts.json')
        name = f'{s}-{lane}'
        if not b or not a:
            print(f'== harness {s} lane {lane}: MISSING (before {bool(b)}, after {bool(a)})'); fail = 1; continue
        bm = {short(r['file']): r for r in b['results']}; am = {short(r['file']): r for r in a['results']}
        assert len(bm) == len(b['results']) and len(am) == len(a['results']), 'key collision'
        cnt = lambda m: dict(sorted(collections.Counter(r['verdict'] for r in m.values()).items()))
        print(f'== harness {s} lane {lane} ({b.get("lane")} / {a.get("lane")}): before {cnt(bm)} after {cnt(am)} (graded {len(bm)} / {len(am)}; not comparable {len(b["inventory"])} / {len(a["inventory"])})')
        moves = collections.Counter(); rows = []
        for k in sorted(set(bm) | set(am)):
            vb = bm.get(k, {}).get('verdict', '-'); va = am.get(k, {}).get('verdict', '-')
            if vb != va:
                moves[f'{vb}->{va}'] += 1
                bad = va == 'DIVERGE'
                fail |= bad
                pb = {(p.get('id'), p.get('title')): p.get('verdict') for p in (bm.get(k, {}).get('plots') or [])}
                pa = {(p.get('id'), p.get('title')): p.get('verdict') for p in (am.get(k, {}).get('plots') or [])}
                plots = [f'{t or i}:{pb.get((i, t), "-")}->{pa.get((i, t), "-")}' for (i, t) in sorted(set(pb) | set(pa), key=str) if pb.get((i, t)) != pa.get((i, t))]
                rows.append({'file': k, 'before': vb, 'after': va, 'bad': bool(bad), 'reasonBefore': (bm.get(k, {}).get('reason') or '')[:300],
                             'reasonAfter': (am.get(k, {}).get('reason') or '')[:300], 'plots': plots[:12]})
                print(f'   {"!! " if bad else ""}{vb} -> {va}: {k}')
        print(f'   moves: {dict(moves)}')
        report['harness'][name] = {'before': cnt(bm), 'after': cnt(am), 'moves': dict(moves), 'rows': rows,
                                   'inventoryBefore': len(b['inventory']), 'inventoryAfter': len(a['inventory'])}

DOORS = ('screen', 'pane', 'runtime', 'door')
for lane in ('0', '1'):
    b, a = load(B, f'census-{lane}.json'), load(A, f'census-{lane}.json')
    if not b or not a:
        print(f'== census lane {lane}: MISSING (before {bool(b)}, after {bool(a)})'); fail = 1; continue
    bm = {(r['set'], r['sha']): r for r in b}; am = {(r['set'], r['sha']): r for r in a}
    print(f'== census lane {lane}: {len(bm)} / {len(am)} sources')
    guard = collections.Counter(); sigs = collections.Counter(); colmoves = []; guards = []; clocks = []
    blank = [0, 0]; drawn = [0, 0]; doorok = [0, 0]; kinds = [collections.Counter(), collections.Counter()]
    for k in sorted(set(bm) & set(am)):
        rb, ra = bm[k], am[k]
        for i, r in enumerate((rb, ra)):
            doorok[i] += 1 if r.get('door') == 'OK' else 0
            kinds[i][r.get('doorKind')] += 1
        for d in DOORS:
            if rb.get(d) != ra.get(d):
                guard[f'{d}: {rb.get(d)} -> {ra.get(d)}'] += 1
                guards.append({'door': d, 'before': rb.get(d), 'after': ra.get(d), 'set': ra['set'], 'key': ra['key'], 'msg': ra.get('doorMsg') if d == 'door' else None})
        for d in ('screenSig', 'paneSig', 'doorSig'):
            if rb.get(d) != ra.get(d): sigs[d] += 1
        for side in ('on', 'off'):
            pb = (rb.get(side) or {}).get('per') or {}; pa = (ra.get(side) or {}).get('per') or {}
            for i, per in enumerate((pb, pa)):
                for p in per.values():
                    if not p.get('missing') and side == 'on':
                        drawn[i] += p.get('drawn', 0)
                        blank[i] += 1 if p.get('drawn', 0) == 0 else 0
            ch = [pk for pk in set(pb) | set(pa) if (pb.get(pk) or {}).get('sig') != (pa.get(pk) or {}).get('sig')]
            if ch:
                colmoves.append({'set': ra['set'], 'key': ra['key'], 'side': side, 'plots': len(ch),
                                 'drawnDelta': sum((pa.get(pk) or {}).get('drawn', 0) - (pb.get(pk) or {}).get('drawn', 0) for pk in ch),
                                 'added': len(set(pa) - set(pb)), 'removed': len(set(pb) - set(pa))})
            cb = (rb.get(side) or {}).get('clock'); ca = (ra.get(side) or {}).get('clock')
            eb = (rb.get(side) or {}).get('err'); ea = (ra.get(side) or {}).get('err')
            if cb != ca or eb != ea: clocks.append({'side': side, 'before': cb if eb is None else eb, 'after': ca if ea is None else ea, 'set': ra['set'], 'key': ra['key']})
    print(f'   door OK: {doorok[0]} -> {doorok[1]}; kinds {dict(kinds[0])} -> {dict(kinds[1])}')
    print(f'   guard changes: {sum(guard.values())}')
    for g, n in sorted(guard.items(), key=lambda x: -x[1]): print(f'     {n:4d}  {g}')
    print(f'   translation digests changed: {dict(sigs)}')
    print(f'   on-listing plots drawn bars: {drawn[0]} -> {drawn[1]}; fully blank plots: {blank[0]} -> {blank[1]}')
    print(f'   sources whose served columns moved: {len(set((m["set"], m["key"]) for m in colmoves))} (on {sum(1 for m in colmoves if m["side"] == "on")}, off {sum(1 for m in colmoves if m["side"] == "off")}); clock / error changes: {len(clocks)}')
    report['census'][lane] = {'sources': len(set(bm) & set(am)), 'doorOk': doorok, 'guardCounts': dict(guard), 'guards': guards, 'sigs': dict(sigs),
                              'drawn': drawn, 'blank': blank, 'colmoves': colmoves, 'clocks': clocks}
print('GATE', 'FAIL' if fail else 'PASS')
if OUT:
    json.dump(report, open(OUT, 'w', encoding='utf-8'), indent=1)
sys.exit(1 if fail else 0)
