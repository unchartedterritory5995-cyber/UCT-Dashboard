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
#
# ⛔⛔ THE JOIN AND THE CONFLICT TARGET BOTH CARRY `universe`, and leaving either
# one out is silent corruption rather than an error. Keyed on (date, metric) alone,
# a US row and the UCT row for the same date and metric are the SAME row: the merge
# would compare their ranks, pick a winner, and write one universe's number under
# the other's name. Nothing downstream could detect it — same shape, same metric
# key, plausible value.
#
# ⚠️ `{{susrc}}` is `s.universe` against a migrated snapshot and the literal 'uct'
# against a pre-migration one, so a worker that has not yet redeployed still merges
# correctly instead of failing on a missing column. Resolved once, in `_merge_from`.
# ⛔⛔ `intraday_recon_1m` IS THE V2 RE-GRIND'S SOURCE AND IT MUST OUTRANK BOTH
# RECONSTRUCTIONS BELOW IT. It is a whole-session 1-MINUTE replay carrying the F1
# provider-internal basis lift, the F2 domain registry and the F5 authoritative EOD
# close; `intraday_recon` is the 30-minute sweep that PREDATES all three, and
# `close_recon` is body-only. Omitting it (the state before this change) did not
# merely rank it last — `ELSE 0` plus the `source IN (...)` gate meant every one of
# the 568,694 V2 rows was filtered out and the merge reported success having adopted
# NOTHING. Two doors, one omission.
#
# ⭐ `live` STILL WINS. The accumulator watched that session tick by tick and its
# basis factor is 1.0 by construction (no corporate action has happened since), so a
# reconstruction — however good — must never overwrite the day the system observed.
# That is also what makes the post-cutover steady state safe: tomorrow's live row
# outranks anything V2 holds for the same key.
from api.services.breadth_daily_ohlc import SOURCE_PRECEDENCE as _PREC
from api.services.breadth_universes import UNIVERSE_IDS as _MERGEABLE_UNIVERSES

_RANK = ("CASE {c}.source "
         + " ".join("WHEN '%s' THEN %d" % (s, len(_PREC) - i) for i, s in enumerate(_PREC))
         + " ELSE 0 END")
_SOURCE_GATE = ",".join("'%s'" % s for s in _PREC)
#: ⛔ A universe that is not in the production registry is never merged. Research series
#: (e.g. the `uct_backtest` of a V2c2 artifact) live in an artifact, never in the store.
_UNIVERSE_GATE = ",".join("'%s'" % u for u in _MERGEABLE_UNIVERSES)
from api.services.breadth_universes import CANONICAL_START as _CSTART
#: ⛔ No merge may introduce a canonical row before the universe's canonical start
#: (active with the cutover switch, `breadth_universes.canonical_start_active`).
def _start_gate() -> str:
    from api.services.breadth_universes import canonical_start_active
    if not canonical_start_active():
        return "1=1"
    return " AND ".join("NOT ({susrc} = '%s' AND s.date < '%s')" % (u, d)
                        for u, d in sorted(_CSTART.items())) or "1=1"
#: ⛔⛔ ARTIFACT PROVENANCE GATE. A pass ARTIFACT (it carries `pass_meta`) may be merged only
#: if it declares the accepted methodology AND the canonical dividend basis AND the dividend
#: input it was built from. The frozen split-only V2c, V1 and the original V2 use the SAME
#: `source` names as V2c2 — without this gate the precedence list would adopt them.
#: A store-to-store sync snapshot has no `pass_meta` and is not an artifact.
ACCEPTED_ARTIFACT_METHODOLOGY = "rth-1m-composites-v2c2-div"
ACCEPTED_DIVIDEND_BASIS = "div-basis-v5"


class ArtifactProvenanceRefused(RuntimeError):
    pass


