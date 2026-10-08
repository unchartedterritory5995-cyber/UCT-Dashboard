"""The repo-root ``conftest`` must be INERT inside a deployed service.

INCIDENT 2026-10-07 (~22:37-22:43 Central): the production web process started
answering 500 on sign-in and on every authenticated request. Its log showed
``SharedDataRootWrite`` raised from ``/app/conftest.py`` on
``sqlite3.connect('/data/auth.db')``. Something inside the live uvicorn process
had executed ``import conftest``, which (a) redirected every data-path
environment variable to a temporary sandbox and (b) armed the tripwire that
refuses every write under ``/data``. A restart cleared it.

The 2026-10-06 fix (``65dc5e4586``) closed ONE import path. This file pins the
CAPABILITY instead: whatever imports ``conftest`` in a deployed Railway service,
nothing is pinned, nothing is patched, and one line on stderr names the
importer.

Every case runs in a SUBPROCESS. The guard patches ``builtins.open`` and
``sqlite3.connect`` process-wide, so a second copy must never be imported
in-process, and under pytest the repo conftest is already loaded and the
behaviour under test cannot show.

No case goes near the real shared root: the probes point the tripwire at a
throwaway directory with ``conftest.pretend_shared_root``.
"""
import ast
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

import conftest as rootconf

ROOT = Path(__file__).resolve().parents[1]

#: What the one stderr line starts with. Restated here on purpose: the line is
#: an operator-facing contract (it is what gets grepped out of a 500-line log).
INERT_MARKER = "[conftest] INERT"

PROBE = r'''
import builtins, io, json, os, sqlite3, sys

cfg = json.loads(sys.argv[1])


def _patchable():
    return {
        "sqlite3.connect": sqlite3.connect,
        "sqlite3.dbapi2.connect": sqlite3.dbapi2.connect,
        "builtins.open": builtins.open,
        "io.open": io.open,
        "os.makedirs": os.makedirs,
        "os.mkdir": os.mkdir,
        "os.remove": os.remove,
        "os.unlink": os.unlink,
        "os.rename": os.rename,
        "os.replace": os.replace,
    }


originals = _patchable()
before = dict(os.environ)

if cfg.get("preimport_pytest"):
    import pytest  # noqa: F401 -- "pytest is importable" is not "this is a pytest run"

sys.path.insert(0, cfg["root"])
if cfg.get("via"):
    sys.path.insert(0, cfg["via_dir"])
    __import__(cfg["via"])
import conftest

if cfg.get("reload"):
    import importlib
    conftest = importlib.reload(conftest)
if cfg.get("call_arm"):
    conftest._arm_shared_root_tripwire()

moved = sorted(k for k in set(before) | set(os.environ)
               if before.get(k) != os.environ.get(k))
now = _patchable()
patched = sorted(k for k in originals if now[k] is not originals[k])

probe = cfg["probe_dir"]
outcome = {}
with conftest.pretend_shared_root(probe):
    attempts = (
        ("sqlite3.connect", lambda: sqlite3.connect(os.path.join(probe, "p.db")).close()),
        ("open", lambda: open(os.path.join(probe, "p.txt"), "w").close()),
        ("os.makedirs", lambda: os.makedirs(os.path.join(probe, "sub"), exist_ok=True)),
    )
    for label, attempt in attempts:
        try:
            attempt()
            outcome[label] = None
        except Exception as exc:  # noqa: BLE001 -- the NAME is the measurement
            outcome[label] = type(exc).__name__

print(json.dumps({"moved": moved, "patched": patched, "outcome": outcome}))
'''


