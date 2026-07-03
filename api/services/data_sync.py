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
import json
import os
import shutil
import sqlite3
import tarfile
import tempfile
import time
import logging
import datetime as _dt
from zoneinfo import ZoneInfo as _ZoneInfo
from typing import Optional

logger = logging.getLogger(__name__)

_ET = _ZoneInfo("America/New_York")


def in_active_data_window(now: Optional[_dt.datetime] = None) -> bool:
    """True during the window when market data meaningfully changes:
    weekdays 4:00 AM - 8:00 PM ET (pre-market open through post-market close).

    Outside this window (overnight + weekends) historical/intraday bars are
    static, so snapshot uploads and prewarm refreshes are wasted work. Shared
    by the snapshot cadence, the prewarmer refresh loop, and the keep-warm
    pinger so all three throttle on the same schedule. Holidays are not
    special-cased — a holiday inside the window just means a few cheap no-op
    cycles (skip-if-unchanged + per-entry freshness gates absorb them)."""
    et = now or _dt.datetime.now(_ET)
    if et.weekday() >= 5:  # Sat/Sun
        return False
    return 4 <= et.hour < 20

_DATA_DIR = os.environ.get("DATA_DIR", "/data")
_LATEST_KEY = "latest.txt"
_SNAPSHOT_PREFIX = "snapshots/"

# How often the worker uploads and the web pulls. Env-driven (default 20 min).
# The snapshot only carries HISTORICAL/backfill bars — live (today's) bars never
# go through it (the web pod gets those from direct API fetches + the Massive WS
# stream). So this cadence only bounds how stale the web pod's backfilled history
# can be, which users don't perceive. A faster cadence just multiplies egress:
# the full ~688 MB tarball ships on every cycle during market hours because the
# prewarmer is continuously writing bars.db, so the skip-if-unchanged fingerprint
# (below) almost always trips intraday — it only saves work overnight/weekends.
# 300s × ~16h active window ≈ ~130 GB/day egress; 1200s drops that ~4x.
SNAPSHOT_INTERVAL_SECONDS = int(os.environ.get("SNAPSHOT_INTERVAL_SECONDS", "1200"))
# Slow cadence outside the active data window (overnight/weekends). Bars are
# static then, so combined with skip-if-unchanged the worker stops shipping
# the (large) tarball every 5 min around the clock. Override via env.
SNAPSHOT_INTERVAL_IDLE_SECONDS = int(os.environ.get("SNAPSHOT_INTERVAL_IDLE_SECONDS", "1800"))
# Force a fresh upload at least this often even when the fingerprint looks
# unchanged — cheap insurance against a fingerprint edge case leaving the web
# pod indefinitely stale. 0 disables the force.
SNAPSHOT_FORCE_UPLOAD_SECONDS = int(os.environ.get("SNAPSHOT_FORCE_UPLOAD_SECONDS", "3600"))
# How many recent snapshots to retain in the bucket; older ones are pruned
# after each successful upload. The web always pulls `latest`, so the newest
# is never at risk; keeping a few covers any in-flight pull.
SNAPSHOT_KEEP = int(os.environ.get("SNAPSHOT_KEEP", "5"))

# Sentinel returned by upload_snapshot() when the source data is unchanged
# since the last upload and the force interval hasn't elapsed — distinct from
# None (failure / nothing to snapshot) so callers can report it honestly.
SNAPSHOT_UNCHANGED = "unchanged"

# Last-uploaded fingerprint + timestamp (process-local; the worker is long
# lived so this persists for the life of the pod).
_last_uploaded_fingerprint: Optional[tuple] = None
_last_uploaded_at: float = 0.0


def snapshot_interval_seconds() -> int:
    """Adaptive upload cadence — fast inside the active data window, slow
    outside it. Combined with skip-if-unchanged this makes overnight/weekend
    uploads near-zero."""
    return SNAPSHOT_INTERVAL_SECONDS if in_active_data_window() else SNAPSHOT_INTERVAL_IDLE_SECONDS


# ── Incremental (base + delta) snapshot ────────────────────────────────────
# Gated by SNAPSHOT_DELTA_ENABLED=1 on BOTH services. When on, the worker ships
# one full "base" snapshot per day (cold-start seed + drift backstop) and a tiny
# windowed "delta" every other cycle; the web applies base then deltas in ts
# order via the SAME newer-wins merge. Bars only mutate for the most recent few
# sessions, so a rolling per-tf window captures every real change; the daily
# base catches anything older. Decouples worker egress/CPU from total DB size.
DELTA_ENABLED = os.environ.get("SNAPSHOT_DELTA_ENABLED", "0") == "1"
_DELTA_PREFIX = "deltas/"
_DELTA_INDEX_KEY = "deltas/latest.txt"
_LAST_DELTA_MARKER = ".last_delta_ts"
DELTA_KEEP = int(os.environ.get("DELTA_KEEP", "50"))
_DAY_SECONDS = 86400
# Windows are deliberately wide — egress stays tiny (bounded by recency, not
# universe size) and the daily base means they're never load-bearing for
# correctness. Override via env if a tf ever revises further back.
DELTA_WINDOW_INTRADAY_DAYS = int(os.environ.get("DELTA_WINDOW_INTRADAY_DAYS", "7"))
DELTA_WINDOW_DAILY_DAYS = int(os.environ.get("DELTA_WINDOW_DAILY_DAYS", "10"))
DELTA_WINDOW_SLOW_DAYS = int(os.environ.get("DELTA_WINDOW_SLOW_DAYS", "45"))


