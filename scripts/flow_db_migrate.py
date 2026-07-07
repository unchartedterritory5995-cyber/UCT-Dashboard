#!/usr/bin/env python
"""One-time flow.db migration: WEB volume -> WORKER volume (P5 cutover).

Railway volumes are single-attach, so moving the Massive OPRA consumer from web
to the worker means flow.db has to physically move to the worker's disk. This
script ships a consistent, integrity-checked snapshot through the R2 rail that
flow_backup.py already uses.

Run AFTER 4:20 PM ET when the OPRA tape is silent (no in-flight writes = the
snapshot is current and nothing is lost). Any tiny residual heals T+1 via
flow_gap_autofill.

Usage (via `railway ssh` on the respective service, /opt/venv/bin/python):
  # 1. On WEB (owns flow.db today) — snapshot -> R2:
  python scripts/flow_db_migrate.py --export
  # 2. On WORKER — pull -> verify -> install as its /data/flow.db:
  python scripts/flow_db_migrate.py --import
  # Dry-run anywhere (verify the rail + counts without swinging any live DB):
  python scripts/flow_db_migrate.py --export --dry-run
  python scripts/flow_db_migrate.py --import --dry-run --scratch /tmp/flow_probe.db

The export writes flow/migration/<ts>.db.gz + flow/migration/latest.txt (a
separate keyspace from the nightly flow_backups/ so it never collides).
"""
import argparse
import gzip
import os
import shutil
import sqlite3
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Reuse flow_backup's verified R2 + online-backup + integrity machinery.
from api.flow_backup import (  # noqa: E402
    DB_PATH, _r2_client, _bucket, _r2_configured, _sqlite_backup, _check_db,
)

_MIG_PREFIX = "flow/migration/"
_LATEST_KEY = _MIG_PREFIX + "latest.txt"


def _row_count(path: str) -> int:
    """Total rows in the flow table (the migration's correctness oracle)."""
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=30) as conn:
        return conn.execute("SELECT COUNT(*) FROM flow").fetchone()[0]


def _log(msg: str) -> None:
    print(f"[flow-migrate] {msg}", flush=True)


def do_export(dry_run: bool) -> int:
    if not os.path.exists(DB_PATH):
        _log(f"ERROR: source DB not found at {DB_PATH}")
        return 2
    if not _r2_configured():
        _log("ERROR: R2 not configured (missing DATA_SYNC_* creds)")
        return 2

    src_rows = _row_count(DB_PATH)
    ok, detail = _check_db(DB_PATH)
    _log(f"source {DB_PATH}: rows={src_rows} integrity={'ok' if ok else detail}")
    if not ok:
        _log("ERROR: source failed integrity_check — refusing to migrate a corrupt DB")
        return 2

    # Consistent online snapshot (won't tear the WAL) -> gzip.
    tmp_db = tempfile.mktemp(suffix=".db")
    tmp_gz = tempfile.mktemp(suffix=".db.gz")
    try:
        _sqlite_backup(DB_PATH, tmp_db)
        snap_rows = _row_count(tmp_db)
        # snap_rows >= src_rows is benign (new prints landed during the online
        # backup). snap_rows < src_rows is real LOSS -> refuse to publish, since
        # import can only self-verify download integrity, not source fidelity.
        if snap_rows < src_rows:
            _log(f"ERROR: snapshot LOST rows vs source (snap={snap_rows} < "
                 f"src={src_rows}) — refusing to publish a lossy snapshot. "
                 f"Run after 4:20 PM ET when the tape is silent.")
            return 2
        with open(tmp_db, "rb") as f_in, gzip.open(tmp_gz, "wb", compresslevel=6) as f_out:
            shutil.copyfileobj(f_in, f_out)
        size_mb = os.path.getsize(tmp_gz) / 1e6
        ts = str(int(time.time()))
        key = f"{_MIG_PREFIX}{ts}.db.gz"

        if dry_run:
            _log(f"DRY-RUN: would upload {size_mb:.1f}MB gz ({snap_rows} rows) to r2://{_bucket()}/{key}")
            return 0

        client = _r2_client()
        client.upload_file(tmp_gz, _bucket(), key)
        # Publish the pointer LAST so a reader never sees a half-written key.
        client.put_object(Bucket=_bucket(), Key=_LATEST_KEY,
                          Body=f"{ts}\t{snap_rows}".encode())
        _log(f"EXPORT OK: {size_mb:.1f}MB, {snap_rows} rows -> r2://{_bucket()}/{key}")
        _log(f"pointer -> {_LATEST_KEY} = {ts}\\t{snap_rows}")
        return 0
    finally:
        for p in (tmp_db, tmp_gz):
            try:
                os.remove(p)
            except OSError:
                pass


