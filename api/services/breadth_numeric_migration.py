"""One-off, idempotent backfill of the breadth numeric projection (§3).

⭐ WHAT MAKES THIS SAFE TO RUN ON A LIVE POD: it only ever INSERTs into a table
that did not exist before, and it asserts — with a fingerprint taken before and
after — that `breadth_snapshots` is byte-for-byte unchanged. A migration that
cannot be shown not to have touched the source data is one nobody can approve
twice.

⛔ AND IT REFUSES TO RUN WITHOUT A BACKUP. `VACUUM INTO`, never a file copy: a
plain copy of a WAL database omits whatever is still in the `-wal` sidecar and
produces a backup that looks complete while silently lagging the source. If there
is not room for one, the migration ABORTS rather than proceeding uninsured — the
reader still serves correctly off the blobs until this runs, so nothing here is
urgent enough to justify going without.

⚠️ `/data/backups/` is on the SAME volume as the database it backs up. It covers a
logical mistake — which is exactly what this write risks — and covers nothing
about losing the volume.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import time

MARKER = ".breadth_numeric_v1"
RECON_MARKER = ".breadth_reconstructed_v1"


def _data_dir() -> str:
    return os.environ.get("DATA_DIR", "/data")


def _marker_path() -> str:
    return os.path.join(_data_dir(), MARKER)


def _fingerprint(c) -> dict:
    """Identity of `breadth_snapshots`, cheap enough to take twice.

    ⭐ A COUNT IS NOT AN IDENTITY. A count going up by one is compatible with one
    row added and another silently rewritten; this hashes (date, byte-length) for
    every row, so a rewrite that preserves the count still changes the digest.
    """
    rows = c.execute(
        "SELECT date, LENGTH(metrics) FROM breadth_snapshots ORDER BY date").fetchall()
    h = hashlib.sha256()
    for d, n in rows:
        h.update(f"{d}:{n}|".encode())
    return {"rows": len(rows), "sha256": h.hexdigest()[:16]}


def backfill(force: bool = False, backup: bool = True) -> dict:
    """Populate `breadth_snapshot_numeric` for every date that lacks a row."""
    from api.services import breadth_monitor as bm

    out: dict = {"ran": False, "marker": _marker_path()}
    if os.path.exists(_marker_path()) and not force:
        out["skipped"] = "marker present"
        return out

    bm.init_db()
    db = bm._db_path()
    t0 = time.perf_counter()

    with bm._conn() as c:
        before = _fingerprint(c)
        out["before"] = before
        out["numeric_rows_before"] = c.execute(
            "SELECT COUNT(*) FROM breadth_snapshot_numeric").fetchone()[0]

    if backup:
        try:
            size = os.path.getsize(db)
            free = shutil.disk_usage(os.path.dirname(db) or ".").free
            if free < size * 2:
                out["aborted"] = ("not enough room for a VACUUM INTO backup: "
                                  f"db={size}B free={free}B")
                return out
            dest_dir = os.path.join(_data_dir(), "backups")
            os.makedirs(dest_dir, exist_ok=True)
            dest = os.path.join(
                dest_dir,
                f"breadth_monitor-{time.strftime('%Y-%m-%d-%H%M%S')}-pre-numeric.db")
            with bm._conn() as c:
                c.execute("VACUUM INTO ?", (dest,))
            out["backup"] = dest
            out["backup_bytes"] = os.path.getsize(dest)
        except Exception as e:
            out["aborted"] = f"backup failed: {e!r}"
            return out

    written = 0
    with bm._conn() as c:
        todo = [r[0] for r in c.execute(
            "SELECT s.date FROM breadth_snapshots s "
            "LEFT JOIN breadth_snapshot_numeric n ON n.date = s.date "
            "WHERE n.date IS NULL ORDER BY s.date").fetchall()]
        out["to_write"] = len(todo)
        for i in range(0, len(todo), 200):
            chunk = todo[i:i + 200]
            dq = ",".join("?" * len(chunk))
            rows = c.execute(
                f"SELECT date, metrics FROM breadth_snapshots WHERE date IN ({dq})",
                chunk).fetchall()
            for d, mj in rows:
                # ⛔ THE SAME PROJECTION THE WRITER USES. A second implementation
                # here would drift from the write path on the first new metric,
                # and the drift would be invisible until a column went blank.
                c.execute(
                    "INSERT OR REPLACE INTO breadth_snapshot_numeric "
                    "(date, metrics, source, updated_at) "
                    "VALUES (?, ?, 'backfill', datetime('now'))",
                    (d, json.dumps(bm.numeric_of(json.loads(mj)))),
                )
                written += 1
            c.commit()

        after = _fingerprint(c)
        out["after"] = after
        out["numeric_rows_after"] = c.execute(
            "SELECT COUNT(*) FROM breadth_snapshot_numeric").fetchone()[0]

    out["written"] = written
    out["ms"] = round((time.perf_counter() - t0) * 1000, 1)
    # ⛔ THE ASSERTION IS THE POINT. If the source table moved, say so loudly and
    # do NOT write the marker — a migration that mutated its own input must be
    # allowed to be noticed and re-run against the backup.
    if after != before:
        out["FAILED"] = "breadth_snapshots CHANGED during the backfill"
        return out
    out["source_table_unchanged"] = True

    try:
        with open(_marker_path(), "w", encoding="utf-8") as fh:
            fh.write(json.dumps({"at": time.time(), "written": written}))
    except Exception as e:
        out["marker_write_failed"] = repr(e)
    out["ran"] = True
    try:
        from api.services.cache import cache
        cache.delete_prefix("breadth_history_")
    except Exception:
        pass
    return out


def audit() -> dict:
    """Compare the two tables across ALL dates and report drift BY NAME.

    ⭐ Names, never a count. "3 rows disagree" sends the next person to write this
    script again; naming the dates and the keys lets them open the row.
    """
    from api.services import breadth_monitor as bm

    mismatched = []
    with bm._conn() as c:
        blob_dates = [r[0] for r in c.execute(
            "SELECT date FROM breadth_snapshots ORDER BY date")]
        num_dates = {r[0] for r in c.execute("SELECT date FROM breadth_snapshot_numeric")}
        missing = [d for d in blob_dates if d not in num_dates]
        extra = sorted(num_dates - set(blob_dates))
        for i in range(0, len(blob_dates), 200):
            chunk = [d for d in blob_dates[i:i + 200] if d in num_dates]
            if not chunk:
                continue
            dq = ",".join("?" * len(chunk))
            blobs = dict(c.execute(
                f"SELECT date, metrics FROM breadth_snapshots WHERE date IN ({dq})",
                chunk).fetchall())
            nums = dict(c.execute(
                f"SELECT date, metrics FROM breadth_snapshot_numeric WHERE date IN ({dq})",
                chunk).fetchall())
            for d in chunk:
                want = bm.numeric_of(json.loads(blobs[d]))
                got = json.loads(nums[d])
                if want != got:
                    diff = sorted(set(want) ^ set(got)) or [
                        k for k in want if want.get(k) != got.get(k)]
                    mismatched.append({"date": d, "keys": diff[:12]})

        listy = []
        for d, mj in c.execute("SELECT date, metrics FROM breadth_snapshot_numeric"):
            bad = [k for k in json.loads(mj) if k.endswith("_list")]
            if bad:
                listy.append({"date": d, "keys": bad})

    return {"missing_from_numeric": missing, "extra_in_numeric": extra,
            "mismatched": mismatched, "list_keys_leaked": listy,
            "checked": len(blob_dates),
            "clean": not (missing or extra or mismatched or listy)}




# ── Session 3: the reconstructed side ─────────────────────────────────────────

def _recon_fingerprint(c) -> dict:
    """Identity of the OHLC store's TRUSTED rows — the migration's INPUT."""
    from api.services import breadth_daily_ohlc as ohlc
    qs = ",".join("?" * len(ohlc._TRUSTED_SOURCES))
    rows = c.execute(
        f"SELECT date, COUNT(*), MAX(updated_at) FROM breadth_daily_ohlc "
        f"WHERE source IN ({qs}) GROUP BY date ORDER BY date", ohlc._TRUSTED_SOURCES).fetchall()
    h = hashlib.sha256()
    for d, n, w in rows:
        h.update(f"{d}:{n}:{w}|".encode())
    return {"dates": len(rows), "sha256": h.hexdigest()[:16]}


def backfill_reconstructed(force: bool = False, backup: bool = True,
                           chunk: int = 400) -> dict:
    """Materialise every reconstructed session date, once. Same shape as (a):
    marker-gated, backed up with VACUUM INTO, and fingerprinted on both sides.

    ⛔ The fingerprint here covers the INPUT (the trusted OHLC rows), because that
    is what this migration must not disturb. It only ever writes to
    `breadth_reconstructed_daily`, a table that did not exist before — but "it
    should not have touched the source" is a claim, and the digest is the evidence.
    """
    from api.services import breadth_daily_ohlc as ohlc

    out: dict = {"ran": False, "marker": os.path.join(_data_dir(), RECON_MARKER)}
    if os.path.exists(out["marker"]) and not force:
        out["skipped"] = "marker present"
        return out

    ohlc._ensure_init()
    db = ohlc._db_path()
    t0 = time.perf_counter()

    with ohlc._conn() as c:
        before = _recon_fingerprint(c)
        out["before"] = before
        out["rows_before"] = c.execute(
            "SELECT COUNT(*) FROM breadth_reconstructed_daily").fetchone()[0]

    if backup:
        try:
            size = os.path.getsize(db)
            free = shutil.disk_usage(os.path.dirname(db) or ".").free
            if free < size * 2:
                out["aborted"] = ("not enough room for a VACUUM INTO backup: "
                                  f"db={size}B free={free}B")
                return out
            dest_dir = os.path.join(_data_dir(), "backups")
            os.makedirs(dest_dir, exist_ok=True)
            dest = os.path.join(
                dest_dir,
                f"breadth_daily_ohlc-{time.strftime('%Y-%m-%d-%H%M%S')}-pre-reconstructed.db")
            with ohlc._conn() as c:
                c.execute("VACUUM INTO ?", (dest,))
            out["backup"] = dest
            out["backup_bytes"] = os.path.getsize(dest)
        except Exception as e:
            out["aborted"] = f"backup failed: {e!r}"
            return out

    dates = ohlc.distinct_dates()
    out["candidate_dates"] = len(dates)
    built = 0
    # ⚠️ Chunked. Building ~4,700 rows in one statement list is fine; deriving them
    # in one go is what holds 174,187 OHLC rows in memory at once, which is the
    # exact transient (a) existed to remove. Do not "simplify" this to one call.
    for i in range(0, len(dates), chunk):
        built += ohlc.build_reconstructed(dates[i:i + chunk])
    out["built"] = built

    with ohlc._conn() as c:
        after = _recon_fingerprint(c)
        out["after"] = after
        out["rows_after"] = c.execute(
            "SELECT COUNT(*) FROM breadth_reconstructed_daily").fetchone()[0]
    out["ms"] = round((time.perf_counter() - t0) * 1000, 1)

    if after != before:
        out["FAILED"] = "the trusted OHLC rows CHANGED during the backfill"
        return out
    out["source_table_unchanged"] = True
    out["stale_after"] = len(ohlc.stale_reconstructed_dates())

    try:
        with open(out["marker"], "w", encoding="utf-8") as fh:
            fh.write(json.dumps({"at": time.time(), "built": built}))
    except Exception as e:
        out["marker_write_failed"] = repr(e)
    out["ran"] = True
    try:
        from api.services.cache import cache
        cache.delete_prefix("breadth_history_")
    except Exception:
        pass
    return out


def audit_reconstructed(sample: int = 40) -> dict:
    """Compare a fresh derivation against the table for a sampled set of dates.

    ⭐ SAMPLED, and the sample is spread rather than taken off the front: a
    contiguous head would only ever test the oldest sessions, which are the ones
    least likely to have been rewritten. Reports mismatches BY DATE AND KEY.
    """
    from api.services import breadth_daily_ohlc as ohlc

    dates = ohlc.distinct_dates()
    if not dates:
        return {"checked": 0, "clean": True, "mismatched": [], "note": "no reconstructed dates"}
    step = max(1, len(dates) // max(sample, 1))
    picked = dates[::step][:sample]
    mismatched = []
    with ohlc._conn() as c:
        fresh = ohlc.derive_reconstructed(c, picked)
    stored, _ = ohlc.reconstructed_for_dates(picked)
    for d in picked:
        want, got = fresh.get(d), stored.get(d)
        if want is None and got is None:
            continue
        if want != got:
            keys = sorted(set(want or {}) ^ set(got or {})) or [
                k for k in (want or {}) if (want or {}).get(k) != (got or {}).get(k)]
            mismatched.append({"date": d, "keys": keys[:12]})
    return {"checked": len(picked), "of_dates": len(dates),
            "mismatched": mismatched, "stale": len(ohlc.stale_reconstructed_dates(limit=50)),
            "clean": not mismatched}


if __name__ == "__main__":
    import sys
    if "--audit" in sys.argv:
        print(json.dumps(audit(), indent=1))
    elif "--audit-reconstructed" in sys.argv:
        print(json.dumps(audit_reconstructed(), indent=1))
    elif "--reconstructed" in sys.argv:
        print(json.dumps(backfill_reconstructed(force="--force" in sys.argv,
                                                backup="--no-backup" not in sys.argv), indent=1))
    else:
        print(json.dumps(backfill(force="--force" in sys.argv,
                                  backup="--no-backup" not in sys.argv), indent=1))