def _delta_cutoffs(now: Optional[int] = None) -> dict:
    """Per-tf unix-seconds cutoff: rows with ts >= cutoff go in the delta."""
    now = int(now if now is not None else time.time())
    intraday = now - DELTA_WINDOW_INTRADAY_DAYS * _DAY_SECONDS
    return {
        "1": intraday, "5": intraday, "15": intraday, "30": intraday, "60": intraday,
        "D": now - DELTA_WINDOW_DAILY_DAYS * _DAY_SECONDS,
        "W": now - DELTA_WINDOW_SLOW_DAYS * _DAY_SECONDS,
        "M": now - DELTA_WINDOW_SLOW_DAYS * _DAY_SECONDS,
    }


def _snapshot_fingerprint() -> tuple:
    """Cheap fingerprint of the snapshot source WITHOUT building the tarball.

    Stats bars.db + its WAL/SHM sidecars (every write bumps -wal mtime/size,
    every checkpoint bumps bars.db) plus the bars_cache dir mtime (atomic
    write-then-rename bumps it). If this is identical to the last upload's
    fingerprint, nothing changed and we can skip the expensive tar+gzip+PUT."""
    parts = []
    for fn in ("bars.db", "bars.db-wal", "bars.db-shm"):
        p = os.path.join(_DATA_DIR, fn)
        try:
            st = os.stat(p)
            parts.append((fn, int(st.st_mtime), st.st_size))
        except OSError:
            parts.append((fn, 0, 0))
    try:
        parts.append(("bars_cache", int(os.stat(os.path.join(_DATA_DIR, "bars_cache")).st_mtime)))
    except OSError:
        parts.append(("bars_cache", 0))
    return tuple(parts)

# Track when the last upload attempt succeeded so the worker's health
# endpoint can report it. Written by upload_snapshot, read by callers.
_LAST_UPLOAD_MARKER = ".last_upload_ts"
# Track when the last successful download landed locally. Written by
# download_snapshot, read by the web's /api/health/cache endpoint.
_LAST_SYNC_MARKER = ".last_sync_ts"
# Track which ET calendar day the last FULL base snapshot shipped (delta
# mode). Persisted on the worker volume so a restart/redeploy doesn't
# re-build + re-upload the multi-GB base — on busy deploy nights that was
# one 2.4 GB upload per push (worker_main resets its in-process copy each
# boot). The once-per-ET-day cadence (cold-start seed + drift backstop)
# is unchanged; only the per-restart repeats go away.
_LAST_BASE_DAY_MARKER = ".last_base_day"


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


def _verify_snapshot_db(path: str) -> bool:
    """Run ``PRAGMA integrity_check`` on a freshly extracted bars.db.

    Used by ``download_snapshot`` to refuse installing a malformed snapshot
    over a possibly-good local copy. Without this guard, a recovery cycle
    triggered by local corruption could happily replace it with an equally
    corrupt R2 copy and bake the problem in.

    Returns True only if integrity_check returns the literal "ok".
    """
    try:
        c = sqlite3.connect(path, timeout=10)
        try:
            row = c.execute("PRAGMA integrity_check").fetchone()
            return bool(row and row[0] == "ok")
        finally:
            c.close()
    except sqlite3.DatabaseError as e:
        logger.error(f"[data_sync] integrity_check on extracted bars.db failed to open: {e}")
        return False


class SnapshotIntegrityError(Exception):
    """A snapshot DB failed its pre-ship integrity/row-count gate — refuse to
    upload it. Callers skip the upload and retry next cycle (by which time the
    prewarmer has usually healed the source)."""


# Minimum ohlcv row count a FULL snapshot must contain to be shippable. Catches
# the empty-schema DB that force_resync creates when no R2 snapshot installs
# (2026-07-03: an emptied recovery DB must NEVER become the fleet's snapshot of
# truth via a replace-pull). A healthy worker holds millions of rows; a floor of
# 1000 cleanly separates real data from an empty/near-empty recovery DB with
# ~zero false-reject risk. Env-tunable for edge cases.
SNAPSHOT_MIN_OHLCV_ROWS = int(os.environ.get("SNAPSHOT_MIN_OHLCV_ROWS", "1000"))


