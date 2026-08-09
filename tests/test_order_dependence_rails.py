r"""Rails on the SPLIT SESSION that made `pytest tests/` fail order-dependently.

THE DEFECT, measured before anything here was written:

    pytest tests/theme_engine/test_store.py tests/test_compass_voice_bridge.py
      -> EXIT 1 · 4 failed · sqlite3.OperationalError: no such table: j2_chat_messages
    pytest tests/test_compass_voice_bridge.py
      -> EXIT 0 · 6 passed

`tests/theme_engine/conftest.py` points `AUTH_DB_PATH` at a scratch file and
calls `importlib.reload(auth_db)`. `monkeypatch` unwinds the ENV VAR at
teardown; NOTHING unwinds the reload. From that point the process runs SPLIT —
`auth_db` (which captured the path at import) opens the scratch file while
`journal_two.coach_chat` (which re-reads `os.environ` per call) opens the
isolated store. The victim's `init_db()` builds the j2_* schema in one file and
its `list_messages()` reads the other.

Neither half is wrong on its own, which is why thousands of green tests never
saw it, and why the victim was a different file every time the chunk boundaries
moved.

WHAT EACH RAIL HERE CATCHES

  1. `test_the_census_...` — the repair's module list is derived by AST. If the
     derivation ever stops finding an import-time reader that exists, this fails
     BY FILE AND LINE rather than by a count (a count passes on a swap).
  2. `test_every_census_entry_...` — a RUNTIME oracle: each named global really
     does move when the module is reloaded under a different env var. Guards the
     opposite direction — a census padded with names that capture nothing.
  3. The ORDERED PAIR — test 3 pollutes exactly the way the 45 fixtures in this
     repo pollute and does not clean up; test 4 asserts the binding came back.
     Deleting the autouse repair in the root `conftest.py` fails test 4.
  4. `test_the_measured_polluter_victim_pair_...` — re-runs the two real files
     above, in both orders, in a subprocess, and reads the EXIT CODE. This is the
     only rail that exercises the whole thing end to end, and it names both files.
"""

import ast
import importlib
import os
import subprocess
import sys
from pathlib import Path

import pytest

import conftest as root_conftest

REPO = Path(__file__).resolve().parents[1]

# `tests/` is a package (it has `__init__.py`), so pytest puts only the rootdir
# on sys.path and the bare name `conftest` is unambiguous. Asserted rather than
# assumed: if that ever changes, these rails would silently grade the WRONG
# conftest and pass while the real one was broken.
assert Path(root_conftest.__file__).resolve() == REPO / "conftest.py", (
    f"imported the wrong conftest: {root_conftest.__file__}")


# ─── 1 + 2 · the census is complete, and every entry is real ────────────────

def _module_level_auth_db_path_reads():
    """Ground truth by AST: every `api/**` module-level global read off
    AUTH_DB_PATH, as (dotted_module, attr, file:line).

    Deliberately written against `tree.body` only. A read inside a function is
    re-evaluated on every call and needs no repair; a read at module level is
    evaluated once, at import, and is the thing a reload rebinds forever.
    """
    out = []
    for path in sorted((REPO / "api").rglob("*.py")):
        if "__pycache__" in path.parts or "node_modules" in path.parts:
            continue
        if path.name.startswith("test_") or path.name.endswith("_test.py"):
            continue
        src = path.read_text(encoding="utf-8", errors="replace")
        if "AUTH_DB_PATH" not in src:
            continue
        try:
            tree = ast.parse(src, str(path))
        except SyntaxError:
            continue
        for node in tree.body:
            if isinstance(node, ast.Assign):
                targets, value = node.targets, node.value
            elif isinstance(node, ast.AnnAssign) and node.value is not None:
                targets, value = [node.target], node.value
            else:
                continue
            if "AUTH_DB_PATH" not in ast.unparse(value):
                continue
            dotted = path.relative_to(REPO).with_suffix("").as_posix().replace("/", ".")
            for target in targets:
                if isinstance(target, ast.Name):
                    rel = path.relative_to(REPO).as_posix()
                    out.append((dotted, target.id, f"{rel}:{node.lineno}"))
    return out


def test_the_census_in_the_root_conftest_names_every_import_time_reader():
    """Fails BY FILE AND LINE on an import-time reader the repair would miss."""
    truth = _module_level_auth_db_path_reads()
    assert truth, ("the AST ground truth found ZERO module-level AUTH_DB_PATH "
                   "reads — the walk is broken, not the repo")

    covered = set(root_conftest.AUTH_DB_PATH_CAPTURERS)
    missed = [f"{where}  ({dotted}.{attr})"
              for dotted, attr, where in truth if (dotted, attr) not in covered]
    assert not missed, (
        "these module-level AUTH_DB_PATH captures are NOT repaired between "
        "tests, so a reload of any of them splits the session:\n  "
        + "\n  ".join(missed))


def test_every_census_entry_is_really_rebound_by_a_reload(tmp_path, monkeypatch):
    """The other direction: a name in the census that no reload can move would
    make the census look healthy while repairing nothing."""
    assert root_conftest.AUTH_DB_PATH_CAPTURERS, "census is empty"

    scratch = str(tmp_path / "probe_auth.db")
    monkeypatch.setenv("AUTH_DB_PATH", scratch)

    inert = []
    for dotted, attr in root_conftest.AUTH_DB_PATH_CAPTURERS:
        mod = importlib.import_module(dotted)
        importlib.reload(mod)
        if getattr(mod, attr, None) != scratch:
            inert.append(f"{dotted}.{attr} -> {getattr(mod, attr, None)!r}")

    # Put every probed module back before the assert, so a failure here cannot
    # cascade into the rest of the session.
    root_conftest.repair_auth_db_capturers(root_conftest.ISOLATED_AUTH_DB)

    assert not inert, (
        "these census entries did not follow AUTH_DB_PATH on reload, so the "
        "repair is re-pinning something that was never the problem:\n  "
        + "\n  ".join(inert))


