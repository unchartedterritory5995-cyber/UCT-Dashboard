"""Record — and optionally block — any runtime touch of the shared data root.

⛔ WHY. `tools/audit_sandbox_env.py` redirects every path the AST census can pin.
That answers *"is there an env var for this literal?"* — it does NOT answer *"does
every call site go through it."* A module can read its env var at import AND still
have a caller that passes the literal as an argument, and the census counts that
literal as pinned. This closes the gap the census cannot see, at runtime, where
the truth is.

It is the same shape as the repo-root `conftest.py` tripwire, which exists because
`C:\\data` is REAL on this box — but that one only runs under pytest. A local
backend has no such net.

⭐ **RECORDING IS THE GUARD, NOT RAISING.** A raise inside a daemon thread goes to
`threading.excepthook` and the caller carries on none the wiser; four of the five
leaks the pytest tripwire ever found were on a background thread. So every touch
is recorded with its stack, and the record is what gets read.

Usage — import it BEFORE the app::

    python -c "import tools.audit_shared_root_probe as p; p.install(); \\
               import uvicorn; uvicorn.run('api.main:app', port=8077)"

Then read `p.report()`, or the JSON at `$UCT_SHARED_ROOT_PROBE_OUT`.
"""
from __future__ import annotations

import builtins
import io
import json
import os
import sqlite3
import threading
import traceback

SHARED_ROOTS = (os.environ.get("UCT_SHARED_ROOT", r"C:\data"),)
_OUT = os.environ.get("UCT_SHARED_ROOT_PROBE_OUT", "")
_HITS: list[dict] = []
_LOCK = threading.Lock()
_INSTALLED = False


def _is_shared(path) -> bool:
    try:
        p = os.path.abspath(str(path)).replace("/", "\\").lower()
    except Exception:
        return False
    return any(p.startswith(str(r).replace("/", "\\").lower().rstrip("\\") + "\\") for r in SHARED_ROOTS)


def _record(kind: str, path) -> None:
    # ⚠️ Trim OUR OWN frames off the top so the first line is the real caller,
    # not this file. A stack whose top is the probe tells the reader nothing.
    stack = [f for f in traceback.extract_stack()[:-2]
             if "audit_shared_root_probe" not in f.filename]
    with _LOCK:
        _HITS.append({
            "kind": kind,
            "path": str(path),
            "thread": threading.current_thread().name,
            "where": [f"{f.filename}:{f.lineno} {f.name}" for f in stack[-6:]],
        })
        if _OUT:
            try:
                data = json.dumps(_HITS, indent=2).encode("utf-8")
                tmp = _OUT + ".tmp"
                with io.open(tmp, "wb") as fh:
                    fh.write(data)
                os.replace(tmp, _OUT)
            except Exception:
                pass


def install() -> None:
    """Wrap the few entry points that can reach a file. Idempotent."""
    global _INSTALLED
    if _INSTALLED:
        return
    _INSTALLED = True

    real_open, real_connect = builtins.open, sqlite3.connect
    real_makedirs, real_mkdir = os.makedirs, os.mkdir

    def open_(file, *a, **k):
        if _is_shared(file):
            _record("open", file)
        return real_open(file, *a, **k)

    def connect_(database, *a, **k):
        if _is_shared(database):
            _record("sqlite3.connect", database)
        return real_connect(database, *a, **k)

    def makedirs_(name, *a, **k):
        if _is_shared(name):
            _record("makedirs", name)
        return real_makedirs(name, *a, **k)

    def mkdir_(path, *a, **k):
        if _is_shared(path):
            _record("mkdir", path)
        return real_mkdir(path, *a, **k)

    builtins.open = open_
    sqlite3.connect = connect_
    os.makedirs = makedirs_
    os.mkdir = mkdir_
    io.open = open_


def hits() -> list[dict]:
    with _LOCK:
        return list(_HITS)


def report() -> str:
    rows = hits()
    if not rows:
        return "no runtime touch of the shared data root"
    out = [f"{len(rows)} runtime touch(es) of the shared data root:"]
    for h in rows:
        out.append(f"  [{h['kind']}] {h['path']}   (thread {h['thread']})")
        for w in h["where"]:
            out.append(f"      {w}")
    return "\n".join(out)