def _assert_shippable_db(path: str, min_ohlcv_rows: int, label: str) -> int:
    """Gate a just-built snapshot/delta DB before it is tarred + PUT to R2.

    THE fix for the 2026-07-03 outage: the DOWNLOAD side verifies integrity at
    three points, but the UPLOAD side verified nothing — so a corrupt (or empty
    recovery) worker DB shipped to R2 and, on the web pods' next pull, deleted
    the local DB and installed nothing, 503-ing every chart until reboot. This
    makes 'latest' good by construction.

    Runs PRAGMA integrity_check (must be the literal 'ok') and asserts the ohlcv
    table holds at least ``min_ohlcv_rows``. Raises SnapshotIntegrityError on
    either failure. Returns the ohlcv row count on success (for logging).
    """
    try:
        c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    except sqlite3.DatabaseError as e:
        raise SnapshotIntegrityError(f"{label}: cannot open for integrity check: {e}") from e
    try:
        try:
            row = c.execute("PRAGMA integrity_check").fetchone()
        except sqlite3.DatabaseError as e:
            raise SnapshotIntegrityError(f"{label}: integrity_check raised: {e}") from e
        if not (row and row[0] == "ok"):
            raise SnapshotIntegrityError(f"{label}: integrity_check != 'ok' (got {row!r})")
        try:
            cnt_row = c.execute("SELECT COUNT(*) FROM ohlcv").fetchone()
            n = int(cnt_row[0]) if cnt_row else 0
        except sqlite3.DatabaseError as e:
            raise SnapshotIntegrityError(f"{label}: ohlcv table unreadable: {e}") from e
        if n < min_ohlcv_rows:
            raise SnapshotIntegrityError(
                f"{label}: ohlcv row count {n} below floor {min_ohlcv_rows} "
                f"(refusing to ship an empty/truncated DB)"
            )
        return n
    finally:
        c.close()


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


def _make_tarball() -> str:
    """Tar a consistent snapshot of /data/bars.db + /data/bars_cache/.

    Returns the path to a .tar.gz inside a fresh temp dir — the CALLER must
    rmtree the parent dir when done. Built on disk, NOT in RAM: the base
    snapshot is ~2.35 GB compressed (2026-06-10), and the previous
    BytesIO + getvalue() approach held two full copies in memory per build.
    The worker crash-looped on exactly that — repeated base builds drove
    RSS past the pod ceiling and a native alloc failure segfaulted the
    process at the tail of the boot prewarm (see worker SIGSEGV incident).

    Raises FileNotFoundError if neither source path exists
    (don't ship empty snapshots — they'd overwrite a good one with nothing).

    bars.db is copied via SQLite's online backup API into a temp file before
    tarring to avoid torn pages while the prewarmer is writing. bars_cache/
    is JSON files that the disk_cache layer writes atomically (write-then-
    rename), so taring the live directory is safe."""
    db_path = os.path.join(_DATA_DIR, "bars.db")
    cache_path = os.path.join(_DATA_DIR, "bars_cache")
    has_db = os.path.exists(db_path)
    # The web pod's DEFAULT sync path (sync_if_newer_merge -> merge_snapshot)
    # only reads bars.db out of the snapshot — bars_cache/ is never touched
    # there. It's consumed ONLY by the cold-start / legacy replace-pull install
    # (download_snapshot). So by default we EXCLUDE the (large) JSON cache dir:
    # shipping it is dead weight on every upload — extra egress, extra tar+gzip
    # CPU, and a bigger in-memory tarball buffer — for bytes the web side
    # discards. The web rebuilds its own disk cache on demand from bars.db/API,
    # so steady-state chart quality is unchanged; only a freshly-deployed web
    # pod's first few opens are marginally cooler until its cache refills.
    # Set SNAPSHOT_INCLUDE_CACHE=1 to restore the old behavior (only needed if
    # you run the legacy replace-pull path and want a warm web disk cache).
    include_cache = os.environ.get("SNAPSHOT_INCLUDE_CACHE", "0") == "1"
    has_cache = include_cache and os.path.isdir(cache_path)
    if not (has_db or has_cache):
        raise FileNotFoundError(f"nothing to snapshot at {_DATA_DIR}")

    tmpdir = tempfile.mkdtemp(prefix="data_sync_snap_")
    try:
        snap_db_path: Optional[str] = None
        if has_db:
            snap_db_path = os.path.join(tmpdir, "bars.db")
            _backup_sqlite_db(db_path, snap_db_path)
            # Gate BEFORE tarring: a malformed or empty DB must never become the
            # fleet's snapshot of truth (2026-07-03 outage). Raises
            # SnapshotIntegrityError, which upload_snapshot catches → skip + retry.
            n = _assert_shippable_db(snap_db_path, SNAPSHOT_MIN_OHLCV_ROWS, "full snapshot")
            logger.info(f"[data_sync] snapshot integrity gate passed ({n} ohlcv rows)")

        tar_path = os.path.join(tmpdir, "snapshot.tar.gz")
        with tarfile.open(tar_path, mode="w:gz") as tar:
            if snap_db_path is not None:
                tar.add(snap_db_path, arcname="bars.db")
            if has_cache:
                tar.add(cache_path, arcname="bars_cache")
        # The tarball now contains the db copy — drop it so the disk
        # high-water mark during upload is just the compressed artifact,
        # not compressed + uncompressed side by side.
        if snap_db_path is not None:
            os.remove(snap_db_path)
        return tar_path
    except BaseException:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise


# Module-level guard so we don't spam logs every 5 min when the worker
# boots before the prewarmer has produced anything to snapshot. Logged
# once per process; cleared after the first successful upload so a
# transient empty state later still gets reported.
_empty_snapshot_logged = False


