"""Debug: at time t (ISO), show stale entries + epochs for a primitive, and which periods are computable."""
import sys
from datetime import datetime, timezone
from load import load
from run import yahoo_ledger
from api.services.fundamentals_pit import knowledge as K, metrics as M
from api.services.fundamentals_pit.concepts import PRIMITIVES
t, prim, when = sys.argv[1], sys.argv[2], datetime.fromisoformat(sys.argv[3]).replace(tzinfo=timezone.utc)
doc, sub, fl, fx = load(t); kb = K.build(fx, fl); led = yahoo_ledger(t)
tags = {tg for p in PRIMITIVES.values() for tg in p.tags}
st = {k: v for k, v in kb.state_at(when).items() if k[0] in tags}
b = M.build_book(st, led, kb, when)
print("stale:", [x for x in b.stale if x[0] == prim][:12])
for tg in PRIMITIVES[prim].tags:
    ep = kb.restatements(tg, when, M._per_share_same(led, led.per_share_today) if PRIMITIVES[prim].kind == "per_share" else None)
    if ep: print("epochs", tg, [(e[0].date(), e[1], e[2]) for e in ep][-8:])
print("quarters:", sorted((e, round(q.val, 4), q.method, tg.split(':')[1][:30]) for e, (q, tg) in b.quarters.get(prim, {}).items())[-8:])
print("fy:", sorted((e, v) for e, (v, tg, _) in b.fiscal_years.get(prim, {}).items())[-4:])
for e in M.anchor_ends(b, prim)[:4]:
    print(" ttm", e, M.ttm(b, prim, e))