# ─── 3 · the ordered pair: pollute, then prove the repair ran ───────────────
#
# These two MUST run in this order and in the same process. pytest runs a
# module's tests in definition order, so that holds for `pytest <this file>`,
# for `pytest tests/`, and for any chunking that keeps a file whole.

_POLLUTION = {}


def test_a_reload_under_a_temp_path_moves_the_binding(tmp_path, monkeypatch):
    """The CONTROL half. If this ever stops being true, the pair below proves
    nothing and the failure should be here, not silently in the next test."""
    import api.services.auth_db as auth_db

    scratch = str(tmp_path / "auth.db")
    monkeypatch.setenv("AUTH_DB_PATH", scratch)
    importlib.reload(auth_db)

    assert auth_db._DB_PATH == scratch, (
        "reloading auth_db under a temp AUTH_DB_PATH no longer moves _DB_PATH; "
        "the pollution this file guards has changed shape")
    _POLLUTION["scratch"] = scratch
    # DELIBERATELY NOT RESTORED. monkeypatch will unwind the env var and leave
    # the reload standing — which is exactly what ~45 fixtures in this repo do.


def test_and_the_next_test_finds_the_binding_repaired():
    """Fails if the autouse repair in the root `conftest.py` is removed."""
    if "scratch" not in _POLLUTION:
        pytest.fail(
            "this is the second half of an ordered pair — it is only meaningful "
            "after test_a_reload_under_a_temp_path_moves_the_binding in this "
            "same file. Do not select it on its own.")

    import api.services.auth_db as auth_db

    assert auth_db._DB_PATH != _POLLUTION["scratch"], (
        "auth_db._DB_PATH is STILL the previous test's scratch file. The "
        "session is split: import-time readers open one auth.db, the "
        "journal_two per-call readers open another.")
    assert auth_db._DB_PATH == os.environ["AUTH_DB_PATH"], (
        f"auth_db._DB_PATH ({auth_db._DB_PATH!r}) disagrees with "
        f"AUTH_DB_PATH ({os.environ['AUTH_DB_PATH']!r})")


def test_the_repair_reaches_every_capturer_not_just_auth_db():
    """auth_db is the loudest capturer, not the only one. Five more read the
    same env var at import; a repair that only knew about auth_db would leave
    `indicator_alert_service`, `bar_quarantine`, `bars_audit`,
    `bar_provenance` and `awareness.regime_snapshots` split."""
    disagreeing = []
    for dotted, attr in root_conftest.AUTH_DB_PATH_CAPTURERS:
        mod = sys.modules.get(dotted)
        if mod is None:
            continue
        value = getattr(mod, attr, None)
        if value != os.environ["AUTH_DB_PATH"]:
            disagreeing.append(f"{dotted}.{attr} = {value!r}")
    assert not disagreeing, (
        "already-imported capturers disagree with AUTH_DB_PATH:\n  "
        + "\n  ".join(disagreeing))


# ─── 4 · the end-to-end rail on the two files that actually failed ──────────

# ── the three measured pairs ──────────────────────────────────────────────
#
# Each row is (polluter, victim, what broke). Every one was found by running the
# suite in a DIFFERENT FILE ORDER and bisecting the prefix down to one file;
# every one is green in isolation and was red polluter-first.
_PAIRS = [
    pytest.param("tests/theme_engine/test_store.py",
                 "tests/test_compass_voice_bridge.py",
                 id="auth_db-reload--j2_chat_messages"),
    pytest.param("tests/test_catalyst_tuning.py",
                 "tests/test_catalyst_filters.py",
                 id="tuning-overrides-reload--price-floor"),
    pytest.param("tests/test_broker_partner_health.py",
                 "tests/test_broker_fleet_monitor.py",
                 id="partner-health-cache--phantom-degraded-finding"),
]


def _run(files, basetemp):
    """A real pytest subprocess. Exit code read directly — never through a pipe."""
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", *files, "-q", "-p", "no:cacheprovider",
         "--basetemp", str(basetemp), "-p", "no:randomly"],
        cwd=str(REPO), capture_output=True, text=True, timeout=240,
    )
    return proc


@pytest.mark.timeout(280)
@pytest.mark.parametrize("polluter,victim", _PAIRS)
def test_the_measured_polluter_victim_pair_is_green_in_both_orders(
        polluter, victim, tmp_path):
    """The rail on the ACTUAL defects, BY FILE NAME.

    Each pair was red polluter-first and green victim-first before its fix:

      theme_engine/test_store   -> compass_voice_bridge  : 4 failed
      test_catalyst_tuning      -> test_catalyst_filters : 3 failed
      test_broker_partner_health-> test_broker_fleet_monitor : 5 failed

    Both orders must now be green, and the verdict is the EXIT CODE of a real
    pytest subprocess — read from the process object, never through a pipe.
    """
    forward = _run([polluter, victim], tmp_path / "fwd")
    assert forward.returncode == 0, (
        f"POLLUTER FIRST is red: {polluter} then {victim} "
        f"(exit {forward.returncode}).\n"
        f"{forward.stdout[-4000:]}\n{forward.stderr[-2000:]}")

    reverse = _run([victim, polluter], tmp_path / "rev")
    assert reverse.returncode == 0, (
        f"VICTIM FIRST is red: {victim} then {polluter} "
        f"(exit {reverse.returncode}).\n"
        f"{reverse.stdout[-4000:]}\n{reverse.stderr[-2000:]}")
