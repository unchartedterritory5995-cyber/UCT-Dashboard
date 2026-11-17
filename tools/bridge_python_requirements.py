"""The Python a vitest lane must install for the Notebook bridge rails -- named here, MEASURED by a rail.

⚰️ WHY THIS EXISTS (2026-11-17). Seven vitest rails spawn `python` to run the REAL exporter and read its
answer back through the real importer: calloutNode.variant, dateMentionNode, exportFormats.roundtrip,
exportRoundtrip, fidelityCarryovers.roundtrip, noteBatch.jsonRoundtrip, selectionExport.roundtrip (every
spawn goes through tools/*_bridge.py or api/services/journal_two/roundtrip_export_fixture.py). Each bridge
imports the repo-root `conftest` (pytest: the census and the tripwire) and the exporter (anyio). The
nightly's vitest job installs all of requirements.txt for them; the `remote tests` lane's vitest job
installed no Python at all, so all seven were red there with ModuleNotFoundError and their own
assertions never ran (remote run 44066213548, full vitest on master 49284c433e). The rails that spawn
Python are FOUND, not listed: every app/src file that calls `spawnSync/execFileSync/...('python'`
(`spawning_rails`), read for the scripts it names and the `api.*` modules its inline scripts import
(symbolFoldParity.test.js's `python -c` reads api.services.ast_bind).

⭐ The lane installs only what the bridges import, not all 88 lines of requirements.txt, because it runs
once per vitest shard (up to six runners per remote run). A short list beside the code it serves is the
enumeration-beside-its-source defect waiting to happen, so it is not trusted:
  * VERSIONS have one authority, requirements.txt: `--pins` prints requirements.txt's own line for each
    name it pins (a name requirements.txt only brings in transitively, like anyio, is printed bare, which
    is how requirements.txt itself resolves it);
  * the NAMES are measured: `--measure` imports what the bridges import, in this interpreter, and exits 1
    naming every third-party distribution that got loaded and is neither listed here nor a dependency pip
    installs with one that is. tests/test_bridge_python_requirements.py runs it under the full
    requirements.txt install (so an optional import that succeeds there counts too).

Usage:
    python tools/bridge_python_requirements.py --pins      > bridge-requirements.txt
    python tools/bridge_python_requirements.py --measure
"""
from __future__ import annotations

import argparse
import ast
import importlib
import importlib.metadata as md
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIREMENTS = ROOT / "requirements.txt"

#: What the bridge processes import that is not in the standard library or this repo. Measured, not
#: guessed: see `--measure`. `sniffio` is an OPTIONAL import of anyio's (no longer one of its declared
#: requirements), listed because the full requirements.txt install carries it and the lane should run
#: the same code path the nightly does.
BRIDGE_REQUIREMENTS = ("pytest", "anyio", "sniffio", "tzdata")

#: Where the vitest rails live. Every file there that spawns `python` is read for what it runs: a
#: `<name>.py` it names (a repo path, or a bare name under tools/) and an `api.*` module a `-c` script
#: imports. Derived on every run, never a hand-kept list of rails.
APP_SRC = ROOT / "app" / "src"
_SPAWNS_PYTHON = re.compile(r"\b(?:spawnSync|execFileSync|execSync|spawn)\(\s*['\"]python3?['\"]")
_PY_LITERAL = re.compile(r"[\w./-]+\.py\b")
_API_FROM = re.compile(r"\bfrom\s+(api(?:\.\w+)*)\s+import\s+(\w+)")
_API_IMPORT = re.compile(r"\bimport\s+(api(?:\.\w+)+)")

_NAME = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)")


