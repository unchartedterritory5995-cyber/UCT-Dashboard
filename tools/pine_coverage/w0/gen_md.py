# -*- coding: utf-8 -*-
"""Render the W0 tables (markdown fragments) from coverage-map.json and the targets JSON.

  python tools/pine_coverage/w0/gen_md.py --map docs/pine/coverage-map.json \
      --old-map <previous coverage-map.json> --targets docs/pine/coverage-targets-<date>.json \
      --out <scratch>/tables.md            # the wall lists go to <scratch>/tables-walls.md

Every number in a fragment is read from those JSON files: the COVERAGE-MAP-<date>.md document is these
fragments pasted under its prose headings."""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ap = argparse.ArgumentParser(description="W0 markdown fragments (see the module docstring)")
ap.add_argument("--map", required=True, help="coverage-map.json written by coverage_map.py")
ap.add_argument("--old-map", required=True, help="the previous coverage-map.json (the comparison columns)")
ap.add_argument("--targets", required=True, help="the JSON written by targets.py")
ap.add_argument("--out", required=True, help="the fragments file, *.md; the wall lists go to *-walls.md beside it")
a = ap.parse_args()
TARGETS_NAME = os.path.basename(a.targets)   # `a` is rebound by loops below
if not a.out.endswith(".md"):
    ap.error("--out must end in .md (the wall lists are written to <out>-walls.md)")
out_p = a.out
d = json.load(open(a.map, encoding="utf-8"))
o = json.load(open(a.old_map, encoding="utf-8"))
t = json.load(open(a.targets, encoding="utf-8"))
T = t["titles"]
L = []
WL = {"W1": "names and robustness", "W3": "drawing-object completeness", "W4": "runtime lane finished (runtime walls)", "W6": "collections, UDTs, methods", "W7": "request.*", "W8": "libraries (import)", "W9": "strategy tester", "other": "output contract (script offers nothing a pane carries)"}
w = L.append


def pct(n, N):
    return "%.1f%%" % (100.0 * n / N)


def names(keys, cap=None):
    ks = list(keys)
    show = ks if cap is None else ks[:cap]
    s = ", ".join("`%s`" % k.split(":", 1)[1] if ":" in k else k for k in show)
    return s + (" ... (+%d)" % (len(ks) - cap) if cap is not None and len(ks) > cap else "")


h, oh = d["headline"], o["headline"]
ro, oro = d["runtimeOn"], o["runtimeOn"]
N = h["sample"]
w("## HEADLINE")
w("| measure | %s (`%s`) | %s (`%s`) | change |" % (o.get("measuredOn") or "previous", o["masterSha"], d.get("measuredOn") or "this run", d["masterSha"]))
w("|---|---:|---:|---:|")
rows = [
    ("Transfer fully, production lane", oh["transfer"], h["transfer"]),
    ("Attach in any form, production lane", oh["attachedAnyForm"], h["attachedAnyForm"]),
    ("Step-0 runtime counterfactual (production census)", oh["runtimeCounterfactualTransfer"], h["runtimeCounterfactualTransfer"]),
    ("Transfer, RUNTIME-ON lane (pane on at every peel step)", oro["transfer"], ro["transfer"]),
    ("Runtime lane attaches (runtime-on)", oro["runtimeAttached"], ro["runtimeAttached"]),
    ("Transfer fully AND a TradingView capture MATCHes", o["parity"]["verifiedTransfer"], d["parity"]["verifiedTransfer"]),
    ("TradingView reference examples that transfer (of %d)" % d["examples"]["total"], o["examples"]["transfer"], d["examples"]["transfer"]),
]
for lab, a, b in rows:
    D = d["examples"]["total"] if "examples" in lab else N
    w("| %s | %d (%s) | **%d (%s)** | %+d |" % (lab, a, pct(a, D), b, pct(b, D), b - a))
w("")
w("Vendor harness, production lane: %s (prev %s). Runtime-on: %s; changed vs production: %s." % (
    json.dumps(d["parity"]["verdicts"]), json.dumps(o["parity"]["verdicts"]),
    json.dumps((ro.get("parity") or {}).get("verdicts")), json.dumps((ro.get("parity") or {}).get("changed"))))
w("")
w("Runtime-on vs production: +%d added, -%d lost. Lost: %s" % (len(ro["added"]), len(ro["lost"]), names(ro["lost"]) or "none"))
w("")
w("Gained since 10-31 (production): %s" % (names(sorted({s["key"] for s in d["scripts"] if s["clean"]} - {s["key"] for s in o["scripts"] if s["clean"]})) or "none"))
w("")
w("Lost since 10-31 (production): %s" % (names(sorted({s["key"] for s in o["scripts"] if s["clean"]} - {s["key"] for s in d["scripts"] if s["clean"]})) or "none"))
w("")
w("### by population / version / declaration")
w("| slice | scripts | transfer | % | runtime-on |")
w("|---|---:|---:|---:|---:|")
for k, v in h["byPopulation"].items():
    w("| %s | %d | %d | %s | %d |" % (k, v["scripts"], v["transfer"], v["transferPct"], ro["byPopulation"][k]["transfer"]))
