"""Worker→web R2 bridge for the tiny `breadth_daily_ohlc` store.

The deep breadth-history recompute is too heavy for the single web pod: a
multi-minute CPU-bound sweep starves the one shared event loop long enough for
Railway's health check to recycle the pod (proven three times, incl. a 502
mid-sweep after a memory rewrite). So the recompute runs on the WORKER pod
instead — which has no user event loop to starve — and writes to the worker's
own `/data/breadth_daily_ohlc.db`. This module is the channel that carries those
rows over to the web pod so the charts serve them.

Deliberately FAR leaner than `data_sync.py` (the bars bridge), because this store
is nothing like bars:
  * It is single-digit MB and written ONCE (a backfill), not a live per-minute
    stream → we ship the WHOLE db every time, no delta rail.
  * The merge is GAP-FILL by primary key (date, metric), NOT newer-wins-by-ts.
    A backfill adds OLDER dates; the bars `s.ts > local MAX(ts)` rule would
    reject every single one of them. (This is the one copy-paste trap — see
    `_MERGE_SQL` and the test.)
  * The store opens a fresh connection per read and we merge IN PLACE (INSERT,
    no file swap), so there is no `bump_db_epoch()` / stale-inode problem to
    solve — the trickiest part of the bars bridge simply does not exist here.

Reuses the SAME R2 bucket + `DATA_SYNC_*` credentials as bars, under a
`breadth_ohlc/` key prefix (the Compass Brain Pack established the
one-bucket-many-prefixes precedent).

Dark by default: `upload()` runs only from the worker backfill thread
(`BREADTH_HISTORY_BACKFILL_ENABLED`), `sync_if_new()` only from the web puller
(`BREADTH_OHLC_REMOTE`). Both flags default OFF.
"""
from __future__ import annotations

import io
import os
import shutil
import sqlite3
import tarfile
import tempfile
import time
from typing import Optional

from api.services import breadth_daily_ohlc as _store

_PREFIX = "breadth_ohlc/"
_LATEST_KEY = _PREFIX + "latest.txt"
_SNAP_PREFIX = _PREFIX + "snap/"
_KEEP = 5                       # newest N tarballs retained in R2
_MIN_ROWS = 1                   # never ship a blank DB over a good one
_SYNC_MARKER = ".breadth_ohlc_last_sync"


def _data_dir() -> str:
    return os.environ.get("DATA_DIR", "/data")


def _client():
    """Lazy boto3 S3 client over R2. None if credentials are missing.
    Identical construction to data_sync._client() — same creds, same bucket."""
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
    return bool(_client() and _bucket())


# ── local sync marker (web side) ────────────────────────────────────────────

def _marker_path() -> str:
    return os.path.join(_data_dir(), _SYNC_MARKER)


def _read_marker() -> Optional[str]:
    try:
        with open(_marker_path()) as f:
            return f.read().strip() or None
    except Exception:
        return None


def _write_marker(ts: str) -> None:
    try:
        with open(_marker_path(), "w") as f:
            f.write(ts)
    except Exception:
        pass


# ── shared sqlite helpers ───────────────────────────────────────────────────

def _backup_db(src: str, dst: str) -> None:
    """Consistent copy via SQLite's online backup API (no WAL sidecars,
    no torn reads even if the intraday accumulator is mid-write)."""
    s = sqlite3.connect(src)
    try:
        d = sqlite3.connect(dst)
        try:
            s.backup(d)
        finally:
            d.close()
    finally:
        s.close()


def _integrity_ok(path: str) -> bool:
    try:
        c = sqlite3.connect(path, timeout=10)
        try:
            row = c.execute("PRAGMA integrity_check").fetchone()
            return bool(row and row[0] == "ok")
        finally:
            c.close()
    except sqlite3.DatabaseError:
        return False


def _count_rows(path: str) -> int:
    try:
        c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            r = c.execute("SELECT COUNT(*) FROM breadth_daily_ohlc").fetchone()
            return int(r[0]) if r else 0
        finally:
            c.close()
    except sqlite3.DatabaseError:
        return 0


