"""Shared bootstrap for tools/wisdom/evals_*.py (PC-side, explicit paths only).

ORDER IS LOAD-BEARING (CLAUDE.md "C:\\data IS REAL"): the explicit --db is pinned first, then the
repo-root conftest is imported, which (a) redirects every /data path the census derives from api/**
to a throwaway sandbox and (b) arms the tripwire that REFUSES any write into the shared data root
(read-only sqlite opens with mode=ro are recorded, not refused). Only after that may anything under
api.* be imported, because product paths are captured at module import.
"""
from __future__ import annotations

import os
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
_SHARED_ROOTS = ("/data", "C:\\data")


def refuse_shared_root(path: str, label: str) -> str:
    target = os.path.normcase(os.path.abspath(path))
    for root in _SHARED_ROOTS:
        base = os.path.normcase(os.path.abspath(root))
        if target == base or target.startswith(base + os.sep):
            raise SystemExit(f"{label} must not live under the shared data root ({root}): {path}")
    return path


def bootstrap(db_path: str) -> str:
    refuse_shared_root(db_path, "--db")
    resolved = os.path.abspath(db_path)
    os.environ["WISDOM_DB_PATH"] = resolved
    if str(REPO) not in sys.path:
        sys.path.insert(0, str(REPO))
    import conftest  # noqa: F401  (redirect + tripwire at import; see module docstring)

    return resolved


def require_file(path: str, label: str) -> str:
    if not path or not os.path.exists(path):
        raise SystemExit(f"{label} not found: {path}")
    return path


def job_context(job_id: str, *, dry_run: bool, now_iso: str | None = None):
    from api.services.wisdom import registry
    from api.services.wisdom.core import ids, timeutil

    now = timeutil.parse_iso(now_iso) if now_iso else timeutil.now_et()
    if now is None:
        raise SystemExit(f"--now is not an ISO datetime: {now_iso}")
    return registry.JobContext(job_id=job_id, now_et=now, due_key=None, force=True, dry_run=dry_run,
                               run_id=ids.sha24(job_id, now.isoformat()))
