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


def test_the_connection_the_product_opens_is_never_the_shared_store(shared_auth_db_path):
    """`auth_db._DB_PATH` is read once, at import, so `setenv` proves nothing.

    ⚠️ The invariant is "never the SHARED store", not "always the session
    store". A handful of test modules (e.g.
    `tests/test_auth_last_login_throttle.py`) assign `os.environ["AUTH_DB_PATH"]`
    at their own import time, and whichever of those pytest imports first
    decides what `auth_db` captured — a per-module temp file is still
    isolation, so demanding OUR file here would make this rail itself
    order-dependent, which is the disease.
    """
    attached = _attached_main_db()
    assert os.path.normcase(os.path.abspath(attached)) != \
        os.path.normcase(os.path.abspath(shared_auth_db_path)), (
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
