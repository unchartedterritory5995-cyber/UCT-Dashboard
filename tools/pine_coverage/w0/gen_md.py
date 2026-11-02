# -*- coding: utf-8 -*-
"""Render the W0 tables (markdown fragments) from coverage-map.json + targets.json."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

new_p, old_p, tgt_p, out_p = sys.argv[1:5]
d = json.load(open(new_p, encoding="utf-8"))
o = json.load(open(old_p, encoding="utf-8"))
t = json.load(open(tgt_p, encoding="utf-8"))
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
w("| measure | 2026-10-31 (`%s`) | 2026-11-02 (`%s`) | change |" % (o["masterSha"], d["masterSha"]))
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
    w("- production blocks %d, runtime-on blocks %d: full lists in `coverage-targets-2026-11-02.json` (`prodWaves.%s.blocks`, `runtimeWaves.%s.blocks`)." % (len(p["blocks"]), len(r["blocks"]), wv, wv))
    w("")
w("## CAPTURES")
w("| # | script | lane | existing capture | items it would verify first |")
w("|---:|---|---|---|---|")
for i, c in enumerate(t["captureGreedy"], 1):
    w("| %d | `%s` (%s) | %s | %s | %s |" % (i, c["key"], (c["title"] or "").replace("|", "/"), c["lane"], c["existingCapture"] or "none",
                                          ", ".join("`%s`" % x for x in c["verifiesNewItems"])))
w("")
w("**7.2 Transferring scripts whose existing capture is INCONCLUSIVE or DIVERGE** (re-capture or re-grade first; a DIVERGE on a clean script is a correctness lead): %s" % (
    ", ".join("`%s` (%s)" % (c["key"].split(":", 1)[1], c["verdict"]) for c in t["captureRegradeTransferring"]) or "none"))
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
open(out_p.replace(".md", "-walls.md"), "w", encoding="utf-8", newline="\n").write("\n".join(X) + "\n")
