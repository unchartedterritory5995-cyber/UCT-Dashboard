import json, os
os.environ.setdefault("BREADTH_GROUPED_DIR", "/data/grouped_closes_v20260923")
from api.services import breadth_adjusted_guard as bag, breadth_grouped_history as gh, breadth_ticker as bt
I = "/data/_audit/v2cc/inputs"
g, t = bag.load_or_build(gh.grouped_dir(), I + "/grouped_vintage_manifest.json", I + "/splits_ledger.json",
                         gh.session_calendar(), bt.canon, I + "/adjusted_guard_table.json")
import collections
ev = [e for e in t["events"] if "2008-01-02" <= e["to"] <= "2026-09-11"]
print(t["version"], "events", len(t["events"]), "in range", dict(collections.Counter(e["class"] for e in ev)),
      "withhold names", len(t["withhold_boundaries"]), "boundaries", sum(len(v) for v in t["withhold_boundaries"].values()))