def _prune_old_snapshots(keep: int = SNAPSHOT_KEEP) -> int:
    """Delete all but the newest `keep` snapshots from the bucket.

    Snapshots accumulate forever otherwise (one new <ts>.tar.gz per upload).
    The web always pulls `latest`, which is the newest key, so it's never a
    prune target — keeping a few extra covers any in-flight download."""
    client = _client()
    bucket = _bucket()
    if not (client and bucket):
        return 0
    try:
        resp = client.list_objects_v2(Bucket=bucket, Prefix=_SNAPSHOT_PREFIX)
        objs = resp.get("Contents", []) or []

        def _ts_of(o):
            try:
                return int(o["Key"].rsplit("/", 1)[-1].split(".")[0])
            except (ValueError, IndexError):
                return 0

        objs.sort(key=_ts_of, reverse=True)  # newest first
        deleted = 0
        for o in objs[keep:]:
            try:
                client.delete_object(Bucket=bucket, Key=o["Key"])
                deleted += 1
            except Exception:
                pass
        return deleted
    except Exception as e:
        logger.warning(f"[data_sync] prune failed (non-fatal): {e}")
        return 0


def upload_snapshot(force: bool = False) -> Optional[str]:
    """Upload a fresh snapshot.

    Returns the snapshot timestamp on a real upload, SNAPSHOT_UNCHANGED when
    the source data is unchanged since the last upload (and the force interval
    hasn't elapsed), or None on failure / nothing to snapshot.

    The skip-if-unchanged check is the big efficiency win: the 688 MB tarball
    was previously built + gzipped + PUT every 5 min around the clock even
    when nothing had changed (overnight, weekends). Now we stat a handful of
    files first and bail before doing any of that expensive work."""
    global _empty_snapshot_logged, _last_uploaded_fingerprint, _last_uploaded_at
    client = _client()
    bucket = _bucket()
    if not (client and bucket):
        logger.warning("[data_sync] credentials/bucket missing; skipping upload")
        return None

    # Skip-if-unchanged: cheap stat-based fingerprint, no tarball built.
    fp = _snapshot_fingerprint()
    now = time.time()
    stale_force = (
        SNAPSHOT_FORCE_UPLOAD_SECONDS > 0
        and (now - _last_uploaded_at) >= SNAPSHOT_FORCE_UPLOAD_SECONDS
    )
    if (not force and not stale_force
            and _last_uploaded_fingerprint is not None
            and fp == _last_uploaded_fingerprint):
        return SNAPSHOT_UNCHANGED

    try:
        tar_path = _make_tarball()
    except FileNotFoundError as e:
        if not _empty_snapshot_logged:
            logger.warning(f"[data_sync] skip upload (will retry silently): {e}")
            _empty_snapshot_logged = True
        return None
    except SnapshotIntegrityError as e:
        # Corrupt/empty source DB — do NOT ship it (the 2026-07-03 poison class).
        # Loud (not the once-per-process empty guard): a failing integrity gate
        # is an operational signal, and the next cycle retries after prewarm heals.
        logger.error(f"[data_sync] snapshot REFUSED by integrity gate — not uploading: {e}")
        return None
    ts = str(int(time.time()))
    key = f"{_SNAPSHOT_PREFIX}{ts}.tar.gz"
    try:
        tar_bytes = os.path.getsize(tar_path)
        # upload_file streams multipart chunks from disk — constant memory
        # regardless of snapshot size (vs put_object(Body=bytes), which held
        # the full multi-GB tarball in RAM for the whole upload).
        client.upload_file(tar_path, bucket, key,
                           ExtraArgs={"ContentType": "application/gzip"})
        client.put_object(Bucket=bucket, Key=_LATEST_KEY, Body=ts.encode(),
                          ContentType="text/plain")
        logger.info(f"[data_sync] uploaded snapshot {ts} ({tar_bytes} bytes)")
        # Track most recent successful upload so the worker's health
        # endpoint can report it (the worker never downloads, so
        # .last_sync_ts is always empty there).
        _write_marker(_LAST_UPLOAD_MARKER, ts)
        # Record the fingerprint so the next cycle can skip if unchanged.
        _last_uploaded_fingerprint = fp
        _last_uploaded_at = now
        # Clear the noisy-log guard so a future empty state still logs.
        _empty_snapshot_logged = False
        # Bound bucket growth — best-effort, never fails the upload.
        pruned = _prune_old_snapshots()
        if pruned:
            logger.info(f"[data_sync] pruned {pruned} old snapshot(s)")
        return ts
    except Exception as e:
        logger.exception(f"[data_sync] upload failed: {e}")
        return None
    finally:
        shutil.rmtree(os.path.dirname(tar_path), ignore_errors=True)


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
            # Refuse to install a snapshot whose bars.db is itself corrupt.
            # Without this guard, a corruption-recovery loop on the web
            # service would happily replace its malformed local file with
            # an equally malformed R2 copy and bake the failure in.
            if not _verify_snapshot_db(src_db):
                logger.error(
                    f"[data_sync] snapshot {ts} bars.db failed integrity_check; "
                    f"refusing to install"
                )
                return False
            # Note: we do NOT remove the OLD bars.db-wal / -shm sidecars here
            # even though stale WAL+new-main can theoretically cause
            # "disk image is malformed" on next open. An earlier version of
            # this code DID remove them and caused a regression: writers
            # mid-transaction had their WAL deleted from under them, which
            # SQLite reported as "disk I/O error" on the next operation.
            # The malformed-image risk is handled by integrity_ok() at boot
            # plus the put_bars malformed handler that triggers force_resync.
            # That fail-safe path is much cheaper than corrupting writes
            # every 5 min during snapshot pulls.
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
            # A restored snapshot may predate the weekly Friday re-keying —
            # purge any Monday-keyed weekly rows it carried so the duplicate
            # candle bug can't be resurrected by a snapshot pull (the
            # 2026-07-02 incident: worker snapshot re-poisoned the healed web
            # DB while the one-shot heal's flag file blocked a re-heal).
            # Async: the purge's discovery pass scans the table (minutes on a
            # 58M-row DB) and this call sits on boot-pull paths; the serve-time
            # weekly guard covers the window until it lands.
            try:
                bars_sqlite.purge_mis_keyed_weekly_rows_async()
            except Exception as e:
                logger.warning(f"[data_sync] weekly key purge failed (non-fatal): {e}")
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


