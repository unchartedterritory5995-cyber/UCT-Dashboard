"""Per year: of the names passing price + volume + type on a session, how many have a share count
as of the date, only a later one (backfill), or none. Value-free."""
import sys
sys.path.insert(0, "/data/_audit/uct_pit/code")
import membership as M
from collections import Counter
ref, spl, sh = M.Ref(), M.Splits(), M.Shares()
ss = M.sessions()
for y in range(2008, 2027):
    ds = [d for d in ss if d.startswith(str(y))]
    if len(ds) < 3: continue
    c = Counter(); n = 0
    for d in ds[5::60]:
        i = ss.index(d); prev = ss[i-1]; pb, db = M.bars(prev), M.bars(d)
        for t, b in pb.items():
            if not b[3] or b[3] < 2 or not b[4] or b[4] < 2e5 or t not in db: continue
            rec = ref.at(t, prev)
            if rec is None: c["no_ref"] += 1; n += 1; continue
            if rec[0] not in ("CS", "ADRC"):
                if rec[0] is None: c["type_unknown"] += 1; n += 1
                continue
            n += 1
            if not rec[1]: c["no_cik"] += 1; continue
            s = sh.at(rec[1], prev)
            c[s[2] if s else "no_shares"] += 1
    print(y, "eligible/day", n // max(1, len(ds[5::60])), {k: round(v / n, 3) for k, v in c.most_common()})
