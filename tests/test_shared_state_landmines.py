r"""Rails on the three shared-state landmines that made every run order-dependent.

Each test here exists because the thing it guards was measured broken:

  1. Three test modules installed a two-lambda `api.flow_admin_auth` stub into
     `sys.modules` at IMPORT time and never removed it, so the first importer
     decided what every other test in the process bound. Measured:
     `pytest test_flow_classification.py test_flow_proxy_auth.py` = 7 failed;
     the same two files reversed = 27 passed.

  2. `AUTH_DB_PATH` was unset and `C:\data` exists on this box, so every
     auth-touching test wrote to ONE persistent shared file (20,640 users)
     that survived runs — the trapdoor under every "newest row" query.

  3. That shared file holds 38/100/58-row clusters stamped at exactly
     `…:00.000000` and dated into the FUTURE, which `create_user`'s
     microsecond clock cannot produce. The rail here is the narrow, provable
     half: nothing in THIS process may write one.

⚠️ Structural rails only — read off the AST, and off the connection the product
actually opens. Nothing here asserts on a proxy for the artifact.
"""

import ast
import os
import sqlite3
import uuid
from pathlib import Path

import pytest

# ⚠️ IMPORTED AT MODULE LEVEL ON PURPOSE, and the rails below depend on it.
# `auth_db` reads `AUTH_DB_PATH` ONCE, at import — so importing it here, during
# collection, reproduces what every other test module in this repo does, and is
# the only way these rails can observe a failure. Deferring the import into the
# test bodies would let the per-test `monkeypatch.setenv` land first and the
# rails would pass under an isolation that reaches nothing (measured: with the
# import deferred, removing the conftest fix left them GREEN).
from api.services import auth_db, auth_service  # noqa: E402

# ⭐ CAPTURED AT *THIS MODULE'S* IMPORT, WHICH IS COLLECTION TIME.
#
# pytest completes collection before it runs a single test body, and every
# rebinding of `auth_db._DB_PATH` in this repo lives inside a function (measured
# — see `test_the_connection_...` below). So this value is the path the six
# import-time readers captured, observed before anything could move it, and an
# assertion on it is ORDER-INDEPENDENT in a way an assertion on the live
# connection is not.
_DB_PATH_AT_IMPORT = auth_db._DB_PATH

REPO = Path(__file__).resolve().parents[1]


# ─── 1. the sys.modules stub ────────────────────────────────────────────────

def _test_module_files():
    """Every pytest-collected module in the repo, derived by walking the tree."""
    out = []
    for base in (REPO / "tests", REPO / "api"):
        for p in base.rglob("*.py"):
            if "__pycache__" in p.parts or "node_modules" in p.parts:
                continue
            if p.name.startswith("test_") or p.name.endswith("_test.py"):
                out.append(p)
    return out


def _module_level_sys_modules_binds(path: Path):
    """AST, never grep: module-level statements that BIND into `sys.modules`.

    A bind is `sys.modules.setdefault(...)`, `sys.modules.update(...)` or
    `sys.modules[...] = ...`. Deletion is NOT a bind — evicting a stub is
    cleanup, and forbidding it would forbid the fix.

    Depth is tracked, so a bind inside a function or fixture (which something
    can undo) does not read as an import-time one (which nothing can).
    """
    tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"), str(path))
    hits = []

    def is_sys_modules(node) -> bool:
        return (isinstance(node, ast.Attribute) and node.attr == "modules"
                and isinstance(node.value, ast.Name) and node.value.id == "sys")

    def walk(node, depth):
        for child in ast.iter_child_nodes(node):
            deeper = depth + 1 if isinstance(
                child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) else depth
            if depth == 0:
                if isinstance(child, ast.Call) and isinstance(child.func, ast.Attribute) \
                        and child.func.attr in ("setdefault", "update") \
                        and is_sys_modules(child.func.value):
                    hits.append((child.lineno, f"sys.modules.{child.func.attr}"))
                if isinstance(child, ast.Assign):
                    for tgt in child.targets:
                        if isinstance(tgt, ast.Subscript) and is_sys_modules(tgt.value):
                            hits.append((child.lineno, "sys.modules[...] ="))
            walk(child, deeper)

    walk(tree, 0)
    return hits


