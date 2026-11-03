"""Repair notes members already imported (connector fidelity Plan F). Runbook:
docs/runbooks/note-import-repair.md.

    nice -n 19 /opt/venv/bin/python tools/note_import_repair.py --out /data/import_repair/dryrun-1.json
    nohup nice -n 19 /opt/venv/bin/python tools/note_import_repair.py --apply \
        --out /data/import_repair/apply-1.json > /data/import_repair/apply-1.log 2>&1 &

  * DRY RUN IS THE DEFAULT. auth.db is opened read-only (`mode=ro`), so a dry run cannot write
    even by accident; it prints the report (`runner.scan`): what the repair WOULD do.
  * --apply writes (`runner.apply`). It refuses unless NOTE_IMPORT_REPAIR_ENABLED=1 on the
    service, and during 9:30-16:00 ET on a weekday unless --allow-market-hours. Each note
    is written only if unedited since its import, timestamp-neutral, with its old body logged
    first; a stopped run resumes with the same --run-id.
  * Runs on the web pod as a SEPARATE process (the only place with auth.db; a local copy would
    put member notes on a PC). Never imports api.main. One run at a time: an exclusive flock on
    <DATA_DIR>/.note_import_repair.lock (POSIX; skipped on Windows), plus the store's
    per-member lease.

Exit codes: 0 ok · 2 refused (flag off for --apply, or market hours) · 3 another run holds the
lock · 4 memory ceiling reached (the run aborted itself; resumable) · 5 database missing.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from api.services import auth_db  # noqa: E402
from api.services.journal_two.import_repair import runner  # noqa: E402

EXIT_OK, EXIT_REFUSED, EXIT_LOCKED, EXIT_ABORTED, EXIT_NO_DB = 0, 2, 3, 4, 5
LOCK_NAME = ".note_import_repair.lock"


def _parse(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Repair notes members already imported (dry run by default).")
    p.add_argument("--apply", action="store_true", help="write the repair (needs NOTE_IMPORT_REPAIR_ENABLED=1)")
    p.add_argument("--run-id", default=runner.RUN_ID_DEFAULT)
    p.add_argument("--member", action="append", dest="members", metavar="USER_ID",
                   help="only this member (repeatable); the first apply runs on the owner's id")
    p.add_argument("--max-fetches", type=int, default=2000)
    p.add_argument("--sleep-ms", type=int, default=20)
    p.add_argument("--max-members", type=int, default=None, help="apply: stop after this many members")
    p.add_argument("--max-notes", type=int, default=None, help="apply: stop after this many notes needing work")
    p.add_argument("--obsidian-relist", action="store_true",
                   help="apply: reset active Obsidian cursors (only after Plan C is deployed)")
    p.add_argument("--allow-market-hours", action="store_true", help="apply: allow 9:30-16:00 ET")
    p.add_argument("--out", default=None, help="also write the JSON report here (folders are created)")
    return p.parse_args(argv)


def _lock(data_dir: str):
    """The exclusive run lock, held for the life of the process. None on Windows (no flock)."""
    try:
        import fcntl
    except ImportError:
        return None
    Path(data_dir).mkdir(parents=True, exist_ok=True)
    handle = open(Path(data_dir) / LOCK_NAME, "a")
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        raise
    return handle


def _emit(report: dict, out: str | None) -> None:
    text = json.dumps(report, indent=2, sort_keys=True)
    if out:
        target = Path(out)
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(target.suffix + ".tmp")
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, target)
    sys.stdout.write(text + "\n")
    sys.stdout.flush()


def main(argv: list[str] | None = None) -> int:
    args = _parse(sys.argv[1:] if argv is None else argv)
    db_path = auth_db._DB_PATH
    if not os.path.exists(db_path):
        print(f"auth.db not found at {db_path}", file=sys.stderr)
        return EXIT_NO_DB
    try:
        lock = _lock(os.environ.get("DATA_DIR", "/data"))
    except OSError:
        print("another note_import_repair run holds the lock", file=sys.stderr)
        return EXIT_LOCKED
    try:
        if not args.apply:
            # Re-review T8-M5: the dry run reads every member's notes on the prod pod; it keeps
            # the same hours and the same memory ceiling as --apply.
            if not args.allow_market_hours and runner._market_hours(datetime.now(timezone.utc)):
                print("refused: market hours (9:30-16:00 ET): run outside them, or pass "
                      "--allow-market-hours", file=sys.stderr)
                return EXIT_REFUSED
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row  # C13: the runner and the link resolver read rows by name
            try:
                report = runner.scan(conn, run_id=args.run_id, members=args.members, sleep_ms=args.sleep_ms,
                                     rss_ceiling_mb=runner.RSS_CEILING_MB)
            except runner.RepairAborted as exc:
                print(f"aborted: {exc}", file=sys.stderr)
                return EXIT_ABORTED
            finally:
                conn.close()
        else:
            conn = auth_db.get_connection()
            try:
                report = runner.apply(conn, run_id=args.run_id, members=args.members,
                                      max_fetches=args.max_fetches, sleep_ms=args.sleep_ms,
                                      obsidian_relist=args.obsidian_relist,
                                      allow_market_hours=args.allow_market_hours,
                                      max_members=args.max_members, max_notes=args.max_notes)
            except runner.RepairRefused as exc:
                print(f"refused: {exc}", file=sys.stderr)
                return EXIT_REFUSED
            except runner.RepairAborted as exc:
                print(f"aborted (resumable with the same --run-id): {exc}", file=sys.stderr)
                return EXIT_ABORTED
            finally:
                conn.close()
        _emit(report, args.out)
        return EXIT_OK
    finally:
        if lock is not None:
            lock.close()


if __name__ == "__main__":
    sys.exit(main())
