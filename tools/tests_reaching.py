"""Which tests can REACH what I changed?

⭐⭐ WHY THIS EXISTS, MEASURED. In one session three separate things sat RED on
master without being noticed, and every one was found later by a sweep rather
than by the person who caused it:

  1. `StructureProvenance.jsx` read `evidence.lift_pp`, a field the route never
     sends — the panel rendered every measured lift as "not measured".
  2. Adding `GET /api/screener/structures` broke `test_scan_screener_auth.py`'s
     route-count pin, which exists precisely so an auth-relevant route cannot
     arrive unnoticed.
  3. A merged commit added `HISTORY_PREWARM_ENABLED` and tripped the
     feature-flag ledger.

In all three cases the tests for the files EDITED were green. The tests that
would have caught it live in files that merely IMPORT the edited module, often
several hops away, and nobody thinks to run those — because you cannot think of
what you cannot see.

⛔ THE ANSWER IS NOT "RUN EVERYTHING". The full backend suite is ~9,600 tests and
has to be chunked; running it after every edit is how a check stops being run at
all. This computes the REACHABLE set — usually a few dozen files — and prints the
exact pytest command.

    python tools/tests_reaching.py                 # tests reaching your working diff
    python tools/tests_reaching.py --against origin/master
    python tools/tests_reaching.py api/services/screener/base_catalog.py
    python tools/tests_reaching.py --show-path tests/test_x.py

⛔ THE GRAPH IS DERIVED BY AST, NEVER BY GREP. `lesson_probe_names_must_be_
derived_not_typed`: a grep for a module name finds strings in prose and misses
`from x import y as z`. Every edge here comes from an `Import`/`ImportFrom` node.

─────────────────────────────────────────────────────────────────────────────
WHAT IT CANNOT DO — read this before trusting a short answer.

1. IT FINDS TESTS THAT EXIST. Miss #1 above was not missed because the right
   test went unrun; it was missed because NO test pinned the frontend's field
   names against the payload until one was written afterwards. A reachability
   tool cannot report a rail nobody has written, and a small answer here is as
   likely to mean "thin coverage" as "small blast radius".

2. PYTHON ONLY. `app/` is the frontend and contributes no edges, so a change to
   a `.jsx` file traces nothing — even though a Python rail may read that file
   (`test_structure_panel_reads_the_real_ledger.py` does exactly that). For
   frontend work, run the vitest surface as well.

3. IMPORT-TIME EDGES ONLY. A module reached through a registry, an entry point,
   a scheduler string or `importlib` is invisible here. The SWEEP-rail rule
   below is the mitigation for the biggest such class, not a general fix.
"""
from __future__ import annotations

import argparse
import ast
import collections
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
#: Python lives in these roots; `app/` is the frontend and holds none.
ROOTS = ("api", "tools", "scripts", "services", "tests")


def _modname(path: pathlib.Path) -> str | None:
    """`api/services/x.py` -> `api.services.x`. None for anything outside ROOTS."""
    try:
        rel = path.resolve().relative_to(ROOT)
    except ValueError:
        return None
    parts = list(rel.parts)
    if not parts or not parts[-1].endswith(".py"):
        return None
    parts[-1] = parts[-1][:-3]
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts) if parts else None


def _py_files():
    for r in ROOTS:
        base = ROOT / r
        if base.exists():
            for f in sorted(base.rglob("*.py")):
                if "__pycache__" not in f.parts:
                    yield f
    for f in sorted(ROOT.glob("*.py")):
        yield f


def _imports_of(path: pathlib.Path) -> set[str]:
    """Every module this file imports, as dotted names.

    Relative imports are resolved against the file's own package so
    `from .x import y` inside `api/services/` becomes `api.services.x`.
    """
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (SyntaxError, UnicodeDecodeError):
        return set()
    own = _modname(path) or ""
    pkg = own.rsplit(".", 1)[0] if "." in own else ""
    out: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                out.add(a.name)
        elif isinstance(node, ast.ImportFrom):
            if node.level:                      # relative
                base = pkg.split(".")
                base = base[:len(base) - (node.level - 1)] if node.level > 1 else base
                mod = ".".join([p for p in base if p] + ([node.module] if node.module else []))
            else:
                mod = node.module or ""
            if not mod:
                continue
            out.add(mod)
            for a in node.names:                # `from pkg import submodule`
                out.add(f"{mod}.{a.name}")
    return out


def build_graph():
    """`importers[module] = {modules that import it}` plus a module->path map."""
    importers: dict[str, set[str]] = collections.defaultdict(set)
    paths: dict[str, pathlib.Path] = {}
    for f in _py_files():
        m = _modname(f)
        if not m:
            continue
        paths[m] = f
        for imp in _imports_of(f):
            importers[imp].add(m)
    return importers, paths


