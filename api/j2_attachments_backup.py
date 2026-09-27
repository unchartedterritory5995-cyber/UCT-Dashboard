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
# ⛔ Wave 10 (lane 10C, F-7): every tarball carries a MANIFEST of what it holds --
# each file's relative path, size and sha256 -- as its LAST member, so a restore
# drill can sample files and prove they come back byte-identical
# (tools/authdb_restore_drill.py). Top-level and dot-named: a user directory is a
# member id, so this can never collide with one. Inside the tarball rather than a
# sidecar object so it is pruned WITH the tarball (a manifest names member ids).
MANIFEST_NAME = ".uct-attachments-manifest.json"


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
    """The tree to back up — the ONE authority every attachment writer uses
    (api/services/journal_two/attachment_root.py), so this can never tar a
    different directory than the one being written to.

    ⛔ It could before: the shared default was repo-relative, i.e. ephemeral
    container storage on Railway, so this backup dutifully archived a tree that
    every redeploy had just emptied."""
    from api.services.journal_two.attachment_root import attachment_root
    return attachment_root()


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
    originals are <=5MB validated images, the tree IS the user data.

    ⛔ Wave 10 (F-7): each file is read ONCE and the same bytes are both archived
    and hashed, so the manifest describes exactly what the tarball holds (a file
    that changed between a hash and a separate `tar.add` would be described wrong).
    The manifest is the last member; the returned count is user files only."""
    import hashlib
    import io

    count = 0
    files = []
    with tarfile.open(dest, "w:gz") as tar:
        for p in sorted(root.rglob("*")):
            if p.is_file():
                data = p.read_bytes()
                arcname = str(p.relative_to(root))
                info = tar.gettarinfo(str(p), arcname=arcname)
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
                files.append({"path": arcname.replace("\\", "/"), "bytes": len(data),
                              "sha256": hashlib.sha256(data).hexdigest()})
                count += 1
        manifest = json.dumps({"v": 1, "count": count, "files": files}).encode("utf-8")
        minfo = tarfile.TarInfo(MANIFEST_NAME)
        minfo.size = len(manifest)
        minfo.mtime = int(time.time())
        tar.addfile(minfo, io.BytesIO(manifest))
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

#: The ONE statement of when the backup runs. register_jobs builds its trigger from it, and
#: the restore drill derives its freshness limit from it (longest_gap_hours) -- so a changed
#: schedule moves the drill's limit with it instead of leaving a stale number behind.
SCHEDULE = {"day_of_week": "mon-sat", "hour": 2, "minute": 45}
SCHEDULE_TZ = "America/New_York"


def _trigger():
    from apscheduler.triggers.cron import CronTrigger
    from zoneinfo import ZoneInfo
    return CronTrigger(**SCHEDULE, timezone=ZoneInfo(SCHEDULE_TZ))


def longest_gap_hours() -> float:
    """The longest interval between two consecutive scheduled runs, in hours (Mon-Sat:
    Saturday 02:45 -> Monday 02:45 = 48). Walked over two weeks of the real trigger's fire
    times, so a schedule change is measured, never retyped."""
    import datetime as _dt
    from zoneinfo import ZoneInfo
    trig = _trigger()
    t = _dt.datetime(2026, 1, 5, tzinfo=ZoneInfo(SCHEDULE_TZ))   # any fixed Monday
    prev, times = None, []
    for _ in range(20):
        t = trig.get_next_fire_time(prev, t)
        times.append(t)
        prev = t
        t = t + _dt.timedelta(seconds=1)
    return max((b - a).total_seconds() for a, b in zip(times, times[1:])) / 3600.0


def register_jobs(scheduler) -> bool:
    """Nightly 02:45 ET Mon-Sat backup (post-close, quiet, offset from
    flow_backup's 02:30) -- SCHEDULE above. Gated by J2_ATTACHMENT_BACKUP_ENABLED.
    Returns True iff the job was registered."""
    if not _enabled():
        logger.info("[j2-attach-backup] disabled (J2_ATTACHMENT_BACKUP_ENABLED != 1)")
        return False
    scheduler.add_job(
        backup_j2_attachments_to_r2,
        _trigger(),
        id="j2_attachments_backup", max_instances=1, replace_existing=True)
    logger.info("[j2-attach-backup] scheduled 02:45 ET Mon-Sat (retain=%dd)", _retain_days())
    return True
