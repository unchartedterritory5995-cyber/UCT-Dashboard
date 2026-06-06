"""One-shot: snap single-value border-radius px to the radius token scale in the
Admin + Breadth CSS (the files with the 3/4/5/6/8px spread).

Scale: sm=4 md=6 lg=8 xl=12. Snaps 3-12px to the nearest token (<=2px shift,
imperceptible). Leaves 0/1/2px hairlines, >12px (distinct large radii), 50%,
999px pills, and multi-value shorthands (e.g. '8px 8px 0 0') untouched —
the regex requires the value to be immediately followed by ';'.
"""
import os
import re

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "src")
TARGETS = [
    "pages/Breadth.module.css",
    "pages/BreadthCharts.module.css",
    "pages/CotData.module.css",
    "pages/Admin.module.css",
    "pages/admin/ChartHealth.module.css",
    "pages/admin/PatternAdmin.module.css",
    "pages/admin/LandingAnalytics.module.css",
]

def token(n):
    if n <= 4: return "var(--radius-sm)"
    if n <= 6: return "var(--radius-md)"
    if n <= 8: return "var(--radius-lg)"
    return "var(--radius-xl)"  # 9..12

# border-radius / corner-specific, single value (immediately followed by ;)
PAT = re.compile(r"(border(?:-(?:top|bottom)-(?:left|right))?-radius:\s*)(\d+)px(\s*;)")

def repl(m):
    n = int(m.group(2))
    if n < 3 or n > 12:
        return m.group(0)  # leave hairlines + large/pill radii
    return f"{m.group(1)}{token(n)}{m.group(3)}"

total = 0
for rel in TARGETS:
    p = os.path.join(ROOT, rel.replace("/", os.sep))
    if not os.path.exists(p):
        print(f"  (skip, not found) {rel}")
        continue
    with open(p, encoding="utf-8") as f:
        src = f.read()
    new, n = PAT.subn(repl, src)
    # subn counts all matches incl. no-op (out-of-range) ones; recount real changes
    real = sum(1 for m in PAT.finditer(src) if 3 <= int(m.group(2)) <= 12)
    if real:
        with open(p, "w", encoding="utf-8") as f:
            f.write(new)
        total += real
        print(f"  {real:3d}  {rel}")

print(f"snapped {total} border-radius values to tokens")