for k, v in h["byVersion"].items():
    w("| Pine %s | %d | %d | %s | |" % (k, v["scripts"], v["transfer"], v["pct"]))
for k, v in h["byDeclaration"].items():
    w("| `%s()` | %d | %d | %s | |" % (k, v["scripts"], v["transfer"], v["pct"]))
w("")
ords, oords = ro["runtimeAttachedOrderStrategies"], oro.get("runtimeAttachedOrderStrategies") or []
w("Order-placing strategies that attach on the runtime lane: %d (%d on 10-31). New since 10-31: %s; already on 10-31: %s. "
  "They never count as transfers (no broker simulation, W9)." % (
      len(ords), len(oords), names([k for k in ords if k not in oords]) or "none", names([k for k in ords if k in oords]) or "none"))
w("")

w("## TOP WALLS (production)")
w("| # | wall | capability | wave | sole | blocks | prev sole/blocks |")
w("|---:|---|---|---|---:|---:|---|")
ob = {b["blocker"]: b for b in o["blockers"]}
from targets_waves import PROD_WAVE  # noqa: E402
for i, b in enumerate(d["blockers"][:40], 1):
    p = ob.get(b["blocker"])
    w("| %d | %s | %s | %s | %d | %d | %s |" % (i, b["blocker"].replace("|", "\\|"), b["capability"], PROD_WAVE.get(b["capability"], "?"),
                                               b["soleBlockerOf"], b["scriptsBlocked"], "%d/%d" % (p["soleBlockerOf"], p["scriptsBlocked"]) if p else "new"))
w("")
w("## GREEDY")
w("| step | capability | wave | blocks | unblocks | firm | cumulative | prev unblocks |")
w("|---:|---|---|---:|---:|---:|---:|---:|")
og = {g["capability"]: g for g in o["capabilities"]["greedyRoadmap"]}
for i, g in enumerate(d["capabilities"]["greedyRoadmap"], 1):
    w("| %d | %s | %s | %d | %d | %d | %d (%s%%) | %s |" % (i, g["capability"], PROD_WAVE.get(g["capability"], "?"), g["touches"], g["unblocks"],
                                                          g["unblocksFullyEnumerated"], g["cumulativeTransfer"], g["cumulativePct"],
                                                          og.get(g["capability"], {}).get("unblocks", "-")))
w("")
w("## RUNTIME WALLS")
w("| # | runtime-lane wall | wave | scripts (touches) |")
w("|---:|---|---|---:|")
for i, (k, v) in enumerate(list(t["runtimeWalls"].items())[:40], 1):
    w("| %d | `%s` | %s | %d |" % (i, k, t["runtimeWallWave"][k], len(v)))
w("")
rt_by = ro["walls"]["byScript"]
missing_name = {k for k, ws in rt_by.items() if {"pine:builtin", "pine:function"} & set(ws)}
w1 = t["runtimeWaves"]["W1"]["blocks"]
w1_other = sorted({g for k in w1 if k not in missing_name for g in rt_by[k] if t["runtimeWallWave"].get(g) == "W1"})
w("**Caveat on `pine:builtin` / `pine:function` in this lane (W1 count).** %d runtime-on scripts carry a missing-name "
  "wall (`pine:builtin` or `pine:function` in `runtimeOn.walls.byScript`); the runtime-on W1 count of %d in section 6 "
  "also takes the %d whose only W1 wall is %s." % (
      len(missing_name), len(w1), len(w1) - len(missing_name), ", ".join("`%s`" % g for g in w1_other) or "none"))
w("")
w("## WAVE GREEDY")
w("| step | production lane: wave | unblocks | cumulative | runtime-on lane: wave | unblocks | cumulative |")
w("|---:|---|---:|---:|---|---:|---:|")
gp, gr = t["waveGreedy"]["production"], t["waveGreedy"]["runtime-on"]
for i in range(max(len(gp), len(gr))):
    a = gp[i] if i < len(gp) else None
    b = gr[i] if i < len(gr) else None
    w("| %d | %s | %s | %s | %s | %s | %s |" % (i + 1, a and a["wave"] or "", a and a["unblocks"] or "", a and "%d (%s)" % (a["cumulative"], pct(a["cumulative"], N)) or "",
                                            b and b["wave"] or "", b and b["unblocks"] or "", b and "%d (%s)" % (b["cumulative"], pct(b["cumulative"], N)) or ""))