def get_last_base_day() -> Optional[str]:
    """ET date ('YYYY-MM-DD') of the last shipped base snapshot, or None.

    Read by the worker's uploader at boot so a restart doesn't re-ship
    the multi-GB base within the same ET day."""
    return _read_marker(_LAST_BASE_DAY_MARKER)["snapshot_ts"]


def set_last_base_day(day: str) -> None:
    """Persist the ET date of a successful base-snapshot upload."""
    _write_marker(_LAST_BASE_DAY_MARKER, day)


def get_local_sync_state() -> dict:
    """Return what the WEB knows about the last download from R2."""
    return _read_marker(_LAST_SYNC_MARKER)


def get_local_upload_state() -> dict:
    """Return what the WORKER knows about the last upload to R2.

    Same shape as get_local_sync_state; snapshot_ts is the timestamp of
    the most recent upload that succeeded."""
    return _read_marker(_LAST_UPLOAD_MARKER)


# ── P-2: cross-process hot-set bridge (web -> R2 -> worker) ───────────────────
# The hot-set (intraday tickers users actually open) is recorded in the
# WEB process, but the prewarmer runs in the WORKER process — they don't
# share memory. The web publishes the hot-set to a tiny R2 object; the
# worker prewarmer reads it each cycle and force-prioritises those
# tickers' intraday TFs so what users flip through is warm first.
_HOTSET_KEY = "hotset_intraday.json"


def put_hotset(tickers: list) -> bool:
    """Publish the web's recent-intraday hot-set to R2. Best-effort."""
    client = _client()
    bucket = _bucket()
    if not (client and bucket) or not tickers:
        return False
    try:
        body = json.dumps(
            sorted({str(t).upper() for t in tickers if t})[:1000]
        ).encode()
        client.put_object(Bucket=bucket, Key=_HOTSET_KEY, Body=body,
                          ContentType="application/json")
        return True
    except Exception as e:
        logger.warning(f"[data_sync] put_hotset failed (non-fatal): {e}")
        return False


def get_hotset() -> list:
    """Read the published hot-set (worker side). [] on any failure."""
    client = _client()
    bucket = _bucket()
    if not (client and bucket):
        return []
    try:
        resp = client.get_object(Bucket=bucket, Key=_HOTSET_KEY)
        data = json.loads(resp["Body"].read())
        if isinstance(data, list):
            return [str(t).upper() for t in data if t]
    except Exception:
        pass
    return []


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


def force_resync() -> bool:
    """Force a full snapshot re-pull from R2, bypassing the "already current"
    short-circuit that ``sync_if_newer`` uses.

    Used by the corruption-recovery path: when the local bars.db is
    malformed, the local sync marker still says "I have snapshot X" — and
    R2's latest is also X — so ``sync_if_newer`` would return None and
    leave the corrupt file in place. ``force_resync`` clears the marker
    AND removes the local bars.db (plus -wal/-shm sidecars) before pulling
    the latest snapshot, so even if R2's latest hasn't moved, we install
    a known-good copy on top of the broken one.

    Returns True iff a snapshot was successfully downloaded and installed."""
    # Clear the marker so any concurrent reader of get_local_sync_state
    # sees "no local snapshot" rather than a stale "I'm up to date".
    marker = os.path.join(_DATA_DIR, _LAST_SYNC_MARKER)
    try:
        if os.path.exists(marker):
            os.remove(marker)
    except OSError as e:
        logger.warning(f"[data_sync] force_resync: could not clear marker: {e}")
    # Remove the corrupt main file and any sidecars. If the subsequent
    # download fails or R2 has nothing, we end up with an empty data dir
    # and ``bars_sqlite.init_db`` will create a fresh empty DB — slow but
    # correct, much better than leaving the malformed file in place where
    # every put_bars would keep failing forever.
    db_path = os.path.join(_DATA_DIR, "bars.db")
    for suffix in ("", "-wal", "-shm"):
        p = db_path + suffix
        try:
            if os.path.exists(p):
                os.remove(p)
        except OSError as e:
            logger.warning(f"[data_sync] force_resync: could not remove {p}: {e}")
    # Try the latest snapshot first, then fall back to progressively older
    # ones. download_snapshot refuses a snapshot whose bars.db fails
    # integrity_check — on 2026-07-03 the NEWEST R2 snapshot was itself
    # malformed, so a latest-only pull deleted the local DB above and then
    # installed nothing, leaving every bars read at "no such table: ohlcv"
    # until the next reboot. Older snapshots are stale but valid — the
    # newer-wins delta/merge rail tops them up.
    candidates: list[str] = []
    ts = get_latest_snapshot_ts()
    if ts:
        candidates.append(ts)
    for older in _list_snapshot_ts_desc():
        if older not in candidates:
            candidates.append(older)
    installed = False
    for cand in candidates[:4]:
        if download_snapshot(cand):
            if cand != candidates[0]:
                logger.warning(
                    f"[data_sync] force_resync: newest snapshot unusable; "
                    f"installed older snapshot {cand}"
                )
            installed = True
            break
        logger.warning(f"[data_sync] force_resync: snapshot {cand} failed to install; trying older")
    if not installed:
        logger.error(
            "[data_sync] force_resync: no installable remote snapshot; "
            "recreating an empty schema so reads degrade to cache-miss "
            "refetch instead of 'no such table' until reboot"
        )
        # Guarantee a valid, schema'd bars.db. Without this, the removal
        # above left NO database and nothing re-ran init_db — every read
        # 503'd until the next process restart (2026-07-03 outage).
        try:
            from api.services import bars_sqlite
            bars_sqlite.bump_db_epoch()
            bars_sqlite.init_db()
        except Exception as e:
            logger.error(f"[data_sync] force_resync: init_db after failed pull errored: {e}")
    return installed


