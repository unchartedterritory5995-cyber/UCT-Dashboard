r"""The Notebook E2E sandbox must be fail-closed against the shared data root.

⛔ WHY THIS EXISTS. A 2026-09-05 E2E run believed `DATA_DIR`/`AUTH_DB_PATH`
isolation meant the whole server was sandboxed. It did not: `flow.db` /
`darkpool.db` resolve through their own separate env vars, so ordinary server
startup read the real, shared files (verified afterward to be read-only, but
the isolation itself had a real hole). This proves the fix two ways:

  1. `tools/audit_shared_root_probe.py`'s NEW strict mode actually REFUSES an
     access before it happens — not merely records it. Tested against
     THROWAWAY pretend roots (never real `C:\data`), the same technique
     `conftest.pretend_shared_root` uses for the pytest tripwire, so this file
     can prove the guard fires without going anywhere near production data.
  2. `tools/e2e_sandbox_launcher.py`'s `build_environment()` refuses to
     produce an environment at all when the chosen root is itself unsafe, and
     otherwise redirects every census-derivable shared-root pin (delegating to
     the already-covered `tools/audit_sandbox_env.py` — not re-tested here).

A test that only checks an env-var STRING after the fact is not enough (the
near-miss's own DATA_DIR/AUTH_DB_PATH were "correct" strings and the escape
still happened via a DIFFERENT var). Every UNSAFE case below asserts the
candidate file was never actually created on disk — proof the refusal landed
BEFORE the connect/open, not after.
"""
from __future__ import annotations

import os
import pathlib
import sqlite3
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "tools"))

import audit_shared_root_probe as probe  # noqa: E402
import e2e_sandbox_launcher as launcher  # noqa: E402


@pytest.fixture(autouse=True)
def _isolated_probe_state(tmp_path):
    """Every test gets its OWN pretend shared root — never the real one — and
    the probe's global state (install/strict/hits/roots) is fully reset after,
    so tests can never leak into each other or into anything else that
    imports this module in the same process."""
    pretend_root = tmp_path / "pretend_c_data"
    pretend_root.mkdir()
    previous_roots = list(probe.SHARED_ROOTS)
    probe.SHARED_ROOTS[:] = [str(pretend_root)]
    probe.reset_hits()
    yield pretend_root
    probe.uninstall()
    probe.SHARED_ROOTS[:] = previous_roots
    probe.reset_hits()


def test_SAFE_a_path_fully_outside_the_shared_root_connects_normally(tmp_path, _isolated_probe_state):
    """All required DB paths point into the temporary sandbox -> startup allowed."""
    probe.install(strict=True)
    safe_db = tmp_path / "sandboxed" / "auth.db"
    safe_db.parent.mkdir()

    conn = sqlite3.connect(str(safe_db))
    conn.execute("CREATE TABLE t (x INTEGER)")
    conn.commit()
    conn.close()

    assert safe_db.exists(), "a genuinely safe path must connect and create its file normally"
    assert probe.hits() == [], "no shared-root hit should have been recorded for a safe path"


def test_UNSAFE_flow_db_pointing_at_the_shared_root_is_refused_before_touching_it(_isolated_probe_state):
    pretend_root = _isolated_probe_state
    probe.install(strict=True)
    flow_db = pretend_root / "flow.db"

    with pytest.raises(probe.SharedDataRootAccessRefused):
        sqlite3.connect(str(flow_db))

    assert not flow_db.exists(), (
        "sqlite3.connect must be refused BEFORE it creates the file — "
        "finding the file on disk means the connection happened anyway")


def test_UNSAFE_darkpool_db_pointing_at_the_shared_root_is_refused(_isolated_probe_state):
    pretend_root = _isolated_probe_state
    probe.install(strict=True)
    darkpool_db = pretend_root / "darkpool.db"

    with pytest.raises(probe.SharedDataRootAccessRefused):
        sqlite3.connect(str(darkpool_db))

    assert not darkpool_db.exists()


def test_UNSAFE_primary_auth_notebook_db_pointing_at_the_shared_root_is_refused(_isolated_probe_state):
    pretend_root = _isolated_probe_state
    probe.install(strict=True)
    auth_db = pretend_root / "auth.db"

    with pytest.raises(probe.SharedDataRootAccessRefused):
        sqlite3.connect(str(auth_db))

    assert not auth_db.exists()


