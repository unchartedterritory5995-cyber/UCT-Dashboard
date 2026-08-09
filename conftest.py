"""Repo-root conftest — AUTH_DB_PATH isolation for EVERY collection root.

`tests/conftest.py` has installed this isolation since `021b4926`, and it works
— but a conftest only reaches the directory it lives in. There are 93 test files
under `api/**` (mixed `*_test.py` and `test_*.py`) with no conftest of their own,
so `pytest api/services/journal_two/test_trades.py` — or any run that does not
also collect `tests/` — got NO isolation at all and wrote straight into the real
store: `C:\\data\\auth.db`, 20,640 users deep and holding the owner's live j2_*
tables. Nothing surfaced that, because those 93 files were never in the suite.

⚠️ THIS MUST RUN AT CONFTEST IMPORT, NOT IN A FIXTURE. `AUTH_DB_PATH` is read
ONCE, at module import, by six product modules (auth_db,
awareness.regime_snapshots, bar_provenance, bar_quarantine, bars_audit,
indicator_alert_service) — `get_connection()` closes over the module global, not
over `os.environ` — so a `monkeypatch.setenv` in a fixture reaches none of them.
The repo-root conftest is imported before any other conftest and before any test
module, so nothing can capture the unisolated path ahead of it.

`tests/conftest.py` READS this value back rather than minting a second temp
store: two isolated stores in one session would split the six import-time
capturers from the seven journal_two modules that re-read per call.
"""
import ast
import os
import sys
import tempfile

import pytest

ISOLATED_AUTH_DB = os.path.join(
    tempfile.mkdtemp(prefix="uct_tests_authdb_"), "auth.db"
)
os.environ["AUTH_DB_PATH"] = ISOLATED_AUTH_DB


# ─── the SPLIT SESSION: a reload rebinds an import-time capture FOREVER ──────
#
# The block above pins the env var, and that is enough for the SEVEN
# `journal_two/*` modules that re-read `os.environ` on every call. It is NOT
# enough for the SIX modules that read it once at import, because ~45 fixtures
# in this repo do:
#
#     monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
#     importlib.reload(auth_db)          # ← re-executes `_DB_PATH = environ...`
#
# `monkeypatch` unwinds the ENV VAR at teardown. Nothing unwinds the RELOAD.
# `auth_db._DB_PATH` keeps pointing at that fixture's scratch file for the rest
# of the session, so from the next test onwards the process is running SPLIT:
# the import-time readers open one file, the per-call readers open another.
#
# MEASURED, and this is the whole defect:
#
#     pytest tests/theme_engine/test_store.py tests/test_compass_voice_bridge.py
#       → 4 failed  ·  sqlite3.OperationalError: no such table: j2_chat_messages
#     pytest tests/test_compass_voice_bridge.py
#       → 6 passed
#
# The victim calls `auth_db.init_db()` — which builds the j2_* schema in the
# STALE scratch file — then reads it back through
# `coach_chat._conn()`, which re-reads the env var and opens the ISOLATED store,
# where nothing ever created that table. Neither half is wrong on its own; they
# are simply looking at two different files. Any ordering that puts a reloading
# fixture before a mixed reader reproduces it, which is why the suite failed
# order-dependently and named a different victim each time.
#
# So the invariant this restores, before EVERY test, is:
#
#     every import-time AUTH_DB_PATH capturer agrees with os.environ["AUTH_DB_PATH"]
#
# ⚠️ SETUP, not teardown. A repair at teardown would have to run before the
# test's own `monkeypatch` unwound, and fixture finalisation order is not ours
# to rely on. Repairing at setup needs no ordering guarantee at all: a test that
# wants its own store still reloads afterwards and still wins.
#
# ⚠️ The module list is DERIVED BY AST, never typed. A seventh import-time
# reader added tomorrow is picked up for free, and
# `tests/test_order_dependence_rails.py` fails BY MODULE NAME if this census
# ever stops finding one that exists.

_REPO_ROOT = os.path.dirname(os.path.abspath(__file__))