def changed_files(against: str | None) -> list[pathlib.Path]:
    cmd = ["git", "diff", "--name-only"]
    cmd += [f"{against}...HEAD"] if against else ["HEAD"]
    try:
        out = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True,
                             check=True).stdout
    except subprocess.CalledProcessError:
        return []
    names = [ROOT / n for n in out.split("\n") if n.strip().endswith(".py")]
    if not against:
        extra = subprocess.run(["git", "diff", "--name-only", "--cached"],
                               cwd=ROOT, capture_output=True, text=True).stdout
        names += [ROOT / n for n in extra.split("\n") if n.strip().endswith(".py")]
    return sorted({p for p in names if p.exists()})


#: Calls that mean "this module reads the source tree itself", so nothing it
#: checks shows up as an import edge.
_SWEEP_CALLS = ("rglob(", "iglob(", "glob.glob(", "os.walk(", ".glob(")


def sweep_rails(paths: dict[str, pathlib.Path]) -> set[str]:
    """Test modules that walk the FILESYSTEM rather than importing their subject.

    ⛔⛔ THE BLIND SPOT THAT WOULD HAVE MADE THIS TOOL WORSE THAN USELESS.
    `test_feature_flag_ledger.py` does not import `history_prewarm` — it reads
    `feature_flag_index`, which AST-scans `api/**` for env gates. So the import
    graph says the flag ledger is unreachable from the module that broke it,
    which is exactly backwards: a sweep rail can reach EVERY file, and those are
    the rails that caught two of this session's three misses.

    Measured 2026-08-31: this finds the flag ledger, the shadow-definition
    sweep, the groundedness rail and the reachability sweep — the rails whose
    whole job is to see what an import graph cannot.
    """
    out: set[str] = set()
    for mod, path in paths.items():
        if not (mod.startswith("tests.") or path.name.startswith("test_")):
            continue
        srcs = [path]
        for imp in _imports_of(path):           # one hop: the helper it delegates to
            if imp in paths:
                srcs.append(paths[imp])
        for s in srcs:
            try:
                body = s.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            if any(c in body for c in _SWEEP_CALLS):
                out.add(mod)
                break
    return out


def reaching(seeds: list[pathlib.Path], importers, paths, trace: str | None = None):
    """Every test module that transitively imports any seed.

    ⛔ A BREADTH-FIRST WALK OVER THE REVERSED GRAPH, not a one-hop check. The
    route-count pin that this tool exists for is two hops from the router it
    guards; a direct-importers-only answer would have missed it.
    """
    seen: set[str] = set()
    parent: dict[str, str] = {}
    queue = collections.deque()
    for s in seeds:
        m = _modname(s)
        if m:
            seen.add(m)
            queue.append(m)
    while queue:
        cur = queue.popleft()
        for imp in importers.get(cur, ()):
            if imp not in seen:
                seen.add(imp)
                parent[imp] = cur
                queue.append(imp)
    tests = {m for m in seen
             if m.startswith("tests.") or m.split(".")[-1].startswith("test_")}
    # A sweep rail reads the source tree, so it can reach any file and no import
    # edge will ever say so. Always included — see `sweep_rails`.
    tests = sorted(tests | sweep_rails(paths))
    if trace and trace in parent:
        chain, cur = [trace], trace
        while cur in parent:
            cur = parent[cur]
            chain.append(cur)
        print("  path: " + " <- ".join(chain))
    return tests, paths


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("files", nargs="*", help="files to trace (default: your diff)")
    ap.add_argument("--against", help="diff against this ref instead of the worktree")
    ap.add_argument("--show-path", help="print WHY this test module is reachable")
    ap.add_argument("--quiet", action="store_true", help="print only the command")
    args = ap.parse_args()

    seeds = ([ROOT / f for f in args.files] if args.files
             else changed_files(args.against))
    seeds = [p for p in seeds if p.exists() and p.suffix == ".py"]
    if not seeds:
        print("no changed Python files — nothing to trace "
              "(frontend changes are not in this graph)")
        return 0

    importers, paths = build_graph()
    trace = None
    if args.show_path:
        trace = _modname(ROOT / args.show_path) or args.show_path
    tests, paths = reaching(seeds, importers, paths, trace)

    if not args.quiet:
        print(f"changed ({len(seeds)}):")
        for s in seeds:
            print(f"  {s.relative_to(ROOT)}")
        # ⛔ NON-VACUITY, PRINTED. A graph that failed to build produces an empty
        # answer that looks exactly like "nothing reaches this".
        print(f"\ngraph: {len(paths)} modules, "
              f"{sum(len(v) for v in importers.values())} import edges")
        sw = sweep_rails(paths)
        print(f"tests reaching them: {len(tests)}  "
              f"({len(sw)} are filesystem SWEEP rails, always included — they "
              f"read the source tree, so no import edge can show what they "
              f"see)\n")

    files = sorted({str(paths[t].relative_to(ROOT)).replace('\\', '/')
                    for t in tests if t in paths})
    if not files:
        print("# no test module imports these — that is itself worth a look")
        return 0
    print("python -m pytest " + " ".join(files) + " -q")
    return 0


if __name__ == "__main__":
    sys.exit(main())
