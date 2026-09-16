"""Shared bootstrap for tools/wisdom/extract_*.py (stream S-D).

Every extract tool:
  * takes EXPLICIT --db / --out paths; nothing here defaults to /data (CONTRACTS §0 #18);
  * imports the repo-root conftest BEFORE any api.* import, so every AST-derived
    /data path pin is redirected to a sandbox and the shared-root tripwire is armed
    (CLAUDE.md "C:\\data IS REAL") — then points WISDOM_DB_PATH at the --db it was given;
  * refuses a --db inside the shared data root;
  * never prints an environment value.
"""
from __future__ import annotations

import json
import os
import pathlib
import sys
from datetime import datetime, timezone

REPO = pathlib.Path(__file__).resolve().parents[2]
_SHARED_ROOTS = ("/data", "C:\\data")


def _inside_shared_root(path: str) -> bool:
    target = os.path.normcase(os.path.abspath(path))
    for root in _SHARED_ROOTS:
        base = os.path.normcase(os.path.abspath(root))
        if target == base or target.startswith(base + os.sep):
            return True
    return False


def bootstrap(db_path: str | None = None) -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    if str(REPO) not in sys.path:
        sys.path.insert(0, str(REPO))
    import conftest  # noqa: F401  (census pins + tripwire, before any api import)

    if db_path:
        resolved = os.path.abspath(db_path)
        if _inside_shared_root(resolved):
            raise SystemExit(f"refusing --db inside the shared data root: {resolved}")
        os.makedirs(os.path.dirname(resolved), exist_ok=True)
        os.environ["WISDOM_DB_PATH"] = resolved


def out_path(path: str) -> pathlib.Path:
    resolved = pathlib.Path(os.path.abspath(path))
    if _inside_shared_root(str(resolved)):
        raise SystemExit(f"refusing an output path inside the shared data root: {resolved}")
    resolved.parent.mkdir(parents=True, exist_ok=True)
    return resolved


def job_context(*, dry_run: bool, force: bool = True, job_id: str = "wisdom_extract_tool"):
    from api.services.wisdom import registry
    from api.services.wisdom.core import timeutil

    return registry.JobContext(job_id=job_id, now_et=timeutil.now_et(), due_key=None, force=force,
                               dry_run=dry_run, run_id=f"tool-{datetime.now(timezone.utc):%Y%m%dT%H%M%S}")


def write_json(path: pathlib.Path, payload: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=1, sort_keys=True, default=str) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
