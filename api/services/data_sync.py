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
import threading
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


#: Timeframes keyed by a YYYYMMDD integer rather than unix seconds.
_DATE_KEYED_TFS = ("D", "W", "M")
_DATE_KEY_MAX = 99991231
_UNIX_KEY_MAX = 2**63 - 1


def _date_key(unix_seconds: int) -> int:
    """The ET calendar date of a unix time, in the YYYYMMDD form bars are keyed by."""
    return int(_dt.datetime.fromtimestamp(unix_seconds, _ET).strftime("%Y%m%d"))


def _delta_cutoffs(now: Optional[int] = None) -> dict:
    """Per-tf cutoff: rows with ts >= cutoff go in the delta.

    Each cutoff is in its timeframe's own key unit. Intraday bars are keyed by
    unix seconds and D/W/M by YYYYMMDD; until 2026-11-09 D/W/M were given a
    unix-seconds cutoff too, which no date key can reach, so no delta ever
    carried a daily, weekly or monthly bar."""
    now = int(now if now is not None else time.time())
    intraday = now - DELTA_WINDOW_INTRADAY_DAYS * _DAY_SECONDS
    return {
        "1": intraday, "5": intraday, "15": intraday, "30": intraday, "60": intraday,
        "D": _date_key(now - DELTA_WINDOW_DAILY_DAYS * _DAY_SECONDS),
        "W": _date_key(now - DELTA_WINDOW_SLOW_DAYS * _DAY_SECONDS),
        "M": _date_key(now - DELTA_WINDOW_SLOW_DAYS * _DAY_SECONDS),
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


R2_READ_TIMEOUT_S = int(os.environ.get("DATA_SYNC_READ_TIMEOUT_S", "300"))
SNAPSHOT_DOWNLOAD_ATTEMPTS = int(os.environ.get("DATA_SYNC_DOWNLOAD_ATTEMPTS", "3"))


def _client():
    """Lazy-construct the boto3 S3 client. Returns None if credentials missing."""
    endpoint = os.environ.get("DATA_SYNC_ENDPOINT_URL")
    access_key = os.environ.get("DATA_SYNC_ACCESS_KEY")
    secret_key = os.environ.get("DATA_SYNC_SECRET_KEY")
    if not (endpoint and access_key and secret_key):
        return None
    import boto3
    from botocore.config import Config
    # ⛔ 2026-11-13: botocore's default 60 s read timeout killed a 5 GB snapshot download on bars-api
    # after one stall ("Read timeout on endpoint URL"), and that boot then served from an empty store.
    # A long read timeout plus adaptive retries keeps multi-GB transfers alive through a slow patch.
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=os.environ.get("DATA_SYNC_REGION", "auto"),
        config=Config(connect_timeout=30, read_timeout=R2_READ_TIMEOUT_S,
                      retries={"max_attempts": 8, "mode": "adaptive"}),
    )


def _bucket() -> Optional[str]:
    return os.environ.get("DATA_SYNC_BUCKET")


def presigned_get(key: str, expires: int = 3600):
    """Presigned GET URL for an R2 object, or None if R2 is not configured."""
    cl = _client()
    if not cl:
        return None
    try:
        return cl.generate_presigned_url(
            "get_object",
            Params={"Bucket": _bucket(), "Key": key},
            ExpiresIn=int(expires),
        )
    except Exception:
        return None


_OBJECT_EXISTS_TTL_SECONDS = 60
# In-process cache of recent object_exists() results: {key: (exists_bool, expiry_ts)}.
# Plain dict is fine here — the web service is a single process, and a HEAD is
# cheap/idempotent so a rare cross-thread race just means one extra HEAD, not
# corruption. Caches BOTH True and False so a not-yet-backfilled key doesn't
# get HEAD'd on every serve, while still re-checking within a minute once the
# backfill lands.
_object_exists_cache: dict = {}


def object_exists(key: str) -> bool:
    """True if the R2 object exists. Cheap HEAD, cached briefly (60s) to avoid
    HEAD storms when the same video is served repeatedly. False when R2 is
    unconfigured or the key is absent — never raises."""
    now = time.time()
    cached = _object_exists_cache.get(key)
    if cached is not None and cached[1] > now:
        return cached[0]

    cl = _client()
    if not cl:
        _object_exists_cache[key] = (False, now + _OBJECT_EXISTS_TTL_SECONDS)
        return False

    try:
        cl.head_object(Bucket=_bucket(), Key=key)
        exists = True
    except Exception:
        # Covers botocore ClientError (404/NoSuchKey/403) and anything else —
        # a HEAD failure of any kind means "treat as not present."
        exists = False

    _object_exists_cache[key] = (exists, now + _OBJECT_EXISTS_TTL_SECONDS)
    return exists


def put_bytes(key: str, data: bytes, content_type: str) -> bool:
    """Upload bytes to R2. Returns False (no-op) when R2 is not configured."""
    cl = _client()
    if not cl:
        return False
    try:
        cl.put_object(Bucket=_bucket(), Key=key, Body=data, ContentType=content_type)
        return True
    except Exception:
        return False


def get_bytes(key: str) -> Optional[bytes]:
    """Download an R2 object's bytes, or None (missing / unconfigured / error).
    Never raises — the caller decides how to degrade on a miss."""
    cl = _client()
    if not cl:
        return None
    try:
        resp = cl.get_object(Bucket=_bucket(), Key=key)
        return resp["Body"].read()
    except Exception:
        return None


