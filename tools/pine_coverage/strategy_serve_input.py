"""THE SERVE AUDIT'S INPUT (2026-11-17): the sampled strategies (keys from a coverage map whose rows carry
`wouldTransferIfArmed`) plus, per source, the SERVER's own production-shaped admission answers (PINE_RUNTIME_CAPABILITY_ADMISSION=on,
the committed allowlist / kill list / capability registry; Railway's PINE_RUNTIME_KILL_LIST and
PINE_RUNTIME_ALLOWLIST variables are NOT read: never touch Railway).

usage: python tools/pine_coverage/strategy_serve_input.py <repo> <coverage-map.json> <census_input.json> <out.json>

Read by app/src/components/chart/engine/runtime/__tests__/strategyServeAudit.measure.test.js (STRATEGY_SERVE_INPUT).
The built-in and reference sources stay in the local sample cache (never committed: the repo is public).
"""
import json
import os
import sys

repo, cmap, cinput, out = sys.argv[1:5]
os.environ["PINE_RUNTIME_CAPABILITY_ADMISSION"] = "on"
sys.path.insert(0, repo)
os.chdir(repo)
from api.services import runtime_definitions as rd  # noqa: E402

m = json.load(open(cmap, encoding="utf-8"))
strat = [s for s in m["scripts"] if s["declaration"] == "strategy"]
paths = {r["key"]: r["path"] for r in json.load(open(cinput, encoding="utf-8"))}
lists = {"kill": rd.kill_list(), "allow": rd.allow_list()}
if rd.capability_admission_on():
    lists["capability_admission"] = True
rows = []
for s in strat:
    key = s["key"]
    p = paths[key]
    if key.startswith("committed:"):
        # the committed corpus is read from THIS worktree, not the cache copy
        p = os.path.join(repo, "corpus", "committed", key.split(":", 1)[1] + ".pine")
        if not os.path.exists(p):
            p = paths[key]
    with open(p, encoding="utf-8", newline="") as fh:
        src = fh.read()
    # the verdict door's own policy (`runtime_admission`), with the detector given time (no budget race)
    ok, missing = rd.capability_admitted(src, persist=False, wait=120.0)
    admitted = bool(ok and not rd.killed(None, src))
    verdict = {"admitted": admitted, "missing": missing}
    rows.append({"key": key, "path": p, "population": s["population"], "version": s["version"],
                 "armed": s.get("wouldTransferIfArmed"), "armedWall": s.get("armedWall"),
                 "admission": {"admitted": verdict.get("admitted") is True, "missing": verdict.get("missing") or [],
                               "historyOnly": verdict.get("historyOnly")}})
json.dump({"lists": lists, "rows": rows}, open(out, "w", encoding="utf-8"), indent=1)
print("rows", len(rows), "admitted", sum(1 for r in rows if r["admission"]["admitted"]),
      "armed", sum(1 for r in rows if r["armed"]))
import collections  # noqa: E402
print(collections.Counter(tuple(r["admission"]["missing"]) for r in rows).most_common(12))
