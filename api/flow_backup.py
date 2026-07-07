"""
flow_backup.py — offsite backup + boot integrity checking for flow.db
(the options-flow database; ~792 MB, ~835K rows).

WHY: flow.db lives ONLY on the web service's Railway volume. A volume
corruption or loss has NO recovery path — the live Massive OPRA feed does
NOT replay, and the T+1 flat file only refills gaps, not a wiped DB. This
module ships a consistent, gzipped, dated snapshot to R2 nightly and screams
(Discord) if the DB is corrupt at boot.

Design mirrors the two existing rails in this repo:
- R2 client construction reuses the bars snapshot rail's DATA_SYNC_* env
  creds (api/services/data_sync.py), but pins region us-east-1 and the R2
  checksum config knobs (request_checksum_calculation / response_checksum_
  validation = 'when_required') — modern boto3 emits CRC integrity checksums
  by default that Cloudflare R2 rejects unless these are relaxed.
- The consistent snapshot uses SQLite's online .backup() single-pass, exactly
  like api/flow_gap_autofill._backup_db — a WAL-safe point-in-time copy that
  never blocks the live writer.
- The router / PUSH_SECRET auth / thread-spawned POST idiom mirrors
  api/flow_gap_autofill's router.

Everything ships DARK: gated by FLOW_BACKUP_ENABLED (default 0). The boot
integrity check runs regardless of the flag (it's a cheap read-only probe and
a corrupt DB is worth knowing about even before backups are turned on).

Env:
  FLOW_BACKUP_ENABLED        master switch for the nightly job + backup fn (default 0)
  FLOW_BACKUP_RETAIN_DAYS    prune backups older than this (default 14; newest >=3 always kept)
  FLOW_DB_PATH               source DB (default /data/flow.db)
  DATA_SYNC_ENDPOINT_URL / _ACCESS_KEY / _SECRET_KEY / _BUCKET / _REGION   R2 creds (reused)
  DISCORD_WEBHOOK_URL        integrity-failure alert channel
  PUSH_SECRET                bearer for POST /api/flow-backup/run
"""
import gzip
import json
import logging
import os
import shutil
import sqlite3
import tempfile
import threading
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")

ENABLED = os.environ.get("FLOW_BACKUP_ENABLED", "0").lower() in ("1", "true", "yes")
RETAIN_DAYS = int(os.environ.get("FLOW_BACKUP_RETAIN_DAYS", "14"))
DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")

_PREFIX = "flow_backups/"           # R2 key prefix
_KEEP_MIN = 3                        # never prune the newest N, regardless of age
_CHECK_TIMEOUT = 30                  # seconds for the read-only integrity connect
_MARKER_NAME = ".flow_backup_last.json"

router = APIRouter(prefix="/api/flow-backup", tags=["flow-backup"])


# --- R2 client (reuses the bars-rail DATA_SYNC_* creds) ----------------------