# ── Bounded tarball reads (TERM-014, 2026-10-02) ─────────────────────────────
# A snapshot/delta tarball is pulled from R2 in pieces of AT MOST this many bytes
# and decompressed as it arrives; the whole object is never held in memory.
#
# WHY: `merge_snapshot` used to do `resp["Body"].read()` on the base tarball. On
# 2026-10-02 the base was 8,332,085,147 bytes (7.76 GiB). The web pod's periodic
# puller ran it at ~17:00:55Z; RssAnon rose 7,914 MiB in ~3 minutes (the download)
# and held for ~30 minutes (the extract + integrity_check + merge, during which
# `data` stayed referenced), then dropped at once when the merge returned at
# 17:34:41Z. `download_snapshot` had already been moved to stream-to-disk after the
# 2026-08-31 ~10 GB spike; the merge path -- the web pod's DEFAULT path -- had not.
_STREAM_READ_BYTES = 8 * 1024 * 1024


class _BoundedReader:
    """File-like view over an R2 response body that never forwards a read larger
    than `_STREAM_READ_BYTES` (an unbounded `read()` / `read(-1)` is clamped too).
    Short reads are fine: tarfile's stream mode loops until it has what it needs."""

    def __init__(self, body):
        self._body = body

    def read(self, size=-1):
        if size is None or size < 0 or size > _STREAM_READ_BYTES:
            size = _STREAM_READ_BYTES
        return self._body.read(size)


def _extract_tar_stream(body, dest: str) -> None:
    """Decompress + extract a .tar.gz R2 body into `dest` WHILE it downloads.
    Resident memory is bounded by `_STREAM_READ_BYTES` plus tarfile's own buffers,
    independent of the object's size. Same extraction semantics as the previous
    `tarfile.open(fileobj=BytesIO(data), mode="r:gz").extractall(dest)`."""
    with tarfile.open(fileobj=_BoundedReader(body), mode="r|gz") as tar:
        tar.extractall(dest)


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


#: Build the snapshot's bars.db in the clustered layout (bars_cluster). OFF by default
#: for a concrete safety reason: it adds hours and ~0.8x the copy in disk to the worker's
#: daily base, so it is an owner-approved rollout step (PR #1102 rollout order). Unset/`0`
#: ships the rowid copy unchanged -- the pre-2026-11-11 behaviour and the rollback lever.
SNAPSHOT_CLUSTER = os.environ.get("SNAPSHOT_CLUSTER", "0") == "1"
#: Free space the conversion needs beside the copy (the clustered file is ~half the
#: rowid file; 0.8x + 1 GB is the margin).
_CLUSTER_DISK_FACTOR = 0.8


def _cluster_snapshot_copy(path: str) -> bool:
    """Replace the private snapshot copy at `path` with its clustered conversion.
    Returns True when the shipped file is clustered. Never raises: on any failure the
    copy ships exactly as it was built."""
    from api.services import bars_cluster, bars_sqlite
    try:
        c = sqlite3.connect(path)
        try:
            layout = bars_sqlite.ohlcv_layout(c)
        finally:
            c.close()
        if layout == "clustered":
            return True
        if not SNAPSHOT_CLUSTER or layout != "rowid":
            return False
        need = int(os.path.getsize(path) * _CLUSTER_DISK_FACTOR) + (1 << 30)
        free = shutil.disk_usage(os.path.dirname(path)).free
        if free < need:
            logger.warning(f"[data_sync] snapshot NOT clustered: {free >> 20} MB free < "
                           f"{need >> 20} MB needed")
            return False
        dst = path + ".clustered"
        stats = bars_cluster.cluster_copy(path, dst)
        os.replace(dst, path)
        logger.info(f"[data_sync] snapshot clustered (WITHOUT ROWID): {stats}")
        return True
    except Exception as e:  # noqa: BLE001 -- fail safe: ship the unconverted copy
        logger.warning(f"[data_sync] snapshot NOT clustered (shipping rowid copy): {e}")
        return False


#: S3 object metadata the snapshot carries so a pod can decide BEFORE downloading.
_META_LAYOUT = "bars-layout"
_META_DB_BYTES = "bars-db-bytes"
#: Layout + size of the bars.db inside the tarball `_make_tarball` built last.
_last_tarball_meta: dict = {}
#: One-shot record of a completed adoption (ts of the adopted snapshot).
_ADOPTED_MARKER = ".adopted_clustered"
#: Set while an adoption builds/swaps the store: every sync path stands aside.
_adoption_active = threading.Event()
#: An adopted store must hold at least this share of the local store's rows.
ADOPT_MIN_ROW_RATIO = float(os.environ.get("BARS_ADOPT_MIN_ROW_RATIO", "0.9"))
_adopt_logged: set = set()
#: Hard budget for the adoption's LOCKED pass (writers paused). Over it -> abort, keep
#: the old store, retry in a later window.
ADOPT_LOCKED_BUDGET_S = float(os.environ.get("BARS_ADOPT_LOCKED_BUDGET_S", "10"))


def in_quiet_window(now: Optional[_dt.datetime] = None) -> bool:
    """True overnight ET (20:15 -> 03:45, Mon-Fri) and all weekend: no live store, no
    session -- the only time a store adoption may run."""
    et = (now or _dt.datetime.now(_dt.timezone.utc)).astimezone(_ET)
    minute = et.hour * 60 + et.minute
    if et.weekday() >= 5:
        return True
    return minute >= 20 * 60 + 15 or minute < 3 * 60 + 45


def _log_once(key: str, msg: str) -> None:
    if key not in _adopt_logged:
        _adopt_logged.add(key)
        logger.warning(msg)


def _layout_of(path: str) -> str:
    from api.services import bars_sqlite
    c = sqlite3.connect(path, timeout=5)
    try:
        return bars_sqlite.ohlcv_layout(c)
    finally:
        c.close()


def _row_count(path: str) -> int:
    c = sqlite3.connect(path, timeout=30)
    try:
        return int(c.execute("SELECT COUNT(*) FROM ohlcv").fetchone()[0])
    finally:
        c.close()