def _env(extra=None):
    """The parent's environment minus everything that would decide the answer.

    This process IS a pytest run with the census pins applied, so the child
    would otherwise inherit ~100 already-sandboxed data paths and a
    ``PYTEST_CURRENT_TEST``. Every pinned variable is re-planted at its real
    ``/data`` literal instead -- a STRING only, nothing here ever opens it --
    so "the environment was left alone" is a claim about paths that the census
    really would have moved.
    """
    drop = set(rootconf.SHARED_DATA_ENV_PINS) | {
        "AUTH_DB_PATH", "NOTE_IMPORT_RESERVE_BYTES",
        "SCREENER_SNAPSHOT_WARM_ENABLED"}
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(("PYTEST", "RAILWAY_", "UCT_")) and k not in drop}
    env.update(rootconf.SHARED_DATA_ENV_PINS)
    env["AUTH_DB_PATH"] = "/data/auth.db"
    env.update(extra or {})
    return env


def _probe(tmp_path, env_extra=None, **cfg):
    probe_dir = tmp_path / "pretend_shared_root"
    probe_dir.mkdir(exist_ok=True)
    script = tmp_path / "probe_main.py"
    script.write_text(PROBE, encoding="utf-8")
    cfg.update(root=str(ROOT), probe_dir=str(probe_dir))
    out = subprocess.run(
        [sys.executable, str(script), json.dumps(cfg)],
        cwd=str(tmp_path), env=_env(env_extra),
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=600)
    assert out.returncode == 0, out.stderr[-3000:]
    got = json.loads(out.stdout.strip().splitlines()[-1])
    got["inert_lines"] = [ln for ln in out.stderr.splitlines()
                          if INERT_MARKER in ln]
    return got


def _railway_identity_env(path, name):
    tree = ast.parse(Path(path).read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return tuple(ast.literal_eval(node.value))
    raise AssertionError(f"{name} is not assigned at module level in {path}")


SIGNALS = _railway_identity_env(ROOT / "conftest.py", "_RAILWAY_IDENTITY_ENV") \
    if "_RAILWAY_IDENTITY_ENV" in (ROOT / "conftest.py").read_text(encoding="utf-8") \
    else ("RAILWAY_ENVIRONMENT",)


def _assert_inert(got):
    assert got["moved"] == [], f"env vars were moved: {got['moved'][:8]}"
    assert got["patched"] == [], f"primitives were patched: {got['patched']}"
    assert got["outcome"] == {
        "sqlite3.connect": None, "open": None, "os.makedirs": None}


# ── (a) a deployed service: importing conftest changes nothing ───────────────

@pytest.mark.parametrize("signal", SIGNALS)
def test_a_importing_conftest_in_a_deployed_service_is_inert(tmp_path, signal):
    got = _probe(tmp_path, {signal: "production"})
    _assert_inert(got)


# ── (b) the control: without the signal the SAME probe is pinned and armed ───

def test_b_control_without_a_railway_variable_the_guard_pins_and_arms(tmp_path):
    got = _probe(tmp_path)
    assert "AUTH_DB_PATH" in got["moved"]
    assert len(got["moved"]) > 50, got["moved"]
    assert "NOTE_IMPORT_RESERVE_BYTES" in got["moved"]
    assert set(got["patched"]) >= {
        "sqlite3.connect", "sqlite3.dbapi2.connect", "builtins.open", "io.open",
        "os.makedirs", "os.mkdir", "os.remove", "os.unlink", "os.rename",
        "os.replace"}
    assert got["outcome"] == {
        "sqlite3.connect": "SharedDataRootWrite",
        "open": "SharedDataRootWrite",
        "os.makedirs": "SharedDataRootWrite"}
    assert got["inert_lines"] == [], "a developer machine must stay silent"


# ── (c) a pytest run on a Railway-like box is still guarded ──────────────────

PYTEST_FILE = r'''
import os, sqlite3, sys
sys.path.insert(0, {root!r})
import conftest


def test_the_guard_is_armed_under_pytest_even_with_a_railway_variable():
    assert os.environ.get("RAILWAY_ENVIRONMENT") == "production"
    assert getattr(sqlite3.connect, "_uct_guarded", False)
    assert os.environ["AUTH_DB_PATH"] == conftest.ISOLATED_AUTH_DB
    assert len(conftest.SHARED_ROOT_ENV_REDIRECTS) > 50
    probe = {probe!r}
    with conftest.captured_shared_root_attempts() as seen:
        with conftest.pretend_shared_root(probe):
            try:
                sqlite3.connect(os.path.join(probe, "p.db"))
            except conftest.SharedDataRootWrite:
                pass
            else:
                raise AssertionError("the tripwire did not fire")
    assert len(seen["writes"]) == 1
'''


def test_c_under_pytest_the_guard_still_arms_with_a_railway_variable(tmp_path):
    probe_dir = tmp_path / "pretend_shared_root"
    probe_dir.mkdir()
    test_file = tmp_path / "test_tiny_probe.py"
    test_file.write_text(
        PYTEST_FILE.format(root=str(ROOT), probe=str(probe_dir)),
        encoding="utf-8")
    out = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
         "--rootdir", str(tmp_path), str(test_file)],
        cwd=str(tmp_path), env=_env({"RAILWAY_ENVIRONMENT": "production"}),
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=600)
    tail = (out.stdout + out.stderr)[-3000:]
    assert out.returncode == 0, tail
    assert "1 passed" in out.stdout, tail
    assert INERT_MARKER not in out.stderr, tail


