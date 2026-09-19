"""report.py — print the current survey aggregates. Read-only."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def j(name):
    p = os.path.join(HERE, name)
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def engine():
    d = j("engine_refusal_agg.json")
    if not d:
        print("(no engine run yet)")
        return
    n = d["n_scripts"]
    print("=== OUR ENGINE vs THE WILD ===")
    print("scripts run            : %d" % n)
    print("translated (>=1 column): %d  (%.1f%%)" % (d["translated"], 100.0 * d["translated"] / n))
    print("threw an exception     : %d" % d["threw"])
    print("\nTOP BLOCKERS (refusal guard -> scripts affected)")
    for r in d["refusals"][:22]:
        print("  %-26s %5d  %5.1f%%" % (r["guard"], r["scripts"], r["pct_of_corpus"]))


def presentation(top=30):
    d = j("agg_presentation.json")
    if not d:
        print("(no inventory yet)")
        return
    print("\n=== DEMAND-WEIGHTED PRESENTATION PRIMITIVES (n=%d scripts) ===" % d["n_scripts"])
    print("  %-24s %8s %8s" % ("primitive", "%scripts", "sites"))
    for r in d["primitives"][:top]:
        print("  %-24s %7.1f%% %8d" % (r["primitive"], r["pct_scripts"], r["call_sites"]))


def computation(top=40):
    d = j("agg_computation.json")
    if not d:
        return
    print("\n=== DEMAND-WEIGHTED COMPUTATION / LANGUAGE FEATURES (n=%d) ===" % d["n_scripts"])
    print("  %-30s %8s %8s" % ("feature", "%scripts", "sites"))
    for r in d["features"][:top]:
        print("  %-30s %7.1f%% %8d" % (r["feature"], r["pct_scripts"], r["call_sites"]))


def constants(top=35):
    d = j("agg_constants.json")
    if not d:
        return
    print("\n=== MOST-DEMANDED ENUMERATED CONSTANTS ===")
    for r in d["constants"][:top]:
        print("  %-34s %7.1f%% %8d" % (r["constant"], r["pct_scripts"], r["call_sites"]))


def catalog():
    c = j("catalog.json")
    lg = j("fetch_log.json") or {}
    if not c:
        return
    ok = [v for v in lg.values() if v.get("status") == "ok"]
    print("\n=== ACQUISITION ===")
    print("catalog (unique scripts): %d" % len(c))
    print("open-source (access=1)  : %d" % sum(1 for v in c.values() if v.get("access") == 1))
    print("editors' picks          : %d" % sum(1 for v in c.values() if v.get("editorsPick")))
    print("sources fetched ok      : %d" % len(ok))
    lic = {}
    for v in ok:
        lic[v.get("license")] = lic.get(v.get("license"), 0) + 1
    print("licences of fetched     :")
    for k, n in sorted(lic.items(), key=lambda x: -x[1]):
        print("    %-36s %d" % (k, n))


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("all", "acq"):
        catalog()
    if which in ("all", "engine"):
        engine()
    if which in ("all", "pres"):
        presentation()
    if which in ("all", "comp"):
        computation()
    if which in ("all", "const"):
        constants()