# ── Producer (worker) ───────────────────────────────────────────────────────

_last_fp = {"fp": None}


def _fingerprint(db_path: str) -> Optional[str]:
    """Cheap stat-based fingerprint of the DB (+ WAL/SHM sidecars) so an
    unchanged store skips a needless re-upload."""
    try:
        st = os.stat(db_path)
        parts = [f"{st.st_size}:{int(st.st_mtime)}"]
        for sfx in ("-wal", "-shm"):
            try:
                s2 = os.stat(db_path + sfx)
                parts.append(f"{sfx}:{s2.st_size}:{int(s2.st_mtime)}")
            except OSError:
                pass
        return "|".join(parts)
    except OSError:
        return None


def upload(force: bool = False) -> Optional[str]:
    """Worker-side: ship the whole `breadth_daily_ohlc.db` to R2.

    Returns the unix-second ts string on success, the sentinel "unchanged" when
    the fingerprint matches the last upload (and not forced), or None on
    no-credentials / no-db / integrity failure. Never raises."""
    client = _client()
    bucket = _bucket()
    if not (client and bucket):
        return None
    db_path = _store._db_path()
    if not os.path.exists(db_path):
        return None
    fp = _fingerprint(db_path)
    if not force and fp is not None and fp == _last_fp["fp"]:
        return "unchanged"
    tmpdir = tempfile.mkdtemp(prefix="breadth_ohlc_snap_")
    try:
        snap_db = os.path.join(tmpdir, "breadth_daily_ohlc.db")
        _backup_db(db_path, snap_db)
        # Gate BEFORE shipping: a malformed or empty DB must never become the
        # snapshot of record (mirrors data_sync's 2026-07-03 upload gate).
        if not _integrity_ok(snap_db):
            return None
        if _count_rows(snap_db) < _MIN_ROWS:
            return None
        ts = str(int(time.time()))
        tar_path = os.path.join(tmpdir, "snap.tar.gz")
        with tarfile.open(tar_path, "w:gz") as tar:
            tar.add(snap_db, arcname="breadth_daily_ohlc.db")
        os.remove(snap_db)
        with open(tar_path, "rb") as f:
            body = f.read()
        client.put_object(Bucket=bucket, Key=f"{_SNAP_PREFIX}{ts}.tar.gz",
                          Body=body, ContentType="application/gzip")
        client.put_object(Bucket=bucket, Key=_LATEST_KEY,
                          Body=ts.encode(), ContentType="text/plain")
        _last_fp["fp"] = fp
        _prune(client, bucket)
        return ts
    except Exception:
        return None
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _prune(client, bucket) -> None:
    """Keep only the newest _KEEP snapshot tarballs in R2."""
    try:
        resp = client.list_objects_v2(Bucket=bucket, Prefix=_SNAP_PREFIX)
        keys = sorted(o["Key"] for o in resp.get("Contents", []))
        for k in keys[:-_KEEP]:
            try:
                client.delete_object(Bucket=bucket, Key=k)
            except Exception:
                pass
    except Exception:
        pass


# ── Consumer (web) ──────────────────────────────────────────────────────────

def _remote_latest(client, bucket) -> Optional[str]:
    try:
        resp = client.get_object(Bucket=bucket, Key=_LATEST_KEY)
        return resp["Body"].read().decode().strip() or None
    except Exception:
        return None


