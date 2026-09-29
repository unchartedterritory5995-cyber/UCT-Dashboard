"""Read-only: the 3 stage-2 provenance mismatches (roe_ttm). Served vs re-derived, under V5 and V4, with both
split-source settings; is the point identical in V4 (pre-existing) or V5-specific? Writes validation/diag3.json."""
import sys
CODE = "/data/fundamentals_pit_v5/code/7dfda83de6a7"
sys.path.insert(0, CODE)
import datetime as dt, json
from api.services.fundamentals_pit import derive as D, store as S
from api.services.fundamentals_pit.split_ledger import PRODUCTION_SOURCES

VAL = "/data/fundamentals_pit_v5/validation"
v5 = S.connect("/data/fundamentals_pit_v5/run/v5.db", readonly=True)
v4 = S.connect("/data/fundamentals_pit.db", readonly=True)
s2 = json.load(open(VAL + "/stage2.json"))
out = {"production_sources": PRODUCTION_SOURCES, "rows": []}
for cik, m, when, *_ in s2["provenance"]["fail"]:
    t = int(dt.datetime.fromisoformat(when).timestamp())
    r = {"cik": cik, "metric": m, "t": t, "when": when}
    for name, c, ver in (("v5", v5, 5), ("v4", v4, 4)):
        for src in (("massive",), PRODUCTION_SOURCES):
            e = D.explain(c, cik, m, t, ver, src)
            r[f"{name}_{'massive' if src == ('massive',) else 'prod'}"] = {"served": e["served"], "rederived": e["rederived"], "matches": e["matches_served"]}
    r["v4_point_equals_v5"] = (v4.execute("SELECT v, period_end, method FROM series_point WHERE cik=? AND metric=? AND derivation_version=4 AND t_eff=?", (cik, m, t)).fetchone()
                               == v5.execute("SELECT v, period_end, method FROM series_point WHERE cik=? AND metric=? AND derivation_version=5 AND t_eff=?", (cik, m, t)).fetchone())
    out["rows"].append(r)
json.dump(out, open(VAL + "/diag3.json", "w"), indent=1, default=str)
print(json.dumps(out, indent=1, default=str))
