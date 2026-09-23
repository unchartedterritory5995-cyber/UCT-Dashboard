"""PHASE 7 — the corrected specification over a BOUNDED representative matrix.

Each anchor session is run with the 9 sessions before it (a contiguous block), so the rolling
ratios have genuine priors and every block exercises resume/ordering exactly as a full grind
would. A second artifact runs canonical PIT UCT over its whole live window, for the 2026
comparison against what members actually saw.
"""
import bisect, json, logging, os, sys
os.environ.setdefault("BREADTH_GROUPED_DIR", "/data/grouped_closes_v20260923")
os.environ.setdefault("BREADTH_V2C2_INPUTS", "/data/_audit/v2cc/inputs")
logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(asctime)s %(message)s")
from api.services import breadth_corrected_pass as cp
from api.services import breadth_grouped_history as gh

ANCHORS = ["2008-10-10", "2008-11-28", "2009-03-10", "2011-01-03", "2011-06-27", "2012-07-03",
           "2014-06-09", "2015-08-24", "2018-12-24", "2020-03-16", "2020-03-24", "2020-08-31",
           "2022-06-06", "2022-07-18", "2024-06-10", "2024-08-05", "2025-04-09", "2026-04-15",
           "2026-06-25", "2026-09-11"]
which = sys.argv[1]
os.environ["BREADTH_CODE_COMMIT"] = sys.argv[2] if len(sys.argv) > 2 else "unrecorded"
cal = gh.session_calendar()
if which == "matrix":
    ds = set()
    for a in ANCHORS:
        i = bisect.bisect_left(cal, a)
        ds.update(cal[max(0, i - 9):i + 1])
    art = "/data/_audit/v2cc/bounded_matrix_v2c2.db"
    res = cp.run(art, sorted(ds), cp.UNIVERSES)
elif which == "pit2026":
    ds = [d for d in cal if "2026-03-23" <= d <= "2026-09-11"]
    art = "/data/_audit/v2cc/pit_uct_2026_v2c2.db"
    res = cp.run(art, ds, ("uct",))
print("RESULT", which, json.dumps(res))