# ── (d) the one line, and it names the importer ──────────────────────────────

def test_d_exactly_one_stderr_line_and_it_names_the_importing_module(tmp_path):
    via_dir = tmp_path / "importer"
    via_dir.mkdir()
    (via_dir / "uct_probe_importer.py").write_text(
        "import conftest  # noqa: F401\n", encoding="utf-8")
    got = _probe(tmp_path, {"RAILWAY_SERVICE_NAME": "web"},
                 via="uct_probe_importer", via_dir=str(via_dir))
    _assert_inert(got)
    assert len(got["inert_lines"]) == 1, got["inert_lines"]
    line = got["inert_lines"][0]
    assert "uct_probe_importer" in line, line
    assert "RAILWAY_SERVICE_NAME" in line, line


# ── the holes a simpler predicate leaves open ────────────────────────────────

def test_pytest_being_importable_is_not_a_pytest_run(tmp_path):
    """conftest itself imports pytest, so "pytest is in sys.modules" becomes
    true in the live process the moment the inert import finishes. A reload,
    or anything else that imported pytest first, must not arm the guard."""
    got = _probe(tmp_path, {"RAILWAY_ENVIRONMENT": "production"},
                 preimport_pytest=True, reload=True)
    _assert_inert(got)


def test_no_environment_variable_on_the_service_can_re_arm_it(tmp_path):
    got = _probe(tmp_path, {
        "RAILWAY_ENVIRONMENT": "production",
        "PYTEST_CURRENT_TEST": "tests/x.py::test_y (call)",
        "PYTEST_VERSION": "8.3.4",
        "UCT_TEST_SHARED_ROOT_GUARD": "enforce"})
    _assert_inert(got)


def test_the_second_belt_arming_directly_is_refused_in_a_deployed_service(tmp_path):
    got = _probe(tmp_path, {"RAILWAY_DEPLOYMENT_ID": "d-123"}, call_arm=True)
    _assert_inert(got)


# ── the signal list is the codebase's own, not a second opinion ──────────────

def test_the_signals_are_the_ones_the_product_already_relies_on():
    ours = _railway_identity_env(ROOT / "conftest.py", "_RAILWAY_IDENTITY_ENV")
    theirs = _railway_identity_env(
        ROOT / "api" / "services" / "journal_two" / "ai_actions.py",
        "RAILWAY_IDENTITY_ENV")
    assert set(ours) == set(theirs)
    assert "RAILWAY_ENVIRONMENT" in ours        # auth.COOKIE_SECURE, vendor_socket_guard
    # ⛔ never the volume path: the census PINS that one, so a sandbox carries it.
    assert "RAILWAY_VOLUME_MOUNT_PATH" not in ours
    assert "RAILWAY_VOLUME_MOUNT_PATH" in rootconf.SHARED_DATA_ENV_PINS