def _list_snapshot_ts_desc() -> list[str]:
    """Snapshot timestamps present in the bucket, newest first."""
    client = _client()
    bucket = _bucket()
    if not (client and bucket):
        return []
    try:
        resp = client.list_objects_v2(Bucket=bucket, Prefix=_SNAPSHOT_PREFIX)
        out: list[tuple[int, str]] = []
        for o in resp.get("Contents", []) or []:
            name = o["Key"].rsplit("/", 1)[-1].split(".")[0]
            try:
                out.append((int(name), name))
            except ValueError:
                continue
        out.sort(reverse=True)
        return [name for _, name in out]
    except Exception as e:
        logger.warning(f"[data_sync] snapshot listing failed: {e}")
        return []


# ── Newer-wins MERGE (Part 2, 2026-05-16) ─────────────────────────────────────
# The locked rule that replaces the two-mechanism conflict (worker→R2→web
# REPLACE vs web on-demand delta WRITE). A snapshot row is adopted ONLY
# when local has no rows for that (ticker,tf) yet (cold-ticker
# pre-population) OR the row is strictly newer than local's newest bar for
# that (ticker,tf) (forward freshness). INSERT OR IGNORE means an existing
# local row is NEVER overwritten. Net: the snapshot can only ADD freshness,
# never regress a fresher local write — the exact 2026-05-07 failure mode.

def _merge_ohlcv_from(src_db: str, local_db: Optional[str] = None) -> int:
    """Newer-wins merge of snapshot ohlcv into the local bars.db.

    Returns rows adopted (best-effort), or -1 if there is no local DB to
    merge into (caller should fall back to a plain install)."""
    if local_db is None:
        local_db = os.path.join(_DATA_DIR, "bars.db")
    if not os.path.exists(local_db):
        return -1
    conn = sqlite3.connect(local_db, timeout=30)
    try:
        conn.execute("PRAGMA busy_timeout=30000")
        conn.execute("ATTACH DATABASE ? AS snap", (src_db,))
        try:
            cur = conn.execute(
                """
                INSERT OR IGNORE INTO ohlcv (ticker,tf,ts,o,h,l,c,v)
                SELECT s.ticker,s.tf,s.ts,s.o,s.h,s.l,s.c,s.v
                FROM snap.ohlcv s
                LEFT JOIN (
                    SELECT ticker,tf,MAX(ts) AS mx
                    FROM ohlcv GROUP BY ticker,tf
                ) l ON l.ticker=s.ticker AND l.tf=s.tf
                WHERE l.mx IS NULL OR s.ts > l.mx
                """
            )
            adopted = cur.rowcount if cur.rowcount is not None else 0
            # Best-effort provenance merge — older snapshots may lack the
            # table; same OR IGNORE no-regress semantics.
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO bars_provenance "
                    "(ticker,tf,ts,source,fetched_at) "
                    "SELECT ticker,tf,ts,source,fetched_at FROM snap.bars_provenance"
                )
            except sqlite3.Error:
                pass
            conn.commit()
            return adopted
        finally:
            conn.execute("DETACH DATABASE snap")
    finally:
        conn.close()


