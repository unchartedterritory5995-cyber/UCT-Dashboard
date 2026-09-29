"""Objects-only checks over every step tree of chain/chain-through-wave5.jsonl (lane R1b).

    python objects.py > objects.log

1. IMPORT LINT (every step, booted or not): each `api.*` module imported by a module under `api/`
   (static `import`/`from ... import`, at any depth, AST) must resolve to a file in THAT tree. A
   name that does not resolve at the tip is not the chain's doing and is reported separately.
   This is what the wave-7 `daily_counters.py` rule exists for: TERM-078 and the Compass caps
   import it at module level, and a revert that deleted it would leave a server that cannot start.
2. The wave-5 rule's file (`tests/test_paywall_gate_free_tier.py`) in the wave-5 step's tree:
   parses, keeps TERM-089's rows in both tables, and holds none of wave 5's five editor-widget rows.
"""
from __future__ import annotations

import ast
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
REPO = HERE.parents[4]
TIP = "f4cec49be"


def git(*a, raw=False):
    r = subprocess.run(["git", "-C", str(REPO), *a], capture_output=True, check=True)
    return r.stdout if raw else r.stdout.decode("utf-8", errors="replace")


class Batch:
    """One `git cat-file --batch` for every blob read (thousands per tree)."""

    def __init__(self):
        self.p = subprocess.Popen(["git", "-C", str(REPO), "cat-file", "--batch"],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def read(self, spec: str) -> bytes | None:
        self.p.stdin.write(spec.encode() + bytes([10]))
        self.p.stdin.flush()
        head = self.p.stdout.readline().split()
        if len(head) < 3 or head[1] == b"missing":
            return None
        data = self.p.stdout.read(int(head[2]))
        self.p.stdout.read(1)
        return data


B = None


def unresolved(tree):
    """{(file, dotted name)} for every `api.*` import under api/ that names nothing in `tree`."""
    files = [l for l in git("ls-tree", "-r", "--name-only", tree, "--", "api").splitlines() if l.endswith(".py")]
    mods, pkgs = set(), set()
    for f in files:
        m = f[:-3].replace("/", ".")
        if m.endswith(".__init__"):
            pkgs.add(m[:-len(".__init__")])
        else:
            mods.add(m)
    bad = set()
    for f in files:
        try:
            t = ast.parse(B.read(f"{tree}:{f}"))
        except SyntaxError as e:
            bad.add((f, f"SYNTAX line {e.lineno}"))
            continue
        for n in ast.walk(t):
            if isinstance(n, ast.ImportFrom) and n.level == 0 and (n.module or "").split(".")[0] == "api":
                if n.module in mods:
                    continue                      # a module: the names are its attributes
                if n.module not in pkgs:
                    bad.add((f, n.module))
                    continue
                init = None
                for a in n.names:                 # from a PACKAGE: a submodule, or a name __init__ has
                    if f"{n.module}.{a.name}" in mods or f"{n.module}.{a.name}" in pkgs:
                        continue
                    if init is None:
                        init = (B.read(f"{tree}:{n.module.replace('.', '/')}/__init__.py") or b"").decode(
                            "utf-8", errors="replace")
                    if a.name not in init:
                        bad.add((f, f"{n.module}.{a.name}"))
            elif isinstance(n, ast.Import):
                for a in n.names:
                    if a.name.split(".")[0] == "api" and a.name not in mods and a.name not in pkgs:
                        bad.add((f, a.name))
    return bad


def main() -> int:
    global B
    B = Batch()
    rows = [json.loads(l) for l in (HERE.parent / "chain" / "chain-through-wave5.jsonl").read_text(
        encoding="utf-8").splitlines()]
    steps = [(d["key"], d["tree"]) for d in rows if "key" in d]
    tip_tree = git("rev-parse", f"{TIP}^{{tree}}").strip()
    base = unresolved(tip_tree)
    print(f"tip {TIP}: {len(base)} unresolved api imports already at the tip (not the chain's): "
          f"{sorted(base)[:8]}")
    worst = 0
    for key, tree in steps:
        new = sorted(unresolved(tree) - base)
        worst = max(worst, len(new))
        print(f"{key:16} tree {tree[:10]}: {len(new)} new unresolved api import(s) {new[:8]}")
    # 2. the wave-5 rule's file
    w5 = next(t for k, t in steps if k == "wave5")
    text = git("cat-file", "blob", f"{w5}:tests/test_paywall_gate_free_tier.py")
    ast.parse(text)
    keep = ['("GET", "/api/wire/archive")', '"/api/wire/archive":', '"/api/wire/archive/":']
    gone = ['"/api/ai-search/signal":', '"/api/fundamentals/earnings-table":', '"/api/news-catalysts/":']
    print("wave5 paywall test: parses; TERM-089 rows kept:", all(k in text for k in keep),
          "; wave-5 rows gone:", not any(g in text for g in gone))
    tip_text = git("cat-file", "blob", f"{TIP}:tests/test_paywall_gate_free_tier.py")
    print("   control at the tip: wave-5 rows present:", all(g in tip_text for g in gone))
    return 0 if worst == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
