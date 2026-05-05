# Phase 1: Prewarmer Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **POST-INCIDENT NOTE (2026-05-04):** This plan repeatedly references a single
> `WORKER_ENABLED=1` env var as the on/off switch for the web's in-process
> prewarmer. **That collided with `railway.json`'s `startCommand` conditional
> in the live deploy** — both decisions read the same variable, so flipping it
> on web replaced the full website with the worker-only health-check app.
> **The fix:** two distinct env vars.
> - `WORKER_ENABLED=1` is consumed ONLY by `railway.json`'s `startCommand`
>   shell conditional and is set ONLY on the worker service.
> - `USE_REMOTE_BARS=1` is consumed ONLY by `api/main.py`'s lifespan and is
>   set ONLY on the web service to swap in-process prewarmer for the R2 puller.
> - Source of truth for this split is the comment block at `api/main.py:207-215`.
>
> Treat any reference to `WORKER_ENABLED` below in the context of the web
> service or `api/main.py` as referring to `USE_REMOTE_BARS` instead.

**Goal:** Extract the bars pre-warmer (and bars seeder) from the web FastAPI process into a separate Railway service so it can run continuously without competing with user request handlers for CPU/threads. Web service stays focused on serving requests; worker service warms the cache. Data flows between them via Cloudflare R2 (S3-compatible) snapshots.

**Architecture:** Two Railway services in the same repo (different `startCommand`). The worker service runs `python -m api.worker_main` which spawns the existing `_prewarm_bars` thread + `start_background_seeder()` against its own `/data` volume, then periodically tars `/data/bars.db` + `bars_cache/` and uploads to R2. The web service runs unchanged uvicorn but periodically pulls the latest snapshot from R2 to its own `/data` volume on a background thread. Both feature-flagged: `WORKER_ENABLED=1` on web disables the in-process prewarmer (no double-load). Until the flag flips, web behaves identically to today — fully reversible.

**Tech Stack:** FastAPI, Railway services (multi-service single repo), Cloudflare R2 (S3-compatible object storage via boto3), Python 3.12.

**Spec reference:** `docs/superpowers/specs/2026-05-03-perf-overhaul-strategic-overview.md` Phase 1 (Workstream 1: Prewarmer Extraction).

---

## Architectural Decisions (Locked)

1. **Object storage:** Cloudflare R2 (free tier, no egress fees, S3-compatible). User has Cloudflare account already. Existing boto3 client pattern in `api/services/build_intraday_cache.py:37-45` shows how to use a custom S3 endpoint. Bucket name: `uct-bars-snapshots` (created via Cloudflare dashboard).

2. **Sync cadence:** worker uploads tarball every 5 min (matches the prewarmer refresh interval). Web pulls every 5 min on a background thread. Worst-case data lag on web: ~10 min (one upload cycle + one download cycle). For pre-warmed bars data this is fine — they're stale-tolerant by definition.

3. **Snapshot format:** single tarball `bars-snapshot-{timestamp}.tar.gz` containing `bars.db` + the entire `bars_cache/` directory. Plus a `latest.txt` pointer file in R2 with the timestamp of the most recent snapshot. Web reads `latest.txt` to find what to download.