w("")
w("## WAVES")
w("| wave | prod: blocks | prod: only this wave left (upper) | prod: firm | runtime-on: blocks | runtime-on: only this wave left |")
w("|---|---:|---:|---:|---:|---:|")
for wv in ("W1", "W3", "W4", "W6", "W7", "W8", "W9", "other"):
    p = t["prodWaves"].get(wv, {"blocks": [], "onlyThisWave": [], "firm": []})
    r = t["runtimeWaves"].get(wv, {"blocks": [], "onlyThisWave": []})
    w("| %s | %d | %d | %d | %d | %d |" % (wv, len(p["blocks"]), len(p["onlyThisWave"]), len(p["firm"]), len(r["blocks"]), len(r["onlyThisWave"])))
w("")
for wv in ("W1", "W3", "W4", "W6", "W7", "W8", "W9", "other"):
    p = t["prodWaves"].get(wv, {"blocks": [], "onlyThisWave": [], "firm": []})
    r = t["runtimeWaves"].get(wv, {"blocks": [], "onlyThisWave": []})
    w("### %s %s" % (wv, WL[wv]))
    w("- **production, only this wave left (%d; firm marked \\*):** %s" % (
        len(p["onlyThisWave"]), ", ".join("`%s`%s" % (k.split(":", 1)[1], "\\*" if k in p["firm"] else "") for k in p["onlyThisWave"]) or "none"))
    w("- **runtime-on, only this wave left (%d):** %s" % (len(r["onlyThisWave"]), names(r["onlyThisWave"]) or "none"))
    w("- production blocks %d, runtime-on blocks %d: full lists in `%s` (`prodWaves.%s.blocks`, `runtimeWaves.%s.blocks`)." % (len(p["blocks"]), len(r["blocks"]), TARGETS_NAME, wv, wv))
    w("")
w("## CAPTURES")
vp, vr = t["verifiedByLane"]["production"], t["verifiedByLane"]["runtime-on"]
both = [k for k in vr["verified"] if k in vp["verified"]]
w("%d of the %d production transfers have a capture that MATCHes in the production harness run. With the runtime pane "
  "on, %d of the %d runtime-on transfers have one that MATCHes in the runtime-on run: %s, plus %d that transfer only "
  "with the pane on (%s)." % (
      len(vp["verified"]), vp["transfer"], len(vr["verified"]), vr["transfer"],
      "the same %d" % len(both) if len(both) == len(vp["verified"]) else "%d of those" % len(both),
      len(vr["verifiedOnlyInThisLane"]), names(vr["verifiedOnlyInThisLane"]) or "none"))
w("Every list below judges a script in its own lane: a production transfer by the production run, a script that "
  "transfers only with the runtime pane on by the runtime-on run. Three lists, in the order to capture:")
w("")


def ticks(xs):
    return ", ".join("`%s`" % x for x in xs)


def n_are(n):
    return "%d is" % n if n == 1 else "%d are" % n


U, cov, picks = t["unverifiedItems"], t["unverifiedItemsCoveredByGreedy"], t["captureGreedy"]
rto, nc = t["unverifiedItemsMatchingOnlyInRuntimeOn"], t["unverifiedItemsNotCovered"]
rt_lane, div = t["unverifiedItemsCoveredRuntimeLaneOnly"], t["captureExcludedDiverging"]
n_prod = sum(1 for c in picks if c["lane"] == "production")
n_rt = len(picks) - n_prod
rest = []
if nc["ungraded"]:
    rest.append("%s ungraded names (`strategy.*`, `alert*`, `log.*`, `runtime.*`: the harness never grades them)" % n_are(len(nc["ungraded"])))
if nc["inNoTransferringScript"]:
    rest.append("%s used by no transferring sample script (they translate only in TradingView's own reference examples)"
                % n_are(len(nc["inNoTransferringScript"])))
if nc["onlyInScriptsThatAlreadyMatch"]:
    rest.append("%s used only by transferring scripts that already MATCH in their own lane (%s)" % (
        n_are(len(nc["onlyInScriptsThatAlreadyMatch"])),
        "; ".join("`%s`: %s" % (n, names(ks)) for n, ks in nc["onlyInScriptsThatAlreadyMatch"].items())))
if nc["onlyInScriptsWhoseCaptureDiverges"]:
    rest.append("%s used only by scripts whose existing capture already DIVERGEs (%s): capturing them again on the same RDDT/SPY daily "
                "setup cannot verify the item, the divergence is the lead (7.2)" % (
                    n_are(len(nc["onlyInScriptsWhoseCaptureDiverges"])),
                    "; ".join("`%s`: %s" % (n, names(ks)) for n, ks in nc["onlyInScriptsWhoseCaptureDiverges"].items())))
