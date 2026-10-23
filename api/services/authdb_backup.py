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

R2 key layout: ``authdb/backup/<UTC ts>.db.gz.enc`` where ``<UTC ts>`` is
``YYYYMMDDTHHMMSSZ``. Prune orders by the parsed timestamp, over BOTH the encrypted
names and the legacy plaintext ``<UTC ts>.db.gz`` ones, so retention keeps counting
across the switch-over and the legacy copies age out by the same RETAIN.

⛔⛔ ENCRYPTED, FAIL-CLOSED (2026-10-22, after the Railway env-var leak): every object is
UCTBK1-encrypted (``api/services/backup_crypto.py``) with ``BACKUP_PUBLIC_KEY``; only the
offline private key can read it. With the key missing or invalid the run logs ONE error
naming the variable and uploads NOTHING — no plaintext fallback, ever.
Runbook: docs/runbooks/backup-encryption.md.
"""
from __future__ import annotations

import datetime as _dt
import gzip
import logging
import os
import re
import shutil
import sqlite3
import tempfile
import time
from typing import Optional

from api.services import backup_crypto

logger = logging.getLogger(__name__)

ENABLED_ENV = "AUTHDB_BACKUP_ENABLED"
KEY_PREFIX = "authdb/backup/"
# Newest-N retention. Env-tunable; default 14 (roughly a week of 6h + daily
# backups, comfortably covering a "we noticed the corruption a few days late".
RETAIN = int(os.environ.get("AUTHDB_BACKUP_KEEP", "14"))
#: A backup object, legacy plaintext (``.db.gz``) or encrypted (``.db.gz.enc``).
KEY_RE = re.compile(r"^" + re.escape(KEY_PREFIX) + r"(\d{8}T\d{6}Z)\.db\.gz(\.enc)?$")


def backup_keys_newest_first(keys) -> list[str]:
    """The backup keys among ``keys``, newest timestamp first (legacy and encrypted together).
    Anything under the prefix that is not a backup is left out — and so never pruned."""
    dated = [(m.group(1), k) for k in keys for m in [KEY_RE.match(k)] if m]
    return [k for _ts, k in sorted(dated, reverse=True)]


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

    Ordered by the parsed UTC timestamp over legacy ``.db.gz`` and encrypted
    ``.db.gz.enc`` keys alike, so one retention count spans the switch-over.
    Best-effort — never raises."""
    try:
        resp = client.list_objects_v2(Bucket=bucket, Prefix=KEY_PREFIX)
        objs = resp.get("Contents", []) or []
        keys = backup_keys_newest_first(o["Key"] for o in objs)
        deleted = 0
        for k in keys[keep:]:
            try:
                client.delete_object(Bucket=bucket, Key=k)
                deleted += 1
            except Exception:
                pass
        return deleted
    except Exception as e:
        logger.warning("[authdb_backup] prune failed (non-fatal): %s", e)
        return 0


def _flush_pending_tombstones(src_path: str, client, bucket: str) -> int:
    """Wave 10 (R-9): push every account-deletion tombstone whose off-site write has not
    happened yet (a deletion while R2 was unreachable, or before this job was armed) to
    the SAME bucket, beside the backups it guards. Never raises."""
    try:
        from api.services import account_tombstones
        conn = sqlite3.connect(src_path, timeout=3)
        try:
            n = account_tombstones.flush_pending(conn, account_tombstones.R2ObjectStore(client, bucket))
        finally:
            conn.close()
        if n:
            logger.info("[authdb_backup] pushed %d pending account tombstone(s)", n)
        return n
    except Exception as e:  # noqa: BLE001 -- a tombstone flush never fails a backup
        logger.warning("[authdb_backup] tombstone flush failed (non-fatal): %s", e)
        return 0


# -- schedule (restart-proof, 2026-10-22) ------------------------------------------
# ⛔ The 6-hourly job was an IntervalTrigger(hours=6). APScheduler starts an interval's
# countdown at process start and the job store is in memory, so on a day with restarts
# more often than every 6h it NEVER fired (R2 on 2026-10-22: only the nightly landed).
# Fixed UTC wall-clock slots fire regardless of when the pod booted; they match the
# times the interval landed on quiet days. The catch-up covers a restart that spans a
# slot: one delayed, one-shot check per boot that backs up only when the newest R2
# object is older than CATCH_UP_MAX_AGE_S — so a burst of redeploys cannot stampede.
SIX_HOURLY_UTC_HOURS = "5,11,17,23"
SIX_HOURLY_UTC_MINUTE = 26
NIGHTLY_ET = (2, 55)
CATCH_UP_MAX_AGE_S = 6 * 3600
CATCH_UP_DELAY_S = 600
#: A cron slot missed because the executor was busy still runs up to this late
#: (APScheduler's job_defaults grace is 1 second).
MISFIRE_GRACE_S = 3600


def _ts_of_key(key: str) -> Optional[_dt.datetime]:
    m = KEY_RE.match(key)
    if not m:
        return None
    return _dt.datetime.strptime(m.group(1), "%Y%m%dT%H%M%SZ").replace(tzinfo=_dt.timezone.utc)