def merge_snapshot(ts: str) -> bool:
    """Download snapshot <ts> and MERGE it into the local bars.db with
    newer-wins semantics. Never replaces the local DB, so it cannot
    regress fresher local writes. Falls back to a full install only when
    there is no local DB yet (cold start — nothing to protect)."""
    client = _client()
    bucket = _bucket()
    if not (client and bucket):
        return False
    if not os.path.exists(os.path.join(_DATA_DIR, "bars.db")):
        return download_snapshot(ts)
    key = f"{_SNAPSHOT_PREFIX}{ts}.tar.gz"
    try:
        resp = client.get_object(Bucket=bucket, Key=key)
        data = resp["Body"].read()
    except Exception as e:
        logger.warning(f"[data_sync] merge download failed for {key}: {e}")
        return False
    tmpdir = tempfile.mkdtemp(prefix="data_sync_merge_")
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
            tar.extractall(tmpdir)
        src_db = os.path.join(tmpdir, "bars.db")
        if not os.path.exists(src_db):
            logger.warning(f"[data_sync] snapshot {ts} has no bars.db; skip merge")
            return False
        if not _verify_snapshot_db(src_db):
            logger.error(
                f"[data_sync] snapshot {ts} bars.db failed integrity_check; "
                f"refusing to merge"
            )
            return False
        adopted = _merge_ohlcv_from(src_db)
        if adopted < 0:
            return download_snapshot(ts)
        try:
            from api.services import bars_sqlite
            bars_sqlite.bump_db_epoch()
        except Exception as e:
            logger.warning(
                f"[data_sync] bump_db_epoch after merge failed (non-fatal): {e}"
            )
        _write_marker(_LAST_SYNC_MARKER, ts)
        logger.info(
            f"[data_sync] merged snapshot {ts}: {adopted} rows adopted (newer-wins)"
        )
        return True
    except Exception as e:
        logger.exception(f"[data_sync] merge extract/apply failed for {key}: {e}")
        return False
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def sync_if_newer_merge() -> Optional[str]:
    """Like sync_if_newer but MERGES (newer-wins) instead of replacing.
    Safe to run unconditionally on a fixed cadence — it can only add
    freshness, never regress a fresher local write."""
    remote_ts = get_latest_snapshot_ts()
    if not remote_ts:
        return None
    local = get_local_sync_state()
    if local["snapshot_ts"] == remote_ts:
        return None  # already merged this snapshot
    if merge_snapshot(remote_ts):
        return remote_ts
    return None


# ── Delta export / upload (worker side) ─────────────────────────────────────

def _export_delta_db(out_path: str, now: Optional[int] = None) -> int:
    """Build a small SQLite at out_path holding only ohlcv + bars_provenance
    rows newer than the per-tf cutoff. Returns ohlcv rows exported. Reads the
    live bars.db read-only (WAL allows concurrent reads while the prewarmer
    writes). Column lists match bars_sqlite.init_db exactly."""
    cutoffs = _delta_cutoffs(now)
    src_path = os.path.join(_DATA_DIR, "bars.db")
    src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
    try:
        out = sqlite3.connect(out_path)
        try:
            out.execute(
                "CREATE TABLE IF NOT EXISTS ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, "
                "ts INTEGER NOT NULL, o REAL, h REAL, l REAL, c REAL, v INTEGER, "
                "PRIMARY KEY (ticker, tf, ts))"
            )
            out.execute(
                "CREATE TABLE IF NOT EXISTS bars_provenance (ticker TEXT NOT NULL, "
                "tf TEXT NOT NULL, ts INTEGER NOT NULL, source TEXT NOT NULL, "
                "fetched_at INTEGER NOT NULL, PRIMARY KEY (ticker, tf, ts))"
            )
            total = 0
            for tf, cut in cutoffs.items():
                rows = src.execute(
                    "SELECT ticker,tf,ts,o,h,l,c,v FROM ohlcv WHERE tf=? AND ts>=?",
                    (tf, cut),
                ).fetchall()
                if rows:
                    out.executemany(
                        "INSERT OR REPLACE INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", rows
                    )
                    total += len(rows)
                # Provenance is best-effort (table may be empty for legacy rows).
                try:
                    prov = src.execute(
                        "SELECT ticker,tf,ts,source,fetched_at FROM bars_provenance "
                        "WHERE tf=? AND ts>=?",
                        (tf, cut),
                    ).fetchall()
                    if prov:
                        out.executemany(
                            "INSERT OR REPLACE INTO bars_provenance VALUES (?,?,?,?,?)", prov
                        )
                except sqlite3.Error:
                    pass
            out.commit()
            return total
        finally:
            out.close()
    finally:
        src.close()


def _make_delta_tarball(now: Optional[int] = None) -> Optional[bytes]:
    """Tar a freshly-exported delta.db. Returns None when there's nothing in
    the window (don't ship empty deltas)."""
    if not os.path.exists(os.path.join(_DATA_DIR, "bars.db")):
        return None
    tmpdir = tempfile.mkdtemp(prefix="data_sync_delta_")
    try:
        delta_db = os.path.join(tmpdir, "delta.db")
        n = _export_delta_db(delta_db, now=now)
        if n == 0:
            return None
        # Gate the freshly-built delta before shipping. Integrity only + a >=1
        # floor (delta windows are legitimately small; n>0 already ensured
        # above). A corrupt delta merged into a web pod is the same poison class
        # as a corrupt full snapshot.
        _assert_shippable_db(delta_db, 1, "delta")
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            tar.add(delta_db, arcname="delta.db")
        return buf.getvalue()
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _prune_old_deltas(keep_list) -> int:
    """Delete delta objects whose ts is not in keep_list. Best-effort."""
    client = _client()
    bucket = _bucket()
    if not (client and bucket):
        return 0
    keepset = {f"{_DELTA_PREFIX}{t}.tar.gz" for t in keep_list}
    deleted = 0
    try:
        resp = client.list_objects_v2(Bucket=bucket, Prefix=_DELTA_PREFIX)
        for o in resp.get("Contents", []) or []:
            k = o["Key"]
            if k.endswith(".tar.gz") and k not in keepset:
                try:
                    client.delete_object(Bucket=bucket, Key=k)
                    deleted += 1
                except Exception:
                    pass
    except Exception as e:
        logger.warning(f"[data_sync] delta prune failed (non-fatal): {e}")
    return deleted