4. **Worker entry point:** `python -m api.worker_main` — a minimal FastAPI app that exposes `/internal/health` (so Railway's health check works) and spawns the prewarmer + seeder + S3 uploader threads.

5. **Feature flag:** `WORKER_ENABLED=1` env var on web. When set: web's in-process `_prewarm_bars` is skipped, web's S3 puller thread runs. When unset (default): web runs as today, no S3 sync. Worker doesn't read this flag — worker always does its job.

6. **Rollback:** unset `WORKER_ENABLED` on web → web reverts to in-process prewarming, worker keeps running but its data is unused. Rollback is one env-var change.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `api/services/bars_fetch.py` | Create | Extracted `_get_bars_inner`, `_needs_fresh`, and the few helpers they depend on, so the worker can import them without dragging in the entire `api.routers.bars` module (and through it FastAPI router decorators) |
| `api/routers/bars.py` | Modify | Re-export `_get_bars_inner` and `_needs_fresh` from `bars_fetch` for backward compat with everything that imports them today |
| `api/services/data_sync.py` | Create | Generic S3-compatible upload/download of the bars data tarball; reads R2 endpoint + creds from env |
| `api/services/data_sync_test.py` | Create | Unit tests for the sync module (tar/untar round-trip, S3 mocking via moto or stub) |
| `api/main.py` | Modify | Add `/api/health/cache` endpoint; gate in-process `_prewarm_bars` behind `not WORKER_ENABLED`; spawn S3-puller background thread when `WORKER_ENABLED=1` |
| `api/worker_main.py` | Create | Worker entry point: minimal FastAPI for `/internal/health`, spawns prewarmer + seeder + S3 uploader threads, never serves user requests |
| `requirements.txt` | Verify | Confirm boto3 is present (it is — line 11) |

7 file touches. Refactor (#1, #2) first so the worker has importable code. Then storage layer (#3, #4). Then web changes (#5). Then worker (#6). Then user-action deploy steps. Then verification + flip.

---

## Task 1: Refactor `_get_bars_inner` + `_needs_fresh` into `bars_fetch.py`

**Files:**
- Create: `api/services/bars_fetch.py`
- Modify: `api/routers/bars.py`

This is a no-behavior-change refactor. Goal: get `_get_bars_inner` and its closure of helpers out of a router module so the worker can import it without pulling in FastAPI route decorators.

- [ ] **Step 1: Inventory what `_get_bars_inner` actually depends on**

```bash
cd /c/Users/Patrick/uct-dashboard
grep -n "^from\|^import" api/routers/bars.py | head -30
sed -n '1190,1290p' api/routers/bars.py
```

Read the function. Note every import + helper it calls. Functions like `_fetch_intraday`, `_fetch_daily`, `_fetch_weekly`, `_fetch_monthly`, `_delta_intraday`, `_delta_daily`, `_delta_weekly`, `_delta_monthly`, `_fmt_sqlite_bars`, `_session_resample_hourly`, `_resample_monthly_iso` all need to come along (or be importable separately). Same with `_inflight`, `_inflight_lock`, `_CACHE_TTL`.

The pragmatic approach: move the ENTIRE helper layer (everything except the `@router.get` route handlers) to `bars_fetch.py`. Router file then becomes a thin shim: imports from `bars_fetch`, defines route handlers that delegate.

- [ ] **Step 2: Create `api/services/bars_fetch.py` and copy the entire pre-router code from `bars.py` into it**

```bash
cd /c/Users/Patrick/uct-dashboard
# Find where the first @router decorator is in bars.py
grep -n "^@router\." api/routers/bars.py
```

The first `@router.` line marks the cutoff. Everything ABOVE it is helpers. Create `api/services/bars_fetch.py` and copy all of `bars.py` contents from line 1 up to (but not including) the first `@router.` decorator.

```bash
# Determine the cutoff line N (first @router line):
N=$(grep -n "^@router\." api/routers/bars.py | head -1 | cut -d: -f1)
echo "First router decorator at line $N"
head -n $((N - 1)) api/routers/bars.py > /tmp/bars_fetch_top.py
# Inspect:
wc -l /tmp/bars_fetch_top.py
```

Then create `api/services/bars_fetch.py` with that content PLUS at the end add explicit `__all__` listing what we export:

```bash
cp /tmp/bars_fetch_top.py /c/Users/Patrick/uct-dashboard/api/services/bars_fetch.py
```

Append at the end of `api/services/bars_fetch.py`:

```python

# Public API for router + worker consumers.
__all__ = [
    "_get_bars_inner",
    "_get_bars_since_response",
    "_fmt_sqlite_bars",
    "_needs_fresh",
    "_run_universe_warm",
    "_run_universe_warm_multi_tf",
    "_warm_state",
    "_warm_state_lock",
    "_CACHE_TTL",
    "_inflight",
    "_inflight_lock",
]
```

(Verify each name actually exists in the file by grepping.)

- [ ] **Step 3: Remove the imports from `api/routers/bars.py` that are now in `bars_fetch.py`, and add a single re-export import**

In `api/routers/bars.py`, replace EVERYTHING from line 1 through the line BEFORE the first `@router.` with:

```python
"""bars router — thin HTTP layer over api.services.bars_fetch.

All actual fetch/cache/dedup logic lives in bars_fetch so the worker
service can import it without dragging in FastAPI router decorators.
This file only owns route registration."""

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from api.services.bars_fetch import (
    _get_bars_inner,
    _get_bars_since_response,
    _fmt_sqlite_bars,
    _needs_fresh,
    _run_universe_warm,
    _run_universe_warm_multi_tf,
    _warm_state,
    _warm_state_lock,
)
# Re-export bare-modules for any consumer that imports from api.routers.bars
from api.services import bars_fetch as _bars_fetch  # noqa: F401

router = APIRouter()
```

Keep all the `@router.get(...)` and `@router.post(...)` handler definitions BELOW unchanged. They reference the imported symbols which now come from `bars_fetch`.

- [ ] **Step 4: Verify the imports resolve and Python parses both files**

```bash
cd /c/Users/Patrick/uct-dashboard
py -3 -c "import ast; ast.parse(open('api/services/bars_fetch.py').read()); print('bars_fetch ok')"
py -3 -c "import ast; ast.parse(open('api/routers/bars.py').read()); print('bars.py ok')"
```

Expected: both print "ok". If either fails: read the syntax error and fix the cutoff/import.

- [ ] **Step 5: Verify the refactor doesn't break imports in the rest of the codebase**

```bash
cd /c/Users/Patrick/uct-dashboard
grep -rn "from api.routers.bars import\|from api.routers import bars" api/ | head
```

Each result is a consumer that imported something from the OLD bars.py. They should all still work because we re-exported via `bars_fetch as _bars_fetch`. But verify each named import is still available — check that whatever name they imported (e.g. `_get_bars_inner`) is in the `__all__` of `bars_fetch.py`. If something is imported that we didn't re-export, ADD it to `__all__` and to the imports in `routers/bars.py`.

- [ ] **Step 6: Run the existing tests to confirm zero behavior change**

```bash
cd /c/Users/Patrick/uct-dashboard/app && npm test 2>&1 | tail -10
```

Frontend tests aren't affected by Python refactors. They should be in the same state as Phase 0 left them.

For backend tests:
```bash
cd /c/Users/Patrick/uct-dashboard
ls api/tests/ 2>/dev/null || echo "(no api tests directory)"
```

If `api/tests/` exists, run pytest. If not, skip — there are no backend tests today (per the perf-investigation doc audit).

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Patrick/uct-dashboard
git add api/services/bars_fetch.py api/routers/bars.py
git commit -m "Refactor: extract bars helpers to api/services/bars_fetch

Pure mechanical move — every function above the first @router decorator
in api/routers/bars.py now lives in api/services/bars_fetch.py. Router
file becomes a thin HTTP shim that re-exports the helpers and registers
routes against them.

Why: the upcoming worker service (api/worker_main.py) needs to call
_get_bars_inner directly. Importing from api.routers.bars would drag
the entire FastAPI router decorator chain into the worker process — not
fatal but wrong layering. With this refactor, worker imports purely
from api.services.* like every other service consumer.

No behavior change: identical functions, identical registrations,
identical route handlers. The Python AST of every helper is byte-equal
to its prior form.
"
```

---

## Task 2: Create `api/services/data_sync.py` — S3-compatible snapshot upload/download

**Files:**
- Create: `api/services/data_sync.py`

This module does the actual tar + upload + download. Storage-agnostic via boto3 with a custom endpoint URL — works with R2, AWS S3, Massive's S3, anything.

- [ ] **Step 1: Create the file with the upload/download functions**

Create `api/services/data_sync.py` with:

```python
"""S3-compatible snapshot sync for bars cache.

The worker service writes pre-warmed data to its local /data volume,
then periodically uploads a tarball to R2/S3. The web service pulls
the latest snapshot to its own /data volume on a background thread.

Configuration via env:
  DATA_SYNC_ENDPOINT_URL   — e.g. https://<account>.r2.cloudflarestorage.com
  DATA_SYNC_BUCKET         — e.g. uct-bars-snapshots
  DATA_SYNC_ACCESS_KEY     — R2 / S3 access key
  DATA_SYNC_SECRET_KEY     — R2 / S3 secret key
  DATA_SYNC_REGION         — defaults to "auto" (R2's value); AWS uses e.g. "us-east-1"
  DATA_DIR                 — local directory containing bars.db + bars_cache/ (defaults to /data)

Snapshot layout in the bucket:
  latest.txt          — text file containing the timestamp of the most recent snapshot
  snapshots/<ts>.tar.gz — actual tarball, where <ts> is unix-seconds
"""
from __future__ import annotations

import io
import os
import tarfile
import time
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_DATA_DIR = os.environ.get("DATA_DIR", "/data")
_LATEST_KEY = "latest.txt"
_SNAPSHOT_PREFIX = "snapshots/"


def _client():
    """Lazy-construct the boto3 S3 client. Returns None if credentials missing."""
    endpoint = os.environ.get("DATA_SYNC_ENDPOINT_URL")
    access_key = os.environ.get("DATA_SYNC_ACCESS_KEY")
    secret_key = os.environ.get("DATA_SYNC_SECRET_KEY")
    if not (endpoint and access_key and secret_key):
        return None
    import boto3
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=os.environ.get("DATA_SYNC_REGION", "auto"),
    )


def _bucket() -> Optional[str]:
    return os.environ.get("DATA_SYNC_BUCKET")


def _make_tarball() -> bytes:
    """Tar /data/bars.db + /data/bars_cache/ into an in-memory gzip tarball.

    Returns the tarball bytes. Raises FileNotFoundError if neither path exists
    (don't ship empty snapshots — they'd overwrite a good one with nothing)."""
    db_path = os.path.join(_DATA_DIR, "bars.db")
    cache_path = os.path.join(_DATA_DIR, "bars_cache")
    has_db = os.path.exists(db_path)
    has_cache = os.path.isdir(cache_path)
    if not (has_db or has_cache):
        raise FileNotFoundError(f"nothing to snapshot at {_DATA_DIR}")

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        if has_db:
            tar.add(db_path, arcname="bars.db")
        if has_cache:
            tar.add(cache_path, arcname="bars_cache")
    return buf.getvalue()


def upload_snapshot() -> Optional[str]:
    """Upload a fresh snapshot. Returns the snapshot timestamp, or None on failure."""
    client = _client()
    bucket = _bucket()
    if not (client and bucket):
        logger.warning("[data_sync] credentials/bucket missing; skipping upload")
        return None
    try:
        data = _make_tarball()
    except FileNotFoundError as e:
        logger.warning(f"[data_sync] skip upload: {e}")
        return None
    ts = str(int(time.time()))
    key = f"{_SNAPSHOT_PREFIX}{ts}.tar.gz"
    try:
        client.put_object(Bucket=bucket, Key=key, Body=data,
                          ContentType="application/gzip")
        client.put_object(Bucket=bucket, Key=_LATEST_KEY, Body=ts.encode(),
                          ContentType="text/plain")
        logger.info(f"[data_sync] uploaded snapshot {ts} ({len(data)} bytes)")
        return ts
    except Exception as e:
        logger.exception(f"[data_sync] upload failed: {e}")
        return None


def get_latest_snapshot_ts() -> Optional[str]:
    """Read latest.txt from the bucket. Returns the snapshot timestamp or None."""
    client = _client()
    bucket = _bucket()
    if not (client and bucket):
        return None
    try:
        resp = client.get_object(Bucket=bucket, Key=_LATEST_KEY)
        return resp["Body"].read().decode().strip()
    except Exception as e:
        logger.warning(f"[data_sync] could not read latest.txt: {e}")
        return None


def download_snapshot(ts: str) -> bool:
    """Download snapshot <ts> to _DATA_DIR, replacing existing bars.db + bars_cache/.

    Returns True on success, False on any failure. Atomic-ish: writes to a
    temp directory then renames into place. Existing files are replaced."""
    import shutil
    import tempfile
    client = _client()
    bucket = _bucket()
    if not (client and bucket):
        return False
    key = f"{_SNAPSHOT_PREFIX}{ts}.tar.gz"
    try:
        resp = client.get_object(Bucket=bucket, Key=key)
        data = resp["Body"].read()
    except Exception as e:
        logger.warning(f"[data_sync] download failed for {key}: {e}")
        return False
    tmpdir = tempfile.mkdtemp(prefix="data_sync_")
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
            tar.extractall(tmpdir)
        os.makedirs(_DATA_DIR, exist_ok=True)
        # Replace bars.db
        src_db = os.path.join(tmpdir, "bars.db")
        if os.path.exists(src_db):
            shutil.move(src_db, os.path.join(_DATA_DIR, "bars.db"))
        # Replace bars_cache (replace the whole directory, not merge)
        src_cache = os.path.join(tmpdir, "bars_cache")
        if os.path.isdir(src_cache):
            dst_cache = os.path.join(_DATA_DIR, "bars_cache")
            if os.path.isdir(dst_cache):
                shutil.rmtree(dst_cache)
            shutil.move(src_cache, dst_cache)
        logger.info(f"[data_sync] downloaded snapshot {ts}")
        # Track when we last synced so /api/health/cache can report it.
        _write_local_marker(ts)
        return True
    except Exception as e:
        logger.exception(f"[data_sync] extract failed for {key}: {e}")
        return False
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _write_local_marker(ts: str) -> None:
    """Write a small marker file so /api/health/cache can report sync freshness."""
    try:
        with open(os.path.join(_DATA_DIR, ".last_sync_ts"), "w") as f:
            f.write(f"{ts}\n{int(time.time())}\n")
    except OSError:
        pass


def get_local_sync_state() -> dict:
    """Return what we know about the local sync state from the marker file.

    Returns {"snapshot_ts": str|None, "synced_at": int|None,
             "seconds_since_sync": int|None}."""
    path = os.path.join(_DATA_DIR, ".last_sync_ts")
    out = {"snapshot_ts": None, "synced_at": None, "seconds_since_sync": None}
    try:
        with open(path) as f:
            lines = f.read().splitlines()
        if len(lines) >= 2:
            out["snapshot_ts"] = lines[0].strip()
            out["synced_at"] = int(lines[1].strip())
            out["seconds_since_sync"] = int(time.time()) - out["synced_at"]
    except (OSError, ValueError):
        pass
    return out


def sync_if_newer() -> Optional[str]:
    """Pull latest snapshot from remote IF it's newer than what we have locally.

    Returns the snapshot ts that was downloaded (string), or None if no
    download happened (already up to date, or remote unreachable, or error)."""
    remote_ts = get_latest_snapshot_ts()
    if not remote_ts:
        return None
    local = get_local_sync_state()
    if local["snapshot_ts"] == remote_ts:
        return None  # already up to date
    if download_snapshot(remote_ts):
        return remote_ts
    return None
```

- [ ] **Step 2: Verify Python parses**

```bash
cd /c/Users/Patrick/uct-dashboard
py -3 -c "import ast; ast.parse(open('api/services/data_sync.py').read()); print('ok')"
```

- [ ] **Step 3: Commit**

```bash
cd /c/Users/Patrick/uct-dashboard
git add api/services/data_sync.py
git commit -m "Add data_sync: S3-compatible bars snapshot upload/download

Storage-agnostic boto3 client (R2, AWS S3, Massive S3 — anything with
an S3 endpoint). Worker calls upload_snapshot() every 5 min; web calls
sync_if_newer() every 5 min on a background thread.

Snapshot layout: snapshots/<unix-ts>.tar.gz contains bars.db +
bars_cache/. latest.txt is a single-line pointer to the most recent ts.
Download is atomic-ish via tempdir + rename. Local marker file
.last_sync_ts tracks freshness for /api/health/cache reporting.

No callers yet — wired up in subsequent commits."
```

---

## Task 3: Add unit tests for data_sync

**Files:**
- Create: `api/services/data_sync_test.py`

- [ ] **Step 1: Check what test framework the backend uses**

```bash
cd /c/Users/Patrick/uct-dashboard
grep -rn "import pytest\|from pytest" api/ 2>/dev/null | grep -v __pycache__ | head -3
ls api/tests/ 2>/dev/null
cat pytest.ini 2>/dev/null
```

If `pytest.ini` exists and `pytest` is in requirements, pytest is the runner. If neither: tests will only verify the module is importable + tar/untar round-trip works locally (no S3 mock).

- [ ] **Step 2: Write the test file**

Create `api/services/data_sync_test.py` with:

```python
"""Tests for api.services.data_sync.

Tests the local tar/untar round-trip without any S3 — just file I/O.
S3 calls are tested manually after deploy by curling /api/health/cache."""
import io
import os
import tarfile
import tempfile
import time

import pytest


def test_make_tarball_round_trip(tmp_path, monkeypatch):
    """A file written under DATA_DIR survives a tarball round-trip."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    # Prep: create fake bars.db and a file inside bars_cache/
    (tmp_path / "bars.db").write_bytes(b"sqlite-fake-data")
    cache = tmp_path / "bars_cache"
    cache.mkdir()
    (cache / "AAPL_D.json").write_text('{"bars":[]}')

    # Reload the module so it picks up the new DATA_DIR.
    import importlib
    from api.services import data_sync
    importlib.reload(data_sync)

    # Make tarball
    data = data_sync._make_tarball()
    assert len(data) > 0

    # Extract and verify
    extract_dir = tmp_path / "extracted"
    extract_dir.mkdir()
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        tar.extractall(extract_dir)
    assert (extract_dir / "bars.db").read_bytes() == b"sqlite-fake-data"
    assert (extract_dir / "bars_cache" / "AAPL_D.json").read_text() == '{"bars":[]}'


def test_make_tarball_empty_dir_raises(tmp_path, monkeypatch):
    """If neither bars.db nor bars_cache/ exists, refuse to make an empty snapshot."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import importlib
    from api.services import data_sync
    importlib.reload(data_sync)
    with pytest.raises(FileNotFoundError):
        data_sync._make_tarball()


def test_local_marker_round_trip(tmp_path, monkeypatch):
    """Writing a marker then reading it back produces correct sync state."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import importlib
    from api.services import data_sync
    importlib.reload(data_sync)

    ts = str(int(time.time()) - 30)  # snapshot was made 30s ago
    data_sync._write_local_marker(ts)

    state = data_sync.get_local_sync_state()
    assert state["snapshot_ts"] == ts
    assert state["synced_at"] is not None
    # synced_at should be within the last few seconds (we just wrote it)
    assert 0 <= state["seconds_since_sync"] < 5


def test_local_sync_state_when_no_marker(tmp_path, monkeypatch):
    """No marker file → all None."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import importlib
    from api.services import data_sync
    importlib.reload(data_sync)
    state = data_sync.get_local_sync_state()
    assert state == {"snapshot_ts": None, "synced_at": None, "seconds_since_sync": None}


def test_client_returns_none_without_credentials(monkeypatch):
    """No env vars → no client (don't crash; let caller handle gracefully)."""
    for var in ("DATA_SYNC_ENDPOINT_URL", "DATA_SYNC_ACCESS_KEY", "DATA_SYNC_SECRET_KEY"):
        monkeypatch.delenv(var, raising=False)
    import importlib
    from api.services import data_sync
    importlib.reload(data_sync)
    assert data_sync._client() is None
```

- [ ] **Step 3: Run the tests**

```bash
cd /c/Users/Patrick/uct-dashboard
py -3 -m pytest api/services/data_sync_test.py -v 2>&1 | tail -20
```

Expected: 5 tests pass. If pytest isn't installed or PATH issue:
```bash
py -3 -m pip install pytest
py -3 -m pytest api/services/data_sync_test.py -v
```

If pytest still fails, INSPECT the error. Most likely issues: relative import (need `cd /c/Users/Patrick/uct-dashboard && py -3 -m pytest ...` from repo root), or boto3 not importable in test env (it's in requirements but if test env doesn't see it, the conditional import inside `_client()` should still work — verify the test that uses no-credentials path passes regardless).

- [ ] **Step 4: Commit**

```bash
cd /c/Users/Patrick/uct-dashboard
git add api/services/data_sync_test.py
git commit -m "Add tests for data_sync: tar round-trip + local marker

5 tests covering pure-file-IO paths (no S3 mocking yet — that's verified
manually post-deploy via /api/health/cache). Catches regressions in the
tarball format and the local sync-state marker file."
```

---

## Task 4: Add `/api/health/cache` endpoint to `api/main.py`

**Files:**
- Modify: `api/main.py`

This endpoint reports last-sync freshness so we can verify the worker → web pipe is healthy without manually inspecting filesystems.

- [ ] **Step 1: Find the existing `/api/health` endpoint**

```bash
cd /c/Users/Patrick/uct-dashboard
grep -n "/api/health" api/main.py | head -5
```

Note the line number. The new `/api/health/cache` endpoint should go right after it for visual grouping.

- [ ] **Step 2: Add the new endpoint**

In `api/main.py`, find the existing `/api/health` handler (likely a single function). Add IMMEDIATELY AFTER its closing brace/return:

```python
@app.get("/api/health/cache")
def health_cache():
    """Reports staleness of the bars snapshot pulled from the worker service.

    On the web service: snapshot_ts and synced_at come from data_sync's local
    marker (written every time we successfully pull from R2). On the worker
    service or when WORKER_ENABLED is unset, this endpoint still works but
    snapshot_ts will be None (no syncing happens)."""
    from api.services.data_sync import get_local_sync_state
    state = get_local_sync_state()
    return {
        "worker_enabled": os.environ.get("WORKER_ENABLED") == "1",
        "snapshot_ts": state["snapshot_ts"],
        "synced_at": state["synced_at"],
        "seconds_since_sync": state["seconds_since_sync"],
    }
```

- [ ] **Step 3: Verify Python parses**

```bash
cd /c/Users/Patrick/uct-dashboard
py -3 -c "import ast; ast.parse(open('api/main.py').read()); print('ok')"
```

- [ ] **Step 4: Commit**

```bash
cd /c/Users/Patrick/uct-dashboard
git add api/main.py
git commit -m "Add /api/health/cache reporting bars-snapshot sync freshness

Returns worker_enabled (env flag), snapshot_ts (from local marker),
synced_at (unix timestamp), seconds_since_sync. When WORKER_ENABLED is
unset or no sync has happened yet, snapshot_ts and friends are null
but the endpoint still responds 200. Lets us verify the worker → web
pipe is healthy via curl without inspecting Railway filesystems."
```

---

## Task 5: Gate the in-process prewarmer + add S3 puller thread on web

**Files:**
- Modify: `api/main.py`

When `WORKER_ENABLED=1` is set on web: skip the in-process `_prewarm_bars` thread (worker is doing it elsewhere) and START a periodic S3-pull thread that calls `data_sync.sync_if_newer()` every 5 minutes.

- [ ] **Step 1: Find the existing prewarmer wiring in `api/main.py`**

```bash
cd /c/Users/Patrick/uct-dashboard
grep -n "_prewarm_bars\|BARS_PREWARM_ENABLED\|start_background_seeder" api/main.py | head -10
```

The existing pattern (per Phase 0 audit): inside `lifespan()`, the prewarmer is gated by `BARS_PREWARM_ENABLED=1`. We're adding a SECOND gate: skip if `WORKER_ENABLED=1`.

- [ ] **Step 2: Add the WORKER_ENABLED check before the prewarmer block**

In `api/main.py`, find the existing prewarmer launch (likely something like `if os.environ.get("BARS_PREWARM_ENABLED") == "1": ... _prewarm_bars ...`). Wrap it (or add a sibling guard) so it only runs when `WORKER_ENABLED` is NOT set. Same for `start_background_seeder()`.

Find the lines that launch the prewarmer thread + seeder. Wrap with:

```python
        if os.environ.get("WORKER_ENABLED") == "1":
            print("[startup] WORKER_ENABLED=1 — skipping in-process prewarmer/seeder; worker service handles it")
        else:
            # ... existing prewarmer + seeder launch code unchanged ...
```

(You'll need to read the actual surrounding code in `api/main.py` to indent correctly. Use `sed -n '215,240p' api/main.py` to see.)

- [ ] **Step 3: Add the S3 puller background thread**

Right AFTER the prewarmer/seeder block (whether it ran or was skipped), add:

```python
        # When the worker service is producing snapshots, pull them every 5 min.
        if os.environ.get("WORKER_ENABLED") == "1":
            def _s3_pull_loop():
                from api.services import data_sync
                import time as _t
                while True:
                    try:
                        ts = data_sync.sync_if_newer()
                        if ts:
                            print(f"[data_sync] pulled snapshot {ts}")
                    except Exception as e:
                        print(f"[data_sync] pull error (non-fatal): {e}")
                    _t.sleep(300)
            threading.Thread(target=_s3_pull_loop, daemon=True, name="s3_pull").start()
            print("[startup] S3 snapshot puller thread started (5-min cadence)")
```

If `threading` isn't already imported at the top of `api/main.py`, ADD it (`import threading`).

- [ ] **Step 4: Verify Python parses**

```bash
cd /c/Users/Patrick/uct-dashboard
py -3 -c "import ast; ast.parse(open('api/main.py').read()); print('ok')"
```

- [ ] **Step 5: Manually trace the logic**

Read your changes back. Verify:
- If `WORKER_ENABLED=1`: print skip message, do NOT launch prewarmer/seeder, DO launch S3 puller.
- If `WORKER_ENABLED` is unset: behave like today (prewarmer behind BARS_PREWARM_ENABLED, seeder runs), do NOT launch S3 puller.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Patrick/uct-dashboard
git add api/main.py
git commit -m "Gate prewarmer behind WORKER_ENABLED + start S3 puller when set

When WORKER_ENABLED=1 on the web service:
  * In-process _prewarm_bars and start_background_seeder are skipped
    (the worker service is doing both, writing to its own /data volume,
    uploading snapshots to R2).
  * A new background thread (s3_pull) runs every 5 min, calling
    data_sync.sync_if_newer() to download the latest snapshot from R2
    into web's local /data volume.

When WORKER_ENABLED is unset (default): behaves identically to today.
This is the rollback path — unset the env var, web reverts in one
restart with no code change.

Both web and worker must have R2 credentials in env (DATA_SYNC_*) for
the sync to actually do anything; without them, every call no-ops with
a warning log."
```

---

## Task 6: Create `api/worker_main.py` — the worker service entry point

**Files:**
- Create: `api/worker_main.py`

Minimal FastAPI app that exists ONLY to satisfy Railway's healthcheck. Real work happens in background threads.

- [ ] **Step 1: Read what the existing `_prewarm_bars` and `start_background_seeder` look like so we can call them correctly**

```bash
cd /c/Users/Patrick/uct-dashboard
grep -n "def _prewarm_bars\|def start_background_seeder" api/main.py api/services/bars_seeder.py | head -5
```

The worker reuses the SAME logic that's currently inside `api/main.py`'s lifespan. We can't import `_prewarm_bars` directly because it's likely a local function defined inside `lifespan`. **Solution:** in this same task we extract `_prewarm_bars` to a module-level function in `api/services/bars_prewarm.py` so both web (when not WORKER_ENABLED) and worker can import it.

- [ ] **Step 2: Create `api/services/bars_prewarm.py` extracting the prewarmer function**

```bash
cd /c/Users/Patrick/uct-dashboard
sed -n '227,378p' api/main.py > /tmp/prewarm_body.py
wc -l /tmp/prewarm_body.py
```

Read `/tmp/prewarm_body.py`. Extract everything inside the `def _prewarm_bars():` function (without the def line itself — copy the body). Create `api/services/bars_prewarm.py` with:

```python
"""Bars pre-warmer — the long-running loop that periodically refreshes
the most-viewed tickers' SQLite + disk cache entries.

Lives in services/ (not main.py) so the worker service can import it
without dragging in FastAPI."""
import os
import json
import time as _t
import threading
from concurrent.futures import ThreadPoolExecutor


def run_prewarmer_forever():
    """Entry point: blocks forever, refreshing the cache every 5 minutes."""
    # ... (paste the body of the existing _prewarm_bars from main.py here,
    # adjusted for the module-level imports — replace any locally-imported
    # bits with the imports above) ...
    raise NotImplementedError(
        "TODO: paste the body of _prewarm_bars from main.py here. "
        "Implementer should literally copy lines 228-378 of main.py and "
        "remove any references to closure variables that aren't passed "
        "in (none expected — _prewarm_bars uses imports/env, not closure)."
    )
```

**Implementer note:** the TODO is intentional. The actual body of `_prewarm_bars` is too long to inline in this plan and varies per the latest commit. The implementer should:
  1. Read the current `_prewarm_bars` body in `api/main.py` (the function defined inside `lifespan`).
  2. Verify it has no closure dependencies on lifespan-local variables (it should only use imports + env vars).
  3. Paste the body verbatim into `run_prewarmer_forever()`, adjusting indentation.
  4. If there ARE closure deps — STOP and report BLOCKED with details.

- [ ] **Step 3: Update `api/main.py` to call `bars_prewarm.run_prewarmer_forever()` instead of the inline body**

Find where `_prewarm_bars` is defined and called inside `lifespan` in `api/main.py`. Replace the entire `def _prewarm_bars(): ...` definition AND the `threading.Thread(target=_prewarm_bars, ...).start()` line with:

```python
        from api.services.bars_prewarm import run_prewarmer_forever
        threading.Thread(target=run_prewarmer_forever, daemon=True, name="prewarm").start()
```

(Still inside the `else` branch of the WORKER_ENABLED check from Task 5.)

- [ ] **Step 4: Now create `api/worker_main.py`**

Create `api/worker_main.py` with:

```python
"""Worker service entry point.

Run with: python -m api.worker_main

This is a separate Railway service from the web app. It runs:
  - The bars pre-warmer (api.services.bars_prewarm.run_prewarmer_forever)
  - The bars seeder (api.services.bars_seeder.start_background_seeder)
  - A periodic S3 uploader that snapshots /data and pushes to R2

Exposes only /internal/health on its HTTP port for Railway's healthcheck.
Never serves user requests."""
import os
import sys
import threading
import time
import logging

from fastapi import FastAPI
import uvicorn

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(message)s",
)
log = logging.getLogger("worker")


def _start_prewarmer():
    from api.services.bars_prewarm import run_prewarmer_forever
    log.info("starting prewarmer thread")
    threading.Thread(target=run_prewarmer_forever, daemon=True, name="prewarm").start()


def _start_seeder():
    try:
        from api.services.bars_seeder import start_background_seeder
        log.info("starting bars seeder")
        start_background_seeder()
    except Exception as e:
        log.exception(f"seeder start failed (non-fatal): {e}")


def _start_uploader():
    """Push a snapshot to R2 every 5 minutes."""
    from api.services import data_sync

    def loop():
        while True:
            try:
                ts = data_sync.upload_snapshot()
                if ts:
                    log.info(f"uploaded snapshot {ts}")
            except Exception as e:
                log.exception(f"upload error (non-fatal): {e}")
            time.sleep(300)

    log.info("starting S3 uploader thread (5-min cadence)")
    threading.Thread(target=loop, daemon=True, name="s3_upload").start()


def _build_app() -> FastAPI:
    app = FastAPI(title="UCT Worker", docs_url=None, redoc_url=None)

    @app.get("/internal/health")
    def health():
        from api.services.data_sync import get_local_sync_state
        state = get_local_sync_state()
        return {
            "alive": True,
            "service": "worker",
            "snapshot_ts": state["snapshot_ts"],
            "synced_at": state["synced_at"],
            "seconds_since_sync": state["seconds_since_sync"],
        }

    return app


def main():
    log.info("worker boot starting")
    # Bring up SQLite (needed by both prewarmer and seeder)
    try:
        from api.services import bars_sqlite as _bs
        _bs.init_db()
        log.info("bars SQLite ready")
    except Exception as e:
        log.exception(f"bars SQLite init failed: {e}")
        sys.exit(1)

    _start_prewarmer()
    _start_seeder()
    _start_uploader()

    port = int(os.environ.get("PORT", "8080"))
    log.info(f"worker HTTP listening on :{port} (healthcheck only)")
    uvicorn.run(_build_app(), host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Verify Python parses**

```bash
cd /c/Users/Patrick/uct-dashboard
py -3 -c "import ast; ast.parse(open('api/worker_main.py').read()); print('worker_main ok')"
py -3 -c "import ast; ast.parse(open('api/services/bars_prewarm.py').read()); print('bars_prewarm ok')"
py -3 -c "import ast; ast.parse(open('api/main.py').read()); print('main ok')"
```

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Patrick/uct-dashboard
git add api/worker_main.py api/services/bars_prewarm.py api/main.py
git commit -m "Add worker service entry point + extract prewarmer to bars_prewarm

Three pieces:

1. api/services/bars_prewarm.py — extracted the inline _prewarm_bars
   function from main.py's lifespan into a module-level
   run_prewarmer_forever() so both web (when WORKER_ENABLED unset) and
   worker can call it.

2. api/main.py — replaced the inline _prewarm_bars with an import
   from bars_prewarm. No behavior change for web — same function, same
   thread spawn, same WORKER_ENABLED gate from prior commit.

3. api/worker_main.py — the worker service entry point. Run with
   'python -m api.worker_main'. Spawns 3 threads (prewarmer, seeder,
   S3 uploader) and exposes /internal/health for Railway. Never serves
   user requests.

Not yet wired up in production — needs the Railway service created in
the dashboard (separate Task in plan)."
```

---

## Task 7: USER ACTION — Set up Cloudflare R2 bucket + credentials

**Files:** none (dashboard work).

This task can't be automated. The user does it via Cloudflare dashboard.

- [ ] **Step 1: Create R2 bucket**

In Cloudflare dashboard:
1. Go to R2 → Overview → Create bucket
2. Name: `uct-bars-snapshots`
3. Location: Automatic (Cloudflare picks closest)
4. Click Create

- [ ] **Step 2: Generate API token for the bucket**

In Cloudflare R2:
1. Manage R2 API Tokens → Create API token
2. Permissions: Object Read & Write
3. Specify bucket: `uct-bars-snapshots`
4. TTL: forever (no expiry)
5. Click Create
6. **COPY the Access Key ID and Secret Access Key NOW** — they're shown only once
7. **COPY the S3 endpoint URL** (looks like `https://<account-id>.r2.cloudflarestorage.com`)

- [ ] **Step 3: Stash credentials securely**

Save in your password manager or somewhere safe. You'll paste them into Railway env vars in Task 9.

---

## Task 8: USER ACTION — Create the worker Railway service

**Files:** none (Railway dashboard work).

- [ ] **Step 1: In Railway dashboard, in the existing project that hosts `web`**

1. Click "+ New Service"
2. Choose "GitHub Repo" → select `unchartedterritory5995-cyber/UCT-Dashboard`
3. Service name: `worker`
4. Root directory: leave blank (same repo as web)
5. Build command: `pip install -r requirements.txt` (skip the npm install + build — worker doesn't need the React app)
6. Start command: `python -m api.worker_main`
7. Healthcheck path: `/internal/health`
8. Healthcheck timeout: 300 seconds

- [ ] **Step 2: Attach a fresh persistent volume to the worker service**

1. In the worker service settings → Volumes → Add Volume
2. Mount path: `/data`
3. Size: 5 GB (default; adjust if bars cache grows beyond this)

- [ ] **Step 3: Don't deploy yet — env vars come next**

---

## Task 9: USER ACTION — Set env vars on both services

**Files:** none (Railway dashboard work).

- [ ] **Step 1: On the WORKER service**

Add these env vars in Railway dashboard:

```
DATA_SYNC_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
DATA_SYNC_ACCESS_KEY=<from Task 7 step 2>
DATA_SYNC_SECRET_KEY=<from Task 7 step 2>
DATA_SYNC_BUCKET=uct-bars-snapshots
DATA_SYNC_REGION=auto
BARS_PREWARM_ENABLED=1
DATA_DIR=/data
MASSIVE_API_KEY=<copy from web service's existing env>
FMP_API_KEY=<copy from web service's existing env, if set>
```

(Worker needs Massive/FMP API keys because the prewarmer fetches bars from upstream.)

- [ ] **Step 2: On the WEB service**

Add the SAME R2 credentials (so web can pull):

```
DATA_SYNC_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
DATA_SYNC_ACCESS_KEY=<from Task 7 step 2>
DATA_SYNC_SECRET_KEY=<from Task 7 step 2>
DATA_SYNC_BUCKET=uct-bars-snapshots
DATA_SYNC_REGION=auto
```

**Do NOT set `WORKER_ENABLED=1` on web yet** — that comes after we verify the worker is uploading.

---

## Task 10: USER ACTION — Trigger worker first deploy + verify upload

**Files:** none (Railway dashboard + curl).

- [ ] **Step 1: Trigger the worker deploy**

In Railway: Worker service → Deployments → Deploy now (or push any commit; auto-deploy will trigger).

- [ ] **Step 2: Watch the worker logs**

In Railway: Worker → Logs → live tail. Wait for these messages in order:

```
[startup] worker boot starting
[startup] bars SQLite ready
[startup] starting prewarmer thread
[startup] starting bars seeder
[startup] starting S3 uploader thread (5-min cadence)
[startup] worker HTTP listening on :8080 (healthcheck only)
```

Then within 5-10 minutes:

```
uploaded snapshot 1730XXXXX
```

If you see error messages instead — copy them and report. Common issues: bad R2 credentials (403 forbidden), wrong bucket name (NoSuchBucket), missing MASSIVE_API_KEY (prewarmer crashes).

- [ ] **Step 3: Verify the upload landed**

In Cloudflare R2 dashboard → uct-bars-snapshots bucket → Objects. You should see:
- `latest.txt` (size ~10 bytes)
- `snapshots/<timestamp>.tar.gz` (size depends on cache — could be 50 MB to several hundred MB)

- [ ] **Step 4: Verify worker healthcheck**

Find the worker service's public URL in Railway (or use Railway's internal networking — but easiest is to enable "Public Networking" temporarily on the worker for verification). Then:

```bash
curl -s https://<worker-url>/internal/health
```

Expected:
```json
{"alive":true,"service":"worker","snapshot_ts":"1730XXXXX","synced_at":1730XXXXX,"seconds_since_sync":N}
```

After verification, **disable public networking on worker** (it should only be reachable internally — Railway healthcheck works on private network).

---

## Task 11: Flip WORKER_ENABLED on web + verify

**Files:** none (Railway dashboard + curl).

- [ ] **Step 1: On WEB service, add the env var**

```
WORKER_ENABLED=1
```

- [ ] **Step 2: Web auto-redeploys (or trigger manually)**

Watch web logs for:

```
[startup] WORKER_ENABLED=1 — skipping in-process prewarmer/seeder; worker service handles it
[startup] S3 snapshot puller thread started (5-min cadence)
```

Within 5 min, also expect:

```
[data_sync] pulled snapshot 1730XXXXX
```

- [ ] **Step 3: Verify web is serving cached data**

```bash
curl -s https://uctintelligence.com/api/health/cache
```

Expected:
```json
{"worker_enabled":true,"snapshot_ts":"1730XXXXX","synced_at":1730XXXXX,"seconds_since_sync":N}
```

`seconds_since_sync` should be < 600 (10 min). If null or much larger, web didn't pull — check logs for puller errors.

- [ ] **Step 4: Verify a chart still loads correctly**

Open `https://uctintelligence.com/breadth` in browser. Click any ticker → chart popup. The bars should load instantly from cache (the worker pre-warmed them). If they take >2s, the puller may not have synced yet OR the chart is hitting a TF that wasn't pre-warmed (will fall back to live fetch).

- [ ] **Step 5: Watch CPU usage on the web service for 1 hour**

In Railway: Web → Metrics → CPU. Should drop materially compared to pre-WORKER baseline (the prewarmer was the biggest CPU consumer on web).

---

## Task 12: 24-hour observation + cleanup commit

**Files:** none.

- [ ] **Step 1: Watch for issues over 24 hours**

- Sentry backend errors: should be stable or decreasing (less prewarmer-vs-request CPU contention)
- Web CPU: should be lower
- Worker CPU: should look like web's old prewarmer-active baseline
- `/api/health/cache` `seconds_since_sync` should never exceed 600 for more than a brief window
- Random chart loads should still feel fast

- [ ] **Step 2: If anything's broken, ROLLBACK**

```
Web service → unset WORKER_ENABLED env var → redeploy
```

That's the entire rollback. Worker keeps running but is unused. Take the time to investigate before re-enabling.

- [ ] **Step 3: After 24h clean, mark Phase 1 complete with a final commit**

```bash
cd /c/Users/Patrick/uct-dashboard
git commit --allow-empty -m "Phase 1 prewarmer extraction deployed and stable

- Worker service running api.worker_main, owns its own /data volume
- R2 bucket uct-bars-snapshots has snapshot every 5 min
- Web service syncs via data_sync.sync_if_newer() every 5 min
- WORKER_ENABLED=1 on web skips in-process prewarmer/seeder
- /api/health/cache reports sync freshness for monitoring

Verified over 24h:
- Web CPU dropped from baseline (prewarmer no longer competes)
- Cache freshness always <10 min
- Chart loads still instant for pre-warmed tickers
- No new errors in Sentry

Phase 2 (async backend + multi-worker) now unblocked — APScheduler is
still in the web process; that's the next extraction. Phase 1.5 will
move it before Phase 2's --workers 2 rollout."
```

---

## Self-Review (post-write)

**Spec coverage:**
- bars_fetch refactor → Task 1 ✓
- worker_main.py → Task 6 ✓
- New Railway service → Tasks 8, 9, 10 ✓
- Volume per service (no sharing) → Task 8 step 2 ✓
- S3 sync (R2) → Tasks 2, 3, 7, 9 ✓
- /api/health/cache → Task 4 ✓
- Feature flag WORKER_ENABLED → Task 5 ✓
- Phase 1.5 (APScheduler extraction) → noted as out of scope, deferred ✓

**Placeholder scan:**
- Task 6 step 2 has an explicit `NotImplementedError` placeholder for the `run_prewarmer_forever` body — this is INTENTIONAL because the prewarmer body changes between sessions and the implementer must paste the current version. Marked clearly with implementer instructions.
- All other tasks have complete code.

**Type/name consistency:**
- `data_sync` module functions: `_make_tarball`, `upload_snapshot`, `get_latest_snapshot_ts`, `download_snapshot`, `sync_if_newer`, `get_local_sync_state`, `_write_local_marker`, `_client`, `_bucket` — all consistently named, all referenced correctly across tasks.
- Env vars: `DATA_SYNC_ENDPOINT_URL`, `DATA_SYNC_BUCKET`, `DATA_SYNC_ACCESS_KEY`, `DATA_SYNC_SECRET_KEY`, `DATA_SYNC_REGION`, `WORKER_ENABLED`, `BARS_PREWARM_ENABLED`, `DATA_DIR` — same names across all tasks.
- `bars_prewarm.run_prewarmer_forever` — referenced in Task 6 from both `worker_main.py` and `main.py`, name matches.

**Risks not in plan:**
- The implementer in Task 6 may discover that `_prewarm_bars` HAS closure dependencies after all (it likely doesn't, but if it does, plan should branch). The plan instructs them to STOP and report BLOCKED — that's the right escalation.
- If the user's Cloudflare R2 free tier doesn't support enough storage (10 GB free), they'll need a paid plan. Snapshot size is ~50–500 MB so 10 GB allows ~20–200 historical snapshots before pruning is needed. Plan doesn't include snapshot pruning — a follow-up.

**Add follow-up note:** After 24h verification, schedule a tiny PR to add a "delete snapshots older than 7 days" cleanup in the worker — keeps R2 storage bounded.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-04-phase-1-prewarmer-extraction.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks. Tasks 7–11 require user dashboard interaction so I'll pause and hand to you for those.

**2. Inline Execution** — I run code-tasks myself with checkpoints. Same user-action pause points.

**Which approach?** Same as Phase 0 → recommending Subagent-Driven.