def _copy_stat1(old_path: str, new_path: str) -> None:
    """Carry planner statistics for the tables/indexes the new store still has."""
    c = sqlite3.connect(new_path, isolation_level=None)
    try:
        c.execute("ATTACH DATABASE ? AS old", (old_path,))
        if not c.execute("SELECT 1 FROM old.sqlite_master WHERE name='sqlite_stat1'").fetchone():
            return
        if not c.execute("SELECT 1 FROM main.sqlite_master WHERE name='sqlite_stat1'").fetchone():
            c.execute("ANALYZE sqlite_master")            # creates an empty sqlite_stat1
        c.execute("INSERT INTO main.sqlite_stat1 SELECT tbl, idx, stat FROM old.sqlite_stat1 o "
                  "WHERE EXISTS (SELECT 1 FROM main.sqlite_master m WHERE m.name = o.tbl) "
                  "AND (o.idx IS NULL OR EXISTS (SELECT 1 FROM main.sqlite_master m "
                  "WHERE m.name = o.idx)) AND NOT EXISTS (SELECT 1 FROM main.sqlite_stat1 n "
                  "WHERE n.tbl = o.tbl AND n.idx IS o.idx)")
    finally:
        c.close()


def _write_marker_at(data_dir: str, filename: str, ts: str) -> None:
    with open(os.path.join(data_dir, filename), "w") as f:
        f.write(f"{ts}\n{int(time.time())}\n")


