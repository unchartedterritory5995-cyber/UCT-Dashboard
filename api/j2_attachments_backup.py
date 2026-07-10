"""
j2_attachments_backup.py — nightly offsite backup of the Journal 2.0 image
attachments tree to R2.

WHY: journal attachments live ONLY on the WEB service's Railway volume (under
J2_ATTACHMENT_ROOT, shared with api/services/journal_two/calendar.py). A volume
loss = permanent loss of every user-uploaded screenshot with NO recovery path.
This job gates the P1b screenshots feature — before we invite users to attach
evidence to trades, the tree must be backed up offsite.

Design mirrors api/flow_backup.py exactly (the proven flow.db rail):
- R2 client construction reuses the bars snapshot rail's DATA_SYNC_* creds, pins
  region us-east-1, and relaxes the two botocore checksum knobs
  (request_checksum_calculation / response_checksum_validation = 'when_required')
  that Cloudflare R2 rejects by default.
- Retain/prune: keep newest _KEEP_MIN (3) regardless of age, delete anything
  older than RETAIN_DAYS (14). Best-effort, never raises.
- A `.j2_attachments_backup_last.json` marker records the last run.
- register_jobs(scheduler) -> bool, gated by J2_ATTACHMENT_BACKUP_ENABLED.

The ONLY structural difference from flow_backup: instead of a sqlite `.backup()`,
we tar.gz the attachments tree (the tree IS the user data — ≤5MB validated
images each, so nothing is skipped).

Everything ships DARK: gated by J2_ATTACHMENT_BACKUP_ENABLED (default 0). P1b's
ship checklist flips it on Railway.

Env:
  J2_ATTACHMENT_BACKUP_ENABLED       master switch (default 0)
  J2_ATTACHMENT_BACKUP_RETAIN_DAYS   prune older than this (default 14; newest >=3 always kept)
  J2_ATTACHMENT_ROOT                 source tree (shared with calendar.py's _ATTACHMENT_ROOT)
  DATA_SYNC_ENDPOINT_URL / _ACCESS_KEY / _SECRET_KEY / _BUCKET / _REGION   R2 creds (reused)
"""
import json
import logging
import os
import shutil
import tarfile
import tempfile
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")

_PREFIX = "j2_attachment_backups/"   # R2 key prefix
_KEEP_MIN = 3                        # never prune the newest N, regardless of age
_MARKER_NAME = ".j2_attachments_backup_last.json"


# --- config (read fresh at call time so a Railway var flip / test env takes ---
# --- effect without a module reload; register_jobs still gates at boot) -------

def _enabled() -> bool:
    return os.environ.get("J2_ATTACHMENT_BACKUP_ENABLED", "0").lower() in ("1", "true", "yes")


def _retain_days() -> int:
    try:
        return int(os.environ.get("J2_ATTACHMENT_BACKUP_RETAIN_DAYS", "14"))
    except (TypeError, ValueError):
        return 14


def _attachment_root() -> Path:
    """The tree to back up. Respects J2_ATTACHMENT_ROOT (same env calendar.py
    reads); falls back to calendar's computed default so the two never diverge."""
    env = os.environ.get("J2_ATTACHMENT_ROOT")
    if env:
        return Path(env)
    from api.services.journal_two.calendar import _ATTACHMENT_ROOT
    return Path(_ATTACHMENT_ROOT)


# --- R2 client (reuses the bars-rail DATA_SYNC_* creds) ----------------------

def _r2_client():
    """Lazy-construct the boto3 S3 client for R2. Returns None if creds missing.

    Region + checksum config are the R2-specific bits: modern boto3 defaults to
    sending CRC32 integrity checksums that R2 rejects, so we relax them to
    'when_required'. boto3/botocore are imported lazily so this module (and its
    tests, which monkeypatch this fn) never hard-depend on them."""
    endpoint = os.environ.get("DATA_SYNC_ENDPOINT_URL")
    access_key = os.environ.get("DATA_SYNC_ACCESS_KEY")
    secret_key = os.environ.get("DATA_SYNC_SECRET_KEY")
    if not (endpoint and access_key and secret_key):
        return None
    import boto3
    from botocore.config import Config

    cfg_common = dict(retries={"max_attempts": 3, "mode": "standard"})
    try:
        # The two checksum knobs land in botocore ~1.36; guard so an older pin
        # doesn't blow up client construction.
        config = Config(
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
            **cfg_common,
        )
    except TypeError:
        config = Config(**cfg_common)
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=os.environ.get("DATA_SYNC_REGION", "us-east-1"),
        config=config,
    )


def _bucket():
    return os.environ.get("DATA_SYNC_BUCKET")


def _r2_configured() -> bool:
    return bool(
        os.environ.get("DATA_SYNC_ENDPOINT_URL")
        and os.environ.get("DATA_SYNC_ACCESS_KEY")
        and os.environ.get("DATA_SYNC_SECRET_KEY")
        and _bucket()
    )


# --- helpers -----------------------------------------------------------------

def _et_date() -> date:
    return datetime.now(ET).date()


def _marker_path() -> str:
    """Marker sits in the PARENT of the attachments root — NOT inside it, or the
    next tarball would sweep it in (rglob('*') matches dotfiles)."""
    return str(_attachment_root().parent / _MARKER_NAME)


def _write_marker(record: dict) -> None:
    try:
        with open(_marker_path(), "w") as f:
            json.dump(record, f)
    except OSError as e:
        logger.warning("[j2-attach-backup] marker write failed (non-fatal): %s", e)