def _r2_client():
    """Lazy-construct the boto3 S3 client for R2. Returns None if creds missing.

    Region + checksum config are the R2-specific bits: modern boto3 defaults
    to sending CRC32 integrity checksums that R2 rejects, so we relax them to
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
        # The two checksum knobs land in botocore ~1.36; guard so an older
        # pin doesn't blow up client construction.
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
    return os.path.join(os.path.dirname(DB_PATH) or "/data", _MARKER_NAME)


def _write_marker(record: dict) -> None:
    try:
        with open(_marker_path(), "w") as f:
            json.dump(record, f)
    except OSError as e:
        logger.warning("[flow-backup] marker write failed (non-fatal): %s", e)


def _read_marker():
    try:
        with open(_marker_path()) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _post_discord(content: str) -> bool:
    """Best-effort Discord alert. Returns True iff the POST was attempted+ok."""
    webhook = (os.environ.get("DISCORD_WEBHOOK_URL") or "").strip()
    if not webhook:
        return False
    try:
        import urllib.request
        data = json.dumps({"content": content[:1900]}).encode()
        req = urllib.request.Request(
            webhook, data=data,
            headers={"Content-Type": "application/json",
                     "User-Agent": "uct-flow-backup/1"})
        with urllib.request.urlopen(req, timeout=10) as r:
            r.read(64)
        return True
    except Exception as e:
        logger.warning("[flow-backup] Discord post failed: %s", e)
        return False


def _check_db(path: str):
    """Read-only integrity probe. Returns (ok: bool, detail: str).

    quick_check runs FIRST (the fast gate — skips index-vs-table cross checks),
    then a bounded integrity_check(1) confirms. A DB that won't even open, or a
    pragma that returns anything but the literal 'ok', is a failure. Never
    raises — every sqlite error is folded into (False, detail)."""
    if not os.path.exists(path):
        return True, "flow.db not present (nothing to check)"
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=_CHECK_TIMEOUT)
    except sqlite3.DatabaseError as e:
        return False, f"cannot open read-only: {e}"
    try:
        try:
            row = conn.execute("PRAGMA quick_check").fetchone()
        except sqlite3.DatabaseError as e:
            return False, f"quick_check raised: {e}"
        if not (row and row[0] == "ok"):
            return False, f"quick_check != ok (got {row!r})"
        try:
            row = conn.execute("PRAGMA integrity_check(1)").fetchone()
        except sqlite3.DatabaseError as e:
            return False, f"integrity_check raised: {e}"
        if not (row and row[0] == "ok"):
            return False, f"integrity_check != ok (got {row!r})"
        return True, "ok"
    finally:
        conn.close()


def _sqlite_backup(src_path: str, dst_path: str) -> None:
    """SQLite online .backup() single-pass copy — WAL-consistent point-in-time
    snapshot that never blocks the live writer (same pattern as
    flow_gap_autofill._backup_db + data_sync._backup_sqlite_db)."""
    src = sqlite3.connect(src_path, timeout=30)
    try:
        dst = sqlite3.connect(dst_path)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()


def _date_from_key(key: str):
    """flow_backups/flow-YYYY-MM-DD.db.gz -> date, or None if it doesn't match."""
    base = key.rsplit("/", 1)[-1]
    if not (base.startswith("flow-") and base.endswith(".db.gz")):
        return None
    ds = base[len("flow-"):-len(".db.gz")]
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
        retain_days = RETAIN_DAYS
    if not (client and bucket):
        return {"deleted": [], "kept": []}
    try:
        resp = client.list_objects_v2(Bucket=bucket, Prefix=_PREFIX)
    except Exception as e:
        logger.warning("[flow-backup] prune list failed (non-fatal): %s", e)
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
            logger.warning("[flow-backup] delete %s failed (non-fatal): %s", k, e)
            kept.append(k)
    return {"deleted": deleted, "kept": kept}


# --- core: backup ------------------------------------------------------------

def backup_flow_db_to_r2() -> dict:
    """Snapshot flow.db, gzip it, upload to R2 key flow_backups/flow-<ET date>.db.gz,
    then prune old keys. Returns {status, key, bytes, duration_sec}. NEVER raises —
    any failure returns {status:'error', error}. Disabled → {status:'disabled'}."""
    if not ENABLED:
        return {"status": "disabled"}
    t0 = time.time()
    tmpdir = None
    try:
        if not os.path.exists(DB_PATH):
            return {"status": "error", "error": f"flow.db not found at {DB_PATH}"}
        client = _r2_client()
        bucket = _bucket()
        if not (client and bucket):
            return {"status": "error", "error": "R2 not configured (DATA_SYNC_* / bucket missing)"}

        tmpdir = tempfile.mkdtemp(prefix="flow_backup_")
        raw = os.path.join(tmpdir, "flow.db")
        _sqlite_backup(DB_PATH, raw)

        # Gate BEFORE shipping — never upload a corrupt snapshot as the fleet's
        # recovery copy (mirrors data_sync's pre-ship integrity gate).
        ok, detail = _check_db(raw)
        if not ok:
            return {"status": "error", "error": f"backup integrity gate failed: {detail}"}

        gz = os.path.join(tmpdir, "flow.db.gz")
        with open(raw, "rb") as fin, gzip.open(gz, "wb", compresslevel=6) as fout:
            shutil.copyfileobj(fin, fout, length=1024 * 1024)
        # Drop the uncompressed copy so peak disk = just the gzip artifact.
        try:
            os.remove(raw)
        except OSError:
            pass

        gz_bytes = os.path.getsize(gz)
        day = _et_date()
        key = f"{_PREFIX}flow-{day.isoformat()}.db.gz"
        client.upload_file(gz, bucket, key,
                           ExtraArgs={"ContentType": "application/gzip"})

        pruned = _prune_old_backups(client, bucket)
        if pruned["deleted"]:
            logger.info("[flow-backup] pruned %d old backup(s)", len(pruned["deleted"]))

        duration = round(time.time() - t0, 2)
        record = {"status": "ok", "key": key, "bytes": gz_bytes,
                  "duration_sec": duration, "date": day.isoformat(),
                  "at": int(time.time()), "pruned": len(pruned["deleted"])}
        _write_marker(record)
        logger.info("[flow-backup] uploaded %s (%d bytes) in %.2fs", key, gz_bytes, duration)
        return {"status": "ok", "key": key, "bytes": gz_bytes, "duration_sec": duration}
    except Exception as e:
        logger.exception("[flow-backup] backup failed: %s", e)
        return {"status": "error", "error": str(e)[:300]}
    finally:
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)


