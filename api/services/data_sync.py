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
import shutil
import sqlite3
import tarfile
import tempfile
import time
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_DATA_DIR = os.environ.get("DATA_DIR", "/data")
_LATEST_KEY = "latest.txt"
_SNAPSHOT_PREFIX = "snapshots/"

# How often the worker uploads and the web pulls. Five minutes balances
# bandwidth against staleness for the historical bars that dominate the
# snapshot. Live (today's) bars don't go through the snapshot — the web
# falls back to direct API fetches when the cache is older than its TTL.
SNAPSHOT_INTERVAL_SECONDS = 300

# Track when the last upload attempt succeeded so the worker's health
# endpoint can report it. Written by upload_snapshot, read by callers.
_LAST_UPLOAD_MARKER = ".last_upload_ts"
# Track when the last successful download landed locally. Written by
# download_snapshot, read by the web's /api/health/cache endpoint.
_LAST_SYNC_MARKER = ".last_sync_ts"


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


def credentials_ok() -> bool:
    """Public probe for misconfiguration. Returns True iff the env vars
    needed to talk to R2 are all set. Used by the worker's health endpoint
    to surface 'no credentials configured' as a distinct state from
    'credentials work but no data to upload yet'."""
    return bool(_client() and _bucket())


def _backup_sqlite_db(src_path: str, dst_path: str) -> None:
    """Use SQLite's online backup API to copy a consistent snapshot.

    Why this matters: bars.db runs in WAL mode. The prewarmer writes
    continuously; recent commits live in bars.db-wal until checkpoint.
    A naive `tar.add('bars.db')` captures only the main file, missing
    anything still in the WAL — the snapshot the web extracts has a
    header current to "now" but data lagging by however many writes
    sit in the WAL. Result: torn reads on the web side.

    The backup API ([1]) reads pages cooperatively with active writers
    and produces a complete, consistent point-in-time copy with no WAL
    files. Tar the dst file and the snapshot is bulletproof.

    [1] https://www.sqlite.org/backup.html
    """
    src = sqlite3.connect(src_path)
    try:
        dst = sqlite3.connect(dst_path)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()


def _make_tarball() -> bytes:
    """Tar a consistent snapshot of /data/bars.db + /data/bars_cache/.

    Returns the tarball bytes. Raises FileNotFoundError if neither path exists
    (don't ship empty snapshots — they'd overwrite a good one with nothing).

    bars.db is copied via SQLite's online backup API into a temp file before
    tarring to avoid torn pages while the prewarmer is writing. bars_cache/
    is JSON files that the disk_cache layer writes atomically (write-then-
    rename), so taring the live directory is safe."""
    db_path = os.path.join(_DATA_DIR, "bars.db")
    cache_path = os.path.join(_DATA_DIR, "bars_cache")
    has_db = os.path.exists(db_path)
    has_cache = os.path.isdir(cache_path)
    if not (has_db or has_cache):
        raise FileNotFoundError(f"nothing to snapshot at {_DATA_DIR}")

    tmpdir = tempfile.mkdtemp(prefix="data_sync_snap_")
    try:
        snap_db_path: Optional[str] = None
        if has_db:
            snap_db_path = os.path.join(tmpdir, "bars.db")
            _backup_sqlite_db(db_path, snap_db_path)

        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            if snap_db_path is not None:
                tar.add(snap_db_path, arcname="bars.db")
            if has_cache:
                tar.add(cache_path, arcname="bars_cache")
        return buf.getvalue()
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# Module-level guard so we don't spam logs every 5 min when the worker
# boots before the prewarmer has produced anything to snapshot. Logged
# once per process; cleared after the first successful upload so a
# transient empty state later still gets reported.
_empty_snapshot_logged = False


def upload_snapshot() -> Optional[str]:
    """Upload a fresh snapshot. Returns the snapshot timestamp, or None on failure."""
    global _empty_snapshot_logged
    client = _client()
    bucket = _bucket()
    if not (client and bucket):
        logger.warning("[data_sync] credentials/bucket missing; skipping upload")
        return None
    try:
        data = _make_tarball()
    except FileNotFoundError as e:
        if not _empty_snapshot_logged:
            logger.warning(f"[data_sync] skip upload (will retry silently): {e}")
            _empty_snapshot_logged = True
        return None
    ts = str(int(time.time()))
    key = f"{_SNAPSHOT_PREFIX}{ts}.tar.gz"
    try:
        client.put_object(Bucket=bucket, Key=key, Body=data,
                          ContentType="application/gzip")
        client.put_object(Bucket=bucket, Key=_LATEST_KEY, Body=ts.encode(),
                          ContentType="text/plain")
        logger.info(f"[data_sync] uploaded snapshot {ts} ({len(data)} bytes)")
        # Track most recent successful upload so the worker's health
        # endpoint can report it (the worker never downloads, so
        # .last_sync_ts is always empty there).
        _write_marker(_LAST_UPLOAD_MARKER, ts)
        # Clear the noisy-log guard so a future empty state still logs.
        _empty_snapshot_logged = False
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
    temp directory then renames into place. Existing files are replaced.

    After a successful replace, calls bars_sqlite.bump_db_epoch() so any
    open thread-local SQLite connections get refreshed on next use. Without
    that, threads keep reading the old (now-unlinked) inode and never see
    the freshly pulled data — which silently breaks the entire purpose of
    syncing."""
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
        # Critical: invalidate every thread's SQLite connection so the next
        # query opens a fresh handle to the just-replaced bars.db inode.
        # Without this, existing threads keep reading the deleted inode
        # forever (Linux unlink-while-open semantics) and the snapshot
        # has zero effect on what users see.
        try:
            # Late import: avoids a module-load cycle. data_sync is imported
            # by api/main.py during startup (lifespan), and bars_sqlite ALSO
            # gets imported there for the prewarmer. Top-level import here
            # would create a hard dependency at module-load time; lazy import
            # at call-time keeps each module independently importable.
            from api.services import bars_sqlite
            bars_sqlite.bump_db_epoch()
        except Exception as e:
            logger.warning(f"[data_sync] bump_db_epoch failed (non-fatal): {e}")
        logger.info(f"[data_sync] downloaded snapshot {ts}")
        # Track when we last synced so /api/health/cache can report it.
        _write_marker(_LAST_SYNC_MARKER, ts)
        return True
    except Exception as e:
        logger.exception(f"[data_sync] extract failed for {key}: {e}")
        return False
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _write_marker(filename: str, ts: str) -> None:
    """Write {filename} with two lines: snapshot ts and current epoch seconds."""
    try:
        with open(os.path.join(_DATA_DIR, filename), "w") as f:
            f.write(f"{ts}\n{int(time.time())}\n")
    except OSError:
        pass


def _read_marker(filename: str) -> dict:
    """Read a {ts, written_at, seconds_since} record from the named marker.

    Returns dict with keys snapshot_ts (str|None), synced_at (int|None,
    when the marker was written), seconds_since_sync (int|None)."""
    path = os.path.join(_DATA_DIR, filename)
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


def get_local_sync_state() -> dict:
    """Return what the WEB knows about the last download from R2."""
    return _read_marker(_LAST_SYNC_MARKER)


def get_local_upload_state() -> dict:
    """Return what the WORKER knows about the last upload to R2.

    Same shape as get_local_sync_state; snapshot_ts is the timestamp of
    the most recent upload that succeeded."""
    return _read_marker(_LAST_UPLOAD_MARKER)


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