def _read_marker():
    try:
        with open(_marker_path()) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _make_tarball(root: Path, dest: Path) -> int:
    """tar.gz the attachments tree; returns file count. Skips nothing —
    originals are <=5MB validated images, the tree IS the user data."""
    count = 0
    with tarfile.open(dest, "w:gz") as tar:
        for p in sorted(root.rglob("*")):
            if p.is_file():
                tar.add(p, arcname=str(p.relative_to(root)))
                count += 1
    return count


def _date_from_key(key: str):
    """j2_attachment_backups/j2-attachments-YYYY-MM-DD.tar.gz -> date, or None."""
    base = key.rsplit("/", 1)[-1]
    if not (base.startswith("j2-attachments-") and base.endswith(".tar.gz")):
        return None
    ds = base[len("j2-attachments-"):-len(".tar.gz")]
    try:
        return date.fromisoformat(ds)
    except ValueError:
        return None


def _prune_old_backups(client, bucket, retain_days=None, keep_min=_KEEP_MIN,
                       now_date=None) -> dict:
    """Delete backups older than retain_days, but ALWAYS keep the newest
    keep_min regardless of age. Best-effort — never raises. Returns
    {'deleted': [...keys], 'kept': [...keys]}."""
    if retain_days is None:
        retain_days = _retain_days()
    if not (client and bucket):
        return {"deleted": [], "kept": []}
    try:
        resp = client.list_objects_v2(Bucket=bucket, Prefix=_PREFIX)
    except Exception as e:
        logger.warning("[j2-attach-backup] prune list failed (non-fatal): %s", e)
        return {"deleted": [], "kept": []}

    objs = []
    for o in resp.get("Contents", []) or []:
        k = o.get("Key", "")
        d = _date_from_key(k)
        if d is not None:
            objs.append((d, k))
    objs.sort(key=lambda t: t[0], reverse=True)  # newest first

    today = now_date or _et_date()
    cutoff = today - timedelta(days=retain_days)
    deleted, kept = [], []
    for idx, (d, k) in enumerate(objs):
        if idx < keep_min or d >= cutoff:
            kept.append(k)
            continue
        try:
            client.delete_object(Bucket=bucket, Key=k)
            deleted.append(k)
        except Exception as e:
            logger.warning("[j2-attach-backup] delete %s failed (non-fatal): %s", k, e)
            kept.append(k)
    return {"deleted": deleted, "kept": kept}


# --- core: backup ------------------------------------------------------------

def backup_j2_attachments_to_r2() -> dict:
    """tar.gz the J2 attachments tree, upload to R2 key
    j2_attachment_backups/j2-attachments-<ET date>.tar.gz, then prune old keys.
    Returns {status, key, bytes, files, duration_sec}. NEVER raises — any failure
    returns {status:'error', error}. Disabled → {skipped:'disabled'}. Empty or
    missing tree → {skipped:'no attachments'} (no upload)."""
    if not _enabled():
        return {"skipped": "disabled"}
    t0 = time.time()
    tmpdir = None
    try:
        root = _attachment_root()
        if not root.exists():
            return {"skipped": "no attachments"}
        client = _r2_client()
        bucket = _bucket()
        if not (client and bucket):
            return {"status": "error",
                    "error": "R2 not configured (DATA_SYNC_* / bucket missing)"}

        tmpdir = tempfile.mkdtemp(prefix="j2_attach_backup_")
        gz = os.path.join(tmpdir, "j2-attachments.tar.gz")
        file_count = _make_tarball(root, Path(gz))
        if file_count == 0:
            return {"skipped": "no attachments"}

        gz_bytes = os.path.getsize(gz)
        day = _et_date()
        key = f"{_PREFIX}j2-attachments-{day.isoformat()}.tar.gz"
        client.upload_file(gz, bucket, key,
                           ExtraArgs={"ContentType": "application/gzip"})

        pruned = _prune_old_backups(client, bucket)
        if pruned["deleted"]:
            logger.info("[j2-attach-backup] pruned %d old backup(s)", len(pruned["deleted"]))

        duration = round(time.time() - t0, 2)
        record = {"status": "ok", "key": key, "bytes": gz_bytes,
                  "files": file_count, "duration_sec": duration,
                  "date": day.isoformat(), "at": int(time.time()),
                  "pruned": len(pruned["deleted"])}
        _write_marker(record)
        logger.info("[j2-attach-backup] uploaded %s (%d bytes, %d files) in %.2fs",
                    key, gz_bytes, file_count, duration)
        return {"status": "ok", "key": key, "bytes": gz_bytes,
                "files": file_count, "duration_sec": duration}
    except Exception as e:
        logger.exception("[j2-attach-backup] backup failed: %s", e)
        return {"status": "error", "error": str(e)[:300]}
    finally:
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)


# --- scheduler ---------------------------------------------------------------

def register_jobs(scheduler) -> bool:
    """Nightly 02:45 ET Mon-Sat backup (post-close, quiet, offset from
    flow_backup's 02:30). Gated by J2_ATTACHMENT_BACKUP_ENABLED. Returns True
    iff the job was registered."""
    if not _enabled():
        logger.info("[j2-attach-backup] disabled (J2_ATTACHMENT_BACKUP_ENABLED != 1)")
        return False
    from apscheduler.triggers.cron import CronTrigger
    scheduler.add_job(
        backup_j2_attachments_to_r2,
        CronTrigger(day_of_week="mon-sat", hour=2, minute=45),
        id="j2_attachments_backup", max_instances=1, replace_existing=True)
    logger.info("[j2-attach-backup] scheduled 02:45 ET Mon-Sat (retain=%dd)", _retain_days())
    return True