# --- core: boot integrity check ----------------------------------------------

def startup_integrity_check() -> dict:
    """Read-only integrity probe of flow.db at boot. On failure, posts a Discord
    alert and returns {ok:False, detail, alerted}. On success {ok:True, detail}.
    Never raises — an unexpected error fails OPEN (ok:True) so a broken probe
    can't page or block boot; only a genuine DB fault fires the alert."""
    try:
        ok, detail = _check_db(DB_PATH)
    except Exception as e:
        logger.warning("[flow-backup] integrity check errored (non-fatal): %s", e)
        return {"ok": True, "detail": f"check skipped: {e}"}
    if ok:
        logger.info("[flow-backup] flow.db integrity OK (%s)", detail)
        return {"ok": True, "detail": detail}
    msg = (f"\U0001F534 FLOW DB INTEGRITY FAILED at boot: {detail} "
           f"(flow.db={DB_PATH}) — options-flow data may be corrupt; "
           f"restore from R2 flow_backups/ if reads fail")
    logger.error("[flow-backup] %s", msg)
    alerted = _post_discord(msg)
    return {"ok": False, "detail": detail, "alerted": alerted}


# --- scheduler ---------------------------------------------------------------

def register_jobs(scheduler) -> bool:
    """Nightly 02:30 ET Mon-Sat backup (post-close, quiet). Gated by
    FLOW_BACKUP_ENABLED. Returns True iff the job was registered."""
    if not ENABLED:
        logger.info("[flow-backup] disabled (FLOW_BACKUP_ENABLED != 1)")
        return False
    from apscheduler.triggers.cron import CronTrigger
    scheduler.add_job(
        backup_flow_db_to_r2,
        CronTrigger(day_of_week="mon-sat", hour=2, minute=30),
        id="flow_db_backup", max_instances=1, replace_existing=True)
    logger.info("[flow-backup] scheduled nightly 02:30 ET Mon-Sat (retain=%dd)", RETAIN_DAYS)
    return True


# --- router ------------------------------------------------------------------

def _require_push_secret(authorization: str):
    secret = (os.environ.get("PUSH_SECRET") or "").strip()
    if not secret or authorization != f"Bearer {secret}":
        raise HTTPException(status_code=403, detail="forbidden")


@router.get("/status")
def status():
    return JSONResponse({
        "enabled": ENABLED,
        "retain_days": RETAIN_DAYS,
        "db_path": DB_PATH,
        "r2_configured": _r2_configured(),
        "last_backup": _read_marker(),
    })


@router.post("/run")
def trigger_run(authorization: str = Header(default="")):
    """Manual trigger. NEVER inline — spawns a daemon thread and returns
    immediately (a full backup can take many seconds on the ~800 MB DB)."""
    _require_push_secret(authorization)
    threading.Thread(target=backup_flow_db_to_r2, daemon=True,
                     name="flow-backup-manual").start()
    return JSONResponse({"status": "started", "check": "/api/flow-backup/status"})
