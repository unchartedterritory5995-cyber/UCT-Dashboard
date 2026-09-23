"""For each primitive: periods reported under >=2 candidate tags (latest value each) -> agreement."""
import sys, collections
from load import load
from api.services.fundamentals_pit import knowledge as K
from api.services.fundamentals_pit.concepts import PRIMITIVES
from datetime import datetime, timezone
NOW = datetime(2030,1,1,tzinfo=timezone.utc)
for t in sys.argv[1:]:
    doc, sub, fl, fx = load(t); kb = K.build(fx, fl)
    st = kb.state_at(NOW)
    for pid, p in PRIMITIVES.items():
        per = collections.defaultdict(dict)
        for (tag, unit, s, e), k in st.items():
            if tag in p.tags and unit == p.unit:
                per[(s, e)][tag] = k.fact.val
        multi = {pk: v for pk, v in per.items() if len(v) > 1}
        if not multi: continue
        dis = [(pk, v) for pk, v in multi.items() if max(v.values()) - min(v.values()) > 1e-6 * max(abs(x) for x in v.values())]
        ex = dis[0] if dis else None
        print(f"{t:5s} {pid:20s} multi-tag periods={len(multi):3d} disagree={len(dis):3d}", ("e.g. " + str(ex[0][1]) + " " + ", ".join(f"{k.split(':')[1][:26]}={x:,.0f}" for k, x in ex[1].items())) if ex else "")
