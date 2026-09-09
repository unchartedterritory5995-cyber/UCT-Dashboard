r"""Record — and optionally block — any runtime touch of the shared data root.

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

⛔ **`strict=True` (or `UCT_SHARED_ROOT_PROBE_STRICT=1`): REFUSE, not just record.**
Added for `tools/e2e_sandbox_launcher.py` — a live E2E server has no
`pytest_sessionfinish` to fail the run afterward, so recording alone would let
a real touch of `C:\data` complete silently. Strict mode raises
`SharedDataRootAccessRefused` from inside `_record`, which runs BEFORE the
wrapped `open`/`sqlite3.connect`/`makedirs`/`mkdir` ever calls the real
function — the access never happens, not even a read. Non-strict (the
default) is unchanged: record only, exactly as before, for the audit-mode use
case where you want visibility without a crash.
"""
from __future__ import annotations

import builtins
import io
import json
import os
import sqlite3
import threading
import traceback

#: Mutable (not a tuple) so tests can point this at a throwaway PROBE directory
#: — never real C:\data — and watch strict mode actually refuse, the same
#: technique `conftest.pretend_shared_root` uses for the pytest tripwire.
SHARED_ROOTS: list[str] = [os.environ.get("UCT_SHARED_ROOT", r"C:\data")]
_OUT = os.environ.get("UCT_SHARED_ROOT_PROBE_OUT", "")
_HITS: list[dict] = []
_LOCK = threading.Lock()
_INSTALLED = False
_STRICT = os.environ.get("UCT_SHARED_ROOT_PROBE_STRICT", "0").lower() in ("1", "true", "yes")
_REAL = {}  # populated by install(); restored by uninstall()


class SharedDataRootAccessRefused(RuntimeError):
    """Strict mode: a runtime touch of the shared data root was refused
    before the real open/connect/makedirs/mkdir ran."""


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
    if _STRICT:
        # Raised OUTSIDE the lock (above) and BEFORE the caller's wrapper ever
        # calls the real open/connect/makedirs/mkdir — the access itself never
        # happens, read or write. This is what makes strict mode "refused
        # before touching it" rather than "recorded, then touched anyway."
        raise SharedDataRootAccessRefused(
            f"[{kind}] {path} refused — this process is running in a "
            f"fail-closed E2E sandbox (UCT_SHARED_ROOT_PROBE_STRICT=1) and "
            f"this path resolves inside the shared production data root "
            f"({SHARED_ROOTS[0]}). Point the owning env var at the sandbox "
            f"root instead of touching this path."
        )


def install(strict: bool | None = None) -> None:
    """Wrap the few entry points that can reach a file. Idempotent.

    `strict` overrides `UCT_SHARED_ROOT_PROBE_STRICT` for this process when
    given explicitly; omit it to use the env var (the CLI/launcher default).
    """
    global _INSTALLED, _STRICT
    if strict is not None:
        _STRICT = bool(strict)
    if _INSTALLED:
        return
    _INSTALLED = True

    _REAL.update(open=builtins.open, connect=sqlite3.connect,
                 makedirs=os.makedirs, mkdir=os.mkdir, io_open=io.open)

    def open_(file, *a, **k):
        if _is_shared(file):
            _record("open", file)
        return _REAL["open"](file, *a, **k)

    def connect_(database, *a, **k):
        if _is_shared(database):
            _record("sqlite3.connect", database)
        return _REAL["connect"](database, *a, **k)

    def makedirs_(name, *a, **k):
        if _is_shared(name):
            _record("makedirs", name)
        return _REAL["makedirs"](name, *a, **k)

    def mkdir_(path, *a, **k):
        if _is_shared(path):
            _record("mkdir", path)
        return _REAL["mkdir"](path, *a, **k)

    builtins.open = open_
    sqlite3.connect = connect_
    os.makedirs = makedirs_
    os.mkdir = mkdir_
    io.open = open_


def uninstall() -> None:
    """Restore the wrapped entry points. Test-only — a live launcher never
    calls this (the guard should stay armed for the process lifetime)."""
    global _INSTALLED
    if not _INSTALLED:
        return
    builtins.open = _REAL["open"]
    sqlite3.connect = _REAL["connect"]
    os.makedirs = _REAL["makedirs"]
    os.mkdir = _REAL["mkdir"]
    io.open = _REAL["io_open"]
    _REAL.clear()
    _INSTALLED = False


def reset_hits() -> None:
    """Clear recorded hits — test-only, so one test's hits don't leak into
    the next test's assertions."""
    with _LOCK:
        _HITS.clear()


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
