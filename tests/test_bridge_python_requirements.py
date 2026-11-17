"""Rails for tools/bridge_python_requirements.py: the Python the `remote tests` vitest job installs for the
rails that spawn `python` (the Notebook export bridges, the symbol-fold parity). Why the lane installs a
short list instead of requirements.txt, and why that list is measured rather than trusted, is the tool's
docstring. tests/test_remote_tests_lane.py rails the workflow step that installs it.
"""
from __future__ import annotations

import pathlib
import re
import subprocess
import sys

from tools import bridge_python_requirements as bpr

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOOL = ROOT / "tools" / "bridge_python_requirements.py"


def _run(*args: str, code: str | None = None) -> subprocess.CompletedProcess:
    """A FRESH interpreter, as a bridge spawn is: this pytest process has imported half the tree, and an
    in-process measure would count every distribution the whole session loaded."""
    cmd = [sys.executable, "-c", code] if code else [sys.executable, str(TOOL), *args]
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace",
                          timeout=600, env=None)


def test_the_rails_import_nothing_the_lane_does_not_install():
    r = _run("--measure")
    assert r.returncode == 0, r.stdout + r.stderr
    loaded = r.stdout.split("loaded:", 1)[1].splitlines()[0]
    # non-vacuity: the two distributions the bridges were red for are what the probe must have seen
    assert "pytest" in loaded and "anyio" in loaded, r.stdout


def test_an_import_the_list_does_not_cover_is_named_and_fails():
    """The measure can fail: drop anyio from the list (in a fresh process) and it must say anyio."""
    code = ("import sys; sys.path.insert(0, '.'); from tools import bridge_python_requirements as b; "
            "b.BRIDGE_REQUIREMENTS = ('pytest', 'sniffio', 'tzdata'); sys.exit(b.main(['--measure']))")
    r = _run(code=code)
    assert r.returncode == 1, r.stdout + r.stderr
    assert "NOT COVERED" in r.stdout and "anyio" in r.stdout.split("NOT COVERED", 1)[1], r.stdout


def test_the_spawning_rails_are_found_not_listed():
    """Non-vacuity floor for the derivation: the rails this tool exists for are among what it finds."""
    scripts, modules = bpr.entry_points()
    names = {p.name for p in scripts}
    assert {"md_export_bridge.py", "selection_export_bridge.py", "format_export_bridge.py",
            "note_tasks_bridge.py", "roundtrip_export_fixture.py"} <= names, names
    assert "api.services.ast_bind" in modules, modules
    rails = {p.name for p in bpr.spawning_rails()}
    assert {"exportBridge.js", "exportRoundtrip.test.js", "symbolFoldParity.test.js"} <= rails, rails


def test_versions_come_from_requirements_txt_wherever_it_pins_them():
    req = {}
    for raw in (ROOT / "requirements.txt").read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        m = re.match(r"([A-Za-z0-9][A-Za-z0-9._-]*)", line)
        if m and not line.startswith("-"):
            req[m.group(1).lower().replace("_", "-")] = line
    pins = bpr.pins()
    assert len(pins) == len(bpr.BRIDGE_REQUIREMENTS)
    for name, line in zip(bpr.BRIDGE_REQUIREMENTS, pins):
        assert line == req.get(name, name), (name, line)
    # non-vacuity: pytest IS pinned there, so a lookup that silently failed would print it bare
    assert pins[bpr.BRIDGE_REQUIREMENTS.index("pytest")].startswith("pytest==")


def test_pins_is_what_the_workflow_installs():
    r = _run("--pins")
    assert r.returncode == 0, r.stderr
    assert r.stdout.split() == bpr.pins()
