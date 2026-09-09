"""Rails on the joystick-hub device sandbox launcher.

⛔ WHY THIS FILE EXISTS. `scripts/hub-sandbox.ps1` set `DATA_DIR`, reported a
clean startup and a healthy `/api/health`, and wrote to the LIVE
`C:\\data\\auth.db` (1.01 GB, ~20,640 real members), `desk.db`, `flow.db` and
`buzz.db`. Nothing failed and nothing warned. `DATA_DIR` is one of 72 env vars
that name paths inside the shared root, and the other 71 resolve independently
of it.

Two defects, two rails:

  1. THE PIN LIST WAS TYPED, so it was incomplete (1 of 72). The launcher now
     derives it from `conftest.shared_data_root_census()`; `test_every_census_
     pin_lands_in_the_sandbox` proves the derivation is actually APPLIED, and
     `test_the_launcher_hard_codes_no_shared_root_path` proves nobody has
     quietly reintroduced a typed one.

  2. A KILL-SWITCH NAME WAS INVENTED. The script set `BARS_PREWARM_DISABLED=1`,
     which matches nothing in the codebase, so the bars seeder ran against live
     data. `test_every_kill_list_flag_is_read_somewhere` greps every flag name
     to a real read site. ⭐ This is the rail that would have caught it, and it
     generalises: an env var nobody reads is indistinguishable from a working
     kill switch, because both produce silence.

Every test carries a NON-VACUITY CONTROL — a mutation asserted to fail — because
a rail that cannot go red is not a rail (`lesson_gate_that_cannot_fail`).
"""

import ast
import importlib.util
import io
import os
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_launcher():
    """Import `scripts/hub_sandbox_boot.py` by path (not a package)."""
    path = os.path.join(REPO_ROOT, "scripts", "hub_sandbox_boot.py")
    spec = importlib.util.spec_from_file_location("hub_sandbox_boot", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def launcher():
    return _load_launcher()


@pytest.fixture
def restore_env():
    """`apply_sandbox_env` mutates `os.environ` for the whole process."""
    saved = dict(os.environ)
    yield
    os.environ.clear()
    os.environ.update(saved)


# ─────────────────────────────────────────────────────────────────────────────
#  Rail 1 — every derived pin is actually applied, and lands OUTSIDE C:\data
# ─────────────────────────────────────────────────────────────────────────────

def test_every_census_pin_lands_in_the_sandbox(launcher, restore_env, tmp_path):
    """All 72 pins point inside the sandbox; none survives pointing at /data."""
    import conftest

    sandbox = str(tmp_path / "sbx")
    pins = launcher.apply_sandbox_env(
        sandbox, test_email="rail@local.dev", reclaim_conftest_temp=False,
    )

    census = conftest.SHARED_DATA_ENV_PINS
    assert census, "census returned no pins — the AST walk is broken"

    missing = sorted(set(census) - set(pins))
    assert not missing, (
        f"{len(missing)} census pin(s) the launcher never applied: {missing}\n"
        "Each one resolves to C:\\data at runtime."
    )

    sandbox_norm = os.path.normcase(os.path.abspath(sandbox))
    escaped = {}
    for var in census:
        value = os.environ.get(var)
        if value is None:
            escaped[var] = "<unset>"
            continue
        full = os.path.normcase(os.path.abspath(value))
        if not (full == sandbox_norm or full.startswith(sandbox_norm + os.sep)):
            escaped[var] = value
    assert not escaped, (
        f"{len(escaped)} pinned var(s) resolve OUTSIDE the sandbox: {escaped}"
    )

    # Non-vacuity control: the assertion above must be able to see an escape.
    # Drop one pin the way a regression would and confirm it is detected.
    os.environ["AUTH_DB_PATH"] = r"C:\data\auth.db"
    leaked = os.path.normcase(os.path.abspath(os.environ["AUTH_DB_PATH"]))
    assert not leaked.startswith(sandbox_norm + os.sep), (
        "CONTROL FAILED: the escape check cannot distinguish C:\\data from the "
        "sandbox, so a green result above proves nothing."
    )


def test_the_shared_root_tripwire_is_armed_by_the_launcher(launcher, restore_env,
                                                           tmp_path):
    """A redirect alone cannot cover default-argument sites; the guard must fire.

    `def __init__(self, db_path="/data/flow.db")` reads no env var, so there is
    nothing for a pin to move. Only the tripwire covers those — and `conftest`
    itself records two such sites (`api/flow_db.py`, `api/baselines.py`).
    """
    import conftest

    launcher.apply_sandbox_env(
        str(tmp_path / "sbx"), reclaim_conftest_temp=False,
    )

    assert getattr(__import__("sqlite3").connect, "_uct_guarded", False), (
        "sqlite3.connect is not wrapped — the tripwire is not armed"
    )

    # Prove it FIRES, against a throwaway probe directory, never C:\data.
    #
    # ⭐ `captured_shared_root_attempts` is load-bearing, not tidiness: a rail
    # that watches the guard fire produces violations ON PURPOSE, and the
    # session-finish check would then fail the run on the very proof that the
    # run is clean. This takes ownership of the records instead of leaving them
    # in the session tally.
    probe = tmp_path / "probe_root"
    probe.mkdir()
    with conftest.captured_shared_root_attempts() as taken:
        with conftest.pretend_shared_root(str(probe)):
            with pytest.raises(conftest.SharedDataRootWrite):
                io.open(str(probe / "should_not_exist.db"), "w").close()

    assert not (probe / "should_not_exist.db").exists()
    assert len(taken["writes"]) == 1, (
        "the guard raised but recorded nothing — and THE RECORD IS THE GUARD. "
        "A daemon thread's raise reaches threading.excepthook and vanishes; "
        "only the record survives to be reported."
    )


# ─────────────────────────────────────────────────────────────────────────────
#  Rail 2 — no typed paths, and no invented flag names
# ─────────────────────────────────────────────────────────────────────────────

def _launcher_source():
    path = os.path.join(REPO_ROOT, "scripts", "hub_sandbox_boot.py")
    return io.open(path, encoding="utf-8").read()


def test_the_launcher_hard_codes_no_shared_root_path():
    """The pin list is DERIVED. A typed `/data/...` literal is the old defect.

    Scans string CONSTANTS in the AST, so the prose in the module docstring and
    the comments — which necessarily quote `/data/auth.db` to explain the
    incident — cannot false-positive this.
    """
    import conftest

    tree = ast.parse(_launcher_source())
    docstrings = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef,
                             ast.ClassDef)):
            doc = ast.get_docstring(node, clean=False)
            if doc:
                docstrings.add(doc)

    offenders = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Constant):
            continue
        if not conftest._is_shared_literal(node.value):
            continue
        if node.value in docstrings:
            continue
        offenders.append((node.lineno, node.value))

    assert not offenders, (
        "hub_sandbox_boot.py contains typed shared-root path literal(s): "
        f"{offenders}\nThe pin list must be derived from the census, never "
        "restated — a second authority over one value is what caused the "
        "incident this file exists to prevent."
    )

    # Non-vacuity control: the detector must actually recognise such a literal.
    assert conftest._is_shared_literal("/data/auth.db"), (
        "CONTROL FAILED: the detector does not recognise a shared-root literal, "
        "so the empty result above proves nothing."
    )


