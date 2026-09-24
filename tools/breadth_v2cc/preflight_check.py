"""Run the launcher's preflight against an inputs vintage (read-only; launches nothing)."""
import json, os, sys
tag = sys.argv[1]
os.environ["BREADTH_GROUPED_DIR"] = "/data/grouped_closes_" + tag
from api.services import breadth_corrected_pass as cp
pf = cp.preflight("/data/_audit/v2cc/inputs_" + tag, now_utc=(sys.argv[2] if len(sys.argv) > 2 else None))
print(json.dumps({"problems": pf["problems"], "cache_valid_until": pf["checks"].get("cache_valid_until"),
                  "grouped_files_verified": pf["checks"].get("grouped_files_verified"),
                  "flags": {k: pf["checks"].get(k) for k in cp.PRODUCTION_WRITING_FLAGS}}, indent=1))