def adopt_clustered_store(data_dir: Optional[str] = None) -> str:
    """⭐ HOW A SERVING POD ADOPTS THE CLUSTERED LAYOUT (bars_cluster module doc).

    Runs only with `BARS_ADOPT_CLUSTERED=1`, ONCE (marker), on a pod whose store is still
    rowid. The live store is never touched until a complete, verified replacement exists:
      1. R2's latest snapshot must SAY it is clustered (object metadata written by the
         uploader) -- otherwise nothing is downloaded (a rowid base: conversion disabled,
         short on disk, failed verification, or a base build killed by a deploy);
      2. free disk must cover the new store (+10% + 2 GB) beside the old one;
      3. stream-extract onto the SAME volume (no tarball on disk); the copy must be
         clustered, pass integrity_check and hold >= ADOPT_MIN_ROW_RATIO of the live rows;
      0. only inside the quiet window (`in_quiet_window`); otherwise it returns
         "not-quiet" and is retried at the next boot / periodic pull;
      4. carry what only this pod holds (live-store bars, heals, cold fetches, deep warms):
         the standard newer-wins merge FROM the old store INTO the new copy (forward tails,
         holes/corrections inside the heal window, and whole pairs the base lacks),
         UNLOCKED; then, under the write lock, a second merge of ONLY the (ticker, tf)
         pairs written since pass 1 began (`bars_sqlite` write tracking), within
         ADOPT_LOCKED_BUDGET_S -- over budget aborts and keeps the old store;
      5. under the write lock AND `DB_SWAP_LOCK` (the WAL checkpointer waits): TRUNCATE-
         checkpoint the old store (its -wal/-shm are then empty and reset, so they are
         safe beside the new file), atomic rename, `bump_db_epoch`;
      6. markers: adopted (one-shot), last-sync = the snapshot, last-delta CLEARED so every
         delta newer than the base re-applies.
    Any failure leaves the old store exactly as it was and is logged once. Returns a
    status word."""
    if os.environ.get("BARS_ADOPT_CLUSTERED") != "1":
        return "off"
    data_dir = data_dir or _DATA_DIR
    p = os.path.join(data_dir, "bars.db")
    if os.path.exists(os.path.join(data_dir, _ADOPTED_MARKER)):
        return "done"
    if not os.path.exists(p):
        return "absent"                       # the cold-start install handles an empty pod
    try:
        if _layout_of(p) == "clustered":
            _write_marker_at(data_dir, _ADOPTED_MARKER, "local")
            return "done"
    except Exception as e:  # noqa: BLE001
        _log_once("probe", f"[data_sync] adopt-clustered: local probe failed: {e}")
        return "failed"
    if not in_quiet_window() and os.environ.get("BARS_ADOPT_IGNORE_WINDOW") != "1":
        # ⭐ BARS_ADOPT_IGNORE_WINDOW=1 (owner-requested override, 2026-11-13): adopt outside the
        # quiet window. Every other gate (clustered tag, disk, integrity, row ratio, the locked
        # pass-2 budget) still applies. Unset it after the adoption.
        return "not-quiet"                    # retried at the next boot / pull in a window
    client, bucket = _client(), _bucket()
    ts = get_latest_snapshot_ts() if (client and bucket) else None
    if not ts:
        return "no-snapshot"
    key = f"{_SNAPSHOT_PREFIX}{ts}.tar.gz"
    try:
        meta = {k.lower(): v for k, v in (client.head_object(Bucket=bucket, Key=key)
                                          .get("Metadata") or {}).items()}
    except Exception as e:  # noqa: BLE001
        _log_once(f"head-{ts}", f"[data_sync] adopt-clustered: cannot read {key} metadata: {e}")
        return "failed"
    if meta.get(_META_LAYOUT) != "clustered":
        _log_once(f"rowid-{ts}", f"[data_sync] adopt-clustered: latest snapshot {ts} is not "
                                 f"clustered ({meta.get(_META_LAYOUT)}); store kept")
        return "snapshot-rowid"
    try:
        db_bytes = int(meta.get(_META_DB_BYTES) or 0)
    except ValueError:
        db_bytes = 0
    need = int((db_bytes or os.path.getsize(p)) * 1.1) + (2 << 30)
    free = shutil.disk_usage(data_dir).free
    if free < need:
        _log_once(f"disk-{ts}", f"[data_sync] adopt-clustered: {free >> 20} MB free < "
                                f"{need >> 20} MB needed; store kept")
        return "no-disk"
    from api.services import bars_sqlite
    tmpdir = tempfile.mkdtemp(prefix="adopt_", dir=data_dir)    # same volume: atomic rename
    _adoption_active.set()
    try:
        _extract_tar_stream(client.get_object(Bucket=bucket, Key=key)["Body"], tmpdir)
        new = os.path.join(tmpdir, "bars.db")
        if not os.path.exists(new):
            raise RuntimeError("snapshot has no bars.db")
        if _layout_of(new) != "clustered":
            raise RuntimeError("downloaded store is not clustered")
        if not _verify_snapshot_db(new):
            raise RuntimeError("downloaded store failed integrity_check")
        n_old, n_new = _row_count(p), _row_count(new)
        if n_new < ADOPT_MIN_ROW_RATIO * n_old:
            raise RuntimeError(f"downloaded store holds {n_new} rows < "
                               f"{ADOPT_MIN_ROW_RATIO:.0%} of the local {n_old}")
        # Pass 1, UNLOCKED: the full carry while the pod keeps serving and writing.
        bars_sqlite.start_write_tracking()
        try:
            carried = max(0, _merge_ohlcv_from(p, new))
            _copy_stat1(p, new)
        except BaseException:
            bars_sqlite.stop_write_tracking()
            raise
        with bars_sqlite._WRITE_LOCK, bars_sqlite.DB_SWAP_LOCK:
            # Pass 2, LOCKED and BUDGETED: only the series written since pass 1 began.
            changed = sorted(bars_sqlite.stop_write_tracking())
            t_lock = time.monotonic()
            if changed:
                carried += max(0, _merge_ohlcv_from(
                    p, new, pairs=changed, deadline=t_lock + ADOPT_LOCKED_BUDGET_S))
            c = sqlite3.connect(p, timeout=30)
            try:
                busy = c.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0]
            finally:
                c.close()
            if busy:
                raise RuntimeError("old store busy; could not checkpoint before the swap")
            bars_sqlite._drop_local_conn()
            os.replace(new, p)
            bars_sqlite.bump_db_epoch()
            # ⭐ Bar contract: a swapped-in store is a NEW store. Its series_meta came from
            # the snapshot producer (proofs about ITS rows, before the old store's tails
            # were merged in), so every proof / seal is voided and every served rev moves
            # past what clients hold — the provably safe choice over carrying meta across.
            bars_sqlite.bump_store_floor("adopted clustered store")
        _write_marker_at(data_dir, _ADOPTED_MARKER, ts)
        _write_marker_at(data_dir, _LAST_SYNC_MARKER, ts)
        try:
            os.remove(os.path.join(data_dir, _LAST_DELTA_MARKER))
        except FileNotFoundError:
            pass
        logger.info(f"[data_sync] adopt-clustered: installed clustered snapshot {ts} "
                    f"({n_new} rows; {carried} local rows carried)")
        return "adopted"
    except Exception as e:  # noqa: BLE001 -- the old store is untouched
        _log_once(f"fail-{ts}", f"[data_sync] adopt-clustered FAILED for {ts}; store kept: {e}")
        return "failed"
    finally:
        _adoption_active.clear()
        shutil.rmtree(tmpdir, ignore_errors=True)


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
            # ⭐ Ship the CLUSTERED layout (bars_cluster module doc): rebuilt OFFLINE on
            # this private copy, fully verified; any failure ships the copy unchanged.
            _clustered = _cluster_snapshot_copy(snap_db_path)
            _last_tarball_meta.clear()
            _last_tarball_meta.update({_META_LAYOUT: "clustered" if _clustered else "rowid",
                                       _META_DB_BYTES: str(os.path.getsize(snap_db_path))})
            # ⛔⛔ THE SNAPSHOT CARRIES EVERY INDEX THE WEB EXPECTS (incident
            # 2026-10-02). The backup copies the WORKER's bars.db, which never
            # had the web-only `idx_ohlcv_daily_bydate`; installed on web, the
            # missing index made every later boot start a 31 GB CREATE INDEX
            # that held the write lock for ~13 min through three failed deploys.
            # Built here on the PRIVATE copy (no lock contention, no member
            # traffic); a no-op once the source carries them. Raising here fails
            # the upload rather than shipping a short snapshot.
            # Rail: tests/test_bars_snapshot_carries_indexes.py.
            from api.services import bars_sqlite as _bs_idx
            _t_idx = time.time()
            _created = _bs_idx.ensure_indexes_at(snap_db_path)
            if _created:
                logger.info(f"[data_sync] snapshot copy lacked {_created}; built in "
                            f"{time.time() - _t_idx:.1f}s so the install carries them")
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
                           ExtraArgs={"ContentType": "application/gzip",
                                      # lets a pod decide on adoption without downloading
                                      "Metadata": dict(_last_tarball_meta)})
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


SWAP_BUSY_TIMEOUT_S = 30