def _source_files():
    """Every product/tooling Python file a flag could plausibly be read in."""
    for root in ("api", "scripts", "tools"):
        base = os.path.join(REPO_ROOT, root)
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames
                           if d not in ("__pycache__", "node_modules")]
            for name in filenames:
                if name.endswith(".py"):
                    yield os.path.join(dirpath, name)


def test_every_kill_list_flag_is_read_somewhere(launcher):
    """⭐ THE RAIL THAT WOULD HAVE CAUGHT `BARS_PREWARM_DISABLED`.

    That flag was set by the sandbox script for weeks and matches NOTHING in the
    codebase — it was invented and never verified, so the bars seeder ran against
    live data while the operator believed it was disabled.

    An env var nobody reads is indistinguishable from a working kill switch:
    both produce silence. So every name must resolve to a real read site.
    """
    haystack = []
    for path in _source_files():
        try:
            haystack.append(io.open(path, encoding="utf-8", errors="replace").read())
        except OSError:
            continue
    blob = "\n".join(haystack)
    assert "AUTH_DB_PATH" in blob, "corpus did not load — the check is vacuous"

    unread = sorted(f for f in launcher.KILL_LIST if f not in blob)
    assert not unread, (
        f"{len(unread)} kill-list flag(s) are read NOWHERE in api/, scripts/ or "
        f"tools/: {unread}\n"
        "Setting one of these is a no-op that reads as protection. Grep every "
        "kill-switch name to an actual read site before adding it."
    )

    # Non-vacuity control: an obviously fake name must be reported as unread.
    assert "BARS_PREWARM_DISABLED_XYZZY" not in blob, (
        "CONTROL FAILED: the corpus matches an invented flag name, so the empty "
        "result above proves nothing."
    )


def test_the_seeder_gate_is_the_one_the_code_actually_reads(launcher):
    """`USE_REMOTE_BARS` is the ONLY gate on the bars seeder.

    `api/main.py` calls `bars_seeder.start_background_seeder()` unless
    `USE_REMOTE_BARS == "1"`, and `start_background_seeder` has no flag of its
    own. Pinned here because the previous script gated it on a name that did not
    exist, and the failure mode is a thread writing to production bars.
    """
    assert launcher.KILL_LIST.get("USE_REMOTE_BARS") == "1"

    main_src = io.open(os.path.join(REPO_ROOT, "api", "main.py"),
                       encoding="utf-8", errors="replace").read()
    assert "start_background_seeder" in main_src
    idx = main_src.index("start_background_seeder")
    window = main_src[max(0, idx - 800):idx]
    assert "USE_REMOTE_BARS" in window, (
        "The seeder's call site no longer gates on USE_REMOTE_BARS. The sandbox "
        "kill-list is now wrong — find the new gate and update it."
    )
