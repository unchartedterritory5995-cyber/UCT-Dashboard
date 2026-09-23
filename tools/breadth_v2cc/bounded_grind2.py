"""PHASE 10 — the corrected specification WITH the F4 dividend basis, over the bounded matrix.

argv: which(matrix|pit|boundary) commit tag [extra anchors comma-separated]
Each anchor runs with its 9 preceding sessions (contiguous block: rolling-ratio priors,
resume ordering). `pit` runs canonical UCT over every live PIT session in the vintage.
"""
import bisect, json, logging, os, sys
which, commit, tag = sys.argv[1], sys.argv[2], sys.argv[3]
extra = [a for a in (sys.argv[4].split(",") if len(sys.argv) > 4 else []) if a]
os.environ["BREADTH_GROUPED_DIR"] = "/data/grouped_closes_" + tag
os.environ["BREADTH_V2C2_INPUTS"] = "/data/_audit/v2cc/inputs_" + tag
os.environ["BREADTH_CODE_COMMIT"] = commit
logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(asctime)s %(message)s")
from api.services import breadth_corrected_pass as cp
from api.services import breadth_grouped_history as gh

ANCHORS = ["2008-10-10", "2008-11-28", "2009-03-10", "2011-01-03", "2011-06-27", "2012-07-03",
           "2014-06-09", "2015-08-24", "2018-12-24", "2020-03-16", "2020-03-24", "2020-08-31",
           "2022-06-06", "2022-07-18", "2024-06-10", "2024-08-05", "2025-04-09", "2026-04-15",
           "2026-06-25", "2026-09-11"]
cal = gh.session_calendar()
if which == "matrix":
    ds = set()
    for a in ANCHORS + extra:
        i = bisect.bisect_left(cal, a)
        ds.update(cal[max(0, i - 9):i + 1])
    art = "/data/_audit/v2cc/bounded_matrix_v2c2div_%s.db" % tag
    res = cp.run(art, sorted(ds), cp.UNIVERSES, os.environ["BREADTH_V2C2_INPUTS"])
elif which == "boundary":
    # PHASE 13 on real inputs: ask for canonical uct across the start; only >= 2026-03-23 may exist
    ds = [d for d in cal if "2026-03-16" <= d <= "2026-03-25"]
    art = "/data/_audit/v2cc/boundary_uct_v2c2div_%s.db" % tag
    res = cp.run(art, ds, ("uct", "uct_backtest"), os.environ["BREADTH_V2C2_INPUTS"])
else:
    ds = [d for d in cal if d >= "2026-03-23"]
    art = "/data/_audit/v2cc/pit_uct_v2c2div_%s.db" % tag
    res = cp.run(art, ds, ("uct",), os.environ["BREADTH_V2C2_INPUTS"])
print("RESULT", which, json.dumps(res))
