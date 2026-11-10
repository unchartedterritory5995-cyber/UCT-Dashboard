import sys, re
from collections import OrderedDict, defaultdict
p = sys.argv[1]
raw = open(p, 'rb').read().decode('utf-8')
lines = raw.splitlines()
def sec(name):
    i = lines.index(name)
    out = []
    for l in lines[i+1:]:
        if l.startswith('## '): break
        out.append(l)
    return out
COLS = ['VERIFIED','PARTIAL','IMPL','MISSING','BLOCKED','UNMAPPED']
def klass(s):
    s = s.strip()
    if s.startswith('VERIFIED'): return 'VERIFIED'
    if s.startswith('PARTIAL'): return 'PARTIAL'
    if s.startswith('IMPLEMENTED / UNVERIFIED'): return 'IMPL'
    if s.startswith('MISSING'): return 'MISSING'
    if s.startswith('BLOCKED'): return 'BLOCKED'
    if s.startswith('UNMAPPED'): return 'UNMAPPED'
    if s.startswith('NOT ON /CHARTS'): return 'EXCL'
    raise SystemExit('unknown status: ' + s)
cnt = defaultdict(lambda: defaultdict(int)); ids = set(); n = 0
for l in sec('## All actions'):
    m = re.match(r'^\| (C[123]-\d{3}) \| ([^|]+?) \| ', l)
    if not m: continue
    cells = l.split(' | ')
    rid, area = m.group(1), m.group(2)
    assert rid not in ids, rid; ids.add(rid); n += 1
    k = klass(cells[3])
    cnt[(rid[:2], area)][k] += 1
# parse counts table
hdr = None; table = OrderedDict()
for l in sec('## Counts by area'):
    if l.startswith('| Part |'):
        hdr = [c.strip() for c in l.strip('|').split('|')]; continue
    if not l.startswith('| C') and not l.startswith('| |'): continue
    c = [x.strip() for x in l.strip().strip('|').split('|')]
    table[(c[0], c[1])] = dict(zip(hdr, c))
has_partial = 'PARTIAL' in hdr
def got(key):
    d = cnt[key]
    v = OrderedDict(); v['VERIFIED']=d['VERIFIED']
    if has_partial: v['PARTIAL']=d['PARTIAL']
    elif d['PARTIAL']: raise SystemExit('PARTIAL rows but no column')
    v['IMPL / UNVERIFIED']=d['IMPL']; v['MISSING']=d['MISSING']; v['BLOCKED']=d['BLOCKED']; v['UNMAPPED']=d['UNMAPPED']
    v['In scope']=sum(d[x] for x in COLS); v['Excluded']=d['EXCL']
    return v
bad = 0; tot = defaultdict(lambda: defaultdict(int))
for key in cnt:
    if key not in table: print('area missing from table', key); bad += 1
for (part, area), row in table.items():
    if area in ('**all**','**Total**'): continue
    g = got((part, area))
    for k, v in g.items():
        tot[part][k] += v; tot['ALL'][k] += v
        if str(v) != row[k]: print('MISMATCH', part, area, k, 'table', row[k], 'recount', v); bad += 1
for part in ('C1','C2','C3'):
    row = table[(part,'**all**')]
    for k,v in tot[part].items():
        if str(v)!=row[k]: print('MISMATCH all', part, k, row[k], v); bad += 1
row = table[('','**Total**')]
for k,v in tot['ALL'].items():
    if str(v)!=row[k]: print('MISMATCH total', k, row[k], v); bad += 1
print('rows', n, 'areas', len(cnt), 'mismatches', bad)
print('TOTAL', dict(tot['ALL']))
for part in ('C1','C2','C3'): print(part, dict(tot[part]))
sys.exit(1 if bad else 0)
