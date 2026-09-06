"""Reusable fail-closed sandbox guard for standalone Notebook/Wave 4 scripts
run OUTSIDE pytest (a bare `python tools/wave4_....py` invocation).

⛔ WHY THIS EXISTS SEPARATELY FROM conftest.py's OWN AUTH_DB_PATH ISOLATION.
The repo-root `conftest.py` already isolates `AUTH_DB_PATH` unconditionally
at import time -- but conftest.py is a pytest-only mechanism (pytest is what
imports it, before any test module). A bare `python tools/....py`
invocation never imports conftest.py at all, so it gets NONE of that
protection, even though it can reach the exact same product code.

This is exactly what happened during Wave 4 prep (2026-09-06):
`wave4_search_correctness_matrix.py` called `list_notes()`, which
transitively calls `auth_db.get_connection()`, whose default path
(`AUTH_DB_PATH` env var, or `/data/auth.db`) resolved to the real
`C:\\data\\auth.db` on this box. The writes failed harmlessly (a
foreign-key constraint against a synthetic user id that doesn't exist in
that real table) -- but the connection attempt itself reached the real,
shared, production-mirror file. `DATA_DIR` isolation alone did NOT prevent
this: `AUTH_DB_PATH` is an independent module-level default in
`auth_db.py`, entirely disconnected from `DATA_DIR`.

**Every standalone (non-pytest) script that can transitively import
`api.services.auth_db`** -- directly, or via `api.services.journal_two.notes`
-> `auth_service` -> `auth_db` -- **MUST call `require_sandboxed_env()`
before doing any real work.** Fails closed (raises `SystemExit`) rather than
printing a warning and continuing.

Usage::

    from notebook_sandbox_guard import require_sandboxed_env
    require_sandboxed_env()  # DATA_DIR + AUTH_DB_PATH by default

Both `DATA_DIR` and every requested datastore var must be EXPLICITLY set by
the caller (never silently defaulted by this guard) and must resolve inside
the SAME sandbox root as `DATA_DIR` -- catching the exact mixed-state case
that exposed this gap: DATA_DIR isolated, AUTH_DB_PATH left untouched.
"""
from __future__ import annotations

import os
import sys

# Every fragment that names a known shared/live datastore root on this box.
# Mirrors audit_sandbox_env.py's own "the one check that matters more than
# the rest of this file" pattern (that file's main(), lines ~111-114).
_SHARED_ROOT_MARKERS = ("c:/data", "c:\\data", "/data")

# Vars this guard knows how to validate -> what they gate, for the error
# message. Extend this dict, never hand-roll a parallel check elsewhere --
# see the module docstring for why one guard beats three subtly different
# per-script checks.
_KNOWN_VARS = {
    "DATA_DIR": "the general shared data root (bars/breadth/desk/etc.)",
    "AUTH_DB_PATH": "auth.db -- users, sessions, activity_log, j2_* tables",
    "FLOW_DB_PATH": "flow.db -- live options flow tape",
    "CONTENTION_TRACE_DARKPOOL_DB_PATH": "darkpool.db",
    "CONTENTION_TRACE_BARS_DB_PATH": "bars.db",
}


def _resolves_to_shared_root(value: str) -> bool:
    norm = value.replace("\\", "/").rstrip("/").lower()
    return any(
        norm == marker.rstrip("/").lower() or norm.startswith(marker.rstrip("/").lower() + "/")
        for marker in _SHARED_ROOT_MARKERS
    )


def _check_one(var: str, sandbox_root: str | None) -> None:
    value = os.environ.get(var)
    if not value:
        raise SystemExit(
            f"REFUSING to run: {var} is unset ({_KNOWN_VARS.get(var, var)}). "
            f"This process can transitively open it, and an unset value "
            f"falls back to a default that resolves onto the real shared "
            f"datastore. Set {var} explicitly to a scratch path before "
            f"running -- never rely on this guard (or anything else) to "
            f"silently pick a safe default for you."
        )
    if _resolves_to_shared_root(value):
        raise SystemExit(
            f"REFUSING to run: {var}={value!r} resolves to the shared/live "
            f"data root. This must point at a disposable scratch location, "
            f"never anywhere under /data or C:\\data."
        )
    if sandbox_root is not None:
        norm_val = os.path.normcase(os.path.abspath(value))
        norm_root = os.path.normcase(os.path.abspath(sandbox_root))
        if not (norm_val == norm_root or norm_val.startswith(norm_root + os.sep)):
            raise SystemExit(
                f"REFUSING to run: {var}={value!r} does not resolve inside "
                f"the same sandbox root as DATA_DIR ({sandbox_root!r}). A "
                f"mixed state -- DATA_DIR isolated, {var} left pointed "
                f"elsewhere -- is exactly the gap this guard exists to close."
            )


def require_sandboxed_env(
    *,
    needs_auth_db: bool = True,
    needs_flow_db: bool = False,
    needs_darkpool_db: bool = False,
    needs_bars_db: bool = False,
) -> None:
    """Fail closed BEFORE any workload runs if this process's environment
    could reach a real shared/live datastore. Only request the extra
    datastores a given script's own code path can actually touch --
    `needs_auth_db=True` is the default because every script that calls
    into `api.services.journal_two.notes` (create_note/list_notes/etc.)
    transitively reaches `auth_db` via its telemetry logging.

    Two layers, deliberately not just one:
    1. The named-var pre-flight checks above -- fast, and the error message
       names exactly which var is wrong, before any import that could open
       a connection even runs.
    2. `audit_shared_root_probe.install(strict=True)` -- the SAME runtime
       tripwire `tools/e2e_sandbox_launcher.py` already uses for the full
       E2E server (proven 2026-09-05 against the sibling flow.db/darkpool.db
       gap). It wraps open/sqlite3.connect/makedirs/mkdir globally and
       refuses BEFORE the real call for ANY touch of C:\\data, regardless of
       which env var (or missing var, or hardcoded literal) caused it --
       catching what layer 1 cannot know to name in advance. Layer 1 alone
       is exactly the class of guard that missed this incident originally
       (a hand-maintained var list); layer 2 is what makes the guard
       trustworthy even against a var nobody thought to list here yet.
    """
    _check_one("DATA_DIR", None)
    sandbox_root = os.environ["DATA_DIR"]
    if needs_auth_db:
        _check_one("AUTH_DB_PATH", sandbox_root)
    if needs_flow_db:
        _check_one("FLOW_DB_PATH", sandbox_root)
    if needs_darkpool_db:
        _check_one("CONTENTION_TRACE_DARKPOOL_DB_PATH", sandbox_root)
    if needs_bars_db:
        _check_one("CONTENTION_TRACE_BARS_DB_PATH", sandbox_root)

    tools_dir = os.path.dirname(os.path.abspath(__file__))
    if tools_dir not in sys.path:
        sys.path.insert(0, tools_dir)
    import audit_shared_root_probe as _probe
    _probe.install(strict=True)
