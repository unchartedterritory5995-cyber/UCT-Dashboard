"""List the canonical-uct names withheld (guard ∪ dividend basis) on given sessions (read-only)."""
import bisect, json, os, sys
tag, dates = sys.argv[1], sys.argv[2].split(",")
os.environ["BREADTH_GROUPED_DIR"] = "/data/grouped_closes_" + tag
from api.services import breadth_corrected_pass as cp
from api.services import breadth_grouped_history as gh
inp = cp.Inputs("/data/_audit/v2cc/inputs_" + tag)
cal = gh.session_calendar()
out = {}
for D in dates:
    i = bisect.bisect_left(cal, D); f0 = cal[max(0, i - 380)]
    names = inp.pit_members(D) or []
    g = sorted(t for t in names if inp.guard.withheld(t, f0, D))
    d = sorted(t for t in names if inp.divbasis.withheld_in(t, f0, D) and t not in g)
    out[D] = {"guard": g, "dividend": d}
    print(D, len(g), len(d))
print("JSON" + json.dumps(out))