def test_UNSAFE_a_plain_open_call_is_also_refused_not_just_sqlite_connect(_isolated_probe_state):
    """The 2026-09-05 near-miss's OTHER touches (JSON files, CSV seeds) go
    through `open()`, not `sqlite3.connect()` — the guard must cover both."""
    pretend_root = _isolated_probe_state
    probe.install(strict=True)
    json_file = pretend_root / "liveflow_user_blocklist.json"

    with pytest.raises(probe.SharedDataRootAccessRefused):
        open(str(json_file), "w")

    assert not json_file.exists()


def test_a_READ_is_refused_too_not_just_a_write(_isolated_probe_state):
    """The actual 2026-09-05 incident was a READ (a dry-run SELECT COUNT and a
    read-only 'is the CSV newer' check) — both went through a PLAIN
    `sqlite3.connect()` call (this codebase never uses the `mode=ro` URI form
    for these paths), so a guard that only blocks writes would have let the
    real incident through unchanged. Simulates the file already existing (as
    it does on the real shared root), then proves the connect-to-read-it call
    is refused — the guard blocks at CONNECT, before any SELECT can run,
    regardless of what the caller intends to do with the connection."""
    pretend_root = _isolated_probe_state
    # Created OUTSIDE strict mode first (simulating "it already exists on the
    # real shared root"), mirroring the real incident's pre-existing flow.db.
    real_db = pretend_root / "cot.db"
    conn = sqlite3.connect(str(real_db))
    conn.execute("CREATE TABLE t (x INTEGER)")
    conn.commit()
    conn.close()

    probe.install(strict=True)
    with pytest.raises(probe.SharedDataRootAccessRefused):
        conn = sqlite3.connect(str(real_db))
        conn.execute("SELECT COUNT(*) FROM t").fetchone()


def test_uninstall_restores_the_real_functions(_isolated_probe_state):
    real_open, real_connect = open, sqlite3.connect
    probe.install(strict=True)
    assert sqlite3.connect is not real_connect
    probe.uninstall()
    assert sqlite3.connect is real_connect
    assert open is real_open


def test_non_strict_mode_records_but_does_not_raise(_isolated_probe_state):
    """The pre-existing audit-mode behavior must survive this change
    unaffected — strict is opt-in, never the silent default for a caller that
    doesn't ask for it."""
    pretend_root = _isolated_probe_state
    probe.install(strict=False)
    db = pretend_root / "flow.db"

    conn = sqlite3.connect(str(db))  # must NOT raise
    conn.close()

    assert db.exists()
    hits = probe.hits()
    assert len(hits) == 1
    assert hits[0]["kind"] == "sqlite3.connect"


# ─────────────────────────────────────────────────────────────────────────────
# tools/e2e_sandbox_launcher.py — the pre-flight root check + env assembly.
# `sandbox_env()` itself (every census pin redirected, refuses on a gap, the
# bare-root special case, the blank-not-absent webhooks) is already covered by
# tests/test_audit_sandbox_env.py — not re-tested here.
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad_root", ["C:/data", "C:\\data", "/data", "C:/data/"])
def test_build_environment_REFUSES_when_the_root_itself_is_the_shared_root(bad_root):
    with pytest.raises(SystemExit):
        launcher.build_environment(pathlib.Path(bad_root), "e2e@local.test")


def test_build_environment_produces_a_usable_env_for_a_real_sandbox_root(tmp_path):
    env = launcher.build_environment(tmp_path / "sandbox", "e2e@local.test")
    assert env["ADMIN_EMAILS"] == "e2e@local.test"
    assert "AUTH_DB_PATH" in env, "the primary auth/Notebook db must be one of the redirected pins"
    auth_path = pathlib.Path(env["AUTH_DB_PATH"])
    assert str(tmp_path) in str(auth_path) or str(auth_path).startswith(str((tmp_path / "sandbox").resolve())), (
        f"AUTH_DB_PATH must resolve under the chosen sandbox root, got {auth_path}")