def test_no_test_module_binds_into_sys_modules_at_import_time():
    """The stub cannot come back — in any test module, not just the three.

    A module-level bind into `sys.modules` is global state installed by an
    import and removable by nobody. Whether it wins is decided by collection
    order, which is why the same two files passed 27 and failed 7 depending
    only on which one came first.
    """
    offenders = []
    for path in _test_module_files():
        for lineno, kind in _module_level_sys_modules_binds(path):
            offenders.append(f"{path.relative_to(REPO)}:{lineno}  {kind}")
    assert offenders == [], (
        "import-time sys.modules bind(s) — install AND remove it in a fixture, "
        "or delete the stub if the reason for it has expired:\n  "
        + "\n  ".join(offenders)
    )


def test_the_flow_router_tests_bind_the_real_flow_admin_auth():
    """The stub's stated reason — "the auth chain pulls bcrypt" — has expired.

    If this ever fails, the stub was NOT vestigial after all, and the fix is a
    fixture that installs AND removes it, never a bare `setdefault`.
    """
    import importlib

    mod = importlib.import_module("api.flow_admin_auth")
    for name in ("require_flow_admin", "require_flow_user", "_proxy_trusted_user"):
        assert hasattr(mod, name), f"api.flow_admin_auth is missing {name} — a stub?"


# ─── 2. the shared auth.db ──────────────────────────────────────────────────

def _user_count(path: str):
    """Users in `path`. None when the file does not exist; raises when it does
    but cannot be read — a rail that silently skips is a rail that cannot fail."""
    if not os.path.exists(path):
        return None
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=10)
    try:
        return con.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    finally:
        con.close()


def _attached_main_db() -> str:
    """The file `auth_db` ACTUALLY opens — asked of the live connection.

    Not `os.environ`, not `auth_db._DB_PATH`, not what a fixture intended:
    `PRAGMA database_list` is the artifact.
    """
    con = auth_db.get_connection()
    try:
        main = [r[2] for r in con.execute("PRAGMA database_list") if r[1] == "main"]
    finally:
        con.close()
    assert len(main) == 1, f"expected one main database, got {main!r}"
    return main[0]


def _module_level_auth_db_path_assignments():
    """AST, never grep: collected test modules that set `AUTH_DB_PATH` at IMPORT.

    This is the census that decides whether the rail below can be stated in its
    strong form. A module-level `os.environ["AUTH_DB_PATH"] = …` is captured by
    the six import-time readers if pytest imports that module before
    `api.services.auth_db` — so a single one of these makes "always MY store"
    depend on collection order. Depth is tracked so an assignment inside a
    fixture or a test body (which monkeypatch or a `finally` can undo, and which
    cannot beat conftest to the import) is not counted.
    """
    hits = []

    def is_environ_key(node, key):
        return (isinstance(node, ast.Subscript)
                and isinstance(node.value, ast.Attribute)
                and node.value.attr == "environ"
                and isinstance(node.slice, ast.Constant)
                and node.slice.value == key)

    for path in _test_module_files():
        tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"), str(path))

        def walk(node, depth):
            for child in ast.iter_child_nodes(node):
                deeper = depth + 1 if isinstance(
                    child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) else depth
                if depth == 0:
                    if isinstance(child, ast.Assign) and any(
                            is_environ_key(t, "AUTH_DB_PATH") for t in child.targets):
                        hits.append(f"{path.relative_to(REPO)}:{child.lineno}")
                    if (isinstance(child, ast.Call)
                            and isinstance(child.func, ast.Attribute)
                            and child.func.attr == "setdefault"
                            and isinstance(child.func.value, ast.Attribute)
                            and child.func.value.attr == "environ"
                            and child.args
                            and isinstance(child.args[0], ast.Constant)
                            and child.args[0].value == "AUTH_DB_PATH"):
                        hits.append(f"{path.relative_to(REPO)}:{child.lineno} (setdefault)")
                walk(child, deeper)

        walk(tree, 0)
    return sorted(hits)


