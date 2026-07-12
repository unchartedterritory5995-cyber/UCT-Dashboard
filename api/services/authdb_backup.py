"""Continuous auth.db backup to R2 (DARK, env-gated).

Ships a gzipped, integrity-checked SQLite BACKUP-API snapshot of ``auth.db`` to
R2 on the SAME data-sync rail the bars snapshots use (reuses ``data_sync``'s
client / creds / ``DATA_SYNC_*`` env). Ships **DARK**: gated by
``AUTHDB_BACKUP_ENABLED`` (default ``"0"``) — the owner flips it in Railway.

Why this exists: ``auth.db`` is the crown-jewel DB (users, sessions,
subscriptions, all of Journal 2.0, broker links, ...) and it is **web-local** —
it lives only on the single web pod's ``/data`` volume. A volume loss would be
unrecoverable without an off-box copy. This is that copy.

Design invariants (the 524 law + safety):
  - **NEVER file-copy a hot WAL db.** Uses ``sqlite3.Connection.backup`` (the
    online backup API) to produce a consistent point-in-time snapshot even
    while the web process is writing (session ``last_login``, journal writes,
    ...). A raw ``tar``/``cp`` of a live WAL db captures a torn read.
  - Runs in a scheduler **thread** (``BackgroundScheduler``), never on the
    event loop — mirrors how the other scheduled jobs run.
  - **Exception-contained:** a failed backup logs one line and returns; it
    never raises into the scheduler or crashes anything.
  - **Skips gracefully** when R2 creds are absent (fully inert).
  - Prunes to the newest ``AUTHDB_BACKUP_KEEP`` (default 14) after each upload.

R2 key layout: ``authdb/backup/<UTC ts>.db.gz`` where ``<UTC ts>`` is
``YYYYMMDDTHHMMSSZ`` (lexicographically sortable == chronological, so prune is
a simple name sort).
"""
from __future__ import annotations

import datetime as _dt
import gzip
import logging
import os
import shutil
import sqlite3
import tempfile
import time
from typing import Optional

logger = logging.getLogger(__name__)

ENABLED_ENV = "AUTHDB_BACKUP_ENABLED"
KEY_PREFIX = "authdb/backup/"
# Newest-N retention. Env-tunable; default 14 (roughly a week of 6h + daily
# backups, comfortably covering a "we noticed the corruption a few days late".
RETAIN = int(os.environ.get("AUTHDB_BACKUP_KEEP", "14"))


def is_enabled() -> bool:
    """True only when AUTHDB_BACKUP_ENABLED=1. Ships dark by default."""
    return os.environ.get(ENABLED_ENV, "0") == "1"


def _auth_db_path() -> str:
    """The resolved auth.db path (honours the local-dev fallback in auth_db)."""
    from api.services import auth_db
    return auth_db._DB_PATH


def _snapshot_to_db(src_path: str, dst_db_path: str) -> None:
    """Consistent copy of a (possibly hot WAL) sqlite db via the online backup
    API. Produces a complete point-in-time DB with no attached WAL — safe to
    read/gzip even while the source is being written."""
    src = sqlite3.connect(src_path)
    try:
        dst = sqlite3.connect(dst_db_path)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()


def _integrity_ok(db_path: str) -> bool:
    """Return True iff ``PRAGMA integrity_check`` on ``db_path`` is 'ok'."""
    try:
        c = sqlite3.connect(db_path)
        try:
            row = c.execute("PRAGMA integrity_check").fetchone()
            return bool(row and row[0] == "ok")
        finally:
            c.close()
    except sqlite3.DatabaseError as e:
        logger.error("[authdb_backup] integrity_check could not open %s: %s", db_path, e)
        return False


def _gzip_file(src_path: str, dst_gz_path: str) -> None:
    """Stream-gzip src → dst (constant memory; never slurps the whole db)."""
    with open(src_path, "rb") as f_in, gzip.open(dst_gz_path, "wb", compresslevel=6) as f_out:
        shutil.copyfileobj(f_in, f_out)


def _prune(client, bucket: str, keep: int = RETAIN) -> int:
    """Delete all but the newest ``keep`` backups under KEY_PREFIX.

    The UTC-timestamp keys sort lexicographically == chronologically, so a
    name sort (descending) puts the newest first. Best-effort — never raises."""
    try:
        resp = client.list_objects_v2(Bucket=bucket, Prefix=KEY_PREFIX)
        objs = resp.get("Contents", []) or []
        objs.sort(key=lambda o: o["Key"], reverse=True)  # newest first
        deleted = 0
        for o in objs[keep:]:
            try:
                client.delete_object(Bucket=bucket, Key=o["Key"])
                deleted += 1
            except Exception:
                pass
        return deleted
    except Exception as e:
        logger.warning("[authdb_backup] prune failed (non-fatal): %s", e)
        return 0


def run_backup() -> Optional[str]:
    """Take one auth.db backup and ship it to R2. Returns the UTC ts string on
    success, or None (disabled / no creds / nothing to back up / any failure).

    Wholly exception-contained — safe to hand straight to the scheduler."""
    if not is_enabled():
        return None
    try:
        from api.services import data_sync
        client = data_sync._client()
        bucket = data_sync._bucket()
        if not (client and bucket):
            logger.warning("[authdb_backup] R2 creds/bucket missing; skipping backup")
            return None

        src_path = _auth_db_path()
        if not os.path.exists(src_path):
            logger.warning("[authdb_backup] auth.db not found at %s; skipping", src_path)
            return None

        t0 = time.time()
        tmpdir = tempfile.mkdtemp(prefix="authdb_backup_")
        try:
            snap_db = os.path.join(tmpdir, "auth.db")
            _snapshot_to_db(src_path, snap_db)
            # Verify BEFORE shipping — never bake a corrupt snapshot into R2.
            if not _integrity_ok(snap_db):
                logger.error("[authdb_backup] snapshot failed integrity_check; not uploading")
                return None

            gz_path = snap_db + ".gz"
            _gzip_file(snap_db, gz_path)
            gz_bytes = os.path.getsize(gz_path)

            ts = _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            key = f"{KEY_PREFIX}{ts}.db.gz"
            client.upload_file(
                gz_path, bucket, key, ExtraArgs={"ContentType": "application/gzip"}
            )
            dur = time.time() - t0
            logger.info(
                "[authdb_backup] uploaded %s (%d bytes, %.1fs)", key, gz_bytes, dur
            )
            _prune(client, bucket, RETAIN)
            return ts
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)
    except Exception as e:
        logger.exception("[authdb_backup] backup failed (non-fatal): %s", e)
        return None