# The SOURCE-PRECEDENCE merge. Two things at once:
#   1. GAP-FILL — adopt any (date, metric) the web pod LACKS (older history).
#   2. UPGRADE  — adopt a HIGHER-fidelity source over a lower one for a date the web
#      already has: live(3) > intraday_recon(2) > close_recon(1). So a real
#      intraday_recon wick REPLACES a body-only close_recon, but a worker row NEVER
#      overwrites a real 'live' row (the accumulator's same-day truth wins).
#   3. CORRECT  — a re-sweep that FIXES an existing intraday_recon (same source, so no
#      rank change) still propagates: same-rank + NEWER updated_at wins, but only for
#      non-'live' locals. Without this, corrected wicks (e.g. the seeded-open fix)
#      could never overwrite the garbage already on the web store.
# `INSERT … ON CONFLICT DO UPDATE`, gated by the WHERE so only gap-fill + strict
# upgrades + same-rank corrections pass; a lower/older row on an existing date is
# excluded (untouched).
#
# ⛔ DO NOT add a `s.ts > local MAX(ts)` recency clause (the bars rule) — a backfill
# adds OLDER dates; that would reject every one. (test_gapfill_adopts_older_dates.)
# Geometry/finite gate is a rejection, never a repair: NaN fails `s.x = s.x`;
# `l <= min(o,c) <= max(o,c) <= h` must hold. No `> 0` — breadth is legitimately
# zero/negative (0% above a MA at a washout; McClellan / adv-decline go negative).
_RANK = ("CASE {c}.source WHEN 'live' THEN 3 WHEN 'intraday_recon' THEN 2 "
         "WHEN 'close_recon' THEN 1 ELSE 0 END")
_MERGE_SQL = f"""
INSERT INTO breadth_daily_ohlc(date,metric,o,h,l,c,source,updated_at)
SELECT s.date,s.metric,s.o,s.h,s.l,s.c,s.source,s.updated_at
FROM snap.breadth_daily_ohlc s
LEFT JOIN breadth_daily_ohlc l ON l.date = s.date AND l.metric = s.metric
WHERE s.source IN ('live','intraday_recon','close_recon')
  AND s.o IS NOT NULL AND s.h IS NOT NULL AND s.l IS NOT NULL AND s.c IS NOT NULL
  AND s.o = s.o AND s.h = s.h AND s.l = s.l AND s.c = s.c
  AND s.h >= s.l AND s.h >= s.o AND s.h >= s.c
  AND s.l <= s.o AND s.l <= s.c
  AND (l.date IS NULL
       OR ({_RANK.format(c='s')}) > ({_RANK.format(c='l')})
       OR (({_RANK.format(c='s')}) = ({_RANK.format(c='l')})
           AND l.source <> 'live' AND s.updated_at > l.updated_at))
ON CONFLICT(date, metric) DO UPDATE SET
  o=excluded.o, h=excluded.h, l=excluded.l, c=excluded.c,
  source=excluded.source, updated_at=excluded.updated_at
"""


def _merge_from(src_db: str) -> int:
    """Gap-fill merge the extracted snapshot into the local web store, in place.
    Returns rows adopted (best-effort)."""
    _store._ensure_init()
    local = _store._db_path()
    with _store._WRITE_LOCK:
        conn = sqlite3.connect(local, timeout=30)
        try:
            conn.execute("PRAGMA busy_timeout=30000")
            conn.execute("ATTACH DATABASE ? AS snap", (src_db,))
            try:
                cur = conn.execute(_MERGE_SQL)
                adopted = cur.rowcount if cur.rowcount is not None else 0
                conn.commit()
                return adopted
            finally:
                conn.execute("DETACH DATABASE snap")
        finally:
            conn.close()


def sync_if_new() -> Optional[str]:
    """Web-side cadence entry point: pull + gap-fill merge the latest breadth
    OHLC snapshot IF it changed since our last sync. A near-free no-op in the
    common case (one small GET of latest.txt that short-circuits). Returns the
    ts merged, or None. Never raises."""
    client = _client()
    bucket = _bucket()
    if not (client and bucket):
        return None
    remote_ts = _remote_latest(client, bucket)
    if not remote_ts or remote_ts == _read_marker():
        return None
    try:
        resp = client.get_object(Bucket=bucket, Key=f"{_SNAP_PREFIX}{remote_ts}.tar.gz")
        data = resp["Body"].read()
    except Exception:
        return None
    tmpdir = tempfile.mkdtemp(prefix="breadth_ohlc_merge_")
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
            tar.extractall(tmpdir)
        src_db = os.path.join(tmpdir, "breadth_daily_ohlc.db")
        if not os.path.exists(src_db) or not _integrity_ok(src_db):
            return None
        _merge_from(src_db)
        _write_marker(remote_ts)
        return remote_ts
    except Exception:
        return None
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
