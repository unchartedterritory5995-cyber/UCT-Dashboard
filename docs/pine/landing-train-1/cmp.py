"""TRAIN-1 ONLY: diff a before/after measurement (census both lanes, harness fixtures + held both lanes).
usage: python cmp.py BEFORE_TAG AFTER_TAG  -> prints the moves; exit 1 if the gate fails
(gate: 0 MATCH->DIVERGE and 0 new DIVERGE, i.e. nothing becomes DIVERGE that was not)."""
import json, os, sys, collections
O = os.path.dirname(os.path.abspath(__file__))
B, A = sys.argv[1], sys.argv[2]
fail = 0


def load(tag, name):
    p = os.path.join(O, tag, name)
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else None


for s in ('fix', 'held'):
    for lane in ('0', '1'):
        b, a = load(B, f'{s}-{lane}/verdicts.json'), load(A, f'{s}-{lane}/verdicts.json')
        if not b or not a:
            print(f'== harness {s} lane {lane}: MISSING (before {bool(b)}, after {bool(a)})'); fail = 1; continue
        key = lambda r: os.path.basename(r.get('file') or r.get('id') or '')
        bm = {key(r): r for r in b['results']}; am = {key(r): r for r in a['results']}
        cnt = lambda m: dict(collections.Counter(r['verdict'] for r in m.values()))
        print(f'== harness {s} lane {lane}: before {cnt(bm)} after {cnt(am)} (captures {len(bm)} / {len(am)})')
        moves = collections.Counter()
        for k in sorted(set(bm) | set(am)):
            vb = bm.get(k, {}).get('verdict', '-'); va = am.get(k, {}).get('verdict', '-')
            if vb != va:
                moves[(vb, va)] += 1
                bad = va == 'DIVERGE' and vb != '-'
                fail |= bad
                print(f'   {"!! " if bad else ""}{vb} -> {va}: {k}')
        print(f'   moves: {dict(moves)}')

DOORS = ('screen', 'pane', 'runtime', 'door')
for lane in ('0', '1'):
    b, a = load(B, f'census-{lane}.json'), load(A, f'census-{lane}.json')
    if not b or not a:
        print(f'== census lane {lane}: MISSING (before {bool(b)}, after {bool(a)})'); fail = 1; continue
    bm = {(r['set'], r['sha']): r for r in b}; am = {(r['set'], r['sha']): r for r in a}
    print(f'== census lane {lane}: {len(bm)} / {len(am)} sources')
    guard = collections.Counter(); sigs = collections.Counter(); colmoves = []
    blank = [0, 0]; drawn = [0, 0]
    for k in sorted(set(bm) & set(am)):
        rb, ra = bm[k], am[k]
        for d in DOORS:
            if rb.get(d) != ra.get(d):
                guard[(d, rb.get(d), ra.get(d))] += 1
                print(f'   GUARD {d}: {rb.get(d)} -> {ra.get(d)}: {ra["set"]} {ra["key"]}')
        for d in ('screenSig', 'paneSig', 'doorSig'):
            if rb.get(d) != ra.get(d): sigs[d] += 1
        for side in ('on', 'off'):
            pb = (rb.get(side) or {}).get('per') or {}; pa = (ra.get(side) or {}).get('per') or {}
            for i, per in enumerate((pb, pa)):
                for p in per.values():
                    if not p.get('missing'):
                        drawn[i] += p.get('drawn', 0) if side == 'on' else 0
                        blank[i] += 1 if (side == 'on' and p.get('drawn', 0) == 0) else 0
            ch = [pk for pk in set(pb) | set(pa) if (pb.get(pk) or {}).get('sig') != (pa.get(pk) or {}).get('sig')]
            if ch:
                colmoves.append((ra['set'], ra['key'], side, len(ch),
                                 sum((pa.get(pk) or {}).get('drawn', 0) - (pb.get(pk) or {}).get('drawn', 0) for pk in ch)))
            cb = (rb.get(side) or {}).get('clock'); ca = (ra.get(side) or {}).get('clock')
            if cb != ca: print(f'   CLOCK {side}: {cb} -> {ca}: {ra["set"]} {ra["key"]}')
    print(f'   guard changes: {sum(guard.values())}  translation digests changed: {dict(sigs)}')
    print(f'   on-listing plots drawn bars: {drawn[0]} -> {drawn[1]}; fully blank plots: {blank[0]} -> {blank[1]}')
    print(f'   sources whose served columns moved: {len(colmoves)}')
    for m in colmoves: print(f'     COLS {m[2]}: {m[0]} {m[1]} plots={m[3]} drawnDelta={m[4]:+d}')
print('GATE', 'FAIL' if fail else 'PASS')
sys.exit(1 if fail else 0)
