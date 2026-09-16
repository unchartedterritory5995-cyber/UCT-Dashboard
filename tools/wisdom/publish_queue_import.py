"""Import review-queue items from a JSON-lines file into an explicit wisdom.db (stream S-F).

    python tools/wisdom/publish_queue_import.py --db <wisdom.db>
        [--file data/wisdom/golden/review-queue-v1.jsonl] [--dry-run]

--db is required and never defaulted. --file defaults to the gitignored
data/wisdom/golden/review-queue-v1.jsonl under this repo; when it is absent the
tool says so and imports nothing. Each line is one item: {tab, subject_ref,
summary, old, new, evidence, recommendation}, or a golden-harness row keyed by
gid (tab golden, subject golden:<gid>). Re-running is a no-op for items already
queued and never reopens an item the owner decided. Bad lines are reported by
line NUMBER only — a line can carry a verbatim quote.

--dry-run parses and validates inside a transaction that is rolled back.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from publish_report_preview import REPO_ROOT, RefusedPath, prepare_isolated_env  # noqa: E402

DEFAULT_FILE = os.path.join(REPO_ROOT, "data", "wisdom", "golden", "review-queue-v1.jsonl")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--db", required=True, help="wisdom.db to write (explicit; never defaulted)")
    parser.add_argument("--file", default=DEFAULT_FILE, help="JSON-lines queue file")
    parser.add_argument("--dry-run", action="store_true", help="validate only; roll back")
    args = parser.parse_args(argv)
    if not os.path.isfile(args.file):
        print(json.dumps({"file": args.file, "present": False, "imported": 0}))
        return 0
    try:
        prepare_isolated_env(args.db, [])
    except RefusedPath as exc:
        return int(exc.code)

    from api.services.wisdom.core import store
    from api.services.wisdom.publish import review

    store.init_db()
    with open(args.file, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    if args.dry_run:
        with store.WRITE_LOCK:
            conn = store.connect()
            try:
                conn.execute("BEGIN IMMEDIATE")
                result = review.import_queue_rows(conn, lines)
            finally:
                conn.rollback()
                conn.close()
    else:
        with store.write() as conn:
            result = review.import_queue_rows(conn, lines)
    print(json.dumps({"file": args.file, "present": True, "dry_run": bool(args.dry_run), **result}))
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
