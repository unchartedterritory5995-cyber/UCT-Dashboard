"""Slopes of a diag_curve.py report, per setting and round, with the budget tool's OWN fit
(`tools.notebook_perf_budgets._slope`). Usage: python diag_slopes.py report.json"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4]))
from tools.notebook_perf_budgets import _slope  # noqa: E402

r = json.load(open(sys.argv[1], encoding="utf-8"))
series: dict[tuple, list] = {}
for t in r["tiers"]:
    for tm in t["timings"]:
        for op, st in tm["ops"].items():
            series.setdefault((tm["setting"], tm["round"], op), []).append((t["n"], st["p50_ms"]))
print(f"{'setting':9} {'rd':>2}  {'op':38} {'fit':>6} {'last':>6}  p50 by tier")
for (s, rd, op), pts in sorted(series.items(), key=lambda kv: (kv[0][2], kv[0][0], kv[0][1])):
    if len(pts) < 2:
        continue
    fit = _slope(pts)
    (n1, a), (n2, b) = pts[-2], pts[-1]
    seg = (math.log(b) - math.log(a)) / (math.log(n2) - math.log(n1))
    flag = " <-- BREACH" if fit > 1.1 or seg > 1.3 else ""
    print(f"{s:9} {rd:>2}  {op:38} {fit:6.3f} {seg:6.3f}  {[p for _, p in pts]}{flag}")