def _swap_in_bars_db(src_db: str, dst: str, bs) -> bool:
    """⛔ THE SAFE WHOLESALE SWAP (2026-11-13). Install `src_db` as `dst` without ever leaving a
    write-ahead log beside a main file it does not belong to.

    ⚰️ The old code `shutil.move`d the new main file over the old one and left the old
    `bars.db-wal` / `-shm` in place. bars-api installs in a background thread AFTER it starts
    serving, so a 19-minute download let live cold fetches build an interim store + WAL; the swap
    then put the new 19.5 GB file beside that WAL and the next connection read it as
    "database disk image is malformed" (bars-api 2026-11-13 20:52 UTC: `post-install init_db
    failed: malformed` right after a verified install).

    Same discipline as `adopt_clustered_store` step 5: under the write lock AND `DB_SWAP_LOCK`,
    TRUNCATE-checkpoint the old store (its -wal/-shm are then empty and reset, safe beside the new
    file); busy => refuse, keep the old store. No old main file => any -wal/-shm left behind are
    orphans of a store that no longer exists, and are removed. Then replace and bump the epoch so
    every thread reopens the new inode before its next query. Returns False (store untouched) on
    any refusal."""
    with bs._WRITE_LOCK, bs.DB_SWAP_LOCK:
        if os.path.exists(dst):
            c = sqlite3.connect(dst, timeout=SWAP_BUSY_TIMEOUT_S)
            try:
                busy = c.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0]
            except sqlite3.DatabaseError as e:
                busy = None
                logger.warning(f"[data_sync] old store unreadable ({e}); replacing it whole")
            finally:
                c.close()
            if busy:
                logger.error("[data_sync] old store busy; could not checkpoint before the swap; "
                             "snapshot NOT installed, old store kept")
                return False
            if busy is None:                 # damaged old store: its sidecars are meaningless too
                for suf in ("-wal", "-shm"):
                    if os.path.exists(dst + suf):
                        os.remove(dst + suf)
        else:
            for suf in ("-wal", "-shm"):
                if os.path.exists(dst + suf):
                    os.remove(dst + suf)     # orphans of a removed store
        try:
            bs._drop_local_conn()
        except Exception:  # noqa: BLE001
            pass
        shutil.move(src_db, dst)
        bs.bump_db_epoch()
    return True


def _stream_object_to(client, bucket: str, key: str, path: str) -> None:
    """Stream an R2 object to DISK in 8 MB chunks (never resp.read() into memory: a ~5 GB base read
    whole into RAM spiked the web pod toward OOM on 2026-08-31). Raises on any failure."""
    body = client.get_object(Bucket=bucket, Key=key)["Body"]
    with open(path, "wb") as fh:
        while True:
            chunk = body.read(8 * 1024 * 1024)
            if not chunk:
                break
            fh.write(chunk)


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
    tmpdir = tempfile.mkdtemp(prefix="data_sync_")
    _tar_path = os.path.join(tmpdir, "_snapshot.tar.gz")
    last_err = None
    for attempt in range(1, SNAPSHOT_DOWNLOAD_ATTEMPTS + 1):
        try:
            _stream_object_to(client, bucket, key, _tar_path)
            last_err = None
            break
        except Exception as e:  # noqa: BLE001 -- retried below, then reported
            last_err = e
            logger.warning(f"[data_sync] download attempt {attempt}/{SNAPSHOT_DOWNLOAD_ATTEMPTS} "
                           f"failed for {key}: {e}")
            if attempt < SNAPSHOT_DOWNLOAD_ATTEMPTS and not os.environ.get("PYTEST_CURRENT_TEST"):
                time.sleep(min(60, 10 * attempt))
    try:
        if last_err is not None:
            raise last_err
    except Exception as e:
        logger.warning(f"[data_sync] download failed for {key}: {e}")
        shutil.rmtree(tmpdir, ignore_errors=True)
        return False
    try:
        with tarfile.open(_tar_path, mode="r:gz") as tar:
            tar.extractall(tmpdir)
        try:
            os.remove(_tar_path)   # free the ~5 GB tarball before the big DB move
        except OSError:
            pass
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
            # ⛔ The swap goes through `_swap_in_bars_db`: the old store is TRUNCATE-checkpointed
            # under the write + swap locks (its -wal/-shm become empty, safe beside the new file),
            # orphaned sidecars are removed, busy => refuse. ⚰️ This said "we do NOT remove the OLD
            # sidecars" and moved the new file beside a live WAL: bars-api 2026-11-13 malformed.
            from api.services import bars_sqlite as _bs_swap
            if not _swap_in_bars_db(src_db, os.path.join(_DATA_DIR, "bars.db"), _bs_swap):
                return False
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
            bars_sqlite.bump_store_floor("snapshot installed")   # wholesale: revs + proofs
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
    if _adoption_active.is_set():        # adopt_clustered_store owns bars.db right now
        return None
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
            bars_sqlite.bump_store_floor("empty schema recreated")
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


# ── MERGE (Part 2, 2026-05-16; holes/corrections + chunked, 2026-11-10) ────────
# The locked rule that replaced the two-mechanism conflict (worker→R2→web
# REPLACE vs web on-demand delta WRITE): the snapshot may ADD what local lacks,
# and may only REPLACE a local row it can prove is LESS COMPLETE. Never a blind
# regress of a fresher local write — the exact 2026-05-07 failure mode.
#
# ⚰️ UNTIL 2026-11-10 ONLY `ts > local MAX` WAS ADOPTED. So a hole the worker had
# filled below bars-api's tail, a bar the worker had corrected, and the PARTIAL last
# bar bars-api stored mid-formation never reached bars-api through R2 at all, and
# the whole merge was ONE write transaction over every pair (busy_timeout 30s) that
# `put_bars` and the interactive heals queued behind.
#
# Per (ticker, tf) pair, now:
#   * cold pair (no local rows)        → adopt every valid snapshot row;
#   * forward (s.ts > local MAX)        → adopt (unchanged);
#   * intraday, inside the heal window  → adopt rows local LACKS (holes), and REPLACE
#     a local row whose snapshot twin carries MORE VOLUME — a bucket's volume only
#     grows while it forms, so "more volume at the same ts" is the one monotone,
#     source-free proof that the local row is the partial one;
#   * ⛔ both interior rules apply ONLY when the two stores provably share a PRICE
#     BASIS (closes agree at common rows at BOTH ends of the window) AND no declared
#     split (cache only) sits near the window. A pair whose bases differ (one side
#     re-adjusted for a split), cannot be compared, or straddles a split gets the
#     legacy forward-only rule — interleaving two bases inside a series is the cliff
#     the intraday split heal exists to remove.
# Pairs are merged in CHUNKS, each its own short `BEGIN IMMEDIATE` transaction, with
# the lock hold time measured and logged (merge start / end, max + total lock ms).

