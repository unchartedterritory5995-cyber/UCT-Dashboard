"""THE PRODUCTION DEPENDENCY RAIL — run in an interpreter that holds ONLY
`requirements.txt` (the deploy gate builds one; locally:
`python -m venv X && X/bin/pip install -r requirements.txt && X/bin/python tools/prod_dependency_smoke.py`).

⚰️ 2026-10-06: `jsonschema` was imported by the conversation door but missing from
requirements.txt. Every local venv had it (installed for something else), every
test passed, the deploy gate installs a hand-picked list rather than
requirements.txt — and production's `POST /api/user-definitions/converse` 500'd
with ModuleNotFoundError. `Dockerfile.web` builds /opt/venv from requirements.txt
alone, so THAT set is the one that has to be proven, not the dev venv's.

Three stages, each fatal:
  1. IMPORT  — the server and the conversation door's closure import.
  2. VALIDATE — the patch validator really validates (a good envelope passes, a
     malformed one is refused). A dependency that imports but does nothing would
     otherwise pass stage 1; there is NO fallback that skips validation.
  3. BOOT    — `uvicorn api.main:app` (the start command's shape) completes
     startup, `/api/health` answers 200, and `/converse` answers an anonymous
     caller with an auth refusal (401/403), never a 500.

Background jobs are switched off and every database this boot opens points at a
throwaway directory, so it never touches real data.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOOT_TIMEOUT_S = float(os.environ.get("PROD_SMOKE_BOOT_TIMEOUT_S", "300"))

MODULES = [
    "jsonschema",
    "api.services.presentation_schema",
    "api.services.definition_conversation",
    "api.routers.user_definitions",
    "api.main",
]


def fail(stage: str, msg: str) -> None:
    print(f"::error::prod dependency smoke [{stage}] {msg}")
    sys.exit(1)


def stage_import() -> None:
    import importlib
    for name in MODULES:
        try:
            importlib.import_module(name)
        except Exception as exc:  # noqa: BLE001 — any import failure is the finding
            fail("IMPORT", f"{name}: {type(exc).__name__}: {exc}")
        print(f"IMPORT ok  {name}")
    # ⛔ The test-only rail-breaker: production must never import conftest.
    if "conftest" in sys.modules:
        fail("IMPORT", "conftest was imported by a production module")


def stage_validate() -> None:
    from api.services import definition_conversation as dc
    v = dc._validator()
    good = {"contract": "uct.authoring.patch/1", "baseRevision": 0, "ops": [
        {"op": "set_slot", "slot": "value#1", "value": 80}]}
    bad = {"contract": "uct.authoring.patch/1", "baseRevision": "zero", "ops": "nope"}
    good_errors = list(v.iter_errors(good))
    bad_errors = list(v.iter_errors(bad))
    if good_errors:
        fail("VALIDATE", f"a well-formed envelope was refused: {good_errors[0].message}")
    if not bad_errors:
        fail("VALIDATE", "a malformed envelope PASSED — validation is not running")
    if dc._schema_errors(bad) == []:
        fail("VALIDATE", "_schema_errors() reports no errors for a malformed envelope")
    print(f"VALIDATE ok  good=0 errors, malformed={len(bad_errors)} errors")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _get(url: str, method: str = "GET", body: bytes | None = None):
    req = urllib.request.Request(url, data=body, method=method,
                                 headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def stage_boot() -> None:
    scratch = Path(tempfile.mkdtemp(prefix="prod-smoke-"))
    port = _free_port()
    env = dict(os.environ)
    env.update({
        "WORKER_ENABLED": "0", "CATALYST_ENGINE_ENABLED": "0", "TWITTERAPI_IO_ENABLED": "0",
        "BARS_PREWARM_DISABLED": "1", "TICKER_NAMES_PREWARM_DISABLED": "1", "COT_SEED_DISABLED": "1",
        "AUTH_DB_PATH": str(scratch / "auth.db"),
        "USER_DEFINITIONS_DB_PATH": str(scratch / "user_definitions.db"),
        "ALERT_SHADOW_DB_PATH": str(scratch / "alert_shadow.db"),
        "PYTHONUNBUFFERED": "1",
    })
    log = open(scratch / "boot.log", "w", encoding="utf-8")
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "api.main:app", "--host", "127.0.0.1", "--port", str(port)],
        cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + BOOT_TIMEOUT_S
        status = None
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                break
            try:
                status, _ = _get(f"{base}/api/health")
                if status == 200:
                    break
            except OSError:
                pass
            time.sleep(1)
        if status != 200:
            log.flush()
            tail = (scratch / "boot.log").read_text(encoding="utf-8", errors="replace")[-4000:]
            print(tail)
            fail("BOOT", f"/api/health never answered 200 (last={status}, exit={proc.poll()})")
        print(f"BOOT ok  /api/health 200 on :{port}")
        code, raw = _get(f"{base}/api/user-definitions/converse", "POST",
                         json.dumps({"message": "x", "view": {}}).encode())
        if code not in (401, 403):
            fail("BOOT", f"anonymous POST /converse answered {code} (want 401/403): {raw[:300]!r}")
        print(f"BOOT ok  anonymous /converse -> {code} (auth refusal, not 500)")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            proc.kill()
        log.close()


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT))
    os.chdir(ROOT)
    stage_import()
    stage_validate()
    stage_boot()
    print("PROD DEPENDENCY SMOKE: PASS")
