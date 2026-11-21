"""Which tests/test_*.py files import the Pine engine, and which pine-heavy pytest leg runs each of them.

    python tools/pine_test_census.py --list          # the census: Pine-importing files no glob leg names
    python tools/pine_test_census.py --shard 1/2     # one shard of it, space-separated (a pytest leg's arguments)
    python tools/pine_test_census.py --plan          # every shard, its files and recorded seconds
    python tools/pine_test_census.py --root DIR ...  # census another checkout (CI: the ref under test)

WHY (2026-11-20). 99 test files that import the Pine engine ran in no pine-heavy leg: 67 of them in NO CI lane at
all, 32 only in lanes that do not trigger on an engine change. Five were red on master for days with every check
green (#1888's opts spread twice, #2095's short-series read, the bar store's new shapes, the opening range's
fixture), because pine heavy's pytest legs ran `tests/test_ast_*.py` and `tests/test_pine_*.py` and little else. The census legs (`pine-consumers-N` in .github/workflows/pine-heavy.yml)
run what this prints. A new file that imports the engine joins a leg the day it lands: nothing to add by hand.

WHAT "IMPORTS THE PINE ENGINE" MEANS (static, over the AST; code, never prose): a test file whose own `import` or
`from ... import` names a module that is
  * `api.services.ast_*` or `api.services.pine_*` (the interpreter, its table, lint, budget, freshness; the compare
    rule, the runtime client and codec, the capabilities),
  * `api.routers.<name containing "pine">`, or
  * `services.pine_runtime` (or below it).
NOT seen (a static scan's limits, stated): an `importlib.import_module("api.services.ast_...")` string, an import
reached only through a helper module. tests/test_ci_pine_heavy.py derives the same set its own way and fails when a
file is in no leg.

THE CENSUS IS what that definition selects, minus every file a `tests:` glob leg of pine-heavy.yml's pytest job
already names (ast-twins, pine-twins): each file runs in exactly one leg.

SHARDS are balanced by recorded time (tools/pytest_shard_timings.json, `files_ms`; a file with no record counts
DEFAULT_MS), longest first onto the lightest shard, ties by name: the same input gives the same plan on every runner.

Exit: 0 printed · 2 the census is empty or the request is malformed ("nothing found" is never a pass).
Standard library + PyYAML.
"""
from __future__ import annotations

import argparse
import ast
import glob
import json
import pathlib
import sys
import warnings

import yaml

WORKFLOW = pathlib.Path(".github") / "workflows" / "pine-heavy.yml"
TIMINGS = pathlib.Path("tools") / "pytest_shard_timings.json"
#: a file with no recorded time: about the median of the census's recorded files (2026-11-20)
DEFAULT_MS = 3000


def is_engine_module(name: str) -> bool:
    """Is the dotted module `name` Pine engine code (see the module docstring)?"""
    parts = name.split(".")
    if parts[:2] == ["api", "services"] and len(parts) >= 3:
        return parts[2].startswith(("ast_", "pine_"))
    if parts[:2] == ["api", "routers"] and len(parts) >= 3:
        return "pine" in parts[2]
    return parts[:2] == ["services", "pine_runtime"]


def engine_imports(path: pathlib.Path) -> list[str]:
    """The Pine engine modules `path` imports, by dotted name (sorted, unique)."""
    text = path.read_text(encoding="utf-8")
    if "ast_" not in text and "pine" not in text:
        return []                    # every engine module's dotted name holds one of the two: nothing to parse
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SyntaxWarning)       # a test's docstring escapes are not this scan's business
        tree = ast.parse(text, filename=str(path))
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found |= {a.name for a in node.names if is_engine_module(a.name)}
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            if is_engine_module(node.module):
                found.add(node.module)
            found |= {f"{node.module}.{a.name}" for a in node.names if is_engine_module(f"{node.module}.{a.name}")}
    return sorted(found)


def glob_leg_files(root: pathlib.Path) -> set[str]:
    """Every file a `tests:` glob leg of pine-heavy.yml's pytest job names (repo-relative, posix)."""
    doc = yaml.safe_load((root / WORKFLOW).read_text(encoding="utf-8"))
    legs = doc["jobs"]["pytest"]["strategy"]["matrix"]["include"]
    out: set[str] = set()
    for leg in legs:
        for pat in str(leg.get("tests") or "").split():
            out |= {pathlib.Path(p).relative_to(root).as_posix() for p in glob.glob(str(root / pat))}
    return out


def census(root: pathlib.Path) -> list[str]:
    """The Pine-importing test files no glob leg names, sorted."""
    named = glob_leg_files(root)
    out = []
    for p in sorted((root / "tests").glob("test_*.py")):
        rel = p.relative_to(root).as_posix()
        if rel not in named and engine_imports(p):
            out.append(rel)
    return out


def recorded_ms(root: pathlib.Path) -> dict[str, int]:
    try:
        return json.loads((root / TIMINGS).read_text(encoding="utf-8")).get("files_ms") or {}
    except (OSError, ValueError):
        return {}


def plan(files: list[str], n: int, ms: dict[str, int]) -> list[list[str]]:
    """`files` in `n` shards balanced by recorded time; each shard sorted by name."""
    shards: list[list[str]] = [[] for _ in range(n)]
    load = [0] * n
    for f in sorted(files, key=lambda f: (-int(ms.get(f) or DEFAULT_MS), f)):
        i = min(range(n), key=lambda k: (load[k], k))
        shards[i].append(f)
        load[i] += int(ms.get(f) or DEFAULT_MS)
    return [sorted(s) for s in shards]


def parse_shard(spec: str) -> tuple[int, int]:
    k, _, n = spec.partition("/")
    k_i, n_i = int(k), int(n)
    if not (1 <= k_i <= n_i):
        raise ValueError(spec)
    return k_i, n_i


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", default=".", help="the checkout to census (default: the current directory)")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--list", action="store_true")
    g.add_argument("--shard", metavar="K/N")
    g.add_argument("--plan", metavar="N", type=int)
    a = ap.parse_args(argv)
    root = pathlib.Path(a.root).resolve()
    files = census(root)
    if not files:
        print("[pine-census] the census is EMPTY: a scan that finds nothing is a failed scan", file=sys.stderr)
        return 2
    if a.list:
        print("\n".join(files))
        return 0
    ms = recorded_ms(root)
    if a.shard:
        try:
            k, n = parse_shard(a.shard)
        except ValueError:
            print(f"[pine-census] --shard wants K/N with 1 <= K <= N, got {a.shard!r}", file=sys.stderr)
            return 2
        shard = plan(files, n, ms)[k - 1]
        if not shard:
            print(f"[pine-census] shard {a.shard} is empty ({len(files)} files over {n} shards)", file=sys.stderr)
            return 2
        print(" ".join(shard))
        return 0
    for i, shard in enumerate(plan(files, a.plan, ms), 1):
        secs = sum(int(ms.get(f) or DEFAULT_MS) for f in shard) / 1000
        print(f"shard {i}/{a.plan}: {len(shard)} files, {secs:.0f} s recorded"
              f" ({sum(1 for f in shard if f not in ms)} without a record)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
