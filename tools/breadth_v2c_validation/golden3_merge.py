"""Merge golden3 chunk outputs into one summary (read-only)."""
import collections, glob, json, os, sys
from common import OUT, write
files = sorted(f for f in glob.glob(os.path.join(OUT, sys.argv[1] + "*.json")) if "MERGED" not in f)
tot = collections.Counter(); byu = collections.defaultdict(collections.Counter); sens = collections.defaultdict(lambda: [0, 0])
S = {"files": files, "sessions": 0, "universe_sessions": 0, "bucket_agreement": 0, "withheld_agreement": 0, "nonexact": []}
for f in files:
    R = json.load(open(f)); s = R["summary"]
    S["sessions"] += s["sessions"]; S["universe_sessions"] += s["universe_sessions"]
    S["bucket_agreement"] += s["bucket_agreement"]; S["withheld_agreement"] += s["withheld_agreement"]
    tot.update(s["classes"])
    for u, v in s["by_universe"].items(): byu[u].update(v)
    for m, v in s["sensitivity_empirical"].items():
        sens[m][0] += v["sessions_differing"]; sens[m][1] += v["compared"]
    S["nonexact"] += R["nonexact"]
S["classes"] = dict(tot); S["by_universe"] = {u: dict(v) for u, v in byu.items()}
S["sensitivity_empirical"] = {m: {"sessions_differing": a, "compared": b} for m, (a, b) in sorted(sens.items())}
S["nonexact_count"] = len(S["nonexact"])
print(write(sys.argv[1] + "_MERGED.json", S))
print(json.dumps({k: v for k, v in S.items() if k not in ("nonexact", "sensitivity_empirical", "files")}, indent=1))
print(json.dumps(S["sensitivity_empirical"]))
for x in S["nonexact"][:20]: print("NONEXACT", x)
