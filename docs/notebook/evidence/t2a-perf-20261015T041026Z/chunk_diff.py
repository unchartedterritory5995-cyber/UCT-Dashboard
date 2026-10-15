"""Which chunks of the Notebook first-open closure changed between the base build and this tip.

    python chunk_diff.py <base dist> <tip dist> > bytes-chunk-diff.txt

Both closures are walked with tools/notebook_perf_budgets.py's own functions (the entry plus the static
imports of the budget's roots, from docs/notebook/perf-budgets.json), so the sums here are the budget's
sums. Chunks are paired by their file name without the content hash, because every chunk's hash changes
when the build does; two chunks with the same name (for example two `index`) are summed.
"""
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_budgets as B  # noqa: E402

spec = json.loads((REPO / "docs/notebook/perf-budgets.json").read_text(encoding="utf-8"))["bytes"]["notebook_first_open"]
NAME = re.compile(r"^(?P<n>.*)-[A-Za-z0-9_-]{8}\.js$")


def closure(dist: str) -> dict[str, int]:
    m = B.load_manifest(Path(dist))
    out: dict[str, int] = {}
    for k in B.static_closure(m, [B.ENTRY, *spec["roots"]]):
        f = m[k]["file"]
        if not f.endswith(".js"):
            continue
        base = f.rsplit("/", 1)[-1]
        mm = NAME.match(base)
        name = mm["n"] if mm else base
        out[name] = out.get(name, 0) + (Path(dist) / f).stat().st_size
    return out


base, tip = closure(sys.argv[1]), closure(sys.argv[2])
print(f"base closure: {len(base)} names, {sum(base.values()):,} B")
print(f"tip closure:  {len(tip)} names, {sum(tip.values()):,} B")
print(f"delta: {sum(tip.values()) - sum(base.values()):+,} B")
print("changed chunks, by name (delta, base -> tip):")
for n in sorted(set(base) | set(tip), key=lambda n: -abs(tip.get(n, 0) - base.get(n, 0))):
    d = tip.get(n, 0) - base.get(n, 0)
    if d:
        print(f"  {d:+8,}  {n}  {base.get(n, 0):,} -> {tip.get(n, 0):,}" + ("   (NEW in the closure)" if n not in base else ""))