def upload_delta(now: Optional[int] = None) -> Optional[str]:
    """Build + PUT a windowed delta tarball and append its ts to the delta
    index. Returns the delta ts, or None (no creds / empty window / failure)."""
    client = _client()
    bucket = _bucket()
    if not (client and bucket):
        return None
    try:
        data = _make_delta_tarball(now=now)
    except SnapshotIntegrityError as e:
        logger.error(f"[data_sync] delta REFUSED by integrity gate — not uploading: {e}")
        return None
    if not data:
        return None
    ts = str(int(now if now is not None else time.time()))
    try:
        client.put_object(Bucket=bucket, Key=f"{_DELTA_PREFIX}{ts}.tar.gz",
                          Body=data, ContentType="application/gzip")
    except Exception as e:
        logger.exception(f"[data_sync] delta upload failed: {e}")
        return None
    # Append ts to the index (newest last), keep last DELTA_KEEP.
    try:
        existing = client.get_object(
            Bucket=bucket, Key=_DELTA_INDEX_KEY
        )["Body"].read().decode().split()
    except Exception:
        existing = []
    keep = (existing + [ts])[-DELTA_KEEP:]
    try:
        client.put_object(Bucket=bucket, Key=_DELTA_INDEX_KEY,
                          Body="\n".join(keep).encode(), ContentType="text/plain")
    except Exception as e:
        logger.warning(f"[data_sync] delta index write failed (non-fatal): {e}")
    _prune_old_deltas(keep)
    logger.info(f"[data_sync] uploaded delta {ts} ({len(data)} bytes)")
    return ts


# ── Delta apply / orchestration (web side) ──────────────────────────────────

def _list_remote_deltas() -> list:
    """Return the delta-ts list from deltas/latest.txt (unordered)."""
    client = _client()
    bucket = _bucket()
    if not (client and bucket):
        return []
    try:
        raw = client.get_object(
            Bucket=bucket, Key=_DELTA_INDEX_KEY
        )["Body"].read().decode()
        return [t for t in raw.split() if t.strip().isdigit()]
    except Exception:
        return []


def apply_delta(ts: str) -> bool:
    """Download deltas/<ts>.tar.gz and merge its delta.db newer-wins into the
    local bars.db. Reuses the exact merge the full snapshot path uses."""
    client = _client()
    bucket = _bucket()
    if not (client and bucket):
        return False
    tmpdir = tempfile.mkdtemp(prefix="data_sync_delta_apply_")
    try:
        data = client.get_object(
            Bucket=bucket, Key=f"{_DELTA_PREFIX}{ts}.tar.gz"
        )["Body"].read()
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
            tar.extractall(tmpdir)
        src = os.path.join(tmpdir, "delta.db")
        if not os.path.exists(src) or not _verify_snapshot_db(src):
            logger.warning(f"[data_sync] delta {ts} missing/invalid; skipping")
            return False
        adopted = _merge_ohlcv_from(src)   # SAME newer-wins merge as full path
        if adopted < 0:
            return False                   # no local DB yet — base must land first
        _write_marker(_LAST_DELTA_MARKER, ts)
        logger.info(f"[data_sync] applied delta {ts}: {adopted} rows adopted")
        return True
    except Exception as e:
        logger.warning(f"[data_sync] apply_delta {ts} failed (non-fatal): {e}")
        return False
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def sync_with_deltas() -> Optional[str]:
    """Base + delta pull. Cold start installs the latest full base; thereafter
    folds the daily base in (newer-wins, cheap) and applies every delta newer
    than both the base and the last-applied delta, in ascending ts order.
    Returns the newest ts applied, or None. Order-independent + idempotent by
    construction (the merge is newer-wins per (ticker,tf,ts))."""
    newest = None
    base_ts = get_latest_snapshot_ts()
    have_local = os.path.exists(os.path.join(_DATA_DIR, "bars.db"))
    if base_ts and not have_local:
        if download_snapshot(base_ts):     # cold-start full install
            newest = base_ts
    elif base_ts:
        local = get_local_sync_state()
        if local["snapshot_ts"] != base_ts and merge_snapshot(base_ts):
            newest = base_ts

    last_delta = _read_marker(_LAST_DELTA_MARKER)["snapshot_ts"] or "0"
    floor = max(int(base_ts) if base_ts and base_ts.isdigit() else 0,
                int(last_delta) if last_delta.isdigit() else 0)
    for ts in sorted(_list_remote_deltas(), key=int):
        if int(ts) > floor and apply_delta(ts):
            newest = ts
    return newest