def _canon(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def pins(requirements: Path = REQUIREMENTS) -> list[str]:
    """One requirement line per BRIDGE_REQUIREMENTS name, the version taken from requirements.txt."""
    lines: dict[str, str] = {}
    for raw in requirements.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        m = _NAME.match(line)
        if line and not line.startswith("-") and m:
            lines.setdefault(_canon(m.group(1)), line)
    return [lines.get(_canon(n), n) for n in BRIDGE_REQUIREMENTS]


def spawning_rails(root: Path = ROOT) -> list[Path]:
    """Every JS file under app/src that spawns a `python` process."""
    out = []
    for p in sorted((root / "app" / "src").rglob("*")):
        if p.suffix in (".js", ".jsx", ".mjs") and p.is_file():
            if _SPAWNS_PYTHON.search(p.read_text(encoding="utf-8", errors="replace")):
                out.append(p)
    return out


def entry_points(root: Path = ROOT) -> tuple[list[Path], list[str]]:
    """(the repo's .py files those rails run, the `api.*` modules their inline scripts import). A `.py`
    literal that resolves to no file (a fixture string such as 'z.py' in a rail about spawning) is not
    an entry point; a rail that names a missing script fails on its own."""
    scripts: set[Path] = set()
    modules: set[str] = set()
    for rail in spawning_rails(root):
        text = rail.read_text(encoding="utf-8", errors="replace")
        for lit in _PY_LITERAL.findall(text):
            cand = root / lit if "/" in lit else root / "tools" / lit
            if cand.is_file():
                scripts.add(cand.resolve())
        modules.update(_API_IMPORT.findall(text))
        # `from api.services import ast_bind`: the module wanted is api.services.ast_bind when that is a
        # module (measure() falls back to the package when the name is an attribute).
        modules.update(f"{pkg}.{name}" for pkg, name in _API_FROM.findall(text))
    return sorted(scripts), sorted(modules)


def imported_modules(path: Path) -> list[str]:
    """Every module an entry point imports, at ANY depth of the file (the bridges import the exporter
    inside `main()`, after the census is armed)."""
    out: list[str] = []
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            out += [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            out.append(node.module)
    return out


def _allowed() -> set[str]:
    """The listed distributions and everything pip installs with them (their own requirements, walked)."""
    seen: set[str] = set()
    todo = [_canon(n) for n in BRIDGE_REQUIREMENTS]
    while todo:
        name = todo.pop()
        if name in seen:
            continue
        seen.add(name)
        try:
            reqs = md.requires(name) or []
        except md.PackageNotFoundError:
            continue
        for r in reqs:
            if "extra ==" in r:
                continue
            m = _NAME.match(r)
            if m:
                todo.append(_canon(m.group(1)))
    return seen


def measure() -> tuple[set[str], set[str]]:
    """(third-party distributions the bridges load, the ones of those this list does not cover)."""
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    importlib.import_module("conftest")          # first, as every bridge does: the census and the tripwire
    scripts, modules = entry_points()
    if not scripts or not modules:
        raise SystemExit(f"found {len(scripts)} script(s) and {len(modules)} inline module(s) under "
                         f"{APP_SRC} -- a probe that finds nothing to import has measured nothing")
    wanted = [(str(p.relative_to(ROOT)), m) for p in scripts for m in imported_modules(p)]
    wanted += [("an inline `python -c` script", m) for m in modules]
    for where, mod in wanted:
        try:
            importlib.import_module(mod)
        except ModuleNotFoundError as e:
            if where.startswith("an inline") and e.name == mod:   # `from pkg import attr`: attr is no module
                importlib.import_module(mod.rpartition(".")[0])
                continue
            raise SystemExit(f"{where} imports {mod!r}, which does not import here: {e}")
        except ImportError as e:                  # a module this interpreter cannot import is a finding
            raise SystemExit(f"{where} imports {mod!r}, which does not import here: {e}")
    stdlib = set(sys.stdlib_module_names)
    p2d = md.packages_distributions()
    loaded: set[str] = set()
    for name in list(sys.modules):
        top = name.split(".")[0]
        if not top or top.startswith("_") or top in stdlib:
            continue
        if (ROOT / top).exists() or (ROOT / f"{top}.py").exists():
            continue                              # this repo's own packages
        for dist in p2d.get(top, ()):
            loaded.add(_canon(dist))
    return loaded, loaded - _allowed()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--pins", action="store_true", help="print the requirement lines to install")
    g.add_argument("--measure", action="store_true", help="import what the bridges import; exit 1 on a gap")
    ap.add_argument("--requirements", type=Path, default=REQUIREMENTS,
                    help="the requirements.txt to read versions from (the lane runs MASTER's copy of this "
                         "tool against the commit under test's requirements.txt)")
    a = ap.parse_args(argv)
    if a.pins:
        print("\n".join(pins(a.requirements)))
        return 0
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    from tools.bridge_sandbox import run_bridge   # releases the census sandboxes `import conftest` mints
    return run_bridge(_report_measure)


def _report_measure() -> int:
    loaded, uncovered = measure()
    print("loaded:", ", ".join(sorted(loaded)) or "(none)")
    if not loaded:
        print("measured NOTHING -- the probe imported no third-party distribution, which is a failed read")
        return 1
    if uncovered:
        print("NOT COVERED by BRIDGE_REQUIREMENTS (add each, or the lane fails with ModuleNotFoundError):",
              ", ".join(sorted(uncovered)))
        return 1
    print("covered: every distribution the bridges load is listed or installed with one that is")
    return 0


if __name__ == "__main__":
    sys.exit(main())
