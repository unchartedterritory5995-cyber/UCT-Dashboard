"""Every `tools/*_bridge.py` applies the shared-data-root CENSUS before any `api.*` import.

Wave 7, lane J, item J1 (the wave-6 M-8 carry-over).

A bridge is a Python entry point a JS rail spawns as `python tools/<name>_bridge.py`. That
process is NOT under pytest, so the repo-root `conftest.py` has not run in it: nothing has
pinned the env vars that name a path under the shared data root, and nothing has armed the
tripwire. Every `api.*` module that captures a path at import -- `auth_db._DB_PATH` first
among them -- then resolves it against `C:\\data`, the owner's live files.

`selection_export_bridge.py` does it right: a module-level `import conftest` before the
first `api.*` import. `md_export_bridge.py` pinned nothing (its docstring argued it was a
pure function of stdin -- true today, one import away from not being), and
`note_tasks_bridge.py` hand-pinned ONE variable, `AUTH_DB_PATH`. That is root cause 1 in
CLAUDE.md ("`DATA_DIR` IS NOT AN AUTHORITY"): the pins resolve independently, so a
hand-picked one is the same defect with one variable instead of zero.

Two halves, and they fail for different reasons:

* an AST walk over EVERY `tools/*_bridge.py` -- the set is READ FROM THE DIRECTORY, never
  typed, so a bridge added tomorrow is covered the day it lands -- asserting that a
  module-level `import conftest` precedes, in the source, every `api` import, including the
  function-local ones inside `main()` where the bridges keep them; and that no bridge
  writes an environment variable of its own (a hand pin);
* a control that RUNS a bridge as a subprocess with a CLEAN environment -- every census pin
  stripped, so the only way a pin can reappear is the bridge's own import -- under
  `UCT_TEST_SHARED_ROOT_GUARD=report`, and reads the tripwire's own record of a probe write.
  A guard nobody has seen fire is not a guard. Its twin runs the same driver over the same
  bridge with the import removed and must see NOTHING armed, so the probe can tell the two
  apart (a control that cannot fail is not a control).
"""
from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
from pathlib import Path

import conftest as rootconf  # the repo-root one pytest already loaded

REPO = Path(__file__).resolve().parents[1]
TOOLS = REPO / "tools"

#: Named members, never a count: the walk must SEE these three or it is walking nothing.
KNOWN_BRIDGES = ("md_export_bridge.py", "note_tasks_bridge.py", "selection_export_bridge.py")


def _bridges() -> list[Path]:
    return sorted(TOOLS.glob("*_bridge.py"))


def _is_api(name: str | None) -> bool:
    return bool(name) and (name == "api" or name.startswith("api."))


def _api_import_sites(tree: ast.AST) -> list[int]:
    """Every line that imports from `api`, at ANY depth (a walk, not `tree.body`)."""
    sites = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.level == 0 and _is_api(node.module):
            sites.append(node.lineno)
        elif isinstance(node, ast.Import) and any(_is_api(a.name) for a in node.names):
            sites.append(node.lineno)
        elif (isinstance(node, ast.Call) and node.args
              and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)
              and _is_api(node.args[0].value)
              and ((isinstance(node.func, ast.Attribute) and node.func.attr == "import_module")
                   or (isinstance(node.func, ast.Name) and node.func.id in ("import_module", "__import__")))):
            sites.append(node.lineno)
    return sorted(sites)


def _module_level_conftest_import(tree: ast.Module) -> int | None:
    """The line of a MODULE-LEVEL `import conftest`, or None.

    Module level on purpose: a function-local import runs only when that function
    does, which is the ordering this rail exists to take out of anyone's hands.
    """
    for node in tree.body:
        if isinstance(node, ast.Import) and any(a.name == "conftest" for a in node.names):
            return node.lineno
    return None


def _env_writes(tree: ast.AST) -> list[int]:
    """Lines where the file sets an environment variable itself -- a hand pin."""
    def _is_environ(n):
        return (isinstance(n, ast.Attribute) and n.attr == "environ"
                and isinstance(n.value, ast.Name) and n.value.id == "os")
    lines = []
    for node in ast.walk(tree):
        targets = []
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, (ast.AugAssign, ast.AnnAssign)):
            targets = [node.target]
        for t in targets:
            if isinstance(t, ast.Subscript) and _is_environ(t.value):
                lines.append(node.lineno)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            f = node.func
            if f.attr in ("setdefault", "update", "__setitem__") and _is_environ(f.value):
                lines.append(node.lineno)
            if f.attr == "putenv" and isinstance(f.value, ast.Name) and f.value.id == "os":
                lines.append(node.lineno)
    return sorted(lines)