def catch_up_decision(client, bucket: str, now: Optional[_dt.datetime] = None,
                      max_age_s: int = CATCH_UP_MAX_AGE_S) -> tuple[bool, str]:
    """(run?, reason). Lists KEY_PREFIX the way ``_prune`` does and runs only when the
    newest backup is older than ``max_age_s`` (or none exists). A listing failure is a
    SKIP — the cron slots still stand, and an unreadable bucket is not an empty one.
    Never raises."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    try:
        resp = client.list_objects_v2(Bucket=bucket, Prefix=KEY_PREFIX)
        objs = resp.get("Contents", []) or []
        keys = backup_keys_newest_first(o["Key"] for o in objs)
    except Exception as e:  # noqa: BLE001
        return False, f"list failed ({e}); skipping catch-up"
    if not keys:
        return True, "no backups found"
    newest = _ts_of_key(keys[0])
    age = (now - newest).total_seconds()
    if age > max_age_s:
        return True, f"newest {keys[0]} is {age / 3600:.1f}h old"
    return False, f"newest {keys[0]} is {age / 3600:.1f}h old (fresh)"


def run_catch_up() -> Optional[str]:
    """Startup catch-up: one backup iff the newest R2 backup is stale. Same gates as
    ``run_backup`` (dark flag; fail-closed key is enforced inside run_backup).
    Wholly exception-contained."""
    if not is_enabled():
        return None
    try:
        from api.services import data_sync
        client = data_sync._client()
        bucket = data_sync._bucket()
        if not (client and bucket):
            logger.warning("[authdb_backup] catch-up: R2 creds/bucket missing; skipping")
            return None
        run, reason = catch_up_decision(client, bucket)
        logger.info("[authdb_backup] catch-up: %s -> %s", reason, "RUN" if run else "skip")
        if not run:
            return None
        return run_backup()
    except Exception as e:  # noqa: BLE001
        logger.warning("[authdb_backup] catch-up failed (non-fatal): %s", e)
        return None


def register_jobs(scheduler, now: Optional[_dt.datetime] = None) -> list[str]:
    """Register the 6-hourly UTC cron, the nightly ET cron and the delayed one-shot
    catch-up. The caller gates on AUTHDB_BACKUP_ENABLED. Returns the job ids."""
    from zoneinfo import ZoneInfo
    from apscheduler.triggers.cron import CronTrigger
    from apscheduler.triggers.date import DateTrigger
    now = now or _dt.datetime.now(_dt.timezone.utc)
    common = dict(max_instances=1, replace_existing=True, coalesce=True,
                  misfire_grace_time=MISFIRE_GRACE_S)
    scheduler.add_job(
        run_backup,
        trigger=CronTrigger(hour=SIX_HOURLY_UTC_HOURS, minute=SIX_HOURLY_UTC_MINUTE,
                            timezone=_dt.timezone.utc),
        id="authdb_backup_6h", **common)
    scheduler.add_job(
        run_backup,
        trigger=CronTrigger(hour=NIGHTLY_ET[0], minute=NIGHTLY_ET[1],
                            timezone=ZoneInfo("America/New_York")),
        id="authdb_backup_nightly", **common)
    scheduler.add_job(
        run_catch_up,
        trigger=DateTrigger(run_date=now + _dt.timedelta(seconds=CATCH_UP_DELAY_S)),
        id="authdb_backup_catchup", **common)
    return ["authdb_backup_6h", "authdb_backup_nightly", "authdb_backup_catchup"]


def run_backup() -> Optional[str]:
    """Take one auth.db backup and ship it to R2. Returns the UTC ts string on
    success, or None (disabled / no creds / nothing to back up / any failure).

    Wholly exception-contained — safe to hand straight to the scheduler."""
    if not is_enabled():
        return None
    try:
        # ⛔ FAIL CLOSED: no valid public key, no upload. Checked before anything is built.
        public_key = backup_crypto.public_key_or_log(logger, "[authdb_backup]")
        if public_key is None:
            return None
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
            os.remove(snap_db)
            enc_path = gz_path + backup_crypto.ENC_SUFFIX
            backup_crypto.encrypt_file(gz_path, enc_path, public_key)
            os.remove(gz_path)
            gz_bytes = os.path.getsize(enc_path)

            ts = _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            key = f"{KEY_PREFIX}{ts}.db.gz{backup_crypto.ENC_SUFFIX}"
            client.upload_file(
                enc_path, bucket, key, ExtraArgs={"ContentType": backup_crypto.ENC_CONTENT_TYPE}
            )
            dur = time.time() - t0
            logger.info(
                "[authdb_backup] uploaded %s (%d bytes, %.1fs)", key, gz_bytes, dur
            )
            _prune(client, bucket, RETAIN)
            _flush_pending_tombstones(src_path, client, bucket)
            return ts
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)
    except Exception as e:
        logger.exception("[authdb_backup] backup failed (non-fatal): %s", e)
        return None