def test_no_collected_test_module_claims_AUTH_DB_PATH_at_import_time():
    """The precondition of the strong rail below, asserted separately.

    ⚠️ THIS IS WHY THE RAIL BELOW COULD ONLY EVER SAY "NEVER THE SHARED STORE".
    `tests/test_auth_last_login_throttle.py:19` did exactly this — a temp file,
    so nothing leaked, but it meant `auth_db._DB_PATH` for the whole session was
    decided by which module pytest imported first. Deleted rather than fixtured:
    the repo-root `conftest.py` already mints one isolated store before any test
    module is imported, so the assignment had nothing left to buy.

    Kept as its OWN test rather than folded into the rail, so a regression names
    the file and line instead of reporting a mismatched path.
    """
    offenders = _module_level_auth_db_path_assignments()
    assert offenders == [], (
        "a collected test module sets AUTH_DB_PATH at import time:\n  "
        + "\n  ".join(offenders)
        + "\nThe repo-root conftest.py owns this value. A module-level assignment "
          "here races it: whichever import lands first decides what all six "
          "import-time readers capture, which is precisely the order-dependence "
          "these rails exist to remove. Point the test at `isolated_auth_db` (or "
          "monkeypatch the module ATTRIBUTE inside a fixture) instead.")


def _reload_sites_of_authdb_capturers():
    """Every `importlib.reload(...)` of a module that reads `AUTH_DB_PATH` at
    import — the shape that rebinds the attribute and that NOTHING can undo.

    AST, never grep, and the alias is resolved from the file's own imports so
    `reload(adb)` and `reload(auth_db)` both count. This is a MEASUREMENT used to
    explain the boundary between the two rails below; it is deliberately not an
    assertion on the count, which would be a ratchet on 41 files owned by other
    work.
    """
    capturers = {"auth_db", "regime_snapshots", "bar_provenance",
                 "bar_quarantine", "bars_audit", "indicator_alert_service"}
    conftests = [p for base in (REPO / "tests", REPO / "api")
                 for p in base.rglob("conftest.py")
                 if "__pycache__" not in p.parts]
    sites = []
    for path in _test_module_files() + conftests:
        if not path.exists():
            continue
        tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"), str(path))
        alias = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for a in node.names:
                    alias[a.asname or a.name.split(".")[0]] = a.name
            elif isinstance(node, ast.ImportFrom):
                for a in node.names:
                    alias[a.asname or a.name] = (
                        f"{node.module}.{a.name}" if node.module else a.name)
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "reload" and node.args):
                arg = ast.unparse(node.args[0])
                if alias.get(arg, arg).split(".")[-1] in capturers:
                    sites.append(f"{path.relative_to(REPO)}:{node.lineno}")
    return sorted(sites)


def test_the_path_the_product_CAPTURED_AT_IMPORT_is_the_sessions_own_store(
        isolated_auth_db, shared_auth_db_path):
    """⭐ THE "ALWAYS MY STORE" FORM, STATED WHERE IT ACTUALLY HOLDS.

    `auth_db._DB_PATH` is read ONCE, at import, so what matters is what it read
    THEN. `tests/test_auth_last_login_throttle.py:19` used to assign
    `os.environ["AUTH_DB_PATH"]` at ITS import, so whichever module pytest
    imported first decided this value — and the rail could only manage the weaker
    "never the SHARED store" (measured at the time: 3 failed / 5 passed on the
    strong form, depending purely on order). With that assignment deleted and the
    repo-root conftest owning the value, the strong form holds, and it holds
    ORDER-INDEPENDENTLY: pytest finishes collection before it runs a test body,
    and every rebinding in this repo happens inside one.

    "Not the shared store" is satisfied by ANY file. This says it is MINE, which
    is what keeps the six import-time readers and the seven per-call journal_two
    readers pointed at one database instead of two.
    """
    assert os.path.normcase(os.path.abspath(_DB_PATH_AT_IMPORT)) == \
        os.path.normcase(os.path.abspath(isolated_auth_db)), (
            f"at import, auth_db captured {_DB_PATH_AT_IMPORT!r} rather than this "
            f"session's store {isolated_auth_db!r} — something set AUTH_DB_PATH "
            "before the repo-root conftest, or instead of it")
    assert os.path.normcase(os.path.abspath(_DB_PATH_AT_IMPORT)) != \
        os.path.normcase(os.path.abspath(shared_auth_db_path))


