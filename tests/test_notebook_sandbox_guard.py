r"""notebook_sandbox_guard.py fail-closed coverage (2026-09-06 checkpoint:
"AUTH_DB_PATH must be treated as an independent sandbox boundary, not
assumed to follow DATA_DIR").

⛔ WHY THIS EXISTS. During Wave 4 prep, a standalone script
(`tools/wave4_search_correctness_matrix.py`) redirected `DATA_DIR`
correctly but left `AUTH_DB_PATH` to its own default -- which resolves to
the real `C:\data\auth.db` on this box, independent of `DATA_DIR` entirely
(`auth_db.py`'s `_DB_PATH` is its own separate module-level default). The
writes that resulted failed harmlessly (a foreign-key constraint against a
synthetic user id that doesn't exist in that real table), but the
connection attempt reached the real, shared file. This is the SAME
incident shape as the 2026-09-05 flow.db/darkpool.db gap
(`tests/test_e2e_sandbox_guard.py`), one day earlier, for a different pair
of vars -- `DATA_DIR` isolation is NOT sufficient by itself; every var a
script's own code path can transitively open needs its own check.

`tools/notebook_sandbox_guard.py` closes this for standalone (non-pytest)
Notebook/Wave 4 scripts specifically -- pytest-collected tests already get
`AUTH_DB_PATH` isolation for free from the repo-root `conftest.py`, which is
exactly why this gap was invisible until a bare `python tools/....py`
invocation hit it. This file proves the guard actually fires, the same way
`test_e2e_sandbox_guard.py` proves the sibling e2e-launcher guard fires --
never against real `C:\data`.

Two layers, tested separately:
1. The named pre-flight checks (`require_sandboxed_env`'s own string
   validation) -- pure, no I/O, safe to test with literal "C:\\data\\..."
   strings directly since a REFUSED check never opens anything.
2. The `audit_shared_root_probe` runtime tripwire `require_sandboxed_env()`
   installs as its second layer -- tested via a THROWAWAY pretend root,
   exactly `test_e2e_sandbox_guard.py`'s own technique, never real C:\data.
"""
from __future__ import annotations

import pathlib
import sqlite3
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "tools"))

import audit_shared_root_probe as probe  # noqa: E402
import notebook_sandbox_guard as guard  # noqa: E402


@pytest.fixture(autouse=True)
def _isolated_probe_state(tmp_path):
    """Every test gets its OWN pretend shared root -- never the real one --
    and the probe's global state is fully reset after. Mirrors
    test_e2e_sandbox_guard.py's fixture of the same name exactly."""
    pretend_root = tmp_path / "pretend_c_data"
    pretend_root.mkdir()
    previous_roots = list(probe.SHARED_ROOTS)
    probe.SHARED_ROOTS[:] = [str(pretend_root)]
    probe.reset_hits()
    yield pretend_root
    probe.uninstall()
    probe.SHARED_ROOTS[:] = previous_roots
    probe.reset_hits()


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("DATA_DIR", raising=False)
    monkeypatch.delenv("AUTH_DB_PATH", raising=False)


# ── Layer 1: named pre-flight checks (pure string validation, no I/O) ──────

def test_SAFE_data_dir_and_auth_db_path_both_isolated_passes(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    guard.require_sandboxed_env()  # must not raise


def test_UNSAFE_data_dir_unset_refuses(monkeypatch):
    with pytest.raises(SystemExit, match="DATA_DIR is unset"):
        guard.require_sandboxed_env()


def test_UNSAFE_auth_db_path_unset_refuses_even_though_data_dir_is_isolated(tmp_path, monkeypatch):
    """The EXACT mixed-state case that exposed the real gap: DATA_DIR
    isolated, AUTH_DB_PATH left untouched (which would default, inside
    auth_db.py, to the real shared root)."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    with pytest.raises(SystemExit, match="AUTH_DB_PATH is unset"):
        guard.require_sandboxed_env()


def test_UNSAFE_auth_db_path_pointing_at_the_real_shared_root_refuses(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("AUTH_DB_PATH", "C:\\data\\auth.db")
    with pytest.raises(SystemExit, match="resolves to the shared/live data root"):
        guard.require_sandboxed_env()


def test_UNSAFE_auth_db_path_bare_slash_data_root_refuses(tmp_path, monkeypatch):
    """The bare-root case (not /data/something) -- audit_sandbox_env.py's own
    docstring calls this "not an edge case": a naive substring check can miss
    the literal root itself."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("AUTH_DB_PATH", "/data/auth.db")
    with pytest.raises(SystemExit, match="resolves to the shared/live data root"):
        guard.require_sandboxed_env()


def test_UNSAFE_auth_db_path_outside_the_sandbox_root_refuses(tmp_path, monkeypatch):
    """AUTH_DB_PATH is a real, non-shared, safe-LOOKING path -- but it is not
    under the SAME sandbox root as DATA_DIR. Still refused: one isolated var
    and one pointed elsewhere is the mixed state this guard exists to close,
    even when neither individually resolves onto the shared root."""
    sandbox = tmp_path / "sandbox"
    other = tmp_path / "elsewhere"
    monkeypatch.setenv("DATA_DIR", str(sandbox))
    monkeypatch.setenv("AUTH_DB_PATH", str(other / "auth.db"))
    with pytest.raises(SystemExit, match="does not resolve inside the same sandbox root"):
        guard.require_sandboxed_env()


def test_needs_auth_db_false_does_not_require_AUTH_DB_PATH(tmp_path, monkeypatch):
    """wave4_fts_benchmark.py / wave4_date_range_index_benchmark.py never
    call into notes.py's service layer -- they must not be forced to set a
    var their own code path can't reach."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    guard.require_sandboxed_env(needs_auth_db=False)  # must not raise


# ── Layer 2: the runtime tripwire is actually armed afterward ──────────────

def test_the_tripwire_is_actually_armed_after_require_sandboxed_env(tmp_path, monkeypatch, _isolated_probe_state):
    """Proves layer 2 fires for a touch layer 1's own hardcoded string check
    would NOT catch on its own -- a path under the pretend shared root that
    is not literally 'C:\\data' or '/data' (layer 1's markers are fixed;
    the probe's SHARED_ROOTS here is a throwaway pretend root instead, the
    same technique test_e2e_sandbox_guard.py uses)."""
    pretend_root = _isolated_probe_state
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    guard.require_sandboxed_env()

    unsafe_path = pretend_root / "auth.db"
    with pytest.raises(probe.SharedDataRootAccessRefused):
        sqlite3.connect(str(unsafe_path))
    assert not unsafe_path.exists(), (
        "sqlite3.connect must be refused BEFORE it creates the file -- "
        "finding the file on disk would mean the connection happened anyway")


def test_a_safe_path_still_connects_normally_with_the_tripwire_armed(tmp_path, monkeypatch, _isolated_probe_state):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    guard.require_sandboxed_env()

    safe_db = tmp_path / "genuinely_safe.db"
    conn = sqlite3.connect(str(safe_db))
    conn.execute("CREATE TABLE t (x INTEGER)")
    conn.commit()
    conn.close()
    assert safe_db.exists(), "a genuinely safe path must connect and create its file normally"