def do_import(dry_run: bool, scratch: str) -> int:
    if not _r2_configured():
        _log("ERROR: R2 not configured (missing DATA_SYNC_* creds)")
        return 2
    client = _r2_client()
    try:
        pointer = client.get_object(Bucket=_bucket(), Key=_LATEST_KEY)["Body"].read().decode()
    except Exception as e:  # noqa: BLE001
        _log(f"ERROR: no migration pointer at {_LATEST_KEY}: {e} (run --export first)")
        return 2
    ts, _, expect_rows_s = pointer.partition("\t")
    expect_rows = int(expect_rows_s) if expect_rows_s.strip().isdigit() else None
    key = f"{_MIG_PREFIX}{ts}.db.gz"
    _log(f"pointer -> {key} (expect rows={expect_rows})")

    dest = scratch if (dry_run and scratch) else DB_PATH
    tmp_gz = tempfile.mktemp(suffix=".db.gz")
    staged = dest + ".migrating"
    try:
        client.download_file(_bucket(), key, tmp_gz)
        with gzip.open(tmp_gz, "rb") as f_in, open(staged, "wb") as f_out:
            shutil.copyfileobj(f_in, f_out)

        got_rows = _row_count(staged)
        ok, detail = _check_db(staged)
        _log(f"downloaded: rows={got_rows} integrity={'ok' if ok else detail}")
        if not ok:
            _log("ERROR: downloaded DB failed integrity_check — NOT installing")
            return 2
        if expect_rows is not None and got_rows != expect_rows:
            _log(f"ERROR: row count mismatch (got {got_rows}, expected {expect_rows}) — NOT installing")
            return 2

        if dry_run:
            _log(f"DRY-RUN OK: staged at {staged} ({got_rows} rows, integrity ok). Not installing.")
            return 0

        # Atomic-ish install: back up the existing DB, then rename staged in.
        if os.path.exists(dest):
            backup = f"{dest}.pre-migrate.{ts}"
            shutil.copy2(dest, backup)
            _log(f"existing {dest} preserved at {backup}")
        os.replace(staged, dest)
        staged = None  # consumed
        # Delete any stale -wal/-shm from a PRIOR flow.db, or SQLite would replay
        # the OLD database's WAL frames onto the freshly-installed file on next
        # open = silent corruption of the non-replayable options DB.
        for side in ("-wal", "-shm"):
            try:
                os.remove(dest + side)
            except OSError:
                pass
        _log(f"IMPORT OK: installed {got_rows} rows at {dest} (stale WAL sidecars cleared)")
        _log("Restart the worker (or ensure it opens the new file) before flipping MASSIVE_WS_ENABLED=1.")
        return 0
    finally:
        for p in (tmp_gz, staged):
            if p:
                try:
                    os.remove(p)
                except OSError:
                    pass


def main() -> int:
    ap = argparse.ArgumentParser(description="P5 flow.db web->worker migration")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--export", action="store_true", help="snapshot flow.db -> R2 (run on WEB)")
    mode.add_argument("--import", dest="do_import", action="store_true",
                      help="pull latest snapshot -> install as this pod's flow.db (run on WORKER)")
    ap.add_argument("--dry-run", action="store_true", help="verify without swinging any live DB")
    ap.add_argument("--scratch", default="/tmp/flow_migrate_probe.db",
                    help="dry-run import target path (default /tmp/flow_migrate_probe.db)")
    args = ap.parse_args()
    if args.export:
        return do_export(args.dry_run)
    return do_import(args.dry_run, args.scratch)


if __name__ == "__main__":
    sys.exit(main())