_MERGE_INTRADAY_TFS = ("1", "5", "15", "30", "60")
_MERGE_CHUNK_PAIRS = max(1, int(os.environ.get("DATA_SYNC_MERGE_CHUNK_PAIRS", "200")))
#: Lock-hold budget per chunk; a chunk that runs over halves the next chunk's size.
_MERGE_CHUNK_BUDGET_S = float(os.environ.get("DATA_SYNC_MERGE_CHUNK_BUDGET_S", "0.5"))
#: Interior heal reach below local MAX (holes + corrections), intraday only.
_MERGE_HEAL_WINDOW_S = int(float(os.environ.get("DATA_SYNC_MERGE_HEAL_DAYS", "5")) * 86400)
#: Closes at common rows must agree to this relative tolerance to share a basis.
_MERGE_BASIS_TOL = 0.02
_MERGE_BASIS_SAMPLE = 5

# ⛔ SAME POSSIBLE-BAR PREDICATE AS `put_bars`, SPELLED IN SQL BECAUSE THIS IS A
# SET-AT-A-TIME COPY (the second write door into `ohlcv` — 3,533 impossible bars were
# re-imported through it on 2026-08-09 before it was gated): finite (`s.x = s.x` is
# false for a NaN and NULL fails every comparison), positive, and
# `l <= min(o,c) <= max(o,c) <= h`. A rejection, never a repair.
_MERGE_VALID_SQL = """
      s.o IS NOT NULL AND s.h IS NOT NULL
  AND s.l IS NOT NULL AND s.c IS NOT NULL
  AND s.o = s.o AND s.h = s.h AND s.l = s.l AND s.c = s.c
  AND s.o > 0 AND s.h > 0 AND s.l > 0 AND s.c > 0
  AND s.h >= s.l AND s.h >= s.o AND s.h >= s.c
  AND s.l <= s.o AND s.l <= s.c
  AND (s.v IS NULL OR s.v >= 0)
"""

# ⛔ AND THE SAME GRID INVARIANT (`intraday_grid`): an intraday row is keyed on its
# bucket start. A snapshot from a store that still holds off-grid rows (a trade-time
# stamped yfinance live row, 2026-11-10) must not copy them in; the producing store's
# own sweep folds them. Plain SQL (no UDF) so the statement stays a PK seek. 60m is
# prefiltered to :00/:30 — the exact session-grid check is the sweep's.
_MERGE_GRID_SQL = """
  AND (CASE s.tf WHEN '1' THEN s.ts % 60 WHEN '5' THEN s.ts % 300 WHEN '15' THEN s.ts % 900
       WHEN '30' THEN s.ts % 1800 WHEN '60' THEN s.ts % 1800 ELSE 0 END) = 0
"""

#: Rows local LACKS above `floor` (forward tail, plus holes when floor < MAX).
_MERGE_ADD_SQL = (
    "INSERT OR IGNORE INTO main.ohlcv (ticker,tf,ts,o,h,l,c,v) "
    "SELECT s.ticker,s.tf,s.ts,s.o,s.h,s.l,s.c,s.v FROM snap.ohlcv s "
    "WHERE s.ticker=? AND s.tf=? AND s.ts > ? AND " + _MERGE_VALID_SQL + _MERGE_GRID_SQL
)

#: Local rows above `floor` whose snapshot twin is MORE COMPLETE (more volume).
_MERGE_CORRECT_SQL = (
    "INSERT OR REPLACE INTO main.ohlcv (ticker,tf,ts,o,h,l,c,v) "
    "SELECT s.ticker,s.tf,s.ts,s.o,s.h,s.l,s.c,s.v FROM snap.ohlcv s "
    "JOIN main.ohlcv m ON m.ticker=s.ticker AND m.tf=s.tf AND m.ts=s.ts "
    "WHERE s.ticker=? AND s.tf=? AND s.ts > ? "
    "AND COALESCE(s.v,0) > COALESCE(m.v,0) AND " + _MERGE_VALID_SQL + _MERGE_GRID_SQL
)


#: Newest common SETTLED rows (strictly below local MAX: a partial tail never decides).
_MERGE_BASIS_NEWEST_SQL = (
    "SELECT m.c, s.c FROM (SELECT ts, c FROM main.ohlcv WHERE ticker=? AND tf=? "
    "AND ts < ? ORDER BY ts DESC LIMIT 50) m "
    "JOIN snap.ohlcv s ON s.ticker=? AND s.tf=? AND s.ts=m.ts LIMIT ?"
)
#: OLDEST common rows inside the heal window — the end a split would sit behind (settled: below MAX).
_MERGE_BASIS_OLDEST_SQL = (
    "SELECT m.c, s.c FROM (SELECT ts, c FROM main.ohlcv WHERE ticker=? AND tf=? "
    "AND ts > ? AND ts < ? ORDER BY ts ASC LIMIT 50) m "
    "JOIN snap.ohlcv s ON s.ticker=? AND s.tf=? AND s.ts=m.ts LIMIT ?"
)
#: A declared split this close to the heal window disables interior merge for the pair.
_MERGE_SPLIT_PAD_DAYS = 10


def _closes_agree(rows) -> bool:
    if not rows:
        return False
    for lc, sc in rows:
        if not lc or not sc or lc <= 0 or sc <= 0:
            return False
        if abs(sc / lc - 1.0) > _MERGE_BASIS_TOL:
            return False
    return True