def _problems(src: str, name: str) -> list[str]:
    tree = ast.parse(src, name)
    api = _api_import_sites(tree)
    ct = _module_level_conftest_import(tree)
    out = []
    if ct is None:
        out.append(f"{name}: no module-level `import conftest` -- the census and the tripwire never run")
    elif api and ct > api[0]:
        out.append(f"{name}: `import conftest` at line {ct} comes AFTER the first api import at line {api[0]}")
    for line in _env_writes(tree):
        out.append(f"{name}:{line}: sets an environment variable by hand -- a hand-picked pin; "
                   f"the census pins them all")
    return out


def test_every_bridge_applies_the_census_before_any_api_import():
    problems = []
    for path in _bridges():
        problems.extend(_problems(path.read_text(encoding="utf-8"), path.name))
    assert not problems, "\n".join(problems)


def test_the_walk_sees_what_it_claims_to():
    """Non-vacuity: the directory read finds the named bridges, and the import walk finds
    their FUNCTION-LOCAL api imports (a walk of `tree.body` alone would find none, and the
    ordering check would then pass over an empty list)."""
    names = [p.name for p in _bridges()]
    for known in KNOWN_BRIDGES:
        assert known in names, f"{known} is not in {names} -- the glob is reading the wrong place"
    for known in KNOWN_BRIDGES:
        tree = ast.parse((TOOLS / known).read_text(encoding="utf-8"), known)
        assert _api_import_sites(tree), f"{known}: the walk found no api import at all"

    good = "import conftest\n\ndef main():\n    from api.services import x\n"
    late = "def main():\n    from api.services import x\n\nimport conftest\n"
    nested = "def main():\n    import conftest\n    from api.services import x\n"
    absent = "def main():\n    from api.services import x\n"
    pinned = "import os\nimport conftest\nos.environ['AUTH_DB_PATH'] = 'x'\n"
    assert _problems(good, "good") == []
    assert _problems(late, "late") and "AFTER" in _problems(late, "late")[0]
    assert _problems(nested, "nested") and "no module-level" in _problems(nested, "nested")[0]
    assert _problems(absent, "absent") and "no module-level" in _problems(absent, "absent")[0]
    assert any("by hand" in p for p in _problems(pinned, "pinned"))


# ─── the control: run a bridge, read the tripwire's record ─────────────────────

_DRIVER = r'''
import json, os, runpy, sqlite3, sys
bridge, probe, repo, call_main = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "1"
sys.path.append(repo)            # api.* for a doctored copy outside tools/; conftest is NOT imported by this
out = {"conftest_before": "conftest" in sys.modules}
g = runpy.run_path(bridge, run_name="uct_bridge_under_test")    # the module body, not main()
ct = sys.modules.get("conftest")
out["conftest_loaded"] = ct is not None
out["auth_db_env"] = os.environ.get("AUTH_DB_PATH")
out["armed"] = bool(getattr(sqlite3.connect, "_uct_guarded", False))
if ct is not None:
    out["mode"] = ct._GUARD_MODE
    out["roots"] = list(ct.SHARED_DATA_ROOTS)
    out["pins"] = {k: os.environ.get(k) for k in ct.SHARED_DATA_ENV_PINS}
    out["isolated_auth_db"] = ct.ISOLATED_AUTH_DB
    out["violations_before_probe"] = [v["path"] for v in ct.SHARED_ROOT_VIOLATIONS]
    with ct.pretend_shared_root(probe):
        sqlite3.connect(os.path.join(probe, "bridge_probe.db")).close()
    out["record"] = [{"op": v["op"], "path": v["path"]} for v in ct.SHARED_ROOT_VIOLATIONS]
if call_main and ct is not None:     # never import api.* in a process nothing has guarded
    rc = g["main"]()
    sys.stdout.flush()
    out["main_rc"] = rc
    auth_db = sys.modules.get("api.services.auth_db")
    out["auth_db_captured"] = getattr(auth_db, "_DB_PATH", None)
sys.stdout.write("\nDRIVER " + json.dumps(out) + "\n")
'''