def _check_artifact_provenance(conn) -> None:
    has_meta = conn.execute("SELECT 1 FROM snap.sqlite_master WHERE type='table' AND name='pass_meta'").fetchone()
    if not has_meta:
        return
    meta = dict(conn.execute("SELECT key, value FROM snap.pass_meta").fetchall())
    problems = []
    if meta.get("methodology") != ACCEPTED_ARTIFACT_METHODOLOGY:
        problems.append("methodology %r != %r" % (meta.get("methodology"), ACCEPTED_ARTIFACT_METHODOLOGY))
    if ("breadth_dividend_basis %s" % ACCEPTED_DIVIDEND_BASIS) not in (meta.get("price_basis") or ""):
        problems.append("price basis %r is not the canonical %s" % (meta.get("price_basis"), ACCEPTED_DIVIDEND_BASIS))
    if not meta.get("dividend_input_key"):
        problems.append("no dividend_input_key provenance")
    if problems:
        raise ArtifactProvenanceRefused("refusing to merge artifact: " + "; ".join(problems))


_MERGE_SQL = f"""
INSERT INTO breadth_daily_ohlc(universe,date,metric,o,h,l,c,source,updated_at)
SELECT {{susrc}},s.date,s.metric,s.o,s.h,s.l,s.c,s.source,s.updated_at
FROM snap.breadth_daily_ohlc s
LEFT JOIN breadth_daily_ohlc l
       ON l.universe = {{susrc}} AND l.date = s.date AND l.metric = s.metric
WHERE s.source IN ({_SOURCE_GATE})
  AND {{susrc}} IN ({_UNIVERSE_GATE})
  AND {{start_gate}}
  AND s.o IS NOT NULL AND s.h IS NOT NULL AND s.l IS NOT NULL AND s.c IS NOT NULL
  AND s.o = s.o AND s.h = s.h AND s.l = s.l AND s.c = s.c
  AND s.h >= s.l AND s.h >= s.o AND s.h >= s.c
  AND s.l <= s.o AND s.l <= s.c
  AND (l.date IS NULL
       OR ({_RANK.format(c='s')}) > ({_RANK.format(c='l')})
       OR (({_RANK.format(c='s')}) = ({_RANK.format(c='l')})
           AND l.source <> 'live' AND s.updated_at > l.updated_at))
ON CONFLICT(universe, date, metric) DO UPDATE SET
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
                snap_cols = {r[1] for r in conn.execute(
                    "PRAGMA snap.table_info(breadth_daily_ohlc)").fetchall()}
                susrc = "s.universe" if "universe" in snap_cols else "'uct'"
                # ⛔⛔ BL-028 INTERLOCK, RESTATED AT THE OTHER DOOR. The compatibility
                # index keeps `(date, metric)` unique so pre-migration code can still
                # write; a snapshot carrying a second universe would violate it. SQLite
                # would say so — as a UNIQUE constraint error from inside a merge, which
                # is a terrible place to learn it. Refuse first, and name the step.
                if "universe" in snap_cols and _store.compat_index_present(conn):
                    extra = [r[0] for r in conn.execute(
                        "SELECT DISTINCT universe FROM snap.breadth_daily_ohlc "
                        "WHERE universe <> ?", (_store.DEFAULT_UNIVERSE,)).fetchall()]
                    if extra:
                        raise _store.CompatIndexBlocksUniverse(
                            f"refusing to merge a snapshot carrying {extra}: the BL-028 "
                            f"compatibility index {_store.COMPAT_INDEX!r} is still in "
                            "place. Removing it is a deliberate migration step.")
                _check_artifact_provenance(conn)
                cur = conn.execute(_MERGE_SQL.format(susrc=susrc, start_gate=_start_gate().format(susrc=susrc)))
                adopted = cur.rowcount if cur.rowcount is not None else 0
                # ⛔ THE ONE WRITER THAT BYPASSES `breadth_daily_ohlc`'s own API —
                # it INSERTs directly over an ATTACHed snapshot — so the derived
                # reconstructed table is kept in step by WATERMARK rather than by
                # this function knowing which dates it adopted (`rowcount` is a
                # count, not a date list). Same connection, so still one
                # transaction; and the watermark would have caught a miss here even
                # if this hook had never been added, which is exactly why the design
                # does not rest on every writer remembering.
                if adopted:
                    stale = _store.stale_reconstructed_dates(c=conn)
                    if stale:
                        _store._rebuild_after_write(conn, stale)
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
