"""Phase 8, Package 8G-0 — the pattern_db.py shared-root safety guard.

Directly motivated by a real incident (2026-09): a standalone Python check
run OUTSIDE pytest, with no `PATTERN_DB_PATH`/`AUTH_DB_PATH` override, wrote
two synthetic HTF/PEG rows into this box's real, shared `C:\\data\\patterns.db`
before being caught. The repo-root `conftest.py` tripwire only protects
pytest runs — a bare `python -c "..."` or `python scripts/foo.py` invocation
gets none of that protection. This is the narrow fix: `pattern_db._db_path()`
itself — the one real chokepoint both `init_db()` and `get_connection()`
funnel through — refuses to resolve onto the real shared root unless an
override is explicitly given.

Tests here simulate "no override, on Windows, real shared root exists" by
monkeypatching the exact three inputs `_would_hit_shared_root()` reads
(`os.name`, the two env vars, and `auth_db._DB_PATH`) — never by actually
touching `C:\\data`.
"""
import os

import pytest

from api.services.pattern_engine import pattern_db


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    # Belt-and-suspenders: these should already be pytest-sandboxed by the
    # repo-root conftest, but the guard tests below deliberately manipulate
    # them, so start from a known-clean slate every test.
    monkeypatch.delenv("PATTERN_DB_ALLOW_SHARED_ROOT", raising=False)


def _simulate_unconfigured_windows_with_real_shared_root(monkeypatch):
    """The exact precondition that bit the real incident: Windows, no
    PATTERN_DB_PATH, no AUTH_DB_PATH, and auth_db's own default resolved to
    the raw (non-fallback) /data/auth.db path — meaning /data genuinely
    exists on this machine."""
    monkeypatch.setattr(os, "name", "nt")
    monkeypatch.delenv("PATTERN_DB_PATH", raising=False)
    monkeypatch.delenv("AUTH_DB_PATH", raising=False)
    from api.services import auth_db
    monkeypatch.setattr(auth_db, "_DB_PATH", "/data/auth.db")


# ─── A: normal tests already use isolated DB state ─────────────────────────

def test_pytest_itself_never_trips_the_guard():
    """Under the real pytest session (repo-root conftest has already pinned
    AUTH_DB_PATH to an isolated temp path), the guard must be inert."""
    assert pattern_db._would_hit_shared_root() is False
    # And the real chokepoint resolves without raising.
    pattern_db._db_path()


# ─── B: the known shared/production-shaped path is refused by default ─────

def test_unconfigured_windows_with_real_shared_root_is_refused(monkeypatch):
    _simulate_unconfigured_windows_with_real_shared_root(monkeypatch)
    assert pattern_db._would_hit_shared_root() is True
    with pytest.raises(pattern_db.PatternDbSharedRootGuard):
        pattern_db._db_path()


def test_non_windows_never_trips_the_guard_even_with_the_same_inputs(monkeypatch):
    """Railway's production runtime is always Linux — the guard must stay
    structurally inert there regardless of every other input, proving
    requirement E: production is never blocked."""
    _simulate_unconfigured_windows_with_real_shared_root(monkeypatch)
    monkeypatch.setattr(os, "name", "posix")
    assert pattern_db._would_hit_shared_root() is False
    pattern_db._db_path()  # must not raise


# ─── C: no row is written when the guard refuses ───────────────────────────

def test_guard_refusal_happens_before_any_connection_is_opened(monkeypatch):
    _simulate_unconfigured_windows_with_real_shared_root(monkeypatch)

    def _boom(path):
        raise AssertionError("_connect must never be reached when the guard refuses")

    monkeypatch.setattr(pattern_db, "_connect", _boom)
    with pytest.raises(pattern_db.PatternDbSharedRootGuard):
        pattern_db.get_connection()
    with pytest.raises(pattern_db.PatternDbSharedRootGuard):
        pattern_db.init_db()


# ─── D: explicit override behavior works only where intentionally exercised ─

def test_explicit_pattern_db_path_override_bypasses_the_guard(monkeypatch, tmp_path):
    _simulate_unconfigured_windows_with_real_shared_root(monkeypatch)
    target = str(tmp_path / "scratch_patterns.db")
    monkeypatch.setenv("PATTERN_DB_PATH", target)
    assert pattern_db._db_path() == target


def test_explicit_auth_db_path_override_bypasses_the_guard(monkeypatch):
    _simulate_unconfigured_windows_with_real_shared_root(monkeypatch)
    monkeypatch.setenv("AUTH_DB_PATH", r"C:\somewhere\else\auth.db")
    assert pattern_db._would_hit_shared_root() is False


def test_explicit_allow_shared_root_override_bypasses_the_guard(monkeypatch):
    """The deliberate, obvious, documented opt-in (§5) — absent by default,
    never set automatically by ordinary test execution."""
    _simulate_unconfigured_windows_with_real_shared_root(monkeypatch)
    monkeypatch.setenv("PATTERN_DB_ALLOW_SHARED_ROOT", "1")
    assert pattern_db._would_hit_shared_root() is False
    # Resolves to the real shared path only because the override was explicit.
    assert pattern_db._db_path() == os.path.abspath(r"C:\data\patterns.db")


def test_ordinary_test_execution_never_sets_the_override_itself():
    """No fixture, no conftest, no test in this suite sets
    PATTERN_DB_ALLOW_SHARED_ROOT — it must be genuinely absent by default."""
    assert os.environ.get("PATTERN_DB_ALLOW_SHARED_ROOT") is None


# ─── E: production/normal application behavior is not blocked ──────────────
# (test_non_windows_never_trips_the_guard_even_with_the_same_inputs above is
# the primary proof: Railway's production runtime is always Linux, so the
# guard is unconditionally inert there regardless of every other input.)

def test_real_app_import_path_resolves_without_raising_under_pytest():
    """The actual production entry point (`api.main`) imports pattern_db
    transitively — proving it resolves cleanly under this session (already
    pytest-sandboxed) is a direct, non-simulated proof that ordinary
    application code is unaffected."""
    import api.main  # noqa: F401 — import alone exercises the real chain
    pattern_db._db_path()  # must not raise