def auth_db_path_capturers():
    """Every `api/**` module that binds a module-level global from AUTH_DB_PATH.

    Returns `[(dotted_module_name, attribute_name), ...]`, read off the AST of
    each file rather than grepped, so a mention inside a docstring, a comment or
    a function body cannot be mistaken for an import-time capture. Depth is
    implicit: only `tree.body` is walked, which is module level by definition.
    """
    found = []
    api_root = os.path.join(_REPO_ROOT, "api")
    for dirpath, dirnames, filenames in os.walk(api_root):
        dirnames[:] = [d for d in dirnames
                       if d not in ("__pycache__", "node_modules")]
        for name in filenames:
            if not name.endswith(".py"):
                continue
            if name.startswith("test_") or name.endswith("_test.py"):
                continue
            path = os.path.join(dirpath, name)
            try:
                src = open(path, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            if "AUTH_DB_PATH" not in src:          # cheap pre-filter only
                continue
            try:
                tree = ast.parse(src, path)
            except SyntaxError:
                continue
            for node in tree.body:
                if isinstance(node, ast.Assign):
                    targets, value = node.targets, node.value
                elif isinstance(node, ast.AnnAssign) and node.value is not None:
                    targets, value = [node.target], node.value
                else:
                    continue
                if not _reads_auth_db_path(value):
                    continue
                rel = os.path.relpath(path, _REPO_ROOT)
                dotted = rel[:-3].replace(os.sep, ".").replace("/", ".")
                for target in targets:
                    if isinstance(target, ast.Name):
                        found.append((dotted, target.id))
    return sorted(set(found))


def _reads_auth_db_path(value: ast.AST) -> bool:
    """True when this expression reads `os.environ` for `AUTH_DB_PATH`."""
    for sub in ast.walk(value):
        if isinstance(sub, ast.Call) and ast.unparse(sub.func).endswith("environ.get"):
            if sub.args and isinstance(sub.args[0], ast.Constant) \
                    and sub.args[0].value == "AUTH_DB_PATH":
                return True
        if isinstance(sub, ast.Subscript) and ast.unparse(sub.value).endswith("environ"):
            if isinstance(sub.slice, ast.Constant) and sub.slice.value == "AUTH_DB_PATH":
                return True
    return False


AUTH_DB_PATH_CAPTURERS = auth_db_path_capturers()


def repair_auth_db_capturers(path: str) -> list:
    """Re-pin every ALREADY-IMPORTED capturer to `path`. Returns what it moved.

    A module absent from `sys.modules` needs nothing — it will read the env var
    correctly whenever it is first imported.
    """
    moved = []
    for dotted, attr in AUTH_DB_PATH_CAPTURERS:
        mod = sys.modules.get(dotted)
        if mod is None:
            continue
        current = getattr(mod, attr, None)
        if current != path:
            setattr(mod, attr, path)
            moved.append((dotted, attr, current))
    return moved


@pytest.fixture(autouse=True)
def _auth_db_capturers_agree_with_the_env_var():
    """Undo, before every test, whatever the previous test's reload rebound.

    Lives in the ROOT conftest rather than `tests/conftest.py` because the 93
    test files under `api/**` reload `auth_db` more often than anything else in
    the repo and have no conftest of their own.
    """
    os.environ["AUTH_DB_PATH"] = ISOLATED_AUTH_DB
    repair_auth_db_capturers(ISOLATED_AUTH_DB)
    yield


# ─── the same wound, other env vars: put back what a reload moved ───────────
#
# `AUTH_DB_PATH` is the loudest instance, not the only one. Two more were
# MEASURED, each found only because the suite was run in a SECOND file order:
#
#   pytest tests/test_catalyst_tuning.py tests/test_catalyst_filters.py
#     -> EXIT 1 · 3 failed · assert '$3' in 'price $2.40 below $4 floor'
#   pytest tests/test_catalyst_filters.py tests/test_catalyst_tuning.py
#     -> EXIT 0 · 55 passed
#
# `catalyst/tuning.py:72` computes `_OVERRIDES_PATH` at import from
# `CATALYST_TUNING_OVERRIDES_PATH`, falling back to a directory derived from
# `store._DB_PATH`. `tests/test_catalyst_tuning.py` reloads both modules against
# a tmp dir and writes `{"CATALYST_MIN_PRICE": 4.5}` there. The reload is never
# undone, so every later test reads that leftover overrides file and the price
# floor is 4.5 instead of the 3.0 default.
#
# ⚠️ A RE-PIN CANNOT FIX THIS ONE, which is why it needs its own fixture rather
# than another entry in the census above. `_OVERRIDES_PATH`'s default is
# COMPUTED from another module's state, so there is no env var to read it back
# from. The only value that is certainly right is the one the global held
# BEFORE the test — so this snapshots and restores, where AUTH_DB_PATH re-pins.
#
# ⚠️ TEARDOWN here, SETUP there — deliberately. Restoring a snapshot must happen
# after the test; a root-conftest fixture is set up FIRST and therefore torn
# down LAST, so a test's own `monkeypatch` has already unwound by the time this
# runs and the comparison below sees no change. Only an UNDONE rebinding (a
# reload) is still standing, and only that gets put back.
#
# Scoped to PATH-SHAPED strings on purpose: those are the ones that silently
# redirect a store. Derived from the runtime value (does it contain a path
# separator), never from a typed list of names.


def env_derived_module_globals():
    """`[(dotted_module, attr), …]` for every `api/**` module-level global whose
    value is computed from `os.environ` at import. AST, never grep."""
    found = []
    api_root = os.path.join(_REPO_ROOT, "api")
    for dirpath, dirnames, filenames in os.walk(api_root):
        dirnames[:] = [d for d in dirnames
                       if d not in ("__pycache__", "node_modules")]
        for name in filenames:
            if not name.endswith(".py"):
                continue
            if name.startswith("test_") or name.endswith("_test.py"):
                continue
            path = os.path.join(dirpath, name)
            try:
                src = open(path, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            if "environ" not in src:              # cheap pre-filter only
                continue
            try:
                tree = ast.parse(src, path)
            except SyntaxError:
                continue
            rel = os.path.relpath(path, _REPO_ROOT)
            dotted = rel[:-3].replace(os.sep, ".").replace("/", ".")
            for node in tree.body:
                if isinstance(node, ast.Assign):
                    targets, value = node.targets, node.value
                elif isinstance(node, ast.AnnAssign) and node.value is not None:
                    targets, value = [node.target], node.value
                else:
                    continue
                if not any(isinstance(sub, (ast.Attribute, ast.Subscript, ast.Call))
                           and "environ" in ast.unparse(sub)
                           for sub in ast.walk(value)):
                    continue
                for target in targets:
                    if isinstance(target, ast.Name):
                        found.append((dotted, target.id))
    return sorted(set(found))


ENV_DERIVED_MODULE_GLOBALS = env_derived_module_globals()


def _looks_like_a_path(value) -> bool:
    return isinstance(value, str) and ("/" in value or os.sep in value)


def snapshot_env_derived_paths():
    """Every env-derived global that currently holds a path, with its value."""
    snap = []
    for dotted, attr in ENV_DERIVED_MODULE_GLOBALS:
        mod = sys.modules.get(dotted)
        if mod is None:
            continue
        value = getattr(mod, attr, None)
        if _looks_like_a_path(value):
            snap.append((mod, attr, value))
    return snap


def restore_env_derived_paths(snap) -> list:
    """Put back only what actually moved. Returns what it restored."""
    restored = []
    for mod, attr, old in snap:
        if getattr(mod, attr, None) != old:
            setattr(mod, attr, old)
            restored.append((mod.__name__, attr))
    return restored


@pytest.fixture(autouse=True)
def _env_derived_paths_survive_a_reload():
    snap = snapshot_env_derived_paths()
    yield
    restore_env_derived_paths(snap)


# ─── screener boot self-warm: OFF under pytest ─────────────────────────────
#
# `register_screener_jobs()` starts a `screener-warm` daemon thread that sleeps
# ~120s and then runs `snapshot_builder.run_build()` — real SQLite writes to the
# real `screener.db` and one UNCACHED Massive REST call per ticker, on whatever
# API key the developer's environment happens to hold.
#
# `tests/test_screener_schedule.py` calls that registration directly, and a full
# suite run lasts ~7 minutes — comfortably longer than the delay. So the thread
# WOULD wake mid-run and start hammering a live provider from a test process,
# with the writes landing outside any fixture's teardown. Setting the flag here
# (at conftest import, before any test module) makes the warm opt-IN: the tests
# that exercise it re-enable it explicitly with a stubbed builder and zero delay.
os.environ.setdefault("SCREENER_SNAPSHOT_WARM_ENABLED", "0")