def _clean_env() -> dict:
    """The parent's environment minus every census pin (and AUTH_DB_PATH).

    Under pytest the parent has ALREADY pinned all of them, and a child inherits them --
    so without this the child would look pinned whether or not the bridge did anything.
    """
    strip = set(rootconf.SHARED_DATA_ENV_PINS) | {"AUTH_DB_PATH"}
    env = {k: v for k, v in os.environ.items() if k not in strip}
    env["UCT_TEST_SHARED_ROOT_GUARD"] = "report"
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def _drive(bridge: Path, probe: Path, cwd: Path, *, call_main: bool, stdin: str = "") -> dict:
    r = subprocess.run(
        [sys.executable, "-c", _DRIVER, str(bridge), str(probe), str(REPO), "1" if call_main else "0"],
        input=stdin, capture_output=True, text=True, encoding="utf-8", env=_clean_env(), cwd=str(cwd),
        timeout=180,
    )
    assert r.returncode == 0, f"driver exit {r.returncode}\nstdout:\n{r.stdout}\nstderr:\n{r.stderr}"
    lines = [ln for ln in r.stdout.splitlines() if ln.startswith("DRIVER ")]
    assert lines, f"the driver printed no DRIVER line -- it did not run\nstdout:\n{r.stdout}\nstderr:\n{r.stderr}"
    out = json.loads(lines[-1][len("DRIVER "):])
    out["_stdout"] = r.stdout
    return out


def _under(path: str, roots) -> bool:
    p = os.path.normcase(os.path.abspath(path))
    return any(p == r or p.startswith(r + os.sep) for r in roots)


def test_a_bridge_run_as_a_subprocess_is_pinned_and_armed(tmp_path):
    """The bridge that hand-pinned one variable: run it for real, from a clean environment."""
    probe = tmp_path / "probe"
    probe.mkdir()
    cwd = tmp_path / "cwd"          # not the repo root: `import conftest` must come from the bridge
    cwd.mkdir()
    doc = {"type": "doc", "content": [{"type": "taskList", "content": [
        {"type": "taskItem", "attrs": {"checked": False},
         "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Earnings prep"}]}]}]}]}
    out = _drive(TOOLS / "note_tasks_bridge.py", probe, cwd, call_main=True, stdin=json.dumps(doc))

    assert out["conftest_before"] is False
    assert out["conftest_loaded"] is True, "the bridge never imported the repo-root conftest"
    assert out["mode"] == "report"
    assert out["armed"] is True, "sqlite3.connect is not the tripwire's wrapper"
    roots = [os.path.normcase(r) for r in out["roots"]]
    assert roots, "the child's conftest names no shared root -- nothing to guard against"

    # Every census pin is set, and none of them lands inside the shared root.
    unset = sorted(k for k, v in out["pins"].items() if not v)
    assert not unset, f"census pins the bridge left unset: {unset}"
    inside = sorted(k for k, v in out["pins"].items() if _under(v, roots))
    assert not inside, f"census pins still pointing into the shared root: {inside}"
    assert out["pins"], "the census produced no pins at all"
    assert out["auth_db_env"] == out["isolated_auth_db"]

    # The tripwire's own record: nothing before the probe; exactly the probe write after it.
    assert out["violations_before_probe"] == []
    probe_db = os.path.normcase(os.path.abspath(str(probe / "bridge_probe.db")))
    assert out["record"] == [{"op": "sqlite3.connect", "path": probe_db}], out["record"]

    # And the bridge still answers -- through a module that captured its path at IMPORT.
    assert out.get("main_rc") == 0
    assert '"tasks"' in out["_stdout"] and "Earnings prep" in out["_stdout"]
    assert out["auth_db_captured"] == out["isolated_auth_db"], (
        f"auth_db captured {out['auth_db_captured']!r} at import")


def test_CONTROL_the_same_bridge_without_the_import_is_seen_unarmed(tmp_path):
    """The driver must be able to say NO. Same bridge, `import conftest` removed, written
    outside the repo: nothing loads the census, nothing is armed, nothing is pinned.
    `main()` is NOT called here -- an unguarded process has no business importing api.*."""
    src = (TOOLS / "note_tasks_bridge.py").read_text(encoding="utf-8")
    lines = src.splitlines(keepends=True)
    kept = [ln for ln in lines if not ln.lstrip().startswith("import conftest")]
    assert len(kept) < len(lines), "the bridge carries no `import conftest` line to remove"
    doctored = tmp_path / "doctored_bridge.py"
    doctored.write_text("".join(kept), encoding="utf-8")
    probe = tmp_path / "probe"
    probe.mkdir()

    out = _drive(doctored, probe, tmp_path, call_main=False)

    assert out["conftest_loaded"] is False
    assert out["armed"] is False
    assert out["auth_db_env"] is None, "AUTH_DB_PATH leaked into the child from somewhere other than the bridge"