def test_the_connection_the_product_opens_is_never_the_shared_store(shared_auth_db_path):
    """The LIVE connection — `PRAGMA database_list`, not the env var, not
    `auth_db._DB_PATH`, not what a fixture intended.

    ⚠️ THIS ONE STAYS AT "NEVER THE SHARED STORE", AND THE REASON IS MEASURED
    RATHER THAN ASSUMED. 45 sites across 41 collected test files call
    `importlib.reload()` on a module that captures `AUTH_DB_PATH` at import
    (`_reload_sites_of_authdb_capturers` derives the list). A reload re-executes
    the module body under whatever the env var says AT THAT MOMENT, so the
    attribute moves to that test's `tmp_path` — and `monkeypatch` unwinds the env
    var but CANNOT unwind a reload. Every later test in the process therefore
    opens an earlier test's temp file until the next reload moves it again.

    That is a split session, not a leak: each of those paths is still isolated,
    so the shared store stays untouched, which is exactly what this rail asserts
    and all it can honestly assert. The durable fix is a per-test restore of the
    attribute in `tests/conftest.py`, which is a change to 41 other files' worth
    of behaviour and is deliberately not made here.
    """
    attached = os.path.normcase(os.path.abspath(_attached_main_db()))
    sites = _reload_sites_of_authdb_capturers()
    assert sites, (
        "no reload sites found — then the weaker form below is no longer "
        "justified and this rail should be strengthened to 'always my store'")
    assert attached != os.path.normcase(os.path.abspath(shared_auth_db_path)), (
        f"auth_db opened the SHARED store {attached!r}")


def test_creating_users_leaves_the_shared_auth_db_untouched(shared_auth_db_path):
    """The count in the SHARED file must not move while a test creates users."""
    try:
        before = _user_count(shared_auth_db_path)
    except sqlite3.Error as e:  # locked by a concurrent run — say so, don't pass
        pytest.skip(f"shared store {shared_auth_db_path} unreadable: {e}")

    auth_db.init_db()
    made = [auth_service.create_user(f"landmine_{uuid.uuid4()}@example.com", "pw")["id"]
            for _ in range(3)]

    after = _user_count(shared_auth_db_path)
    assert after == before, (
        f"the shared store {shared_auth_db_path} moved {before} -> {after} while "
        "a test created users — the AUTH_DB_PATH isolation is nominal, not real")

    if before is not None:
        con = sqlite3.connect(f"file:{shared_auth_db_path}?mode=ro", uri=True, timeout=10)
        try:
            q = ",".join("?" * len(made))
            leaked = con.execute(f"SELECT id FROM users WHERE id IN ({q})", made).fetchall()
        finally:
            con.close()
        assert leaked == [], f"rows written here landed in {shared_auth_db_path}: {leaked}"

    # …and they ARE in the file auth_db is attached to, so this cannot pass
    # because nothing was written at all.
    con = sqlite3.connect(_attached_main_db(), timeout=10)
    try:
        q = ",".join("?" * len(made))
        here = con.execute(
            f"SELECT COUNT(*) FROM users WHERE id IN ({q})", made).fetchone()[0]
    finally:
        con.close()
    assert here == len(made), "the users went somewhere that is neither store"


# ─── 3. the fabricated, future-dated clock ──────────────────────────────────

def test_create_user_stamps_a_real_advancing_clock():
    """`create_user` is the ONLY writer of `users.created_at` in this repo.

    The shared store holds whole-minute clusters dated ahead of today, which
    this expression cannot produce. Three users created in a row must therefore
    carry three DIFFERENT stamps (a frozen clock makes them identical), none of
    them in the future.
    """
    from datetime import datetime, timedelta, timezone

    auth_db.init_db()
    ids = [auth_service.create_user(f"clock_{uuid.uuid4()}@example.com", "pw")["id"]
           for _ in range(3)]
    con = sqlite3.connect(_attached_main_db(), timeout=10)
    try:
        q = ",".join("?" * len(ids))
        stamps = [r[0] for r in con.execute(
            f"SELECT created_at FROM users WHERE id IN ({q})", ids)]
    finally:
        con.close()

    assert len(set(stamps)) == len(stamps), (
        f"three consecutive create_user calls share a stamp: {stamps} — the "
        "clock is frozen, which is how the shared store got its …:00.000000 rows")
    horizon = datetime.now(timezone.utc) + timedelta(minutes=1)
    for s in stamps:
        parsed = datetime.strptime(s, "%Y-%m-%d %H:%M:%S.%f").replace(tzinfo=timezone.utc)
        assert parsed <= horizon, f"created_at {s} is in the future — a faked clock"