if nc["onlyInRuntimeOnTransfers"]:
    rest.append("%s used only by runtime-on transfers, so a capture grades the runtime lane and not the production count (%s)" % (
        n_are(len(nc["onlyInRuntimeOnTransfers"])), ticks(nc["onlyInRuntimeOnTransfers"])))
w("**7.1 Greedy over unverified items.** %d Pine items translate today but have **no MATCH capture in the production "
  "harness run** (`supported-unverified`).%s Each row is a transferring script (either lane) with no MATCH in its own "
  "lane yet and **no DIVERGE capture of its own** (%d such scripts are left out: %s), that verifies the most "
  "still-unverified items, then the next. **%d production-lane captures cover %d of the %d.** %s Of the other %d, %s. "
  "Capture on the dedicated rig, RDDT and SPY daily, per `docs/pine/capture-procedure.md`." % (
      U, (" %d of them %s used by a capture that MATCHes only in the runtime-on run (%s): that grades the runtime lane's "
          "handling of them, not the translator's." % (len(rto), "is" if len(rto) == 1 else "are", ticks(rto))) if rto else "",
      len(div), "; ".join("`%s` (%s)" % (k.split(":", 1)[1], ", ".join("`%s`" % x for x in v)) for k, v in div.items()) or "none",
      n_prod, cov, U,
      ("The %d runtime-on rows below credit the RUNTIME lane only (%d item%s, %s): a runtime-on capture grades the runtime lane's "
       "handling, so none of it counts in the production figure." % (n_rt, len(rt_lane), "" if len(rt_lane) == 1 else "s", ticks(rt_lane) or "none")
       if n_rt else "No runtime-on row is in the list."),
      U - cov, "; ".join(rest) or "none"))
w("")
w("| # | script | lane | existing capture (own lane) | items it would verify first |")
w("|---:|---|---|---|---|")
for i, c in enumerate(picks, 1):
    w("| %d | `%s` (%s) | %s | %s | %s |" % (i, c["key"], (c["title"] or "").replace("|", "/"), c["lane"], c["existingCapture"] or "none",
                                          ", ".join("`%s`" % x for x in c["verifiesNewItems"])
                                          + (" (runtime lane only)" if c["lane"] == "runtime-on" else "")))
w("")
PV = {s["key"]: s["vendorVerdict"] for s in d["scripts"]}


def regrade(lane):
    return ", ".join("`%s` (%s%s)" % (c["key"].split(":", 1)[1], c["verdict"],
                                      "" if PV[c["key"]] == c["verdict"] else ", production run %s" % PV[c["key"]])
                     for c in t["captureRegradeTransferring"] if c["lane"] == lane) or "none"


w("**7.2 Transferring scripts whose existing capture is INCONCLUSIVE or DIVERGE in their own lane** (re-capture or "
  "re-grade first; a DIVERGE on a transferring script is a correctness lead). Production lane: %s. Runtime-on lane: %s." % (
      regrade("production"), regrade("runtime-on")))
w("")
w("**7.3 Most popular transferring scripts with no capture at all** (by TradingView boosts; each is one capture from a MATCH that members will actually load): %s" % ", ".join(
    "`%s`%s" % (c["key"].split(":", 1)[1], " (agree %s)" % c["agree"] if c["agree"] else "") for c in t["capturePopularUncaptured"][:20]))
open(out_p, "w", encoding="utf-8", newline="\n").write("\n".join(L) + "\n")
print("wrote", out_p, len(L))

# ---- exact per-wall lists (top 15 each lane)
X = []
x = X.append
x("## WALL LISTS")
x("### Production lane, top 15 walls")
for b in d["blockers"][:15]:
    ks = t["prodWalls"].get(b["blocker"], [])
    sole = [k for k in ks if len(next(s for s in d["scripts"] if s["key"] == k)["walls"]) == 1]
    x("<details><summary><b>%s</b> (%s): blocks %d, sole %d</summary>\n" % (b["blocker"], b["capability"], len(ks), len(sole)))
    x("Sole (this wall alone): %s\n" % (names(sole) or "none"))
    x("All: %s\n" % names(ks))
    x("</details>\n")
x("### Runtime-on lane, top 15 walls")
for k, ks in list(t["runtimeWalls"].items())[:15]:
    x("<details><summary><b>%s</b> (%s): %d scripts</summary>\n" % (k, t["runtimeWallWave"][k], len(ks)))
    x("%s\n" % names(ks))
    x("</details>\n")
open(out_p[:-3] + "-walls.md", "w", encoding="utf-8", newline="\n").write("\n".join(X) + "\n")