def _merge_basis_agrees(conn, ticker: str, tf: str, mx: int, floor: int) -> bool:
    """True when local and snapshot closes agree at BOTH ends of the heal window: the
    newest settled common rows below local MAX and the oldest common rows above
    `floor`. ⛔ Sampling only the newest rows (review F2) agreed on post-split rows
    while the snapshot's pre-split rows further down the window were still on the old
    basis. No common row at either end ⇒ False (unproven → conservative rule)."""
    args = (ticker, tf, mx, ticker, tf, _MERGE_BASIS_SAMPLE)
    if not _closes_agree(conn.execute(_MERGE_BASIS_NEWEST_SQL, args).fetchall()):
        return False
    args = (ticker, tf, floor, mx, ticker, tf, _MERGE_BASIS_SAMPLE)
    return _closes_agree(conn.execute(_MERGE_BASIS_OLDEST_SQL, args).fetchall())


def _merge_split_near(ticker: str, floor: int) -> bool:
    """A declared split (cache only, never a fetch) dated at/after the window floor
    minus a pad. ⛔ Around a split the two stores can legitimately sit on different
    bases (one healed, one not), and interleaving them — or letting a higher old-basis
    volume REPLACE a healed row on a reverse split — re-creates the cliff the intraday
    split heal removed, which it would then re-heal every few hours (an oscillation)."""
    try:
        from api.services.intraday_split_heal import declared_splits_cached
        splits = declared_splits_cached(ticker)
    except Exception:  # noqa: BLE001
        return False
    if not splits:
        return False
    lo = (_dt.datetime.fromtimestamp(floor, _ZoneInfo("America/New_York")).date()
          - _dt.timedelta(days=_MERGE_SPLIT_PAD_DAYS)).isoformat()
    return any(str(s[0])[:10] >= lo for s in splits)


#: 2026-11-10 60m grid move: a snapshot/delta from a not-yet-redeployed worker
#: still carries the old clock-hour 60m layout. Adopting ANY of its 60m rows for a
#: ticker (its 09:30 row has the right key but 30 minutes of content) would
#: re-poison a rebuilt store and make deploy order matter — so a pair whose
#: candidate rows include an old-grid bucket is skipped whole.
_OLD_GRID_60_PROBE_SQL = (
    "SELECT 1 FROM snap.ohlcv WHERE ticker=? AND tf='60' AND ts > ? AND old_grid60(ts) LIMIT 1"
)


def _ensure_old_grid_fn(conn) -> None:
    from api.services.bars_sqlite import is_old_grid_60m_ts
    conn.create_function("old_grid60", 1, lambda ts: 1 if is_old_grid_60m_ts(ts) else 0,
                         deterministic=True)


def _merge_pair(conn, ticker: str, tf: str) -> tuple[int, int]:
    """Merge ONE (ticker, tf). Returns (rows added, rows corrected). Runs inside the
    caller's transaction; every statement is a primary-key range seek."""
    mx = conn.execute("SELECT MAX(ts) FROM main.ohlcv WHERE ticker=? AND tf=?",
                      (ticker, tf)).fetchone()[0]
    if tf == "60":
        probe_floor = -(1 << 62) if mx is None else mx - _MERGE_HEAL_WINDOW_S
        if conn.execute(_OLD_GRID_60_PROBE_SQL, (ticker, probe_floor)).fetchone():
            return 0, 0
    before = conn.total_changes
    if mx is None:
        conn.execute(_MERGE_ADD_SQL, (ticker, tf, -(1 << 62)))
        added = conn.total_changes - before
        if added:
            _bump_merged_rev(conn, ticker, tf)
        return added, 0
    window_floor = mx - _MERGE_HEAL_WINDOW_S
    interior = (tf in _MERGE_INTRADAY_TFS
                and not _merge_split_near(ticker, window_floor)
                and _merge_basis_agrees(conn, ticker, tf, mx, window_floor))
    floor = window_floor if interior else mx
    # Bar contract `history_rev`: THE store rule (`bars_sqlite._history_keys`) judges the
    # rows this merge is about to write below the local tail (hole fills + corrections) —
    # older than the mutable window or sealed => history; inside the window => a delta.
    # A forward add (or the tail itself) never is.
    history = False
    if interior:
        from api.services.bars_sqlite import _history_keys
        cand = conn.execute(_MERGE_HISTORY_SQL,
                            (ticker, tf, floor, mx, ticker, tf, floor, mx)).fetchall()
        history = bool(cand and _history_keys(conn, tf, cand))
    conn.execute(_MERGE_ADD_SQL, (ticker, tf, floor))
    added = conn.total_changes - before
    corrected = 0
    if interior:
        before = conn.total_changes
        conn.execute(_MERGE_CORRECT_SQL, (ticker, tf, floor))
        corrected = conn.total_changes - before
    if added or corrected:
        _bump_merged_rev(conn, ticker, tf, history=history)
    return added, corrected


#: The rows this pair's merge writes strictly BELOW the local tail (holes + corrections),
#: as (ticker, tf, ts, o, h, l, c, v) — bounded by the rows the merge itself writes.
_MERGE_HISTORY_SQL = (
    "SELECT s.ticker,s.tf,s.ts,s.o,s.h,s.l,s.c,s.v FROM snap.ohlcv s WHERE s.ticker=? "
    "AND s.tf=? AND s.ts > ? AND s.ts < ? AND NOT EXISTS (SELECT 1 FROM main.ohlcv m "
    "WHERE m.ticker=s.ticker AND m.tf=s.tf AND m.ts=s.ts) AND " + _MERGE_VALID_SQL
    + _MERGE_GRID_SQL + " UNION ALL "
    "SELECT s.ticker,s.tf,s.ts,s.o,s.h,s.l,s.c,s.v FROM snap.ohlcv s JOIN main.ohlcv m "
    "ON m.ticker=s.ticker AND m.tf=s.tf AND m.ts=s.ts WHERE s.ticker=? AND s.tf=? "
    "AND s.ts > ? AND s.ts < ? AND COALESCE(s.v,0) > COALESCE(m.v,0) AND "
    + _MERGE_VALID_SQL + _MERGE_GRID_SQL
)


