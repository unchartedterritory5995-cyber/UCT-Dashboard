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
