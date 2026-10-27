"""Builds the evidence README (and prints the report tables) from walk.json -- AFTER the raw evidence is written."""
import json, os, sys
from pathlib import Path

EVD = Path(sys.argv[1])
w = json.loads((EVD / "walk.json").read_text(encoding="utf-8"))
steps = w["steps"]
ORDER = ["W11.0", "W11.1", "W11.2", "W11.3", "W11.4", "W11.5", "W11.6", "W11.7", "W11.8", "W11.9", "W11.10", "W11.11",
         "W11.12", "W11.13", "W11.14", "W11.15", "W11.16", "W11.17", "FDEF", "FDEF2", "R1", "PUTPROBE"]
VPS = ["1200", "820", "390"]


def cell(vp, s):
    d = steps.get(f"{vp}-{s}")
    return d["verdict"] if d else "-"


table = ["| Step | 1200 | 820 | 390 |", "|---|---|---|---|"]
for s in ORDER:
    table.append(f"| {s} | " + " | ".join(cell(vp, s) for vp in VPS) + " |")

axe = {"serious": 0, "critical": 0, "by_id": {}}
cons = {"console": 0, "pageerror": 0, "http": 0, "requestfailed": 0}
for d in steps.values():
    for surf, m in d.get("metrics", {}).items():
        for k in ("axe_sheet", "axe_page"):
            for v in (m.get(k) or {}).get("violations") or []:
                if v["impact"] in ("serious", "critical"):
                    axe[v["impact"]] += 1
                    axe["by_id"].setdefault(v["id"], 0)
                    axe["by_id"][v["id"]] += 1
    for name, evs in d.get("events", {}).items():
        for e in evs:
            for k in cons:
                if k in e:
                    cons[k] += 1
out = {"table": "\n".join(table), "axe": axe, "events": cons, "defects": w["defects"]}
print(json.dumps(out, indent=1, ensure_ascii=False))
if len(sys.argv) > 2:
    Path(sys.argv[2]).write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