def _bump_merged_rev(conn, ticker: str, tf: str, history: bool = False) -> None:
    """series_rev for a pair the merge changed, in the merge's own transaction."""
    from api.services.bars_sqlite import bump_series_revs
    bump_series_revs(conn, [(ticker, tf)], history=[(ticker, tf)] if history else ())


def _merge_ohlcv_from(src_db: str, local_db: Optional[str] = None, *,
                      pairs: Optional[list] = None,
                      deadline: Optional[float] = None) -> int:
    """Merge snapshot ohlcv into the local bars.db (rules above), in short chunks.

    Returns rows adopted + corrected (best-effort), or -1 if there is no local DB
    to merge into (caller should fall back to a plain install)."""
    if local_db is None:
        local_db = os.path.join(_DATA_DIR, "bars.db")
    if not os.path.exists(local_db):
        return -1
    # isolation_level=None: autocommit, so each chunk's BEGIN/COMMIT is explicit and
    # NOTHING holds the write lock between chunks.
    conn = sqlite3.connect(local_db, timeout=30, isolation_level=None)
    try:
        conn.execute("PRAGMA busy_timeout=30000")
        conn.execute("ATTACH DATABASE ? AS snap", (src_db,))
        _ensure_old_grid_fn(conn)
        try:
            # `pairs` narrows the merge to known-changed series; `deadline` (monotonic)
            # aborts between chunks -- both for a store adoption's locked pass.
            if pairs is None:
                pairs = conn.execute("SELECT DISTINCT ticker, tf FROM snap.ohlcv").fetchall()
            pairs = [tuple(p) for p in pairs]
            t_start = time.monotonic()
            logger.info(f"[data_sync] merge start: {len(pairs)} pairs")
            added = corrected = chunks = 0
            max_lock = total_lock = 0.0
            size = _MERGE_CHUNK_PAIRS
            i = 0
            while i < len(pairs):
                if deadline is not None and time.monotonic() > deadline:
                    raise TimeoutError(f"merge over budget after {i}/{len(pairs)} pairs")
                chunk = pairs[i:i + size]
                t0 = time.monotonic()
                conn.execute("BEGIN IMMEDIATE")
                try:
                    for ticker, tf in chunk:
                        a, c = _merge_pair(conn, ticker, tf)
                        added += a
                        corrected += c
                    conn.execute("COMMIT")
                except BaseException:
                    conn.execute("ROLLBACK")
                    raise
                held = time.monotonic() - t0
                max_lock = max(max_lock, held)
                total_lock += held
                chunks += 1
                i += len(chunk)
                if held > _MERGE_CHUNK_BUDGET_S and size > 1:
                    size = max(1, size // 2)     # adapt: shorter holds next time
                time.sleep(0)                    # let a queued writer in between chunks
            logger.info(
                f"[data_sync] merge end: {len(pairs)} pairs, {added} added, "
                f"{corrected} corrected, {chunks} chunks, lock max "
                f"{max_lock * 1000:.0f}ms total {total_lock * 1000:.0f}ms, "
                f"wall {(time.monotonic() - t_start) * 1000:.0f}ms")
            return added + corrected
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
    except Exception as e:
        logger.warning(f"[data_sync] merge download failed for {key}: {e}")
        return False
    logger.info(f"[data_sync] merge start {key} "
                f"({resp.get('ContentLength', '?')} bytes, streamed)")
    tmpdir = tempfile.mkdtemp(prefix="data_sync_merge_")
    try:
        # Streamed: never `resp["Body"].read()` -- see _STREAM_READ_BYTES.
        _extract_tar_stream(resp["Body"], tmpdir)
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
    if _adoption_active.is_set():        # adopt_clustered_store owns bars.db right now
        return None
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
    """Build a small SQLite at out_path holding only the ohlcv rows newer
    than the per-tf cutoff. Returns ohlcv rows exported. Reads the
    live bars.db read-only (WAL allows concurrent reads while the prewarmer
    writes). Column lists match bars_sqlite.init_db exactly."""
    cutoffs = _delta_cutoffs(now)
    src_path = os.path.join(_DATA_DIR, "bars.db")
    src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
    try:
        out = sqlite3.connect(out_path)
        try:
            from api.services.bars_sqlite import ohlcv_ddl
            out.execute(ohlcv_ddl())
            # ⚰️ A `bars_provenance` table was created in the delta here (and
            # filled from a source table that was always empty) until
            # 2026-08-09. See the note in `_merge_snapshot_db` above.
            # ⛔ Seek per ticker. `WHERE tf=?` alone cannot use the (ticker, tf,
            # ts) key, so it reads the whole 40 GB table once per timeframe; that
            # made one delta take about two hours (2026-11-09).
            from api.services.bars_sqlite import iter_tickers

            total = 0
            for ticker in iter_tickers(src):
                for tf, cut in cutoffs.items():
                    # The ceiling keeps a mis-keyed unix timestamp on a date
                    # timeframe out of the delta.
                    top = _DATE_KEY_MAX if tf in _DATE_KEYED_TFS else _UNIX_KEY_MAX
                    rows = src.execute(
                        "SELECT ticker,tf,ts,o,h,l,c,v FROM ohlcv "
                        "WHERE ticker=? AND tf=? AND ts>=? AND ts<=?",
                        (ticker, tf, cut, top),
                    ).fetchall()
                    if rows:
                        out.executemany(
                            "INSERT OR REPLACE INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", rows
                        )
                        total += len(rows)
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
        body = client.get_object(
            Bucket=bucket, Key=f"{_DELTA_PREFIX}{ts}.tar.gz"
        )["Body"]
        _extract_tar_stream(body, tmpdir)   # streamed, same bound as the base
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
    if _adoption_active.is_set():        # adopt_clustered_store owns bars.db right now
        return None
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
