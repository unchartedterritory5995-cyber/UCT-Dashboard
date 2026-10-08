"""The web image carries every npm package the cross-lane alert proof imports — and only those.

⚰️ WHAT THIS GUARDS (measured on prod 2026-10-08). Arming a user-formula alert runs
`tools/ast_conformance.run_js`: a bare `node` that imports the SHIPPED
`app/src/components/chart/engine/ast/interpret.js`. That file reaches `parse.js`,
which does `import jsep from 'jsep'`. `Dockerfile.web`'s runtime stage had `node`
but no `app/node_modules`, so node raised ERR_MODULE_NOT_FOUND, the lane was
`LaneUnavailable`, and every arm was refused with a 400. Safe, and useless.

⛔ THE CLOSURE IS WALKED, NOT LISTED. A hand-kept list of packages is exactly what
went stale. The import graph from the two lane entry files is followed through
every relative import; each BARE specifier found must be copied into the runtime
stage by name. A wholesale `node_modules` copy is refused, so the fix stays narrow.
"""
from __future__ import annotations

import json
import pathlib
import re
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
APP = ROOT / "app"
AST_DIR = APP / "src" / "components" / "chart" / "engine" / "ast"
LANE_ENTRIES = (AST_DIR / "interpret.js", AST_DIR / "parse.js")
WEB_DOCKERFILE = ROOT / "Dockerfile.web"

_IMPORT = re.compile(
    r"""(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]"""
    r"""|(?:^|\n)\s*import\s*['"]([^'"]+)['"]"""
    r"""|import\(\s*['"]([^'"]+)['"]\s*\)""")


def _closure():
    """(every source + JSON file reached, {bare package: [importing files]})."""
    seen, data, bare, todo = set(), set(), {}, [p.resolve() for p in LANE_ENTRIES]
    while todo:
        f = todo.pop()
        if f in seen:
            continue
        seen.add(f)
        for m in _IMPORT.finditer(f.read_text(encoding="utf-8")):
            spec = m.group(1) or m.group(2) or m.group(3)
            if spec.startswith("."):
                base = (f.parent / spec).resolve()
                for cand in (base, base.with_name(base.name + ".js"),
                             base.with_name(base.name + ".mjs"), base / "index.js"):
                    if cand.is_file():
                        (data.add if cand.suffix == ".json" else todo.append)(cand)
                        break
                else:
                    raise AssertionError(f"{f}: unresolved relative import {spec!r}")
            elif not spec.startswith("node:"):
                pkg = "/".join(spec.split("/")[:2]) if spec.startswith("@") else spec.split("/")[0]
                bare.setdefault(pkg, []).append(str(f.relative_to(ROOT)))
    return seen | data, bare


def _runtime_copies():
    """The `COPY --from=frontend` arguments of the runtime stage."""
    stage, out = None, []
    for raw in WEB_DOCKERFILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        verb, _, arg = line.partition(" ")
        if verb.upper() == "FROM":
            m = re.search(r"\bAS\s+(\S+)", arg, re.I)
            stage = m.group(1) if m else arg
        elif stage == "runtime" and verb.upper() == "COPY" and arg.startswith("--from=frontend"):
            out.append(arg.split()[1:])
    return out


def test_the_lane_closure_is_found_and_reaches_jsep():
    files, bare = _closure()
    assert len(files) >= 2
    assert "jsep" in bare, "the walker no longer sees parse.js's jsep import — it is blind"


def test_every_bare_package_the_lane_imports_is_copied_into_the_runtime_stage_by_name():
    _, bare = _closure()
    copies = {tuple(c) for c in _runtime_copies()}
    for pkg, importers in bare.items():
        want = (f"/src/app/node_modules/{pkg}", f"/app/app/node_modules/{pkg}")
        assert want in copies, (
            f"{pkg!r} is imported by {importers} and run under bare node at alert-arm "
            f"time, but Dockerfile.web's runtime stage does not copy it ({want})")


def test_the_runtime_stage_never_copies_node_modules_wholesale():
    for src, *_ in _runtime_copies():
        assert src.rstrip("/") != "/src/app/node_modules", "copy only the lane's packages"


def test_each_copied_package_is_a_production_dependency_with_no_dependencies_of_its_own():
    _, bare = _closure()
    manifest = json.loads((APP / "package.json").read_text(encoding="utf-8"))
    for pkg in bare:
        assert pkg in (manifest.get("dependencies") or {}), f"{pkg} must be a runtime dependency"
        installed = APP / "node_modules" / pkg / "package.json"
        if not installed.is_file():
            pytest.skip("app/node_modules not installed in this checkout")
        deps = json.loads(installed.read_text(encoding="utf-8")).get("dependencies") or {}
        assert not deps, f"{pkg} pulls {sorted(deps)} — copy those too, or the lane breaks again"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not on PATH")
def test_the_lane_imports_under_bare_node_with_ONLY_the_copied_packages(tmp_path):
    """The image layout, reproduced: the lane's files with no node_modules fail exactly as
    prod did; adding only the copied packages makes `interpret` importable."""
    files, bare = _closure()
    for f in files:
        dst = tmp_path / f.relative_to(ROOT)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dst)
    hook = tmp_path / "jsonhook.mjs"
    hook.write_text(
        "import { readFile } from 'node:fs/promises'\n"
        "export async function load(url, context, nextLoad) {\n"
        "  if (url.endsWith('.json')) return { format: 'module', shortCircuit: true,"
        " source: `export default ${await readFile(new URL(url), 'utf8')}\\n` }\n"
        "  return nextLoad(url, context)\n}\n", encoding="utf-8")
    entry = (tmp_path / LANE_ENTRIES[0].relative_to(ROOT)).as_uri()
    driver = tmp_path / "driver.mjs"
    driver.write_text(
        "import { register } from 'node:module'\n"
        "register('./jsonhook.mjs', import.meta.url)\n"
        f"const m = await import({json.dumps(entry)})\n"
        "process.stdout.write(typeof (m.interpret || m.default))\n", encoding="utf-8")

    def run():
        return subprocess.run(["node", str(driver)], capture_output=True, text=True, timeout=60)

    before = run()
    assert before.returncode != 0 and "ERR_MODULE_NOT_FOUND" in before.stderr

    for pkg in bare:
        src = APP / "node_modules" / pkg
        if not src.is_dir():
            pytest.skip("app/node_modules not installed in this checkout")
        shutil.copytree(src, tmp_path / "app" / "node_modules" / pkg)
    after = run()
    assert after.returncode == 0, after.stderr[-500:]
    assert after.stdout == "function"
